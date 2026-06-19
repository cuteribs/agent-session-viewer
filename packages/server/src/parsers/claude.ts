import { readFileSync, existsSync, readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import type {
  ClaudeCodeEntry,
  ContentBlock,
  SessionSummary,
  SessionDetail,
  SubAgent,
  Message,
  ToolCall,
  ToolResult,
  SessionStats,
  ToolUsageSummary,
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

interface ClaudeRawEntry {
  type: ClaudeCodeEntry['type'] | 'ai-title' | 'last-prompt' | 'queue-operation';
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  agentId?: string;
  attributionAgent?: string;
  message?: ClaudeCodeEntry['message'];
  subtype?: string;
  durationMs?: number;
  aiTitle?: string;
  content?: string;
  isMeta?: boolean;
  messageId?: string;
  /** 1-based line number in the source JSONL file (set during file read). */
  _lineNumber?: number;
  attachment?: {
    type?: string;
    content?: unknown;
    itemCount?: number;
  };
  toolUseResult?: {
    agentType?: string;
    agentId?: string;
    status?: string;
    content?: Array<{ type: string; text?: string }>;
  };
}

interface OrderedMessage extends Message {
  _order: number;
}

interface OrderedToolCall {
  call: ToolCall;
  order: number;
  timestamp: string;
}

interface OrderedToolResult {
  result: ToolResult;
  order: number;
  timestamp: string;
  agentType?: string;
}

interface CommandInfo {
  name: string;
  args: string;
}

export function parseClaudeSessionFile(filePath: string): SessionDetail | null {
  try {
    const entries = readClaudeEntries(filePath);
    if (entries.length === 0) {
      return null;
    }

    const sessionId = entries.find(e => e.sessionId)?.sessionId || basename(filePath, '.jsonl');
    const projectPath = decodeProjectPath(dirname(filePath));
    const aiTitle = entries.find(e => e.type === 'ai-title')?.aiTitle;
    const project = aiTitle || basename(projectPath);

    const messages = buildClaudeDisplayMessages(entries);
    const { stats, toolUsage, model, totalTokens } = buildClaudeStats(messages, entries);

    const timestampedEntries = entries.filter((entry): entry is ClaudeRawEntry & { timestamp: string } =>
      typeof entry.timestamp === 'string' && entry.timestamp.length > 0
    );
    const startTime = timestampedEntries[0]?.timestamp || new Date().toISOString();
    const lastActivity = timestampedEntries[timestampedEntries.length - 1]?.timestamp || startTime;

    const subAgents = loadClaudeSubagents(filePath);

    return {
      id: sessionId,
      source: 'claude',
      project,
      projectPath,
      startTime,
      lastActivity,
      messageCount: messages.length,
      totalTokens,
      model,
      messages,
      stats,
      toolUsage,
      subAgents: subAgents.length > 0 ? subAgents : undefined,
    };
  } catch (error) {
    console.error(`Error parsing Claude session file ${filePath}:`, error);
    return null;
  }
}

export function getClaudeSessionSummary(detail: SessionDetail): SessionSummary {
  return {
    id: detail.id,
    source: detail.source,
    project: detail.project,
    projectPath: detail.projectPath,
    startTime: detail.startTime,
    lastActivity: detail.lastActivity,
    messageCount: detail.messageCount,
    totalTokens: detail.totalTokens,
    model: detail.model,
    subAgentCount: detail.subAgents?.length,
  };
}

function readClaudeEntries(filePath: string): ClaudeRawEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const entries: ClaudeRawEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as ClaudeRawEntry;
      entry._lineNumber = i + 1;
      entries.push(entry);
    } catch {
      // Skip malformed lines.
    }
  }

  return entries;
}

