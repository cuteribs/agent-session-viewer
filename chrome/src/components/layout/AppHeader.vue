<script setup lang="ts">
import { computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useSessionsStore } from '@/stores/sessions'
import type { DataSource } from '@/types'

const emit = defineEmits<{ openSettings: [] }>()
const config = useConfigStore()
const sessions = useSessionsStore()

const sources: { id: DataSource | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'claude', label: 'Claude' },
  { id: 'copilot', label: 'Copilot' },
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'vscode', label: 'VS Code' },
]

const themeIcon = computed(() =>
  config.theme === 'dark' ? 'dark_mode' : config.theme === 'light' ? 'light_mode' : 'contrast'
)
function cycleTheme() {
  const order: typeof config.theme[] = ['system', 'light', 'dark']
  const idx = order.indexOf(config.theme)
  config.theme = order[(idx + 1) % order.length]
}
</script>

<template>
  <header class="h-16 bg-primary border-b border-default flex items-center px-4 gap-4">
    <!-- Left: logo -->
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-accent" style="font-size:22px; font-variation-settings:'FILL' 1">terminal</span>
      <span class="text-lg font-semibold text-primary hidden sm:block">Agent Session Viewer</span>
    </div>

    <!-- Center: source filter -->
    <nav class="flex items-center gap-1 overflow-x-auto flex-1">
      <button
        v-for="src in sources"
        :key="src.id"
        class="px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0"
        :class="config.sourceFilter === src.id
          ? 'bg-accent text-white'
          : 'text-muted hover:bg-tertiary'"
        @click="config.sourceFilter = src.id"
      >
        {{ src.label }}
      </button>
    </nav>

    <!-- Right: server status + actions -->
    <div class="flex items-center gap-1">
      <!-- Server online indicator -->
      <div class="flex items-center gap-1.5 mr-2">
        <span
          class="w-2 h-2 rounded-full"
          :class="{
            'bg-green-500 animate-pulse': sessions.serverOnline === true,
            'bg-red-500':  sessions.serverOnline === false,
            'bg-gray-400': sessions.serverOnline === null,
          }"
        />
        <span class="text-xs text-muted hidden lg:block">
          {{ sessions.serverOnline === true ? 'Connected' : sessions.serverOnline === false ? 'Offline' : '' }}
        </span>
      </div>
      <button
        class="p-2 rounded-lg hover:bg-tertiary transition-colors text-muted"
        :title="`Theme: ${config.theme}`"
        @click="cycleTheme"
      >
        <span class="material-symbols-outlined" style="font-size:18px">{{ themeIcon }}</span>
      </button>
      <button
        class="p-2 rounded-lg transition-colors"
        :class="config.autoRefresh ? 'text-accent' : 'text-muted hover:bg-tertiary'"
        title="Auto-refresh"
        @click="config.autoRefresh = !config.autoRefresh"
      >
        <span class="material-symbols-outlined" style="font-size:18px">refresh</span>
      </button>
      <button
        class="p-2 rounded-lg hover:bg-tertiary transition-colors text-muted"
        title="Settings"
        @click="emit('openSettings')"
      >
        <span class="material-symbols-outlined" style="font-size:18px">settings</span>
      </button>
    </div>
  </header>
</template>
