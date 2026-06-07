<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useSessionsStore } from '@/stores/sessions'
import AppHeader from '@/components/layout/AppHeader.vue'
import AppSidebar from '@/components/layout/AppSidebar.vue'
import TimelineView from '@/components/views/TimelineView.vue'
import ChartView from '@/components/views/ChartView.vue'
import TreeView from '@/components/views/TreeView.vue'
import RawView from '@/components/views/RawView.vue'
import SettingsModal from '@/components/modals/SettingsModal.vue'
import StatCard from '@/components/common/StatCard.vue'
import { formatTokens, formatCost, formatDuration, formatRelativeTime } from '@/utils/formatters'

const config = useConfigStore()
const sessions = useSessionsStore()

const settingsOpen = ref(false)
const activeTab = ref<'timeline' | 'charts' | 'tree' | 'raw'>('timeline')

// Reset tab when session changes
watch(() => sessions.currentSessionId, () => { activeTab.value = 'timeline' })

// The detail being shown: subagent or main session
const viewDetail = computed(() => {
  if (sessions.currentSubAgent) {
    const a = sessions.currentSubAgent
    // Build a synthetic SessionDetail for the subagent
    const messages = a.messages ?? []
    const toolMap = new Map<string, { count: number; successes: number }>()
    let totIn = 0, totOut = 0, totCost = 0
    const inputPM: number[] = [], outputPM: number[] = [], cumul: number[] = []
    let cumT = 0
    for (const m of messages) {
      if (m.tokens) {
        totIn += m.tokens.input; totOut += m.tokens.output; totCost += m.tokens.cost ?? 0
        inputPM.push(m.tokens.input); outputPM.push(m.tokens.output); cumT += m.tokens.input + m.tokens.output; cumul.push(cumT)
      }
      for (const tc of m.toolCalls ?? []) {
        const e = toolMap.get(tc.name) ?? { count: 0, successes: 0 }; e.count++; e.successes++; toolMap.set(tc.name, e)
      }
    }
    const toolUsage = Array.from(toolMap.entries()).map(([name, { count, successes }]) => ({ name, count, successRate: count > 0 ? successes / count : 0 }))
    return {
      id: a.id, source: sessions.currentSession!.source, project: a.agentDisplayName, projectPath: '', model: a.model,
      startTime: a.startTime, lastActivity: a.endTime ?? a.startTime, messageCount: messages.length,
      totalTokens: a.totalTokens, cost: totCost, messages, toolUsage,
      stats: {
        messageCount: messages.length,
        userMessages: messages.filter(m => m.role === 'user').length,
        assistantMessages: messages.filter(m => m.role === 'assistant').length,
        tokens: inputPM.length > 0 ? { totalInput: totIn, totalOutput: totOut, totalCacheRead: 0, totalCacheCreation: 0, totalCost: totCost, inputPerMessage: inputPM, outputPerMessage: outputPM, cumulativeTokens: cumul } : undefined,
        tools: toolUsage.map(t => ({ name: t.name, count: t.count, successRate: t.successRate })),
        duration: a.durationMs ?? 0,
      },
    }
  }
  return sessions.currentSession
})

const statCards = computed(() => {
  const d = viewDetail.value; if (!d) return []
  return [
    { icon: 'chat', label: 'MESSAGES', value: String(d.messageCount) },
    { icon: 'token', label: 'TOKENS', value: formatTokens(d.totalTokens) },
    { icon: 'timer', label: 'DURATION', value: formatDuration(d.stats.duration) },
    { icon: 'payments', label: 'COST', value: formatCost(d.cost) },
  ]
})

const hasDirectories = computed(() => true)  // always true — server handles paths

// Auto-refresh management
let refreshTimer: ReturnType<typeof setInterval> | null = null
watch([() => config.autoRefresh, () => config.refreshIntervalMs], ([enabled]) => {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (enabled) refreshTimer = setInterval(() => sessions.loadAll(), config.refreshIntervalMs)
}, { immediate: true })
onUnmounted(() => { if (refreshTimer) clearInterval(refreshTimer) })

