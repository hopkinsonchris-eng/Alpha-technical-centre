/**
 * The one brake in front of every model call (6 Oct 2026: a backlog of unrecorded ingest calls spent an account's
 * credit in a quarter of an hour; the only thing that stopped it was the balance reaching zero).
 *
 * `installSpendGuard(db)` is called by openDb, so the API server and every cron carry it. AnthropicProvider asks
 * `assertBudget()` before each call and `recordCall()` after: the day's spend is the cost ledger (audit_events rows
 * with tokens or cost, priced as the Cost page prices them) plus every call this process has made since the ledger
 * was last read, so a call site that records no row still counts. When the day's spend reaches
 * VAULT_DAILY_BUDGET_GBP (default £10) every call refuses with BudgetExceeded until 00:00 UTC or a higher cap.
 * A call with a `purpose` is written to the ledger as action `llm.<purpose>` (the Cost page's features), so the
 * ingest, research and briefs, which recorded nothing, now show.
 */
import type { Db } from '../db/client.ts';
import { costOf, DEFAULT_MODEL } from '../prices.ts';
import type { LlmUsage } from './provider.ts';

export const USD_PER_GBP = 1.28;
export const DEFAULT_DAILY_BUDGET_GBP = 10;
/** Anthropic's web search tool: $10 per 1,000 searches on top of the tokens. */
export const USD_PER_WEB_SEARCH = 0.01;
const LEDGER_REFRESH_MS = 30_000;

export class BudgetExceeded extends Error {
  override name = 'BudgetExceeded';
  constructor(public readonly spentGbp: number, public readonly capGbp: number) {
    super(`model budget spent today: £${spentGbp.toFixed(2)} of £${capGbp} (VAULT_DAILY_BUDGET_GBP); calls resume at 00:00 UTC or when the cap is raised`);
  }
}

export interface SpendToday { today_gbp: number; cap_gbp: number; exhausted: boolean; as_of: string; /** what the ledger holds for the day */ ledger_gbp: number; /** calls this process made since the ledger was read (some record no row) */ unflushed_gbp: number }

interface Guard { db: Db; capGbp: number; clock: () => number; refreshMs: number; ledgerUsd: number; ledgerAt: number; ledgerDay: string; sinceLedgerUsd: number; processUsd: number; warned: boolean }
let guard: Guard | null = null;

export function dailyBudgetGbp(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.VAULT_DAILY_BUDGET_GBP);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_BUDGET_GBP;
}

export function installSpendGuard(db: Db, opts: { env?: NodeJS.ProcessEnv; clock?: () => number; refreshMs?: number } = {}): void {
  guard = { db, capGbp: dailyBudgetGbp(opts.env ?? process.env), clock: opts.clock ?? Date.now, refreshMs: opts.refreshMs ?? LEDGER_REFRESH_MS, ledgerUsd: 0, ledgerAt: -Infinity, ledgerDay: '', sinceLedgerUsd: 0, processUsd: 0, warned: false };
}
/** Tests. */
export function uninstallSpendGuard(): void { guard = null; }
export const spendGuardInstalled = () => guard !== null;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day's ledger in USD, re-read every `refreshMs` and at the turn of the UTC day; a failed read keeps the last answer. */
async function ledgerUsd(g: Guard): Promise<number> {
  const now = g.clock(), day = dayOf(now);
  if (day === g.ledgerDay && now - g.ledgerAt < g.refreshMs) return g.ledgerUsd;
  try {
    const rows = (await g.db.query<{ tokens_in: number | null; tokens_cached: number | null; tokens_out: number | null; cost_usd: string | null; model: string | null; batch: string | null; d_in: string | null; d_cached: string | null; d_out: string | null }>(
      `SELECT tokens_in, tokens_cached, tokens_out, cost_usd::text AS cost_usd, detail->>'model' AS model, detail->>'batch' AS batch,
              detail->>'tokens_in' AS d_in, detail->>'tokens_cached' AS d_cached, detail->>'tokens_out' AS d_out
         FROM audit_events
        WHERE at >= $1
          AND (tokens_in IS NOT NULL OR tokens_cached IS NOT NULL OR tokens_out IS NOT NULL OR cost_usd IS NOT NULL OR detail->>'tokens_in' IS NOT NULL OR detail->>'tokens_out' IS NOT NULL)`,
      [`${day}T00:00:00.000Z`])).rows;
    const int = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0; };
    let usd = 0;
    for (const r of rows) {
      const u = { input: int(r.tokens_in ?? r.d_in), cached: int(r.tokens_cached ?? r.d_cached), output: int(r.tokens_out ?? r.d_out) };
      usd += r.cost_usd != null ? Number(r.cost_usd) : (costOf(r.model ?? DEFAULT_MODEL, u, { batch: r.batch === 'true' }) ?? costOf(DEFAULT_MODEL, u) ?? 0);
    }
    if (day !== g.ledgerDay) g.processUsd = g.processUsd; // the process meter is per process, not per day
    g.ledgerUsd = usd; g.ledgerAt = now; g.ledgerDay = day; g.sinceLedgerUsd = 0;
  } catch (e) {
    if (!g.warned) { console.warn(`spend guard: the ledger could not be read (${(e as Error).message}); counting this process's calls only`); g.warned = true; }
    g.ledgerAt = now; g.ledgerDay = day;
  }
  return g.ledgerUsd;
}