function buildClaudeDisplayMessages(entries: ClaudeRawEntry[]): Message[] {
  const orderedEntries = entries.filter((entry): entry is ClaudeRawEntry & { uuid: string; timestamp: string } =>
    typeof entry.uuid === 'string' && entry.uuid.length > 0 && typeof entry.timestamp === 'string' && entry.timestamp.length > 0
  );
  if (orderedEntries.length === 0) {
    return [];
  }

  const entryById = new Map<string, ClaudeRawEntry & { uuid: string; timestamp: string }>();
  const rawOrder = new Map<string, number>();
  for (const [index, entry] of orderedEntries.entries()) {
    entryById.set(entry.uuid, entry);
    rawOrder.set(entry.uuid, index);
  }

  const rootEntries = findRootEntries(entries, orderedEntries);
  const rootIds = new Set(rootEntries.map(entry => entry.uuid));
  const groups = new Map<string, Array<ClaudeRawEntry & { uuid: string; timestamp: string }>>();

  for (const entry of orderedEntries) {
    const rootId = findOwningRootId(entry, entryById, rootIds);
    if (!rootId) {
      continue;
    }
    if (!groups.has(rootId)) {
      groups.set(rootId, []);
    }
    groups.get(rootId)!.push(entry);
  }

  const messages: OrderedMessage[] = [];
  for (const rootEntry of rootEntries) {
    const group = groups.get(rootEntry.uuid);
    if (!group || !rootEntry.message) {
      continue;
    }

    if (isCommandEntry(rootEntry)) {
      messages.push(...buildLocalCommandMessages(rootEntry, group, rawOrder));
      continue;
    }

    messages.push(...buildPromptMessages(rootEntry, group, rawOrder));
  }

  return messages
    .sort((a, b) => a._order - b._order)
    .map(({ _order: _unused, ...message }) => message);
}

function findRootEntries(
  entries: ClaudeRawEntry[],
  orderedEntries: Array<ClaudeRawEntry & { uuid: string; timestamp: string }>
): Array<ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> }> {
  const snapshotRootIds = new Set(
    entries
      .filter((entry): entry is ClaudeRawEntry & { messageId: string } =>
        entry.type === 'file-history-snapshot' && typeof entry.messageId === 'string' && entry.messageId.length > 0
      )
      .map(entry => entry.messageId)
  );

  const snapshotRoots = orderedEntries.filter(
    (entry): entry is ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> } =>
      snapshotRootIds.has(entry.uuid) && !!entry.message && entry.message.role === 'user'
  );
  if (snapshotRoots.length > 0) {
    return snapshotRoots;
  }

  return orderedEntries.filter(
    (entry): entry is ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> } =>
      !!entry.message &&
      entry.message.role === 'user' &&
      !isToolResultEntry(entry) &&
      (!entry.parentUuid || !orderedEntries.some(other => other.uuid === entry.parentUuid))
  );
}

function findOwningRootId(
  entry: ClaudeRawEntry & { uuid: string },
  entryById: Map<string, ClaudeRawEntry & { uuid: string }>,
  rootIds: Set<string>
): string | null {
  const visited = new Set<string>();
  let current: (ClaudeRawEntry & { uuid: string }) | undefined = entry;

  while (current) {
    if (rootIds.has(current.uuid)) {
      return current.uuid;
    }
    if (visited.has(current.uuid)) {
      return null;
    }
    visited.add(current.uuid);
    const parentId: string | null | undefined = current.parentUuid;
    current = parentId ? entryById.get(parentId) : undefined;
  }

  return null;
}

