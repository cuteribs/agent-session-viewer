/**
 * Per-token USD pricing loaded from the canonical pricing.json at the repo root.
 * All prices are per 1 000 000 tokens.
 */
// Standard JSON import — supported by esbuild/tsup/vite/Node 22+ natively.
// The `assert { type: 'json' }` attribute is intentionally omitted for
// maximum bundler compatibility (esbuild resolves JSON by extension).
import pricingData from '../pricing.json'

export interface ModelPricing {
  /** New (uncached) input tokens */
  input: number
  /** Cache-read tokens */
  cachedInput: number
  /** Cache-write tokens (Anthropic only; 0 for others) */
  cacheWrite: number
  /** Output tokens */
  output: number
}

type PricingFile = {
  models: Record<string, ModelPricing>
  aliases: Array<{ match: 'exact' | 'prefix' | 'contains'; value: string; canonical: string }>
}

const { models, aliases } = pricingData as unknown as PricingFile

function normalise(raw: string): string | null {
  const s = raw.toLowerCase().trim()
  if (s in models) return s
  for (const rule of aliases) {
    const v = rule.value
    if (
      (rule.match === 'exact'    && s === v) ||
      (rule.match === 'prefix'   && s.startsWith(v)) ||
      (rule.match === 'contains' && s.includes(v))
    ) {
      return rule.canonical
    }
  }
  return null
}

/** Return the pricing entry for a model, or null if unknown. */
export function getPricing(model: string | undefined): ModelPricing | null {
  if (!model) return null
  const key = normalise(model)
  return key ? (models[key] ?? null) : null
}

interface TokenCounts {
  input: number
  output: number
  cacheRead?: number
  cacheCreation?: number
}

/** Calculate the total USD cost for one API call. Returns 0 if model is unknown. */
export function calculateCost(tokens: TokenCounts, model: string | undefined): number {
  const p = getPricing(model)
  if (!p) return 0
  const M = 1_000_000
  return (
    (tokens.input              / M) * p.input +
    (tokens.output             / M) * p.output +
    ((tokens.cacheRead    ?? 0) / M) * p.cachedInput +
    ((tokens.cacheCreation ?? 0) / M) * p.cacheWrite
  )
}
