/**
 * Model list prices (M17), USD per million tokens, Sep 2026, from docs/vault-hub/07-build-plan.md §1
 * (Tier table). Keyed by the model id a provider reports in the audit event's detail.model.
 *
 *   input        USD per 1M non-cached input tokens
 *   output       USD per 1M output tokens
 *   cache_read   multiplier on `input` for cached input tokens; 0.1 unless a model says otherwise
 *
 * Batch API calls (detail.batch === true) are billed at BATCH_FACTOR of the list price (docs 02, Appendix A).
 * A model that is not listed has no price: cost.ts reports its tokens and counts the call as unpriced rather
 * than guessing. Prices drift; change them here and nowhere else.
 */
export interface ModelPrice { input: number; output: number; cache_read?: number; label: string }

export const CACHE_READ_FACTOR = 0.1;
export const BATCH_FACTOR = 0.5;

export const PRICES: Record<string, ModelPrice> = {
  'claude-fable-5-1': { input: 10, output: 50, label: 'Claude Fable 5.1' },
  'claude-opus-5-5': { input: 4, output: 20, label: 'Claude Opus 5.5' },
  'claude-sonnet-5-5': { input: 2, output: 10, label: 'Claude Sonnet 5.5' },
  'claude-haiku-4-5': { input: 1, output: 5, label: 'Claude Haiku 4.5' },
  /** The deterministic test provider costs nothing. */
  'fake-1': { input: 0, output: 0, label: 'Fake provider (tests)' },
};

/** Model used when an audit event names none: the server's default (LLM_MODEL, else the Tier B model). */
export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Price for a model id, tolerating a dated suffix (claude-sonnet-5-5-20260901) or a "[1m]" style tag. Undefined when unknown. */
export function priceFor(model: string | null | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase().replace(/\[.*\]$/, '').trim();
  if (PRICES[id]) return PRICES[id];
  const hit = Object.keys(PRICES).sort((a, b) => b.length - a.length).find(k => id.startsWith(k + '-') || id.startsWith(k + '@'));
  return hit ? PRICES[hit] : undefined;
}

export interface Usage { input: number; cached: number; output: number }

/**
 * USD for one call, rounded to 5 decimal places (the precision of audit_events.cost_usd) so per-row costs
 * add up exactly. Undefined when the model has no price.
 */
export function costOf(model: string | null | undefined, u: Usage, opts: { batch?: boolean } = {}): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  const factor = opts.batch ? BATCH_FACTOR : 1;
  const usd = ((u.input * p.input + u.cached * p.input * (p.cache_read ?? CACHE_READ_FACTOR) + u.output * p.output) / 1e6) * factor;
  return Math.round(usd * 1e5) / 1e5;
}