function buildPromptMessages(
  rootEntry: ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> },
  group: Array<ClaudeRawEntry & { uuid: string; timestamp: string }>,
  rawOrder: Map<string, number>
): OrderedMessage[] {
  const descendants = group.filter(entry => entry.uuid !== rootEntry.uuid);
  const rootOrder = (rawOrder.get(rootEntry.uuid) ?? 0) * 100;
  const rootMessage: OrderedMessage = {
    _order: rootOrder,
    id: rootEntry.uuid,
    parentId: null,
    role: 'user',
    content: extractDisplayText(rootEntry.message.content),
    timestamp: rootEntry.timestamp,
    logLine: rootEntry._lineNumber,
  };

  const assistantEntries = descendants.filter(
    (entry): entry is ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> } =>
      entry.type === 'assistant' && !!entry.message && entry.message.role === 'assistant'
  );
  if (assistantEntries.length === 0) {
    return [rootMessage];
  }

  const firstAssistant = assistantEntries[0];
  const assistantId = `${rootEntry.uuid}::assistant`;
  const visibleSegments: string[] = [];
  const thinkingSegments: string[] = [];
  const orderedToolCalls: OrderedToolCall[] = [];
  const orderedToolResults = collectOrderedToolResults(descendants, rawOrder);

  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCost = 0;
  let model: string | undefined;
  let hasTokens = false;

  for (const entry of assistantEntries) {
    const message = entry.message;
    if (!message) {
      continue;
    }

    const blocks = normalizeContent(message.content);
    const visibleText = extractVisibleText(blocks);
    const thinkingText = extractThinkingText(blocks);
    appendUniqueSegment(visibleSegments, visibleText);
    appendUniqueSegment(thinkingSegments, thinkingText);

    if (message.model && message.model !== '<synthetic>' && !model) {
      model = message.model;
    }

    if (message.usage) {
      hasTokens = true;
      totalInput += message.usage.input_tokens ?? 0;
      totalOutput += message.usage.output_tokens ?? 0;
      totalCacheRead = Math.max(totalCacheRead, message.usage.cache_read_input_tokens ?? 0);
      totalCacheCreation += message.usage.cache_creation_input_tokens ?? 0;
      totalCost += calculateCost(
        {
          input: message.usage.input_tokens ?? 0,
          output: message.usage.output_tokens ?? 0,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheCreation: message.usage.cache_creation_input_tokens ?? 0,
        },
        message.model ?? model
      );
    }

    const entryOrder = (rawOrder.get(entry.uuid) ?? 0) * 100;
    extractToolCalls(blocks).forEach((toolCall, index) => {
      orderedToolCalls.push({
        call: toolCall,
        order: entryOrder + index + 1,
        timestamp: entry.timestamp,
      });
    });
  }

  const assistantContent =
    visibleSegments.join('\n\n').trim() ||
    thinkingSegments.join('\n\n').trim() ||
    (orderedToolCalls.length > 0
      ? `Performed ${orderedToolCalls.length} tool call${orderedToolCalls.length === 1 ? '' : 's'}.`
      : '');

  const assistantMessage: OrderedMessage = {
    _order: (rawOrder.get(firstAssistant.uuid) ?? 0) * 100,
    id: assistantId,
    parentId: rootEntry.uuid,
    role: 'assistant',
    content: assistantContent,
    timestamp: firstAssistant.timestamp,
    model,
    logLine: firstAssistant._lineNumber,
    tokens: hasTokens
      ? {
          input: totalInput,
          output: totalOutput,
          cacheRead: totalCacheRead,
          cacheCreation: totalCacheCreation,
          cost: totalCost,
        }
      : undefined,
  };

  const toolMessages = buildToolMessages(assistantId, orderedToolCalls, orderedToolResults);

  return [rootMessage, assistantMessage, ...toolMessages];
}

function buildToolMessages(
  assistantId: string,
  orderedToolCalls: OrderedToolCall[],
  orderedToolResults: Map<string, OrderedToolResult>
): OrderedMessage[] {
  const usedResults = new Set<string>();
  const toolMessages: OrderedMessage[] = [];

  for (const occurrence of orderedToolCalls) {
    const result = orderedToolResults.get(occurrence.call.id);
    if (result) {
      usedResults.add(occurrence.call.id);
    }

    toolMessages.push({
      _order: occurrence.order,
      id: `${assistantId}::tool::${occurrence.call.id}`,
      parentId: assistantId,
      role: 'tool',
      content: '',
      timestamp: result?.timestamp ?? occurrence.timestamp,
      toolCalls: [
        {
          ...occurrence.call,
          // Inject agentType into arguments for Agent tool calls
          arguments: (occurrence.call.name === 'Agent' && result?.agentType)
            ? { ...occurrence.call.arguments, agentType: result.agentType }
            : occurrence.call.arguments,
          result: result?.result.content,
        },
      ],
      toolResult: result?.result,
    });
  }

  for (const [toolCallId, result] of orderedToolResults.entries()) {
    if (usedResults.has(toolCallId)) {
      continue;
    }

    toolMessages.push({
      _order: result.order,
      id: `${assistantId}::tool-result::${toolCallId}`,
      parentId: assistantId,
      role: 'tool',
      content: '',
      timestamp: result.timestamp,
      toolResult: result.result,
    });
  }

  return toolMessages;
}

