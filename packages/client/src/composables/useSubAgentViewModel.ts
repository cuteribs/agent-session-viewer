import { computed, type ComputedRef } from 'vue'
import type { SessionDetail, SubAgent, Message } from '@/types'

/**
 * Normalizes a SubAgent into the same shape the common views
 * (TimelineView / TreeView / ChartsView) already consume.
 *
 * Semantics (per product decision):
 *  - The MAIN session viewmodel shows a subagent only as the invoking tool call
 *    plus its result; it does NOT inline the subagent's internal entries.
 *  - The SUBAGENT viewmodel (this composable) carries the input (prompt),
 *    the result, and all related entries (the subagent's message log).
 */
export interface SubAgentViewModel {
  /** The subagent's prompt / input that started it. */
  inputPrompt: ComputedRef<string>
  /** The subagent's final result, if any. */
  result: ComputedRef<string>
  /** Chronological message entries for this subagent. */
  messages: ComputedRef<Message[]>
  /** A SessionDetail-shaped object so ChartsView works unchanged. */
  session: ComputedRef<SessionDetail>
}

export function useSubAgentViewModel(agent: ComputedRef<SubAgent> | (() => SubAgent)): SubAgentViewModel {
  const agentRef = computed(() => (typeof agent === 'function' ? agent() : agent.value))

  const messages = computed(() => agentRef.value.messages ?? [])
  const inputPrompt = computed(() => agentRef.value.prompt ?? agentRef.value.description ?? '')
  const result = computed(() => agentRef.value.result ?? '')

  const session = computed((): SessionDetail => {
    const a = agentRef.value
    const msgs = a.messages ?? []
    const assistantMsgs = msgs.filter(m => m.role === 'assistant' && m.tokens)

    // Effective input = raw input + cacheCreation (new context the model processed)
    const inputPerMessage = assistantMsgs.map(m =>
      (m.tokens!.input || 0) + (m.tokens!.cacheCreation || 0)
    )
    const outputPerMessage = assistantMsgs.map(m => m.tokens!.output)
    const totalInput = inputPerMessage.reduce((acc, b) => acc + b, 0)
    const totalOutput = outputPerMessage.reduce((acc, b) => acc + b, 0)
    const totalCacheRead = assistantMsgs.reduce((acc, m) => acc + (m.tokens!.cacheRead || 0), 0)
    const totalCacheCreation = assistantMsgs.reduce((acc, m) => acc + (m.tokens!.cacheCreation || 0), 0)
    const totalCost = assistantMsgs.reduce((acc, m) => acc + (m.tokens!.cost || 0), 0)

    let cumulative = 0
    const cumulativeTokens = inputPerMessage.map((inp, i) => {
      cumulative += inp + (outputPerMessage[i] || 0)
      return cumulative
    })

    // Build tool usage from message toolCalls
    const toolUsageMap = new Map<string, number>()
    for (const msg of msgs) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolUsageMap.set(tc.name, (toolUsageMap.get(tc.name) ?? 0) + 1)
        }
      }
    }
    const toolUsage = Array.from(toolUsageMap.entries()).map(([name, count]) => ({
      name, count, successRate: 1,
    }))

    return {
      id: a.id,
      source: 'opencode',
      project: a.agentDisplayName || a.agentId,
      projectPath: '',
      startTime: a.startTime,
      lastActivity: a.endTime ?? a.startTime,
      messageCount: msgs.length,
      totalTokens: a.totalTokens,
      model: a.model,
      messages: msgs,
      stats: {
        messageCount: msgs.length,
        userMessages: msgs.filter(m => m.role === 'user').length,
        assistantMessages: msgs.filter(m => m.role === 'assistant').length,
        duration: a.durationMs ?? 0,
        tokens: assistantMsgs.length > 0 ? {
          totalInput,
          totalOutput,
          totalCacheRead,
          totalCacheCreation,
          totalCost,
          inputPerMessage,
          outputPerMessage,
          cumulativeTokens,
        } : undefined,
        tools: toolUsage,
      },
      toolUsage,
      subAgents: undefined,
    }
  })

  return { inputPrompt, result, messages, session }
}
