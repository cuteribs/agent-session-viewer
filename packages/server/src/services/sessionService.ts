import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { join, basename } from 'path';
import { getServerConfig } from '../config.js';
import { parseSessionFile, getSessionSummary, type SessionSource } from '../parsers/index.js';
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
  const paths =
    source === 'claude'
      ? config.paths.claude
      : source === 'copilot'
        ? config.paths.copilot
        : config.paths.codex;
  const files = new Map<string, string>();

  for (const basePath of paths) {
    if (!existsSync(basePath)) {
      continue;
    }

    if (source === 'claude') {
      // Claude: ~/.claude/projects/{encoded-project-path}/*.jsonl
      findClaudeSessionFiles(basePath, files);
    } else if (source === 'copilot') {
      // Copilot: ~/.copilot/session-state/{session-id}/events.jsonl
      findCopilotSessionFiles(basePath, files);
    } else {
      // Codex: ~/.codex/sessions/{year}/{month}/{day}/*.jsonl
      findCodexSessionFiles(basePath, files);
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

export function listSessions(source?: 'claude' | 'copilot' | 'codex' | 'all'): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  const sources: SessionSource[] =
    source === 'all' || !source ? ['claude', 'copilot', 'codex'] : [source];

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

  if (detail) {
    return detail;
  }

  const files = findSessionFiles(source);
  const filePath = files.get(sessionId);

  if (!filePath) {
    return null;
  }

  detail = parseSessionFile(filePath, source) || undefined;

  if (detail) {
    sessionCache.set(cacheKey, detail);
  }

  return detail || null;
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
