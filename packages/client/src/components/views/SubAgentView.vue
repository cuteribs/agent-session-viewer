<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SubAgent, SessionDetail } from '@/types'
import { formatDuration, formatTokens } from '@/utils/formatters'
import TimelineView from '@/components/views/TimelineView.vue'
import TreeView from '@/components/views/TreeView.vue'
import ChartsView from '@/components/views/ChartsView.vue'
import RawView from '@/components/views/RawView.vue'

const props = defineProps<{
  agent: SubAgent
  parentName?: string
}>()

const emit = defineEmits<{
  back: []
}>()

type TabId = 'timeline' | 'tree' | 'charts' | 'raw'

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'timeline', label: 'Timeline', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'tree',     label: 'Tree',     icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { id: 'charts',   label: 'Charts',   icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'raw',      label: 'Raw',      icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
]

const activeTab = ref<TabId>('timeline')

/**
 * Wrap the subagent's data into a minimal SessionDetail so Charts / Raw
 * views (which expect a full session) work out of the box.
 */
const subAgentSession = computed((): SessionDetail => {
  const msgs = props.agent.messages ?? []
  const assistantMsgs = msgs.filter(m => m.role === 'assistant' && m.tokens)

  const inputPerMessage = assistantMsgs.map(m => m.tokens!.input)
  const outputPerMessage = assistantMsgs.map(m => m.tokens!.output)
  const totalInput = inputPerMessage.reduce((a, b) => a + b, 0)
  const totalOutput = outputPerMessage.reduce((a, b) => a + b, 0)

  let cumulative = 0
  const cumulativeTokens = assistantMsgs.map(m => {
    cumulative += m.tokens!.input + m.tokens!.output
    return cumulative
  })

  return {
    id: props.agent.id,
    source: 'copilot',
    project: props.agent.agentDisplayName || props.agent.agentId,
    projectPath: '',
    startTime: props.agent.startTime,
    lastActivity: props.agent.endTime ?? props.agent.startTime,
    messageCount: msgs.length,
    totalTokens: props.agent.totalTokens,
    model: props.agent.model,
    messages: msgs,
    stats: {
      messageCount: msgs.length,
      userMessages: msgs.filter(m => m.role === 'user').length,
      assistantMessages: msgs.filter(m => m.role === 'assistant').length,
      duration: props.agent.durationMs ?? 0,
      tokens: assistantMsgs.length > 0 ? {
        totalInput,
        totalOutput,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCost: 0,
        inputPerMessage,
        outputPerMessage,
        cumulativeTokens,
      } : undefined,
      tools: [],
    },
    toolUsage: [],
    subAgents: undefined,
  }
})

function durationFormatted(ms?: number) {
  if (!ms) return ''
  return formatDuration(ms)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="bg-primary border-b border-default px-4 py-3">
      <!-- Breadcrumb -->
      <button
        @click="emit('back')"
        class="flex items-center gap-1 text-sm text-accent hover:text-accent/80 mb-2 transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ parentName ?? 'Back to session' }}
      </button>

      <!-- Agent title -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-lg font-semibold text-primary">{{ agent.agentId }}</span>
        <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
          {{ agent.agentDisplayName || agent.agentType }}
        </span>
        <span
          class="px-2 py-0.5 text-xs font-medium rounded-full"
          :class="agent.status === 'completed'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : agent.status === 'failed'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'"
        >
          {{ agent.status }}
        </span>
      </div>
      <p v-if="agent.description" class="text-sm text-muted mt-1">{{ agent.description }}</p>

      <!-- Stats -->
      <div class="flex items-center gap-6 mt-2 text-sm flex-wrap">
        <div v-if="agent.model" class="flex items-center gap-1">
          <span class="text-muted">Model:</span>
          <span class="font-medium">{{ agent.model }}</span>
        </div>
        <div v-if="agent.totalTokens" class="flex items-center gap-1">
          <span class="text-muted">Tokens:</span>
          <span class="font-medium">{{ formatTokens(agent.totalTokens) }}</span>
        </div>
        <div v-if="agent.totalToolCalls" class="flex items-center gap-1">
          <span class="text-muted">Tool calls:</span>
          <span class="font-medium">{{ agent.totalToolCalls }}</span>
        </div>
        <div v-if="agent.durationMs" class="flex items-center gap-1">
          <span class="text-muted">Duration:</span>
          <span class="font-medium">{{ durationFormatted(agent.durationMs) }}</span>
        </div>
        <div v-if="agent.messages?.length" class="flex items-center gap-1">
          <span class="text-muted">Messages:</span>
          <span class="font-medium">{{ agent.messages.length }}</span>
        </div>
      </div>
    </div>

    <!-- Tab bar -->
    <div class="bg-primary border-b border-default px-4">
      <nav class="flex gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          @click="activeTab = tab.id"
          :class="[
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === tab.id
              ? 'text-accent border-accent'
              : 'text-secondary border-transparent hover:text-primary hover:border-gray-300',
          ]"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="tab.icon" />
          </svg>
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-y-auto p-4">

      <!-- Timeline tab -->
      <template v-if="activeTab === 'timeline'">
        <TimelineView :messages="agent.messages" />
      </template>

      <!-- Tree tab -->
      <template v-else-if="activeTab === 'tree'">
        <TreeView :messages="agent.messages" />
      </template>

      <!-- Charts tab -->
      <template v-else-if="activeTab === 'charts'">
        <ChartsView :session="subAgentSession" />
      </template>

      <!-- Raw tab -->
      <template v-else-if="activeTab === 'raw'">
        <RawView :session="subAgentSession" />
      </template>

    </div>
  </div>
</template>
