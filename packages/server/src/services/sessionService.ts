import {
  readdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  readFileSync,
} from 'fs';
import { join, basename, dirname } from 'path';
import { getServerConfig } from '../config.js';
import { parseSessionFile, getSessionSummary, listOpenCodeDbSessionIds, type SessionSource } from '../parsers/index.js';
import type { SessionSummary, SessionDetail, Message } from '../types/index.js';

// ─── Cache types ────────────────────────────────────────────────────────────

interface CachedDetail {
  detail:   SessionDetail;
  /** File mtime when this was parsed (ms). 0 for DB-backed sessions. */
  mtime:    number;
  /** Wall-clock ms when this entry was populated — used as TTL for DB sessions. */
  cachedAt: number;
}

/**
 * Full-parse cache.
 * Populated lazily the first time a session is clicked (getSession) or
 * eagerly by the file watcher after a file-change event.
 */
const detailCache = new Map<string, CachedDetail>();

/**
 * Per-source file-list cache.
 * Avoids rescanning all directories on every listSessions call.
 * Invalidated by the file watcher on add / unlink events.
 */
const fileListCache = new Map<SessionSource, Map<string, string>>();

/** DB-backed session entries are re-queried after this interval (ms). */
const DB_TTL_MS = 60_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCacheKey(source: SessionSource, sessionId: string): string {
  return `${source}:${sessionId}`;
}

function getFileMtime(filePath: string): number {
  try {
    return Math.floor(statSync(filePath).mtimeMs);
  } catch {
    return 0;
  }
}

/** Returns true when a cached entry should be discarded and re-parsed. */
function isCacheStale(cached: CachedDetail, filePath: string): boolean {
  if (filePath.startsWith('db::')) {
    // DB sessions have no file mtime; use a TTL instead
    return (Date.now() - cached.cachedAt) >= DB_TTL_MS;
  }
  const mtime = getFileMtime(filePath);
  return mtime === 0 || mtime !== cached.mtime;
}

/** Read the first `maxBytes` bytes of a file without keeping an fd open. */
function readFirstBytes(filePath: string, maxBytes: number): string {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buf, 0, maxBytes, 0);
    closeSync(fd);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return '';
  }
}

/**
 * Extract a display-ready project name without doing a full parse.
 * Each source uses the cheapest available signal:
 *   claude   — decode the encoded directory name (pure string ops, no I/O)
 *   copilot  — read first ≤1 KB to get context.cwd from session.start event
 *   vscode   — read workspace.json from the storage entry directory
 *   codex    — session ID prefix (real name fills in on first click)
 *   opencode — "OpenCode" placeholder (DB query on click)
 */
