/**
 * A research run (wave 4, docs/vault-hub/wave4/05-markup.md §1.4). For one project: build the
 * queries from its own names, ask World Monitor (GDELT documents, company enrichment and signals,
 * SEC filings, the intelligence timeline where the plan allows) and the Vault's miners
 * (literature per field and operator), file every finding as a cited public note, open
 * proposals, and stop at the wall-clock or spend cap with a summary that says what was not
 * reached. Runs are rows in `jobs` (name 'research'); one open run per project; a trigger on
 * a queued run extends it. `RESEARCH_ENABLED=false` switches everything off.
 */
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { openProvider } from '../llm/provider.ts';
import { openStorage, type Storage } from '../storage.ts';
import { audit } from '../audit.ts';
import { countryName } from '../opportunities.ts';
import { runMiners, type RunSummary as MinerSummary } from '../miners/run.ts';
import type { FeedAdapter } from '../miners/types.ts';
import type { Clock } from '../miners/util.ts';
import { companyEnrichment, companySignals, gdeltDocuments, intelTimeline, secFilings, worldMonitorConfigured } from '../intel/worldmonitor.ts';
import { buildQueries, type ResearchField, type ResearchProject, type ResearchQueries } from './queries.ts';
import { fileFinding, proposeFromFinding, readFacts, type Finding } from './findings.ts';

export interface ResearchOptions {
  now?: () => Date; storage?: Storage; provider?: LlmProvider | null; fetch?: typeof fetch; clock?: Clock;
  budgetMs?: number; budgetGbp?: number; minerAdapters?: FeedAdapter[]; skipMiners?: boolean; skipWorldMonitor?: boolean; by?: string;
  /** Ask the model for facts on at most this many findings per run (the spend cap applies too). */
  maxFactReads?: number;
}
export interface SourceCount { queries: number; findings: number; created: number; updated: number; unchanged: number; error?: string; skipped?: string }
export interface NotReached { source: string; query: string; reason: string }
export interface ResearchSummary {
  project_id: string; status: 'ok' | 'failed' | 'stopped'; started_at: string; finished_at: string | null; duration_ms: number;
  sources: Record<string, SourceCount>; findings: number; proposals: { asset: number; research: number }; fact_reads: number;
  spend_gbp: number; budget: { ms: number; gbp: number }; not_reached: NotReached[]; stopped_by: 'time' | 'spend' | null; warnings: string[]; queued?: boolean; names?: string[];
}

export const RESEARCH_DISABLED = 'research runs are switched off (RESEARCH_ENABLED=false on the Vault service)';
export function researchEnabled(env = process.env): boolean { return !/^(false|0|off)$/i.test(env.RESEARCH_ENABLED ?? ''); }
const budgetMsOf = (env = process.env) => Math.max(60_000, Number(env.RESEARCH_BUDGET_MINUTES ?? 15) * 60_000);
const budgetGbpOf = (env = process.env) => Math.max(0.1, Number(env.RESEARCH_BUDGET_GBP ?? 3));
/** USD per million tokens, input and output, by model family; the firm's default is Sonnet. */
const PRICES: [RegExp, [number, number]][] = [[/fable|mythos/i, [10, 50]], [/opus/i, [4, 20]], [/haiku/i, [1, 5]], [/sonnet/i, [2, 10]]];
const USD_PER_GBP = 1.28;
export function costGbp(model: string, usage: { input: number; cached: number; output: number }): number {
  const [i, o] = (PRICES.find(([re]) => re.test(model)) ?? [null, [2, 10]])[1];
  const usd = ((usage.input - usage.cached) * i + usage.cached * i * 0.1 + usage.output * o) / 1_000_000;
  return Math.round((usd / USD_PER_GBP) * 10000) / 10000;
}

/* ── queue ───────────────────────────────────────────────────────────── */

/**
 * Queues a run for the project, or extends the queued one with more names. Returns the job id
 * and whether it was new; `running` when a run is in progress (the caller answers 409).
 */
export async function enqueueResearch(db: Db, projectId: string, by: string, names: string[] = []): Promise<{ job_id: number; state: 'queued' | 'extended' | 'running' }> {
  const open = (await db.query<{ id: number; summary: any }>("SELECT id, summary FROM jobs WHERE name = 'research' AND status = 'running' AND summary->>'project_id' = $1 ORDER BY id DESC LIMIT 1", [projectId])).rows[0];
  if (open) {
    if (open.summary?.queued) {
      const merged = [...new Set([...(open.summary.names ?? []), ...names])];
      await db.query('UPDATE jobs SET summary = summary || $2::jsonb WHERE id = $1', [open.id, JSON.stringify({ names: merged, requested_by: by })]);
      return { job_id: open.id, state: 'extended' };
    }
    return { job_id: open.id, state: 'running' };
  }
  const row = (await db.query<{ id: number }>("INSERT INTO jobs (name, status, summary) VALUES ('research', 'running', $1::jsonb) RETURNING id", [JSON.stringify({ project_id: projectId, queued: true, names, requested_by: by })])).rows[0];
  return { job_id: row.id, state: 'queued' };
}

