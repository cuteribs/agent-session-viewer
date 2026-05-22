import { readFileSync, readdirSync, existsSync } from 'fs';
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
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

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

function parseDbSession(row: DbSessionRow, messages: Message[]): SessionDetail | null {
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

      if (msg.tokens) {
        const input = msg.tokens.input || 0;
        const output = msg.tokens.output || 0;
        const cacheRead = msg.tokens.cacheRead || 0;
        const cacheCreation = msg.tokens.cacheCreation || 0;

        totalInput += input;
        totalOutput += output;
        totalCacheRead += cacheRead;
        totalCacheCreation += cacheCreation;

        const msgCost = msg.tokens.cost ?? calculateCost(
          { input, output, cacheRead, cacheCreation },
          msg.model ?? model ?? 'unknown'
        );
        totalCost += msgCost;

        inputPerMessage.push(input);
        outputPerMessage.push(output);
        cumulativeTotal += input + output;
        cumulativeTokens.push(cumulativeTotal);
      }
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
    tools: [],
    duration,
  };

  const startTime = messages[0]?.timestamp || new Date(row.time_created).toISOString();
  const lastActivity = messages[messages.length - 1]?.timestamp || startTime;
  const totalTokens = hasTokens ? totalInput + totalOutput : undefined;

  return {
    id: row.id,
    source: 'opencode' as const,
    project: row.directory ? basename(row.directory) : row.project_id,
    projectPath: row.directory || '',
    startTime,
    lastActivity,
    messageCount: messages.length,
    totalTokens,
    model,
    messages,
    stats,
    toolUsage: Array.from(toolUsageMap.entries()).map(([name, { count }]) => ({ name, count, successRate: 1 })),
  };
}

function queryDbSession(db: BetterSqlite3, sessionId: string): SessionDetail | null {
  try {
    const session = db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId) as DbSessionRow | undefined;
    if (!session) return null;

    const model = parseModelString(session.model);

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
          const input = tokens.input || 0;
          const output = tokens.output || 0;
          const cacheRead = tokens.cache?.read || 0;
          const cacheCreation = tokens.cache?.write || 0;
          const msgCost = msgData.cost ?? calculateCost(
            { input, output, cacheRead, cacheCreation },
            msgData.modelID || model || 'unknown'
          );

          messages.push({
            id: msgRow.id,
            parentId: msgData.parentID || null,
            role: 'assistant',
            content: textParts.join('\n'),
            timestamp: new Date(msgData.time?.created || msgRow.time_created).toISOString(),
            model: msgData.modelID || model,
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
            model: msgData.modelID || model,
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

    return parseDbSession(session, messages);
  } catch (error) {
    console.error(`Error querying DB session ${sessionId}:`, error);
    return null;
  }
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
          const input = tokens.input || 0;
          const output = tokens.output || 0;
          const cacheRead = tokens.cache?.read || 0;
          const cacheCreation = tokens.cache?.write || 0;

          totalInput += input;
          totalOutput += output;
          totalCacheRead += cacheRead;
          totalCacheCreation += cacheCreation;

          const msgCost = calculateCost(
            { input, output, cacheRead, cacheCreation },
            msg.modelID ?? model
          );
          totalCost += msgCost;

          inputPerMessage.push(input);
          outputPerMessage.push(output);
          cumulativeTotal += input + output;
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
      project: session.directory ? basename(session.directory) : session.project_id || 'unknown',
      projectPath: session.directory || '',
      startTime,
      lastActivity,
      messageCount: msgs.length,
      totalTokens,
      model,
      messages: msgs,
      stats,
      toolUsage,
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
      project: row.directory ? basename(row.directory) : row.project_id,
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
    const rows = db.prepare('SELECT id FROM session ORDER BY time_created DESC').all() as { id: string }[];
    return rows.map(r => r.id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

function readOpenCodeSession(filePath: string): {
  id: string;
  directory?: string;
  project_id?: string;
  time: { created: number };
} | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as {
      id: string;
      directory?: string;
      project_id?: string;
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
