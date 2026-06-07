<script setup lang="ts">
import { ref, computed } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useSessionsStore } from '@/stores/sessions'
import { checkServerHealth } from '@/utils/api'

const emit = defineEmits<{ close: [] }>()
const config = useConfigStore()
const sessions = useSessionsStore()

const checking = ref(false)
const checkResult = ref<boolean | null>(null)

async function testConnection() {
  checking.value = true; checkResult.value = null
  checkResult.value = await checkServerHealth()
  checking.value = false
}

async function saveAndReload() {
  await sessions.loadAll()
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="emit('close')">
    <div class="bg-primary rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]">

      <!-- Header -->
      <div class="p-4 border-b border-default flex items-center justify-between shrink-0">
        <div>
          <h2 class="text-lg font-semibold text-primary">Settings</h2>
          <p class="text-sm text-secondary">Connect to the Agent Session Viewer server</p>
        </div>
        <button class="p-2 rounded-lg hover:bg-tertiary text-muted" @click="emit('close')">
          <span class="material-symbols-outlined" style="font-size:18px">close</span>
        </button>
      </div>

      <!-- Body -->
      <div class="overflow-y-auto p-4 flex flex-col gap-5">

        <!-- Server URL -->
        <section class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-muted uppercase tracking-wider">Server Connection</h3>

          <div>
            <label class="block text-xs text-muted mb-1">Server URL</label>
            <div class="flex gap-2">
              <input
                v-model="config.serverUrl"
                type="url"
                placeholder="http://localhost:3000"
                class="flex-1 bg-secondary border border-default rounded px-3 py-1.5 text-sm text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                class="px-3 py-1.5 rounded text-sm font-medium bg-secondary border border-default text-primary hover:bg-tertiary transition-colors shrink-0"
                :disabled="checking"
                @click="testConnection"
              >
                {{ checking ? 'Checking…' : 'Test' }}
              </button>
            </div>
            <div v-if="checkResult !== null" class="mt-1.5 flex items-center gap-1.5 text-xs">
              <span
                class="w-2 h-2 rounded-full"
                :class="checkResult ? 'bg-green-500' : 'bg-red-500'"
              />
              <span :class="checkResult ? 'text-green-600 dark:text-green-400' : 'text-red-500'">
                {{ checkResult ? 'Server reachable' : 'Cannot reach server' }}
              </span>
            </div>
          </div>
        </section>

        <!-- How to start the server -->
        <section class="flex flex-col gap-2">
          <h3 class="text-sm font-semibold text-muted uppercase tracking-wider">How to Start the Server</h3>
          <p class="text-xs text-secondary">
            The extension connects to the Agent Session Viewer backend which reads your local session files.
            Start it with one of these commands:
          </p>

          <div>
            <div class="text-xs font-semibold text-muted mb-1">Quick start (no install)</div>
            <pre class="font-mono text-xs bg-tertiary rounded p-2.5 text-primary select-all">npx @cuteribs/agent-session-viewer</pre>
          </div>

          <div>
            <div class="text-xs font-semibold text-muted mb-1">From this repository</div>
            <pre class="font-mono text-xs bg-tertiary rounded p-2.5 text-primary select-all">cd /path/to/agent-session-viewer
./run.sh          # Linux / Mac
run.bat           # Windows</pre>
          </div>

          <div class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
            <span class="material-symbols-outlined shrink-0" style="font-size:14px">info</span>
            <span>The server reads your Claude, Copilot, Codex, OpenCode, and VS Code session files from your home directory. It binds to <code class="font-mono">localhost</code> only — no external access.</span>
          </div>
        </section>

        <!-- Preferences -->
        <section class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold text-muted uppercase tracking-wider">Preferences</h3>

          <div class="flex items-center justify-between">
            <span class="text-sm text-primary">Theme</span>
            <select v-model="config.theme" class="bg-secondary border border-default rounded px-2 py-1 text-sm text-primary">
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-sm text-primary">Auto-refresh</span>
            <label class="relative inline-flex items-center cursor-pointer">
              <input v-model="config.autoRefresh" type="checkbox" class="sr-only peer" />
              <div class="w-9 h-5 bg-tertiary rounded-full peer peer-checked:bg-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>

          <div v-if="config.autoRefresh" class="flex items-center justify-between">
            <span class="text-sm text-primary">Refresh interval</span>
            <select v-model.number="config.refreshIntervalMs" class="bg-secondary border border-default rounded px-2 py-1 text-sm text-primary">
              <option :value="15000">15s</option>
              <option :value="30000">30s</option>
              <option :value="60000">1m</option>
              <option :value="300000">5m</option>
            </select>
          </div>
        </section>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-default shrink-0">
        <button
          class="px-4 py-2 rounded text-sm font-medium bg-secondary border border-default text-primary hover:bg-tertiary transition-colors"
          @click="emit('close')"
        >Cancel</button>
        <button
          class="px-4 py-2 rounded text-sm font-medium bg-accent text-white hover:opacity-90 transition-opacity"
          @click="saveAndReload"
        >Save &amp; Connect</button>
      </div>
    </div>
  </div>
</template>