function collectOrderedToolResults(
  descendants: Array<ClaudeRawEntry & { uuid: string; timestamp: string }>,
  rawOrder: Map<string, number>
): Map<string, OrderedToolResult> {
  const resultMap = new Map<string, OrderedToolResult>();

  for (const entry of descendants) {
    if (!isToolResultEntry(entry) || !entry.message) {
      continue;
    }

    const entryOrder = (rawOrder.get(entry.uuid) ?? 0) * 100;
    extractToolResults(normalizeContent(entry.message.content)).forEach((result, index) => {
      if (!resultMap.has(result.toolCallId)) {
        // If toolUseResult.content exists and has text, prefer it over message.content
        const toolUseResult = (entry as ClaudeRawEntry).toolUseResult;
        if (toolUseResult?.content && Array.isArray(toolUseResult.content)) {
          const text = toolUseResult.content
            .filter(b => b.type === 'text' && b.text)
            .map(b => b.text!)
            .join('\n');
          if (text) result.content = text;
        }
        resultMap.set(result.toolCallId, {
          result,
          order: entryOrder + index + 1,
          timestamp: entry.timestamp,
          agentType: toolUseResult?.agentType,
        });
      }
    });
  }

  return resultMap;
}

function buildLocalCommandMessages(
  rootEntry: ClaudeRawEntry & { uuid: string; timestamp: string; message: NonNullable<ClaudeRawEntry['message']> },
  group: Array<ClaudeRawEntry & { uuid: string; timestamp: string }>,
  rawOrder: Map<string, number>
): OrderedMessage[] {
  const commandStarts = group.filter(entry =>
    entry.uuid === rootEntry.uuid || isLocalCommandSystemEntry(entry)
  );
  const messages: OrderedMessage[] = [];

  for (let i = 0; i < commandStarts.length; i++) {
    const start = commandStarts[i];
    const nextStart = commandStarts[i + 1];
    const command = getCommandInfo(start);
    if (!command) {
      continue;
    }

    const outputs = group
      .filter(entry => {
        const currentOrder = rawOrder.get(entry.uuid) ?? -1;
        const startOrder = rawOrder.get(start.uuid) ?? -1;
        const nextOrder = nextStart ? rawOrder.get(nextStart.uuid) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        return currentOrder > startOrder && currentOrder < nextOrder;
      })
      .map(extractCommandOutput)
      .filter((output): output is string => output !== null && output.length > 0);

    const lines = [`/${command.name}${command.args ? ` ${command.args}` : ''}`];
    if (outputs.length > 0) {
      lines.push(...outputs);
    }

    messages.push({
      _order: (rawOrder.get(start.uuid) ?? 0) * 100,
      id: start.uuid,
      parentId: start.uuid === rootEntry.uuid ? null : rootEntry.uuid,
      role: 'system',
      content: lines.join('\n\n').trim(),
      timestamp: start.timestamp,
    });
  }

  return messages;
}