function quickProjectName(sessionId: string, filePath: string, source: SessionSource): string {
  if (source === 'claude') {
    // filePath: .../.claude/projects/<ENCODED_DIR>/<sessionId>.jsonl
    const encodedDir = basename(dirname(filePath));
    // Claude encodes paths with - as separator and A-- as drive letter
    const decoded = encodedDir
      .replace(/^([A-Za-z])--/, '$1:/')
      .replace(/-/g, '/');
    return basename(decoded) || encodedDir;
  }

  if (source === 'copilot') {
    const chunk = readFirstBytes(filePath, 1024);
    if (chunk) {
      const firstLine = chunk.split('\n')[0] ?? chunk;
      try {
        const ev = JSON.parse(firstLine) as Record<string, unknown>;
        const cwd = (ev?.data as Record<string, unknown>)?.context
          ? ((ev.data as Record<string, unknown>).context as Record<string, unknown>)?.cwd
          : undefined;
        if (typeof cwd === 'string' && cwd) return basename(cwd);
      } catch { /* fall through */ }
    }
    return basename(dirname(filePath));
  }

  if (source === 'vscode') {
    const chatSessionsDir = dirname(filePath);        // .../chatSessions
    const storageEntryDir = dirname(chatSessionsDir); // .../workspaceStorage/<hash>  OR  .../globalStorage
    const wsPath = join(storageEntryDir, 'workspace.json');
    if (existsSync(wsPath)) {
      try {
        const wsData = JSON.parse(readFileSync(wsPath, 'utf-8')) as Record<string, unknown>;
        if (typeof wsData.folder === 'string') {
          const decoded = decodeURIComponent(
            wsData.folder.replace(/^file:\/\/\//, '').replace(/\\/g, '/'),
          );
          return basename(decoded) || 'Unknown';
        }
      } catch { /* fall through */ }
    }
    return 'Empty Window';
  }

  // codex / opencode: placeholder until full parse
  return sessionId.substring(0, 8) + '…';
}

/** Build a lightweight SessionSummary without doing a full parse. */
function buildQuickSummary(
  sessionId: string,
  filePath:  string,
  source:    SessionSource,
): SessionSummary {
  let startTime:    string;
  let lastActivity: string;

  if (filePath.startsWith('db::')) {
    const now = new Date().toISOString();
    startTime    = now;
    lastActivity = now;
  } else {
    try {
      const s    = statSync(filePath);
      lastActivity = new Date(s.mtimeMs).toISOString();
      // birthtime is unreliable on some systems; fall back to mtime
      startTime    = new Date(s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs).toISOString();
    } catch {
      const now = new Date().toISOString();
      startTime    = now;
      lastActivity = now;
    }
  }

  return {
    id:           sessionId,
    source,
    project:      quickProjectName(sessionId, filePath, source),
    projectPath:  filePath,
    startTime,
    lastActivity,
    messageCount: 0,          // filled in after first click
    totalTokens:  undefined,  // filled in after first click
    cost:         undefined,  // filled in after first click
    model:        undefined,  // filled in after first click
  };
}

// ─── Public cache management ─────────────────────────────────────────────────

export function clearSessionCache(): void {
  detailCache.clear();
  fileListCache.clear();
}

export function invalidateSession(source: SessionSource, sessionId: string): void {
  detailCache.delete(getCacheKey(source, sessionId));
}

/** Called by the file watcher when a session file is added or deleted. */
export function invalidateFileListCache(source?: SessionSource): void {
  if (source) {
    fileListCache.delete(source);
  } else {
    fileListCache.clear();
  }
}

// ─── File discovery ───────────────────────────────────────────────────────────

/**
 * Return the sessionId → filePath map for a source.
 * The result is cached in fileListCache until explicitly invalidated.
 */
export function findSessionFiles(source: SessionSource): Map<string, string> {
  const cached = fileListCache.get(source);
  if (cached) return cached;

  const files = scanSessionFiles(source);
  fileListCache.set(source, files);
  return files;
}

/** Unconditional directory scan — use findSessionFiles() for the cached version. */
function scanSessionFiles(source: SessionSource): Map<string, string> {
  const config = getServerConfig();
  let paths: string[];
  if      (source === 'claude')   paths = config.paths.claude;
  else if (source === 'copilot')  paths = config.paths.copilot;
  else if (source === 'codex')    paths = config.paths.codex;
  else if (source === 'opencode') paths = config.paths.opencode;
  else if (source === 'vscode')   paths = config.paths.vscode;
  else                            paths = [];

  const files = new Map<string, string>();

  for (const basePath of paths) {
    if (!existsSync(basePath)) continue;

    if      (source === 'claude')   findClaudeSessionFiles(basePath, files);
    else if (source === 'copilot')  findCopilotSessionFiles(basePath, files);
    else if (source === 'codex')    findCodexSessionFiles(basePath, files);
    else if (source === 'opencode') findOpenCodeSessionFiles(basePath, files);
    else if (source === 'vscode')   findVSCodeSessionFiles(basePath, files);
  }

  return files;
}

function findClaudeSessionFiles(basePath: string, files: Map<string, string>): void {
  try {
    for (const projectDir of readdirSync(basePath)) {
      const projectPath = join(basePath, projectDir);
      if (!statSync(projectPath).isDirectory()) continue;
      for (const sessionFile of readdirSync(projectPath).filter(f => f.endsWith('.jsonl'))) {
        files.set(basename(sessionFile, '.jsonl'), join(projectPath, sessionFile));
      }
    }
  } catch (error) {
    console.error(`Error scanning Claude sessions at ${basePath}:`, error);
  }
}

function findCopilotSessionFiles(basePath: string, files: Map<string, string>): void {
  try {
    for (const sessionDir of readdirSync(basePath)) {
      const sessionPath = join(basePath, sessionDir);
      if (!statSync(sessionPath).isDirectory()) continue;
      const eventsFile = join(sessionPath, 'events.jsonl');
      if (existsSync(eventsFile)) files.set(sessionDir, eventsFile);
    }
  } catch (error) {
    console.error(`Error scanning Copilot sessions at ${basePath}:`, error);
  }
}

function findCodexSessionFiles(basePath: string, files: Map<string, string>): void {
  function scanDir(dir: string, depth: number): void {
    if (depth > 4) return;
    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const s = statSync(fullPath);
        if (s.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.endsWith('.jsonl')) {
          const sessionId = extractCodexSessionId(fullPath) || basename(entry, '.jsonl');
          files.set(sessionId, fullPath);
        }
      }
    } catch { /* skip unreadable dirs */ }
  }
  scanDir(basePath, 0);
}

