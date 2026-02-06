<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatRelativeTime, formatTokens, truncateText } from '@/utils/formatters'
import type { SessionSummary } from '@/types'

const props = defineProps<{
  session: SessionSummary
}>()

const sessionsStore = useSessionsStore()
const showDeleteConfirm = ref(false)

const isActive = computed(() => {
  return (
    sessionsStore.currentSession?.id === props.session.id &&
    sessionsStore.currentSession?.source === props.session.source
  )
})

function handleClick() {
  sessionsStore.selectSession(props.session.source, props.session.id)
}

function handleDelete() {
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  await sessionsStore.removeSession(props.session.source, props.session.id)
  showDeleteConfirm.value = false
}

function cancelDelete() {
  showDeleteConfirm.value = false
}
</script>

<template>
  <div>
    <button
      @click="handleClick"
      :class="[
        'w-full text-left px-4 py-3 hover:bg-tertiary transition-colors border-l-2 relative group',
        isActive
          ? 'bg-tertiary border-accent'
          : 'border-transparent'
      ]"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span
              :class="[
                'w-2 h-2 rounded-full flex-shrink-0',
                session.source === 'claude' ? 'bg-orange-500' : 'bg-purple-500'
              ]"
            />
            <span class="font-medium text-primary truncate">
              {{ truncateText(session.project, 30) }}
            </span>
          </div>
          <p class="text-xs text-muted mt-1 truncate">
            {{ session.id.substring(0, 8) }}...
          </p>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-xs text-muted">
            {{ formatRelativeTime(session.lastActivity) }}
          </p>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-xs text-secondary">{{ session.messageCount }} msgs</span>
            <span
              v-if="session.totalTokens"
              class="text-xs px-1.5 py-0.5 bg-tertiary rounded"
            >
              {{ formatTokens(session.totalTokens) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Delete button (hidden until hover) -->
      <button
        @click.stop="handleDelete"
        class="absolute top-2 right-2 p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
        title="Delete session"
      >
        <svg class="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </button>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showDeleteConfirm"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="cancelDelete"
        >
          <div class="bg-primary rounded-lg shadow-xl w-full max-w-sm">
            <div class="p-4 border-b border-default">
              <h3 class="text-lg font-semibold text-primary">Delete Session?</h3>
            </div>

            <div class="p-4 space-y-2">
              <p class="text-sm text-secondary">
                Are you sure you want to permanently delete this session?
              </p>
              <div class="bg-tertiary rounded-lg p-3 text-sm">
                <p class="font-medium text-primary">{{ session.project }}</p>
                <p class="text-xs text-muted mt-1">{{ session.projectPath }}</p>
              </div>
              <p class="text-xs text-error font-medium">
                This action cannot be undone.
              </p>
            </div>

            <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-default">
              <button
                @click="cancelDelete"
                class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                @click="confirmDelete"
                class="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