export async function spendToday(): Promise<SpendToday | null> {
  if (!guard) return null;
  const l = await ledgerUsd(guard);
  const usd = l + guard.sinceLedgerUsd;
  const today_gbp = Math.round((usd / USD_PER_GBP) * 10000) / 10000;
  return { today_gbp, cap_gbp: guard.capGbp, exhausted: today_gbp >= guard.capGbp, as_of: new Date(guard.clock()).toISOString(), ledger_gbp: Math.round((l / USD_PER_GBP) * 10000) / 10000, unflushed_gbp: Math.round((guard.sinceLedgerUsd / USD_PER_GBP) * 10000) / 10000 };
}

/** Throws BudgetExceeded when the day's spend has reached the cap. No guard (a test without openDb): no limit. */
export async function assertBudget(): Promise<void> {
  const s = await spendToday();
  if (s && s.exhausted) throw new BudgetExceeded(s.today_gbp, s.cap_gbp);
}

export interface CallRecord { model: string; usage: LlmUsage; searches?: number; /** `llm.<purpose>` becomes the ledger action; absent when the caller writes its own row */ purpose?: string; by?: string; scope?: string; refs?: string[]; detail?: Record<string, unknown> }

/** Counts the call in this process and, when it carries a purpose, writes it to the ledger. */
export async function recordCall(c: CallRecord): Promise<void> {
  if (!guard) return;
  const usd = (costOf(c.model, c.usage) ?? costOf(DEFAULT_MODEL, c.usage) ?? 0) + (c.searches ?? 0) * USD_PER_WEB_SEARCH;
  guard.sinceLedgerUsd += usd; guard.processUsd += usd;
  if (!c.purpose) return;
  try {
    await guard.db.query(
      `INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out, cost_usd) VALUES ($1,$2,$3,$4::text[],$5::jsonb,$6,$7,$8,$9)`,
      [c.by ?? 'system', `llm.${c.purpose}`, c.scope ?? 'firm', c.refs ?? [], JSON.stringify({ model: c.model, ...(c.searches ? { searches: c.searches } : {}), ...(c.detail ?? {}) }), c.usage.input, c.usage.cached, c.usage.output, Math.round(usd * 1e5) / 1e5]);
  } catch (e) {
    if (!guard.warned) { console.warn(`spend guard: a ledger row could not be written (${(e as Error).message})`); guard.warned = true; }
  }
}

/** Pounds this process has spent since it started (the per-run caps of the crons read it). */
export function processSpendGbp(): number { return guard ? Math.round((guard.processUsd / USD_PER_GBP) * 10000) / 10000 : 0; }
