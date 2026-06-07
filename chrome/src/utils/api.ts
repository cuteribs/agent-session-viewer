/**
 * REST API client for the Agent Session Viewer server.
 * Mirrors the API wrapper in client/src/utils/api.ts (reverse-engineered
 * from the built client).
 *
 * The server URL is read from the config store so it can be changed at runtime.
 */
import type { SessionSummary, SessionDetail, AppConfig } from '@/types'

let _baseUrl = 'http://localhost:3000'

export function setBaseUrl(url: string) {
  // Normalise: strip trailing slash
  _baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl(): string {
  return _baseUrl
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${_baseUrl}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as { message?: string }).message ?? 'Request failed')
  }
  return res.json() as Promise<T>
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function listSessions(source?: string): Promise<SessionSummary[]> {
  const qs = source && source !== 'all' ? `?source=${source}` : ''
  return apiFetch(`/sessions${qs}`)
}

export function getSession(source: string, sessionId: string): Promise<SessionDetail> {
  return apiFetch(`/sessions/${source}/${sessionId}`)
}

export function deleteSession(source: string, sessionId: string): Promise<void> {
  return apiFetch(`/sessions/${source}/${sessionId}`, { method: 'DELETE' })
}

// ── Config ───────────────────────────────────────────────────────────────────

export function getConfig(): Promise<AppConfig> {
  return apiFetch('/config')
}

export function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  return apiFetch('/config', { method: 'PUT', body: JSON.stringify(config) })
}

// ── Watch ────────────────────────────────────────────────────────────────────

export function getWatchStatus(): Promise<{ active: boolean }> {
  return apiFetch('/watch')
}

export function setWatchStatus(active: boolean): Promise<{ active: boolean }> {
  return apiFetch('/watch', { method: 'POST', body: JSON.stringify({ active }) })
}

// ── Export URL helpers ────────────────────────────────────────────────────────

export function exportUrl(source: string, sessionId: string, format: 'json' | 'markdown'): string {
  return `${_baseUrl}/api/export/${source}/${sessionId}?format=${format}`
}

// ── Server health check ───────────────────────────────────────────────────────

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${_baseUrl}/api/sessions?source=all`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────

export function makeWsUrl(): string {
  const base = _baseUrl.replace(/^http/, 'ws')
  return `${base}/ws`
}
