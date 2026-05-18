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
    const subAgentMap = new Map<string, SubAgent>();
    const subAgentByName = new Map<string, SubAgent>();

    for (const event of events) {
      if (event.type === 'session.compaction_start' && event.data.systemTokens && !toolDefsSet) {
        // Use the server-reported values if available (most accurate)
        systemOverheadTokens = event.data.systemTokens;
        toolDefsOverhead = event.data.toolDefinitionsTokens ?? DEFAULT_TOOL_DEFS_TOKENS;
        toolDefsSet = true;
      }
      if (event.type === 'tool.execution_complete' && event.data.toolCallId) {
        toolResultsById.set(event.data.toolCallId, {
          toolCallId: event.data.toolCallId,
          success: event.data.success ?? true,
          content: event.data.result?.content || '',
        });

        const toolName = event.data.toolName || 'unknown';
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
          agent.status = 'completed';
          agent.model = event.data.model;
          agent.totalTokens = event.data.totalTokens;
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
    // Second pass: build messages + estimate token usage
    // ---------------------------------------------------------------
    const messages: Message[] = [];

    // Token arrays for charts (one entry per assistant API call)
    const inputPerMessage: number[] = [];
    const outputPerMessage: number[] = [];
    const cumulativeTokens: number[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    // Running estimate of conversation context in characters.
    // Resets when a session.compaction_complete event is detected.
    let conversationChars = 0;
    // Current system prompt char count (overwritten by each system.message event)
    let activeSystemChars = 0;
    // The input token count from the previous assistant turn — used to estimate
    // cache hits.  Claude caches the full prefix, so previous turn's context ≈
    // what is served from cache in the current turn.
    let prevInputTokens = 0;
    let totalCacheRead = 0;

    for (const event of events) {
      // Track system prompt changes
      if (event.type === 'system.message' && event.data.content) {
        activeSystemChars = event.data.content.length;
        continue;
      }

      // After successful compaction the conversation history is reset;
      // start the context accumulator fresh.
      if (event.type === 'session.compaction_complete' && event.data.success) {
        conversationChars = (event.data.summaryContent as string | undefined ?? '').length;
        // After compaction the new context is a clean summary, so the
        // previous cache entry no longer applies.
        prevInputTokens = 0;
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
        conversationChars += userContent.length;

      } else if (event.type === 'assistant.message') {
        const toolCalls: ToolCall[] = (event.data.toolRequests || []).map(tr => ({
          id: tr.toolCallId,
          name: tr.name,
          arguments: tr.arguments,
        }));

        const msgContent = event.data.reasoningText || '';

        // ---------- Token estimation ----------
        // Model: Copilot caches the system prompt + tool definitions on every call
        // after the first.  The "new" (non-cached) input is therefore just the
        // growing conversation context.
        const sysTokens = activeSystemChars > 0
          ? Math.round(activeSystemChars / CHARS_PER_TOKEN)
          : systemOverheadTokens;

        // New (non-cached) input = conversation accumulated so far
        const estInputTokens = Math.round(conversationChars / CHARS_PER_TOKEN);

        // Cache = system + tool-definitions overhead (fixed per-call, always cached
        // after the first round-trip; treat first call as 0 for accuracy).
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
        prevInputTokens = estInputTokens + estCacheRead; // full context for next-turn reference

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
          // Tool results are sent back to the model in the next request
          conversationChars += result.content.length;
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

