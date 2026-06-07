import { ref, computed, watch } from 'vue'
import type { Theme } from '../types'

const THEME_KEY = 'agent-session-viewer-theme'

const theme = ref<Theme>('system')

export function useTheme() {
  const resolvedTheme = computed<'light' | 'dark'>(() => {
    if (theme.value === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme.value
  })

  const isDark = computed(() => resolvedTheme.value === 'dark')

  function setTheme(newTheme: Theme) {
    theme.value = newTheme
    localStorage.setItem(THEME_KEY, newTheme)
    applyTheme()
  }

  function toggleTheme() {
    const newTheme = resolvedTheme.value === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
  }

  function applyTheme() {
    const root = document.documentElement
    if (resolvedTheme.value === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null
    if (saved) {
      theme.value = saved
    }
    applyTheme()

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme.value === 'system') {
        applyTheme()
      }
    })
  }

  // Watch for theme changes
  watch(theme, applyTheme)

  return {
    theme,
    resolvedTheme,
    isDark,
    setTheme,
    toggleTheme,
    initTheme,
  }
}
