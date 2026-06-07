import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import type { DataSource, SessionSummary, SessionDetail } from '@/types'
import { useConfigStore } from './config'
import {
  listSessions, getSession, checkServerHealth, makeWsUrl,
} from '@/utils/api'

export const useSessionsStore = defineStore('sessions', () => {
  const config = useConfigStore()

  const allSessions     = ref<SessionSummary[]>([])
  const detailCache     = shallowRef<Map<string, SessionDetail>>(new Map())
  const currentSessionId  = ref<string | null>(null)
  const currentSubAgentId = ref<string | null>(null)
  const loading           = ref(false)
  const detailLoading     = ref(false)
  const error             = ref<string | null>(null)
  const serverOnline      = ref<boolean | null>(null)  // null = unknown
  const searchQuery       = ref('')
  const watchActive       = ref(false)

  // ── WebSocket ────────────────────────────────────────────────────
  let ws: WebSocket | null = null
  let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null
  let wsAttempts = 0
  const WS_MAX = 5

  function connectWs() {
    if (ws?.readyState === WebSocket.OPEN) return
    try {
      ws = new WebSocket(makeWsUrl())
      ws.onopen  = () => { wsAttempts = 0 }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'session_updated' || msg.type === 'session_created') loadAll()
          if (msg.type === 'watch_status') watchActive.value = msg.payload?.active ?? false
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        if (wsAttempts < WS_MAX) {
          wsReconnectTimer = setTimeout(() => { wsAttempts++; connectWs() }, 2000)
        }
      }
    } catch { /* ignore */ }
  }

  function disconnectWs() {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer)
    ws?.close(); ws = null
  }

  // ── Derived list ─────────────────────────────────────────────────
  const filteredSessions = computed(() => {
    let list = allSessions.value
    if (config.sourceFilter !== 'all') list = list.filter(s => s.source === config.sourceFilter)
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(s => s.project.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      if (config.sortBy === 'tokens') return (b.totalTokens ?? 0) - (a.totalTokens ?? 0)
      if (config.sortBy === 'cost')   return (b.cost ?? 0) - (a.cost ?? 0)
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    })
  })

  const currentSession = computed(() =>
    currentSessionId.value ? detailCache.value.get(currentSessionId.value) ?? null : null)

  const currentSubAgent = computed(() => {
    if (!currentSubAgentId.value || !currentSession.value) return null
    return currentSession.value.subAgents?.find(a => a.id === currentSubAgentId.value) ?? null
  })

  // ── Load all ──────────────────────────────────────────────────────
  async function loadAll() {
    if (loading.value) return
    loading.value = true; error.value = null

    const online = await checkServerHealth()
    serverOnline.value = online
    if (!online) { loading.value = false; return }

    try {
      const sessions = await listSessions(config.sourceFilter)
      allSessions.value = sessions
      // Connect WS once we know server is up
      connectWs()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sessions'
    } finally {
      loading.value = false
    }
  }

  // ── Select session ────────────────────────────────────────────────
  async function selectSession(id: string) {
    currentSubAgentId.value = null
    currentSessionId.value = id
    if (detailCache.value.has(id)) return

    detailLoading.value = true
    try {
      const summary = allSessions.value.find(s => s.id === id)
      if (!summary) return
      const detail = await getSession(summary.source, id)
      const next = new Map(detailCache.value)
      next.set(id, detail)
      detailCache.value = next
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load session'
    } finally {
      detailLoading.value = false
    }
  }

  function selectSubAgent(agentId: string | null) { currentSubAgentId.value = agentId }
  function clearSelection() { currentSessionId.value = null; currentSubAgentId.value = null }

  // ── Auto-refresh ──────────────────────────────────────────────────
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer)
    refreshTimer = setInterval(loadAll, config.refreshIntervalMs)
  }
  function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  }

  return {
    allSessions, filteredSessions, detailCache,
    currentSessionId, currentSession, currentSubAgentId, currentSubAgent,
    loading, detailLoading, error, searchQuery, serverOnline, watchActive,
    loadAll, selectSession, selectSubAgent, clearSelection,
    startAutoRefresh, stopAutoRefresh, disconnectWs,
  }
})

