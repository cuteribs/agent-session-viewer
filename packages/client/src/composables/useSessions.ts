import { ref, computed } from 'vue'
import { fetchSessions, fetchSession } from '../utils/api'
import type { SessionSummary, SessionDetail } from '../types'

const sessions = ref<SessionSummary[]>([])
const currentSession = ref<SessionDetail | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const sourceFilter = ref<'all' | 'claude' | 'copilot'>('all')

export function useSessions() {
  const filteredSessions = computed(() => {
    if (sourceFilter.value === 'all') {
      return sessions.value
    }
    return sessions.value.filter(s => s.source === sourceFilter.value)
  })

  async function loadSessions() {
    loading.value = true
    error.value = null
    try {
      sessions.value = await fetchSessions(sourceFilter.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sessions'
      console.error('Failed to load sessions:', e)
    } finally {
      loading.value = false
    }
  }

  async function loadSession(source: 'claude' | 'copilot', sessionId: string) {
    loading.value = true
    error.value = null
    try {
      currentSession.value = await fetchSession(source, sessionId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session'
      console.error('Failed to load session:', e)
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

  function updateSession(summary: SessionSummary) {
    const index = sessions.value.findIndex(
      s => s.id === summary.id && s.source === summary.source
    )
    if (index >= 0) {
      sessions.value[index] = summary
    } else {
      sessions.value.unshift(summary)
    }
    // Re-sort by last activity
    sessions.value.sort(
      (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    )
  }

  function removeSession(source: 'claude' | 'copilot', sessionId: string) {
    sessions.value = sessions.value.filter(
      s => !(s.id === sessionId && s.source === source)
    )
    if (currentSession.value?.id === sessionId && currentSession.value?.source === source) {
      currentSession.value = null
    }
  }

  return {
    sessions,
    filteredSessions,
    currentSession,
    loading,
    error,
    sourceFilter,
    loadSessions,
    loadSession,
    clearCurrentSession,
    setSourceFilter,
    updateSession,
    removeSession,
  }
}