function findVSCodeSessionFiles(basePath: string, files: Map<string, string>): void {
  const workspaceStoragePath = join(basePath, 'workspaceStorage');
  if (existsSync(workspaceStoragePath)) {
    try {
      for (const projectDir of readdirSync(workspaceStoragePath)) {
        const chatSessionsPath = join(workspaceStoragePath, projectDir, 'chatSessions');
        if (!existsSync(chatSessionsPath)) continue;
        try {
          for (const sessionFile of readdirSync(chatSessionsPath).filter(
            f => f.endsWith('.json') || f.endsWith('.jsonl'),
          )) {
            const sessionId = basename(sessionFile).replace(/\.(json|jsonl)$/, '');
            const filePath  = join(chatSessionsPath, sessionFile);
            if (!files.has(sessionId) || sessionFile.endsWith('.jsonl')) {
              files.set(sessionId, filePath);
            }
          }
        } catch { /* skip unreadable project dirs */ }
      }
    } catch (error) {
      console.error(`Error scanning VSCode workspaceStorage at ${workspaceStoragePath}:`, error);
    }
  }

  const emptyWindowPath = join(basePath, 'globalStorage', 'emptyWindowChatSessions');
  if (existsSync(emptyWindowPath)) {
    try {
      for (const sessionFile of readdirSync(emptyWindowPath).filter(
        f => f.endsWith('.json') || f.endsWith('.jsonl'),
      )) {
        const sessionId = basename(sessionFile).replace(/\.(json|jsonl)$/, '');
        const filePath  = join(emptyWindowPath, sessionFile);
        if (!files.has(sessionId) || sessionFile.endsWith('.jsonl')) {
          files.set(sessionId, filePath);
        }
      }
    } catch (error) {
      console.error(`Error scanning VSCode emptyWindowChatSessions at ${emptyWindowPath}:`, error);
    }
  }
}

function findOpenCodeSessionFiles(basePath: string, files: Map<string, string>): void {
  try {
    const dbPath = join(basePath, '..', 'opencode.db');
    if (existsSync(dbPath)) {
      for (const sessionId of listOpenCodeDbSessionIds()) {
        files.set(sessionId, `db::${sessionId}`);
      }
    }
  } catch (error) {
    console.error(`Error querying OpenCode DB from ${basePath}:`, error);
  }

  const sessionDir = join(basePath, 'session');
  if (!existsSync(sessionDir)) return;
  try {
    for (const projectDir of readdirSync(sessionDir)) {
      const projectPath = join(sessionDir, projectDir);
      if (!statSync(projectPath).isDirectory()) continue;
      for (const sessionFile of readdirSync(projectPath).filter(f => f.endsWith('.json'))) {
        const sessionId = basename(sessionFile, '.json');
        if (!files.has(sessionId)) {
          files.set(sessionId, join(projectPath, sessionFile));
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning OpenCode sessions at ${basePath}:`, error);
  }
}

function extractCodexSessionId(filePath: string): string | null {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(256);
    const bytesRead = readSync(fd, buf, 0, 256, 0);
    closeSync(fd);
    const chunk = buf.toString('utf-8', 0, bytesRead);
    if (!chunk.includes('"session_meta"')) return null;
    const match = chunk.match(/"id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Return summaries for all (or a filtered subset of) sessions.
 *
 * Performance strategy:
 *  • File lists are cached per source — no directory scan on warm requests.
 *  • If a full parse is already cached AND the source file hasn't changed
 *    (mtime check), the cached SessionSummary is returned instantly.
 *  • Otherwise a lightweight QuickSummary is built from file metadata only
 *    (one statSync + optional small file reads for project name).
 *    Tokens / cost / model are populated later when the session is clicked.
 */
export function listSessions(
  source?: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode' | 'all',
): SessionSummary[] {
  const summaries: SessionSummary[] = [];
  const sources: SessionSource[] =
    source === 'all' || !source ? ['claude', 'copilot', 'codex', 'opencode', 'vscode'] : [source];

  for (const src of sources) {
    const files = findSessionFiles(src);

    for (const [sessionId, filePath] of files) {
      const cacheKey = getCacheKey(src, sessionId);
      const cached   = detailCache.get(cacheKey);

      if (cached && !isCacheStale(cached, filePath)) {
        // Hot path: valid cached full parse → return real summary with tokens/cost
        summaries.push(getSessionSummary(cached.detail));
      } else {
        // Cold / stale path: return a quick summary; full parse deferred to getSession()
        if (cached) detailCache.delete(cacheKey); // remove stale entry
        summaries.push(buildQuickSummary(sessionId, filePath, src));
      }
    }
  }

  summaries.sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime(),
  );
  return summaries;
}

/**
 * Return a fully-parsed SessionDetail for a single session.
 * On first call (or after cache invalidation / mtime change) this triggers
 * the full parse; subsequent calls return the cached result instantly.
 */
export function getSession(source: SessionSource, sessionId: string): SessionDetail | null {
  const files    = findSessionFiles(source);
  const filePath = files.get(sessionId);
  if (!filePath) return null;

  const cacheKey = getCacheKey(source, sessionId);
  const cached   = detailCache.get(cacheKey);

  if (cached && !isCacheStale(cached, filePath)) {
    return cached.detail;
  }

  // Full parse
  const detail = parseSessionFile(filePath, source) ?? undefined;
  if (detail) {
    const mtime = filePath.startsWith('db::') ? 0 : getFileMtime(filePath);
    detailCache.set(cacheKey, { detail, mtime, cachedAt: Date.now() });
  }
  return detail ?? null;
}

export function getSessionMessages(
  source: SessionSource,
  sessionId: string,
  offset: number = 0,
  limit:  number = 50,
): Message[] {
  return getSession(source, sessionId)?.messages.slice(offset, offset + limit) ?? [];
}

export function getSessionStats(source: SessionSource, sessionId: string) {
  return getSession(source, sessionId)?.stats ?? null;
}
