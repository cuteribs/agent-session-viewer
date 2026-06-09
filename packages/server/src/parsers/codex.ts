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

    // Build tool call / result maps from response_item events (first pass)
    const toolCallsByCallId = new Map<string, { name: string; args: Record<string, unknown> }>();
    const toolResultsByCallId = new Map<string, ToolResult>();
    const toolUsageMap = new Map<string, { count: number; successes: number }>();

    for (const event of events) {
      if (event.type !== 'response_item') continue;
      const item = event.payload as CodexResponseItem;

      if (item.type === 'function_call' || item.type === 'custom_tool_call') {
        const callId = item.call_id || '';
        const agentName = item.name || 'unknown';
        let args: Record<string, unknown> = {};
        const rawArgs = item.type === 'function_call' ? item.arguments : item.input;
        if (rawArgs) {
          try {
            args = JSON.parse(rawArgs);
          } catch {
            args = { raw: rawArgs };
          }
        }
        // function_call items represent subagent invocations; the display name
        // is 'subagent' and the actual function name is stored as agentName.
        toolCallsByCallId.set(callId, { name: 'subagent', args: { agentName, ...args } });
      }

      if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
        const callId = item.call_id || '';
        const toolName = toolCallsByCallId.get(callId)?.name || 'unknown';
        const rawOutput = item.output;
        const outputStr =
          rawOutput == null ? '' :
          typeof rawOutput === 'string' ? rawOutput :
          JSON.stringify(rawOutput, null, 2);
        toolResultsByCallId.set(callId, {
          toolCallId: callId,
          success: true,
          content: outputStr,
        });
        // function_call tools are tracked as 'subagent' in the usage map
        const usageKey = toolName === 'subagent' ? 'subagent' : toolName;
        const existing = toolUsageMap.get(usageKey) || { count: 0, successes: 0 };
        existing.count++;
        existing.successes++;
        toolUsageMap.set(usageKey, existing);
      }

      // tool_search_call: register as a named tool call
      if (item.type === 'tool_search_call' && item.call_id) {
        let args: Record<string, unknown> = {};
        if (item.arguments) {
          try { args = JSON.parse(item.arguments); } catch { args = { raw: item.arguments }; }
        } else if (item.action) {
          args = item.action as unknown as Record<string, unknown>;
        }
        toolCallsByCallId.set(item.call_id, { name: 'tool_search', args });
      }
      if (item.type === 'tool_search_output' && item.call_id) {
        const rawOutput = item.output;
        const outputStr =
          rawOutput == null ? '' :
          typeof rawOutput === 'string' ? rawOutput :
          JSON.stringify(rawOutput, null, 2);
        toolResultsByCallId.set(item.call_id, {
          toolCallId: item.call_id,
          success: true,
          content: outputStr,
        });
        const existing = toolUsageMap.get('tool_search') || { count: 0, successes: 0 };
        existing.count++;
        existing.successes++;
        toolUsageMap.set('tool_search', existing);
      }

      // web_search_call: track usage (no call_id, use action.query as key)
      if (item.type === 'web_search_call' && item.status === 'completed') {
        const existing = toolUsageMap.get('web_search') || { count: 0, successes: 0 };
        existing.count++;
        existing.successes++;
        toolUsageMap.set('web_search', existing);
      }
    }

    // Track apply_patch usage from patch_apply_end events
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

    // Collect token_count events indexed by position for lookahead pairing
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

    // XML wrappers injected by Codex — not real user/system content, skip entirely.
    const IGNORED_PREFIXES = ['<environment_context'];
    // These injections are not real user input but are shown as system messages.
    const SYSTEM_INJECTION_PREFIXES = [
      '<turn_aborted',
      '<permissions',
      '<agent_response',
      '<user_shell_command',
      '<subagent_notification',
    ];
    function shouldIgnore(text: string): boolean {
      const t = text.trimStart();
      return IGNORED_PREFIXES.some(p => t.startsWith(p));
    }
    function isSystemInjection(text: string): boolean {
      const t = text.trimStart();
      return SYSTEM_INJECTION_PREFIXES.some(p => t.startsWith(p));
    }

    function extractText(content: Array<{ type: string; text?: string }>): string {
      return content.map(c => c.text ?? '').join('').trim();
    }

    // Build messages from response_item events (primary source of truth).
    // event_msg events are only used for duration and session-level token totals.
    //
    // Ordering challenge: commentary assistant messages appear BEFORE the
    // function_call items they narrate.  We therefore buffer each assistant
    // message and flush it (with its following tool calls/results) only when
    // the NEXT assistant message or user message arrives.
    //
    //   commentary msg  ← buffer this
    //   function_call × N          → collect into bufToolCalls
    //   function_call_output × N   → collect into bufToolResults
    //   next msg arrives → flush: emit buffered msg (+toolCalls), then tool results

    const messages: Message[] = [];
    let totalDuration = 0;
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let cumulativeTotal = 0;

    // Buffered assistant message waiting to be flushed
    let bufMsg: Message | null = null;
    // Tool calls that belong to bufMsg (function_call items following it)
    let bufToolCalls: ToolCall[] = [];
    // Tool result messages that follow the tool calls above
    let bufToolResults: Message[] = [];

    // Track hierarchy: assistant → child of last user, tool → child of its assistant
    let lastUserOrSystemId: string | null = null;
    let lastAssistantId: string | null = null;

    function flushBuffer(): void {
      if (!bufMsg) return;
      if (bufToolCalls.length > 0) bufMsg.toolCalls = bufToolCalls;
      // Set tool results' parentId to their triggering assistant message
      for (const tr of bufToolResults) {
        tr.parentId = bufMsg.id;
      }
      messages.push(bufMsg);
      lastAssistantId = bufMsg.id;
      messages.push(...bufToolResults);
      bufMsg = null;
      bufToolCalls = [];
      bufToolResults = [];
    }

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === 'response_item') {
        const item = event.payload as CodexResponseItem;

        if (item.type === 'message') {
          const content = item.content || [];
          const text = extractText(content);

          if (item.role === 'developer') {
            if (!shouldIgnore(text)) {
              flushBuffer();
              const id = `system-${event.timestamp}`;
              lastUserOrSystemId = id;
              messages.push({
                id,
                parentId: null,
                role: 'system',
                content: text,
                timestamp: event.timestamp,
              });
            }

          } else if (item.role === 'user') {
            if (shouldIgnore(text)) {
              // drop silently
            } else if (isSystemInjection(text)) {
              flushBuffer();
              const id = `system-${event.timestamp}`;
              lastUserOrSystemId = id;
              messages.push({
                id,
                parentId: null,
                role: 'system',
                content: text,
                timestamp: event.timestamp,
              });
            } else if (text) {
              flushBuffer();
              const id = `user-${event.timestamp}`;
              lastUserOrSystemId = id;
              messages.push({
                id,
                parentId: null,
                role: 'user',
                content: text,
                timestamp: event.timestamp,
              });
            }

          } else if (item.role === 'assistant') {
            // Flush the previous buffered message before starting a new one
            flushBuffer();

            // Look ahead for the nearest token_count (final_answer only)
            let tokens: Message['tokens'] | undefined;
            if (item.phase !== 'commentary') {
              for (let j = i + 1; j < Math.min(events.length, i + 20); j++) {
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
            }

            bufMsg = {
              id: `assistant-${event.timestamp}`,
              parentId: lastUserOrSystemId,
              role: 'assistant',
              content: text,
              timestamp: event.timestamp,
              model,
              tokens,
            };
          }

        } else if (item.type === 'function_call' || item.type === 'custom_tool_call') {
          const callId = item.call_id || '';
          const toolInfo = toolCallsByCallId.get(callId);
          if (toolInfo) {
            bufToolCalls.push({ id: callId, name: toolInfo.name, arguments: toolInfo.args });
          }

        } else if (item.type === 'tool_search_call' && item.call_id) {
          const toolInfo = toolCallsByCallId.get(item.call_id);
          if (toolInfo) {
            bufToolCalls.push({ id: item.call_id, name: toolInfo.name, arguments: toolInfo.args });
          }

        } else if (item.type === 'web_search_call') {
          const query = item.action?.query || item.action?.queries?.[0] || '';
          bufToolCalls.push({
            id: `ws-${event.timestamp}`,
            name: 'web_search',
            arguments: { query },
          });

        } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output') {
          const callId = item.call_id || '';
          const result = toolResultsByCallId.get(callId);
          const toolInfo = toolCallsByCallId.get(callId);
          if (result) {
            bufToolResults.push({
              id: `${callId}-result`,
              parentId: null,
              role: 'tool',
              content: result.content,
              timestamp: event.timestamp,
              toolResult: result,
              toolCalls: toolInfo
                ? [{ id: callId, name: toolInfo.name, arguments: toolInfo.args }]
                : undefined,
            });
          }

        } else if (item.type === 'tool_search_output' && item.call_id) {
          const result = toolResultsByCallId.get(item.call_id);
          const toolInfo = toolCallsByCallId.get(item.call_id);
          if (result) {
            bufToolResults.push({
              id: `${item.call_id}-result`,
              parentId: null,
              role: 'tool',
              content: result.content,
              timestamp: event.timestamp,
              toolResult: result,
              toolCalls: toolInfo
                ? [{ id: item.call_id, name: toolInfo.name, arguments: toolInfo.args }]
                : undefined,
            });
          }
        }
        // reasoning: skip (internal chain-of-thought)
        continue;
      }

      if (event.type !== 'event_msg') continue;
      const msg = event.payload as CodexEventMsg;

      if (msg.type === 'task_complete' && msg.duration_ms) {
        totalDuration += msg.duration_ms;
      }
    }

    // Flush any remaining buffered message at end of stream
    flushBuffer();

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
