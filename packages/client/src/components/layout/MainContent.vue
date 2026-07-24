<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatDateTime, formatDuration, formatCost, getSourceBgColor } from '@/utils/formatters'
import { getExportURL } from '@/utils/api'
import TimelineView from '@/components/views/TimelineView.vue'
import ChartsView from '@/components/views/ChartsView.vue'
import LogFileView from '@/components/views/LogFileView.vue'
import SubAgentView from '@/components/views/SubAgentView.vue'
import TokenBadge from '@/components/common/TokenBadge.vue'

const sessionsStore = useSessionsStore()

const tabs = [
  { id: 'timeline', label: 'Timeline', icon: 'view_timeline' },
  { id: 'charts', label: 'Charts', icon: 'bar_chart' },
  { id: 'logfile', label: 'Log File', icon: 'description' },
] as const

const session = computed(() => sessionsStore.currentSession)
const sessionCost = computed(() => session.value?.cost ?? session.value?.stats.tokens?.totalCost)
const selectedSubAgent = computed(() => sessionsStore.selectedSubAgent)
const showModels = ref(false)
const showToolMessages = ref(true)

function handleExport(format: 'csv' | 'json') {
  if (!session.value) return
  const url = getExportURL(session.value.source, session.value.id, format)
  window.open(url, '_blank')
}
</script>

