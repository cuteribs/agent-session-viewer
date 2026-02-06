<script setup lang="ts">
import { useSessionsStore } from '@/stores/sessions'
import SearchBar from '@/components/common/SearchBar.vue'
import ThemeToggle from '@/components/common/ThemeToggle.vue'

const sessionsStore = useSessionsStore()
</script>

<template>
  <header class="h-16 bg-primary border-b border-default flex items-center px-4 gap-4">
    <!-- Logo -->
    <div class="flex items-center gap-2">
      <svg
        class="w-8 h-8 text-accent"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9h8" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 13h6" />
      </svg>
      <h1 class="text-lg font-semibold text-primary hidden sm:block">Agent Context Viewer</h1>
    </div>

    <!-- Search -->
    <div class="flex-1 max-w-xl">
      <SearchBar
        :model-value="sessionsStore.searchQuery"
        @update:model-value="sessionsStore.setSearchQuery"
        placeholder="Search sessions..."
      />
    </div>

    <!-- Right side actions -->
    <div class="flex items-center gap-2">
      <ThemeToggle />

      <!-- Settings button -->
      <button
        @click="sessionsStore.openSettings()"
        class="p-2 rounded-lg hover:bg-tertiary transition-colors"
        title="Settings"
      >
        <svg class="w-5 h-5 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        </svg>
      </button>
    </div>
  </header>
</template>
