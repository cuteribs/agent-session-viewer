<script setup lang="ts">
import { computed } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import SessionListItem from './SessionListItem.vue'
import type { ListViewMode, SessionSummary } from '@/types'

const props = defineProps<{
  viewMode: ListViewMode
}>()

const sessionsStore = useSessionsStore()

const groupedSessions = computed((): Record<string, SessionSummary[]> => {
  if (props.viewMode === 'date') {
    return sessionsStore.sessionsByDate
  }
  if (props.viewMode === 'wilder') {
    return sessionsStore.sessionsByName
  }
  return sessionsStore.sessionsByProject
})

const sortedGroups = computed(() => {
  const groups = Object.entries(groupedSessions.value)
  if (props.viewMode === 'date') {
    return groups.sort((a, b) => {
      const dateA = new Date(a[1][0]?.lastActivity || 0)
      const dateB = new Date(b[1][0]?.lastActivity || 0)
      return dateB.getTime() - dateA.getTime()
    })
  }
  return groups.sort((a, b) => a[0].localeCompare(b[0]))
})
</script>

<template>
  <div data-name="session-list" class="py-2">
    <!-- Loading state -->
    <div v-if="sessionsStore.loading" data-name="session-list-loading" class="px-4 py-8 text-center text-on-surface-variant">
      <span class="material-symbols-outlined animate-spin block mx-auto mb-2" style="font-size:24px">progress_activity</span>
      Loading sessions...
    </div>

    <!-- Error state -->
    <div v-else-if="sessionsStore.error" data-name="session-list-error" class="px-4 py-8 text-center text-error">
      <p>{{ sessionsStore.error }}</p>
      <button
        data-name="session-list-retry"
        @click="sessionsStore.loadSessions()"
        class="mt-2 text-body-sm text-primary hover:underline"
      >Retry</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="sessionsStore.filteredSessions.length === 0" data-name="session-list-empty" class="px-4 py-8 text-center text-on-surface-variant">
      <p>No sessions found</p>
    </div>

    <!-- Session groups -->
    <div v-else data-name="session-list-groups">
      <div
        v-for="[group, sessions] in sortedGroups"
        :key="group"
        :data-name="`session-group-${group}`"
        class="mt-3"
      >
        <div
          data-name="session-group-header"
          class="px-4 py-1 font-label-caps text-label-caps text-on-surface-variant sticky top-0 bg-surface-container z-10"
        >
          {{ group.toUpperCase() }}
          <span class="font-normal text-[10px] lowercase ml-1 opacity-70">({{ sessions.length }})</span>
        </div>
        <ul class="flex flex-col">
          <SessionListItem
            v-for="session in sessions"
            :key="`${session.source}-${session.id}`"
            :session="session"
          />
        </ul>
      </div>
    </div>
  </div>
</template>
