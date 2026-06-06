<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatTime, truncateText, getRoleColor, formatTokens, formatCost } from '@/utils/formatters'
import type { SessionDetail, Message, ToolCall } from '@/types'

const props = defineProps<{
  session?: SessionDetail
  /** Override the message list (used when showing subagent message logs). */
  messages?: Message[]
}>()

interface TimelineNode {
  message: Message
  children: TimelineNode[]
  depth: number
  order: number
}

const sessionsStore = useSessionsStore()

const displayMessages = computed(() => props.messages ?? props.session?.messages ?? [])

const messageTree = computed(() => {
  const messages = displayMessages.value
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
      if (parent) {
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
})

function flattenTree(nodes: TimelineNode[]): TimelineNode[] {
  const result: TimelineNode[] = []

  function visit(node: TimelineNode) {
    result.push(node)
    node.children
      .sort((a, b) => a.order - b.order)
      .forEach(visit)
  }

  nodes.forEach(visit)
  return result
}

const flattenedNodes = computed(() => flattenTree(messageTree.value))

// Scroll to selected message when selectedMessageIndex changes
watch(() => sessionsStore.selectedMessageIndex, async (newIndex) => {
  if (newIndex !== null && newIndex >= 0 && newIndex < displayMessages.value.length) {
    const selectedMessage = displayMessages.value[newIndex]
    await nextTick()
    const element = document.querySelector(`[data-message-id="${selectedMessage?.id}"]`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
function summarizeArgs(args: Record<string, unknown>): string {
  if (typeof args !== 'object' || args === null) {
    const str = String(args)
    return str.length > 120 ? str.substring(0, 120) + '…' : str
  }
  const priorityKeys = ['command', 'cmd', 'input', 'path', 'file_path', 'filepath', 'query', 'url', 'content']
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
  <div data-name="timeline-view" class="space-y-3">
    <div
      v-for="node in flattenedNodes"
      :key="node.message.id"
      :data-message-id="node.message.id"
      :data-message-index="getDisplayIndex(node.message.id)"
      :data-name="`message-${node.message.role}-${getDisplayIndex(node.message.id)}`"
      class="flex items-start gap-3"
      :style="{ marginLeft: `${node.depth * 22}px` }"
    >
      <div
        :class="[
          'flex-1 bg-primary rounded-lg shadow-sm border transition-all cursor-pointer',
          sessionsStore.selectedMessageIndex === getDisplayIndex(node.message.id)
            ? 'border-accent bg-accent/5 ring-2 ring-accent/30'
            : 'border-default'
        ]"
        @click="openPreview(node.message)"
      >
        <div data-name="message-header" class="flex items-center justify-between px-4 py-2 bg-tertiary/50">
          <div class="flex items-center gap-3 min-w-0">
            <span data-name="message-number" class="text-xs text-muted">#{{ getDisplayIndex(node.message.id) + 1 }}</span>
            <span
              data-name="message-role"
              :class="[
                'px-2 py-0.5 text-xs font-medium rounded text-white capitalize',
                getRoleColor(node.message.role)
              ]"
            >
              {{ node.message.role }}
            </span>
            <span v-if="node.message.model" data-name="message-model" class="text-xs text-muted truncate">
              {{ node.message.model }}
            </span>
            <span v-if="hasChildren(node)" class="text-xs text-muted">
              {{ node.children.length }} child{{ node.children.length === 1 ? '' : 'ren' }}
            </span>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span
              v-if="node.message.tokens"
              data-name="message-token-badge"
              class="text-xs px-2 py-0.5 bg-secondary rounded"
              :title="node.message.tokens.estimated
                ? `~Input: ${node.message.tokens.input.toLocaleString()} (est. conv context), Output: ${node.message.tokens.output.toLocaleString()} (exact), ~Cache: ${(node.message.tokens.cacheRead ?? 0).toLocaleString()} (est. sys overhead)`
                : `Input: ${node.message.tokens.input.toLocaleString()}, Output: ${node.message.tokens.output.toLocaleString()}`"
            >
              <span v-if="node.message.tokens.estimated" class="text-amber-500">~</span>{{ formatTokens(node.message.tokens.input + node.message.tokens.output) }} tokens
            </span>
            <span
              v-if="node.message.tokens?.cost != null && node.message.tokens.cost > 0"
              data-name="message-cost-badge"
              class="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded"
              :title="node.message.tokens.estimated ? 'Estimated cost (input/cache estimated)' : 'Cost based on exact token counts'"
            >
              <span v-if="node.message.tokens.estimated" class="opacity-70">~</span>{{ formatCost(node.message.tokens.cost) }}
            </span>
            <span data-name="message-time" class="text-xs text-muted">
              {{ formatTime(node.message.timestamp) }}
            </span>
          </div>
        </div>

        <div data-name="message-body" class="px-4">
          <p v-if="node.message.content" data-name="message-content-text" class="text-sm text-primary whitespace-pre-wrap break-words py-3 font-mono">
            {{ truncateText(node.message.content, 500) }}
          </p>
          <p v-else-if="!node.message.toolCalls?.length && !node.message.toolResult" data-name="message-no-content" class="text-sm text-muted italic py-3">
            (no content)
          </p>

          <div v-if="node.message.toolCalls && node.message.toolCalls.length > 0" data-name="message-tool-calls" class="pb-3 space-y-2">
            <div
              v-for="group in groupToolCalls(node.message.toolCalls)"
              :key="group.name"
              :data-name="`tool-group-${group.name}`"
              class="rounded border border-yellow-200 dark:border-yellow-800 overflow-hidden"
            >
              <div data-name="tool-group-header" class="flex items-center gap-1.5 px-2 py-1 bg-yellow-50 dark:bg-yellow-900/20">
                <svg class="w-3 h-3 text-yellow-600 dark:text-yellow-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0a3 3 0 016 0z" />
                </svg>
                <span class="text-xs font-semibold text-yellow-800 dark:text-yellow-300">{{ group.name }}</span>
                <span v-if="group.calls.length > 1" class="text-xs text-yellow-600 dark:text-yellow-500 ml-auto">×{{ group.calls.length }}</span>
              </div>
              <div class="divide-y divide-yellow-100 dark:divide-yellow-900/30">
                <p
                  v-for="call in group.calls"
                  :key="call.id"
                  :data-name="`tool-call-${call.id}`"
                  class="px-2 py-1 text-xs font-mono text-secondary truncate"
                  :title="summarizeArgs(call.arguments)"
                >
                  {{ summarizeArgs(call.arguments) }}
                </p>
              </div>
            </div>
          </div>

          <div v-if="node.message.toolResult" data-name="message-tool-result" class="pb-3">
            <span
              :class="[
                'inline-flex items-center gap-1 px-2 py-1 text-xs rounded',
                node.message.toolResult.success
                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
              ]"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  v-if="node.message.toolResult.success"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
                <path
                  v-else
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Tool {{ node.message.toolResult.success ? 'Success' : 'Failed' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="flattenedNodes.length === 0" data-name="timeline-empty" class="text-center text-muted py-8">
      No messages in this session
    </div>
  </div>
</template>
