import chokidar from 'chokidar';
import { getServerConfig } from '../config.js';
import { invalidateSession, invalidateFileListCache, getSession } from './sessionService.js';
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
    ...config.paths.codex.map(p => `${p}/**/*.jsonl`),
    ...config.paths.opencode.map(p => `${p}/session/**/*.json`),
    ...config.paths.vscode.map(p => `${p}/workspaceStorage/**/chatSessions/*.{json,jsonl}`),
    ...config.paths.vscode.map(p => `${p}/globalStorage/emptyWindowChatSessions/*.{json,jsonl}`),
  ];

  console.log('Initializing file watcher for:', watchPaths);

  // Use stat-based polling so the watcher never opens or locks any watched
  // file.  On Windows, chokidar's default fs.watch / awaitWriteFinish mode
  // holds file handles that block other processes (e.g. Copilot) from
  // appending to events.jsonl.  Polling uses fs.stat only — no file open,
  // no lock.
  watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    usePolling: true,
    interval: config.watchDebounceMs,
    binaryInterval: config.watchDebounceMs,
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
  // For add/unlink, the file list itself changed — invalidate the per-source list cache
  if (event === 'add' || event === 'unlink') {
    invalidateFileListCache(source);
  }

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

  for (const codexPath of config.paths.codex) {
    if (normalizedPath.includes(codexPath.replace(/\\/g, '/'))) {
      return 'codex';
    }
  }

  for (const opencodePath of config.paths.opencode) {
    if (normalizedPath.includes(opencodePath.replace(/\\/g, '/'))) {
      return 'opencode';
    }
  }

  for (const vscodePath of config.paths.vscode) {
    if (normalizedPath.includes(vscodePath.replace(/\\/g, '/'))) {
      return 'vscode';
    }
  }

  // Fallback: check path patterns
  if (normalizedPath.includes('.claude/projects')) {
    return 'claude';
  }
  if (normalizedPath.includes('.copilot/session-state')) {
    return 'copilot';
  }
  if (normalizedPath.includes('.codex/sessions')) {
    return 'codex';
  }
  if (normalizedPath.includes('.local/share/opencode/storage')) {
    return 'opencode';
  }
  if (normalizedPath.includes('\\.local\\share\\opencode\\storage')) {
    return 'opencode';
  }
  if (normalizedPath.includes('/workspaceStorage/') && normalizedPath.includes('/chatSessions/')) {
    return 'vscode';
  }
  if (normalizedPath.includes('/globalStorage/emptyWindowChatSessions/')) {
    return 'vscode';
  }

  return null;
}

function extractSessionId(filePath: string, source: SessionSource): string | null {
  if (source === 'claude') {
    return basename(filePath, '.jsonl');
  } else if (source === 'codex') {
    return basename(filePath, '.jsonl');
  } else if (source === 'copilot') {
    return basename(dirname(filePath));
  } else if (source === 'opencode') {
    return basename(filePath, '.json');
  } else if (source === 'vscode') {
    return basename(filePath).replace(/\.(json|jsonl)$/, '');
  }
  return null;
}

export function isWatcherRunning(): boolean {
  return watcher !== null;
}

export function stopFileWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
