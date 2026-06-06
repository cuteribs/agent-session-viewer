<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SessionDetail } from '@/types'
import { getLogFileURL, getExportURL } from '@/utils/api'

const props = defineProps<{
  session: SessionDetail
}>()

const copied = ref(false)

const logPath = computed(() => props.session.logFilePath ?? '')
const available = computed(() => props.session.logAvailable === true)
const isDbBacked = computed(() => logPath.value.startsWith('db::'))

const downloadUrl = computed(() => getLogFileURL(props.session.source, props.session.id))
const exportJsonUrl = computed(() => getExportURL(props.session.source, props.session.id, 'json'))

async function copyPath() {
  if (!logPath.value) return
  try {
    await navigator.clipboard.writeText(logPath.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard unavailable — ignore
  }
}
</script>

<template>
  <div data-name="logfile-view" class="space-y-4">
    <!-- Log file location -->
    <div data-name="logfile-location" class="bg-primary rounded-lg border border-default p-4">
      <h3 class="text-sm font-medium text-primary mb-2">Raw log file</h3>

      <!-- DB-backed sessions have no file -->
      <div v-if="isDbBacked || !logPath" data-name="logfile-db-note" class="space-y-3">
        <div class="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300">
          <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <span>
            This session is stored in the OpenCode SQLite database and has no standalone raw log file.
            Use Export JSON to download the parsed session instead.
          </span>
        </div>
        <a
          data-name="logfile-export-json"
          :href="exportJsonUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export JSON
        </a>
      </div>

      <!-- File path + download -->
      <div v-else class="space-y-3">
        <div data-name="logfile-path-row" class="flex items-stretch gap-2">
          <code
            data-name="logfile-path"
            class="flex-1 px-3 py-2 bg-tertiary rounded text-sm text-primary font-mono break-all select-all"
          >{{ logPath }}</code>
          <button
            data-name="logfile-copy"
            @click="copyPath"
            class="flex items-center gap-1 px-3 py-2 text-sm bg-tertiary hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors shrink-0"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>

        <a
          v-if="available"
          data-name="logfile-download"
          :href="downloadUrl"
          class="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-accent text-white rounded hover:bg-accent-hover transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download raw log
        </a>
        <div
          v-else
          data-name="logfile-missing"
          class="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-sm text-amber-800 dark:text-amber-300"
        >
          <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          </svg>
          <span>The raw log file is no longer available on disk.</span>
        </div>
      </div>
    </div>
  </div>
</template>
