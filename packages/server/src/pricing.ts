/**
 * Per-token pricing for models available in GitHub Copilot.
 * Source: https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 * All prices are per 1 million tokens (USD).
 */

export interface ModelPricing {
  /** New input tokens (not from cache) */
  input: number;
  /** Cache-read tokens (served from cache) */
  cachedInput: number;
  /** Cache-write tokens (writing a new cache entry; Anthropic only) */
  cacheWrite: number;
  /** Output tokens */
  output: number;
}

// Lookup table keyed by canonical model ID (lower-case, trimmed).
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ── OpenAI ──────────────────────────────────────────────
  'gpt-4.1':         { input: 2.00,  cachedInput: 0.50,  cacheWrite: 0,  output: 8.00  },
  'gpt-5-mini':      { input: 0.25,  cachedInput: 0.025, cacheWrite: 0,  output: 2.00  },
  'gpt-5.2':         { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.2-codex':   { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.3-codex':   { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.4':         { input: 2.50,  cachedInput: 0.25,  cacheWrite: 0,  output: 15.00 },
  'gpt-5.4-mini':    { input: 0.75,  cachedInput: 0.075, cacheWrite: 0,  output: 4.50  },
  'gpt-5.4-nano':    { input: 0.20,  cachedInput: 0.02,  cacheWrite: 0,  output: 1.25  },
  'gpt-5.5':         { input: 5.00,  cachedInput: 0.50,  cacheWrite: 0,  output: 30.00 },
  // ── Anthropic ───────────────────────────────────────────
  'claude-haiku-4.5':  { input: 1.00, cachedInput: 0.10, cacheWrite: 1.25, output: 5.00  },
  'claude-sonnet-4':   { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-sonnet-4.5': { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-sonnet-4.6': { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-opus-4.5':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-opus-4.6':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-opus-4.7':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  // ── Google ──────────────────────────────────────────────
  'gemini-2.5-pro':  { input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10.00 },
  'gemini-3-flash':  { input: 0.50, cachedInput: 0.05,  cacheWrite: 0, output: 3.00  },
  'gemini-3.1-pro':  { input: 2.00, cachedInput: 0.20,  cacheWrite: 0, output: 12.00 },
  // ── xAI ─────────────────────────────────────────────────
  'grok-code-fast-1': { input: 0.20, cachedInput: 0.02, cacheWrite: 0, output: 1.50 },
};

/**
 * Normalise a raw model string from a session log to the canonical key
 * used in PRICING_TABLE.  Returns null if no match is found.
 */
function normalise(raw: string): string | null {
  const s = raw.toLowerCase().trim();

  // Direct match
  if (s in PRICING_TABLE) return s;

  // Prefix / substring matches for older or variant model IDs
  if (s.includes('claude-opus-4'))   return 'claude-opus-4.7';
  if (s.includes('claude-sonnet-4')) return 'claude-sonnet-4.6';
  if (s.includes('claude-haiku-4'))  return 'claude-haiku-4.5';
  // Legacy claude-3 names → best-effort mapping
  if (s.includes('claude-3-5-sonnet') || s.includes('claude-3.5-sonnet')) return 'claude-sonnet-4.5';
  if (s.includes('claude-3-opus'))   return 'claude-opus-4.5';
  if (s.includes('claude-3-haiku'))  return 'claude-haiku-4.5';
  if (s.startsWith('gpt-4.1'))       return 'gpt-4.1';
  if (s.startsWith('gpt-5-mini') || s === 'gpt-5 mini') return 'gpt-5-mini';
  if (s.startsWith('gpt-5.5'))       return 'gpt-5.5';
  if (s.startsWith('gpt-5.4-mini'))  return 'gpt-5.4-mini';
  if (s.startsWith('gpt-5.4-nano'))  return 'gpt-5.4-nano';
  if (s.startsWith('gpt-5.4'))       return 'gpt-5.4';
  if (s.startsWith('gpt-5.3-codex')) return 'gpt-5.3-codex';
  if (s.startsWith('gpt-5.2-codex')) return 'gpt-5.2-codex';
  if (s.startsWith('gpt-5.2'))       return 'gpt-5.2';

  return null;
}

/** Return the pricing entry for a model, or null if unknown. */
export function getPricing(model: string | undefined): ModelPricing | null {
  if (!model) return null;
  const key = normalise(model);
  return key ? (PRICING_TABLE[key] ?? null) : null;
}

interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheCreation?: number;
}

/**
 * Calculate the total USD cost for a single API call given token counts
 * and the model used.  Returns 0 if the model is unknown.
 */
export function calculateCost(tokens: TokenCounts, model: string | undefined): number {
  const pricing = getPricing(model);
  if (!pricing) return 0;

  const M = 1_000_000;
  return (
    (tokens.input / M)                    * pricing.input +
    (tokens.output / M)                   * pricing.output +
    ((tokens.cacheRead    ?? 0) / M)      * pricing.cachedInput +
    ((tokens.cacheCreation ?? 0) / M)     * pricing.cacheWrite
  );
}
