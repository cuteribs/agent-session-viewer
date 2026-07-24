import { readFileSync, existsSync, readdirSync } from 'fs';
import { basename, dirname, join } from 'path';
import type {
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolUsageSummary,
  SessionStats,
  UsedModelEntry,
  SubAgent,
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

// ════════════════════════════════════════════════════════
// Debug-log token extraction
// Debug logs live at: workspaceStorage/<id>/GitHub.copilot-chat/debug-logs/<sessionId>/
//   main.jsonl           — all LLM calls for the main session, one JSON span per line
//   runSubagent-default-call_<toolCallId>.jsonl — LLM calls for a specific subagent
// Each line has type=="llm_request" with attrs: { model, inputTokens, outputTokens, cachedTokens, ts }
// ════════════════════════════════════════════════════════

interface DebugRequestTokens {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  roundCount: number;
  model?: string;   // model of the majority (last) round
}

interface DebugLogTokens {
  /** Indexed by request index (matches parsedRequests index) */
  perRequest: DebugRequestTokens[];
  /** Keyed by toolCallId (matches SubAgent.id) */
  perSubagent: Map<string, DebugRequestTokens>;
}

function readDebugLogTokens(
  sessionId: string,
  chatSessionsPath: string,
  requestTimestamps: number[],
): DebugLogTokens | null {
  // workspaceStorage/<id>/GitHub.copilot-chat/debug-logs/<sessionId>/
  const chatSessionsDir = dirname(chatSessionsPath);
  const workspaceDir    = dirname(chatSessionsDir);
  const debugLogDir     = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', sessionId);
  if (!existsSync(debugLogDir)) return null;

  const mainPath = join(debugLogDir, 'main.jsonl');
  if (!existsSync(mainPath)) return null;

  // ── Read main.jsonl: collect all llm_request spans (skip title sub-sessions) ──
  interface LLMSpan { ts: number; inputTokens: number; outputTokens: number; cachedTokens: number; model: string }
  const mainCalls: LLMSpan[] = [];
  for (const line of readFileSync(mainPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (ev.type === 'llm_request') {
        const a = ev.attrs as Record<string, unknown>;
        // Skip side-channel models (gpt-4o-mini used for title generation)
        const model = String(a.model ?? '');
        if (model.includes('gpt-4o-mini')) continue;
        mainCalls.push({
          ts:           Number(ev.ts ?? 0),
          inputTokens:  Number(a.inputTokens  ?? 0),
          outputTokens: Number(a.outputTokens ?? 0),
          cachedTokens: Number(a.cachedTokens ?? 0),
          model,
        });
      }
    } catch { /* skip malformed lines */ }
  }

  // ── Assign each call to a request bucket using timestamps ──
  // requestTimestamps[i] = start of request i; upper bound = requestTimestamps[i+1]
  const perRequest: DebugRequestTokens[] = requestTimestamps.map(() => ({
    inputTokens: 0, outputTokens: 0, cachedTokens: 0, roundCount: 0, model: undefined,
  }));

  for (const call of mainCalls) {
    // Find the latest request that started before or at this call's timestamp
    let bucket = 0;
    for (let i = 0; i < requestTimestamps.length; i++) {
      if (call.ts >= requestTimestamps[i]) bucket = i;
    }
    perRequest[bucket].inputTokens  += call.inputTokens;
    perRequest[bucket].outputTokens += call.outputTokens;
    perRequest[bucket].cachedTokens += call.cachedTokens;
    perRequest[bucket].roundCount++;
    perRequest[bucket].model = call.model;
  }

  // ── Read per-subagent files: runSubagent-<agentName>-call_<toolCallId>.jsonl ──
  const perSubagent = new Map<string, DebugRequestTokens>();
  let files: string[] = [];
  try { files = readdirSync(debugLogDir); } catch { /* ignore */ }
  for (const fname of files) {
    const m = fname.match(/^runSubagent-(.+)-(call_[^.]+)\.jsonl$/);
    if (!m) continue;
    const toolCallId = m[2];
    const agg: DebugRequestTokens = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, roundCount: 0 };
    try {
      for (const line of readFileSync(join(debugLogDir, fname), 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line) as Record<string, unknown>;
        if (ev.type === 'llm_request') {
          const a = ev.attrs as Record<string, unknown>;
          agg.inputTokens  += Number(a.inputTokens  ?? 0);
          agg.outputTokens += Number(a.outputTokens ?? 0);
          agg.cachedTokens += Number(a.cachedTokens ?? 0);
          agg.roundCount++;
          agg.model = String(a.model ?? '');
        }
      }
    } catch { /* skip unreadable subagent files */ }
    if (agg.roundCount > 0) perSubagent.set(toolCallId, agg);
  }

  return { perRequest, perSubagent };
}

