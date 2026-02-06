import { readdirSync, statSync, existsSync } from 'fs';
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
  const paths = source === 'claude' ? config.paths.claude : config.paths.copilot;
  const files = new Map<string, string>();

  for (const basePath of paths) {
    if (!existsSync(basePath)) {
      continue;
    }

    if (source === 'claude') {
      // Claude: ~/.claude/projects/{encoded-project-path}/*.jsonl
      findClaudeSessionFiles(basePath, files);
    } else {
      // Copilot: ~/.copilot/session-state/{session-id}/events.jsonl
      findCopilotSessionFiles(basePath, files);
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

export function listSessions(source?: 'claude' | 'copilot' | 'all'): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  const sources: SessionSource[] =
    source === 'all' || !source ? ['claude', 'copilot'] : [source];

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
