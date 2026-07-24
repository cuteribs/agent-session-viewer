import { readFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';
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
    const rawLines = content.split('\n');

    if (rawLines.every(l => !l.trim())) {
      return null;
    }

    // WeakMap: parsed event object → 1-based line number in the source file
    const eventLineMap = new WeakMap<object, number>();
    const events: CopilotEvent[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as CopilotEvent;
        events.push(parsed);
        eventLineMap.set(parsed, i + 1);
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
    let project = basename(projectPath);
    // Override with 'name' from workspace.yaml in the session folder
    const workspaceYamlPath = join(dirname(filePath), 'workspace.yaml');
    if (existsSync(workspaceYamlPath)) {
      try {
        const yaml = readFileSync(workspaceYamlPath, 'utf-8');
        const m = yaml.match(/^name\s*:\s*(.+)$/m);
        if (m) project = m[1].trim().replace(/^['"]|['"]$/g, '');
      } catch { /* ignore */ }
    }

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
    // Extract exact session-level totals from session.shutdown.
    // A resumed session produces one shutdown event per segment, so
    // accumulate modelMetrics across ALL shutdown events in the file.
    // ---------------------------------------------------------------
    type ShutdownModelEntry = {
      requests: { count: number; cost: number };
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; reasoningTokens: number };
    };
    type ShutdownData = Record<string, ShutdownModelEntry>;

    let shutdownData: ShutdownData | null = null;
    for (const event of events) {
      if ((event as { type: string }).type !== 'session.shutdown') continue;
      const metrics = (event as { type: string; data?: { modelMetrics?: ShutdownData } }).data?.modelMetrics;
      if (!metrics) continue;

      if (!shutdownData) shutdownData = {};
      for (const modelName of Object.keys(metrics)) {
        const m = metrics[modelName];
        if (!shutdownData[modelName]) {
          shutdownData[modelName] = {
            requests: { count: 0, cost: 0 },
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 },
          };
        }
        shutdownData[modelName].requests.count += m.requests.count;
        shutdownData[modelName].requests.cost  += m.requests.cost;
        shutdownData[modelName].usage.inputTokens     += m.usage.inputTokens;
        shutdownData[modelName].usage.outputTokens    += m.usage.outputTokens;
        shutdownData[modelName].usage.cacheReadTokens += m.usage.cacheReadTokens;
        shutdownData[modelName].usage.cacheWriteTokens += m.usage.cacheWriteTokens;
        shutdownData[modelName].usage.reasoningTokens += m.usage.reasoningTokens;
      }
    }

    let exactTotalInput = 0;
    let exactTotalOutput = 0;
    let exactTotalCacheRead = 0;
    let exactTotalCacheCreation = 0;
    let exactTotalCost = 0;
    let totalNanoAiu: number | undefined;

    for (const event of events) {
      if (typeof event.data.totalNanoAiu === 'number'
        && Number.isFinite(event.data.totalNanoAiu)
        && event.data.totalNanoAiu >= 0) {
        totalNanoAiu = event.data.totalNanoAiu;
      }
    }

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
      for (const ev of events) {
        if (ev.type === 'assistant.message') {
          const out = (ev.data as { outputTokens?: unknown }).outputTokens;
          if (typeof out === 'number') exactTotalOutput += out;
        }
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

    // Track last message IDs for parentId chaining (level hierarchy)
    let lastUserMessageId: string | null = null;
    let lastAssistantMessageId: string | null = null;
    const lastAssistantByAgent = new Map<string, string>(); // agentId → last assistant message id
    const toolMessagesById = new Map<string, Message>(); // toolCallId → Message ref for patching

    for (const event of events) {
      const logLine = eventLineMap.get(event);

      if (event.type === 'user.message') {
        const userContent = event.data.content || event.data.transformedContent || '';
        messages.push({
          id: event.id,
          parentId: null,
          role: 'user',
          content: userContent,
          timestamp: event.timestamp,
          logLine,
        });
        lastUserMessageId = event.id;

      } else if (event.type === 'assistant.message') {
        const msgContent = event.data.content || event.data.reasoningText || '';

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
            parentId: lastAssistantByAgent.get(event.agentId) ?? null,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model: subMsgModel,
            logLine,
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
          lastAssistantByAgent.set(event.agentId, event.id);

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
            parentId: lastUserMessageId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model,
            logLine,
            tokens: msgTokens,
          });
          lastAssistantMessageId = event.id;

        } else {
          // ── Main agent — No estimation, only output ──────────────────
          const exactOutputTokens = typeof event.data.outputTokens === 'number' ? event.data.outputTokens : 0;

          messages.push({
            id: event.id,
            parentId: lastUserMessageId,
            role: 'assistant',
            content: msgContent,
            timestamp: event.timestamp,
            model,
            logLine,
            tokens: exactOutputTokens > 0 ? {
              input: 0,
              output: exactOutputTokens,
              estimated: false,
            } : undefined,
          });
          lastAssistantMessageId = event.id;
        }

      } else if (event.type === 'tool.execution_start') {
        // ── Create a tool message now; content patched by execution_complete ──
        const toolMsg: Message = {
          id: event.id,
          parentId: event.agentId
            ? (lastAssistantByAgent.get(event.agentId) ?? null)
            : lastAssistantMessageId,
          role: 'tool',
          content: '',
          timestamp: event.timestamp,
          logLine,
          toolCalls: event.data.toolName ? [{
            id: event.data.toolCallId || event.id,
            name: event.data.toolName,
            arguments: event.data.arguments || {},
          }] : undefined,
          // toolResult is intentionally absent here; set by tool.execution_complete
        };
        if (event.data.toolCallId) {
          toolMessagesById.set(event.data.toolCallId, toolMsg);
        }
        if (event.agentId && subAgentMap.has(event.agentId)) {
          const agent = subAgentMap.get(event.agentId)!;
          if (!agent.messages) agent.messages = [];
          agent.messages.push(toolMsg);
        } else {
          messages.push(toolMsg);
        }

      } else if (event.type === 'tool.execution_complete') {
        // Only patch the existing tool message — never create a new message item
        const toolCallId = event.data.toolCallId || '';
        const existingToolMsg = toolMessagesById.get(toolCallId);
        if (existingToolMsg) {
          const resultContent = event.data.result?.detailedContent
            || event.data.result?.content
            || event.data.error?.message
            || '';
          existingToolMsg.content = resultContent;
          existingToolMsg.toolResult = {
            toolCallId,
            success: event.data.success ?? true,
            content: resultContent,
          };
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
          logLine,
          tokens: completionTokens,
        });

      } else if (event.type === 'session.error') {
        messages.push({
          id: event.id,
          parentId: null,
          role: 'system',
          content: `Error: ${event.data.errorType || 'Unknown'} - ${event.data.message || ''}`,
          timestamp: event.timestamp,
          logLine,
        });

      } else if (event.type === 'system.message') {
        // ── Level 1 system message ────────────────────────────────────
        messages.push({
          id: event.id,
          parentId: null,
          role: 'system',
          content: event.data.content || '',
          timestamp: event.timestamp,
          logLine,
        });

      } else if (event.type === 'session.model_change') {
        // ── Level 1 system message for model change ───────────────────
        const prev = event.data.previousModel || 'unknown';
        const next = event.data.newModel || model || 'unknown';
        messages.push({
          id: event.id,
          parentId: null,
          role: 'system',
          content: `Model changed: ${prev} → ${next}`,
          timestamp: event.timestamp,
          logLine,
        });

      } else if (event.type === 'session.info') {
        // ── Append content into the most recent system message ────────
        const lastSystemMsg = [...messages].reverse().find(m => m.role === 'system');
        if (lastSystemMsg) {
          const extra = event.data.content || '';
          lastSystemMsg.content = lastSystemMsg.content
            ? `${lastSystemMsg.content}\n${extra}`
            : extra;
        }
      }
    }

    // ---------------------------------------------------------------
    // Enrich each subagent's message log with synthetic prompt / result
    // messages so the subagent Timeline looks like a mini-session.
    // ---------------------------------------------------------------
    for (const agent of subAgentMap.values()) {
      if (!agent.messages) agent.messages = [];

      // Prepend the task prompt as a synthetic system message
      if (agent.prompt) {
        const promptId = `${agent.id}-prompt`;
        agent.messages.unshift({
          id: promptId,
          parentId: null,
          role: 'system',
          content: agent.prompt,
          timestamp: agent.startTime,
        });
        // Re-parent all assistant messages to the prompt (level 1→2).
        // Tool messages already point to their assistant (level 2→3) — leave unchanged.
        for (const msg of agent.messages) {
          if (msg.role === 'assistant') {
            msg.parentId = promptId;
          }
        }
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

    const totalCost = totalNanoAiu === undefined
      ? exactTotalCost
      : totalNanoAiu / 100_000_000_000;
    const tokenStats = assistantMessages > 0
      ? {
          totalInput: exactTotalInput,
          totalOutput: exactTotalOutput,
          totalCacheRead: exactTotalCacheRead,
          totalCacheCreation: exactTotalCacheCreation,
          totalCost,
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
      cost: totalCost,
      model,
      usedModels,
      incomplete: shutdownData === null ? true : undefined,
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
    cost: detail.cost,
    model: detail.model,
    subAgentCount: detail.subAgents?.length,
    incomplete: detail.incomplete,
  };
}
