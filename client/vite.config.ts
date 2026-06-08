import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { copyFileSync } from 'fs'

// Copies icon*.png from the shared assets/ folder into dist/ on every build
function copyIcons(): Plugin {
  const icons = ['icon16.png', 'icon32.png', 'icon64.png', 'icon128.png']
  const srcDir = resolve(__dirname, '../assets')
  return {
    name: 'copy-icons',
    closeBundle() {
      for (const icon of icons) {
        copyFileSync(resolve(srcDir, icon), resolve(__dirname, 'dist', icon))
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), copyIcons()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
