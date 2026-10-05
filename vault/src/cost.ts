/**
 * Cost accounting (M17): what the models and the infrastructure cost, from the audit log and settings.
 *
 * Token spend comes from audit_events rows that carry tokens. The columns tokens_in / tokens_cached / tokens_out
 * are used first; a row that keeps its counts in detail (paper-facts extraction writes detail.tokens_in and
 * detail.tokens_out) is read from there. cost_usd is used when the row has it; otherwise it is computed from
 * the price table in prices.ts using detail.model (DEFAULT_MODEL when the row names none). Each row is rounded
 * to 5 decimals, like the column, and every total is the exact sum of those rows.
 *
 * Feature mapping (audit action prefix → feature). A prefix matches the action itself or the action followed by "."
 *   llm.draft                                     draft       POST /api/draft
 *   llm.tool                                      tool        POST /api/llm (the assistant inside tools)
 *   llm.delta                                     delta       re-run delta notes
 *   llm.dream, dream                              dream       weekly lessons job
 *   ingest.context, llm.context, llm.chunk        chunking    contextual retrieval at ingest (no producer audits it yet)
 *   miners.paper-facts, paper_facts, llm.extract  extraction  paper facts and legal/finance extraction
 *   llm.country-pack                              country-pack  the country opening pack's sections (wave 7 PR5)
 *   llm.round-watch                               round-watch   dated stages read from changed regulator pages (wave 7 PR6)
 * Any other row that carries tokens is counted under "other" so nothing is silently dropped. Summary rows that
 * only repeat totals (lesson.dream keeps detail.tokens as an object) carry no token columns and are not read.
 *
 * Infrastructure lines come from settings.infra_costs (array of {label, plan?, usd_month} or {name: usd}); when the
 * setting is absent the running-cost table of docs/vault-hub/06-architecture.md §11 is used. The infrastructure total
 * is always the sum of the lines returned. Budgets come from settings.budgets: {feature: USD per calendar month}.
 */
import type { Db } from './db/client.ts';
import { costOf, DEFAULT_MODEL } from './prices.ts';

export const INFRA_CEILING_USD = 60;
export const BUDGET_WARN_AT = 0.8;

export const FEATURES = ['draft', 'tool', 'delta', 'chunking', 'dream', 'extraction', 'country-pack', 'round-watch'] as const;
export type FeatureId = (typeof FEATURES)[number] | 'other';
export const FEATURE_LABELS: Record<FeatureId, string> = {
  draft: 'Drafting (email, letter, report, calc note)', tool: 'Tool assistant', delta: 'Delta notes (re-run explanations)',
  chunking: 'Chunking (contextual retrieval)', dream: 'Dream (weekly lessons)', extraction: 'Extraction (paper facts, legal and finance terms)', 'country-pack': 'Country pack (sections drafted from stored originals)',
  'round-watch': 'Round watch (dated stages read from changed regulator pages)', other: 'Other',
};

export const ACTION_FEATURES: Array<[prefix: string, feature: FeatureId]> = [
  ['llm.draft', 'draft'], ['llm.tool', 'tool'], ['llm.delta', 'delta'],
  ['llm.dream', 'dream'], ['dream', 'dream'],
  ['ingest.context', 'chunking'], ['llm.context', 'chunking'], ['llm.chunk', 'chunking'],
  ['miners.paper-facts', 'extraction'], ['paper_facts', 'extraction'], ['llm.extract', 'extraction'],
  ['llm.country-pack', 'country-pack'],
  ['llm.round-watch', 'round-watch'],
];

export function featureOf(action: string): FeatureId {
  for (const [p, f] of ACTION_FEATURES) if (action === p || action.startsWith(p + '.')) return f;
  return 'other';
}

/* ── infrastructure ─────────────────────────────────────────────────── */

export interface InfraLine { key: string; label: string; plan: string | null; usd_month: number }
export const DEFAULT_INFRA: InfraLine[] = [
  { key: 'render', label: 'Render', plan: 'Web service vault-api, starter; static site free', usd_month: 7 },
  { key: 'render-cron', label: 'Render cron jobs', plan: 'Nightly staleness, weekly dream, mail poll', usd_month: 2 },
  { key: 'supabase', label: 'Supabase', plan: 'Pro: Postgres, pgvector, storage, backups', usd_month: 25 },
  { key: 'cloudflare', label: 'Cloudflare', plan: 'Access, up to 50 seats', usd_month: 0 },
  { key: 'voyage', label: 'Voyage', plan: 'Embeddings and rerank', usd_month: 3 },
];

const cents = (n: number) => Math.round(n * 100);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'line';

