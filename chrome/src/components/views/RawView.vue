<script setup lang="ts">
import { ref } from 'vue'
import type { SessionDetail } from '@/types'

const props = defineProps<{ session: SessionDetail }>()
const copied = ref(false)

const json = JSON.stringify(props.session, null, 2)

async function copy() {
  await navigator.clipboard.writeText(json)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="flex flex-col gap-2 h-full">
    <div class="flex justify-end">
      <button
        class="flex items-center gap-1.5 px-3 py-1.5 bg-secondary border border-default rounded text-sm text-primary hover:bg-tertiary transition-colors"
        @click="copy"
      >
        <span class="material-symbols-outlined" style="font-size:14px">{{ copied ? 'check' : 'content_copy' }}</span>
        {{ copied ? 'Copied!' : 'Copy JSON' }}
      </button>
    </div>
    <div class="logfile-path-row flex items-stretch gap-2">
      <pre class="flex-1 px-3 py-2 bg-tertiary rounded text-sm text-primary font-mono break-all select-all overflow-x-auto max-h-screen overflow-y-auto whitespace-pre-wrap text-xs">{{ json }}</pre>
    </div>
  </div>
</template>
