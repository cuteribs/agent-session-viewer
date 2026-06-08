import { readFileSync, readdirSync, existsSync, statSync, rmSync, unlinkSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
import type {
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolUsageSummary,
  SessionStats,
  SubAgent,
} from '../types/index.js';
import { calculateCost, getPricing } from '../pricing.js';

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const DB_PREFIX = 'db::';

type BetterSqlite3 = ReturnType<typeof import('better-sqlite3')>;

interface DbSessionRow {
  id: string;
  project_id: string;
  title: string | null;
  directory: string | null;
  version: string | null;
  time_created: number;
  time_updated: number;
  model: string | null;
  agent: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  cost: number;
}

interface DbMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface DbPartRow {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

interface MsgData {
  role?: string;
  time?: { created: number; completed?: number };
  modelID?: string;
  providerID?: string;
  parentID?: string;
  tokens?: { input: number; output: number; reason?: number; reasoning?: number; cache?: { read: number; write: number } };
  cost?: number;
  mode?: string;
  agent?: string;
  path?: { cwd: string; root: string };
  finish?: string;
}

interface PartData {
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: Record<string, unknown>;
  tokens?: { input: number; output: number; cache?: { read: number; write: number } };
  reason?: string;
}

function getDb(): BetterSqlite3 | null {
  try {
    if (!existsSync(DB_PATH)) return null;
    const Database = _require('better-sqlite3');
    return new Database(DB_PATH, { readonly: true });
  } catch {
    return null;
  }
}

function parseModelString(model: string | null): string | undefined {
  if (!model) return undefined;
  try {
    const parsed = JSON.parse(model);
    return parsed.id || parsed.model || undefined;
  } catch {
    return model || undefined;
  }
}

function parseDbSession(row: DbSessionRow, messages: Message[], subAgents?: SubAgent[]): SessionDetail | null {
  if (messages.length === 0) return null;

  const toolUsageMap = new Map<string, { count: number }>();
  const inputPerMessage: number[] = [];
  const outputPerMessage: number[] = [];
  const cumulativeTokens: number[] = [];
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCost = 0;
  let cumulativeTotal = 0;
  let model: string | undefined;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (msg.model && !model) {
        model = msg.model;
      }

      // Track tool usage
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const existing = toolUsageMap.get(tc.name) || { count: 0 };
          existing.count++;
          toolUsageMap.set(tc.name, existing);
        }
      }

      if (msg.tokens) {
        const input = msg.tokens.input || 0;
        const output = msg.tokens.output || 0;
        const cacheRead = msg.tokens.cacheRead || 0;
        const cacheCreation = msg.tokens.cacheCreation || 0;
        // Effective input for charts/stats = new uncached tokens + cache-write tokens
        // (cache.write tokens are new context the model processed; cache.read are reused from prior turns)
        const effectiveInput = input + cacheCreation;

        totalInput += effectiveInput;
        totalOutput += output;
        totalCacheRead += cacheRead;
        totalCacheCreation += cacheCreation;

        const msgCost = msg.tokens.cost ?? calculateCost(
          { input, output, cacheRead, cacheCreation },
          msg.model ?? model ?? 'unknown'
        );
        totalCost += msgCost;

        inputPerMessage.push(effectiveInput);
        outputPerMessage.push(output);
        cumulativeTotal += effectiveInput + output;
        cumulativeTokens.push(cumulativeTotal);
      }
    } else if (msg.role === 'system' && msg.subAgentRef && msg.tokens) {
      // Subagent completion summary — count its tokens toward session totals
      const input = msg.tokens.input || 0;
      const output = msg.tokens.output || 0;
      const cacheRead = msg.tokens.cacheRead || 0;
      const cacheCreation = msg.tokens.cacheCreation || 0;
      const effectiveInput = input + cacheCreation;

      totalInput += effectiveInput;
      totalOutput += output;
      totalCacheRead += cacheRead;
      totalCacheCreation += cacheCreation;
      totalCost += msg.tokens.cost || 0;

      inputPerMessage.push(effectiveInput);
      outputPerMessage.push(output);
      cumulativeTotal += effectiveInput + output;
      cumulativeTokens.push(cumulativeTotal);
    }
  }

  const userMessages = messages.filter(m => m.role === 'user').length;
  const assistantMessages = messages.filter(m => m.role === 'assistant').length;

  let duration = 0;
  if (messages.length >= 2) {
    const start = new Date(messages[0].timestamp).getTime();
    const end = new Date(messages[messages.length - 1].timestamp).getTime();
    duration = end - start;
  }

  const hasTokens = inputPerMessage.length > 0;

  const stats: SessionStats = {
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    tokens: hasTokens
      ? {
          totalInput,
          totalOutput,
          totalCacheRead,
          totalCacheCreation,
          totalCost,
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        }
      : undefined,
    tools: Array.from(toolUsageMap.entries()).map(([name, { count }]) => ({ name, count, successRate: 1 })),
    duration,
  };

  const startTime = messages[0]?.timestamp || new Date(row.time_created).toISOString();
  const lastActivity = messages[messages.length - 1]?.timestamp || startTime;
  const totalTokens = hasTokens ? totalInput + totalOutput : undefined;

  return {
    id: row.id,
    source: 'opencode' as const,
    project: row.title || (row.directory ? basename(row.directory) : row.project_id),
    projectPath: row.directory || '',
    startTime,
    lastActivity,
    messageCount: messages.length,
    totalTokens,
    model,
    messages,
    stats,
    toolUsage: Array.from(toolUsageMap.entries()).map(([name, { count }]) => ({ name, count, successRate: 1 })),
    subAgents: subAgents && subAgents.length > 0 ? subAgents : undefined,
  };
}