/** Runs every queued job, oldest first; a job that has been running without finishing for over 20 minutes is marked failed and re-queued once. */
export async function runQueued(db: Db, opts: ResearchOptions = {}): Promise<ResearchSummary[]> {
  const out: ResearchSummary[] = [];
  const stuck = (await db.query<{ id: number; summary: any }>("SELECT id, summary FROM jobs WHERE name = 'research' AND status = 'running' AND (summary->>'queued') IS DISTINCT FROM 'true' AND started_at < now() - interval '20 minutes'")).rows;
  for (const s of stuck) {
    await db.query("UPDATE jobs SET status = 'failed', finished_at = now(), summary = summary || '{\"error\":\"did not finish within 20 minutes\"}'::jsonb WHERE id = $1", [s.id]);
    if (!s.summary?.requeued) await db.query("INSERT INTO jobs (name, status, summary) VALUES ('research', 'running', $1::jsonb)", [JSON.stringify({ project_id: s.summary.project_id, queued: true, names: s.summary.names ?? [], requeued: true })]);
  }
  const queued = (await db.query<{ id: number; summary: any }>("SELECT id, summary FROM jobs WHERE name = 'research' AND status = 'running' AND summary->>'queued' = 'true' ORDER BY id")).rows;
  for (const q of queued) out.push(await runResearch(db, q.summary.project_id, { ...opts, by: opts.by ?? q.summary.requested_by ?? 'research' }, q.id));
  return out;
}

let inProcess: Promise<unknown> | null = null;
/** The API server runs queued jobs in the background right away (one at a time); the cron picks up what a restart left. */
export function kickResearch(db: Db, opts: ResearchOptions = {}): void {
  if (inProcess) return;
  inProcess = runQueued(db, opts).catch(() => undefined).finally(() => { inProcess = null; });
}

/* ── the run ─────────────────────────────────────────────────────────── */

