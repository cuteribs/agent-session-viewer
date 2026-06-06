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
const { inputPrompt, result, session: subAgentSession } = useSubAgentViewModel(toRef(props, 'agent'))

const showInput = ref(true)
const showResult = ref(true)

function durationFormatted(ms?: number) {
  if (!ms) return ''
  return formatDuration(ms)
}
</script>

<template>
  <div data-name="subagent-view" class="flex flex-col h-full">
    <!-- Header -->
    <div data-name="subagent-header" class="bg-primary border-b border-default px-4 py-3">
      <!-- Breadcrumb -->
      <button
        data-name="subagent-back"
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
        <span data-name="subagent-id" class="text-lg font-semibold text-primary">{{ agent.agentId }}</span>
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
      <p v-if="agent.description" data-name="subagent-description" class="text-sm text-muted mt-1">{{ agent.description }}</p>

      <!-- Stats -->
      <div data-name="subagent-stats" class="flex items-center gap-6 mt-2 text-sm flex-wrap">
        <div v-if="agent.model" data-name="subagent-stat-model" class="flex items-center gap-1">
          <span class="text-muted">Model:</span>
          <span class="font-medium">{{ agent.model }}</span>
        </div>
        <div v-if="agent.totalTokens" data-name="subagent-stat-tokens" class="flex items-center gap-1">
          <span class="text-muted">Tokens:</span>
          <span class="font-medium">{{ formatTokens(agent.totalTokens) }}</span>
        </div>
        <div v-if="agent.totalToolCalls" data-name="subagent-stat-tool-calls" class="flex items-center gap-1">
          <span class="text-muted">Tool calls:</span>
          <span class="font-medium">{{ agent.totalToolCalls }}</span>
        </div>
        <div v-if="agent.durationMs" data-name="subagent-stat-duration" class="flex items-center gap-1">
          <span class="text-muted">Duration:</span>
          <span class="font-medium">{{ durationFormatted(agent.durationMs) }}</span>
        </div>
        <div v-if="agent.messages?.length" data-name="subagent-stat-messages" class="flex items-center gap-1">
          <span class="text-muted">Messages:</span>
          <span class="font-medium">{{ agent.messages.length }}</span>
        </div>
      </div>
    </div>

    <!-- Input / Result panels -->
    <div data-name="subagent-io" class="bg-primary border-b border-default px-4 py-3 space-y-3">
      <!-- Input (prompt) -->
      <div v-if="inputPrompt" data-name="subagent-input">
        <button
          data-name="subagent-input-toggle"
          @click="showInput = !showInput"
          class="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wide hover:text-primary transition-colors"
        >
          <svg :class="['w-3 h-3 transition-transform', showInput ? 'rotate-90' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          Input
        </button>
        <pre
          v-if="showInput"
          data-name="subagent-input-text"
          class="mt-1.5 p-3 bg-tertiary rounded text-sm text-primary whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono"
        >{{ inputPrompt }}</pre>
      </div>

      <!-- Result -->
      <div v-if="result" data-name="subagent-result">
        <button
          data-name="subagent-result-toggle"
          @click="showResult = !showResult"
          class="flex items-center gap-1.5 text-xs font-semibold text-muted uppercase tracking-wide hover:text-primary transition-colors"
        >
          <svg :class="['w-3 h-3 transition-transform', showResult ? 'rotate-90' : '']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
          Result
        </button>
        <pre
          v-if="showResult"
          data-name="subagent-result-text"
          class="mt-1.5 p-3 bg-green-50 dark:bg-green-900/15 border border-green-200 dark:border-green-800 rounded text-sm text-primary whitespace-pre-wrap break-words max-h-60 overflow-y-auto font-mono"
        >{{ result }}</pre>
      </div>
    </div>

    <!-- Tab bar -->
    <div data-name="subagent-tab-nav" class="bg-primary border-b border-default px-4">
      <nav class="flex gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :data-name="`subagent-tab-${tab.id}`"
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
