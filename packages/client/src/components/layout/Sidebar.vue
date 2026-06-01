<script setup lang="ts">
import { ref } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { usePreferences } from '@/composables/usePreferences'
import SessionList from '@/components/sessions/SessionList.vue'

const sessionsStore = useSessionsStore()
const { prefs, setListViewMode } = usePreferences()

const isResizing = ref(false)
const sidebarWidth = ref(prefs.value.sidebarWidth)
const showSourceDropdown = ref(false)

const sourceOptions = [
  { value: 'all', label: 'All Agents', color: 'bg-gray-500' },
  { value: 'claude', label: 'Claude', color: 'bg-orange-500' },
  { value: 'copilot', label: 'Copilot', color: 'bg-purple-500' },
  { value: 'codex', label: 'Codex', color: 'bg-blue-500' },
  { value: 'opencode', label: 'Opencode', color: 'bg-teal-500' },
  { value: 'vscode', label: 'VSCode', color: 'bg-blue-400' },
] as const

const activeOption = sourceOptions.find(o => o.value === sessionsStore.sourceFilter) ?? sourceOptions[0]

function selectSource(value: string) {
  sessionsStore.setSourceFilter(value as any)
  showSourceDropdown.value = false
}

function startResize(e: MouseEvent) {
  isResizing.value = true
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', stopResize)
}

function onResize(e: MouseEvent) {
  if (isResizing.value) {
    const newWidth = Math.min(Math.max(e.clientX, 200), 600)
    sidebarWidth.value = newWidth
  }
}

function stopResize() {
  isResizing.value = false
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', stopResize)
  prefs.value.sidebarWidth = sidebarWidth.value
}
</script>

<template>
  <aside
    class="bg-primary border-r border-default flex flex-col relative"
    :style="{ width: `${sidebarWidth}px` }"
  >
    <!-- Source filter dropdown -->
    <div class="relative border-b border-default px-3 py-2">
      <span class="text-xs text-muted mb-1 block">Agent</span>
      <button
        @click="showSourceDropdown = !showSourceDropdown"
        @blur="setTimeout(() => showSourceDropdown = false, 150)"
        class="w-full flex items-center justify-between px-3 py-1.5 text-sm rounded border border-default bg-secondary hover:bg-tertiary transition-colors"
      >
        <span class="flex items-center gap-2">
          <span :class="['w-2 h-2 rounded-full', activeOption.color]" />
          <span>{{ activeOption.label }}</span>
        </span>
        <svg class="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="showSourceDropdown ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'" />
        </svg>
      </button>
      <div
        v-if="showSourceDropdown"
        @mousedown.prevent
        class="absolute top-full left-3 right-3 z-50 bg-primary border border-default rounded-lg shadow-lg py-1 mt-1"
      >
        <button
          v-for="opt in sourceOptions"
          :key="opt.value"
          @click="selectSource(opt.value)"
          :class="[
            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
            sessionsStore.sourceFilter === opt.value
              ? 'bg-secondary font-medium'
              : 'hover:bg-secondary text-secondary hover:text-primary'
          ]"
        >
          <span :class="['w-2 h-2 rounded-full', opt.color]" />
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- View toggle -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-default">
      <span class="text-sm text-muted">View by:</span>
      <div class="flex gap-1">
        <button
          @click="setListViewMode('date')"
          :class="[
            'px-2 py-1 text-xs rounded',
            prefs.listViewMode === 'date'
              ? 'bg-accent text-white'
              : 'bg-tertiary text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          ]"
        >
          Date
        </button>
        <button
          @click="setListViewMode('project')"
          :class="[
            'px-2 py-1 text-xs rounded',
            prefs.listViewMode === 'project'
              ? 'bg-accent text-white'
              : 'bg-tertiary text-secondary hover:bg-gray-200 dark:hover:bg-gray-600'
          ]"
        >
          Project
        </button>
      </div>
    </div>

    <!-- Session list -->
    <div class="flex-1 overflow-y-auto">
      <SessionList :view-mode="prefs.listViewMode" />
    </div>

    <!-- Stats footer -->
    <div class="px-3 py-2 border-t border-default text-xs text-muted">
      {{ sessionsStore.filteredSessions.length }} sessions
    </div>

    <!-- Resize handle -->
    <div
      class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-accent/50 transition-colors"
      @mousedown="startResize"
    />
  </aside>
</template>
