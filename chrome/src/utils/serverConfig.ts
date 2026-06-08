import { ref } from 'vue'

// Extension version: server URL is persisted in chrome.storage.local
// Default to localhost:3000 so the extension works out of the box
export const serverUrl = ref('http://localhost:3000')

export async function initServerUrl(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.get('serverUrl', (result) => {
      if (result['serverUrl']) {
        serverUrl.value = result['serverUrl'] as string
      }
      resolve()
    })
  })
}

export async function saveServerUrl(url: string): Promise<void> {
  const trimmed = url.trim()
  serverUrl.value = trimmed || 'http://localhost:3000'
  chrome.storage.local.set({ serverUrl: serverUrl.value })
}
