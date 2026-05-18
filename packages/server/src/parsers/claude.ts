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
  SessionStats,
  ToolUsageSummary,
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

export function parseClaudeSessionFile(filePath: string): SessionDetail | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return null;
    }

    const entries: ClaudeCodeEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    if (entries.length === 0) {
      return null;
    }

    // Extract session info from first entry
    const firstEntry = entries[0];
    const sessionId = firstEntry.sessionId || basename(filePath, '.jsonl');
    const projectPath = decodeProjectPath(dirname(filePath));
    const project = basename(projectPath);

    // Parse messages
    const messages: Message[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalCost = 0;
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let cumulativeTotal = 0;
    const toolUsageMap = new Map<string, { count: number; successes: number }>();
    let totalDuration = 0;
    const turnDurations: number[] = [];
    let model: string | undefined;

    for (const entry of entries) {
      if (entry.type === 'system' && entry.subtype === 'turn_duration') {
        if (entry.durationMs) {
          turnDurations.push(entry.durationMs);
          totalDuration += entry.durationMs;
        }
        continue;
      }

      if (entry.type === 'file-history-snapshot') {
        continue;
      }

      if (!entry.message) {
        continue;
      }

      const { message } = entry;
      const contentBlocks = normalizeContent(message.content);
      const textContent = extractTextContent(contentBlocks);
      const toolCalls = extractToolCalls(contentBlocks);

      // Track model
      if (message.model && !model) {
        model = message.model;
      }

      // Track token usage
      const tokens = message.usage
        ? {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
            cacheRead: message.usage.cache_read_input_tokens,
            cacheCreation: message.usage.cache_creation_input_tokens,
            cost: calculateCost(
              {
                input: message.usage.input_tokens,
                output: message.usage.output_tokens,
                cacheRead: message.usage.cache_read_input_tokens,
                cacheCreation: message.usage.cache_creation_input_tokens,
              },
              message.model ?? model
            ),
          }
        : undefined;

      if (tokens) {
        totalInputTokens += tokens.input;
        totalOutputTokens += tokens.output;
        // cache_read_input_tokens is already an accumulated value per call (it reflects
        // the full context served from cache for that call, growing as the conversation
        // grows). Track the peak rather than summing to avoid inflating the session total.
        totalCacheRead = Math.max(totalCacheRead, tokens.cacheRead || 0);
        totalCacheCreation += tokens.cacheCreation || 0;
        totalCost += tokens.cost ?? 0;
        inputPerMessage.push(tokens.input);
        outputPerMessage.push(tokens.output);
        cumulativeTotal += tokens.input + tokens.output;
        cumulativeTokens.push(cumulativeTotal);
      }

      // Track tool usage
      for (const tool of toolCalls) {
        const existing = toolUsageMap.get(tool.name) || { count: 0, successes: 0 };
        existing.count++;
        existing.successes++; // Claude doesn't track success directly in entries
        toolUsageMap.set(tool.name, existing);
      }

      messages.push({
        id: entry.uuid,
        parentId: entry.parentUuid,
        role: message.role,
        content: textContent,
        timestamp: entry.timestamp,
        model: message.model,
        tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });
    }

    // Build tool usage summary
    const toolUsage: ToolUsageSummary[] = Array.from(toolUsageMap.entries()).map(
      ([name, { count, successes }]) => ({
        name,
        count,
        successRate: count > 0 ? successes / count : 0,
      })
    );

    // Calculate stats
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;

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
      tools: toolUsage.map(t => ({
        name: t.name,
        count: t.count,
        successRate: t.successRate,
      })),
      duration: totalDuration,
      averageTurnDuration:
        turnDurations.length > 0
          ? turnDurations.reduce((a, b) => a + b, 0) / turnDurations.length
          : undefined,
    };

    const startTime = messages[0]?.timestamp || new Date().toISOString();
    const lastActivity = messages[messages.length - 1]?.timestamp || startTime;

    // Load subagents from sibling subagents/ directory
    const subAgents = loadClaudeSubagents(filePath);

    return {
      id: sessionId,
      source: 'claude',
      project,
      projectPath,
      startTime,
      lastActivity,
      messageCount: messages.length,
      totalTokens: totalInputTokens + totalOutputTokens,
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
    const files = readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const agent = parseClaudeSubagentFile(join(subagentsDir, file));
      if (agent) agents.push(agent);
    }
  } catch {
    // Skip unreadable directory
  }
  return agents;
}

function parseClaudeSubagentFile(filePath: string): SubAgent | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const entries: ClaudeCodeEntry[] = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch { continue; }
    }
    if (entries.length === 0) return null;

    // agentId comes from the filename (strip "agent-" prefix)
    const fileName = basename(filePath, '.jsonl');
    const agentId = fileName.startsWith('agent-') ? fileName.slice(6) : fileName;

    // Agent type from attributionAgent field on any entry
    const agentType = entries.find(e => e.attributionAgent)?.attributionAgent ?? 'agent';

    // Model from first assistant message
    const model = entries.find(e => e.type === 'assistant' && e.message?.model)?.message?.model;

    // Prompt = text content of the first user message
    let prompt: string | undefined;
    const firstUser = entries.find(e => e.type === 'user' && e.message?.content);
    if (firstUser?.message?.content) {
      const blocks = normalizeContent(firstUser.message.content);
      prompt = extractTextContent(blocks) || undefined;
    }

    // Result = text content of the last assistant message
    let result: string | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === 'assistant' && entry.message?.content) {
        const blocks = normalizeContent(entry.message.content);
        const text = extractTextContent(blocks);
        if (text) { result = text; break; }
      }
    }

    // Tool call count
    let totalToolCalls = 0;
    for (const entry of entries) {
      if (entry.type === 'assistant' && entry.message?.content) {
        totalToolCalls += normalizeContent(entry.message.content).filter(b => b.type === 'tool_use').length;
      }
    }

    // Token totals
    let totalInput = 0, totalOutput = 0;
    for (const entry of entries) {
      const u = entry.message?.usage;
      if (u) {
        totalInput += u.input_tokens ?? 0;
        totalOutput += u.output_tokens ?? 0;
      }
    }
    const totalTokens = totalInput + totalOutput || undefined;

    const startTime = entries[0].timestamp;
    const endTime = entries[entries.length - 1].timestamp;
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
      totalToolCalls: totalToolCalls || undefined,
      durationMs: durationMs > 0 ? durationMs : undefined,
      startTime,
      endTime,
    };
  } catch (error) {
    console.error(`Error parsing Claude subagent file ${filePath}:`, error);
    return null;
  }
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content;
}

function extractTextContent(blocks: ContentBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('\n');
}

function extractToolCalls(blocks: ContentBlock[]): ToolCall[] {
  return blocks
    .filter(b => b.type === 'tool_use' && b.id && b.name)
    .map(b => ({
      id: b.id!,
      name: b.name!,
      arguments: b.input || {},
    }));
}

function decodeProjectPath(encodedPath: string): string {
  // The folder names are URL-encoded paths like "E--git-MyProject"
  // We need to decode them back to "E:\git\MyProject" (on Windows)
  const folderName = basename(encodedPath);

  // Replace -- with : for drive letters, - with path separators
  // This is a simplified decode - actual encoding may vary
  let decoded = folderName;

  // Handle Windows drive letter encoding (e.g., "E--" -> "E:\")
  decoded = decoded.replace(/^([A-Z])--/, '$1:\\');

  // Replace remaining single dashes with path separator
  decoded = decoded.replace(/-/g, '\\');

  return decoded;
}
