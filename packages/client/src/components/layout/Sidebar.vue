<script setup lang="ts">
import { ref } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { usePreferences } from '@/composables/usePreferences'
import SessionList from '@/components/sessions/SessionList.vue'

const sessionsStore = useSessionsStore()
const { prefs, setListViewMode } = usePreferences()

const isResizing = ref(false)
const sidebarWidth = ref(prefs.value.sidebarWidth)

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
    <!-- Filter tabs -->
    <div class="flex border-b border-default">
      <button
        v-for="filter in ['all', 'claude', 'copilot', 'codex'] as const"
        :key="filter"
        @click="sessionsStore.setSourceFilter(filter)"
        :class="[
          'flex-1 py-2 px-3 text-sm font-medium transition-colors capitalize',
          sessionsStore.sourceFilter === filter
            ? [
                'border-b-2 text-white',
                filter === 'all'     ? 'bg-gray-500     border-gray-500'     : '',
                filter === 'claude'  ? 'bg-orange-500   border-orange-500'   : '',
                filter === 'copilot' ? 'bg-purple-500   border-purple-500'   : '',
                filter === 'codex'   ? 'bg-blue-500     border-blue-500'     : '',
              ]
            : [
                'text-secondary hover:text-primary',
                filter === 'claude'  ? 'hover:bg-orange-50  dark:hover:bg-orange-900/10'  : '',
                filter === 'copilot' ? 'hover:bg-purple-50  dark:hover:bg-purple-900/10' : '',
                filter === 'codex'   ? 'hover:bg-blue-50    dark:hover:bg-blue-900/10'   : '',
                filter === 'all'     ? 'hover:bg-gray-100   dark:hover:bg-gray-700/30'   : '',
              ]
        ]"
      >
        {{ filter }}
      </button>
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
