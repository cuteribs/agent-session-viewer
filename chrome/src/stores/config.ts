import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { DataSource } from '@/types'
import { setBaseUrl } from '@/utils/api'

const STORAGE_KEY = 'asv-ext-config'

function load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') } catch { return {} }
}
function save(data: object) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export const useConfigStore = defineStore('config', () => {
  const stored = load()

  const serverUrl     = ref<string>(stored.serverUrl ?? 'http://localhost:3000')
  const theme         = ref<'light' | 'dark' | 'system'>(stored.theme ?? 'system')
  const autoRefresh   = ref<boolean>(stored.autoRefresh ?? false)
  const refreshIntervalMs = ref<number>(stored.refreshIntervalMs ?? 30_000)
  const sourceFilter  = ref<DataSource | 'all'>(stored.sourceFilter ?? 'all')
  const sortBy        = ref<'date' | 'tokens' | 'cost'>(stored.sortBy ?? 'date')
  const ready         = ref(false)

  function persist() {
    save({
      serverUrl: serverUrl.value, theme: theme.value,
      autoRefresh: autoRefresh.value, refreshIntervalMs: refreshIntervalMs.value,
      sourceFilter: sourceFilter.value, sortBy: sortBy.value,
    })
  }

  watch([serverUrl, theme, autoRefresh, refreshIntervalMs, sourceFilter, sortBy], persist)

  function applyTheme(t: typeof theme.value) {
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  }
  watch(theme, applyTheme)

  function init() {
    applyTheme(theme.value)
    setBaseUrl(serverUrl.value)
    ready.value = true
  }

  // Keep API client in sync with serverUrl changes
  watch(serverUrl, url => setBaseUrl(url))

  return {
    serverUrl, theme, autoRefresh, refreshIntervalMs, sourceFilter, sortBy, ready,
    init,
  }
})

