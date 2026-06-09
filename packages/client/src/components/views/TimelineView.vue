<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatTime, truncateText, getRoleColor, formatTokens, formatCost } from '@/utils/formatters'
import type { SessionDetail, Message, ToolCall } from '@/types'

const props = defineProps<{
  session?: SessionDetail
  /** Override the message list (used when showing subagent message logs). */
  messages?: Message[]
  /** Override loading state (e.g. when showing subagent message logs). */
  loading?: boolean
  /** Whether to show tool-role messages (controlled externally via tab-nav). */
  showToolMessages?: boolean
}>()

interface TimelineNode {
  message: Message
  children: TimelineNode[]
  depth: number
  order: number
}

const sessionsStore = useSessionsStore()

const localLoading = ref(false)
const isLoading = computed(() => props.loading ?? (sessionsStore.detailLoading || localLoading.value))

const displayMessages = computed(() => props.messages ?? props.session?.messages ?? [])

function buildMessageTree(messages: Message[]): TimelineNode[] {
  const nodeMap = new Map<string, TimelineNode>()
  const roots: TimelineNode[] = []

  for (const [index, message] of messages.entries()) {
    nodeMap.set(message.id, { message, children: [], depth: 0, order: index })
  }

  for (const [index, message] of messages.entries()) {
    const node = nodeMap.get(message.id)
    if (!node) continue

    if (message.role === 'system') {
      node.depth = 0
      node.order = index
      roots.push(node)
      continue
    }

    if (message.parentId && nodeMap.has(message.parentId)) {
      const parent = nodeMap.get(message.parentId)
      // Guard against self-references and cycles (A→B→A)
      if (parent && message.parentId !== message.id) {
        node.depth = parent.depth + 1
        parent.children.push(node)
        continue
      }
    }

    node.depth = 0
    node.order = index
    roots.push(node)
  }

  return roots.sort((a, b) => a.order - b.order)
}

function flattenTree(nodes: TimelineNode[]): TimelineNode[] {
  const result: TimelineNode[] = []
  const visited = new Set<string>()

  function visit(node: TimelineNode) {
    if (visited.has(node.message.id)) return
    visited.add(node.message.id)
    result.push(node)
    node.children
      .sort((a, b) => a.order - b.order)
      .forEach(visit)
  }

  nodes.forEach(visit)
  return result
}

function buildFlattenedNodes(messages: Message[]): TimelineNode[] {
  return flattenTree(buildMessageTree(messages)).filter(node => {
    const msg = node.message
    if (msg.role === 'assistant' && !msg.content && !msg.error) {
      return false
    }
    return true
  })
}

// Deferred: show skeleton first, then compute the tree off the render-critical path
const flattenedNodes = ref<TimelineNode[]>([])
let pendingTimer: ReturnType<typeof setTimeout> | null = null

// Toggle to show/hide tool messages (driven by parent prop, default true)
const showToolMessages = computed(() => props.showToolMessages ?? true)

/** Nodes after optional tool-message filtering — used by virtual scroll. */
const filteredNodes = computed(() => {
  if (showToolMessages.value) return flattenedNodes.value
  return flattenedNodes.value.filter(n => n.message.role !== 'tool')
})

watch(displayMessages, (messages) => {
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  if (messages.length === 0) {
    flattenedNodes.value = []
    return
  }
  localLoading.value = true
  pendingTimer = setTimeout(() => {
    flattenedNodes.value = buildFlattenedNodes(messages)
    localLoading.value = false
    pendingTimer = null
  }, 0)
}, { immediate: true })

// --- Virtual scrolling ---
const ITEM_HEIGHT = 80 // estimated average height per message card (px)
const BUFFER_COUNT = 10 // extra items to render above/below viewport

const scrollContainer = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const containerHeight = ref(800)

// Extra bottom space to prevent the virtual-scroll container from being
// shorter than its absolutely-positioned children (which would cause the
// scroll position to jump when rendering taller items near the end).
const totalHeight = computed(() => filteredNodes.value.length * ITEM_HEIGHT + containerHeight.value)

const visibleRange = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER_COUNT)
  const visibleCount = Math.ceil(containerHeight.value / ITEM_HEIGHT) + BUFFER_COUNT * 2
  const end = Math.min(filteredNodes.value.length, start + visibleCount)
  return { start, end }
})

const visibleNodes = computed(() =>
  filteredNodes.value.slice(visibleRange.value.start, visibleRange.value.end)
)

const offsetTop = computed(() => visibleRange.value.start * ITEM_HEIGHT)

