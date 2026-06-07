<script setup lang="ts">
import { ref } from 'vue'
import type { SessionSummary } from '@/types'
import { useSessionsStore } from '@/stores/sessions'
import { formatTokens, formatCost, formatRelativeTime } from '@/utils/formatters'

const props = defineProps<{ session: SessionSummary; active: boolean }>()
const sessions = useSessionsStore()
const subExpanded = ref(false)

const sourceColors: Record<string, string> = {
  claude: 'bg-orange-500', copilot: 'bg-blue-500', codex: 'bg-teal-500',
  opencode: 'bg-purple-500', vscode: 'bg-blue-400',
}
</script>

<template>
  <li
    class="w-full text-left px-4 py-3 hover:bg-tertiary transition-colors border-l-2 relative group cursor-pointer"
    :class="active ? 'bg-tertiary border-accent' : 'border-transparent'"
    @click="sessions.selectSession(session.id)"
  >
    <!-- Source dot + project name -->
    <div class="flex items-center gap-2 mb-1 min-w-0">
      <span class="w-2 h-2 rounded-full flex-shrink-0" :class="sourceColors[session.source] ?? 'bg-gray-400'" />
      <span class="font-medium text-primary truncate text-sm flex-1">{{ session.project }}</span>
    </div>

    <!-- ID + time -->
    <div class="flex justify-between items-center">
      <span class="text-xs text-muted font-mono">{{ session.id.slice(0, 8) }}</span>
      <span class="text-xs text-muted">{{ formatRelativeTime(session.lastActivity) }}</span>
    </div>

    <!-- Messages + tokens -->
    <div class="flex justify-between items-center mt-1">
      <span class="text-xs text-secondary">{{ session.messageCount }} messages</span>
      <span v-if="session.totalTokens" class="text-xs text-secondary">
        {{ formatTokens(session.totalTokens) }}
        <span v-if="session.cost && session.cost > 0" class="text-muted"> · {{ formatCost(session.cost) }}</span>
      </span>
    </div>

    <!-- Subagents expander -->
    <template v-if="session.subAgentCount && session.subAgentCount > 0">
      <button
        class="mt-1.5 w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-secondary transition-colors rounded"
        @click.stop="subExpanded = !subExpanded"
      >
        <span class="w-3 h-3 transition-transform" :class="subExpanded ? 'rotate-90' : ''">▶</span>
        <span class="text-muted">{{ session.subAgentCount }} subagent{{ session.subAgentCount !== 1 ? 's' : '' }}</span>
      </button>
      <ul v-if="subExpanded" class="mt-0.5 flex flex-col">
        <li
          v-for="agent in sessions.currentSession?.subAgents ?? []"
          :key="agent.id"
          class="w-full flex items-center gap-2 px-5 py-1.5 text-xs hover:bg-tertiary transition-colors cursor-pointer text-secondary"
          @click.stop="sessions.selectSubAgent(agent.id)"
        >
          <span class="material-symbols-outlined" style="font-size:12px">smart_toy</span>
          {{ agent.agentDisplayName }}
        </li>
      </ul>
    </template>
  </li>
</template>
