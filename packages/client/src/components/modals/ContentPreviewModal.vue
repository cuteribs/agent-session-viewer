<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatDateTime, formatNumber } from '@/utils/formatters'
import TokenBadge from '@/components/common/TokenBadge.vue'

const sessionsStore = useSessionsStore()

const message = computed(() => sessionsStore.previewMessage)
const isOpen = computed(() => message.value !== null)

const currentIndex = computed(() => {
  if (!message.value || !sessionsStore.currentSession) return 0
  return sessionsStore.currentSession.messages.findIndex(m => m.id === message.value?.id)
})

const totalMessages = computed(() => {
  return sessionsStore.currentSession?.messages.length || 0
})

function close() {
  sessionsStore.closePreview()
}

function navigatePrev() {
  if (!sessionsStore.currentSession || currentIndex.value <= 0) return
  const prevMessage = sessionsStore.currentSession.messages[currentIndex.value - 1]
  sessionsStore.openPreview(prevMessage)
}

function navigateNext() {
  if (!sessionsStore.currentSession || currentIndex.value >= totalMessages.value - 1) return
  const nextMessage = sessionsStore.currentSession.messages[currentIndex.value + 1]
  sessionsStore.openPreview(nextMessage)
}

function copyContent() {
  if (message.value) {
    navigator.clipboard.writeText(message.value.content)
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return

  switch (e.key) {
    case 'Escape':
      close()
      break
    case 'ArrowLeft':
      navigatePrev()
      break
    case 'ArrowRight':
      navigateNext()
      break
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
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
        <div class="bg-primary rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-default">
            <div class="flex items-center gap-4">
              <button
                @click="navigatePrev"
                :disabled="currentIndex <= 0"
                class="p-1 rounded hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <span class="text-sm text-secondary">
                Message {{ currentIndex + 1 }} of {{ totalMessages }}
              </span>
              <button
                @click="navigateNext"
                :disabled="currentIndex >= totalMessages - 1"
                class="p-1 rounded hover:bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
            <button
              @click="close"
              class="p-1 rounded hover:bg-tertiary"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Token stats -->
          <div v-if="message?.tokens" class="px-4 py-3 bg-tertiary/50 border-b border-default">
            <div class="flex items-center gap-2 mb-2 text-sm font-medium text-primary">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Tokens
            </div>
            <div class="grid grid-cols-4 gap-4">
              <div class="bg-primary rounded-lg p-3 text-center">
                <p class="text-xs text-muted">Input</p>
                <p class="text-lg font-bold text-primary">{{ formatNumber(message.tokens.input) }}</p>
              </div>
              <div class="bg-primary rounded-lg p-3 text-center">
                <p class="text-xs text-muted">Output</p>
                <p class="text-lg font-bold text-primary">{{ formatNumber(message.tokens.output) }}</p>
              </div>
              <div class="bg-primary rounded-lg p-3 text-center">
                <p class="text-xs text-muted">Cache Read</p>
                <p class="text-lg font-bold text-primary">{{ formatNumber(message.tokens.cacheRead || 0) }}</p>
              </div>
              <div class="bg-primary rounded-lg p-3 text-center">
                <p class="text-xs text-muted">Total</p>
                <p class="text-lg font-bold text-primary">
                  {{ formatNumber(message.tokens.input + message.tokens.output) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Message metadata -->
          <div class="flex items-center justify-between px-4 py-2 border-b border-default text-sm">
            <div class="flex items-center gap-4">
              <span
                :class="[
                  'px-2 py-0.5 text-xs font-medium rounded text-white capitalize',
                  message?.role === 'user' ? 'bg-blue-500' :
                  message?.role === 'assistant' ? 'bg-green-500' :
                  message?.role === 'tool' ? 'bg-yellow-500' : 'bg-gray-500'
                ]"
              >
                {{ message?.role }}
              </span>
              <span v-if="message?.model" class="text-muted">{{ message.model }}</span>
            </div>
            <span class="text-muted">{{ message ? formatDateTime(message.timestamp) : '' }}</span>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-4">
            <div class="message-content whitespace-pre-wrap break-words text-primary">
              {{ message?.content || '(no content)' }}
            </div>

            <!-- Tool calls -->
            <div v-if="message?.toolCalls && message.toolCalls.length > 0" class="mt-6">
              <h4 class="text-sm font-semibold text-primary mb-3">Tool Calls</h4>
              <div class="space-y-3">
                <div
                  v-for="tool in message.toolCalls"
                  :key="tool.id"
                  class="bg-tertiary rounded-lg overflow-hidden"
                >
                  <div class="flex items-center gap-2 px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30">
                    <svg class="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span class="font-medium text-yellow-800 dark:text-yellow-200">{{ tool.name }}</span>
                  </div>
                  <pre class="p-3 text-xs overflow-x-auto"><code>{{ JSON.stringify(tool.arguments, null, 2) }}</code></pre>
                </div>
              </div>
            </div>

            <!-- Tool result -->
            <div v-if="message?.toolResult" class="mt-6">
              <h4 class="text-sm font-semibold text-primary mb-3">Tool Result</h4>
              <div
                :class="[
                  'rounded-lg overflow-hidden',
                  message.toolResult.success
                    ? 'bg-green-50 dark:bg-green-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'
                ]"
              >
                <div
                  :class="[
                    'flex items-center gap-2 px-3 py-2',
                    message.toolResult.success
                      ? 'bg-green-100 dark:bg-green-900/30'
                      : 'bg-red-100 dark:bg-red-900/30'
                  ]"
                >
                  <svg
                    v-if="message.toolResult.success"
                    class="w-4 h-4 text-green-600 dark:text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <svg
                    v-else
                    class="w-4 h-4 text-red-600 dark:text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span :class="message.toolResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'">
                    {{ message.toolResult.success ? 'Success' : 'Failed' }}
                  </span>
                </div>
                <pre class="p-3 text-xs overflow-x-auto max-h-64"><code>{{ message.toolResult.content }}</code></pre>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-default">
            <button
              @click="copyContent"
              class="flex items-center gap-1 px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </button>
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