function onScroll() {
  if (scrollContainer.value) {
    scrollTop.value = scrollContainer.value.scrollTop
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (scrollContainer.value) {
    containerHeight.value = scrollContainer.value.clientHeight
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(scrollContainer.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

// Scroll to selected message when selectedMessageIndex changes
watch(() => sessionsStore.selectedMessageIndex, async (newIndex) => {
  if (newIndex !== null && newIndex >= 0 && newIndex < displayMessages.value.length) {
    const selectedMessage = displayMessages.value[newIndex]
    // Find this message's position in flattenedNodes
    const nodeIndex = filteredNodes.value.findIndex(n => n.message.id === selectedMessage?.id)
    if (nodeIndex >= 0 && scrollContainer.value) {
      const targetScroll = nodeIndex * ITEM_HEIGHT - containerHeight.value / 2
      scrollContainer.value.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' })
    }
  }
})

function openPreview(message: Message) {
  sessionsStore.openPreview(message)
}

function hasChildren(node: TimelineNode): boolean {
  return node.children.length > 0
}

function getDisplayIndex(messageId: string): number {
  return displayMessages.value.findIndex(message => message.id === messageId)
}

/** Group tool calls by name, preserving call order within each group. */
function groupToolCalls(toolCalls: ToolCall[]): { name: string; calls: ToolCall[] }[] {
  const map = new Map<string, ToolCall[]>()
  for (const call of toolCalls) {
    if (!map.has(call.name)) map.set(call.name, [])
    map.get(call.name)!.push(call)
  }
  return Array.from(map.entries()).map(([name, calls]) => ({ name, calls }))
}

/** Return a compact one-line summary of tool arguments. */
function summarizeArgs(args: Record<string, unknown>, toolName?: string): string {
  if (typeof args !== 'object' || args === null) {
    const str = String(args)
    return str.length > 120 ? str.substring(0, 120) + '…' : str
  }
  const taskKeys = ['description', 'prompt']
  const priorityKeys = (toolName === 'task' || toolName === 'Agent')
    ? taskKeys
    : ['command', 'cmd', 'input', 'path', 'file_path', 'filepath', 'query', 'url', 'content']
  for (const key of priorityKeys) {
    if (key in args && args[key] !== undefined && args[key] !== null) {
      const val = String(args[key])
      return val.length > 120 ? val.substring(0, 120) + '…' : val
    }
  }
  const json = JSON.stringify(args)
  return json.length > 120 ? json.substring(0, 120) + '…' : json
}
</script>

<template>
  <div class="h-full flex flex-col">
  <div ref="scrollContainer" data-name="timeline-view" class="flex-1 overflow-y-auto" @scroll="onScroll">

    <!-- Skeleton loading state -->
    <template v-if="isLoading">
      <div class="space-y-3 p-1">
        <div v-for="i in 6" :key="i" class="flex items-start gap-3 animate-pulse">
          <div class="flex-1 bg-surface rounded-lg border border-outline-variant overflow-hidden">
            <div class="flex items-center justify-between px-4 py-2 bg-surface-container-low">
              <div class="flex items-center gap-3">
                <div class="h-3 w-5 rounded bg-surface-container"></div>
                <div class="h-5 w-16 rounded bg-surface-container"></div>
                <div :class="['h-3 rounded bg-surface-container', i % 3 === 0 ? 'w-24' : i % 2 === 0 ? 'w-32' : 'w-20']"></div>
              </div>
              <div class="h-3 w-12 rounded bg-surface-container"></div>
            </div>
            <div class="px-4 py-3">
              <div :class="['h-3 rounded bg-surface-container mb-2', i % 2 === 0 ? 'w-3/4' : 'w-5/6']"></div>
              <div :class="['h-3 rounded bg-surface-container', i % 3 === 0 ? 'w-1/2' : 'w-2/3']"></div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Virtual scrolled list -->
    <template v-else-if="filteredNodes.length > 0">
      <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
        <div :style="{ position: 'absolute', top: `${offsetTop}px`, left: 0, right: 0 }" class="space-y-3 p-1">
          <div v-for="node in visibleNodes" :key="node.message.id" :data-message-id="node.message.id"
            :data-message-index="getDisplayIndex(node.message.id)"
            :data-name="`message-${node.message.role}-${getDisplayIndex(node.message.id)}`" class="flex items-start gap-3"
            :style="{ marginLeft: `${node.depth * 22}px` }">
      <div :class="[
        'flex-1 bg-surface rounded-lg shadow-sm border transition-all cursor-pointer',
        sessionsStore.selectedMessageIndex === getDisplayIndex(node.message.id)
          ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
          : 'border-outline-variant'
      ]" @click="openPreview(node.message)">
        <div data-name="message-header"
          class="flex items-center justify-between px-4 py-2 bg-surface-container-low rounded-t-lg">
          <div class="flex items-center gap-3 min-w-0">
            <span data-name="message-number" class="text-xs text-on-surface-variant">#{{
              getDisplayIndex(node.message.id) + 1 }}</span>
            <span data-name="message-role" class="px-2 py-0.5 text-xs font-medium rounded text-white capitalize"
              :style="{ backgroundColor: getRoleColor(node.message.role, node.message.toolResult?.success) }">
              {{ node.message.role }}
            </span>
            <span v-if="node.message.role === 'tool' && node.message.toolCalls?.[0]?.name" data-name="message-tool-name"
              class="text-xs font-semibold text-on-surface truncate">
              {{ node.message.toolCalls[0].name }}
              <template
                v-if="node.message.toolCalls[0].name === 'task' && node.message.toolCalls[0].arguments?.agent_type"><span
                  class="font-normal opacity-60">({{ node.message.toolCalls[0].arguments.agent_type
                  }})</span></template>
              <template
                v-else-if="node.message.toolCalls[0].name === 'Agent' && node.message.toolCalls[0].arguments?.agentType"><span
                  class="font-normal opacity-60">({{ node.message.toolCalls[0].arguments.agentType }})</span></template>
            </span>
            <span v-if="node.message.model" data-name="message-model" class="text-xs text-on-surface-variant truncate">
              {{ node.message.model }}
            </span>
            <span v-if="hasChildren(node)" class="text-xs text-on-surface-variant">
              {{ node.children.length }} child{{ node.children.length === 1 ? '' : 'ren' }}
            </span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span v-if="node.message.tokens" data-name="message-token-badge"
              class="text-xs px-2 py-0.5 bg-surface-container rounded"
              :title="node.message.tokens.estimated
                ? `~Input: ${node.message.tokens.input.toLocaleString()} (est. conv context), Output: ${node.message.tokens.output.toLocaleString()} (exact), ~Cache: ${(node.message.tokens.cacheRead ?? 0).toLocaleString()} (est. sys overhead)`
                : `Input: ${node.message.tokens.input.toLocaleString()}, Output: ${node.message.tokens.output.toLocaleString()}`">
              <span v-if="node.message.tokens.estimated" class="text-amber-500">~</span>{{
                formatTokens(node.message.tokens.input + node.message.tokens.output) }} tokens
            </span>
            <span v-if="node.message.tokens?.cost != null && node.message.tokens.cost > 0"
              data-name="message-cost-badge"
              class="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded"
              :title="node.message.tokens.estimated ? 'Estimated cost (input/cache estimated)' : 'Cost based on exact token counts'">
              <span v-if="node.message.tokens.estimated" class="opacity-70">~</span>{{
                formatCost(node.message.tokens.cost) }}
            </span>
            <span data-name="message-time" class="text-xs text-on-surface-variant">
              {{ formatTime(node.message.timestamp) }}
            </span>
          </div>
        </div>

        <div data-name="message-body" class="px-4">
          <p v-if="node.message.content && node.message.role !== 'tool'" data-name="message-content-text"
            class="text-sm text-on-surface whitespace-pre-wrap break-words py-3 font-mono">
            {{ truncateText(node.message.content, 500) }}
          </p>
          <p v-else-if="node.message.role === 'tool' && node.message.toolCalls?.[0]?.arguments"
            data-name="message-content-text" class="text-sm text-on-surface-variant py-2 font-mono truncate"
            :title="summarizeArgs(node.message.toolCalls[0].arguments, node.message.toolCalls[0].name)">{{
              summarizeArgs(node.message.toolCalls[0].arguments, node.message.toolCalls[0].name) }}</p>
          <p v-else-if="!node.message.toolCalls?.length && !node.message.toolResult && !node.message.error" data-name="message-no-content"
            class="text-sm text-on-surface-variant italic py-3">
            (no content)
          </p>

          <div v-if="node.message.error" data-name="message-error"
            class="mb-3 flex items-center gap-1.5 px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400">
            <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span class="text-xs font-semibold">Error</span>
            <span class="text-xs font-mono truncate opacity-80">{{ truncateText(node.message.error, 100) }}</span>
          </div>

          <div v-if="node.message.toolResult" data-name="message-tool-result" :class="[
            'mb-3 rounded border overflow-hidden',
            node.message.toolResult.success
              ? 'border-green-200 dark:border-green-800'
              : 'border-red-200 dark:border-red-800'
          ]">
            <div :class="[
              'flex items-center gap-1 px-2 py-1',
              node.message.toolResult.success
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            ]">
              <svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path v-if="node.message.toolResult.success" stroke-linecap="round" stroke-linejoin="round"
                  stroke-width="2" d="M5 13l4 4L19 7" />
                <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span class="text-xs font-semibold">{{ node.message.toolResult.success ? 'Success' : 'Error' }}</span>
            </div>
            <p v-if="node.message.toolResult.content"
              class="px-2 py-1 text-xs font-mono text-on-surface-variant truncate">
              {{ truncateText(node.message.toolResult.content, 100) }}
            </p>
          </div>
        </div>
      </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="!isLoading && filteredNodes.length === 0" data-name="timeline-empty" class="text-center text-on-surface-variant py-8">
      {{ flattenedNodes.length === 0 ? 'No messages in this session' : 'All tool messages are hidden' }}
    </div>
  </div>
  </div>
</template>