function buildClaudeStats(messages: Message[], entries: ClaudeRawEntry[]): {
  stats: SessionStats;
  toolUsage: ToolUsageSummary[];
  model: string | undefined;
  totalTokens: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCost = 0;
  const inputPerMessage: number[] = [];
  const outputPerMessage: number[] = [];
  const cumulativeTokens: number[] = [];
  let cumulativeTotal = 0;
  let model: string | undefined;

  const toolUsageMap = new Map<string, { count: number; successes: number }>();

  for (const message of messages) {
    if (message.model && message.model !== '<synthetic>' && !model) {
      model = message.model;
    }

    if (message.tokens) {
      totalInputTokens += message.tokens.input;
      totalOutputTokens += message.tokens.output;
      totalCacheRead = Math.max(totalCacheRead, message.tokens.cacheRead || 0);
      totalCacheCreation += message.tokens.cacheCreation || 0;
      totalCost += message.tokens.cost ?? 0;
      inputPerMessage.push(message.tokens.input);
      outputPerMessage.push(message.tokens.output);
      cumulativeTotal += message.tokens.input + message.tokens.output;
      cumulativeTokens.push(cumulativeTotal);
    }

    for (const tool of message.toolCalls ?? []) {
      const existing = toolUsageMap.get(tool.name) || { count: 0, successes: 0 };
      existing.count++;
      if (!message.toolResult || message.toolResult.success) {
        existing.successes++;
      }
      toolUsageMap.set(tool.name, existing);
    }
  }

  const toolUsage: ToolUsageSummary[] = Array.from(toolUsageMap.entries()).map(
    ([name, { count, successes }]) => ({
      name,
      count,
      successRate: count > 0 ? successes / count : 0,
    })
  );

  const userMessages = messages.filter(message => message.role === 'user').length;
  const assistantMessages = messages.filter(message => message.role === 'assistant').length;
  const turnDurations = entries
    .filter((entry): entry is ClaudeRawEntry & { durationMs: number } =>
      entry.type === 'system' && entry.subtype === 'turn_duration' && typeof entry.durationMs === 'number'
    )
    .map(entry => entry.durationMs);
  const totalDuration = turnDurations.reduce((sum, value) => sum + value, 0);

  const stats: SessionStats = {
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    tokens: {
      totalInput: totalInputTokens,
      totalOutput: totalOutputTokens,
      totalCacheRead,
      totalCacheCreation,
      totalCost,
      inputPerMessage,
      outputPerMessage,
      cumulativeTokens,
    },
    tools: toolUsage.map(tool => ({
      name: tool.name,
      count: tool.count,
      successRate: tool.successRate,
    })),
    duration: totalDuration,
    averageTurnDuration:
      turnDurations.length > 0
        ? turnDurations.reduce((sum, value) => sum + value, 0) / turnDurations.length
        : undefined,
  };

  return {
    stats,
    toolUsage,
    model,
    totalTokens: totalInputTokens + totalOutputTokens,
  };
}

// ---------------------------------------------------------------------------
// Subagent loading
// ---------------------------------------------------------------------------

function loadClaudeSubagents(sessionFilePath: string): SubAgent[] {
  const subagentsDir = join(
    dirname(sessionFilePath),
    basename(sessionFilePath, '.jsonl'),
    'subagents'
  );
  if (!existsSync(subagentsDir)) return [];

  const agents: SubAgent[] = [];
  try {
    const files = readdirSync(subagentsDir).filter(file => file.endsWith('.jsonl'));
    for (const file of files) {
      const agent = parseClaudeSubagentFile(join(subagentsDir, file));
      if (agent) agents.push(agent);
    }
  } catch {
    // Skip unreadable directory.
  }
  return agents;
}

function parseClaudeSubagentFile(filePath: string): SubAgent | null {
  try {
    const entries = readClaudeEntries(filePath);
    if (entries.length === 0) return null;

    const fileName = basename(filePath, '.jsonl');
    const agentId = fileName.startsWith('agent-') ? fileName.slice(6) : fileName;
    const agentType = entries.find(entry => entry.attributionAgent)?.attributionAgent ?? 'agent';
    const startTime = entries.find(entry => typeof entry.timestamp === 'string')?.timestamp;
    const endTime = [...entries].reverse().find(entry => typeof entry.timestamp === 'string')?.timestamp;
    if (!startTime || !endTime) return null;

    const promptRoot = findRootEntries(
      entries,
      entries.filter((entry): entry is ClaudeRawEntry & { uuid: string; timestamp: string } =>
        typeof entry.uuid === 'string' && entry.uuid.length > 0 && typeof entry.timestamp === 'string' && entry.timestamp.length > 0
      )
    )[0];

    const prompt = promptRoot?.message ? extractDisplayText(promptRoot.message.content) || undefined : undefined;
    const messages = buildClaudeDisplayMessages(entries);
    const assistantMessages = messages.filter(message => message.role === 'assistant');
    const result = assistantMessages[assistantMessages.length - 1]?.content || undefined;
    const model = assistantMessages.find(message => !!message.model)?.model;
    const totalToolCalls = messages.reduce((sum, message) => sum + (message.toolCalls?.length ?? 0), 0) || undefined;

    let totalInput = 0;
    let totalOutput = 0;
    for (const message of messages) {
      totalInput += message.tokens?.input ?? 0;
      totalOutput += message.tokens?.output ?? 0;
    }
    const totalTokens = totalInput + totalOutput || undefined;
    const durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();

    return {
      id: agentId,
      agentId,
      agentType,
      agentDisplayName: titleCase(agentType),
      status: result ? 'completed' : 'started',
      prompt,
      result,
      model,
      totalTokens,
      totalToolCalls,
      durationMs: durationMs > 0 ? durationMs : undefined,
      startTime,
      endTime,
      messages,
    };
  } catch (error) {
    console.error(`Error parsing Claude subagent file ${filePath}:`, error);
    return null;
  }
}

