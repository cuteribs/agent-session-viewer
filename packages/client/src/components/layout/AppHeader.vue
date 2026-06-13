<script setup lang="ts">
import { useSessionsStore } from '@/stores/sessions'
import { useTheme } from '@/composables/useTheme'

const sessionsStore = useSessionsStore()
const { toggleTheme } = useTheme()

const sourceOptions = [
  { value: 'all', label: 'All Agents' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'copilot', label: 'Copilot CLI' },
  { value: 'codex', label: 'Codex' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'vscode', label: 'VSCode Chat' },
] as const

function handleSourceChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  sessionsStore.setSourceFilter(val as any)
}
</script>

<template>
  <header
    class="bg-surface border-b border-outline-variant flex justify-between items-center w-full px-gutter h-16 shrink-0 z-50">
    <!-- Logo -->
    <div class="flex items-center gap-stack-md">
      <span class="material-symbols-outlined text-primary text-2xl"
        style="font-variation-settings: 'FILL' 1">terminal</span>
      <span class="font-headline-md text-headline-md font-bold text-primary hidden sm:block">
        Agent Session Viewer
      </span>
    </div>

    <!-- Right side actions -->
    <div class="flex items-center gap-stack-sm">
      <!-- Agent filter dropdown -->
      <div class="relative hidden lg:block mr-2">
        <select :value="sessionsStore.sourceFilter" @change="handleSourceChange"
          class="appearance-none bg-surface-container border border-outline-variant rounded-DEFAULT py-1 pl-3 pr-8 text-body-sm font-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer">
          <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-on-surface-variant">
          <span class="material-symbols-outlined text-sm" style="font-size:18px">expand_more</span>
        </div>
      </div>

      <!-- Theme toggle -->
      <button @click="toggleTheme"
        class="p-1.5 text-on-surface-variant hover:text-primary transition-colors cursor-pointer rounded-DEFAULT hover:bg-surface-container-high"
        title="Toggle theme">
        <span class="material-symbols-outlined" style="font-size:20px">contrast</span>
      </button>

      <!-- Settings -->
      <button @click="sessionsStore.openSettings()"
        class="p-1.5 text-on-surface-variant hover:text-primary transition-colors cursor-pointer rounded-DEFAULT hover:bg-surface-container-high"
        title="Settings">
        <span class="material-symbols-outlined" style="font-size:20px">settings</span>
      </button>

      <div class="h-8 w-px bg-outline-variant mx-2"></div>

      <!-- GitHub link with stars -->
      <a href="https://github.com/cuteribs/agent-session-viewer" target="_blank" rel="noopener noreferrer"
        class="flex items-center gap-1 px-1.5 py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer rounded-DEFAULT hover:bg-surface-container-high"
        title="GitHub">
        <img src="https://img.shields.io/github/stars/cuteribs/agent-session-viewer" alt="GitHub Stars" style="height:25px" />
      </a>

    </div>
  </header>
</template>
