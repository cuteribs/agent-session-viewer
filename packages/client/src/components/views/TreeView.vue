<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import type { SessionDetail, Message } from '@/types'
import { formatTokens } from '@/utils/formatters'

const props = defineProps<{
  session?: SessionDetail
  /** Override the message list (used when showing subagent message logs). */
  messages?: Message[]
}>()

const sessionsStore = useSessionsStore()
const expandedNodes = ref<Set<string>>(new Set())

const displayMessages = computed(() => props.messages ?? props.session?.messages ?? [])

interface TreeNode {
  message: Message
  children: TreeNode[]
  depth: number
}

// Build tree structure from messages
const messageTree = computed(() => {
  const messages = displayMessages.value
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create nodes for all messages
  for (const message of messages) {
    nodeMap.set(message.id, { message, children: [], depth: 0 })
  }

  // Build tree relationships
  for (const message of messages) {
    const node = nodeMap.get(message.id)!
    if (message.parentId && nodeMap.has(message.parentId)) {
      const parent = nodeMap.get(message.parentId)!
      parent.children.push(node)
      node.depth = parent.depth + 1
    } else {
      roots.push(node)
    }
  }

  return roots
})

// Flatten tree for rendering with depth info
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []

  function traverse(node: TreeNode) {
    result.push(node)
    if (expandedNodes.value.has(node.message.id)) {
      for (const child of node.children) {
        traverse(child)
      }
    }
  }

  for (const node of nodes) {
    traverse(node)
  }

  return result
}

const flattenedNodes = computed(() => flattenTree(messageTree.value))

function toggleNode(id: string) {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

function isExpanded(id: string): boolean {
  return expandedNodes.value.has(id)
}

function hasChildren(node: TreeNode): boolean {
  return node.children.length > 0
}

function expandAll() {
  for (const message of displayMessages.value) {
    expandedNodes.value.add(message.id)
  }
}

function collapseAll() {
  expandedNodes.value.clear()
}

function openPreview(message: Message) {
  sessionsStore.openPreview(message)
}

function getRoleColor(role: string): string {
  switch (role) {
    case 'user': return 'bg-blue-500'
    case 'assistant': return 'bg-green-500'
    case 'tool': return 'bg-yellow-500'
    default: return 'bg-gray-500'
  }
}
</script>

<template>
  <div data-name="tree-view">
    <!-- Controls -->
    <div data-name="tree-controls" class="flex gap-2 mb-4">
      <button
        data-name="tree-expand-all"
        @click="expandAll"
        class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
      >
        Expand All
      </button>
      <button
        data-name="tree-collapse-all"
        @click="collapseAll"
        class="px-3 py-1.5 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
      >
        Collapse All
      </button>
    </div>

    <!-- Tree -->
    <div data-name="tree-nodes" class="bg-primary rounded-lg border border-default p-4">
      <div
        v-for="node in flattenedNodes"
        :key="node.message.id"
        :data-name="`tree-node-${node.message.role}-${node.message.id.substring(0,8)}`"
        class="py-1"
        :style="{ marginLeft: node.depth * 24 + 'px' }"
      >
        <div class="flex items-start gap-2">
          <!-- Expand/collapse button -->
          <button
            v-if="hasChildren(node)"
            data-name="tree-toggle-expand"
            @click="toggleNode(node.message.id)"
            class="mt-1 p-0.5 hover:bg-tertiary rounded flex-shrink-0"
          >
            <svg
              :class="['w-4 h-4 text-muted transition-transform', isExpanded(node.message.id) ? 'rotate-90' : '']"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div v-else class="w-5 flex-shrink-0" />

          <!-- Node content -->
          <div
            data-name="tree-node-content"
            class="flex-1 p-2 bg-secondary rounded cursor-pointer hover:bg-tertiary transition-colors"
            @click="openPreview(node.message)"
          >
            <div class="flex items-center gap-2 text-sm">
              <span
                data-name="tree-node-role"
                :class="[
                  'px-1.5 py-0.5 text-xs font-medium rounded text-white capitalize',
                  getRoleColor(node.message.role)
                ]"
              >
                {{ node.message.role }}
              </span>
              <span data-name="tree-node-id" class="text-xs text-muted">{{ node.message.id.substring(0, 8) }}...</span>
              <!-- Token badge -->
              <span
                v-if="node.message.tokens"
                data-name="tree-node-tokens"
                class="text-xs px-1.5 py-0.5 bg-secondary rounded"
                :title="node.message.tokens.estimated
                  ? `~Output: ${node.message.tokens.output.toLocaleString()} tokens`
                  : `Input: ${node.message.tokens.input.toLocaleString()}, Output: ${node.message.tokens.output.toLocaleString()}`"
              >
                <span v-if="node.message.tokens.estimated" class="text-amber-500">~</span>{{ formatTokens(node.message.tokens.input + node.message.tokens.output) }}
              </span>
              <span v-if="node.message.toolCalls && node.message.toolCalls.length > 0" data-name="tree-node-tool-count" class="text-xs text-yellow-600 dark:text-yellow-400">
                {{ node.message.toolCalls.length }} tool call(s)
              </span>
              <span v-if="hasChildren(node)" data-name="tree-node-child-count" class="text-xs text-muted">
                ({{ node.children.length }} {{ node.children.length === 1 ? 'child' : 'children' }})
              </span>
            </div>
            <p data-name="tree-node-text" class="text-sm text-primary mt-1 truncate">
              <template v-if="node.message.content">
                {{ node.message.content.substring(0, 100) }}{{ node.message.content.length > 100 ? '...' : '' }}
              </template>
              <template v-else-if="node.message.toolCalls && node.message.toolCalls.length > 0">
                <span class="text-yellow-600 dark:text-yellow-400">{{ node.message.toolCalls.map(t => t.name).join(', ') }}</span>
              </template>
              <template v-else>
                <span class="text-muted italic">(no content)</span>
              </template>
            </p>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="flattenedNodes.length === 0" data-name="tree-empty" class="text-center text-muted py-8">
        No messages in this session
      </div>
    </div>
  </div>
</template>