function titleCase(value: string): string {
  return value.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function isToolResultEntry(entry: ClaudeRawEntry): boolean {
  if (!entry.message) {
    return false;
  }

  return normalizeContent(entry.message.content).some(block => block.type === 'tool_result');
}

function isCommandEntry(entry: ClaudeRawEntry): boolean {
  if (!entry.message) {
    return false;
  }
  return getCommandInfo(entry) !== null;
}

function isLocalCommandSystemEntry(entry: ClaudeRawEntry): boolean {
  return entry.type === 'system' && entry.subtype === 'local_command' && getCommandInfo(entry) !== null;
}

function getCommandInfo(entry: ClaudeRawEntry): CommandInfo | null {
  const text = extractDisplayText(entry.message?.content ?? entry.content ?? '');
  return parseCommandEnvelope(text);
}

function extractCommandOutput(entry: ClaudeRawEntry): string | null {
  const rawText = entry.message ? extractDisplayText(entry.message.content) : stripAnsi(entry.content || '');
  if (!rawText) {
    return null;
  }

  const stdout = parseLocalCommandStdout(rawText);
  if (stdout !== null) {
    return stdout;
  }

  if (parseCommandEnvelope(rawText)) {
    return null;
  }

  if (rawText.includes('<local-command-caveat>')) {
    return null;
  }

  return stripAnsi(rawText).trim() || null;
}

function parseCommandEnvelope(text: string): CommandInfo | null {
  const nameMatch = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/s);
  if (!nameMatch) {
    return null;
  }

  const argsMatch = text.match(/<command-args>\s*([\s\S]*?)\s*<\/command-args>/s);
  return {
    name: stripAnsi(nameMatch[1]).trim().replace(/^\//, ''),
    args: stripAnsi(argsMatch?.[1] || '').trim(),
  };
}

function parseLocalCommandStdout(text: string): string | null {
  const match = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/s);
  if (!match) {
    return null;
  }
  return stripAnsi(match[1]).trim();
}

function appendUniqueSegment(segments: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  if (segments[segments.length - 1] !== trimmed) {
    segments.push(trimmed);
  }
}

function normalizeContent(content: string | ContentBlock[] | undefined): ContentBlock[] {
  if (!content) {
    return [];
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function extractDisplayText(content: string | ContentBlock[] | undefined): string {
  const blocks = normalizeContent(content);
  const visible = extractVisibleText(blocks);
  if (visible) {
    return visible;
  }
  return extractThinkingText(blocks);
}

function extractVisibleText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text' && !!block.text)
    .map(block => stripAnsi(block.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

function extractThinkingText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'thinking' && !!block.thinking)
    .map(block => stripAnsi(block.thinking || '').trim())
    .filter(Boolean)
    .join('\n');
}

function extractToolResults(blocks: ContentBlock[]): ToolResult[] {
  return blocks
    .filter(block => block.type === 'tool_result' && block.tool_use_id)
    .map(block => {
      let content = '';
      if (typeof block.content === 'string') {
        content = block.content;
      } else if (Array.isArray(block.content)) {
        content = (block.content as ContentBlock[])
          .filter(b => b.type === 'text' && b.text)
          .map(b => b.text!)
          .join('\n');
      }
      return {
        toolCallId: block.tool_use_id!,
        success: !block.is_error,
        content,
      };
    });
}

function extractToolCalls(blocks: ContentBlock[]): ToolCall[] {
  return blocks
    .filter(block => block.type === 'tool_use' && block.id && block.name)
    .map(block => ({
      id: block.id!,
      name: block.name!,
      arguments: block.input || {},
    }));
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u0008/g, '').trim();
}

function decodeProjectPath(encodedPath: string): string {
  const folderName = basename(encodedPath);

  let decoded = folderName;
  decoded = decoded.replace(/^([A-Z])--/, '$1:\\');
  decoded = decoded.replace(/-/g, '\\');

  return decoded;
}
