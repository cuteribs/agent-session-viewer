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
    // First pass: collect subagents, tool results, model changes
    // ---------------------------------------------------------------
    const toolUsageMap = new Map<string, { count: number; successes: number }>();
    const toolResultsById = new Map<string, ToolResult>();
    /** toolCallId → toolName  (populated from tool.execution_start, used in tool.execution_complete) */
    const toolNamesById = new Map<string, string>();
    const subAgentMap = new Map<string, SubAgent>();
    const subAgentByName = new Map<string, SubAgent>();

    for (const event of events) {
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
    // Extract exact session-level totals from session.shutdown
    // (always the last line in a completed session)
    // ---------------------------------------------------------------
    const rawLastLine = lines[lines.length - 1];
    let shutdownData: Record<string, {
      requests: { count: number; cost: number };
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number };
    }> | null = null;
    try {
      const parsed = JSON.parse(rawLastLine);
      if (parsed?.type === 'session.shutdown' && parsed?.data?.modelMetrics) {
        shutdownData = parsed.data.modelMetrics;
      }
    } catch { /* not valid JSON — ignore */ }

    let exactTotalInput = 0;
    let exactTotalOutput = 0;
    let exactTotalCacheRead = 0;
    let exactTotalCacheCreation = 0;
    let exactTotalCost = 0;

    if (shutdownData) {
      for (const modelName of Object.keys(shutdownData)) {
        const m = shutdownData[modelName];
        exactTotalInput += m.usage.inputTokens;
        exactTotalOutput += m.usage.outputTokens;
        exactTotalCacheRead += m.usage.cacheReadTokens;
        exactTotalCacheCreation += m.usage.cacheWriteTokens;
        exactTotalCost += calculateCost(
          {
            input: m.usage.inputTokens,
            output: m.usage.outputTokens,
            cacheRead: m.usage.cacheReadTokens,
            cacheCreation: m.usage.cacheWriteTokens,
          },
          modelName
        );
      }
    } else {
      // Fallback: sum outputTokens from all assistant.message events when shutdown is absent
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if (ev?.type === 'assistant.message' && typeof ev?.data?.outputTokens === 'number') {
            exactTotalOutput += ev.data.outputTokens;
          }
        } catch { /* skip */ }
      }
    }

    // ---------------------------------------------------------------
    // Second pass: build messages + per-message output tokens
    // ---------------------------------------------------------------
    const messages: Message[] = [];

    // Token arrays for charts (one entry per assistant API call)
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];

    // Accumulate exact output tokens from subagent assistant.message events
    const subAgentOutputMap = new Map<string, number>(); // agentId → summed outputTokens

    for (const event of events) {
      if (event.type === 'user.message') {
        const userContent = event.data.content || event.data.transformedContent || '';
        messages.push({
          id: event.id,
          parentId: event.parentId,
          role: 'user',
          content: userContent,
          timestamp: event.timestamp,
        });

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

          agent.messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model: subMsgModel,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            // Per-message output only (exact); cost can be derived by SubAgentView
            tokens: subOutputTok > 0 ? {
              input: 0,
              output: subOutputTok,
              estimated: false,
            } : undefined,
          });
          // Accumulate exact output tokens for this subagent across all its turns
          if (subOutputTok > 0) {
            subAgentOutputMap.set(event.agentId, (subAgentOutputMap.get(event.agentId) ?? 0) + subOutputTok);
          }

        } else if (hasPatchedTokens) {
          // ── Main agent — Patched mode ─────────────────────────────────
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
          // ── Main agent — No estimation, only output ──────────────────
          const exactOutputTokens = typeof event.data.outputTokens === 'number' ? event.data.outputTokens : 0;

          messages.push({
            id: event.id,
            parentId: event.parentId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            tokens: exactOutputTokens > 0 ? {
              input: 0,
              output: exactOutputTokens,
              estimated: false,
            } : undefined,
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
          // Backfill agent.totalTokens if not yet set
          if (agent && agent.totalTokens == null) {
            agent.totalTokens = patchedTokens.input + patchedTokens.output;
          }
        } else {
          // Fall back to accumulated output tokens from subagent messages
          const outTokens = subAgentOutputMap.get(refId ?? '') ?? 0;
          const inTokens = 0;

          if (outTokens > 0 || inTokens > 0) {
            completionTokens = {
              input: inTokens,
              output: outTokens,
              estimated: false,
            };
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

      // Backfill agent.totalTokens if missing from subagent.completed
      if (agent.messages.length > 0 && agent.model && agent.totalTokens == null) {
        agent.totalTokens = subAgentOutputMap.get(agent.id) ?? 0;
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

    // Build per-message arrays from messages that have tokens (for charts)
    // Only main-agent messages contribute to the chart arrays
    for (const msg of messages) {
      if (msg.tokens && (msg.role === 'assistant' || msg.tokens.output > 0)) {
        inputPerMessage.push(msg.tokens.input);
        outputPerMessage.push(msg.tokens.output);
      }
    }
    // Build cumulative from outputs only (since input is 0 for non-patched)
    let cumSum = 0;
    for (let i = 0; i < inputPerMessage.length; i++) {
      cumSum += inputPerMessage[i] + outputPerMessage[i];
      cumulativeTokens.push(cumSum);
    }

    const tokenStats = assistantMessages > 0
      ? {
          totalInput: exactTotalInput,
          totalOutput: exactTotalOutput,
          totalCacheRead: exactTotalCacheRead,
          totalCacheCreation: exactTotalCacheCreation,
          totalCost: exactTotalCost,
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        }
      : undefined;

    const totalTokens = exactTotalInput + exactTotalOutput;

    // Per-model breakdown (from shutdown data)
    let usedModels: SessionSummary['usedModels'];
    if (shutdownData) {
      const entries: NonNullable<SessionSummary['usedModels']> = [];
      for (const modelName of Object.keys(shutdownData)) {
        const m = shutdownData[modelName];
        entries.push({
          model: modelName,
          inputTokens: m.usage.inputTokens,
          outputTokens: m.usage.outputTokens,
          totalTokens: m.usage.inputTokens + m.usage.outputTokens,
          requestCount: m.requests.count,
          cost: calculateCost(
            {
              input: m.usage.inputTokens,
              output: m.usage.outputTokens,
              cacheRead: m.usage.cacheReadTokens,
              cacheCreation: m.usage.cacheWriteTokens,
            },
            modelName
          ),
        });
      }
      // Sort by totalTokens descending
      entries.sort((a, b) => b.totalTokens - a.totalTokens);
      usedModels = entries;
    }

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
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      model,
      usedModels,
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
