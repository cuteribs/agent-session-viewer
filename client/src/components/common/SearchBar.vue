<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputValue = ref(props.modelValue)

watch(() => props.modelValue, (val) => {
  inputValue.value = val
})

function handleInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  inputValue.value = value
  emit('update:modelValue', value)
}

function clear() {
  inputValue.value = ''
  emit('update:modelValue', '')
}
</script>

<template>
  <div class="relative">
    <svg
      class="text-on-surface-variant"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
    <input
      type="text"
      :value="inputValue"
      @input="handleInput"
      :placeholder="placeholder"
    class="w-full pl-10 pr-8 py-2 bg-surface-container border border-outline-variant rounded-lg text-body-sm font-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
    />
    <button
      v-if="inputValue"
      @click="clear"
    class="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-container-high rounded"
    >
      <svg class="w-4 h-4 text-on-surface-variant" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
