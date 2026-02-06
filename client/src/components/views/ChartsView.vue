<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar } from 'vue-chartjs'
import type { ChartEvent, ActiveElement } from 'chart.js'
import type { SessionDetail } from '@/types'
import { useSessionsStore } from '@/stores/sessions'
import { formatNumber } from '@/utils/formatters'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const props = defineProps<{
  session: SessionDetail
}>()

const sessionsStore = useSessionsStore()

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
    },
  },
  onClick: (event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length > 0 && elements[0].datasetIndex === 0) {
      const messageIndex = elements[0].index
      sessionsStore.selectMessageByIndex(messageIndex)
      console.log(`Clicked message index: ${messageIndex}`)
    }
  },
}

// Token usage over time chart
const tokenChartData = computed(() => {
  const stats = props.session.stats
  if (!stats.tokens) {
    return null
  }

  const labels = stats.tokens.inputPerMessage.map((_, i) => `Msg ${i + 1}`)

  return {
    labels,
    datasets: [
      {
        label: 'Input Tokens',
        data: stats.tokens.inputPerMessage,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Output Tokens',
        data: stats.tokens.outputPerMessage,
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.3,
      },
    ],
  }
})

// Cumulative tokens chart
const cumulativeChartData = computed(() => {
  const stats = props.session.stats
  if (!stats.tokens) {
    return null
  }

  const labels = stats.tokens.cumulativeTokens.map((_, i) => `Msg ${i + 1}`)

  return {
    labels,
    datasets: [
      {
        label: 'Cumulative Tokens',
        data: stats.tokens.cumulativeTokens,
        borderColor: 'rgb(139, 92, 246)',
        backgroundColor: 'rgba(139, 92, 246, 0.2)',
        fill: true,
        tension: 0.3,
      },
    ],
  }
})

// Tool usage chart
const toolChartData = computed(() => {
  const tools = props.session.stats.tools
  if (!tools || tools.length === 0) {
    return null
  }

  return {
    labels: tools.map(t => t.name),
    datasets: [
      {
        label: 'Usage Count',
        data: tools.map(t => t.count),
        backgroundColor: [
          'rgba(59, 130, 246, 0.7)',
          'rgba(16, 185, 129, 0.7)',
          'rgba(245, 158, 11, 0.7)',
          'rgba(239, 68, 68, 0.7)',
          'rgba(139, 92, 246, 0.7)',
          'rgba(236, 72, 153, 0.7)',
          'rgba(14, 165, 233, 0.7)',
          'rgba(34, 197, 94, 0.7)',
        ],
      },
    ],
  }
})

// Extract all tool calls with their parameters
interface ToolCallDetail {
  toolName: string
  messageIndex: number
  timestamp: string
  params: { key: string; value: string }[]
}

const allToolCalls = computed((): ToolCallDetail[] => {
  const calls: ToolCallDetail[] = []

  props.session.messages.forEach((message, index) => {
    if (message.toolCalls) {
      for (const tool of message.toolCalls) {
        const params = extractKeyParams(tool.name, tool.arguments)
        calls.push({
          toolName: tool.name,
          messageIndex: index + 1,
          timestamp: message.timestamp,
          params,
        })
      }
    }
  })

  return calls
})

// Extract the most relevant parameters for display
function extractKeyParams(toolName: string, args: Record<string, unknown>): { key: string; value: string }[] {
  const params: { key: string; value: string }[] = []

  // Priority keys to display based on common tool patterns
  const priorityKeys: Record<string, string[]> = {
    Read: ['file_path', 'path'],
    Write: ['file_path', 'path'],
    Edit: ['file_path', 'path', 'old_string'],
    Glob: ['pattern', 'path'],
    Grep: ['pattern', 'path', 'glob'],
    Bash: ['command', 'description'],
    WebFetch: ['url', 'prompt'],
    WebSearch: ['query'],
    Task: ['description', 'subagent_type', 'prompt'],
    AskUserQuestion: ['questions'],
  }

  const keysToShow = priorityKeys[toolName] || Object.keys(args).slice(0, 3)

  for (const key of keysToShow) {
    if (args[key] !== undefined) {
      let value = args[key]

      // Format the value for display
      if (typeof value === 'string') {
        // Truncate long strings
        value = value.length > 100 ? value.substring(0, 100) + '...' : value
      } else if (Array.isArray(value)) {
        value = `[${value.length} items]`
      } else if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value).substring(0, 100)
        if (JSON.stringify(args[key]).length > 100) value += '...'
      } else {
        value = String(value)
      }

      params.push({ key, value: value as string })
    }
  }

  return params
}

// Format timestamp to time only
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
</script>