// ════════════════════════════════════════════════════════
// Read tool-call args + results from debug logs
// ════════════════════════════════════════════════════════
// The chatSessions log records tool invocations but often leaves
// invocationMessage empty and never stores the result. The debug-log
// `tool_call` spans carry both `args` (input) and `result` (output).
// We index them per tool name as FIFO queues (chronological), so the
// nth invocation of a tool in the session log maps to the nth span.

interface DebugToolCall {
  name: string;
  /** Raw JSON-string of the tool arguments */
  args: string;
  /** Raw result string (may itself be JSON) */
  result: string;
  ts: number;
}

interface DebugToolCalls {
  /** Main-agent tool calls, keyed by tool name → chronological queue */
  main: Map<string, DebugToolCall[]>;
  /** Subagent tool calls, keyed by subagent toolCallId → (tool name → queue) */
  perSubagent: Map<string, Map<string, DebugToolCall[]>>;
  /** Agent name extracted from filename, keyed by subagent toolCallId */
  agentNames: Map<string, string>;
}

function parseDebugToolCallFile(filePath: string): Map<string, DebugToolCall[]> {
  const byName = new Map<string, DebugToolCall[]>();
  if (!existsSync(filePath)) return byName;
  const spans: DebugToolCall[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      if (ev.type === 'tool_call' && ev.name) {
        const a = (ev.attrs ?? {}) as Record<string, unknown>;
        const toStr = (v: unknown): string =>
          v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
        spans.push({
          name: String(ev.name),
          args: toStr(a.args),
          result: toStr(a.result),
          ts: Number(ev.ts ?? 0),
        });
      }
    } catch { /* skip malformed lines */ }
  }
  spans.sort((x, y) => x.ts - y.ts);
  for (const s of spans) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }
  return byName;
}

function readDebugLogToolCalls(
  sessionId: string,
  chatSessionsPath: string,
): DebugToolCalls {
  const result: DebugToolCalls = { main: new Map(), perSubagent: new Map(), agentNames: new Map() };
  const chatSessionsDir = dirname(chatSessionsPath);
  const workspaceDir    = dirname(chatSessionsDir);
  const debugLogDir     = join(workspaceDir, 'GitHub.copilot-chat', 'debug-logs', sessionId);
  if (!existsSync(debugLogDir)) return result;

  result.main = parseDebugToolCallFile(join(debugLogDir, 'main.jsonl'));

  let files: string[] = [];
  try { files = readdirSync(debugLogDir); } catch { /* ignore */ }
  for (const fname of files) {
    const m = fname.match(/^runSubagent-(.+)-(call_[^.]+)\.jsonl$/);
    if (!m) continue;
    const agentName = m[1];
    const toolCallId = m[2];
    result.perSubagent.set(toolCallId, parseDebugToolCallFile(join(debugLogDir, fname)));
    result.agentNames.set(toolCallId, agentName);
  }
  return result;
}

/**
 * The chatSessions log uses public tool IDs (e.g. `copilot_readFile`) while the
 * debug log records the internal implementation name (e.g. `read_file`).
 * Map the public ID to its debug-log counterpart so args/results line up.
 */
const DEBUG_TOOL_NAME_ALIASES: Record<string, string> = {
  copilot_readFile: 'read_file',
  copilot_findTextInFiles: 'grep_search',
  copilot_findFiles: 'file_search',
  copilot_listDirectory: 'list_dir',
  copilot_applyPatch: 'apply_patch',
  copilot_fetchWebPage: 'fetch_webpage',
  vscode_fetchWebPage_internal: 'fetch_webpage',
};

