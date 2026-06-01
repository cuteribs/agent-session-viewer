import { readFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import type {
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolUsageSummary,
  SessionStats,
} from '../types/index.js';

// ── JSONL format types ──────────────────────────────────
interface JsonlEvent {
  kind: 0 | 1 | 2;
  v?: unknown;
  k?: (string | number)[];
}

// ── Reconstructed session state ─────────────────────────
interface VSCodeRequest {
  requestId: string;
  timestamp: number;
  message?: { text?: string; parts?: { text?: string }[] };
  response?: VSCodeResponsePart[];
  result?: VSCodeResult;
  completionTokens?: number;
  elapsedMs?: number;
}

interface VSCodeResponsePart {
  value?: string;
  kind?: string;
  toolName?: string;
  toolId?: string;
  invocationMessage?: string;
  pastTenseMessage?: string;
  isComplete?: boolean;
  isConfirmed?: boolean;
  toolCallId?: string;
  resultText?: string;
}

interface VSCodeResult {
  timings?: { firstProgress?: number; totalElapsed?: number };
  metadata?: Record<string, unknown>;
}

interface VSCodeState {
  version?: number;
  creationDate?: number;
  sessionId?: string;
  responderUsername?: string;
  inputState?: {
    selectedModel?: VSCodeModel;
    mode?: { id?: string; kind?: string };
  };
  requests?: VSCodeRequest[];
}

interface VSCodeModel {
  identifier?: string;
  metadata?: {
    id?: string;
    vendor?: string;
    name?: string;
    family?: string;
    version?: string;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  };
}

// ── .json format type ──────────────────────────────────
interface VSCodeJsonSession {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  lastMessageDate?: number;
  customTitle?: string;
  requesterUsername?: string;
  requests?: VSCodeJsonRequest[];
}

interface VSCodeJsonRequest {
  requestId?: string;
  timestamp?: number;
  message?: { text?: string; parts?: { text?: string }[] };
  response?: (VSCodeJsonResponsePart | undefined | null)[];
  responseId?: string;
  result?: { timings?: { firstProgress?: number; totalElapsed?: number } };
  isCanceled?: boolean;
}

interface VSCodeJsonResponsePart {
  value?: string;
  kind?: string;
  toolName?: string;
  toolId?: string;
  invocationMessage?: string;
  pastTenseMessage?: string;
  isComplete?: boolean;
  isConfirmed?: boolean;
  toolCallId?: string;
  source?: { type?: string; label?: string };
}

// ════════════════════════════════════════════════════════
// JSONL format parser
// ════════════════════════════════════════════════════════

function parseJsonlLines(lines: string[]): VSCodeState {
  let state: VSCodeState = { requests: [] };

  for (const line of lines) {
    try {
      const evt: JsonlEvent = JSON.parse(line);
      if (evt.kind === 0) {
        state = evt.v as VSCodeState;
        if (!state.requests) state.requests = [];
      } else if (evt.kind === 1 && evt.k) {
        setPath(state, evt.k, evt.v);
      } else if (evt.kind === 2 && evt.k) {
        pushPath(state, evt.k, evt.v);
      }
    } catch {
      // skip malformed lines
    }
  }

  return state;
}

function setPath(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = String(path[i]);
    const next = path[i + 1];
    if (typeof next === 'number') {
      if (!current[key] || !Array.isArray(current[key])) {
        current[key] = [];
      }
    } else {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
    }
    current = current[key] as Record<string, unknown>;
  }
  const lastKey = String(path[path.length - 1]);
  current[lastKey] = value;
}

function pushPath(obj: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length; i++) {
    const key = String(path[i]);
    if (i === path.length - 1) {
      if (!current[key] || !Array.isArray(current[key])) {
        current[key] = [];
      }
      const arr = current[key] as unknown[];
      // kind=2 values are always wrapped in a single-element array; spread them
      if (Array.isArray(value)) {
        for (const item of value) {
          arr.push(item);
        }
      } else {
        arr.push(value);
      }
    } else {
      const next = path[i + 1];
      if (typeof next === 'number') {
        if (!current[key] || !Array.isArray(current[key])) {
          current[key] = [];
        }
      } else {
        if (!current[key] || typeof current[key] !== 'object') {
          current[key] = {};
        }
      }
      current = current[key] as Record<string, unknown>;
    }
  }
}

// ════════════════════════════════════════════════════════
// Common: build messages from requests[]
// ════════════════════════════════════════════════════════

interface ParsedRequest {
  requestId: string;
  timestamp: number;
  userText: string;
  responseParts: VSCodeResponsePart[];
  completionTokens?: number;
  elapsedMs?: number;
}

