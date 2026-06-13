import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchSessions, fetchSession, deleteSession } from '../utils/api'
import type { SessionSummary, SessionDetail, Message, ViewMode, SubAgent } from '../types'

export const useSessionsStore = defineStore('sessions', () => {
  // State
  const sessions = ref<SessionSummary[]>([])
  const currentSession = ref<SessionDetail | null>(null)
  const loading = ref(false)
  const detailLoading = ref(false)
  const error = ref<string | null>(null)
  const sourceFilter = ref<'all' | 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode'>(
    (localStorage.getItem('sourceFilter') as any) || 'all'
  )
  const searchQuery = ref('')
  const activeView = ref<ViewMode>('timeline')
  const previewMessage = ref<Message | null>(null)
  const showSettings = ref(false)
  const selectedMessageIndex = ref<number | null>(null)
  const selectedSubAgent = ref<SubAgent | null>(null)

  // Computed
  const filteredSessions = computed(() => {
    let result = sessions.value

    if (sourceFilter.value !== 'all') {
      result = result.filter(s => s.source === sourceFilter.value)
    }

    if (searchQuery.value.trim()) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(
        s =>
          s.project.toLowerCase().includes(query) ||
          s.projectPath.toLowerCase().includes(query) ||
          s.id.toLowerCase().includes(query)
      )
    }

    return result
  })

  const sessionsByDate = computed(() => {
    const groups: Record<string, SessionSummary[]> = {}

    for (const session of filteredSessions.value) {
      const date = new Date(session.lastActivity).toLocaleDateString()
      if (!groups[date]) {
        groups[date] = []
      }
      groups[date].push(session)
    }

    return groups
  })

  const sessionsByProject = computed(() => {
    const groups: Record<string, SessionSummary[]> = {}

    for (const session of filteredSessions.value) {
      const project = session.project
      if (!groups[project]) {
        groups[project] = []
      }
      groups[project].push(session)
    }

    return groups
  })

  const sessionsByName = computed(() => {
    const groups: Record<string, SessionSummary[]> = {}

    const sorted = [...filteredSessions.value].sort((a, b) =>
      a.project.localeCompare(b.project)
    )

    for (const session of sorted) {
      const letter = session.project.charAt(0).toUpperCase() || '#'
      if (!groups[letter]) {
        groups[letter] = []
      }
      groups[letter].push(session)
    }

    return groups
  })

  // Actions
  async function loadSessions() {
    loading.value = true
    error.value = null
    try {
      sessions.value = await fetchSessions(sourceFilter.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sessions'
    } finally {
      loading.value = false
    }
  }

  async function selectSession(source: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode', sessionId: string) {
    detailLoading.value = true
    error.value = null
    try {
      currentSession.value = await fetchSession(source, sessionId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session'
    } finally {
      detailLoading.value = false
    }
  }

  function clearCurrentSession() {
    currentSession.value = null
  }

  function setSourceFilter(filter: 'all' | 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode') {
    sourceFilter.value = filter
    localStorage.setItem('sourceFilter', filter)
    loadSessions()
  }

  function setSearchQuery(query: string) {
    searchQuery.value = query
  }

  function setActiveView(view: ViewMode) {
    activeView.value = view
  }

  function openPreview(message: Message) {
    previewMessage.value = message
  }

  function closePreview() {
    previewMessage.value = null
  }

  function openSettings() {
    showSettings.value = true
  }

  function closeSettings() {
    showSettings.value = false
  }

  async function removeSession(source: 'claude' | 'copilot' | 'codex' | 'opencode' | 'vscode', sessionId: string) {
    loading.value = true
    error.value = null
    try {
      await deleteSession(source, sessionId)
      sessions.value = sessions.value.filter(
        s => !(s.id === sessionId && s.source === source)
      )
      if (currentSession.value?.id === sessionId && currentSession.value?.source === source) {
        currentSession.value = null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete session'
      console.error('Failed to delete session:', e)
    } finally {
      loading.value = false
    }
  }

  function selectMessageByIndex(index: number) {
    selectedMessageIndex.value = index
    setActiveView('timeline')
  }

  function selectSubAgent(agent: SubAgent) {
    selectedSubAgent.value = agent
  }

  function clearSubAgent() {
    selectedSubAgent.value = null
  }

  return {
    sessions,
    currentSession,
    loading,
    detailLoading,
    error,
    sourceFilter,
    searchQuery,
    activeView,
    previewMessage,
    showSettings,
    selectedMessageIndex,
    selectedSubAgent,
    filteredSessions,
    sessionsByDate,
    sessionsByProject,
    sessionsByName,
    loadSessions,
    selectSession,
    clearCurrentSession,
    setSourceFilter,
    setSearchQuery,
    setActiveView,
    openPreview,
    closePreview,
    openSettings,
    closeSettings,
    removeSession,
    selectMessageByIndex,
    selectSubAgent,
    clearSubAgent,
  }
})
