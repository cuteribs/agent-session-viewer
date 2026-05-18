<script setup lang="ts">
import { computed } from 'vue'
import type { SubAgent } from '@/types'
import { formatDuration, formatTokens } from '@/utils/formatters'

const props = defineProps<{
  modelValue: boolean
  agent: SubAgent | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const renderedResult = computed(() => {
  if (!props.agent?.result) return ''
  return renderMarkdown(props.agent.result)
})

function close() {
  emit('update:modelValue', false)
}

function durationFormatted(ms?: number) {
  if (!ms) return ''
  return formatDuration(ms)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function renderMarkdown(content: string): string {
  const escaped = escapeHtml(content).replace(/\r\n/g, '\n')
  const codeBlocks: string[] = []
  const withPlaceholders = escaped.replace(/```([\w-]+)?\n([\s\S]*?)```/g, (_match, _language, code) => {
    const codeHtml = `<pre><code>${code.trimEnd()}</code></pre>`
    const index = codeBlocks.push(codeHtml) - 1
    return `@@CODEBLOCK_${index}@@`
  })

  const htmlParts: string[] = []
  const lines = withPlaceholders.split('\n')
  const paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    htmlParts.push(`<p>${formatInline(paragraph.join('<br />'))}</p>`)
    paragraph.length = 0
  }

  const closeList = () => {
    if (!listType) return
    htmlParts.push(`</${listType}>`)
    listType = null
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      closeList()
      continue
    }

    const codeBlockMatch = trimmed.match(/^@@CODEBLOCK_(\d+)@@$/)
    if (codeBlockMatch) {
      flushParagraph()
      closeList()
      htmlParts.push(codeBlocks[Number(codeBlockMatch[1])] ?? '')
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      closeList()
      const level = headingMatch[1].length
      htmlParts.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`)
      continue
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      closeList()
      htmlParts.push(`<blockquote>${formatInline(quoteMatch[1])}</blockquote>`)
      continue
    }

    const unorderedListMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (unorderedListMatch) {
      flushParagraph()
      if (listType !== 'ul') {
        closeList()
        htmlParts.push('<ul>')
        listType = 'ul'
      }
      htmlParts.push(`<li>${formatInline(unorderedListMatch[1])}</li>`)
      continue
    }

    const orderedListMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (orderedListMatch) {
      flushParagraph()
      if (listType !== 'ol') {
        closeList()
        htmlParts.push('<ol>')
        listType = 'ol'
      }
      htmlParts.push(`<li>${formatInline(orderedListMatch[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(trimmed)
  }

  flushParagraph()
  closeList()

  return htmlParts.join('\n')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="modelValue && agent"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        @click.self="close"
      >
        <div class="bg-primary rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-default">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-semibold text-primary">{{ agent.agentId }}</span>
                <span class="text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">{{ agent.agentType }}</span>
                <span
                  class="text-xs px-2 py-0.5 rounded"
                  :class="agent.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : agent.status === 'failed' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'"
                >
                  {{ agent.status }}
                </span>
              </div>
              <p v-if="agent.agentDisplayName && agent.agentDisplayName !== agent.agentId" class="text-xs text-muted mt-1">
                {{ agent.agentDisplayName }}
              </p>
            </div>
            <button @click="close" class="p-1 rounded hover:bg-tertiary">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-4 px-4 py-2 bg-tertiary/50 border-b border-default text-xs text-muted">
            <span v-if="agent.model">Model: <span class="text-primary font-medium">{{ agent.model }}</span></span>
            <span v-if="agent.totalTokens">Tokens: <span class="text-primary font-medium">{{ formatTokens(agent.totalTokens) }}</span></span>
            <span v-if="agent.totalToolCalls">Tool calls: <span class="text-primary font-medium">{{ agent.totalToolCalls }}</span></span>
            <span v-if="agent.durationMs">Duration: <span class="text-primary font-medium">{{ durationFormatted(agent.durationMs) }}</span></span>
          </div>

          <div class="flex-1 overflow-y-auto p-4 space-y-4">
            <div v-if="agent.description">
              <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Description</p>
              <p class="text-sm text-secondary">{{ agent.description }}</p>
            </div>

            <details v-if="agent.prompt" open>
              <summary class="text-xs font-semibold text-muted uppercase tracking-wider cursor-pointer">Prompt</summary>
              <pre class="text-xs text-secondary bg-tertiary rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap font-sans mt-2">{{ agent.prompt }}</pre>
            </details>

            <div v-if="agent.result">
              <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-1">Result</p>
              <div class="markdown-content text-sm text-secondary bg-tertiary rounded-lg p-3 overflow-auto max-h-64" v-html="renderedResult" />
            </div>

            <div v-if="!agent.prompt && !agent.result && !agent.description" class="text-sm text-muted italic">
              No content available
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
