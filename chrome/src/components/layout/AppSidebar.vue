<script setup lang="ts">
import { useSessionsStore } from '@/stores/sessions'
import { useConfigStore } from '@/stores/config'
import SessionItem from '@/components/sessions/SessionItem.vue'

const sessions = useSessionsStore()
const config = useConfigStore()
</script>

<template>
  <aside class="bg-primary border-r border-default hidden md:flex flex-col h-full w-64 shrink-0 relative">
    <!-- Search + sort -->
    <div class="px-4 py-3 border-b border-default flex flex-col gap-2 shrink-0">
      <div class="relative">
        <span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" style="font-size:16px">search</span>
        <input
          v-model="sessions.searchQuery"
          type="text"
          placeholder="Search sessions…"
          class="w-full bg-secondary border border-default rounded-lg text-sm text-primary placeholder:text-muted pl-8 pr-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
        />
      </div>
      <div class="flex items-center justify-between px-1">
        <span class="text-xs font-semibold text-muted uppercase tracking-wider">Sort by</span>
        <select
          v-model="config.sortBy"
          class="bg-transparent text-xs text-secondary border-none p-0 focus:ring-0 cursor-pointer"
        >
          <option value="date">Date</option>
          <option value="tokens">Tokens</option>
          <option value="cost">Cost</option>
        </select>
      </div>
    </div>

    <!-- Session list -->
    <div class="flex-1 overflow-y-auto">
      <!-- Loading skeletons -->
      <template v-if="sessions.loading && sessions.filteredSessions.length === 0">
        <div v-for="i in 5" :key="i" class="mx-3 my-1 p-3 rounded-lg bg-secondary animate-pulse">
          <div class="h-3 bg-tertiary rounded w-2/3 mb-2" />
          <div class="h-2.5 bg-tertiary rounded w-1/2 mb-1.5" />
          <div class="h-2 bg-tertiary rounded w-full" />
        </div>
      </template>

      <!-- Empty state -->
      <div v-else-if="sessions.filteredSessions.length === 0 && !sessions.loading" class="px-4 py-8 text-center text-muted">
        <span class="material-symbols-outlined" style="font-size:36px; display:block; margin-bottom:8px">inbox</span>
        <p class="text-sm">No sessions found.<br>Configure directories in Settings.</p>
      </div>

      <!-- Date group headers + items -->
      <ul v-else class="py-2">
        <SessionItem
          v-for="session in sessions.filteredSessions"
          :key="session.id"
          :session="session"
          :active="session.id === sessions.currentSessionId"
          @click="sessions.selectSession(session.id)"
        />
      </ul>
    </div>

    <!-- Footer -->
    <div class="px-4 py-2 border-t border-default shrink-0 flex justify-between items-center text-xs text-muted">
      <span>{{ sessions.filteredSessions.length }} session{{ sessions.filteredSessions.length !== 1 ? 's' : '' }}</span>
      <button class="p-1 rounded hover:bg-tertiary" title="Refresh" @click="sessions.loadAll()">
        <span class="material-symbols-outlined" style="font-size:14px">refresh</span>
      </button>
    </div>
  </aside>
</template>
