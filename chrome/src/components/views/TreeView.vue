<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SessionDetail, Message } from '@/types'

const props = defineProps<{ session: SessionDetail }>()

const collapsed = ref(new Set<string>())

function toggle(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id)
  else collapsed.value.add(id)
}

interface TreeNode extends Message { children: TreeNode[] }

const tree = computed<TreeNode[]>(() => {
  const byId = new Map<string, TreeNode>()
  for (const m of props.session.messages) byId.set(m.id, { ...m, children: [] })
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node)
    else roots.push(node)
  }
  return roots
})

const roleColor: Record<string, string> = {
  user: 'text-secondary', assistant: 'text-primary',
  system: 'text-on-surface-variant', tool: 'text-tertiary',
}
</script>

<template>
  <div class="py-2 font-body-sm text-body-sm">
    <TreeNode
      v-for="node in tree"
      :key="node.id"
      :node="node"
      :collapsed="collapsed"
      :role-color="roleColor"
      @toggle="toggle"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, SetupContext } from 'vue'
// Recursive component defined inline
const TreeNode = defineComponent({
  name: 'TreeNode',
  props: {
    node: { type: Object as PropType<any>, required: true },
    collapsed: { type: Object as PropType<Set<string>>, required: true },
    roleColor: { type: Object as PropType<Record<string, string>>, required: true },
    depth: { type: Number, default: 0 },
  },
  emits: ['toggle'],
  template: `
    <div :style="{ paddingLeft: depth * 16 + 'px' }">
      <div
        class="flex items-start gap-2 py-1 px-2 rounded hover:bg-surface-container-high cursor-pointer group"
        @click="$emit('toggle', node.id)"
      >
        <span
          v-if="node.children.length"
          class="material-symbols-outlined text-on-surface-variant mt-0.5 transition-transform shrink-0"
          style="font-size:14px"
          :class="{ 'rotate-90': !collapsed.has(node.id) }"
        >chevron_right</span>
        <span v-else class="w-3.5 shrink-0" />
        <span class="font-label-caps text-label-caps uppercase shrink-0" :class="roleColor[node.role] ?? 'text-on-surface-variant'">{{ node.role }}</span>
        <span class="text-on-surface truncate flex-1">{{ (node.content || node.toolCalls?.[0]?.name || '').slice(0, 80) }}</span>
        <span class="font-code-sm text-code-sm text-on-surface-variant shrink-0">{{ node.id.slice(0, 8) }}</span>
      </div>
      <template v-if="!collapsed.has(node.id)">
        <TreeNode
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :collapsed="collapsed"
          :role-color="roleColor"
          :depth="depth + 1"
          @toggle="$emit('toggle', $event)"
        />
      </template>
    </div>
  `,
})
export default {}
</script>
