<script setup lang="ts">
import { computed } from 'vue'
import { formatTokens } from '@/utils/formatters'

const props = defineProps<{
  tokens: number
  variant?: 'default' | 'compact' | 'large'
}>()

const sizeClasses = computed(() => {
  switch (props.variant) {
    case 'compact':
      return 'text-xs px-1.5 py-0.5'
    case 'large':
      return 'text-base px-3 py-1.5'
    default:
      return 'text-sm px-2 py-1'
  }
})

const colorClass = computed(() => {
  const tokens = props.tokens
  if (tokens > 100000) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
  if (tokens > 50000) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
  if (tokens > 10000) return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
  return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
})
</script>

<template>
  <span
    :class="[
      'inline-flex items-center font-medium rounded-md',
      sizeClasses,
      colorClass
    ]"
  >
    {{ formatTokens(tokens) }}
  </span>
</template>
