import { ref } from 'vue'

// Web version: empty string means use relative /api (dev-proxy or same-origin)
export const serverUrl = ref('')

export async function initServerUrl(): Promise<void> {
  // In web context, support a localStorage override for dev/testing purposes
  const stored = localStorage.getItem('serverUrl')
  if (stored) serverUrl.value = stored
}

export async function saveServerUrl(url: string): Promise<void> {
  serverUrl.value = url.trim()
  if (url.trim()) {
    localStorage.setItem('serverUrl', url.trim())
  } else {
    localStorage.removeItem('serverUrl')
  }
}
