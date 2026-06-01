import { parseClaudeSessionFile, getClaudeSessionSummary } from './claude.js';
import { parseCopilotSessionFile, getCopilotSessionSummary } from './copilot.js';
import { parseCodexSessionFile, getCodexSessionSummary } from './codex.js';
import { parseOpenCodeSessionFile, getOpenCodeSessionSummary, listOpenCodeDbSessionIds } from './opencode.js';
import { parseVSCodeSessionFile, getVSCodeSessionSummary } from './vscode.js';
import type { SessionDetail, SessionSummary } from '../types/index.js';

export type SessionSource = 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode';

export function parseSessionFile(
  filePath: string,
  source: SessionSource
): SessionDetail | null {
  switch (source) {
    case 'claude':
      return parseClaudeSessionFile(filePath);
    case 'copilot':
      return parseCopilotSessionFile(filePath);
    case 'codex':
      return parseCodexSessionFile(filePath);
    case 'opencode':
      return parseOpenCodeSessionFile(filePath);
    case 'vscode':
      return parseVSCodeSessionFile(filePath);
    default:
      console.error(`Unknown session source: ${source}`);
      return null;
  }
}

export function getSessionSummary(detail: SessionDetail): SessionSummary {
  switch (detail.source) {
    case 'claude':
      return getClaudeSessionSummary(detail);
    case 'copilot':
      return getCopilotSessionSummary(detail);
    case 'codex':
      return getCodexSessionSummary(detail);
    case 'opencode':
      return getOpenCodeSessionSummary(detail);
    case 'vscode':
      return getVSCodeSessionSummary(detail);
    default:
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
}

export { parseClaudeSessionFile, parseCopilotSessionFile, parseCodexSessionFile, parseOpenCodeSessionFile, parseVSCodeSessionFile, listOpenCodeDbSessionIds };

