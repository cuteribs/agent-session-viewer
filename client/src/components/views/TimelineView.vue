<script setup lang="ts">
import { useSessionsStore } from '@/stores/sessions'
import { formatTime, truncateText, getRoleColor, formatTokens } from '@/utils/formatters'
import type { SessionDetail, Message } from '@/types'
import { watch, nextTick, computed } from 'vue'

const props = defineProps<{
  session: SessionDetail
}>()

const sessionsStore = useSessionsStore()

// Reverse messages for display (newest first)
const reversedMessages = computed(() => {
  return [...props.session.messages].reverse()
})

// Scroll to selected message when selectedMessageIndex changes
watch(() => sessionsStore.selectedMessageIndex, async (newIndex) => {
  if (newIndex !== null && newIndex >= 0 && newIndex < props.session.messages.length) {
    await nextTick()
    const element = document.querySelector(`[data-message-index="${newIndex}"]`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      console.log(`Scrolled to message ${newIndex}`)
    }
  }
})

function openPreview(message: Message) {
  sessionsStore.openPreview(message)
}
</script>

<template>
  <div class="space-y-4">
    <div
      v-for="(message, index) in reversedMessages"
      :key="message.id"
      :data-message-index="index"
      :class="[
        'bg-primary rounded-lg shadow-sm border transition-all',
        sessionsStore.selectedMessageIndex === index
          ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
          : 'border-default'
      ]"
      @click="openPreview(message)"
      style="cursor: pointer;"
    >
      <!-- Message header -->
      <div class="flex items-center justify-between px-4 py-2 bg-tertiary/50">
        <div class="flex items-center gap-3">
          <span class="text-xs text-muted">#{{ props.session.messages.length - index }}</span>
          <span
            :class="[
              'px-2 py-0.5 text-xs font-medium rounded text-white capitalize',
              getRoleColor(message.role)
            ]"
          >
            {{ message.role }}
          </span>
          <span v-if="message.model" class="text-xs text-muted">
            {{ message.model }}
          </span>
        </div>
        <div class="flex items-center gap-3">
          <span
            v-if="message.tokens"
            class="text-xs px-2 py-0.5 bg-secondary rounded"
            :title="`Input: ${message.tokens.input}, Output: ${message.tokens.output}`"
          >
            {{ formatTokens(message.tokens.input + message.tokens.output) }} tokens
          </span>
          <span class="text-xs text-muted">
            {{ formatTime(message.timestamp) }}
          </span>
        </div>
      </div>

      <!-- Message content -->
      <div class="px-4 py-3">
        <p class="text-sm text-primary whitespace-pre-wrap break-words">
          {{ truncateText(message.content, 500) || '(no text content)' }}
        </p>

        <!-- Tool calls indicator -->
        <div v-if="message.toolCalls && message.toolCalls.length > 0" class="mt-3">
          <div class="flex flex-wrap gap-2">
            <span
              v-for="tool in message.toolCalls"
              :key="tool.id"
              class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {{ tool.name }}
            </span>
          </div>
        </div>

        <!-- Tool result indicator -->
        <div v-if="message.toolResult" class="mt-3">
          <span
            :class="[
              'inline-flex items-center gap-1 px-2 py-1 text-xs rounded',
              message.toolResult.success
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            ]"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                v-if="message.toolResult.success"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
              <path
                v-else
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Tool {{ message.toolResult.success ? 'Success' : 'Failed' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
