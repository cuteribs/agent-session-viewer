import { readFileSync } from 'fs';
import { basename } from 'path';
import type {
  CodexEvent,
  CodexSessionMeta,
  CodexEventMsg,
  CodexTokenUsage,
  CodexResponseItem,
  CodexTurnContext,
  SessionSummary,
  SessionDetail,
  Message,
  ToolCall,
  ToolResult,
  SessionStats,
  ToolUsageSummary,
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

export function parseCodexSessionFile(filePath: string): SessionDetail | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return null;
    }

    const events: CodexEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        continue;
      }
    }

    if (events.length === 0) {
      return null;
    }

    // Extract session metadata
    const metaEvent = events.find(e => e.type === 'session_meta');
    const meta = metaEvent?.payload as CodexSessionMeta | undefined;
    const sessionId = meta?.id || basename(filePath, '.jsonl');
    const projectPath = meta?.cwd || '';
    const project = projectPath ? basename(projectPath) : basename(filePath, '.jsonl');

    // Extract model from turn_context
    let model: string | undefined;
    for (const event of events) {
      if (event.type === 'turn_context') {
        const ctx = event.payload as CodexTurnContext;
        if (ctx.model) {
          model = ctx.model;
          break;
        }
      }
    }

    // Build tool call / result maps from response_item events
    const toolCallsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();
    const toolResultsByCallId = new Map<string, ToolResult>();
    const toolUsageMap = new Map<string, { count: number; successes: number }>();

    for (const event of events) {
      if (event.type !== 'response_item') continue;
      const item = event.payload as CodexResponseItem;

      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        const callId = item.call_id || '';
        const name = item.name || 'unknown';
        let args: Record<string, unknown> = {};
        const rawArgs = item.type === 'function_call' ? item.arguments : item.input;
        if (rawArgs) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = { raw: rawArgs };
          }
        }
        toolCallsByCallId.set(callId, { name, args });
      }

      if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
        const callId = item.call_id || '';
        const toolName = toolCallsByCallId.get(callId)?.name || 'unknown';
        const success = true; // Codex doesn't track explicit failure in output events
        const rawOutput = item.output;
        const outputStr =
          rawOutput == null ? '' :
          typeof rawOutput === 'string' ? rawOutput :
          JSON.stringify(rawOutput, null, 2);
        toolResultsByCallId.set(callId, {
          toolCallId: callId,
          success,
          content: outputStr,
        });

        const existing = toolUsageMap.get(toolName) || { count: 0, successes: 0 };
        existing.count++;
        if (success) existing.successes++;
        toolUsageMap.set(toolName, existing);
      }
    }

    // Also track tool usage from patch_apply_end events
    for (const event of events) {
      if (event.type !== 'event_msg') continue;
      const msg = event.payload as CodexEventMsg;
      if (msg.type === 'patch_apply_end' && msg.call_id) {
        const existing = toolUsageMap.get('apply_patch') || { count: 0, successes: 0 };
        existing.count++;
        if (msg.success !== false) existing.successes++;
        toolUsageMap.set('apply_patch', existing);
      }
    }

    // Collect token_count events indexed by their position in the event array
    // to pair with agent_messages
    const tokenCountsByIndex = new Map<number, CodexTokenUsage>();
    let finalTotalUsage: CodexTokenUsage | undefined;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (event.type !== 'event_msg') continue;
      const msg = event.payload as CodexEventMsg;
      if (msg.type === 'token_count' && msg.info?.last_token_usage) {
        tokenCountsByIndex.set(i, msg.info.last_token_usage);
        if (msg.info.total_token_usage) {
          finalTotalUsage = msg.info.total_token_usage;
        }
      }
    }

    // Build messages
    const messages: Message[] = [];
    let totalDuration = 0;
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let cumulativeTotal = 0;

    // Track current turn's tool calls to attach to the next agent message
    let pendingToolCalls: ToolCall[] = [];

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'response_item') {
        const item = event.payload as CodexResponseItem;
        if (item.type === 'function_call' || item.type === 'custom_tool_call') {
          const callId = item.call_id || '';
          const toolInfo = toolCallsByCallId.get(callId);
          if (toolInfo) {
            pendingToolCalls.push({ id: callId, name: toolInfo.name, arguments: toolInfo.args });
          }
        } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
          const callId = item.call_id || '';
          const result = toolResultsByCallId.get(callId);
          if (result) {
            messages.push({
              id: `${callId}-result`,
              parentId: null,
              role: 'tool',
              content: result.content,
              timestamp: event.timestamp,
              toolResult: result,
            });
          }
        }
      }

      if (event.type !== 'event_msg') continue;
      const msg = event.payload as CodexEventMsg;

      if (msg.type === 'user_message') {
        messages.push({
          id: `user-${event.timestamp}`,
          parentId: null,
          role: 'user',
          content: msg.message || '',
          timestamp: event.timestamp,
        });
        pendingToolCalls = [];
      } else if (msg.type === 'agent_message') {
        const toolCalls = pendingToolCalls.length > 0 ? [...pendingToolCalls] : undefined;
        pendingToolCalls = [];

        // Find the nearest following token_count for per-message token data
        let tokens: Message['tokens'] | undefined;
        for (let j = i + 1; j < Math.min(events.length, i + 10); j++) {
          const tc = tokenCountsByIndex.get(j);
          if (tc) {
            const msgCost = calculateCost(
              { input: tc.input_tokens, output: tc.output_tokens, cacheRead: tc.cached_input_tokens },
              model
            );
            tokens = {
              input: tc.input_tokens,
              output: tc.output_tokens,
              cacheRead: tc.cached_input_tokens,
              cost: msgCost,
            };
            inputPerMessage.push(tc.input_tokens);
            outputPerMessage.push(tc.output_tokens);
            cumulativeTotal += tc.input_tokens + tc.output_tokens;
            cumulativeTokens.push(cumulativeTotal);
            break;
          }
        }

        messages.push({
          id: `agent-${event.timestamp}`,
          parentId: null,
          role: 'assistant',
          content: msg.message || '',
          timestamp: event.timestamp,
          model,
          tokens,
          toolCalls,
        });
      } else if (msg.type === 'task_complete' && msg.duration_ms) {
        totalDuration += msg.duration_ms;
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

    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;

    const tokenStats = finalTotalUsage
      ? {
          totalInput: finalTotalUsage.input_tokens,
          totalOutput: finalTotalUsage.output_tokens,
          totalCacheRead: finalTotalUsage.cached_input_tokens,
          totalCacheCreation: 0,
          totalCost: calculateCost(
            { input: finalTotalUsage.input_tokens, output: finalTotalUsage.output_tokens, cacheRead: finalTotalUsage.cached_input_tokens },
            model
          ),
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        }
      : undefined;

    const totalTokens = finalTotalUsage
      ? finalTotalUsage.input_tokens + finalTotalUsage.output_tokens
      : undefined;

    const stats: SessionStats = {
      messageCount: messages.length,
      userMessages,
      assistantMessages,
      tokens: tokenStats,
      tools: toolUsage.map(t => ({ name: t.name, count: t.count, successRate: t.successRate })),
      duration: totalDuration,
    };

    const startTime = messages[0]?.timestamp || meta?.timestamp || new Date().toISOString();
    const lastActivity = messages[messages.length - 1]?.timestamp || startTime;

    return {
      id: sessionId,
      source: 'codex',
      project,
      projectPath,
      startTime,
      lastActivity,
      messageCount: messages.length,
      totalTokens,
      model,
      messages,
      stats,
      toolUsage,
    };
  } catch (error) {
    console.error(`Error parsing Codex session file ${filePath}:`, error);
    return null;
  }
}

export function getCodexSessionSummary(detail: SessionDetail): SessionSummary {
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