export async function runResearch(db: Db, projectId: string, opts: ResearchOptions = {}, jobId?: number): Promise<ResearchSummary> {
  const now = opts.now ?? (() => new Date());
  const started = now();
  const budget = { ms: opts.budgetMs ?? budgetMsOf(), gbp: opts.budgetGbp ?? budgetGbpOf() };
  const by = opts.by ?? 'research';
  const summary: ResearchSummary = { project_id: projectId, status: 'ok', started_at: started.toISOString(), finished_at: null, duration_ms: 0, sources: {}, findings: 0, proposals: { asset: 0, research: 0 }, fact_reads: 0, spend_gbp: 0, budget, not_reached: [], stopped_by: null, warnings: [] };
  const job = jobId ?? (await db.query<{ id: number }>("INSERT INTO jobs (name, status, summary) VALUES ('research', 'running', $1::jsonb) RETURNING id", [JSON.stringify({ project_id: projectId, queued: false })])).rows[0].id;
  await db.query('UPDATE jobs SET started_at = $2, summary = $3::jsonb WHERE id = $1', [job, started.toISOString(), JSON.stringify({ ...summary, queued: false })]);
  const touched: string[] = [];
  const elapsed = () => now().getTime() - started.getTime();
  const overTime = () => elapsed() >= budget.ms;
  const overSpend = () => summary.spend_gbp >= budget.gbp;
  const stop = (): 'time' | 'spend' | null => (overTime() ? 'time' : overSpend() ? 'spend' : null);
  const count = (s: string): SourceCount => (summary.sources[s] ??= { queries: 0, findings: 0, created: 0, updated: 0, unchanged: 0 });
  const progress = async () => { summary.duration_ms = elapsed(); await db.query('UPDATE jobs SET summary = $2::jsonb WHERE id = $1', [job, JSON.stringify({ ...summary, queued: false })]); };

  try {
    const p = (await db.query<any>('SELECT p.id, p.name, p.country, p.asset_ids, p.register, o.name AS client_name FROM projects p LEFT JOIN organisations o ON o.id = p.client_id WHERE p.id = $1', [projectId])).rows[0];
    if (!p) throw new Error(`project "${projectId}" not found`);
    const fields: ResearchField[] = p.asset_ids?.length ? (await db.query<any>('SELECT id, name, kind, country, operator, props FROM assets WHERE id = ANY($1::text[])', [p.asset_ids])).rows : [];
    const project: ResearchProject = { id: p.id, name: p.name, country: p.country ?? null, client_name: p.client_name ?? null, register: p.register ?? null };
    const q: ResearchQueries = buildQueries(project, fields, p.country ? countryName(p.country).en : null);
    const provider = opts.provider === undefined ? openProvider() : opts.provider;
    const maxReads = opts.maxFactReads ?? 40;
    const scope = { id: p.id, country: p.country ?? null, asset_ids: p.asset_ids ?? [] };

    const file = async (source: string, f: Finding) => {
      const c = count(source);
      c.findings++;
      const r = await fileFinding(db, projectId, f, by, now());
      c[r.status]++;
      if (r.status === 'unchanged') return;
      summary.findings++;
      touched.push(`doc:${r.id}`);
      // Proposals: fields named (no model), and the stated facts (one low-effort read, within the spend cap).
      let facts: Awaited<ReturnType<typeof readFacts>>['facts'] = [];
      if (provider && summary.fact_reads < maxReads && !overSpend() && f.text.length > 40) {
        try {
          const rf = await readFacts(`${f.title}\n\n${f.text}`, provider);
          summary.fact_reads++; summary.spend_gbp = Math.round((summary.spend_gbp + costGbp(rf.model, rf.usage)) * 10000) / 10000; facts = rf.facts;
        } catch (e) { summary.warnings.push(`facts: ${(e as Error).message}`); }
      }
      const pr = await proposeFromFinding(db, scope, { id: r.id, title: f.title }, `${f.title}\n\n${f.text}`, facts);
      summary.proposals.asset += pr.asset.length; summary.proposals.research += pr.research.length;
    };

    // 1. World Monitor.
    if (!opts.skipWorldMonitor && worldMonitorConfigured()) {
      for (const g of q.gdelt) {
        const s = stop(); if (s) { summary.not_reached.push({ source: 'gdelt', query: g.query, reason: s }); continue; }
        count('gdelt').queries++;
        const r = await gdeltDocuments(g.query, { maxRecords: 25, timespan: '1y' });
        if (!r.ok) { count('gdelt').error = r.reason; summary.not_reached.push({ source: 'gdelt', query: g.query, reason: r.reason }); continue; }
        for (const a of r.data) await file('gdelt', { source: 'gdelt', external_id: `gdelt:${a.url}`, url: a.url, title: a.title, text: a.title + (a.source ? ` (${a.source})` : ''), published_at: a.date, authors: [], query: g.query, asset_ids: g.field_id ? [g.field_id] : [] });
        await progress();
      }
      for (const c of q.companies) {
        const s = stop(); if (s) { summary.not_reached.push({ source: 'company', query: c, reason: s }); continue; }
        count('company').queries++;
        const [en, sg, sf] = await Promise.all([companyEnrichment(c), companySignals(c), secFilings(c, { limit: 10 })]);
        if (en.ok && en.data.name) await file('company-enrichment', { source: 'company-enrichment', external_id: `enrichment:${c.toLowerCase()}`, url: en.data.website, title: `${en.data.name}: company profile`, text: [en.data.description, en.data.location, en.data.industry, en.data.ticker ? `ticker ${en.data.ticker}` : null, en.data.cik ? `CIK ${en.data.cik}` : null].filter(Boolean).join('. '), published_at: en.fetched_at, authors: [], query: c, asset_ids: [], facts: { profile: en.data } });
        else if (!en.ok) count('company').error = en.reason;
        if (sg.ok) for (const x of sg.data) await file('company-signals', { source: 'company-signals', external_id: `signal:${x.url ?? x.title}`, url: x.url, title: x.title, text: `${x.title}${x.type ? ' (' + x.type + ')' : ''}${x.source ? ' — ' + x.source : ''}`, published_at: x.at, authors: [], query: c, asset_ids: [], facts: { signal_type: x.type, strength: x.strength } });
        if (sf.ok) for (const x of sf.data) await file('sec-filings', { source: 'sec-filings', external_id: `sec:${x.accession ?? x.url}`, url: x.url, title: `${x.company} ${x.form} ${x.file_date ?? ''}`.trim(), text: `${x.company} filed form ${x.form}${x.file_date ? ' on ' + x.file_date : ''}${x.items.length ? ': ' + x.items.join('; ') : ''}`, published_at: x.file_date, authors: [], query: c, asset_ids: [], facts: { form: x.form, cik: x.cik } });
        else if (sf.pro) count('company').skipped = sf.reason;
        await progress();
      }
      if (q.country) {
        const s = stop();
        if (s) summary.not_reached.push({ source: 'intel-timeline', query: q.country, reason: s });
        else {
          count('intel-timeline').queries++;
          const r = await intelTimeline(q.country, 40);
          if (r.ok) for (const x of r.data) await file('intel-timeline', { source: 'intel-timeline', external_id: `intel:${x.id}`, url: x.url, title: x.title, text: x.summary ?? x.title, published_at: x.occurred_at, authors: [], query: q.country, asset_ids: [], facts: { domain: x.domain, category: x.category } });
          else count('intel-timeline').skipped = r.reason;
        }
      }
    } else if (!opts.skipWorldMonitor) summary.warnings.push('World Monitor not connected: GDELT, company and filing searches skipped');

    // 2. The miners: literature per field and operator, scoped to the project.
    if (!opts.skipMiners && q.literature.length) {
      const s = stop();
      if (s) summary.not_reached.push({ source: 'literature', query: q.literature.map(t => t.query).join(' | '), reason: s });
      else {
        count('literature').queries += q.literature.length;
        const since = new Date(started.getTime() - 5 * 365 * 86_400_000);
        try {
          const m: MinerSummary = await runMiners(db, { now: started, since, only: ['openalex', 'crossref', 'semantic-scholar'], force: true, storage: opts.storage, fetch: opts.fetch, adapters: opts.minerAdapters, clock: opts.clock ?? (opts.now ? { now: () => now().getTime(), sleep: async () => {} } : undefined),
            config: { topics: q.literature, negative: ['retracted', 'erratum'], sec_issuers: [], lookback_days: { weekly: 8, monthly: 40 }, sources: { openalex: { enabled: true }, crossref: { enabled: true }, 'semantic-scholar': { enabled: true } } } as any,
            projectId, queryOf: (topicId) => q.literature.find(t => t.id === topicId)?.query ?? null, budgetUntil: new Date(started.getTime() + budget.ms) });
          const c = count('literature');
          c.findings += Object.values(m.adapters).reduce((n, a) => n + a.fetched, 0); c.created += m.created; c.updated += m.updated; c.unchanged += m.unchanged;
          summary.findings += m.created + m.updated;
          for (const w of m.warnings) summary.warnings.push(`literature: ${w}`);
          if (m.stopped) summary.not_reached.push({ source: 'literature', query: m.stopped, reason: 'time' });
        } catch (e) { count('literature').error = (e as Error).message; }
      }
    }

    summary.stopped_by = summary.not_reached.some(n => n.reason === 'time') ? 'time' : summary.not_reached.some(n => n.reason === 'spend') ? 'spend' : null;
    summary.status = summary.stopped_by ? 'stopped' : 'ok';
  } catch (e) {
    summary.status = 'failed'; summary.warnings.push((e as Error).message);
  }
  summary.finished_at = now().toISOString(); summary.duration_ms = elapsed();
  await db.query('UPDATE jobs SET finished_at = $2, status = $3, summary = $4::jsonb WHERE id = $1', [job, summary.finished_at, summary.status === 'failed' ? 'failed' : 'ok', JSON.stringify({ ...summary, queued: false })]);
  await audit(db, by, 'research.run', `project:${projectId}`, [`project:${projectId}`, ...touched.slice(0, 200)], { findings: summary.findings, proposals: summary.proposals, status: summary.status, stopped_by: summary.stopped_by, spend_gbp: summary.spend_gbp, duration_ms: summary.duration_ms });
  return summary;
}