/**
 * Pop the next debug tool-call span for `name` from a per-name queue and
 * return parsed arguments + result. Returns undefined when none remain.
 */
function consumeDebugToolCall(
  queues: Map<string, DebugToolCall[]> | undefined,
  name: string,
): { arguments?: Record<string, unknown>; result?: string } | undefined {
  const debugName = DEBUG_TOOL_NAME_ALIASES[name] ?? name;
  const q = queues?.get(debugName);
  if (!q || q.length === 0) return undefined;
  const span = q.shift()!;
  let args: Record<string, unknown> | undefined;
  if (span.args) {
    try {
      const parsed = JSON.parse(span.args);
      args = typeof parsed === 'object' && parsed !== null ? parsed : { input: span.args };
    } catch {
      args = { input: span.args };
    }
  }
  return { arguments: args, result: span.result || undefined };
}

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
  copilotCredits?: number;
  message?: { text?: string; parts?: { text?: string }[] };
  response?: VSCodeResponsePart[];
  result?: VSCodeResult;
  completionTokens?: number;
  elapsedMs?: number;
}

interface VSCodeToolSpecificData {
  kind: 'subagent' | string;
  description?: string;
  prompt?: string;
  modelName?: string;
  result?: string;
}

interface VSCodeResponsePart {
  /** Plain text content (kind=undefined). Thinking parts may have value:[] at runtime. */
  value?: unknown;
  kind?: string;
  toolName?: string;
  toolId?: string;
  invocationMessage?: string | { value?: string };
  pastTenseMessage?: string | { value?: string };
  isComplete?: boolean;
  isConfirmed?: unknown;
  toolCallId?: string;
  resultText?: string;
  toolSpecificData?: VSCodeToolSpecificData;
  /** URIs / resources that were used or produced by the tool */
  resultDetails?: Array<{ scheme?: string; authority?: string; path?: string }>;
  /** Set on tool calls made by a subagent (toolCallId of the parent subagent invocation) */
  subAgentInvocationId?: string;
  /** 'hidden' for internal patch-application tool calls */
  presentation?: string;
  /** For inlineReference parts: display name like "EventRecords.cs#L1" */
  name?: string;
  /** For inlineReference parts: the referenced URI */
  inlineReference?: { uri?: { fsPath?: string; path?: string } };
}

interface VSCodeResult {
  timings?: { firstProgress?: number; totalElapsed?: number };
  metadata?: {
    promptTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    copilotCredits?: number;
    [key: string]: unknown;
  };
  /** The actual model used for this request turn (may differ from inputState.selectedModel) */
  resolvedModel?: string;
  modelId?: string;
}

interface VSCodeState {
  version?: number;
  creationDate?: number;
  sessionId?: string;
  customTitle?: string;
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
  copilotCredits?: number;
  message?: { text?: string; parts?: { text?: string }[] };
  response?: (VSCodeJsonResponsePart | undefined | null)[];
  responseId?: string;
  result?: VSCodeResult;
  isCanceled?: boolean;
}

