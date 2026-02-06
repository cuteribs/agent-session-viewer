<script setup lang="ts">
import { onMounted } from 'vue'
import { useTheme } from './composables/useTheme'
import { useSessionsStore } from './stores/sessions'
import AppHeader from './components/layout/AppHeader.vue'
import Sidebar from './components/layout/Sidebar.vue'
import MainContent from './components/layout/MainContent.vue'
import ContentPreviewModal from './components/modals/ContentPreviewModal.vue'
import SettingsModal from './components/modals/SettingsModal.vue'

const { initTheme } = useTheme()
const sessionsStore = useSessionsStore()

onMounted(() => {
  initTheme()
  sessionsStore.loadSessions()
  sessionsStore.initWebSocket()
})
</script>

<template>
  <div class="min-h-screen bg-secondary">
    <AppHeader />

    <div class="flex h-[calc(100vh-64px)]">
      <Sidebar />
      <MainContent />
    </div>

    <ContentPreviewModal />
    <SettingsModal />
  </div>
</template>
