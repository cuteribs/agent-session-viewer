import { ref, onUnmounted } from 'vue'
import type { WSMessage } from '../types'
import { serverUrl } from '@/utils/serverConfig'

function getWsUrl() {
  if (serverUrl.value) {
    return serverUrl.value.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/ws'
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

const socket = ref<WebSocket | null>(null)
const connected = ref(false)
const reconnectAttempts = ref(0)
const maxReconnectAttempts = 5
const reconnectDelay = 2000

type MessageHandler = (message: WSMessage) => void
const messageHandlers = new Set<MessageHandler>()

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function useWebSocket() {
  function connect() {
    if (socket.value?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      socket.value = new WebSocket(getWsUrl())

      socket.value.onopen = () => {
        console.log('WebSocket connected')
        connected.value = true
        reconnectAttempts.value = 0
      }

      socket.value.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data)
          for (const handler of messageHandlers) {
            handler(message)
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e)
        }
      }

      socket.value.onclose = () => {
        console.log('WebSocket disconnected')
        connected.value = false
        scheduleReconnect()
      }

      socket.value.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    } catch (e) {
      console.error('Failed to create WebSocket:', e)
      scheduleReconnect()
    }
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (socket.value) {
      socket.value.close()
      socket.value = null
    }
    connected.value = false
  }

  function scheduleReconnect() {
    if (reconnectAttempts.value >= maxReconnectAttempts) {
      console.log('Max reconnect attempts reached')
      return
    }

    reconnectTimer = setTimeout(() => {
      reconnectAttempts.value++
      console.log(`Reconnecting... (attempt ${reconnectAttempts.value})`)
      connect()
    }, reconnectDelay)
  }

  function onMessage(handler: MessageHandler) {
    messageHandlers.add(handler)
    return () => messageHandlers.delete(handler)
  }

  onUnmounted(() => {
    // Don't disconnect on component unmount - keep connection alive
    // disconnect()
  })

  return {
    socket,
    connected,
    connect,
    disconnect,
    onMessage,
  }
}
