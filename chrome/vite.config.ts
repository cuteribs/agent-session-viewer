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
    // Force singleton instances so client/src files and chrome/src/main.ts share
    // the same vue/pinia/chart.js module, preventing the "Cannot read _s" Pinia error.
    dedupe: ['vue', 'pinia', 'chart.js', 'vue-chartjs'],
    alias: [
      // Override serverConfig first (more specific path must come before the @ catch-all)
      {
        find: '@/utils/serverConfig',
        replacement: resolve(__dirname, 'src/utils/serverConfig.ts'),
      },
      // Point @ at client/src so all other client components/composables/stores are reused
      {
        find: '@',
        replacement: resolve(__dirname, '../client/src'),
      },
      {
        find: 'shared',
        replacement: resolve(__dirname, '../shared'),
      },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Extensions cannot use dynamic chunk splitting reliably
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        // Keep background.js at the dist root so the manifest can reference it
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
