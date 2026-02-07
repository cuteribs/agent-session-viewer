<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { useConfigStore } from '@/stores/config'
import { useTheme } from '@/composables/useTheme'

const sessionsStore = useSessionsStore()
const configStore = useConfigStore()
const { theme, setTheme } = useTheme()

const isOpen = computed(() => sessionsStore.showSettings)

function close() {
  sessionsStore.closeSettings()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  configStore.loadConfig()
  configStore.loadPaths()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        @click.self="close"
      >
        <div class="bg-primary rounded-lg shadow-xl w-full max-w-lg">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-default">
            <h2 class="text-lg font-semibold text-primary">Settings</h2>
            <button
              @click="close"
              class="p-1 rounded hover:bg-tertiary"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Content -->
          <div class="p-4 space-y-6">
            <!-- Theme -->
            <div>
              <h3 class="text-sm font-medium text-primary mb-3">Appearance</h3>
              <div class="flex gap-2">
                <button
                  v-for="t in ['light', 'dark', 'system'] as const"
                  :key="t"
                  @click="setTheme(t)"
                  :class="[
                    'flex-1 py-2 px-4 rounded border text-sm capitalize transition-colors',
                    theme === t
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-default hover:border-gray-400 text-secondary'
                  ]"
                >
                  {{ t }}
                </button>
              </div>
            </div>

            <!-- Session Paths -->
            <div>
              <h3 class="text-sm font-medium text-primary mb-3">Session Paths</h3>

              <div class="space-y-4">
                <div>
                  <label class="block text-xs text-muted mb-1">Claude Code Sessions</label>
                  <div v-if="configStore.paths" class="space-y-1">
                    <div
                      v-for="path in configStore.paths.claude"
                      :key="path"
                      class="flex items-center gap-2 px-3 py-2 bg-tertiary rounded text-sm"
                    >
                      <svg class="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <span class="flex-1 truncate text-primary">{{ path }}</span>
                    </div>
                  </div>
                  <div v-else class="px-3 py-2 bg-tertiary rounded text-sm text-muted">
                    Loading...
                  </div>
                </div>

                <div>
                  <label class="block text-xs text-muted mb-1">Copilot CLI Sessions</label>
                  <div v-if="configStore.paths" class="space-y-1">
                    <div
                      v-for="path in configStore.paths.copilot"
                      :key="path"
                      class="flex items-center gap-2 px-3 py-2 bg-tertiary rounded text-sm"
                    >
                      <svg class="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      <span class="flex-1 truncate text-primary">{{ path }}</span>
                    </div>
                  </div>
                  <div v-else class="px-3 py-2 bg-tertiary rounded text-sm text-muted">
                    Loading...
                  </div>
                </div>
              </div>

              <p class="mt-2 text-xs text-muted">
                Configure custom paths using environment variables in .env file.
              </p>
            </div>

            <!-- About -->
            <div>
              <h3 class="text-sm font-medium text-primary mb-3">About</h3>
              <div class="text-sm text-secondary space-y-1">
                <p>Agent Session Viewer v1.0.0</p>
                <p class="text-xs text-muted">
                  Analyze and visualize Claude Code and Copilot CLI sessions.
                </p>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end px-4 py-3 border-t border-default">
            <button
              @click="close"
              class="px-4 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
