import { readFileSync } from 'fs';
import { basename, dirname } from 'path';
import type {
  CopilotEvent,
  SessionSummary,
  SessionDetail,
  SubAgent,
  Message,
  ToolCall,
  ToolResult,
  SessionStats,
  ToolUsageSummary,
} from '../types/index.js';
import { calculateCost } from '../pricing.js';

// Calibrated chars-per-token ratio for Copilot sessions.
// Code/JSON-heavy content tokenises at ~3 chars/token (calibrated against
// session.compaction_start.conversationTokens ground-truth data).
const CHARS_PER_TOKEN = 3;

// Default token overheads used when compaction_start events are absent
const DEFAULT_SYSTEM_TOKENS = 9278;
const DEFAULT_TOOL_DEFS_TOKENS = 7325;

function getPatchedTokenUsage(event: CopilotEvent): { input: number; output: number; cacheRead: number } | null {
  const patchedData = event.data as typeof event.data & {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
  };
  const input = patchedData.input_tokens;
  const output = patchedData.output_tokens;

  if (typeof input !== 'number' || typeof output !== 'number') {
    return null;
  }

  return {
    input,
    output,
    cacheRead: typeof patchedData.cache_read_tokens === 'number' ? patchedData.cache_read_tokens : 0,
  };
}

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

    // Derive initial model from session.start.selectedModel
    let model: string | undefined = startEvent?.data.selectedModel;

    // ---------------------------------------------------------------
    // Collect fixed overhead from the first session.compaction_start
    // (systemTokens + toolDefinitionsTokens).  These are constant
    // across all API calls in a session.
    // ---------------------------------------------------------------
    let systemOverheadTokens = DEFAULT_SYSTEM_TOKENS;
    let toolDefsOverhead = DEFAULT_TOOL_DEFS_TOKENS;
    let toolDefsSet = false;

    // ---------------------------------------------------------------
    // First pass: collect fixed overheads, tool results, model changes
    // ---------------------------------------------------------------
    const toolUsageMap = new Map<string, { count: number; successes: number }>();
    const toolResultsById = new Map<string, ToolResult>();
    /** toolCallId → toolName  (populated from tool.execution_start, used in tool.execution_complete) */
    const toolNamesById = new Map<string, string>();
    const subAgentMap = new Map<string, SubAgent>();
    const subAgentByName = new Map<string, SubAgent>();

    for (const event of events) {
      if (event.type === 'session.compaction_start' && event.data.systemTokens && !toolDefsSet) {
        // Use the server-reported values if available (most accurate)
        systemOverheadTokens = event.data.systemTokens;
        toolDefsOverhead = event.data.toolDefinitionsTokens ?? DEFAULT_TOOL_DEFS_TOKENS;
        toolDefsSet = true;
      }

      // Capture tool name from the start event (not available on complete event)
      if (event.type === 'tool.execution_start' && event.data.toolCallId && event.data.toolName) {
        toolNamesById.set(event.data.toolCallId, event.data.toolName);
      }

      if (event.type === 'tool.execution_complete' && event.data.toolCallId) {
        toolResultsById.set(event.data.toolCallId, {
          toolCallId: event.data.toolCallId,
          success: event.data.success ?? true,
          content: event.data.result?.content || '',
        });

        // Prefer name from the paired start event, fall back to data.toolName
        const toolName = toolNamesById.get(event.data.toolCallId) || event.data.toolName || 'unknown';
        const existing = toolUsageMap.get(toolName) || { count: 0, successes: 0 };
        existing.count++;
        if (event.data.success !== false) {
          existing.successes++;
        }
        toolUsageMap.set(toolName, existing);
      }

      if (event.type === 'tool.execution_start' && event.data.toolName === 'task') {
        const toolCallId = event.data.toolCallId || '';
        const args = event.data.arguments || {};
        const agentId = String(args.name || toolCallId.substring(0, 8));
        const agent: SubAgent = {
          id: toolCallId,
          agentId,
          agentType: String(args.agent_type || 'task'),
          agentDisplayName: String(args.agent_type || 'Agent'),
          description: args.description ? String(args.description) : undefined,
          prompt: args.prompt ? String(args.prompt) : undefined,
          status: 'started',
          startTime: event.timestamp,
        };
        subAgentMap.set(toolCallId, agent);
        subAgentByName.set(agentId, agent);
      }

      if (event.type === 'subagent.started' && event.data.toolCallId) {
        const agent = subAgentMap.get(event.data.toolCallId);
        if (agent) {
          if (event.data.agentDisplayName) {
            agent.agentDisplayName = event.data.agentDisplayName;
          }
          if (event.data.agentDescription) {
            agent.description = event.data.agentDescription;
          }
        }
      }

      if (event.type === 'subagent.completed' && event.data.toolCallId) {
        const agent = subAgentMap.get(event.data.toolCallId);
        if (agent) {
          const patchedTokens = getPatchedTokenUsage(event);
          agent.status = 'completed';
          agent.model = event.data.model;
          agent.totalTokens = patchedTokens
            ? patchedTokens.input + patchedTokens.output
            : event.data.totalTokens;
          agent.totalToolCalls = event.data.totalToolCalls;
          agent.durationMs = event.data.durationMs;
          agent.endTime = event.timestamp;
        }
      }

      if (event.type === 'tool.execution_complete' && event.data.toolTelemetry?.properties?.agent_id) {
        const agentId = event.data.toolTelemetry.properties.agent_id;
        const status = event.data.toolTelemetry.properties.status;
        const agent = subAgentByName.get(agentId);
        if (agent) {
          if (status === 'completed') {
            agent.status = 'completed';
          } else if (status === 'failed' || event.data.success === false) {
            agent.status = 'failed';
          }

          if ((status === 'completed' || status === 'failed' || event.data.success === false) && !agent.endTime) {
            agent.endTime = event.timestamp;
          }

          const resultContent = event.data.result?.detailedContent || event.data.result?.content;
          if (resultContent && !agent.result) {
            agent.result = resultContent;
          }
        }
      }

      if (event.type === 'session.model_change' && event.data.newModel) {
        model = event.data.newModel;
      }
    }

    // ---------------------------------------------------------------
    // Detect patched-token mode: if any assistant.message carries
    // input_tokens + output_tokens, the whole session uses exact values
    // and we never fall back to estimation.
    // ---------------------------------------------------------------
    const hasPatchedTokens = events.some(e => {
      if (e.type !== 'assistant.message') return false;
      const d = e.data as typeof e.data & { input_tokens?: unknown; output_tokens?: unknown };
      return typeof d.input_tokens === 'number' && typeof d.output_tokens === 'number';
    });

    // ---------------------------------------------------------------
    // Second pass: build messages + token usage
    // ---------------------------------------------------------------
    const messages: Message[] = [];

    // Token arrays for charts (one entry per assistant API call)
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    // Accumulate exact output tokens from subagent assistant.message events
    // (used when subagent.completed carries no token data)
    const subAgentOutputMap = new Map<string, number>(); // agentId → summed outputTokens

    // Per-subagent input estimation state (mirrors estimation-mode vars for main agent)
    // Seeded with task prompt length so the first turn includes the initial context.
    const subAgentConvChars = new Map<string, number>();
    const subAgentPrevInputTokens = new Map<string, number>();
    // Accumulated estimated input tokens and cost per subagent (for subagent.completed rollup)
    const subAgentInputMap = new Map<string, number>();
    const subAgentCostMap = new Map<string, number>();
    for (const [id, agent] of subAgentMap) {
      subAgentConvChars.set(id, (agent.prompt ?? '').length);
    }

    // Estimation-mode only: running conversation context in characters.
    let conversationChars = 0;
    // Current system prompt char count (overwritten by each system.message event)
    let activeSystemChars = 0;
    // Previous turn's input token count — used to estimate cache hits.
    let prevInputTokens = 0;
    let totalCacheRead = 0;

    for (const event of events) {
      // Track system prompt changes (estimation mode only, but harmless to always run)
      if (event.type === 'system.message' && event.data.content) {
        activeSystemChars = event.data.content.length;
        continue;
      }

      // After successful compaction the conversation history is reset.
      if (event.type === 'session.compaction_complete' && event.data.success) {
        if (!hasPatchedTokens) {
          conversationChars = (event.data.summaryContent as string | undefined ?? '').length;
          prevInputTokens = 0;
        }
        continue;
      }

      if (event.type === 'user.message') {
        const userContent = event.data.content || event.data.transformedContent || '';
        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'user',
          content: userContent,
          timestamp: event.timestamp,
        });
        if (!hasPatchedTokens) {
          conversationChars += userContent.length;
        }

      } else if (event.type === 'assistant.message') {
        const toolCalls: ToolCall[] = (event.data.toolRequests || []).map(tr => ({
          id: tr.toolCallId,
          name: tr.name,
          arguments: tr.arguments,
        }));
        const msgContent = event.data.reasoningText || '';

        // ── Route subagent-owned messages to that agent's message log ──
        if (event.agentId && subAgentMap.has(event.agentId)) {
          const agent = subAgentMap.get(event.agentId)!;
          if (!agent.messages) agent.messages = [];
          const subOutputTok = typeof event.data.outputTokens === 'number' ? event.data.outputTokens : 0;
          const subMsgModel = event.data.model || model;
          // Backfill agent.model from first message if not yet set
          if (!agent.model && subMsgModel) {
            agent.model = subMsgModel;
          }

          // ── Estimate subagent input from accumulated conversation context ──
          // Uses the same chars-per-token ratio and cache heuristic as the main agent.
          const agentConvChars = subAgentConvChars.get(event.agentId) ?? 0;
          const prevSubIn = subAgentPrevInputTokens.get(event.agentId) ?? 0;
          const estSubInput = Math.round(agentConvChars / CHARS_PER_TOKEN);
          const estSubCacheRead = prevSubIn === 0 ? 0 : (systemOverheadTokens + toolDefsOverhead);
          const subMsgCost = calculateCost(
            { input: estSubInput, output: subOutputTok, cacheRead: estSubCacheRead },
            subMsgModel
          );
          // Advance conversation context for next turn
          const addedChars = msgContent.length +
            (event.data.toolRequests && event.data.toolRequests.length > 0
              ? JSON.stringify(event.data.toolRequests).length
              : 0);
          subAgentConvChars.set(event.agentId, agentConvChars + addedChars);
          subAgentPrevInputTokens.set(event.agentId, estSubInput + estSubCacheRead);
          // Accumulate per-subagent totals for subagent.completed rollup
          subAgentInputMap.set(event.agentId, (subAgentInputMap.get(event.agentId) ?? 0) + estSubInput);
          subAgentCostMap.set(event.agentId, (subAgentCostMap.get(event.agentId) ?? 0) + subMsgCost);

          agent.messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model: subMsgModel,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens: (estSubInput > 0 || subOutputTok > 0) ? {
              input: estSubInput,
              output: subOutputTok,
              cacheRead: estSubCacheRead,
              estimated: true,
              cost: subMsgCost,
            } : undefined,
          });
          // Accumulate exact output tokens for this subagent across all its turns
          if (subOutputTok > 0) {
            subAgentOutputMap.set(event.agentId, (subAgentOutputMap.get(event.agentId) ?? 0) + subOutputTok);
          }

        } else if (hasPatchedTokens) {
          // ── Main agent — Patched mode ─────────────────────────────────
          // Only attribute tokens to main-agent turns: those that carry
          // both data.turnId and exact patched token fields.
          const patchedTokens = getPatchedTokenUsage(event);
          const isMainTurn = event.data.turnId != null && patchedTokens != null;

          let msgTokens: Message['tokens'] | undefined;
          if (isMainTurn && patchedTokens) {
            const msgCost = calculateCost(
              { input: patchedTokens.input, output: patchedTokens.output, cacheRead: patchedTokens.cacheRead },
              model
            );
            msgTokens = {
              input: patchedTokens.input,
              output: patchedTokens.output,
              cacheRead: patchedTokens.cacheRead,
              estimated: false,
              cost: msgCost,
            };
            inputPerMessage.push(patchedTokens.input);
            outputPerMessage.push(patchedTokens.output);
            totalInput += patchedTokens.input;
            totalOutput += patchedTokens.output;
            totalCacheRead += patchedTokens.cacheRead;
            totalCost += msgCost;
            cumulativeTokens.push(totalInput + totalOutput);
          }

          messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens: msgTokens,
          });

        } else {
          // ── Main agent — Estimation mode ─────────────────────────────
          // Copilot caches the system prompt + tool definitions on every
          // call after the first.  The non-cached input is the growing
          // conversation context.
          const sysTokens = activeSystemChars > 0
            ? Math.round(activeSystemChars / CHARS_PER_TOKEN)
            : systemOverheadTokens;

          const estInputTokens = Math.round(conversationChars / CHARS_PER_TOKEN);
          const estCacheRead = prevInputTokens === 0 ? 0 : (sysTokens + toolDefsOverhead);
          const exactOutputTokens = event.data.outputTokens ?? 0;

          const msgCost = calculateCost(
            { input: estInputTokens, output: exactOutputTokens, cacheRead: estCacheRead },
            model
          );

          inputPerMessage.push(estInputTokens);
          outputPerMessage.push(exactOutputTokens);
          totalInput += estInputTokens;
          totalOutput += exactOutputTokens;
          totalCacheRead += estCacheRead;
          totalCost += msgCost;
          cumulativeTokens.push(totalInput + totalOutput);

          // After this API call the assistant response is added to context
          conversationChars += msgContent.length;
          if (event.data.toolRequests && event.data.toolRequests.length > 0) {
            conversationChars += JSON.stringify(event.data.toolRequests).length;
          }
          // Mark that at least one turn has been seen (so subsequent turns use cache estimate)
          prevInputTokens = estInputTokens + estCacheRead;

          messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens: {
              input: estInputTokens,
              output: exactOutputTokens,
              cacheRead: estCacheRead,
              estimated: true,
              cost: msgCost,
            },
          });
        }

      } else if (event.type === 'tool.execution_complete') {
        const result = toolResultsById.get(event.data.toolCallId || '');
        if (result) {
          if (event.agentId && subAgentMap.has(event.agentId)) {
            // ── Route tool result to subagent's message log ────────────
            const agent = subAgentMap.get(event.agentId)!;
            if (!agent.messages) agent.messages = [];
            agent.messages.push({
              id: event.id,
              parentId: event.parentId,
              role: 'tool',
              content: result.content,
              timestamp: event.timestamp,
              toolResult: result,
            });
            // Tool results are fed back to the subagent on the next turn — advance its context
            const curConvChars = subAgentConvChars.get(event.agentId) ?? 0;
            subAgentConvChars.set(event.agentId, curConvChars + result.content.length);
          } else {
            // ── Main agent tool result ─────────────────────────────────
            messages.push({
              id: event.id,
              parentId: event.parentId,
              role: 'tool',
              content: result.content,
              timestamp: event.timestamp,
              toolResult: result,
            });
            // Tool results are sent back to the model in the next request (estimation mode only)
            if (!hasPatchedTokens) {
              conversationChars += result.content.length;
            }
          }
        }

      } else if (event.type === 'subagent.completed') {
        // ── Add subagent completion summary to main timeline ──────────
        const refId = event.agentId || event.data.toolCallId;
        const agent = refId ? subAgentMap.get(refId) : undefined;
        const agentLabel = agent?.agentDisplayName || agent?.agentId || refId || 'Subagent';

        let summary = `Subagent "${agentLabel}" completed`;
        if (event.data.totalToolCalls) summary += ` · ${event.data.totalToolCalls} tool call(s)`;
        if (event.data.durationMs) summary += ` · ${Math.round(event.data.durationMs / 1000)}s`;

        const patchedTokens = getPatchedTokenUsage(event);
        let completionTokens: Message['tokens'] | undefined;
        if (patchedTokens) {
          const cost = calculateCost(
            { input: patchedTokens.input, output: patchedTokens.output, cacheRead: patchedTokens.cacheRead },
            model
          );
          completionTokens = {
            input: patchedTokens.input,
            output: patchedTokens.output,
            cacheRead: patchedTokens.cacheRead,
            estimated: false,
            cost,
          };
          // Accumulate subagent tokens into session-level totals
          inputPerMessage.push(patchedTokens.input);
          outputPerMessage.push(patchedTokens.output);
          totalInput += patchedTokens.input;
          totalOutput += patchedTokens.output;
          totalCacheRead += patchedTokens.cacheRead;
          totalCost += cost;
          cumulativeTokens.push(totalInput + totalOutput);
          // Backfill agent.totalTokens if not yet set
          if (agent && agent.totalTokens == null) {
            agent.totalTokens = patchedTokens.input + patchedTokens.output;
          }
        } else {
          // No snake_case patched tokens — use accumulated per-message values:
          //   output  = exact sum from subagent assistant.message outputTokens
          //   input   = estimated sum from per-turn context estimation
          //   cost    = pre-summed per-message cost (accounts for cacheRead per turn)
          const outTokens = subAgentOutputMap.get(refId ?? '') ?? 0;
          const inTokens = subAgentInputMap.get(refId ?? '') ??
            // Fallback: if estimation data missing, try to infer from event.data.totalTokens
            (typeof event.data.totalTokens === 'number' && event.data.totalTokens > outTokens
              ? event.data.totalTokens - outTokens
              : 0);
          const accumulatedCost = subAgentCostMap.get(refId ?? '') ?? 0;

          if (outTokens > 0 || inTokens > 0) {
            // Use pre-summed cost if available; otherwise fall back to a single calculateCost call
            const subAgentModel = agent?.model || model;
            const cost = accumulatedCost > 0
              ? accumulatedCost
              : calculateCost({ input: inTokens, output: outTokens }, subAgentModel);
            completionTokens = {
              input: inTokens,
              output: outTokens,
              estimated: true,
              cost,
            };
            // Accumulate into session-level totals (always push both to keep arrays paired)
            inputPerMessage.push(inTokens);
            outputPerMessage.push(outTokens);
            totalInput += inTokens;
            totalOutput += outTokens;
            totalCost += cost;
            cumulativeTokens.push(totalInput + totalOutput);
            // Backfill agent.totalTokens if not yet set
            if (agent && agent.totalTokens == null) {
              agent.totalTokens = inTokens + outTokens;
            }
          }
        }

        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'system',
          content: summary,
          timestamp: event.timestamp,
          subAgentRef: refId,
          tokens: completionTokens,
        });

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

    // ---------------------------------------------------------------
    // Enrich each subagent's message log with synthetic prompt / result
    // messages so the subagent Timeline looks like a mini-session.
    // ---------------------------------------------------------------
    for (const agent of subAgentMap.values()) {
      if (!agent.messages) agent.messages = [];

      // Prepend the task prompt as a synthetic user message
      if (agent.prompt) {
        agent.messages.unshift({
          id: `${agent.id}-prompt`,
          parentId: null,
          role: 'user',
          content: agent.prompt,
          timestamp: agent.startTime,
        });
      }

      // Append the final result as a synthetic system message
      if (agent.result) {
        agent.messages.push({
          id: `${agent.id}-result`,
          parentId: null,
          role: 'system',
          content: agent.result,
          timestamp: agent.endTime ?? agent.startTime,
        });
      }
    }

    // ---------------------------------------------------------------
    // Build tool usage summary
    // ---------------------------------------------------------------
    const toolUsage: ToolUsageSummary[] = Array.from(toolUsageMap.entries()).map(
      ([name, { count, successes }]) => ({
        name,
        count,
        successRate: count > 0 ? successes / count : 0,
      })
    );

    const userMessages = messages.filter(m => m.role === 'user').length;
    const assistantMessages = messages.filter(m => m.role === 'assistant').length;

    let duration = 0;
    if (messages.length >= 2) {
      const start = new Date(messages[0].timestamp).getTime();
      const end = new Date(messages[messages.length - 1].timestamp).getTime();
      duration = end - start;
    }

    const tokenStats = assistantMessages > 0
      ? {
          totalInput,
          totalOutput,
          totalCacheRead,
          totalCacheCreation: 0,
          totalCost,
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        }
      : undefined;

    const totalTokens = assistantMessages > 0 ? totalInput + totalOutput : undefined;

    const stats: SessionStats = {
      messageCount: messages.length,
      userMessages,
      assistantMessages,
      tokens: tokenStats,
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
      totalTokens,
      model,
      messages,
      stats,
      toolUsage,
      subAgents: subAgentMap.size > 0 ? Array.from(subAgentMap.values()) : undefined,
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
    totalTokens: detail.totalTokens,
    model: detail.model,
    subAgentCount: detail.subAgents?.length,
  };
}

