<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatDateTime, formatDuration, formatCost, getSourceBgColor } from '@/utils/formatters'
import { getExportURL } from '@/utils/api'
import TimelineView from '@/components/views/TimelineView.vue'
import ChartsView from '@/components/views/ChartsView.vue'
import TreeView from '@/components/views/TreeView.vue'
import RawView from '@/components/views/RawView.vue'
import SubAgentView from '@/components/views/SubAgentView.vue'
import TokenBadge from '@/components/common/TokenBadge.vue'

const sessionsStore = useSessionsStore()

const tabs = [
  { id: 'timeline', label: 'Timeline', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'charts', label: 'Charts', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'tree', label: 'Tree', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { id: 'raw', label: 'Raw', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
] as const

const session = computed(() => sessionsStore.currentSession)
const selectedSubAgent = computed(() => sessionsStore.selectedSubAgent)
const showModels = ref(false)

function handleExport(format: 'csv' | 'json') {
  if (!session.value) return
  const url = getExportURL(session.value.source, session.value.id, format)
  window.open(url, '_blank')
}
</script>

<template>
  <main data-name="main-content" class="flex-1 flex flex-col overflow-hidden bg-secondary">
    <!-- Empty state -->
    <div
      v-if="!session"
      data-name="empty-state"
      class="flex-1 flex items-center justify-center text-muted"
    >
      <div class="text-center">
        <svg class="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <p class="text-lg">Select a session to view details</p>
        <p class="text-sm mt-1">Choose from the sidebar on the left</p>
      </div>
    </div>

    <!-- Session content -->
    <template v-else>
      <!-- SubAgent view (replaces session tabs when a subagent is selected) -->
      <SubAgentView
        v-if="selectedSubAgent"
        :agent="selectedSubAgent"
        :parent-name="session.project"
        @back="sessionsStore.clearSubAgent()"
        class="flex-1 overflow-hidden"
      />

      <!-- Normal session view -->
      <template v-else>
      <!-- Session header -->
      <div data-name="session-header" class="bg-primary border-b border-default px-4 py-3">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span
                data-name="source-badge"
                :class="['px-2 py-0.5 text-xs font-medium rounded-full text-white', getSourceBgColor(session.source)]"
              >
                {{ session.source }}
              </span>
              <h2 data-name="project-name" class="text-lg font-semibold text-primary">{{ session.project }}</h2>
            </div>
            <p class="text-sm text-muted mt-1 flex items-center gap-2">
              <span data-name="project-path">{{ session.projectPath }}</span>
              <span data-name="session-id" class="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                <span class="opacity-70">ID</span>
                {{ session.id }}
              </span>
            </p>
          </div>

          <!-- Export buttons -->
          <div data-name="export-buttons" class="flex gap-2">
            <button
              data-name="export-csv"
              @click="handleExport('csv')"
              class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              Export CSV
            </button>
            <button
              data-name="export-json"
              @click="handleExport('json')"
              class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              Export JSON
            </button>
          </div>
        </div>

        <!-- Quick stats -->
        <div data-name="quick-stats" class="flex items-center gap-6 mt-3 text-sm">
          <div data-name="stat-messages" class="flex items-center gap-1">
            <span class="text-muted">Messages:</span>
            <span class="font-medium">{{ session.messageCount }}</span>
          </div>
          <div v-if="session.totalTokens" data-name="stat-tokens" class="flex items-center gap-1">
            <span class="text-muted">Tokens:</span>
            <TokenBadge :tokens="session.totalTokens" />
          </div>
          <!-- Per-model breakdown: inline for single model, dropdown for 2+ -->
          <template v-if="session.usedModels?.length === 1">
            <div data-name="stat-model-inline" class="flex items-center gap-1">
              <span class="text-muted">Model:</span>
              <span class="font-medium">{{ session.usedModels[0].model }}</span>
            </div>
          </template>
          <div v-else-if="session.usedModels && session.usedModels.length > 1" data-name="stat-model-dropdown" class="relative">
            <button
              data-name="models-dropdown-toggle"
              @click="showModels = !showModels"
              @blur="setTimeout(() => showModels = false, 150)"
              class="flex items-center gap-1.5 px-2 py-1 text-xs rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:opacity-80 transition-opacity"
            >
              <span class="opacity-70">{{ session.usedModels.length }} models</span>
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="showModels ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'" />
              </svg>
            </button>
            <div
              v-if="showModels"
              data-name="models-dropdown-panel"
              @mousedown.prevent
              class="absolute top-full left-0 mt-1 z-50 bg-primary border border-default rounded-lg shadow-lg p-3 min-w-[320px]"
            >
              <div
                v-for="m in session.usedModels"
                :key="m.model"
                class="flex items-center justify-between py-1.5 first:pt-0 last:pb-0 border-b border-default last:border-0 text-xs"
              >
                <span class="font-medium text-primary pr-3">{{ m.model }}</span>
              </div>
            </div>
          </div>
          <div v-else-if="session.model" data-name="stat-model-simple" class="flex items-center gap-1">
            <span class="text-muted">Model:</span>
            <span class="font-medium">{{ session.model }}</span>
          </div>
          <div data-name="stat-duration" class="flex items-center gap-1">
            <span class="text-muted">Duration:</span>
            <span class="font-medium">{{ formatDuration(session.stats.duration) }}</span>
          </div>
          <div data-name="stat-started" class="flex items-center gap-1">
            <span class="text-muted">Started:</span>
            <span class="font-medium">{{ formatDateTime(session.startTime) }}</span>
          </div>
          <!-- Session cost subtotal -->
          <div v-if="session.stats.tokens?.totalCost != null && session.stats.tokens.totalCost > 0" data-name="stat-cost" class="flex items-center gap-1">
            <span class="text-muted">Cost:</span>
            <span class="font-semibold text-green-700 dark:text-green-400">
              {{ formatCost(session.stats.tokens.totalCost) }}
            </span>
          </div>
        </div>

        <!-- Token data provenance note (shown when debug logs unavailable) -->
        <div
          v-if="session.tokenNote"
          data-name="token-note"
          class="mt-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <span>{{ session.tokenNote }}</span>
          <a
            v-if="session.source === 'vscode'"
            data-name="token-note-debug-logs-link"
            href="https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-0.5 underline decoration-amber-400 hover:decoration-amber-600 dark:decoration-amber-600 dark:hover:decoration-amber-400 transition-colors"
            title="Enable github.copilot.chat.agentDebugLog.fileLogging.enabled in VS Code settings for exact token data"
          >
            How to enable debug logs
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
            </svg>
          </a>
        </div>
      </div>

      <!-- Tab navigation -->
      <div data-name="tab-nav" class="bg-primary border-b border-default px-4">
        <nav class="flex gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            :data-name="`tab-${tab.id}`"
            @click="sessionsStore.setActiveView(tab.id)"
            :class="[
              'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              sessionsStore.activeView === tab.id
                ? 'text-accent border-accent'
                : 'text-secondary border-transparent hover:text-primary hover:border-gray-300'
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
      <div data-name="tab-content" class="flex-1 overflow-y-auto p-4">
        <TimelineView v-if="sessionsStore.activeView === 'timeline'" :session="session" />
        <ChartsView v-else-if="sessionsStore.activeView === 'charts'" :session="session" />
        <TreeView v-else-if="sessionsStore.activeView === 'tree'" :session="session" />
        <RawView v-else-if="sessionsStore.activeView === 'raw'" :session="session" />
      </div>
      </template><!-- end v-else (no subagent selected) -->
    </template>
  </main>
</template>
