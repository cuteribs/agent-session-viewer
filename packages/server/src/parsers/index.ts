import { parseClaudeSessionFile, getClaudeSessionSummary } from './claude.js';
import { parseCopilotSessionFile, getCopilotSessionSummary } from './copilot.js';
import type { SessionDetail, SessionSummary } from '../types/index.js';

export type SessionSource = 'claude' | 'copilot';

export function parseSessionFile(
  filePath: string,
  source: SessionSource
): SessionDetail | null {
  switch (source) {
    case 'claude':
      return parseClaudeSessionFile(filePath);
    case 'copilot':
      return parseCopilotSessionFile(filePath);
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

export { parseClaudeSessionFile, parseCopilotSessionFile };