/** Build Message[] for a given session from the DB. */
function buildDbMessages(db: BetterSqlite3, sessionId: string, defaultModel?: string): Message[] {
  const messageRows = db.prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created').all(sessionId) as DbMessageRow[];
  const messages: Message[] = [];

  for (const msgRow of messageRows) {
    const msgData: MsgData = JSON.parse(msgRow.data);
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    const partRows = db.prepare('SELECT * FROM part WHERE message_id = ? ORDER BY time_created').all(msgRow.id) as DbPartRow[];

    for (const partRow of partRows) {
      const partData: PartData = JSON.parse(partRow.data);
      if (partData.type === 'text' && partData.text) {
        textParts.push(partData.text);
      } else if (partData.type === 'tool' && partData.tool) {
        toolCalls.push({
          id: partData.callID || partRow.id,
          name: partData.tool,
          arguments: partData.state?.input as Record<string, unknown> || {},
        });
      }
    }

    const stepFinish = partRows.map(p => JSON.parse(p.data) as PartData).find(p => p.type === 'step-finish');
    const tokensFromParts = stepFinish?.tokens;
    const hasToolCalls = toolCalls.length > 0;

    if (msgData.role === 'assistant') {
      const tokens = tokensFromParts || msgData.tokens;
      if (tokens) {
        const rawInput = tokens.input || 0;
        const output = tokens.output || 0;
        const cacheRead = tokens.cache?.read || 0;
        const rawCacheCreation = tokens.cache?.write || 0;

        // For GPT-style models (cacheWrite rate = 0), cache-written tokens are billed
        // at the same rate as regular input — merge them so the UI shows the real context size.
        const pricing = getPricing(msgData.modelID || defaultModel);
        const isGptStyle = pricing ? pricing.cacheWrite === 0 : false;
        const input = isGptStyle ? rawInput + rawCacheCreation : rawInput;
        const cacheCreation = isGptStyle ? 0 : rawCacheCreation;

        // DB always stores cost=0; always recalculate
        const msgCost = calculateCost(
          { input, output, cacheRead, cacheCreation },
          msgData.modelID || defaultModel || 'unknown'
        );

        messages.push({
          id: msgRow.id,
          parentId: msgData.parentID || null,
          role: 'assistant',
          content: textParts.join('\n'),
          timestamp: new Date(msgData.time?.created || msgRow.time_created).toISOString(),
          model: msgData.modelID || defaultModel,
          tokens: {
            input,
            output,
            cacheRead: cacheRead || undefined,
            cacheCreation: cacheCreation || undefined,
            cost: msgCost,
          },
          toolCalls: hasToolCalls ? toolCalls : undefined,
        });
      } else {
        messages.push({
          id: msgRow.id,
          parentId: msgData.parentID || null,
          role: 'assistant',
          content: textParts.join('\n'),
          timestamp: new Date(msgData.time?.created || msgRow.time_created).toISOString(),
          model: msgData.modelID || defaultModel,
          toolCalls: hasToolCalls ? toolCalls : undefined,
        });
      }
    } else {
      messages.push({
        id: msgRow.id,
        parentId: msgData.parentID || null,
        role: 'user',
        content: textParts.join('\n'),
        timestamp: new Date(msgData.time?.created || msgRow.time_created).toISOString(),
      });
    }
  }

  return messages;
}

