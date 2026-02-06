import chokidar from 'chokidar';
import { getServerConfig } from '../config.js';
import { invalidateSession, getSession } from './sessionService.js';
import { getSessionSummary, type SessionSource } from '../parsers/index.js';
import type { WSMessage } from '../types/index.js';
import { basename, dirname } from 'path';

type BroadcastFn = (message: WSMessage) => void;

let watcher: chokidar.FSWatcher | null = null;

export function initFileWatcher(broadcast: BroadcastFn): void {
  const config = getServerConfig();

  const watchPaths = [
    ...config.paths.claude.map(p => `${p}/**/*.jsonl`),
    ...config.paths.copilot.map(p => `${p}/**/events.jsonl`),
  ];

  console.log('Initializing file watcher for:', watchPaths);

  watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: config.watchDebounceMs,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', (path) => handleFileChange('add', path, broadcast, config))
    .on('change', (path) => handleFileChange('change', path, broadcast, config))
    .on('unlink', (path) => handleFileChange('unlink', path, broadcast, config))
    .on('error', (error) => console.error('Watcher error:', error));
}

function handleFileChange(
  event: 'add' | 'change' | 'unlink',
  filePath: string,
  broadcast: BroadcastFn,
  config: ReturnType<typeof getServerConfig>
): void {
  // Determine source from path
  const source = determineSource(filePath, config);
  if (!source) {
    return;
  }

  // Extract session ID
  const sessionId = extractSessionId(filePath, source);
  if (!sessionId) {
    return;
  }

  console.log(`File ${event}: ${filePath} (${source}:${sessionId})`);

  // Invalidate cache
  invalidateSession(source, sessionId);

  // Determine message type and send update
  let messageType: WSMessage['type'];
  let data: WSMessage['payload']['data'];

  switch (event) {
    case 'add':
      messageType = 'session_created';
      break;
    case 'change':
      messageType = 'session_updated';
      break;
    case 'unlink':
      messageType = 'session_deleted';
      break;
  }

  // For add/change, include updated session data
  if (event !== 'unlink') {
    const detail = getSession(source, sessionId);
    if (detail) {
      data = getSessionSummary(detail);
    }
  }

  broadcast({
    type: messageType,
    payload: {
      source,
      sessionId,
      data,
    },
  });
}

function determineSource(
  filePath: string,
  config: ReturnType<typeof getServerConfig>
): SessionSource | null {
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const claudePath of config.paths.claude) {
    if (normalizedPath.includes(claudePath.replace(/\\/g, '/'))) {
      return 'claude';
    }
  }

  for (const copilotPath of config.paths.copilot) {
    if (normalizedPath.includes(copilotPath.replace(/\\/g, '/'))) {
      return 'copilot';
    }
  }

  // Fallback: check path patterns
  if (normalizedPath.includes('.claude/projects')) {
    return 'claude';
  }
  if (normalizedPath.includes('.copilot/session-state')) {
    return 'copilot';
  }

  return null;
}

function extractSessionId(filePath: string, source: SessionSource): string | null {
  if (source === 'claude') {
    // Claude: /{project}/{sessionId}.jsonl
    return basename(filePath, '.jsonl');
  } else {
    // Copilot: /{sessionId}/events.jsonl
    return basename(dirname(filePath));
  }
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
