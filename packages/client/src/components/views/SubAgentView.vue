<script setup lang="ts">
import { computed } from 'vue'
import type { SubAgent } from '@/types'
import { formatDuration, formatTokens } from '@/utils/formatters'

const props = defineProps<{
  agent: SubAgent
  parentName?: string
}>()

const emit = defineEmits<{
  back: []
}>()

const renderedResult = computed(() => {
  if (!props.agent?.result) return ''
  return renderMarkdown(props.agent.result)
})

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
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="bg-primary border-b border-default px-4 py-3">
      <!-- Breadcrumb -->
      <button
        @click="emit('back')"
        class="flex items-center gap-1 text-sm text-accent hover:text-accent/80 mb-2 transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
        {{ parentName ?? 'Back to session' }}
      </button>

      <!-- Agent title -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-lg font-semibold text-primary">{{ agent.agentId }}</span>
        <span class="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
          {{ agent.agentDisplayName || agent.agentType }}
        </span>
        <span
          class="px-2 py-0.5 text-xs font-medium rounded-full"
          :class="agent.status === 'completed'
            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
            : agent.status === 'failed'
              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
              : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'"
        >
          {{ agent.status }}
        </span>
      </div>
      <p v-if="agent.description" class="text-sm text-muted mt-1">{{ agent.description }}</p>

      <!-- Stats -->
      <div class="flex items-center gap-6 mt-2 text-sm flex-wrap">
        <div v-if="agent.model" class="flex items-center gap-1">
          <span class="text-muted">Model:</span>
          <span class="font-medium">{{ agent.model }}</span>
        </div>
        <div v-if="agent.totalTokens" class="flex items-center gap-1">
          <span class="text-muted">Tokens:</span>
          <span class="font-medium">{{ formatTokens(agent.totalTokens) }}</span>
        </div>
        <div v-if="agent.totalToolCalls" class="flex items-center gap-1">
          <span class="text-muted">Tool calls:</span>
          <span class="font-medium">{{ agent.totalToolCalls }}</span>
        </div>
        <div v-if="agent.durationMs" class="flex items-center gap-1">
          <span class="text-muted">Duration:</span>
          <span class="font-medium">{{ durationFormatted(agent.durationMs) }}</span>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Prompt -->
      <div v-if="agent.prompt" class="bg-primary rounded-lg border border-default overflow-hidden">
        <details open>
          <summary class="px-4 py-3 text-sm font-semibold text-primary cursor-pointer select-none hover:bg-tertiary">
            Prompt
          </summary>
          <pre class="px-4 pb-4 text-xs text-secondary whitespace-pre-wrap font-sans leading-relaxed overflow-auto">{{ agent.prompt }}</pre>
        </details>
      </div>

      <!-- Result -->
      <div v-if="agent.result" class="bg-primary rounded-lg border border-default overflow-hidden">
        <div class="px-4 py-3 border-b border-default">
          <p class="text-sm font-semibold text-primary">Result</p>
        </div>
        <div class="p-4 markdown-content overflow-auto" v-html="renderedResult" />
      </div>

      <!-- No content -->
      <div v-if="!agent.prompt && !agent.result" class="text-sm text-muted italic p-4">
        No content available for this subagent.
      </div>
    </div>
  </div>
</template>
