<script setup lang="ts">
import { computed } from 'vue'
import type { SessionDetail } from '@/types'
import { Bar, Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  ArcElement, Tooltip, Legend,
} from 'chart.js'
import { formatTokens, formatCost } from '@/utils/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const props = defineProps<{ session: SessionDetail }>()

const tokenStats = computed(() => props.session.stats.tokens)

const barData = computed(() => {
  if (!tokenStats.value) return null
  const labels = tokenStats.value.inputPerMessage.map((_, i) => `#${i + 1}`)
  return {
    labels,
    datasets: [
      { label: 'Input', data: tokenStats.value.inputPerMessage, backgroundColor: 'rgba(59,130,246,0.7)' },
      { label: 'Output', data: tokenStats.value.outputPerMessage, backgroundColor: 'rgba(16,185,129,0.5)' },
    ],
  }
})

const doughnutData = computed(() => {
  const tools = props.session.toolUsage
  if (!tools.length) return null
  return {
    labels: tools.map(t => t.name),
    datasets: [{ data: tools.map(t => t.count), backgroundColor: [
      '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16',
    ] }],
  }
})

const barOptions = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'top' as const }, tooltip: { callbacks: { label: (ctx: { dataset: { label?: string }; parsed: { y?: number } }) => `${ctx.dataset.label}: ${formatTokens(ctx.parsed.y)}` } } },
  scales: { x: { stacked: true }, y: { stacked: true } },
}
const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' as const } } }

const metricCards = computed(() => {
  const t = tokenStats.value
  if (!t) return []
  return [
    { label: 'Total Input', value: formatTokens(t.totalInput), icon: 'input' },
    { label: 'Total Output', value: formatTokens(t.totalOutput), icon: 'output' },
    { label: 'Cache Read', value: formatTokens(t.totalCacheRead), icon: 'cached' },
    { label: 'Total Cost', value: formatCost(t.totalCost), icon: 'payments' },
  ]
})
</script>

<template>
  <div class="flex flex-col gap-4 py-2">
    <!-- Metric cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div v-for="card in metricCards" :key="card.label" class="bg-primary rounded-lg p-4 border border-default">
        <div class="text-xs text-muted mb-1 flex items-center gap-1">
          <span class="material-symbols-outlined" style="font-size:14px">{{ card.icon }}</span>
          {{ card.label }}
        </div>
        <div class="text-2xl font-bold text-primary">{{ card.value }}</div>
      </div>
    </div>

    <!-- Token bar chart -->
    <div v-if="barData" class="bg-primary rounded-lg border border-default p-4">
      <h3 class="text-lg font-semibold mb-4 text-primary">Token Usage per Message</h3>
      <div class="h-64">
        <Bar :data="barData" :options="barOptions" />
      </div>
    </div>

    <!-- Tool charts row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- Doughnut -->
      <div v-if="doughnutData" class="bg-primary rounded-lg border border-default p-4">
        <h3 class="text-lg font-semibold mb-4 text-primary">Tool Usage</h3>
        <div class="h-64">
          <Doughnut :data="doughnutData" :options="doughnutOptions" />
        </div>
      </div>

      <!-- Tool stats table -->
      <div v-if="session.toolUsage.length > 0" class="bg-primary rounded-lg border border-default overflow-hidden">
        <h3 class="text-lg font-semibold p-4 border-b border-default text-primary">Tool Stats</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-tertiary sticky top-0 z-10">
              <tr>
                <th class="text-left px-4 py-2 text-sm font-medium text-muted">Tool</th>
                <th class="text-right px-4 py-2 text-sm font-medium text-muted">Count</th>
                <th class="text-right px-4 py-2 text-sm font-medium text-muted">Success</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tool in session.toolUsage" :key="tool.name" class="border-t border-default hover:bg-tertiary/30">
                <td class="px-4 py-2 text-primary font-mono text-xs truncate max-w-[160px]">{{ tool.name }}</td>
                <td class="px-4 py-2 text-right text-secondary">{{ tool.count }}</td>
                <td class="px-4 py-2 text-right">
                  <span :class="tool.successRate >= 0.9 ? 'text-green-600 dark:text-green-400' : tool.successRate >= 0.7 ? 'text-yellow-600' : 'text-red-500'">
                    {{ Math.round(tool.successRate * 100) }}%
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