/** Lines from a settings value; entries that are not a non-negative number are dropped (and named in `ignored`). */
export function parseInfra(value: unknown): { lines: InfraLine[]; ignored: string[] } {
  const lines: InfraLine[] = [], ignored: string[] = [];
  const push = (key: string, label: string, plan: unknown, amount: unknown) => {
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) lines.push({ key, label, plan: typeof plan === 'string' ? plan : null, usd_month: cents(amount) / 100 });
    else ignored.push(label || key);
  };
  if (Array.isArray(value)) {
    for (const v of value as any[]) {
      const label = String(v?.label ?? v?.name ?? v?.key ?? '');
      push(String(v?.key ?? slug(label)), label, v?.plan, v?.usd_month ?? v?.usd ?? v?.amount);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (typeof v === 'number') push(slug(k), k, null, v);
      else push(slug(k), String(v?.label ?? k), v?.plan, v?.usd_month ?? v?.usd ?? v?.amount);
    }
  }
  return { lines, ignored };
}

export async function infrastructure(db: Db): Promise<{ lines: InfraLine[]; total_usd: number; ceiling_usd: number; source: 'settings' | 'default'; ignored: string[] }> {
  const row = (await db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'infra_costs'")).rows[0];
  const parsed = row ? parseInfra(row.value) : { lines: DEFAULT_INFRA, ignored: [] as string[] };
  const total = parsed.lines.reduce((n, l) => n + cents(l.usd_month), 0) / 100;
  return { lines: parsed.lines, total_usd: total, ceiling_usd: INFRA_CEILING_USD, source: row ? 'settings' : 'default', ignored: parsed.ignored };
}

export async function budgets(db: Db): Promise<Record<string, number>> {
  const row = (await db.query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'budgets'")).rows[0];
  const out: Record<string, number> = {};
  if (row?.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
    for (const [k, v] of Object.entries(row.value as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

/* ── token usage ────────────────────────────────────────────────────── */

interface Row { at: Date; feature: FeatureId; input: number; cached: number; output: number; micro: number; priced: boolean }
const int = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

async function usageRows(db: Db, from: Date, to: Date): Promise<Row[]> {
  const rows = (await db.query<any>(
    `SELECT at, action, tokens_in, tokens_cached, tokens_out, cost_usd::text AS cost_usd, detail->>'model' AS model, detail->>'batch' AS batch,
            detail->>'tokens_in' AS d_in, detail->>'tokens_cached' AS d_cached, detail->>'tokens_out' AS d_out
       FROM audit_events
      WHERE at >= $1 AND at < $2
        AND (tokens_in IS NOT NULL OR tokens_cached IS NOT NULL OR tokens_out IS NOT NULL OR cost_usd IS NOT NULL OR detail->>'tokens_in' IS NOT NULL OR detail->>'tokens_out' IS NOT NULL)
      ORDER BY at, id`, [from.toISOString(), to.toISOString()])).rows;
  return rows.map((r) => {
    const u = { input: int(r.tokens_in ?? r.d_in), cached: int(r.tokens_cached ?? r.d_cached), output: int(r.tokens_out ?? r.d_out) };
    let cost: number | undefined = r.cost_usd != null ? Math.round(Number(r.cost_usd) * 1e5) / 1e5 : costOf(r.model ?? DEFAULT_MODEL, u, { batch: r.batch === 'true' });
    const priced = cost !== undefined;
    if (cost === undefined) cost = 0;
    return { at: new Date(r.at), feature: featureOf(r.action), ...u, micro: Math.round(cost * 1e5), priced };
  });
}

const usd = (micro: number) => micro / 1e5;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
/** Monday 00:00 UTC of the week containing d. */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

interface Acc { calls: number; input: number; cached: number; output: number; micro: number }
const zero = (): Acc => ({ calls: 0, input: 0, cached: 0, output: 0, micro: 0 });
const bump = (a: Acc, r: Row) => { a.calls++; a.input += r.input; a.cached += r.cached; a.output += r.output; a.micro += r.micro; };
const hitRate = (a: { input: number; cached: number }) => (a.input + a.cached ? Math.round((a.cached / (a.input + a.cached)) * 1000) / 1000 : null);

export interface FeatureCost { feature: FeatureId; label: string; calls: number; tokens_in: number; tokens_cached: number; tokens_out: number; cost_usd: number; cache_hit_rate: number | null; budget_usd: number | null }
export interface WeekCost { week: string; calls: number; tokens_in: number; tokens_cached: number; tokens_out: number; cost_usd: number; by_feature: Record<string, number> }
export interface BudgetAlert { feature: FeatureId; label: string; month: string; budget_usd: number; spent_usd: number; pct: number; level: 'exceeded' | 'warning' }
export interface CostReport {
  from: string; to: string; currency: 'USD';
  llm: { calls: number; tokens_in: number; tokens_cached: number; tokens_out: number; cost_usd: number; cache_hit_rate: number | null; unpriced_calls: number };
  features: FeatureCost[]; weekly: WeekCost[];
  infrastructure: Awaited<ReturnType<typeof infrastructure>>;
  total_usd: number;
  budgets: Record<string, number>; budget_month: string; alerts: BudgetAlert[];
}

/**
 * Cost between two dates, both inclusive (YYYY-MM-DD, UTC). Budget alerts always look at the calendar month of `to`
 * (month to date when `to` is today), whatever `from` is.
 */
export async function costReport(db: Db, from: string, to: string): Promise<CostReport> {
  const fromTs = new Date(`${from}T00:00:00.000Z`);
  const toDay = new Date(`${to}T00:00:00.000Z`);
  const toTs = new Date(toDay.getTime() + 864e5);
  const rows = await usageRows(db, fromTs, toTs);

  const all = zero(), by = new Map<FeatureId, Acc>();
  const weeks = new Map<string, { acc: Acc; by: Map<string, number> }>();
  let unpriced = 0;
  for (const r of rows) {
    bump(all, r); if (!r.priced) unpriced++;
    bump(by.get(r.feature) ?? by.set(r.feature, zero()).get(r.feature)!, r);
    const wk = ymd(weekStart(r.at));
    const w = weeks.get(wk) ?? weeks.set(wk, { acc: zero(), by: new Map() }).get(wk)!;
    bump(w.acc, r); w.by.set(r.feature, (w.by.get(r.feature) ?? 0) + r.micro);
  }
  const bud = await budgets(db);
  const ids: FeatureId[] = [...FEATURES, ...(by.has('other') ? ['other' as const] : [])];
  const features: FeatureCost[] = ids.map((f) => {
    const a = by.get(f) ?? zero();
    return { feature: f, label: FEATURE_LABELS[f], calls: a.calls, tokens_in: a.input, tokens_cached: a.cached, tokens_out: a.output, cost_usd: usd(a.micro), cache_hit_rate: hitRate(a), budget_usd: bud[f] ?? null };
  });

  // Every week from the first to the last, so the series has no holes.
  const weekly: WeekCost[] = [];
  for (let d = weekStart(fromTs); d <= toDay; d = new Date(d.getTime() + 7 * 864e5)) {
    const k = ymd(d), w = weeks.get(k);
    weekly.push({ week: k, calls: w?.acc.calls ?? 0, tokens_in: w?.acc.input ?? 0, tokens_cached: w?.acc.cached ?? 0, tokens_out: w?.acc.output ?? 0, cost_usd: usd(w?.acc.micro ?? 0),
      by_feature: Object.fromEntries([...(w?.by ?? new Map<string, number>())].map(([f, m]) => [f, usd(m)])) });
  }

  // Budget alerts: the calendar month of `to`.
  const mStart = monthStart(toDay), mEnd = nextMonth(toDay);
  const monthRows = Object.keys(bud).length ? await usageRows(db, mStart, mEnd) : [];
  const spent = new Map<string, number>();
  for (const r of monthRows) spent.set(r.feature, (spent.get(r.feature) ?? 0) + r.micro);
  const alerts: BudgetAlert[] = [];
  for (const [f, budget] of Object.entries(bud)) {
    const s = usd(spent.get(f) ?? 0);
    if (budget > 0 ? s < budget * BUDGET_WARN_AT : s <= 0) continue;
    alerts.push({ feature: f as FeatureId, label: FEATURE_LABELS[f as FeatureId] ?? f, month: ymd(mStart).slice(0, 7), budget_usd: budget, spent_usd: s, pct: budget > 0 ? Math.round((s / budget) * 1000) / 10 : 100, level: s > budget ? 'exceeded' : 'warning' });
  }
  alerts.sort((a, b) => Number(b.level === 'exceeded') - Number(a.level === 'exceeded') || b.pct - a.pct || a.feature.localeCompare(b.feature));

  const infra = await infrastructure(db);
  return {
    from, to, currency: 'USD',
    llm: { calls: all.calls, tokens_in: all.input, tokens_cached: all.cached, tokens_out: all.output, cost_usd: usd(all.micro), cache_hit_rate: hitRate(all), unpriced_calls: unpriced },
    features, weekly, infrastructure: infra,
    total_usd: (all.micro + Math.round(infra.total_usd * 1e5)) / 1e5,
    budgets: bud, budget_month: ymd(mStart).slice(0, 7), alerts,
  };
}
