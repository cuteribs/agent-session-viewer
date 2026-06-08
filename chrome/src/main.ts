import { createApp } from 'vue'
import { createPinia } from 'pinia'
// App.vue and style.css are resolved from ../client/src via the @ alias in vite.config.ts
import App from '@/App.vue'
import '@/style.css'
import { initServerUrl } from '@/utils/serverConfig'

async function init() {
  await initServerUrl()
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.mount('#app')
}

init()
