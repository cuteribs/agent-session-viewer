<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useSessionsStore } from '@/stores/sessions'
import { formatRelativeTime, formatTokens, truncateText } from '@/utils/formatters'
import type { SessionSummary } from '@/types'

const props = defineProps<{
  session: SessionSummary
}>()

const sessionsStore = useSessionsStore()
const showDeleteConfirm = ref(false)
const showSubAgents = ref(false)

const isActive = computed(() => {
  return (
    sessionsStore.currentSession?.id === props.session.id &&
    sessionsStore.currentSession?.source === props.session.source
  )
})

const subAgents = computed(() => {
  if (!isActive.value) return []
  return sessionsStore.currentSession?.subAgents ?? []
})

const subAgentCount = computed(() => {
  if (isActive.value && subAgents.value.length) return subAgents.value.length
  return props.session.subAgentCount ?? 0
})

watch(isActive, active => {
  if (!active) showSubAgents.value = false
})

function handleClick() {
  sessionsStore.clearSubAgent()
  sessionsStore.selectSession(props.session.source, props.session.id)
}

function handleDelete() {
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  await sessionsStore.removeSession(props.session.source, props.session.id)
  showDeleteConfirm.value = false
}

function cancelDelete() {
  showDeleteConfirm.value = false
}
</script>

<template>
  <div :data-name="`session-item-${session.source}-${session.id.substring(0,8)}`">
    <!-- Session card -->
    <li
      data-name="session-item-button"
      @click="handleClick"
      :class="[
        'bg-surface border border-outline-variant rounded-lg p-2 cursor-pointer hover:border-primary transition-colors border-l-4 relative group mx-2 my-1',
        isActive ? 'border-l-primary' : 'border-l-transparent'
      ]"
    >
      <div class="flex flex-col gap-1">
        <!-- Line 1: Project name + delete button -->
        <div class="flex items-center justify-between gap-1">
          <div class="flex items-center gap-1 min-w-0">
            <span
              v-if="session.incomplete"
              title="Session has no shutdown record — it may have been interrupted or is still in progress. Token counts are estimated."
              class="flex-shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400/20 text-amber-500 dark:bg-amber-500/20 dark:text-amber-400 cursor-help"
              style="font-size:9px; line-height:1; font-weight:700;"
            >!</span>
            <div
              :class="[
                'font-body-sm text-body-sm font-bold truncate',
                session.incomplete ? 'text-on-surface/50' : 'text-on-surface',
              ]"
            >
              {{ truncateText(session.project, 28) }}
            </div>
          </div>
          <button
            data-name="session-item-delete"
            @click.stop="handleDelete"
            class="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error-container rounded transition-all flex-shrink-0"
            title="Delete session"
          >
            <span class="material-symbols-outlined text-error" style="font-size:14px">delete</span>
          </button>
        </div>

        <!-- Line 2: Session ID + time -->
        <div class="flex justify-between items-center">
          <span class="font-code-sm text-code-sm text-on-surface-variant">{{ session.id.substring(0, 8) }}</span>
          <span class="text-[10px] text-on-surface-variant">{{ formatRelativeTime(session.lastActivity) }}</span>
        </div>

        <!-- Line 3: Messages + tokens -->
        <div class="flex justify-between items-center">
          <span class="font-label-caps text-[10px] text-on-surface-variant">{{ session.messageCount }} MSGS</span>
          <span v-if="session.totalTokens" class="font-label-caps text-[10px] text-on-surface-variant">
            {{ formatTokens(session.totalTokens) }} TOKENS
          </span>
        </div>

        <!-- Line 4: Subagents expand (only when there are subagents) -->
        <div
          v-if="subAgentCount"
          @click.stop="isActive ? showSubAgents = !showSubAgents : handleClick()"
          class="flex items-center justify-between bg-surface-container-low rounded px-1.5 py-1 mt-0.5 hover:bg-surface-container transition-colors"
        >
          <span class="font-label-caps text-[10px] text-on-surface-variant">{{ subAgentCount }} SUBAGENTS</span>
          <span
            class="material-symbols-outlined text-on-surface-variant transition-transform"
            :class="showSubAgents ? 'rotate-180' : ''"
            style="font-size:14px"
          >expand_more</span>
        </div>
      </div>
    </li>

    <!-- Subagents list -->
    <div v-if="isActive && showSubAgents && subAgents.length" data-name="session-item-subagents-list" class="mx-2 mb-1">
      <button
        v-for="agent in subAgents"
        :key="agent.id"
        :data-name="`subagent-${agent.id}`"
        @click.stop="sessionsStore.selectSubAgent(agent)"
        class="w-full text-left flex items-center gap-2 px-3 py-1.5 text-body-sm hover:bg-surface-container-high transition-colors rounded"
        :class="sessionsStore.selectedSubAgent?.id === agent.id ? 'bg-primary-fixed text-on-primary-container' : 'text-on-surface'"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
        <div class="flex-1 min-w-0">
          <span class="font-medium">{{ agent.agentId }}</span>
          <span class="text-on-surface-variant ml-1 text-[11px]">({{ agent.agentType }})</span>
        </div>
        <span
          class="text-[11px] font-medium"
          :class="agent.status === 'completed' ? 'text-green-600' : agent.status === 'failed' ? 'text-error' : 'text-yellow-600'"
        >{{ agent.status }}</span>
      </button>
    </div>

    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="showDeleteConfirm"
          data-name="delete-confirm-dialog"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          @click.self="cancelDelete"
        >
          <div data-name="delete-confirm-card" class="bg-surface rounded-xl shadow-xl w-full max-w-sm border border-outline-variant">
            <div data-name="delete-confirm-header" class="p-4 border-b border-outline-variant">
              <h3 class="font-headline-sm text-headline-sm text-on-surface">Delete Session?</h3>
            </div>
            <div data-name="delete-confirm-body" class="p-4 space-y-2">
              <p class="text-body-sm font-body-sm text-on-surface-variant">
                Are you sure you want to permanently delete this session?
              </p>
              <div class="bg-surface-container rounded-lg p-3">
                <p data-name="delete-confirm-project" class="font-body-sm text-body-sm font-semibold text-on-surface">{{ session.project }}</p>
                <p data-name="delete-confirm-path" class="text-[11px] text-on-surface-variant mt-0.5 truncate">{{ session.projectPath }}</p>
              </div>
              <p class="text-[11px] text-error font-semibold">This action cannot be undone.</p>
            </div>
            <div data-name="delete-confirm-actions" class="flex items-center justify-end gap-2 px-4 py-3 border-t border-outline-variant">
              <button
                data-name="delete-confirm-cancel"
                @click="cancelDelete"
                class="px-3 py-1.5 text-body-sm bg-surface-container hover:bg-surface-container-high rounded-DEFAULT transition-colors text-on-surface"
              >Cancel</button>
              <button
                data-name="delete-confirm-ok"
                @click="confirmDelete"
                class="px-3 py-1.5 text-body-sm bg-error text-on-error rounded-DEFAULT hover:opacity-90 transition-opacity"
              >Delete</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
