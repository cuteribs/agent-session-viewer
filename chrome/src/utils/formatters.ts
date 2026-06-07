export function formatTokens(n: number | undefined, estimated = false): string {
  if (n == null) return '—'
  const prefix = estimated ? '~' : ''
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${prefix}${(n / 1_000).toFixed(1)}K`
  return `${prefix}${n}`
}

export function formatCost(usd: number | undefined): string {
  if (usd == null || usd === 0) return '—'
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`
  return `$${usd.toFixed(4)}`
}

export function formatDuration(ms: number | undefined): string {
  if (!ms) return '—'
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1_000)
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1_000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function pathBasename(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? p
}

export function pathDirname(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}
