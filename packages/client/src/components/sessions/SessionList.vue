<script setup lang="ts">
import { computed } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import SessionListItem from './SessionListItem.vue'
import type { ListViewMode } from '@/types'

const props = defineProps<{
  viewMode: ListViewMode
}>()

const sessionsStore = useSessionsStore()

const groupedSessions = computed(() => {
  if (props.viewMode === 'date') {
    return sessionsStore.sessionsByDate
  }
  return sessionsStore.sessionsByProject
})

const sortedGroups = computed(() => {
  const groups = Object.entries(groupedSessions.value)
  if (props.viewMode === 'date') {
    // Sort by date descending (most recent first)
    return groups.sort((a, b) => {
      const dateA = new Date(a[1][0]?.lastActivity || 0)
      const dateB = new Date(b[1][0]?.lastActivity || 0)
      return dateB.getTime() - dateA.getTime()
    })
  }
  // Sort by project name alphabetically
  return groups.sort((a, b) => a[0].localeCompare(b[0]))
})
</script>

<template>
  <div class="py-2">
    <!-- Loading state -->
    <div v-if="sessionsStore.loading" class="px-4 py-8 text-center text-muted">
      <svg class="animate-spin h-6 w-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      Loading sessions...
    </div>

    <!-- Error state -->
    <div v-else-if="sessionsStore.error" class="px-4 py-8 text-center text-error">
      <p>{{ sessionsStore.error }}</p>
      <button
        @click="sessionsStore.loadSessions()"
        class="mt-2 text-sm text-accent hover:underline"
      >
        Retry
      </button>
    </div>

    <!-- Empty state -->
    <div v-else-if="sessionsStore.filteredSessions.length === 0" class="px-4 py-8 text-center text-muted">
      <p>No sessions found</p>
    </div>

    <!-- Session groups -->
    <div v-else>
      <div
        v-for="[group, sessions] in sortedGroups"
        :key="group"
        class="mb-4"
      >
        <div class="px-4 py-1 text-xs font-semibold text-muted uppercase tracking-wider sticky top-0 bg-primary z-10">
          {{ group }}
          <span class="text-xs font-normal lowercase">({{ sessions.length }})</span>
        </div>
        <SessionListItem
          v-for="session in sessions"
          :key="`${session.source}-${session.id}`"
          :session="session"
        />
      </div>
    </div>
  </div>
</template>
