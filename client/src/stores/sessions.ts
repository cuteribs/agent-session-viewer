import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { fetchSessions, fetchSession, deleteSession } from '../utils/api'
import { useWebSocket } from '../composables/useWebSocket'
import type { SessionSummary, SessionDetail, Message, ViewMode } from '../types'

export const useSessionsStore = defineStore('sessions', () => {
  // State
  const sessions = ref<SessionSummary[]>([])
  const currentSession = ref<SessionDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const sourceFilter = ref<'all' | 'claude' | 'copilot'>('all')
  const searchQuery = ref('')
  const activeView = ref<ViewMode>('timeline')
  const previewMessage = ref<Message | null>(null)
  const showSettings = ref(false)
  const selectedMessageIndex = ref<number | null>(null)

  // WebSocket setup
  const { connect, onMessage } = useWebSocket()

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

  async function selectSession(source: 'claude' | 'copilot', sessionId: string) {
    loading.value = true
    error.value = null
    try {
      currentSession.value = await fetchSession(source, sessionId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session'
    } finally {
      loading.value = false
    }
  }

  function clearCurrentSession() {
    currentSession.value = null
  }

  function setSourceFilter(filter: 'all' | 'claude' | 'copilot') {
    sourceFilter.value = filter
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

  async function removeSession(source: 'claude' | 'copilot', sessionId: string) {
    loading.value = true
    error.value = null
    try {
      await deleteSession(source, sessionId)
      // Remove from list
      sessions.value = sessions.value.filter(
        s => !(s.id === sessionId && s.source === source)
      )
      // Clear current session if it's the deleted one
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

  // WebSocket handlers
  function initWebSocket() {
    console.log('Initializing WebSocket connection...')
    connect()
    onMessage((msg) => {
      console.log('WebSocket message received:', msg)

      switch (msg.type) {
        case 'session_created':
        case 'session_updated':
          if (msg.payload.data) {
            const index = sessions.value.findIndex(
              s => s.id === msg.payload.sessionId && s.source === msg.payload.source
            )
            if (index >= 0) {
              sessions.value[index] = msg.payload.data
            } else {
              sessions.value.unshift(msg.payload.data)
            }
            // Re-sort
            sessions.value.sort(
              (a, b) =>
                new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
            )

            // Reload current session if it's the one being updated
            if (
              currentSession.value &&
              currentSession.value.id === msg.payload.sessionId &&
              currentSession.value.source === msg.payload.source
            ) {
              console.log('Reloading current session due to update')
              selectSession(msg.payload.source, msg.payload.sessionId)
            }
          }
          break
        case 'session_deleted':
          sessions.value = sessions.value.filter(
            s => !(s.id === msg.payload.sessionId && s.source === msg.payload.source)
          )
          if (
            currentSession.value?.id === msg.payload.sessionId &&
            currentSession.value?.source === msg.payload.source
          ) {
            currentSession.value = null
          }
          break
      }
    })
  }

  return {
    // State
    sessions,
    currentSession,
    loading,
    error,
    sourceFilter,
    searchQuery,
    activeView,
    previewMessage,
    showSettings,
    selectedMessageIndex,
    // Computed
    filteredSessions,
    sessionsByDate,
    sessionsByProject,
    // Actions
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
    initWebSocket,
    removeSession,
    selectMessageByIndex,
  }
})