<template>
  <main data-name="main-content" class="flex-1 flex flex-col overflow-hidden bg-surface min-w-0">
    <!-- Empty state -->
    <div
      v-if="!session"
      data-name="empty-state"
      class="flex-1 flex items-center justify-center text-on-surface-variant"
    >
      <div class="text-center">
        <span class="material-symbols-outlined text-6xl opacity-40 block mb-4">smart_toy</span>
        <p class="font-headline-sm text-headline-sm text-on-surface">Select a session to view details</p>
        <p class="font-body-sm text-body-sm mt-1">Choose from the sidebar on the left</p>
      </div>
    </div>

    <!-- Session content -->
    <template v-else>
      <!-- SubAgent view -->
      <SubAgentView
        v-if="selectedSubAgent"
        :agent="selectedSubAgent"
        :parent-name="session.project"
        @back="sessionsStore.clearSubAgent()"
        class="flex-1 overflow-hidden"
      />

      <!-- Normal session view -->
      <template v-else>
        <!-- Session header panel -->
        <div data-name="session-header" class="bg-surface p-container-padding border-b border-outline-variant shrink-0 relative z-10 shadow-sm">
          <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
            <!-- Left: agent icon + info -->
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl bg-secondary-container flex items-center justify-center">
                <span class="material-symbols-outlined text-primary" style="font-size:28px; font-variation-settings: 'FILL' 1">smart_toy</span>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h1 class="font-headline-lg text-headline-lg text-on-surface">{{ session.source }}</h1>
                  <span
                    data-name="source-badge"
                    :class="[
                      'px-2 py-0.5 text-xs font-medium rounded-full text-white capitalize',
                      getSourceBgColor(session.source)
                    ]"
                  >{{ session.source }}</span>
                </div>
                <div class="flex items-center gap-2 mt-1 text-on-surface-variant font-body-sm text-body-sm">
                  <span
                    v-if="session.incomplete"
                    title="Session has no shutdown record — it may have been interrupted or is still in progress. Token counts are estimated."
                    class="flex-shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400/20 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400 cursor-help"
                    style="font-size:9px; line-height:1; font-weight:700;"
                  >!</span>
                  <span
                    :class="['font-semibold', session.incomplete ? 'text-on-surface/50' : 'text-on-surface']"
                    data-name="project-name"
                  >{{ session.project }}</span>
                  <span>•</span>
                  <span class="font-code-sm text-code-sm bg-surface-container px-1.5 py-0.5 rounded-DEFAULT" data-name="project-path">{{ session.projectPath }}</span>
                </div>
              </div>
            </div>

            <!-- Right: session ID + model + export -->
            <div class="flex flex-wrap gap-x-6 gap-y-2 lg:justify-end items-end">
              <div class="flex flex-col">
                <span class="font-label-caps text-label-caps text-on-surface-variant">SESSION ID</span>
                <span data-name="session-id" class="font-code-sm text-code-sm text-on-surface">{{ session.id.substring(0, 36) }}</span>
              </div>

              <!-- Model display -->
              <div class="flex flex-col">
                <span class="font-label-caps text-label-caps text-on-surface-variant">MODEL</span>
                <template v-if="session.usedModels?.length === 1">
                  <span class="font-body-sm text-body-sm font-semibold text-primary">{{ session.usedModels[0].model }}</span>
                </template>
                <div v-else-if="session.usedModels && session.usedModels.length > 1" data-name="stat-model-dropdown" class="relative">
                  <button
                    data-name="models-dropdown-toggle"
                    @click="showModels = !showModels"
                    @blur="setTimeout(() => showModels = false, 150)"
                    class="flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:opacity-80 transition-opacity"
                  >
                    <span>{{ session.usedModels.length }} models</span>
                    <span class="material-symbols-outlined" style="font-size:16px">{{ showModels ? 'expand_less' : 'expand_more' }}</span>
                  </button>
                  <div
                    v-if="showModels"
                    data-name="models-dropdown-panel"
                    @mousedown.prevent
                    class="absolute top-full right-0 mt-1 z-50 bg-surface border border-outline-variant rounded-xl shadow-lg p-3 min-w-[280px]"
                  >
                    <div
                      v-for="m in session.usedModels"
                      :key="m.model"
                      class="flex items-center justify-between py-1.5 first:pt-0 last:pb-0 border-b border-outline-variant last:border-0 text-body-sm"
                    >
                      <span class="font-medium text-on-surface pr-3">{{ m.model }}</span>
                    </div>
                  </div>
                </div>
                <span v-else-if="session.model" class="font-body-sm text-body-sm font-semibold text-primary">{{ session.model }}</span>
              </div>

              <!-- Export buttons -->
              <div data-name="export-buttons" class="flex gap-2">
                <button
                  data-name="export-csv"
                  @click="handleExport('csv')"
                  class="px-3 py-1 text-body-sm bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-DEFAULT transition-colors text-on-surface"
                >CSV</button>
                <button
                  data-name="export-json"
                  @click="handleExport('json')"
                  class="px-3 py-1 text-body-sm bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-DEFAULT transition-colors text-on-surface"
                >JSON</button>
              </div>
            </div>
          </div>

          <!-- Token data provenance note -->
          <div
            v-if="session.tokenNote"
            data-name="token-note"
            class="mb-3 flex items-center gap-1.5 text-body-sm text-yellow-700 dark:text-yellow-400"
          >
            <span class="material-symbols-outlined" style="font-size:14px">warning</span>
            <span>{{ session.tokenNote }}</span>
            <a
              v-if="session.source === 'vscode'"
              data-name="token-note-debug-logs-link"
              href="https://code.visualstudio.com/docs/agents/agent-troubleshooting/chat-debug-view"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-0.5 underline hover:no-underline transition-all"
            >How to enable debug logs
              <span class="material-symbols-outlined" style="font-size:12px">open_in_new</span>
            </a>
          </div>

          <!-- Metrics bento box -->
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
              <span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">MESSAGES</span>
              <span class="font-headline-md text-headline-md text-on-surface">{{ session.messageCount }}</span>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
              <span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">TOTAL TOKENS</span>
              <div v-if="session.totalTokens">
                <TokenBadge :tokens="session.totalTokens" variant="compact" />
              </div>
              <span v-else class="font-code-md text-code-md text-on-surface">—</span>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
              <span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">DURATION</span>
              <span class="font-headline-md text-headline-md text-on-surface">{{ formatDuration(session.stats.duration) }}</span>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
              <span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">STARTED</span>
              <span class="font-code-sm text-code-sm text-on-surface block">{{ formatDateTime(session.startTime) }}</span>
            </div>
            <div class="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
              <span class="font-label-caps text-label-caps text-on-surface-variant block mb-1">COST</span>
              <span
                v-if="sessionCost != null && sessionCost > 0"
                class="font-headline-md text-headline-md text-primary"
              >{{ formatCost(sessionCost) }}</span>
              <span v-else class="font-headline-md text-headline-md text-on-surface-variant">—</span>
            </div>
          </div>
        </div>

        <!-- Tab navigation -->
        <div data-name="tab-nav" class="px-container-padding border-b border-outline-variant bg-surface shrink-0 z-10">
          <div class="flex items-center justify-between">
            <div class="flex gap-stack-md">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                :data-name="`tab-${tab.id}`"
                @click="sessionsStore.setActiveView(tab.id)"
                :class="[
                  'font-headline-sm text-headline-sm py-3 px-2 flex items-center gap-2 border-b-2 transition-colors',
                  sessionsStore.activeView === tab.id
                    ? 'text-primary border-primary'
                    : 'text-on-surface-variant hover:text-on-surface border-transparent'
                ]"
              >
                <span class="material-symbols-outlined" style="font-size:18px">{{ tab.icon }}</span>
                {{ tab.label }}
              </button>
            </div>
            <!-- Timeline-specific controls -->
            <div v-if="sessionsStore.activeView === 'timeline'" class="flex items-center">
              <button
                data-name="toggle-tool-messages"
                class="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors"
                :class="showToolMessages
                  ? 'bg-primary/10 text-primary hover:bg-primary/20'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'"
                @click="showToolMessages = !showToolMessages"
              >
                <span class="material-symbols-outlined" style="font-size:14px">settings</span>
                {{ showToolMessages ? 'Hide Tools' : 'Show Tools' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tab content -->
        <div data-name="tab-content" class="flex-1 overflow-hidden p-4">
          <TimelineView v-if="sessionsStore.activeView === 'timeline'" :session="session" :show-tool-messages="showToolMessages" />
          <ChartsView v-else-if="sessionsStore.activeView === 'charts'" :session="session" />
          <LogFileView v-else-if="sessionsStore.activeView === 'logfile'" :session="session" />
        </div>
      </template>
    </template>
  </main>
</template>
