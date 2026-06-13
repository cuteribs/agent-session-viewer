import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { getServerConfig } from '../config.js';
import { parseSessionFile, getSessionSummary, listOpenCodeDbSessionIds, type SessionSource } from '../parsers/index.js';
import type { SessionSummary, SessionDetail, Message } from '../types/index.js';

// Cache for parsed sessions
const sessionCache = new Map<string, SessionDetail>();

function getCacheKey(source: SessionSource, sessionId: string): string {
  return `${source}:${sessionId}`;
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

export function invalidateSession(source: SessionSource, sessionId: string): void {
  sessionCache.delete(getCacheKey(source, sessionId));
}

export function findSessionFiles(source: SessionSource): Map<string, string> {
  const config = getServerConfig();
  let paths: string[];
  if (source === 'claude') {
    paths = config.paths.claude;
  } else if (source === 'copilot') {
    paths = config.paths.copilot;
  } else if (source === 'codex') {
    paths = config.paths.codex;
  } else if (source === 'opencode') {
    paths = config.paths.opencode;
  } else if (source === 'vscode') {
    paths = config.paths.vscode;
  } else {
    paths = [];
  }
  const files = new Map<string, string>();

  for (const basePath of paths) {
    if (!existsSync(basePath)) {
      continue;
    }

    if (source === 'claude') {
      findClaudeSessionFiles(basePath, files);
    } else if (source === 'copilot') {
      findCopilotSessionFiles(basePath, files);
    } else if (source === 'codex') {
      findCodexSessionFiles(basePath, files);
    } else if (source === 'opencode') {
      findOpenCodeSessionFiles(basePath, files);
    } else if (source === 'vscode') {
      findVSCodeSessionFiles(basePath, files);
    }
  }

  return files;
}

function findClaudeSessionFiles(basePath: string, files: Map<string, string>): void {
  try {
    const projectDirs = readdirSync(basePath);

    for (const projectDir of projectDirs) {
      const projectPath = join(basePath, projectDir);
      const stat = statSync(projectPath);

      if (!stat.isDirectory()) {
        continue;
      }

      const sessionFiles = readdirSync(projectPath).filter(f => f.endsWith('.jsonl'));

      for (const sessionFile of sessionFiles) {
        const filePath = join(projectPath, sessionFile);
        const sessionId = basename(sessionFile, '.jsonl');
        files.set(sessionId, filePath);
      }
    }
  } catch (error) {
    console.error(`Error scanning Claude sessions at ${basePath}:`, error);
  }
}

function findCopilotSessionFiles(basePath: string, files: Map<string, string>): void {
  try {
    const sessionDirs = readdirSync(basePath);

    for (const sessionDir of sessionDirs) {
      const sessionPath = join(basePath, sessionDir);
      const stat = statSync(sessionPath);

      if (!stat.isDirectory()) {
        continue;
      }

      const eventsFile = join(sessionPath, 'events.jsonl');
      if (existsSync(eventsFile)) {
        files.set(sessionDir, eventsFile);
      }
    }
  } catch (error) {
    console.error(`Error scanning Copilot sessions at ${basePath}:`, error);
  }
}

function findCodexSessionFiles(basePath: string, files: Map<string, string>): void {
  // Codex: ~/.codex/sessions/{year}/{month}/{day}/{name}.jsonl
  // The filename has a prefix before the UUID; read first line to get actual session ID.
  function scanDir(dir: string, depth: number): void {
    if (depth > 4) return;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.endsWith('.jsonl')) {
          const sessionId = extractCodexSessionId(fullPath) || basename(entry, '.jsonl');
          files.set(sessionId, fullPath);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
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
          const sessionFiles = readdirSync(chatSessionsPath)
            .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));
          for (const sessionFile of sessionFiles) {
            const filePath = join(chatSessionsPath, sessionFile);
            const sessionId = basename(sessionFile).replace(/\.(json|jsonl)$/, '');
            if (!files.has(sessionId) || sessionFile.endsWith('.jsonl')) {
              files.set(sessionId, filePath);
            }
          }
        } catch {
          // Skip unreadable project dirs
        }
      }
    } catch (error) {
      console.error(`Error scanning VSCode workspaceStorage at ${workspaceStoragePath}:`, error);
    }
  }

  const emptyWindowPath = join(basePath, 'globalStorage', 'emptyWindowChatSessions');
  if (existsSync(emptyWindowPath)) {
    try {
      const sessionFiles = readdirSync(emptyWindowPath)
        .filter(f => f.endsWith('.json') || f.endsWith('.jsonl'));
      for (const sessionFile of sessionFiles) {
        const filePath = join(emptyWindowPath, sessionFile);
        const sessionId = basename(sessionFile).replace(/\.(json|jsonl)$/, '');
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
  // SQLite database (primary source for current sessions)
  try {
    const dbPath = join(basePath, 'opencode.db');
    if (existsSync(dbPath)) {
      const sessionIds = listOpenCodeDbSessionIds();
      for (const sessionId of sessionIds) {
        files.set(sessionId, `db::${sessionId}`);
      }
    }
  } catch (error) {
    console.error(`Error querying OpenCode DB from ${basePath}:`, error);
  }

  // JSON files (legacy fallback for pre-migration sessions)
  const sessionDir = join(basePath, 'storage', 'session');
  if (!existsSync(sessionDir)) return;

  try {
    const projectDirs = readdirSync(sessionDir);
    for (const projectDir of projectDirs) {
      const projectPath = join(sessionDir, projectDir);
      const stat = statSync(projectPath);
      if (!stat.isDirectory()) continue;

      const sessionFiles = readdirSync(projectPath).filter(f => f.endsWith('.json'));
      for (const sessionFile of sessionFiles) {
        const filePath = join(projectPath, sessionFile);
        const sessionId = basename(sessionFile, '.json');
        if (!files.has(sessionId)) {
          files.set(sessionId, filePath);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning OpenCode sessions at ${basePath}:`, error);
  }
}

function extractCodexSessionId(filePath: string): string | null {
  try {
    // Read only the first 256 bytes - the session ID appears early in session_meta line
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(256);
    const bytesRead = readSync(fd, buf, 0, 256, 0);
    closeSync(fd);
    const chunk = buf.toString('utf-8', 0, bytesRead);
    // Only extract from session_meta lines; match uuid-shaped id value
    if (!chunk.includes('"session_meta"')) return null;
    const match = chunk.match(/"id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
    if (match) return match[1];
  } catch {
    // Fall back to filename-based id
  }
  return null;
}

export function listSessions(source?: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode' | 'all'): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  const sources: SessionSource[] =
    source === 'all' || !source ? ['claude', 'copilot', 'codex', 'opencode', 'vscode'] : [source];

  for (const src of sources) {
    const files = findSessionFiles(src);

    for (const [sessionId, filePath] of files) {
      const cacheKey = getCacheKey(src, sessionId);
      let detail = sessionCache.get(cacheKey);

      if (!detail) {
        detail = parseSessionFile(filePath, src) || undefined;
        if (detail) {
          sessionCache.set(cacheKey, detail);
        }
      }

      if (detail) {
        sessions.push(getSessionSummary(detail));
      }
    }
  }

  // Sort by last activity, most recent first
  sessions.sort((a, b) =>
    new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  return sessions;
}

export function getSession(source: SessionSource, sessionId: string): SessionDetail | null {
  const cacheKey = getCacheKey(source, sessionId);
  let detail = sessionCache.get(cacheKey);

  if (!detail) {
    const files = findSessionFiles(source);
    const filePath = files.get(sessionId);

    if (!filePath) {
      return null;
    }

    detail = parseSessionFile(filePath, source) || undefined;

    if (detail) {
      sessionCache.set(cacheKey, detail);
    }
  }

  if (!detail) {
    return null;
  }

  // Always surface the raw log file location, even on a cache hit. listSessions()
  // shares this cache and stores details WITHOUT these fields, so we (re)compute
  // them here. OpenCode DB-backed sessions use a `db::<id>` sentinel (no real file).
  if (detail.logFilePath === undefined || detail.logAvailable === undefined) {
    const files = findSessionFiles(source);
    const filePath = files.get(sessionId);
    if (filePath) {
      const isDbBacked = filePath.startsWith('db::');
      if (isDbBacked && source === 'opencode') {
        const config = getServerConfig();
        detail.logFilePath = config.paths.opencode.length > 0
          ? resolve(config.paths.opencode[0])
          : filePath;
      } else {
        detail.logFilePath = filePath;
      }
      detail.logAvailable = !isDbBacked && existsSync(filePath);
    }
  }

  return detail;
}

export function getSessionMessages(
  source: SessionSource,
  sessionId: string,
  offset: number = 0,
  limit: number = 50
): Message[] {
  const detail = getSession(source, sessionId);

  if (!detail) {
    return [];
  }

  return detail.messages.slice(offset, offset + limit);
}

export function getSessionStats(source: SessionSource, sessionId: string) {
  const detail = getSession(source, sessionId);

  if (!detail) {
    return null;
  }

  return detail.stats;
}
