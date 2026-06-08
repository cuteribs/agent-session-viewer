<script setup lang="ts">
import { ref, toRef } from 'vue'
import type { SubAgent } from '@/types'
import { formatDuration, formatTokens } from '@/utils/formatters'
import { useSubAgentViewModel } from '@/composables/useSubAgentViewModel'
import TimelineView from '@/components/views/TimelineView.vue'
import ChartsView from '@/components/views/ChartsView.vue'

const props = defineProps<{
  agent: SubAgent
  parentName?: string
}>()

const emit = defineEmits<{
  back: []
}>()

type TabId = 'timeline' | 'charts'

const tabs: { id: TabId; label: string; icon: string }[] = [
  { id: 'timeline', label: 'Timeline', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'charts',   label: 'Charts',   icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
]

const activeTab = ref<TabId>('timeline')

// Normalize the subagent into a viewmodel: input prompt, result, entries, and a
// SessionDetail-shaped object for the Charts view.
const { session: subAgentSession } = useSubAgentViewModel(toRef(props, 'agent'))

function durationFormatted(ms?: number) {
  if (!ms) return ''
  return formatDuration(ms)
}
</script>

<template>
  <div data-name="subagent-view" class="flex flex-col h-full">
    <!-- Header -->
    <div data-name="subagent-header" class="bg-surface border-b border-outline-variant px-4 py-3">
      <!-- Breadcrumb -->
      <button
        data-name="subagent-back"
        @click="emit('back')"
        class="flex items-center gap-1 text-sm text-primary hover:text-primary/80 mb-2 transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ parentName ?? 'Back to session' }}
      </button>

      <!-- Agent title -->
      <div class="flex items-center gap-2 flex-wrap">
        <span data-name="subagent-id" class="text-lg font-semibold text-on-surface">{{ agent.agentId }}</span>
        <span data-name="subagent-type-badge" class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
          {{ agent.agentDisplayName || agent.agentType }}
        </span>
        <span
          data-name="subagent-status-badge"
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
      <p v-if="agent.description" data-name="subagent-description" class="text-sm text-on-surface-variant mt-1">{{ agent.description }}</p>

      <!-- Stats -->
      <div data-name="subagent-stats" class="flex items-center gap-6 mt-2 text-sm flex-wrap">
        <div v-if="agent.model" data-name="subagent-stat-model" class="flex items-center gap-1">
          <span class="text-on-surface-variant">Model:</span>
          <span class="font-medium">{{ agent.model }}</span>
        </div>
        <div v-if="agent.totalTokens" data-name="subagent-stat-tokens" class="flex items-center gap-1">
          <span class="text-on-surface-variant">Tokens:</span>
          <span class="font-medium">{{ formatTokens(agent.totalTokens) }}</span>
        </div>
        <div v-if="agent.totalToolCalls" data-name="subagent-stat-tool-calls" class="flex items-center gap-1">
          <span class="text-on-surface-variant">Tool calls:</span>
          <span class="font-medium">{{ agent.totalToolCalls }}</span>
        </div>
        <div v-if="agent.durationMs" data-name="subagent-stat-duration" class="flex items-center gap-1">
          <span class="text-on-surface-variant">Duration:</span>
          <span class="font-medium">{{ durationFormatted(agent.durationMs) }}</span>
        </div>
        <div v-if="agent.messages?.length" data-name="subagent-stat-messages" class="flex items-center gap-1">
          <span class="text-on-surface-variant">Messages:</span>
          <span class="font-medium">{{ agent.messages.length }}</span>
        </div>
      </div>
    </div>

    <!-- Tab bar -->
    <div data-name="subagent-tab-nav" class="bg-surface border-b border-outline-variant px-4">
      <nav class="flex gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :data-name="`subagent-tab-${tab.id}`"
          @click="activeTab = tab.id"
          :class="[
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            activeTab === tab.id
              ? 'text-primary border-primary'
              : 'text-on-surface-variant border-transparent hover:text-on-surface hover:border-gray-300',
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
    <div data-name="subagent-tab-content" class="flex-1 overflow-y-auto p-4">

      <!-- Timeline tab -->
      <template v-if="activeTab === 'timeline'">
        <TimelineView :messages="agent.messages" />
      </template>

      <!-- Charts tab -->
      <template v-else-if="activeTab === 'charts'">
        <ChartsView :session="subAgentSession" />
      </template>

    </div>
  </div>
</template>