/** The last runs and the findings for a project, for GET /api/projects/:id/research. */
export async function researchView(db: Db, projectId: string, limit = 5) {
  const runs = (await db.query<any>("SELECT id, status, started_at, finished_at, summary FROM jobs WHERE name = 'research' AND summary->>'project_id' = $1 ORDER BY id DESC LIMIT $2", [projectId, limit])).rows
    .map(r => ({ id: r.id, status: r.summary?.queued ? 'queued' : r.status === 'running' ? 'running' : r.summary?.status ?? r.status, started_at: r.started_at, finished_at: r.finished_at, summary: r.summary }));
  const items = (await db.query<any>(
    `SELECT id, type, title, authored_at, created_at, legal_tag, origin, extracted, asset_ids, version FROM items
      WHERE project_id = $1 AND NOT hidden AND (extracted->>'kind' = 'research' OR (origin ? 'query' AND type = 'paper'))
      ORDER BY coalesce(authored_at, created_at) DESC LIMIT 500`, [projectId])).rows;
  const findings = items.map(i => ({
    id: i.id, type: i.type, title: i.title, date: i.authored_at ?? i.created_at, source: i.extracted?.source ?? i.origin?.source ?? 'literature', url: i.extracted?.url ?? i.origin?.url ?? null,
    query: i.extracted?.query ?? i.origin?.query ?? null, quote: i.extracted?.quote ?? i.extracted?.abstract ?? null, asset_ids: i.asset_ids ?? [], legal_tag: i.legal_tag, version: i.version,
  }));
  return { project_id: projectId, runs, findings };
}
