<script setup lang="ts">
import type { SessionDetail } from '@/types'
import { formatTokens, formatCost } from '@/utils/formatters'
import ToolCallItem from '@/components/common/ToolCallItem.vue'

defineProps<{ session: SessionDetail }>()

const roleBg: Record<string, string> = {
  user: 'bg-blue-50 dark:bg-blue-900/20',
  assistant: 'bg-green-50 dark:bg-green-900/20',
  system: 'bg-tertiary',
  tool: 'bg-secondary',
}
const roleText: Record<string, string> = {
  user: 'text-blue-700 dark:text-blue-400',
  assistant: 'text-green-700 dark:text-green-400',
  system: 'text-muted',
  tool: 'text-muted',
}
</script>

<template>
  <div class="flex flex-col gap-3 py-2">
    <div
      v-for="msg in session.messages"
      :key="msg.id"
      class="flex items-start gap-3"
    >
      <!-- Role badge -->
      <div
        class="shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-semibold uppercase w-20 text-center"
        :class="[roleBg[msg.role] ?? 'bg-tertiary', roleText[msg.role] ?? 'text-muted']"
      >
        {{ msg.role }}
      </div>

      <div class="flex-1 min-w-0">
        <!-- Meta row -->
        <div class="flex items-center gap-2 flex-wrap mb-1">
          <span v-if="msg.model" class="text-xs text-accent font-mono">{{ msg.model }}</span>
          <span class="text-xs text-muted ml-auto">{{ new Date(msg.timestamp).toLocaleTimeString() }}</span>
          <!-- Token chips -->
          <template v-if="msg.tokens">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-secondary rounded">
              {{ msg.tokens.estimated ? '~' : '' }}{{ formatTokens(msg.tokens.input) }} in
            </span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-secondary rounded">
              {{ formatTokens(msg.tokens.output) }} out
            </span>
            <span v-if="msg.tokens.cost && msg.tokens.cost > 0" class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-50 dark:bg-blue-900/20 text-accent rounded">
              {{ formatCost(msg.tokens.cost) }}
            </span>
          </template>
        </div>

        <!-- Subagent summary card -->
        <div v-if="msg.subAgentRef" class="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
          <span class="material-symbols-outlined shrink-0" style="font-size:14px">smart_toy</span>
          <span>{{ msg.content }}</span>
        </div>

        <!-- Content -->
        <div v-else-if="msg.content" class="text-sm text-primary whitespace-pre-wrap break-words">{{ msg.content }}</div>

        <!-- Tool calls -->
        <div v-if="msg.toolCalls?.length" class="flex flex-col gap-2 mt-2">
          <ToolCallItem
            v-for="tc in msg.toolCalls"
            :key="tc.id"
            :tool-call="tc"
            :tool-result="msg.toolResult"
          />
        </div>
      </div>
    </div>
  </div>
</template>
