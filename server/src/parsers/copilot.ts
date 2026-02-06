import { readFileSync } from 'fs';
import { basename, dirname } from 'path';
import type {
  CopilotEvent,
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolResult,
  SessionStats,
  ToolUsageSummary,
} from '../types/index.js';

export function parseCopilotSessionFile(filePath: string): SessionDetail | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return null;
    }

    const events: CopilotEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    if (events.length === 0) {
      return null;
    }

    // Find session.start event for metadata
    const startEvent = events.find(e => e.type === 'session.start');
    const sessionId = startEvent?.data.sessionId || basename(dirname(filePath));
    const projectPath = startEvent?.data.context?.cwd || dirname(filePath);
    const project = basename(projectPath);

    // Parse messages and tool events
    const messages: Message[] = [];
    const toolUsageMap = new Map<string, { count: number; successes: number }>();
    const toolResultsById = new Map<string, ToolResult>();
    let model: string | undefined;

    // First pass: collect tool results
    for (const event of events) {
      if (event.type === 'tool.execution_complete' && event.data.toolCallId) {
        toolResultsById.set(event.data.toolCallId, {
          toolCallId: event.data.toolCallId,
          success: event.data.success ?? true,
          content: event.data.result?.content || '',
        });

        // Track tool usage
        const toolName = event.data.toolName || 'unknown';
        const existing = toolUsageMap.get(toolName) || { count: 0, successes: 0 };
        existing.count++;
        if (event.data.success !== false) {
          existing.successes++;
        }
        toolUsageMap.set(toolName, existing);
      }

      if (event.type === 'session.model_change' && event.data.newModel) {
        model = event.data.newModel;
      }
    }

    // Second pass: build messages
    for (const event of events) {
      if (event.type === 'user.message') {
        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'user',
          content: event.data.content || event.data.transformedContent || '',
          timestamp: event.timestamp,
        });
      } else if (event.type === 'assistant.message') {
        const toolCalls: ToolCall[] = (event.data.toolRequests || []).map(tr => ({
          id: tr.toolCallId,
          name: tr.name,
          arguments: tr.arguments,
        }));

        let content = '';
        if (event.data.reasoningText) {
          content = event.data.reasoningText;
        }

        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'assistant',
          content,
          timestamp: event.timestamp,
          model,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      } else if (event.type === 'tool.execution_complete') {
        const result = toolResultsById.get(event.data.toolCallId || '');
        if (result) {
          messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'tool',
            content: result.content,
            timestamp: event.timestamp,
            toolResult: result,
          });
        }
      } else if (event.type === 'session.error') {
        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'system',
          content: `Error: ${event.data.errorType || 'Unknown'} - ${event.data.message || ''}`,
          timestamp: event.timestamp,
        });
      }
    }

    // Build tool usage summary
    const toolUsage: ToolUsageSummary[] = Array.from(toolUsageMap.entries()).map(
      ([name, { count, successes }]) => ({
        name,
        count,
        successRate: count > 0 ? successes / count : 0,
      })
    );

    // Calculate stats
    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;

    // Calculate duration from timestamps
    let duration = 0;
    if (messages.length >= 2) {
      const start = new Date(messages[0].timestamp).getTime();
      const end = new Date(messages[messages.length - 1].timestamp).getTime();
      duration = end - start;
    }

    const stats: SessionStats = {
      messageCount: messages.length,
      userMessages,
      assistantMessages,
      tools: toolUsage.map(t => ({
        name: t.name,
        count: t.count,
        successRate: t.successRate,
      })),
      duration,
    };

    const startTime = messages[0]?.timestamp || new Date().toISOString();
    const lastActivity = messages[messages.length - 1]?.timestamp || startTime;

    return {
      id: sessionId,
      source: 'copilot',
      project,
      projectPath,
      startTime,
      lastActivity,
      messageCount: messages.length,
      model,
      messages,
      stats,
      toolUsage,
    };
  } catch (error) {
    console.error(`Error parsing Copilot session file ${filePath}:`, error);
    return null;
  }
}

export function getCopilotSessionSummary(detail: SessionDetail): SessionSummary {
  return {
    id: detail.id,
    source: detail.source,
    project: detail.project,
    projectPath: detail.projectPath,
    startTime: detail.startTime,
    lastActivity: detail.lastActivity,
    messageCount: detail.messageCount,
    model: detail.model,
  };
}