function queryDbSession(db: BetterSqlite3, sessionId: string): SessionDetail | null {
  try {
    const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId) as DbSessionRow | undefined;
    if (!session) return null;

    const model = parseModelString(session.model);

    // Build main session messages
    const mainMessages = buildDbMessages(db, sessionId, model);

    // Query child sessions (subagents spawned by this session)
    const childRows = db.prepare(
      'SELECT * FROM session WHERE parent_id = ? ORDER BY time_created'
    ).all(sessionId) as DbSessionRow[];

    const subAgents: SubAgent[] = [];
    const syntheticMessages: Message[] = [];

    for (const child of childRows) {
      const childModel = parseModelString(child.model);
      const childMessages = buildDbMessages(db, child.id, childModel);

      // Aggregate child session tokens and tools
      let childInput = 0, childOutput = 0, childCacheRead = 0, childCacheCreation = 0;
      let childToolCalls = 0;
      let childEndTime: string | undefined;

      for (const msg of childMessages) {
        if (msg.role === 'assistant' && msg.tokens) {
          childInput += msg.tokens.input || 0;
          childOutput += msg.tokens.output || 0;
          childCacheRead += msg.tokens.cacheRead || 0;
          childCacheCreation += msg.tokens.cacheCreation || 0;
        }
        if (msg.toolCalls) childToolCalls += msg.toolCalls.length;
        if (msg.timestamp > (childEndTime || '')) childEndTime = msg.timestamp;
      }

      const childCost = calculateCost(
        { input: childInput, output: childOutput, cacheRead: childCacheRead, cacheCreation: childCacheCreation },
        childModel || model || 'unknown'
      );
      const childStartTime = new Date(child.time_created).toISOString();
      const childDuration = childEndTime
        ? new Date(childEndTime).getTime() - child.time_created
        : 0;

      const firstUserMsg = childMessages.find(m => m.role === 'user');
      const lastAssistantMsg = [...childMessages].reverse().find(m => m.role === 'assistant');

      subAgents.push({
        id: child.id,
        agentId: child.id,
        agentType: child.agent || 'unknown',
        agentDisplayName: child.title || child.agent || 'SubAgent',
        prompt: firstUserMsg?.content,
        status: 'completed',
        result: lastAssistantMsg?.content,
        model: childModel,
        // Include cacheCreation tokens: they are new context the model processed
        totalTokens: childInput + childOutput + childCacheCreation,
        totalToolCalls: childToolCalls,
        durationMs: childDuration,
        startTime: childStartTime,
        endTime: childEndTime,
        messages: childMessages,
      });

      // Synthetic system message inserted into the main timeline at the subagent's start time
      const effectiveIn = childInput + childCacheCreation; // new tokens (non-cached) the agent consumed
      const label = `[${child.agent || 'subagent'}] ${child.title || 'Subagent task'}`;
      const detail = `in=${effectiveIn.toLocaleString()} out=${childOutput.toLocaleString()} tokens, cost=$${childCost.toFixed(4)}`;
      syntheticMessages.push({
        id: `subagent-summary-${child.id}`,
        parentId: null,
        role: 'system',
        content: `${label} — ${detail}`,
        timestamp: childStartTime,
        subAgentRef: child.id,
        tokens: {
          input: childInput,
          output: childOutput,
          cacheRead: childCacheRead || undefined,
          cacheCreation: childCacheCreation || undefined,
          cost: childCost,
        },
      });
    }

    // Merge main messages with subagent summaries, sorted chronologically
    const allMessages = [...mainMessages, ...syntheticMessages].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    return parseDbSession(session, allMessages, subAgents.length > 0 ? subAgents : undefined);
  } catch (error) {
    console.error(`Error querying DB session ${sessionId}:`, error);
    return null;
  }
}

