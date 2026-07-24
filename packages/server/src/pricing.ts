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
  /** Higher rate applied when total input exceeds the documented threshold */
  longContext?: {
    threshold: number;
    input: number;
    cachedInput: number;
    output: number;
  };
}

// Lookup table keyed by canonical model ID (lower-case, trimmed).
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ── OpenAI ──────────────────────────────────────────────
  'gpt-4.1':         { input: 2.00,  cachedInput: 0.50,  cacheWrite: 0,  output: 8.00  },
  'gpt-5-mini':      { input: 0.25,  cachedInput: 0.025, cacheWrite: 0,  output: 2.00  },
  'gpt-5.2':         { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.2-codex':   { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.3-codex':   { input: 1.75,  cachedInput: 0.175, cacheWrite: 0,  output: 14.00 },
  'gpt-5.4':         { input: 2.50,  cachedInput: 0.25,  cacheWrite: 0,  output: 15.00, longContext: { threshold: 272_000, input: 5.00, cachedInput: 0.50, output: 22.50 } },
  'gpt-5.4-mini':    { input: 0.75,  cachedInput: 0.075, cacheWrite: 0,  output: 4.50  },
  'gpt-5.4-nano':    { input: 0.20,  cachedInput: 0.02,  cacheWrite: 0,  output: 1.25  },
  'gpt-5.5':         { input: 5.00,  cachedInput: 0.50,  cacheWrite: 0,  output: 30.00, longContext: { threshold: 272_000, input: 10.00, cachedInput: 1.00, output: 45.00 } },
  'gpt-5.6-luna':    { input: 1.00,  cachedInput: 0.10,  cacheWrite: 0,  output: 6.00,  longContext: { threshold: 200_000, input: 2.00, cachedInput: 0.20, output: 9.00 } },
  'gpt-5.6-sol':     { input: 5.00,  cachedInput: 0.50,  cacheWrite: 0,  output: 30.00, longContext: { threshold: 272_000, input: 10.00, cachedInput: 1.00, output: 45.00 } },
  'gpt-5.6-terra':   { input: 2.50,  cachedInput: 0.25,  cacheWrite: 0,  output: 15.00, longContext: { threshold: 272_000, input: 5.00, cachedInput: 0.50, output: 22.50 } },
  // ── Anthropic ───────────────────────────────────────────
  'claude-haiku-4.5':  { input: 1.00, cachedInput: 0.10, cacheWrite: 1.25, output: 5.00  },
  'claude-sonnet-4':   { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-sonnet-4.5': { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-sonnet-4.6': { input: 3.00, cachedInput: 0.30, cacheWrite: 3.75, output: 15.00 },
  'claude-opus-4.5':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-opus-4.6':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-opus-4.7':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-opus-4.8':   { input: 5.00, cachedInput: 0.50, cacheWrite: 6.25, output: 25.00 },
  'claude-sonnet-5':   { input: 2.00, cachedInput: 0.20, cacheWrite: 2.50, output: 10.00 },
  'claude-opus-4.8-fast': { input: 10.00, cachedInput: 1.00, cacheWrite: 12.50, output: 50.00 },
  'claude-fable-5':    { input: 10.00, cachedInput: 1.00, cacheWrite: 12.50, output: 50.00 },
  // ── Google ──────────────────────────────────────────────
  'gemini-2.5-pro':  { input: 1.25, cachedInput: 0.125, cacheWrite: 0, output: 10.00 },
  'gemini-3-flash':  { input: 0.50, cachedInput: 0.05,  cacheWrite: 0, output: 3.00  },
  'gemini-3.1-pro':  { input: 2.00, cachedInput: 0.20,  cacheWrite: 0, output: 12.00, longContext: { threshold: 200_000, input: 4.00, cachedInput: 0.40, output: 18.00 } },
  'gemini-3.5-flash': { input: 1.50, cachedInput: 0.15, cacheWrite: 0, output: 9.00 },
  'gemini-3.6-flash': { input: 1.50, cachedInput: 0.15, cacheWrite: 0, output: 7.50 },
  // ── GitHub / Microsoft / Moonshot AI ────────────────────
  'raptor-mini':       { input: 0.25, cachedInput: 0.025, cacheWrite: 0, output: 2.00 },
  'mai-code-1-flash':  { input: 0.75, cachedInput: 0.075, cacheWrite: 0, output: 4.50 },
  'kimi-k2.7-code':    { input: 0.95, cachedInput: 0.19,  cacheWrite: 0, output: 4.00 },
  // ── xAI ─────────────────────────────────────────────────
  // Historical entry retained for old session logs.
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
  const slug = s.replace(/\s+/g, '-');
  if (slug in PRICING_TABLE) return slug;

  // Prefix / substring matches for older or variant model IDs
  if (s.includes('claude-opus-4.8') && s.includes('fast')) return 'claude-opus-4.8-fast';
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
  if (s.startsWith('gpt-5.6-luna'))  return 'gpt-5.6-luna';
  if (s.startsWith('gpt-5.6-sol'))   return 'gpt-5.6-sol';
  if (s.startsWith('gpt-5.6-terra')) return 'gpt-5.6-terra';
  if (s.startsWith('gpt-5.4-mini'))  return 'gpt-5.4-mini';
  if (s.startsWith('gpt-5.4-nano'))  return 'gpt-5.4-nano';
  if (s.startsWith('gpt-5.4'))       return 'gpt-5.4';
  if (s.startsWith('gpt-5.3-codex')) return 'gpt-5.3-codex';
  if (s.startsWith('gpt-5.2-codex')) return 'gpt-5.2-codex';
  if (s.startsWith('gpt-5.2'))       return 'gpt-5.2';
  if (s.startsWith('gemini-3.1-pro')) return 'gemini-3.1-pro';
  if (s.startsWith('gemini-3.5-flash')) return 'gemini-3.5-flash';
  if (s.startsWith('gemini-3.6-flash')) return 'gemini-3.6-flash';

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
  const inputTokens = tokens.input + (tokens.cacheRead ?? 0) + (tokens.cacheCreation ?? 0);
  const rates = pricing.longContext && inputTokens > pricing.longContext.threshold
    ? pricing.longContext
    : pricing;
  return (
    (tokens.input / M)                    * rates.input +
    (tokens.output / M)                   * rates.output +
    ((tokens.cacheRead    ?? 0) / M)      * rates.cachedInput +
    ((tokens.cacheCreation ?? 0) / M)     * pricing.cacheWrite
  );
}