<template>
  <div class="space-y-8">
    <!-- Token Stats Summary -->
    <div v-if="session.stats.tokens" class="grid grid-cols-4 gap-4">
      <div class="bg-primary rounded-lg p-4 border border-default">
        <p class="text-sm text-muted">Total Input</p>
        <p class="text-2xl font-bold text-primary">{{ session.stats.tokens.totalInput.toLocaleString() }}</p>
      </div>
      <div class="bg-primary rounded-lg p-4 border border-default">
        <p class="text-sm text-muted">Total Output</p>
        <p class="text-2xl font-bold text-primary">{{ session.stats.tokens.totalOutput.toLocaleString() }}</p>
      </div>
      <div class="bg-primary rounded-lg p-4 border border-default">
        <p class="text-sm text-muted">Cache Read</p>
        <p class="text-2xl font-bold text-primary">{{ session.stats.tokens.totalCacheRead.toLocaleString() }}</p>
      </div>
      <div class="bg-primary rounded-lg p-4 border border-default">
        <p class="text-sm text-muted">Cache Creation</p>
        <p class="text-2xl font-bold text-primary">{{ session.stats.tokens.totalCacheCreation.toLocaleString() }}</p>
      </div>
    </div>

    <!-- Token Usage Over Time -->
    <div v-if="tokenChartData" class="bg-primary rounded-lg p-4 border border-default">
      <h3 class="text-lg font-semibold mb-4 text-primary">Token Usage Per Message</h3>
      <div class="h-64">
        <Line :data="tokenChartData" :options="chartOptions" />
      </div>
    </div>

    <!-- Cumulative Tokens -->
    <div v-if="cumulativeChartData" class="bg-primary rounded-lg p-4 border border-default">
      <h3 class="text-lg font-semibold mb-4 text-primary">Cumulative Token Usage</h3>
      <div class="h-64">
        <Line :data="cumulativeChartData" :options="chartOptions" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <!-- Tool Usage Chart -->
      <div v-if="toolChartData" class="bg-primary rounded-lg p-4 border border-default">
        <h3 class="text-lg font-semibold mb-4 text-primary">Tool Usage</h3>
        <div class="h-64">
          <Bar :data="toolChartData" :options="chartOptions" />
        </div>
      </div>

      <!-- Tool Summary Table -->
      <div v-if="session.stats.tools.length > 0" class="bg-primary rounded-lg p-4 border border-default">
        <h3 class="text-lg font-semibold mb-4 text-primary">Tool Summary</h3>
        <div class="h-64 overflow-y-auto">
          <table class="w-full">
            <thead class="bg-tertiary/50 sticky top-0">
              <tr>
                <th class="text-left px-3 py-2 text-sm font-medium text-muted">Tool</th>
                <th class="text-right px-3 py-2 text-sm font-medium text-muted">Count</th>
                <th class="text-right px-3 py-2 text-sm font-medium text-muted">Success</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="tool in session.stats.tools"
                :key="tool.name"
                class="border-t border-default"
              >
                <td class="px-3 py-2 text-sm text-primary">{{ tool.name }}</td>
                <td class="text-right px-3 py-2 text-sm text-primary">{{ tool.count }}</td>
                <td class="text-right px-3 py-2 text-sm">
                  <span
                    :class="[
                      'px-2 py-0.5 rounded text-xs',
                      tool.successRate >= 0.9
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : tool.successRate >= 0.7
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    ]"
                  >
                    {{ (tool.successRate * 100).toFixed(0) }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Placeholder if no tools -->
      <div v-else class="bg-primary rounded-lg p-4 border border-default">
        <h3 class="text-lg font-semibold mb-4 text-primary">Tool Summary</h3>
        <div class="h-64 flex items-center justify-center text-muted">
          <p>No tool usage data</p>
        </div>
      </div>
    </div>

    <!-- Tool Usage Details Table -->
    <div v-if="allToolCalls.length > 0" class="bg-primary rounded-lg border border-default overflow-hidden">
      <h3 class="text-lg font-semibold p-4 border-b border-default text-primary">
        Tool Usage Details
        <span class="text-sm font-normal text-muted ml-2">({{ allToolCalls.length }} calls)</span>
      </h3>
      <div class="overflow-x-auto max-h-96 overflow-y-auto">
        <table class="w-full">
          <thead class="bg-tertiary/50 sticky top-0">
            <tr>
              <th class="text-left px-4 py-2 text-sm font-medium text-muted">#</th>
              <th class="text-left px-4 py-2 text-sm font-medium text-muted">Tool</th>
              <th class="text-left px-4 py-2 text-sm font-medium text-muted">Parameters</th>
              <th class="text-right px-4 py-2 text-sm font-medium text-muted">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(call, index) in allToolCalls"
              :key="`${call.toolName}-${index}`"
              class="border-t border-default hover:bg-tertiary/30"
            >
              <td class="px-4 py-2 text-sm text-muted">{{ call.messageIndex }}</td>
              <td class="px-4 py-2">
                <span class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 rounded font-medium">
                  {{ call.toolName }}
                </span>
              </td>
              <td class="px-4 py-2">
                <div class="space-y-1">
                  <div
                    v-for="param in call.params"
                    :key="param.key"
                    class="text-sm"
                  >
                    <span class="text-muted">{{ param.key }}:</span>
                    <code class="ml-1 px-1.5 py-0.5 bg-tertiary rounded text-xs text-primary break-all">{{ param.value }}</code>
                  </div>
                  <div v-if="call.params.length === 0" class="text-sm text-muted italic">
                    (no parameters)
                  </div>
                </div>
              </td>
              <td class="px-4 py-2 text-right text-sm text-muted whitespace-nowrap">
                {{ formatTime(call.timestamp) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- No token data message -->
    <div v-if="!session.stats.tokens" class="bg-primary rounded-lg p-8 border border-default text-center text-muted">
      <p>No token usage data available for this session.</p>
      <p class="text-sm mt-1">Token tracking is only available for Claude Code sessions.</p>
    </div>
  </div>
</template>