/** Scan all project dirs under <storageRoot>/session/ for sessions whose parentID matches. */
function findFileChildSessions(
  storageRoot: string,
  parentSessionId: string
): { id: string; directory?: string; agent?: string; title?: string; time: { created: number } }[] {
  const sessionRoot = join(storageRoot, 'session');
  if (!existsSync(sessionRoot)) return [];

  const children: { id: string; directory?: string; agent?: string; title?: string; time: { created: number } }[] = [];
  try {
    for (const projectDir of readdirSync(sessionRoot)) {
      const projectPath = join(sessionRoot, projectDir);
      if (!statSync(projectPath).isDirectory()) continue;
      for (const file of readdirSync(projectPath).filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(readFileSync(join(projectPath, file), 'utf-8'));
          if (data.parentID === parentSessionId) {
            children.push(data);
          }
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* skip unreadable */ }
  return children;
}

function isDbPath(filePath: string): boolean {
  return filePath.startsWith(DB_PREFIX);
}

export function parseOpenCodeSessionFile(filePath: string): SessionDetail | null {
  try {
    if (isDbPath(filePath)) {
      const sessionId = filePath.slice(DB_PREFIX.length);
      const db = getDb();
      if (!db) return null;
      try {
        return queryDbSession(db, sessionId);
      } finally {
        db.close();
      }
    }

    const session = readOpenCodeSession(filePath);
    if (!session) return null;

    const storageRoot = dirname(dirname(dirname(filePath)));
    const sessionId = session.id;

    const messages = loadOpenCodeMessages(storageRoot, sessionId);
    if (messages.length === 0) return null;

    const toolUsageMap = new Map<string, { count: number }>();
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreation = 0;
    let totalCost = 0;
    let cumulativeTotal = 0;
    let model: string | undefined;

    const msgs: Message[] = [];
    for (const msg of messages) {
      const textContent = extractTextFromParts(storageRoot, msg.id);
      const toolCalls = extractToolCallsFromParts(storageRoot, msg.id);
      const stepFinishTokens = extractStepFinishTokens(storageRoot, msg.id);

      if (msg.role === 'assistant') {
        if (msg.modelID && !model) {
          model = msg.modelID;
        }

        const tokens = stepFinishTokens || msg.tokens;
        if (tokens) {
          const rawInput = tokens.input || 0;
          const output = tokens.output || 0;
          const rawCacheRead = tokens.cache?.read || 0;
          const rawCacheCreation = tokens.cache?.write || 0;

          // For GPT-style models, merge cache-write tokens into input
          const pricing = getPricing(msg.modelID ?? model);
          const isGptStyle = pricing ? pricing.cacheWrite === 0 : false;
          const input = isGptStyle ? rawInput + rawCacheCreation : rawInput;
          const cacheRead = rawCacheRead;
          const cacheCreation = isGptStyle ? 0 : rawCacheCreation;

          totalInput += input + cacheCreation; // effective input = new uncached + cache-written
          totalOutput += output;
          totalCacheRead += cacheRead;
          totalCacheCreation += cacheCreation;

          const msgCost = calculateCost(
            { input, output, cacheRead, cacheCreation },
            msg.modelID ?? model
          );
          totalCost += msgCost;

          inputPerMessage.push(input + cacheCreation);
          outputPerMessage.push(output);
          cumulativeTotal += (input + cacheCreation) + output;
          cumulativeTokens.push(cumulativeTotal);

          msgs.push({
            id: msg.id,
            parentId: msg.parentID || null,
            role: 'assistant',
            content: textContent,
            timestamp: new Date(msg.time.created).toISOString(),
            model: msg.modelID,
            tokens: {
              input,
              output,
              cacheRead: cacheRead || undefined,
              cacheCreation: cacheCreation || undefined,
              cost: msgCost,
            },
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        } else {
          msgs.push({
            id: msg.id,
            parentId: msg.parentID || null,
            role: 'assistant',
            content: textContent,
            timestamp: new Date(msg.time.created).toISOString(),
            model: msg.modelID,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        }
      } else {
        msgs.push({
          id: msg.id,
          parentId: msg.parentID || null,
          role: 'user',
          content: textContent,
          timestamp: new Date(msg.time.created).toISOString(),
        });
      }

      for (const tc of toolCalls) {
        const existing = toolUsageMap.get(tc.name) || { count: 0 };
        existing.count++;
        toolUsageMap.set(tc.name, existing);
      }
    }

    // Load child sessions (subagents) from the same storage root
    const childSessions = findFileChildSessions(storageRoot, sessionId);
    const subAgents: SubAgent[] = [];

    for (const child of childSessions) {
      const childMsgsRaw = loadOpenCodeMessages(storageRoot, child.id);
      const childMsgBuilt: Message[] = [];
      let childInput = 0, childOutput = 0, childCacheRead = 0, childCacheCreation = 0;
      let childModel: string | undefined;
      let childToolCalls = 0;
      let childEndTime: string | undefined;

      for (const cmsg of childMsgsRaw) {
        const textContent = extractTextFromParts(storageRoot, cmsg.id);
        const ctoolCalls = extractToolCallsFromParts(storageRoot, cmsg.id);
          const cstepTokens = extractStepFinishTokens(storageRoot, cmsg.id);
          if (cmsg.modelID && !childModel) childModel = cmsg.modelID;

          if (cmsg.role === 'assistant') {
            const tokens = cstepTokens || cmsg.tokens;
            if (tokens) {
              const rawInp = tokens.input || 0;
              const out = tokens.output || 0;
              const cr = tokens.cache?.read || 0;
              const rawCw = tokens.cache?.write || 0;

              const cPricing = getPricing(cmsg.modelID ?? childModel);
              const cIsGpt = cPricing ? cPricing.cacheWrite === 0 : false;
              const inp = cIsGpt ? rawInp + rawCw : rawInp;
              const cw = cIsGpt ? 0 : rawCw;

              const cost = calculateCost({ input: inp, output: out, cacheRead: cr, cacheCreation: cw }, cmsg.modelID ?? childModel);
            childInput += inp; childOutput += out;
            childCacheRead += cr; childCacheCreation += cw;
            childMsgBuilt.push({
              id: cmsg.id, parentId: cmsg.parentID || null, role: 'assistant',
              content: textContent, timestamp: new Date(cmsg.time.created).toISOString(),
              model: cmsg.modelID,
              tokens: { input: inp, output: out, cacheRead: cr || undefined, cacheCreation: cw || undefined, cost },
              toolCalls: ctoolCalls.length > 0 ? ctoolCalls : undefined,
            });
          } else {
            childMsgBuilt.push({
              id: cmsg.id, parentId: cmsg.parentID || null, role: 'assistant',
              content: textContent, timestamp: new Date(cmsg.time.created).toISOString(),
              model: cmsg.modelID, toolCalls: ctoolCalls.length > 0 ? ctoolCalls : undefined,
            });
          }
        } else {
          childMsgBuilt.push({
            id: cmsg.id, parentId: cmsg.parentID || null, role: 'user',
            content: textContent, timestamp: new Date(cmsg.time.created).toISOString(),
          });
        }
        if (ctoolCalls.length > 0) childToolCalls += ctoolCalls.length;
        const ts = new Date(cmsg.time.created).toISOString();
        if (!childEndTime || ts > childEndTime) childEndTime = ts;
      }

      const childCost = calculateCost(
        { input: childInput, output: childOutput, cacheRead: childCacheRead, cacheCreation: childCacheCreation },
        childModel || model || 'unknown'
      );
      const childStartTime = new Date(child.time.created).toISOString();
      const firstUserMsg = childMsgBuilt.find(m => m.role === 'user');
      const lastAssistantMsg = [...childMsgBuilt].reverse().find(m => m.role === 'assistant');

      subAgents.push({
        id: child.id, agentId: child.id,
        agentType: child.agent || 'unknown',
        agentDisplayName: child.title || child.agent || 'SubAgent',
        prompt: firstUserMsg?.content, status: 'completed',
        result: lastAssistantMsg?.content, model: childModel,
        totalTokens: childInput + childOutput + childCacheCreation,
        totalToolCalls: childToolCalls,
        durationMs: childEndTime ? new Date(childEndTime).getTime() - child.time.created : 0,
        startTime: childStartTime, endTime: childEndTime,
        messages: childMsgBuilt,
      });

      // Synthetic system message for main timeline + accumulate totals
      const effectiveIn = childInput + childCacheCreation;
      const label = `[${child.agent || 'subagent'}] ${child.title || 'Subagent task'}`;
      const detail = `in=${effectiveIn.toLocaleString()} out=${childOutput.toLocaleString()} tokens, cost=$${childCost.toFixed(4)}`;
      msgs.push({
        id: `subagent-summary-${child.id}`, parentId: null, role: 'system',
        content: `${label} — ${detail}`, timestamp: childStartTime,
        subAgentRef: child.id,
        tokens: { input: childInput, output: childOutput,
          cacheRead: childCacheRead || undefined, cacheCreation: childCacheCreation || undefined, cost: childCost },
      });

      // Accumulate into session totals (effectiveIn = new uncached + cache-written)
      const childEffectiveIn = childInput + childCacheCreation;
      totalInput += childEffectiveIn; totalOutput += childOutput;
      totalCacheRead += childCacheRead; totalCacheCreation += childCacheCreation;
      totalCost += childCost;
      inputPerMessage.push(childEffectiveIn); outputPerMessage.push(childOutput);
      cumulativeTotal += childEffectiveIn + childOutput;
      cumulativeTokens.push(cumulativeTotal);
    }

    // Sort messages chronologically (subagent summaries may be out of order)
    msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const toolUsage: ToolUsageSummary[] = Array.from(toolUsageMap.entries()).map(
      ([name, { count }]) => ({
        name,
        count,
        successRate: 1,
      })
    );

    const userMessages = msgs.filter(m => m.role === 'user').length;
    const assistantMessages = msgs.filter(m => m.role === 'assistant').length;

    let duration = 0;
    if (msgs.length >= 2) {
      const start = new Date(msgs[0].timestamp).getTime();
      const end = new Date(msgs[msgs.length - 1].timestamp).getTime();
      duration = end - start;
    }

    const hasTokens = inputPerMessage.length > 0;

    const stats: SessionStats = {
      messageCount: msgs.length,
      userMessages,
      assistantMessages,
      tokens: hasTokens
        ? {
            totalInput,
            totalOutput,
            totalCacheRead,
            totalCacheCreation,
            totalCost,
            inputPerMessage,
            outputPerMessage,
            cumulativeTokens,
          }
        : undefined,
      tools: toolUsage.map(t => ({ name: t.name, count: t.count, successRate: t.successRate })),
      duration,
    };

    const startTime = msgs[0]?.timestamp || new Date(session.time.created).toISOString();
    const lastActivity = msgs[msgs.length - 1]?.timestamp || startTime;
    const totalTokens = hasTokens ? totalInput + totalOutput : undefined;

    return {
      id: sessionId,
      source: 'opencode',
      project: session.title || (session.directory ? basename(session.directory) : session.project_id || 'unknown'),
      projectPath: session.directory || '',
      startTime,
      lastActivity,
      messageCount: msgs.length,
      totalTokens,
      model,
      messages: msgs,
      stats,
      toolUsage,
      subAgents: subAgents.length > 0 ? subAgents : undefined,
    };
  } catch (error) {
    console.error(`Error parsing OpenCode session file ${filePath}:`, error);
    return null;
  }
}

export function getOpenCodeSessionSummary(detail: SessionDetail): SessionSummary {
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

export function getOpenCodeDbSessionSummary(sessionId: string): SessionSummary | null {
  const db = getDb();
  if (!db) return null;
  try {
    const row = db.prepare('SELECT id, directory, title, time_created, time_updated, model, tokens_input, tokens_output FROM session WHERE id = ?').get(sessionId) as DbSessionRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      source: 'opencode' as const,
      project: row.title || (row.directory ? basename(row.directory) : row.project_id),
      projectPath: row.directory || '',
      startTime: new Date(row.time_created).toISOString(),
      lastActivity: new Date(row.time_updated).toISOString(),
      messageCount: 0,
      totalTokens: row.tokens_input + row.tokens_output || undefined,
      model: parseModelString(row.model),
    };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function listOpenCodeDbSessionIds(): string[] {
  const db = getDb();
  if (!db) return [];
  try {
    // Only list root sessions (parent_id IS NULL) — child sessions are subagents embedded in their parent
    const rows = db.prepare('SELECT id FROM session WHERE parent_id IS NULL ORDER BY time_created DESC').all() as { id: string }[];
    return rows.map(r => r.id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * Delete an OpenCode session.
 * - DB mode (`db::<sessionId>`): DELETE the session row (CASCADE removes messages/parts/children).
 * - File mode (a `.json` path): delete the JSON file and its message/part storage directories.
 * Returns true on success, false if not found.
 */
export function deleteOpenCodeSession(filePath: string): boolean {
  if (isDbPath(filePath)) {
    const sessionId = filePath.slice(DB_PREFIX.length);
    const db = getDb();
    if (!db) return false;
    try {
      const result = db.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
      return result.changes > 0;
    } catch (err) {
      console.error(`Error deleting OpenCode DB session ${sessionId}:`, err);
      return false;
    } finally {
      db.close();
    }
  }

  // File mode: delete session JSON + message/<sessionId>/ + part dirs for each message
  try {
    const session = readOpenCodeSession(filePath);
    if (session) {
      const storageRoot = dirname(dirname(dirname(filePath)));
      const messageDir = join(storageRoot, 'message', session.id);
      if (existsSync(messageDir)) {
        // Delete part dirs for each message first
        try {
          for (const msgFile of readdirSync(messageDir).filter(f => f.endsWith('.json'))) {
            const msgId = basename(msgFile, '.json');
            const partDir = join(storageRoot, 'part', msgId);
            if (existsSync(partDir)) rmSync(partDir, { recursive: true, force: true });
          }
        } catch { /* best-effort */ }
        rmSync(messageDir, { recursive: true, force: true });
      }
    }
    unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error(`Error deleting OpenCode session file ${filePath}:`, err);
    return false;
  }
}

function readOpenCodeSession(filePath: string): {
  id: string;
  directory?: string;
  project_id?: string;
  title?: string;
  time: { created: number };
} | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as {
      id: string;
      directory?: string;
      project_id?: string;
      title?: string;
      time: { created: number };
    };
  } catch {
    return null;
  }
}

function loadOpenCodeMessages(storageRoot: string, sessionId: string): {
  id: string;
  parentID?: string;
  role: string;
  modelID?: string;
  tokens?: { input: number; output: number; cache?: { read: number; write: number } };
  time: { created: number };
}[] {
  const messageDir = join(storageRoot, 'message', sessionId);
  if (!existsSync(messageDir)) return [];

  try {
    const files = readdirSync(messageDir).filter(f => f.endsWith('.json'));
    const messages: {
      id: string;
      parentID?: string;
      role: string;
      modelID?: string;
      tokens?: { input: number; output: number; cache?: { read: number; write: number } };
      time: { created: number };
    }[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(messageDir, file), 'utf-8');
        const msg = JSON.parse(content) as {
          id: string;
          parentID?: string;
          role: string;
          modelID?: string;
          tokens?: { input: number; output: number; cache?: { read: number; write: number } };
          time: { created: number };
        };
        messages.push(msg);
      } catch {
        continue;
      }
    }

    messages.sort((a, b) => a.time.created - b.time.created);
    return messages;
  } catch {
    return [];
  }
}

function loadOpenCodeParts(storageRoot: string, messageId: string): {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: Record<string, unknown>;
  tokens?: { input: number; output: number; cache?: { read: number; write: number } };
}[] {
  const partDir = join(storageRoot, 'part', messageId);
  if (!existsSync(partDir)) return [];

  try {
    const files = readdirSync(partDir).filter(f => f.endsWith('.json'));
    const parts: {
      id: string;
      type: string;
      text?: string;
      tool?: string;
      callID?: string;
      state?: Record<string, unknown>;
      tokens?: { input: number; output: number; cache?: { read: number; write: number } };
    }[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(partDir, file), 'utf-8');
        const part = JSON.parse(content) as {
          id: string;
          type: string;
          text?: string;
          tool?: string;
          callID?: string;
          state?: Record<string, unknown>;
          tokens?: { input: number; output: number; cache?: { read: number; write: number } };
        };
        parts.push(part);
      } catch {
        continue;
      }
    }

    return parts;
  } catch {
    return [];
  }
}

function extractTextFromParts(storageRoot: string, messageId: string): string {
  const parts = loadOpenCodeParts(storageRoot, messageId);
  return parts
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join('\n');
}

function extractToolCallsFromParts(storageRoot: string, messageId: string): ToolCall[] {
  const parts = loadOpenCodeParts(storageRoot, messageId);
  const toolCalls: ToolCall[] = [];
  for (const part of parts) {
    if (part.type === 'tool' && part.tool && part.state) {
      const args = part.state.input || {};
      toolCalls.push({
        id: part.callID || part.id,
        name: part.tool,
        arguments: typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : { value: args },
      });
    }
  }
  return toolCalls;
}

function extractStepFinishTokens(
  storageRoot: string,
  messageId: string
): { input: number; output: number; cache?: { read: number; write: number } } | null {
  const parts = loadOpenCodeParts(storageRoot, messageId);
  const stepFinish = parts.find(p => p.type === 'step-finish');
  if (stepFinish?.tokens) {
    return {
      input: stepFinish.tokens.input,
      output: stepFinish.tokens.output,
      cache: stepFinish.tokens.cache,
    };
  }
  return null;
}