interface VSCodeJsonResponsePart {
  value?: string;
  kind?: string;
  toolName?: string;
  toolId?: string;
  invocationMessage?: string | { value?: string };
  pastTenseMessage?: string;
  isComplete?: boolean;
  isConfirmed?: unknown;
  toolCallId?: string;
  source?: { type?: string; label?: string };
  toolSpecificData?: VSCodeToolSpecificData;
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
        setPath(state as unknown as Record<string, unknown>, evt.k, evt.v);
      } else if (evt.kind === 2 && evt.k) {
        pushPath(state as unknown as Record<string, unknown>, evt.k, evt.v);
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

/**
 * Extract a plain string from an invocationMessage / pastTenseMessage value.
 * Both fields can be a bare string OR an object with a `value` property.
 * VSCode markdown link syntax is cleaned up:
 *   "[label](url)"  → label  (when label is non-empty)
 *   "[](url)"       → decoded filename extracted from the URL
 */
function extractInvocationText(msg: string | { value?: string } | undefined | null): string {
  if (!msg) return '';
  const raw = typeof msg === 'string' ? msg : (msg.value ?? '');
  return raw
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
      if (text.trim()) return text.trim();
      // Empty label — extract a readable path/filename from the URL
      try {
        const decoded = decodeURIComponent(url.replace(/^file:\/\/\//, '').replace(/\\/g, '/'));
        // For local file URIs return the filename only; keep http(s) URLs as-is
        if (!url.startsWith('http')) {
          return decoded.split('/').filter(Boolean).pop() ?? decoded;
        }
        return decoded;
      } catch {
        return url;
      }
    })
    .trim();
}

/**
 * Build a short URL string from a VSCode `resultDetails` entry.
 * Each entry has { scheme, authority, path } from the VS Code URI format.
 */
function formatResultDetail(d: { scheme?: string; authority?: string; path?: string }): string {
  if (d.scheme && d.authority && d.path) return `${d.scheme}://${d.authority}${d.path}`;
  if (d.path) return d.path;
  return '';
}

// ════════════════════════════════════════════════════════
// Common: build messages from requests[]
// ════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────
// Deduplicate incremental session log entries
// ────────────────────────────────────────────────────────

/**
 * Deduplicate response parts by toolCallId.
 *
 * VSCode writes the session log incrementally: the initial `kind=2 k=["requests"]` push
 * includes tool calls that are still in-flight.  Later `kind=2 k=["requests",N,"response"]`
 * pushes append updated (completed) versions of the same tool calls, resulting in duplicates.
 * We keep the LAST occurrence of each toolCallId (most complete / isComplete=true).
 */
function deduplicateResponseParts(parts: VSCodeResponsePart[]): VSCodeResponsePart[] {
  const seenToolCallIds = new Set<string>();
  // Scan reversed to identify which indices to keep
  const keepIdx = new Set<number>();
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === 'toolInvocationSerialized' && p.toolCallId) {
      if (!seenToolCallIds.has(p.toolCallId)) {
        seenToolCallIds.add(p.toolCallId);
        keepIdx.add(i);
      }
      // else: earlier (duplicate) occurrence — drop it
    } else {
      keepIdx.add(i);
    }
  }
  return parts.filter((_, i) => keepIdx.has(i));
}

