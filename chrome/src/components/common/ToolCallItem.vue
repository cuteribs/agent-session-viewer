<script setup lang="ts">
import type { ToolCall, ToolResult } from '@/types'
import { ref } from 'vue'

defineProps<{
  toolCall: ToolCall
  toolResult?: ToolResult
}>()

const expanded = ref(false)
</script>

<template>
  <div class="border border-default rounded-lg overflow-hidden text-sm">
    <!-- Header -->
    <button
      class="w-full flex items-center gap-2 px-3 py-2 bg-secondary hover:bg-tertiary transition-colors text-left"
      @click="expanded = !expanded"
    >
      <span
        class="w-2 h-2 rounded-full shrink-0"
        :class="toolResult
          ? (toolResult.success ? 'bg-green-500' : 'bg-red-500')
          : 'bg-gray-400'"
      />
      <span class="material-symbols-outlined text-muted shrink-0" style="font-size:14px">build</span>
      <span class="font-medium text-primary truncate flex-1 font-mono text-xs">{{ toolCall.name }}</span>
      <span class="material-symbols-outlined text-muted transition-transform" style="font-size:16px" :class="{ 'rotate-90': expanded }">chevron_right</span>
    </button>

    <!-- Expanded content -->
    <div v-if="expanded" class="border-t border-default divide-y divide-default">
      <div v-if="Object.keys(toolCall.arguments ?? {}).length > 0" class="p-3">
        <div class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">INPUT</div>
        <pre class="text-xs font-mono text-primary bg-tertiary rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">{{ JSON.stringify(toolCall.arguments, null, 2) }}</pre>
      </div>
      <div v-if="toolResult?.content" class="p-3">
        <div class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">OUTPUT</div>
        <pre class="text-xs font-mono text-primary bg-tertiary rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">{{ toolResult.content }}</pre>
      </div>
    </div>
  </div>
</template>