function extractRequestsJsonl(state: VSCodeState): ParsedRequest[] {
  const result: ParsedRequest[] = [];
  if (!state.requests) return result;

  for (const req of state.requests) {
    const userText = req.message?.text || req.message?.parts?.map(p => p.text || '').join('\n') || '';
    const parts: VSCodeResponsePart[] = [];
    if (req.response) {
      for (const p of req.response) {
        if (p) parts.push(p);
      }
    }

    result.push({
      requestId: req.requestId || '',
      timestamp: req.timestamp || 0,
      userText,
      responseParts: parts,
      completionTokens: req.completionTokens,
      elapsedMs: req.elapsedMs,
    });
  }

  return result;
}

function extractRequestsJson(session: VSCodeJsonSession): ParsedRequest[] {
  const result: ParsedRequest[] = [];
  if (!session.requests) return result;

  for (const req of session.requests) {
    if (req.isCanceled) continue;

    const userText = req.message?.text || req.message?.parts?.map(p => p.text || '').join('\n') || '';
    const parts: VSCodeResponsePart[] = [];
    if (req.response) {
      for (const p of req.response) {
        if (p) {
          parts.push({
            value: p.value,
            kind: p.kind,
            toolName: p.toolName,
            toolId: p.toolId,
            invocationMessage: p.invocationMessage,
            pastTenseMessage: p.pastTenseMessage,
            isComplete: p.isComplete,
            isConfirmed: p.isConfirmed,
            toolCallId: p.toolCallId,
          });
        }
      }
    }

    result.push({
      requestId: req.requestId || '',
      timestamp: req.timestamp || 0,
      userText,
      responseParts: parts,
    });
  }

  return result;
}

// ════════════════════════════════════════════════════════
// Build SessionDetail
// ════════════════════════════════════════════════════════

function buildSession(
  parsedRequests: ParsedRequest[],
  sessionId: string,
  sourcePath: string,
  modelName: string | undefined,
  creationDate?: number,
): SessionDetail | null {
  if (parsedRequests.length === 0) return null;

  const messages: Message[] = [];
  const toolUsageMap = new Map<string, { count: number }>();
  const inputPerMessage: number[] = [];
  const outputPerMessage: number[] = [];
  const cumulativeTokens: number[] = [];
  let totalOutput = 0;
  let cumulativeTotal = 0;

  for (const req of parsedRequests) {
    if (!req.userText && !req.responseParts.length) continue;

    // User message
    if (req.userText) {
      const ts = new Date(req.timestamp).toISOString();
      messages.push({
        id: req.requestId ? `user-${req.requestId}` : `user-${Date.now()}-${Math.random()}`,
        parentId: null,
        role: 'user',
        content: req.userText,
        timestamp: ts,
      });
    }

    // Assistant response
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const part of req.responseParts) {
      if (part.kind === 'toolInvocationSerialized') {
        const name = part.toolId || part.toolName || 'unknown';
        toolCalls.push({
          id: part.toolCallId || `${name}-${toolCalls.length}`,
          name,
          arguments: {},
        });

        const existing = toolUsageMap.get(name) || { count: 0 };
        existing.count++;
        toolUsageMap.set(name, existing);
      } else if (part.value) {
        textParts.push(part.value);
      }
    }

    const outputTokens = req.completionTokens ?? 0;
    if (outputTokens > 0) {
      totalOutput += outputTokens;
      outputPerMessage.push(outputTokens);
      inputPerMessage.push(0);
      cumulativeTotal += outputTokens;
      cumulativeTokens.push(cumulativeTotal);
    }

    const content = textParts.join('\n').trim();
    if (content || toolCalls.length > 0) {
      const ts = new Date(req.timestamp + 100).toISOString();
      const msg: Message = {
        id: req.requestId ? `asst-${req.requestId}` : `asst-${Date.now()}-${Math.random()}`,
        parentId: req.requestId ? `user-${req.requestId}` : null,
        role: 'assistant',
        content,
        timestamp: ts,
        model: modelName,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      if (outputTokens > 0) {
        msg.tokens = {
          input: 0,
          output: outputTokens,
          cost: 0,
        };
      }

      messages.push(msg);
    }
  }

  // Sort chronologically
  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const userMsgs = messages.filter(m => m.role === 'user').length;
  const asstMsgs = messages.filter(m => m.role === 'assistant').length;

  let duration = 0;
  if (messages.length >= 2) {
    const start = new Date(messages[0].timestamp).getTime();
    const end = new Date(messages[messages.length - 1].timestamp).getTime();
    duration = end - start;
  }

  const hasTokens = outputPerMessage.length > 0;

  const stats: SessionStats = {
    messageCount: messages.length,
    userMessages: userMsgs,
    assistantMessages: asstMsgs,
    tokens: hasTokens
      ? {
          totalInput: 0,
          totalOutput,
          totalCacheRead: 0,
          totalCacheCreation: 0,
          totalCost: 0,
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        }
      : undefined,
    tools: Array.from(toolUsageMap.entries()).map(([name, { count }]) => ({
      name, count, successRate: 1,
    })),
    duration,
  };

  const startTime = messages[0]?.timestamp || new Date(creationDate || Date.now()).toISOString();
  const lastActivity = messages[messages.length - 1]?.timestamp || startTime;
  const totalTokens = hasTokens ? totalOutput : undefined;

  // Read workspace.json to get the actual project folder path
  let projectName = 'Unknown';
  const wsDir = dirname(dirname(sourcePath));
  const workspaceJsonPath = join(wsDir, 'workspace.json');
  if (existsSync(workspaceJsonPath)) {
    try {
      const wsData = JSON.parse(readFileSync(workspaceJsonPath, 'utf-8'));
      if (wsData.folder) {
        const urlStr = wsData.folder as string;
        const decoded = decodeURIComponent(urlStr.replace('file:///', '').replace(/\\/g, '/'));
        projectName = basename(decoded);
      }
    } catch {
      // fall back to path-based name
    }
  }
  if (projectName === 'Unknown') {
    const dirParts = sourcePath.replace(/\\/g, '/').split('/');
    const wsIdx = dirParts.findIndex(d => d === 'workspaceStorage');
    if (wsIdx >= 0 && dirParts[wsIdx + 1]) {
      projectName = dirParts[wsIdx + 1];
    }
  }

  return {
    id: sessionId,
    source: 'vscode',
    project: projectName,
    projectPath: sourcePath,
    startTime,
    lastActivity,
    messageCount: messages.length,
    totalTokens,
    model: modelName,
    messages,
    stats,
    toolUsage: Array.from(toolUsageMap.entries()).map(([name, { count }]) => ({
      name, count, successRate: 1,
    })),
  };
}