interface ParsedRequest {
  requestId: string;
  timestamp: number;
  userText: string;
  responseParts: VSCodeResponsePart[];
  /** Total output tokens across all tool rounds (cumulative) */
  completionTokens?: number;
  /** Input tokens from result.metadata.promptTokens (last round) */
  promptTokens?: number;
  /** Resolved model for this specific request */
  resolvedModel?: string;
  copilotCredits?: number;
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
      promptTokens: req.result?.metadata?.promptTokens,
      resolvedModel: req.result?.resolvedModel || req.result?.modelId,
      copilotCredits: req.copilotCredits ?? req.result?.metadata?.copilotCredits,
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
            toolSpecificData: p.toolSpecificData,
          });
        }
      }
    }

    result.push({
      requestId: req.requestId || '',
      timestamp: req.timestamp || 0,
      userText,
      responseParts: parts,
      copilotCredits: req.copilotCredits ?? req.result?.metadata?.copilotCredits,
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
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCost = 0;
  let cumulativeTotal = 0;
  const credits = parsedRequests
    .map(req => req.copilotCredits)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const actualCost = credits.length > 0
    ? credits.reduce((sum, value) => sum + value, 0) * 0.01
    : undefined;

  // Per-model aggregates for usedModels
  const modelAggMap = new Map<string, { input: number; output: number; cacheRead: number; cost: number; count: number }>();

  // Subagent tracking — deduplicated by toolCallId
  const subAgentMap = new Map<string, SubAgent>();
  // Per-subagent tool-call parts collected from responseParts (keyed by subagent toolCallId)
  const subAgentPartsMap = new Map<string, VSCodeResponsePart[]>();

  // ── Debug-log token data (more accurate than chatSessions metadata) ──
  const requestTimestamps = parsedRequests.map(r => r.timestamp);
  const debugTokens = readDebugLogTokens(sessionId, sourcePath, requestTimestamps);

  // ── Debug-log tool-call args + results (session log lacks both) ──
  const debugToolCalls = readDebugLogToolCalls(sessionId, sourcePath);

  let reqIdx = -1;
  for (const req of parsedRequests) {
    if (!req.userText && !req.responseParts.length) continue;
    reqIdx++;

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
    let content = '';
    /** true when the previous content-contributing part was an inlineReference (inline, no separator needed) */
    let lastWasInlineRef = false;
    const toolCalls: ToolCall[] = [];

    const deduped = deduplicateResponseParts(req.responseParts);

    for (const part of deduped) {
      if (part.kind === 'toolInvocationSerialized') {
        const name = part.toolId || part.toolName || 'unknown';
        const tsd = part.toolSpecificData;

        // Detect VSCode subagent invocations
        if (tsd?.kind === 'subagent' && part.toolCallId && !subAgentMap.has(part.toolCallId)) {
          const reqTs = new Date(req.timestamp).toISOString();
          const agentName = debugToolCalls.agentNames.get(part.toolCallId) ?? tsd.description ?? 'runSubagent';
          subAgentMap.set(part.toolCallId, {
            id: part.toolCallId,
            agentId: agentName,
            agentType: agentName,
            agentDisplayName: tsd.description || agentName,
            description: tsd.description,
            prompt: tsd.prompt,
            status: part.isComplete ? 'completed' : 'started',
            result: tsd.result,
            model: tsd.modelName,
            startTime: reqTs,
            endTime: part.isComplete ? reqTs : undefined,
          });
        }

        // Collect tool-call parts that belong to a subagent (identified by subAgentInvocationId)
        if (part.subAgentInvocationId && part.toolCallId) {
          const arr = subAgentPartsMap.get(part.subAgentInvocationId) ?? [];
          arr.push(part);
          subAgentPartsMap.set(part.subAgentInvocationId, arr);
        }

        // Build a human-readable arguments.input from the invocation/completion message.
        // Prefer pastTenseMessage (describes what was done) when the call is complete.
        const completedText = part.isComplete ? extractInvocationText(part.pastTenseMessage) : '';
        const invocationText = extractInvocationText(part.invocationMessage);
        let inputText = completedText || invocationText;

        // For subagents without a pastTenseMessage, the description is more useful
        if (!inputText && tsd?.description) inputText = tsd.description;

        // Append resultDetails URLs when they aren't already in the message
        if (part.resultDetails?.length) {
          const urls = part.resultDetails
            .map(formatResultDetail)
            .filter(Boolean)
            .join(', ');
          if (urls && !inputText.includes(urls.split(',')[0].trim())) {
            inputText = inputText ? `${inputText} — ${urls}` : urls;
          }
        }

        // Pull exact args + result from the debug log (session log often
        // leaves these empty). Subagent tool calls are matched later, in the
        // per-subagent message build, so skip them here to avoid double-consume.
        const dbg = part.subAgentInvocationId
          ? undefined
          : consumeDebugToolCall(debugToolCalls.main, name);

        toolCalls.push({
          id: part.toolCallId || `${name}-${toolCalls.length}`,
          name,
          arguments: dbg?.arguments ?? (inputText ? { input: inputText } : {}),
          result: dbg?.result,
        });

        const existing = toolUsageMap.get(name) || { count: 0 };
        existing.count++;
        toolUsageMap.set(name, existing);
        lastWasInlineRef = false;

      } else if (!part.kind && typeof part.value === 'string') {
        if (/^[\s`]*$/.test(part.value)) {
          lastWasInlineRef = false;
          continue;
        }
        let text = part.value.replace(/^\[LLM MODEL ID\]\s*/m, '');
        if (!text) { lastWasInlineRef = false; continue; }
        if (!lastWasInlineRef && content && !content.endsWith('\n')) {
          content += '\n\n';
        }
        content += text;
        lastWasInlineRef = false;

      } else if (part.kind === 'inlineReference') {
        // File / symbol reference — use the display name, stripping the #L1 range suffix.
        const displayName = (part.name ?? '').replace(/#.*$/, '');
        if (displayName) {
          content += '`' + displayName + '`';
          lastWasInlineRef = true;
        }
      } else {
        // thinking, mcpServersStarting, undoStop, codeblockUri, textEditGroup, etc. — ignore
        lastWasInlineRef = false;
      }
    }

    // ── Token data: prefer debug log (all rounds + cached), fall back to chatSessions ──
    const dbg = debugTokens?.perRequest[reqIdx];
    const outputTokens = dbg?.outputTokens ?? req.completionTokens ?? 0;
    const inputTokens  = dbg?.inputTokens  ?? req.promptTokens    ?? 0;  // TOTAL (incl. cached)
    const cachedTokens = dbg?.cachedTokens ?? 0;
    const hasTokenData = outputTokens > 0 || inputTokens > 0;
    // Use per-request resolvedModel, fall back to debug log model, then session-level modelName
    const reqModel = req.resolvedModel || dbg?.model || modelName;
    // OpenAI billing model: inputTokens is TOTAL (inclusive of cached).
    // calculateCost expects non-overlapping input + cacheRead, so subtract cached from input.
    const nonCachedInput = dbg ? Math.max(0, inputTokens - cachedTokens) : inputTokens;
    const copilotCredits = req.copilotCredits;
    const hasCopilotCredits = typeof copilotCredits === 'number'
      && Number.isFinite(copilotCredits)
      && copilotCredits >= 0;
    const legacyMsgCost = calculateCost({ input: nonCachedInput, output: outputTokens, cacheRead: cachedTokens }, reqModel);
    const msgCost = hasCopilotCredits
      ? copilotCredits * 0.01
      : legacyMsgCost;

    if (hasTokenData) {
      totalOutput    += outputTokens;
      totalInput     += inputTokens;
      totalCacheRead += cachedTokens;
      totalCost      += legacyMsgCost;
      outputPerMessage.push(outputTokens);
      inputPerMessage.push(inputTokens);
      cumulativeTotal += inputTokens + outputTokens;
      cumulativeTokens.push(cumulativeTotal);

      // Aggregate per model
      const key = reqModel ?? '__unknown__';
      const agg = modelAggMap.get(key) ?? { input: 0, output: 0, cacheRead: 0, cost: 0, count: 0 };
      agg.input     += inputTokens;
      agg.output    += outputTokens;
      agg.cacheRead += cachedTokens;
      agg.cost      += msgCost;
      agg.count++;
      modelAggMap.set(key, agg);
    }

    const finalContent = content.trim();
    const assistantId = req.requestId ? `asst-${req.requestId}` : `asst-${Date.now()}-${Math.random()}`;
    if (finalContent || toolCalls.length > 0) {
      const ts = new Date(req.timestamp + 100).toISOString();
      // Find first subagent toolCallId in this request (for subAgentRef)
      const firstSubagentCallId = req.responseParts
        .find(p => p.kind === 'toolInvocationSerialized' && p.toolSpecificData?.kind === 'subagent')
        ?.toolCallId;

      const msg: Message = {
        id: assistantId,
        parentId: req.requestId ? `user-${req.requestId}` : null,
        role: 'assistant',
        content: finalContent,
        timestamp: ts,
        model: reqModel,
        subAgentRef: firstSubagentCallId,
      };

      if (hasTokenData) {
        msg.tokens = {
          input: inputTokens,
          output: outputTokens,
          cacheRead: cachedTokens > 0 ? cachedTokens : undefined,
          cost: msgCost,
        };
      }

      messages.push(msg);

      // Emit a separate role:'tool' child message for each tool call
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        messages.push({
          id: `${assistantId}::tool::${tc.id}`,
          parentId: assistantId,
          role: 'tool',
          content: '',
          timestamp: new Date(req.timestamp + 100 + i + 1).toISOString(),
          toolCalls: [tc],
          toolResult: tc.result !== undefined ? {
            toolCallId: tc.id,
            success: true,
            content: tc.result,
          } : undefined,
        });
      }
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

  // ── Subagent debug-log patch (must run BEFORE stats/totals are finalised) ──
  if (debugTokens) {
    for (const [toolCallId, sa] of subAgentMap) {
      const dbgSA = debugTokens.perSubagent.get(toolCallId);
      if (dbgSA) {
        sa.totalTokens = dbgSA.inputTokens + dbgSA.outputTokens;

        const saModel = dbgSA.model || sa.model || modelName;
        // OpenAI billing: inputTokens is total inclusive of cached — subtract for non-cached portion
        const saNonCachedInput = Math.max(0, dbgSA.inputTokens - dbgSA.cachedTokens);
        const saCost = calculateCost({
          input: saNonCachedInput,
          output: dbgSA.outputTokens,
          cacheRead: dbgSA.cachedTokens,
        }, saModel);

        totalInput     += dbgSA.inputTokens;
        totalOutput    += dbgSA.outputTokens;
        totalCacheRead += dbgSA.cachedTokens;
        totalCost      += saCost;

        const key = saModel ?? '__unknown__';
        const agg = modelAggMap.get(key) ?? { input: 0, output: 0, cacheRead: 0, cost: 0, count: 0 };
        agg.input     += dbgSA.inputTokens;
        agg.output    += dbgSA.outputTokens;
        agg.cacheRead += dbgSA.cachedTokens;
        agg.cost      += saCost;
        modelAggMap.set(key, agg);
      }
    }
  }
  // ── Build messages[] for each subagent from its collected tool-call parts ──
  for (const [toolCallId, sa] of subAgentMap) {
    const parts = subAgentPartsMap.get(toolCallId);
    const saMessages: Message[] = [];

    // User message = the prompt
    if (sa.prompt) {
      saMessages.push({
        id: `${toolCallId}-user`,
        parentId: null,
        role: 'user',
        content: sa.prompt,
        timestamp: sa.startTime,
      });
    }

    // Tool calls made by the subagent → one assistant message + separate role:'tool' children
    if (parts && parts.length > 0) {
      const dedupedSaParts = deduplicateResponseParts(parts);
      const saToolCalls: ToolCall[] = [];
      let saTextParts = '';
      const saDebugQueues = debugToolCalls.perSubagent.get(toolCallId);

      for (const p of dedupedSaParts) {
        if (p.kind === 'toolInvocationSerialized' && p.toolCallId) {
          const name = p.toolId || p.toolName || 'unknown';
          const completedText = p.isComplete ? extractInvocationText(p.pastTenseMessage) : '';
          const invocationText = extractInvocationText(p.invocationMessage);
          let inputText = completedText || invocationText;

          if (p.resultDetails?.length) {
            const urls = p.resultDetails
              .map(formatResultDetail)
              .filter(Boolean)
              .join(', ');
            if (urls && !inputText.includes(urls.split(',')[0].trim())) {
              inputText = inputText ? `${inputText} — ${urls}` : urls;
            }
          }

          const saDbg = consumeDebugToolCall(saDebugQueues, name);

          saToolCalls.push({
            id: p.toolCallId,
            name,
            arguments: saDbg?.arguments ?? (inputText ? { input: inputText } : {}),
            result: saDbg?.result,
          });
        } else if (!p.kind && typeof p.value === 'string' && !/^[\s`]*$/.test(p.value)) {
          let saText = p.value.replace(/^\[LLM MODEL ID\]\s*/m, '');
          if (!saText) continue;
          if (saTextParts && !saTextParts.endsWith('\n')) saTextParts += '\n\n';
          saTextParts += saText;
        }
      }

      const saAsstId = `${toolCallId}-tools`;
      if (saToolCalls.length > 0 || saTextParts.trim()) {
        saMessages.push({
          id: saAsstId,
          parentId: `${toolCallId}-user`,
          role: 'assistant',
          content: saTextParts.trim(),
          timestamp: sa.endTime || sa.startTime,
          model: sa.model,
        });

        // Emit a separate role:'tool' child message for each subagent tool call
        for (let i = 0; i < saToolCalls.length; i++) {
          const tc = saToolCalls[i];
          saMessages.push({
            id: `${saAsstId}::tool::${tc.id}`,
            parentId: saAsstId,
            role: 'tool',
            content: '',
            timestamp: sa.endTime || sa.startTime,
            toolCalls: [tc],
            toolResult: tc.result !== undefined ? {
              toolCallId: tc.id,
              success: true,
              content: tc.result,
            } : undefined,
          });
        }
      }
    }

    // Final result as a concluding assistant message (only if there are tool calls above)
    if (sa.result && saMessages.length > 1) {
      saMessages.push({
        id: `${toolCallId}-result`,
        parentId: `${toolCallId}-tools`,
        role: 'assistant',
        content: sa.result,
        timestamp: sa.endTime || sa.startTime,
        model: sa.model,
      });
    }

    if (saMessages.length > 0) {
      (sa as SubAgent & { messages?: Message[] }).messages = saMessages;
    }
  }

  const subAgents = subAgentMap.size > 0 ? Array.from(subAgentMap.values()) : undefined;

  const hasTokens = outputPerMessage.length > 0 || inputPerMessage.length > 0;
  const sessionCost = actualCost ?? totalCost;

  const stats: SessionStats = {
    messageCount: messages.length,
    userMessages: userMsgs,
    assistantMessages: asstMsgs,
    tokens: hasTokens
      ? {
          totalInput,
          totalOutput,
          totalCacheRead,
          totalCacheCreation: 0,
          totalCost: sessionCost,
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
  const totalTokens = hasTokens ? totalInput + totalOutput : undefined;

  // Token data provenance note — present when debug logs were unavailable
  const tokenNote = hasTokens && !debugTokens
    ? 'Approximate (session log only): input = last LLM round per turn; cached and subagent tokens not included. Enable debug logs for exact data.'
    : undefined;

  let usedModels: UsedModelEntry[] | undefined;
  if (modelAggMap.size > 0) {
    usedModels = Array.from(modelAggMap.entries())
      .map(([model, agg]) => ({
        model: model === '__unknown__' ? (modelName ?? 'Unknown') : model,
        inputTokens: agg.input,
        outputTokens: agg.output,
        totalTokens: agg.input + agg.output,
        requestCount: agg.count,
        cost: agg.cost,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }
  // Read workspace.json to get the actual project folder path.
  // For globalStorage/emptyWindowChatSessions, no workspace.json exists.
  let projectName = 'Empty Window';
  const chatSessionsDir = dirname(sourcePath);                // .../chatSessions
  const storageEntryDir = dirname(chatSessionsDir);           // .../workspaceStorage/<hash>  OR  .../globalStorage
  const workspaceJsonPath = join(storageEntryDir, 'workspace.json');
  // projectPath = the folder path recorded in workspace.json (the real project dir).
  // Falls back to the storage entry dir when workspace.json is absent (Empty Window).
  let projectPath = storageEntryDir;
  if (existsSync(workspaceJsonPath)) {
    try {
      const wsData = JSON.parse(readFileSync(workspaceJsonPath, 'utf-8'));
      if (wsData.folder) {
        const urlStr = wsData.folder as string;
        const decoded = decodeURIComponent(urlStr.replace(/^file:\/\/\//, '').replace(/\\/g, '/'));
        projectName = basename(decoded);
        projectPath = decoded;
      }
    } catch {
      // fall back to hash dir name
      projectName = basename(storageEntryDir) || 'Unknown';
    }
  }

  return {
    id: sessionId,
    source: 'vscode',
    project: projectName,
    projectPath,
    startTime,
    lastActivity,
    messageCount: messages.length,
    totalTokens,
    cost: actualCost !== undefined || hasTokens ? sessionCost : undefined,
    model: modelName,
    usedModels,
    subAgentCount: subAgents?.length,
    tokenNote,
    messages,
    stats,
    subAgents,
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

  const result = buildSession(parsedRequests, sessionId, filePath, model, state.creationDate);
  if (result && state.customTitle) {
    result.project = state.customTitle;
  }
  return result;
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
    cost: detail.cost,
    model: detail.model,
    usedModels: detail.usedModels,
    subAgentCount: detail.subAgentCount,
    tokenNote: detail.tokenNote,
  };
}
