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
        v-for="filter in ['all', 'claude', 'copilot'] as const"
        :key="filter"
        @click="sessionsStore.setSourceFilter(filter)"
        :class="[
          'flex-1 py-2 px-3 text-sm font-medium transition-colors capitalize',
          sessionsStore.sourceFilter === filter
            ? 'text-accent border-b-2 border-accent'
            : 'text-secondary hover:text-primary'
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
