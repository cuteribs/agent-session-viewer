<script setup lang="ts">
defineProps<{ icon: string; label: string; value: string; sub?: string }>()
</script>

<template>
  <div class="bg-primary rounded-lg border border-default p-3 flex flex-col gap-1">
    <div class="flex items-center gap-1.5 text-muted">
      <span class="material-symbols-outlined" style="font-size:14px">{{ icon }}</span>
      <span class="text-xs font-semibold uppercase tracking-wider">{{ label }}</span>
    </div>
    <div class="text-lg font-bold text-primary">{{ value }}</div>
    <div v-if="sub" class="text-xs text-muted">{{ sub }}</div>
  </div>
</template>
