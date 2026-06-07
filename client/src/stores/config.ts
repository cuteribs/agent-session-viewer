import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchConfig, updateConfig, fetchPaths } from '../utils/api'
import type { AppConfig, PathsResponse } from '../types'

export const useConfigStore = defineStore('config', () => {
  const config = ref<AppConfig | null>(null)
  const paths = ref<PathsResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadConfig() {
    loading.value = true
    error.value = null
    try {
      config.value = await fetchConfig()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load config'
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(updates: Partial<AppConfig>) {
    loading.value = true
    error.value = null
    try {
      config.value = await updateConfig(updates)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save config'
    } finally {
      loading.value = false
    }
  }

  async function loadPaths() {
    try {
      paths.value = await fetchPaths()
    } catch (e) {
      console.error('Failed to load paths:', e)
    }
  }

  return {
    config,
    paths,
    loading,
    error,
    loadConfig,
    saveConfig,
    loadPaths,
  }
})
