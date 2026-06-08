import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import { initServerUrl } from './utils/serverConfig'

async function init() {
  await initServerUrl()
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  app.mount('#app')
}

init()
