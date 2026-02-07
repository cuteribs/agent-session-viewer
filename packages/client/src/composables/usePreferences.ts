import { ref, watch } from 'vue'
import type { ViewMode, ListViewMode } from '../types'

const PREFS_KEY = 'agent-session-viewer-prefs'

interface Preferences {
  listViewMode: ListViewMode
  defaultViewMode: ViewMode
  sidebarWidth: number
  autoRefresh: boolean
}

const defaultPrefs: Preferences = {
  listViewMode: 'date',
  defaultViewMode: 'timeline',
  sidebarWidth: 320,
  autoRefresh: true,
}

const prefs = ref<Preferences>({ ...defaultPrefs })

function loadPreferences(): Preferences {
  try {
    const saved = localStorage.getItem(PREFS_KEY)
    if (saved) {
      return { ...defaultPrefs, ...JSON.parse(saved) }
    }
  } catch (e) {
    console.error('Failed to load preferences:', e)
  }
  return { ...defaultPrefs }
}

function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(preferences))
  } catch (e) {
    console.error('Failed to save preferences:', e)
  }
}

export function usePreferences() {
  // Initialize on first use
  if (prefs.value === defaultPrefs) {
    prefs.value = loadPreferences()
  }

  // Watch for changes and persist
  watch(
    prefs,
    (newPrefs) => savePreferences(newPrefs),
    { deep: true }
  )

  function setListViewMode(mode: ListViewMode) {
    prefs.value.listViewMode = mode
  }

  function setDefaultViewMode(mode: ViewMode) {
    prefs.value.defaultViewMode = mode
  }

  function setSidebarWidth(width: number) {
    prefs.value.sidebarWidth = width
  }

  function setAutoRefresh(enabled: boolean) {
    prefs.value.autoRefresh = enabled
  }

  function resetPreferences() {
    prefs.value = { ...defaultPrefs }
  }

  return {
    prefs,
    setListViewMode,
    setDefaultViewMode,
    setSidebarWidth,
    setAutoRefresh,
    resetPreferences,
  }
}
