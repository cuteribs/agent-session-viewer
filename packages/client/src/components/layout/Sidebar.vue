<script setup lang="ts">
import { useSessionsStore } from '@/stores/sessions'
import { usePreferences } from '@/composables/usePreferences'
import SessionList from '@/components/sessions/SessionList.vue'

const sessionsStore = useSessionsStore()
const { prefs, setListViewMode } = usePreferences()
</script>

<template>
  <aside
    data-name="sidebar"
    class="bg-surface-container hidden md:flex flex-col h-full w-sidebar-width shrink-0 border-r border-outline-variant z-40"
  >
    <!-- Search + Sort controls -->
    <div class="px-gutter py-3 border-b border-outline-variant flex flex-col gap-2">
      <!-- Search -->
      <div class="relative">
        <span class="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant" style="font-size:16px">search</span>
        <input
          type="text"
          :value="sessionsStore.searchQuery"
          @input="sessionsStore.setSearchQuery(($event.target as HTMLInputElement).value)"
          placeholder="Search sessions..."
          class="w-full bg-surface-container-highest border border-outline-variant rounded-DEFAULT py-1.5 pl-8 pr-2 text-body-sm font-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      <!-- Sort By -->
      <div class="flex justify-between items-center px-1">
        <span class="font-label-caps text-label-caps text-on-surface-variant">SORT BY</span>
        <select
          :value="prefs.listViewMode"
          @change="setListViewMode(($event.target as HTMLSelectElement).value as any)"
          class="bg-transparent text-body-sm font-body-sm text-on-surface-variant border-none p-0 focus:ring-0 cursor-pointer"
        >
          <option value="date">Date</option>
          <option value="project">Project</option>
          <option value="wilder">Wilder</option>
        </select>
      </div>
    </div>

    <!-- Session list -->
    <nav data-name="session-list-container" class="flex-1 overflow-y-auto py-2">
      <SessionList :view-mode="prefs.listViewMode" />
    </nav>

    <!-- Footer -->
    <div data-name="sidebar-footer" class="px-gutter py-2 border-t border-outline-variant text-label-caps font-label-caps text-on-surface-variant">
      {{ sessionsStore.filteredSessions.length }} SESSIONS
    </div>
  </aside>
</template>
