<script setup lang="ts">
import { computed } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatDateTime, formatTokens, formatDuration } from '@/utils/formatters'
import { getExportURL } from '@/utils/api'
import TimelineView from '@/components/views/TimelineView.vue'
import ChartsView from '@/components/views/ChartsView.vue'
import TreeView from '@/components/views/TreeView.vue'
import RawView from '@/components/views/RawView.vue'
import TokenBadge from '@/components/common/TokenBadge.vue'

const sessionsStore = useSessionsStore()

const tabs = [
  { id: 'timeline', label: 'Timeline', icon: 'M4 6h16M4 12h16M4 18h16' },
  { id: 'charts', label: 'Charts', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { id: 'tree', label: 'Tree', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
  { id: 'raw', label: 'Raw', icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4' },
] as const

const session = computed(() => sessionsStore.currentSession)

function handleExport(format: 'csv' | 'json') {
  if (!session.value) return
  const url = getExportURL(session.value.source, session.value.id, format)
  window.open(url, '_blank')
}
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden bg-secondary">
    <!-- Empty state -->
    <div
      v-if="!session"
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
      <!-- Session header -->
      <div class="bg-primary border-b border-default px-4 py-3">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span
                :class="[
                  'px-2 py-0.5 text-xs font-medium rounded-full text-white',
                  session.source === 'claude' ? 'bg-orange-500' : 'bg-purple-500'
                ]"
              >
                {{ session.source }}
              </span>
              <h2 class="text-lg font-semibold text-primary">{{ session.project }}</h2>
            </div>
            <p class="text-sm text-muted mt-1">{{ session.projectPath }}</p>
          </div>

          <!-- Export buttons -->
          <div class="flex gap-2">
            <button
              @click="handleExport('csv')"
              class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              Export CSV
            </button>
            <button
              @click="handleExport('json')"
              class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              Export JSON
            </button>
          </div>
        </div>

        <!-- Quick stats -->
        <div class="flex items-center gap-6 mt-3 text-sm">
          <div class="flex items-center gap-1">
            <span class="text-muted">Messages:</span>
            <span class="font-medium">{{ session.messageCount }}</span>
          </div>
          <div v-if="session.totalTokens" class="flex items-center gap-1">
            <span class="text-muted">Tokens:</span>
            <TokenBadge :tokens="session.totalTokens" />
          </div>
          <div v-if="session.model" class="flex items-center gap-1">
            <span class="text-muted">Model:</span>
            <span class="font-medium">{{ session.model }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-muted">Duration:</span>
            <span class="font-medium">{{ formatDuration(session.stats.duration) }}</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-muted">Started:</span>
            <span class="font-medium">{{ formatDateTime(session.startTime) }}</span>
          </div>
        </div>
      </div>

      <!-- Tab navigation -->
      <div class="bg-primary border-b border-default px-4">
        <nav class="flex gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
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
      <div class="flex-1 overflow-y-auto p-4">
        <TimelineView v-if="sessionsStore.activeView === 'timeline'" :session="session" />
        <ChartsView v-else-if="sessionsStore.activeView === 'charts'" :session="session" />
        <TreeView v-else-if="sessionsStore.activeView === 'tree'" :session="session" />
        <RawView v-else-if="sessionsStore.activeView === 'raw'" :session="session" />
      </div>
    </template>
  </main>
</template>