// ════════════════════════════════════════════════════════
// Extract model name from VSCode state
// ════════════════════════════════════════════════════════

function extractModel(state: VSCodeState): string | undefined {
  const model = state.inputState?.selectedModel;
  if (!model) return undefined;
  return model.metadata?.name || model.metadata?.id || model.identifier;
}

function extractModelJson(model: VSCodeModel | undefined): string | undefined {
  if (!model) return undefined;
  return model.metadata?.name || model.metadata?.id || model.identifier;
}

// ════════════════════════════════════════════════════════
// Main parse functions
// ════════════════════════════════════════════════════════

export function parseVSCodeSessionFile(filePath: string): SessionDetail | null {
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;

    // Detect format: JSONL starts with '{"kind":', JSON starts with '{'
    if (content.startsWith('{"kind":')) {
      return parseVSCodeJsonl(content, filePath);
    } else {
      return parseVSCodeJson(content, filePath);
    }
  } catch (error) {
    console.error(`Error parsing VSCode session file ${filePath}:`, error);
    return null;
  }
}

function parseVSCodeJsonl(content: string, filePath: string): SessionDetail | null {
  const lines = content.split('\n').filter(l => l.trim());
  const state = parseJsonlLines(lines);

  const sessionId = state.sessionId || basename(filePath).replace(/\.jsonl$/, '');
  const model = extractModel(state);
  const parsedRequests = extractRequestsJsonl(state);

  return buildSession(parsedRequests, sessionId, filePath, model, state.creationDate);
}

function parseVSCodeJson(content: string, filePath: string): SessionDetail | null {
  let session: VSCodeJsonSession;
  try {
    session = JSON.parse(content) as VSCodeJsonSession;
  } catch {
    return null;
  }

  const sessionId = session.sessionId || basename(filePath).replace(/\.json$/, '');
  const model = extractModelJson(
    // JSON format doesn't have inputState.selectedModel; extract from request metadata if available
    undefined,
  );

  const parsedRequests = extractRequestsJson(session);

  let result = buildSession(parsedRequests, sessionId, filePath, model, session.creationDate);
  if (result && session.customTitle) {
    result.project = session.customTitle;
  }
  return result;
}

// ════════════════════════════════════════════════════════
// Summary extraction
// ════════════════════════════════════════════════════════

export function getVSCodeSessionSummary(detail: SessionDetail): SessionSummary {
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
  };
}