// Startup
onMounted(async () => {
  config.init()
  await sessions.loadAll()
})
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <AppHeader @open-settings="settingsOpen = true" />

    <div class="flex flex-1 overflow-hidden">
      <AppSidebar />

      <!-- Main canvas -->
      <main class="flex-1 flex flex-col bg-secondary min-w-0 overflow-hidden">

        <!-- Server offline state -->
        <div v-if="sessions.serverOnline === false && !sessions.loading" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <span class="material-symbols-outlined text-red-400" style="font-size:48px">cloud_off</span>
          <h2 class="text-xl font-semibold text-primary">Server Not Running</h2>
          <p class="text-sm text-muted max-w-sm">The Agent Session Viewer server is not reachable at <code class="font-mono text-accent">{{ config.serverUrl }}</code>.</p>
          <div class="bg-tertiary rounded-lg p-4 text-left w-full max-w-sm">
            <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Start the server:</p>
            <pre class="font-mono text-xs text-primary select-all">npx @cuteribs/agent-session-viewer</pre>
          </div>
          <button
            class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90"
            @click="sessions.loadAll()"
          >
            <span class="material-symbols-outlined" style="font-size:16px">refresh</span>
            Retry
          </button>
          <button class="text-xs text-accent hover:underline" @click="settingsOpen = true">Change server URL</button>
        </div>

        <!-- Empty / first-run state -->
        <div v-else-if="!sessions.currentSession && !sessions.detailLoading && sessions.serverOnline !== false" class="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <span class="material-symbols-outlined text-muted" style="font-size:48px; font-variation-settings:'FILL' 1">terminal</span>
          <h2 class="text-2xl font-bold text-primary">Agent Session Viewer</h2>
          <p class="text-sm text-muted max-w-sm">
            {{ hasDirectories ? 'Select a session from the sidebar to get started.' : 'Open Settings to configure your session directories.' }}
          </p>
          <button
            v-if="!hasDirectories"
            class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            @click="settingsOpen = true"
          >
            <span class="material-symbols-outlined" style="font-size:16px">settings</span>
            Setup Directories
          </button>
          <button
            v-else
            class="flex items-center gap-2 px-4 py-2 bg-secondary border border-default rounded-lg text-sm text-primary hover:bg-tertiary transition-colors"
            :disabled="sessions.loading"
            @click="sessions.loadAll()"
          >
            <span class="material-symbols-outlined" style="font-size:16px">refresh</span>
            {{ sessions.loading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>

        <!-- Session detail loading -->
        <div v-else-if="sessions.detailLoading" class="flex-1 flex items-center justify-center">
          <div class="flex flex-col items-center gap-2 text-muted">
            <span class="material-symbols-outlined text-3xl animate-spin">autorenew</span>
            <span class="text-sm">Loading session…</span>
          </div>
        </div>

        <!-- Session detail view -->
        <template v-else-if="viewDetail">
          <!-- Header summary panel -->
          <div class="bg-primary px-4 py-4 border-b border-default shrink-0 shadow-sm">
            <!-- Breadcrumb (subagent nav) -->
            <div v-if="sessions.currentSubAgent" class="flex items-center gap-2 mb-3">
              <button class="flex items-center gap-1 text-sm text-accent hover:underline" @click="sessions.selectSubAgent(null)">
                <span class="material-symbols-outlined" style="font-size:14px">arrow_back</span>
                {{ sessions.currentSession?.project }}
              </button>
              <span class="text-muted">/</span>
              <span class="text-sm text-primary">{{ sessions.currentSubAgent.agentDisplayName }}</span>
            </div>

            <div class="flex items-start gap-3 mb-4">
              <div class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined text-accent">smart_toy</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-lg font-semibold text-primary">{{ viewDetail.project }}</h1>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-secondary rounded font-medium text-muted uppercase">{{ viewDetail.source }}</span>
                  <span v-if="viewDetail.model" class="text-xs text-accent font-mono">{{ viewDetail.model }}</span>
                </div>
                <div class="text-xs text-muted font-mono mt-0.5">{{ viewDetail.id.slice(0, 32) }}</div>
              </div>
              <div class="text-right shrink-0">
                <div class="text-xs text-muted">Started</div>
                <div class="text-sm text-secondary">{{ formatRelativeTime(viewDetail.startTime) }}</div>
              </div>
            </div>

            <!-- Stat cards -->
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard v-for="card in statCards" :key="card.label" :icon="card.icon" :label="card.label" :value="card.value" />
            </div>
          </div>

          <!-- Tab nav -->
          <div class="border-b border-default bg-primary shrink-0 px-4">
            <nav class="flex">
              <button
                v-for="tab in (['timeline', 'charts', 'tree', 'raw'] as const)"
                :key="tab"
                class="px-4 py-2.5 text-sm border-b-2 transition-colors capitalize"
                :class="activeTab === tab
                  ? 'border-accent text-accent font-medium'
                  : 'border-transparent text-muted hover:text-primary'"
                @click="activeTab = tab"
              >
                {{ tab }}
              </button>
            </nav>
          </div>

          <!-- Tab content -->
          <div class="flex-1 overflow-y-auto px-4 py-4">
            <TimelineView v-if="activeTab === 'timeline'" :session="viewDetail" />
            <ChartView v-else-if="activeTab === 'charts'" :session="viewDetail" />
            <TreeView v-else-if="activeTab === 'tree'" :session="viewDetail" />
            <RawView v-else-if="activeTab === 'raw'" :session="viewDetail" />
          </div>
        </template>
      </main>
    </div>

    <!-- Settings modal -->
    <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>
