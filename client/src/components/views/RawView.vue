<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SessionDetail } from '@/types'

const props = defineProps<{
  session: SessionDetail
}>()

const showStats = ref(true)
const showMessages = ref(true)
const showToolUsage = ref(true)

const rawData = computed(() => {
  return JSON.stringify(props.session, null, 2)
})

function copyToClipboard() {
  navigator.clipboard.writeText(rawData.value)
}

function downloadJSON() {
  const blob = new Blob([rawData.value], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.session.source}-${props.session.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div>
    <!-- Controls -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" v-model="showStats" class="rounded" />
          Show Stats
        </label>
        <label class="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" v-model="showMessages" class="rounded" />
          Show Messages
        </label>
        <label class="flex items-center gap-2 text-sm text-secondary">
          <input type="checkbox" v-model="showToolUsage" class="rounded" />
          Show Tool Usage
        </label>
      </div>
      <div class="flex gap-2">
        <button
          @click="copyToClipboard"
          class="flex items-center gap-1 px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy
        </button>
        <button
          @click="downloadJSON"
          class="flex items-center gap-1 px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </button>
      </div>
    </div>

    <!-- JSON Display -->
    <div class="bg-primary rounded-lg border border-default overflow-hidden">
      <pre class="p-4 overflow-x-auto text-sm text-primary font-mono max-h-[calc(100vh-300px)]"><code>{{ rawData }}</code></pre>
    </div>
  </div>
</template>
