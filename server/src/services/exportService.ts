import type { SessionDetail, Message } from '../types/index.js';

export function exportToCSV(session: SessionDetail): string {
  const headers = [
    'timestamp',
    'role',
    'content',
    'input_tokens',
    'output_tokens',
    'cache_read',
    'cache_creation',
    'tool_name',
    'tool_success',
  ];

  const rows: string[][] = [headers];

  for (const message of session.messages) {
    const toolName = message.toolCalls?.[0]?.name || message.toolResult?.toolCallId || '';
    const toolSuccess =
      message.toolResult !== undefined
        ? message.toolResult.success
          ? 'true'
          : 'false'
        : '';

    const row = [
      message.timestamp,
      message.role,
      escapeCSV(message.content),
      message.tokens?.input?.toString() || '0',
      message.tokens?.output?.toString() || '0',
      message.tokens?.cacheRead?.toString() || '0',
      message.tokens?.cacheCreation?.toString() || '0',
      toolName,
      toolSuccess,
    ];

    rows.push(row);
  }

  return rows.map(row => row.join(',')).join('\n');
}

export function exportToJSON(session: SessionDetail): string {
  return JSON.stringify(session, null, 2);
}

export interface ExportSummary {
  sessionId: string;
  source: string;
  project: string;
  projectPath: string;
  startTime: string;
  lastActivity: string;
  messageCount: number;
  totalTokens?: number;
  model?: string;
  stats: SessionDetail['stats'];
  toolUsage: SessionDetail['toolUsage'];
}

export function exportSummaryToJSON(session: SessionDetail): string {
  const summary: ExportSummary = {
    sessionId: session.id,
    source: session.source,
    project: session.project,
    projectPath: session.projectPath,
    startTime: session.startTime,
    lastActivity: session.lastActivity,
    messageCount: session.messageCount,
    totalTokens: session.totalTokens,
    model: session.model,
    stats: session.stats,
    toolUsage: session.toolUsage,
  };

  return JSON.stringify(summary, null, 2);
}

function escapeCSV(value: string): string {
  // Replace newlines with spaces and escape quotes
  const escaped = value.replace(/\n/g, ' ').replace(/"/g, '""');

  // Wrap in quotes if contains comma, quote, or is multiline
  if (escaped.includes(',') || escaped.includes('"') || escaped.includes('\n')) {
    return `"${escaped}"`;
  }

  return escaped;
}
