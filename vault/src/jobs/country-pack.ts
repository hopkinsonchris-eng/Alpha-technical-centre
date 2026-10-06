/**
 * The country-pack job (wave 7 PR4, docs/vault-hub/wave7/05-markup.md §1.8; 04-step-changes.md P1 "How a pack is
 * built"). One build per country: resolve the registry's sources for it, fetch each server-side, file every payload
 * as a dated original under project 'firm' (an unchanged payload writes nothing), record per source what was read,
 * then hand the stored originals to the drafting hook (PR5, vault/src/llm/country-pack.ts) section by section. The
 * hook is loaded lazily and defaults to L's draftSectionsWithSummary when it exists; without it, or when it leaves a
 * section unwritten, the section is written honestly as 'empty' with its sources, so the pack shows what was fetched.
 * Builds are rows in `jobs` (name 'country-pack'); one open build per country; a build that never wrote its summary
 * is reaped on read like a research run. The pack is public scope and never receives a client record: nothing here
 * reads a project's items, and the only input to the hook is what this job fetched from the registry.
 *   npx tsx src/jobs/country-pack.ts        (Render cron "atc-vault-country-pack", weekly; the API runs queued builds at once)
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { ensureBase } from '../db/seed.ts';
import { audit } from '../audit.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openEmbedder } from '../ingest/embed.ts';
import type { IngestDeps } from '../ingest/index.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { draftSectionsWithSummary, loadTerms, type DraftCtx, type DraftSummary, type PackSourceRef } from '../llm/country-pack.ts';
import { packQuality } from '../country/terms.ts';
import { countryRisk, worldMonitorConfigured } from '../intel/worldmonitor.ts';
import { isBlockedHost } from '../country/registry.ts';
import { createHash } from 'node:crypto';
import type { CountrySource } from '../country/types.ts';
import type { FetchOk } from '../country/fetch.ts';
import { isCountryCode } from '../opportunities.ts';
import type { Clock } from '../miners/util.ts';
import { reapAfterMs } from '../research/run.ts';
import { loadRegistry, sectionTtl, sourcesFor, ttlFor, type ResolvedCountry } from '../country/registry.ts';
import { fetchSource, HttpPool, type SourceAdapter } from '../country/fetch.ts';
import { storeOriginal } from '../country/store.ts';
import { packBudget, SECTIONS, SECTION_IDS, type CountryRegistry, type PackSectionBody, type PackSectionView, type PackStatus, type PackView, type SectionId } from '../country/types.ts';

export const JOB_NAME = 'country-pack';
const DAY = 86_400_000;
const EMPTY_BODY: PackSectionBody = { headline: null, sentences: [], questions: [], changed_since: [] };

/* ── the drafting contract (PR5, vault/src/llm/country-pack.ts): the job builds its DraftCtx exactly ───────────── */
export type { DraftCtx, DraftSummary, PackSourceRef };

/* ── shapes ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** What the job records per source, on the section row and in the hook's context: L's PackSourceRef plus the section and how the filing went. */
export interface PackSourceRecord extends PackSourceRef { section: SectionId; status?: 'created' | 'updated' | 'unchanged'; title?: string }
export interface SectionSources { section: SectionId; sources: PackSourceRecord[]; /** The stored originals' item ids. */ items: string[]; ttl_days: number }
export interface SectionCounts { sources: number; fetched: number; stored: number; unchanged: number; unreachable: number; /** reached, but the store refused to file it: the Vault's fault, counted apart */ unfiled: number }
export interface PackSummary {
  country: string; name: string; status: 'ok' | 'failed'; started_at: string; finished_at: string | null; duration_ms: number;
  sections: Record<SectionId, SectionCounts>; fetched: number; stored: number; unchanged: number; unreachable: number; unfiled: number; spend_gbp: number;
  budget_gbp: number; drafted: boolean; draft?: DraftSummary; warnings: string[]; note: string | null; error?: string; requested_by?: string; queued?: boolean;
  /** The web search step: pages the model's search cited, fetched by the job and filed as originals. */
  web?: WebSearchSummary;
  /** The World Monitor reading filed as an original for the risk section, or why not. */
  world_monitor?: string;
}

export interface WriteSectionInput {
  body: PackSectionBody; status: PackStatus; stale_reason?: string | null; model?: string | null; spend_gbp?: number | null;
  /** Override the sources and items recorded for the row (default: what this build fetched for the section). */
  sources?: PackSourceRecord[]; source_items?: string[];
}

/**
 * What the drafting hook receives after every source is fetched and filed: L's DraftCtx exactly, plus the stored
 * originals per section, the registry, a `writeSection` for a hook that writes rows through the job, and the running
 * summary. A hook may return L's DraftSummary; its spend is recorded on the job. Sections no hook writes are recorded
 * 'empty' with their sources by the job.
 */
export interface DraftContext extends DraftCtx {
  storage: Storage; name: string; registry: ResolvedCountry; sections: SectionSources[]; summary: PackSummary; spend: { gbp: number };
  writeSection: (section: SectionId, input: WriteSectionInput) => Promise<{ id: string; version: number }>;
  log: (line: string) => void;
}
export type DraftHook = (ctx: DraftContext) => Promise<DraftSummary | void>;

export interface FetchOptions {
  registry?: CountryRegistry; now?: () => Date; storage?: Storage; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: Clock;
  /** Chunk each original at once (the API server and tests); null leaves it to the ingest-sync cron. Default: open the embedder, or null when it refuses. */
  ingest?: IngestDeps | null;
  /** Regulator adapters by access kind or id (K's arcgis, ckan and csv adapters). */
  adapters?: Record<string, SourceAdapter>;
  maxBytes?: number; timeoutMs?: number; masterDir?: string;
}
export interface PackRunOptions extends FetchOptions {
  /** false skips the web search step (tests; PACK_WEB_SEARCH=false in the environment does the same). */ webSearch?: boolean;
  /** The drafting hook. Default: L's draftSectionsWithSummary when vault/src/llm/country-pack.ts exists; otherwise every section is written 'empty'. */
  draft?: DraftHook | null;
  /** The model provider for the hook: openProvider() when ANTHROPIC_API_KEY is set, else null (the drafter then writes honest rows). */
  provider?: LlmProvider | null;
  budgetGbp?: number; by?: string; log?: (line: string) => void; refresh?: boolean;
}

/* ── queue ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const assertCode = (country: string) => { if (!isCountryCode(country)) throw new Error(`"${country}" is not an ISO 3166-1 alpha-2 country code in capitals`); };

/** A build that started more than budget + grace ago and never wrote its summary is failed with the reason; returns the ids reaped. */
export async function reapStalePacks(db: Db, opts: { country?: string; now?: Date; afterMs?: number } = {}): Promise<number[]> {
  const now = opts.now ?? new Date();
  const afterMs = opts.afterMs ?? reapAfterMs();
  const minutes = Math.round(afterMs / 60_000);
  const stuck = (await db.query<{ id: number; summary: any }>(
    `SELECT id, summary FROM jobs WHERE name = $4 AND status = 'running' AND (summary->>'queued') IS DISTINCT FROM 'true'
       AND started_at < $1::timestamptz - make_interval(secs => $2) AND ($3::text IS NULL OR summary->>'country' = $3)`,
    [now.toISOString(), afterMs / 1000, opts.country ?? null, JOB_NAME])).rows;
  for (const s of stuck) {
    const reason = `did not finish within ${minutes} minutes`;
    const patch = { status: 'failed', reaped: true, error: reason, finished_at: now.toISOString(), warnings: [`reaped: ${reason}`, ...(Array.isArray(s.summary?.warnings) ? s.summary.warnings : [])] };
    await db.query("UPDATE jobs SET status = 'failed', finished_at = $2, summary = summary || $3::jsonb WHERE id = $1 AND status = 'running'", [s.id, now.toISOString(), JSON.stringify(patch)]);
  }
  return stuck.map(s => s.id);
}

/** Queues a build for the country, or returns the open one: 'queued' when it is waiting, 'running' when it is in progress. */
export async function enqueuePack(db: Db, country: string, by: string): Promise<{ job_id: number; state: 'queued' | 'running' }> {
  assertCode(country);
  await reapStalePacks(db, { country });
  const open = (await db.query<{ id: number; summary: any }>("SELECT id, summary FROM jobs WHERE name = $2 AND status = 'running' AND summary->>'country' = $1 ORDER BY id DESC LIMIT 1", [country, JOB_NAME])).rows[0];
  if (open) return { job_id: open.id, state: open.summary?.queued ? 'queued' : 'running' };
  const row = (await db.query<{ id: number }>("INSERT INTO jobs (name, status, summary) VALUES ($1, 'running', $2::jsonb) RETURNING id", [JOB_NAME, JSON.stringify({ country, queued: true, requested_by: by })])).rows[0];
  return { job_id: row.id, state: 'queued' };
}

/** Runs every queued build, oldest first; a build reaped past its budget is re-queued once. */
export async function runQueuedPacks(db: Db, opts: PackRunOptions = {}): Promise<PackSummary[]> {
  const out: PackSummary[] = [];
  const stuckIds = await reapStalePacks(db, { now: opts.now?.() });
  if (stuckIds.length) {
    const stuck = (await db.query<{ id: number; summary: any }>('SELECT id, summary FROM jobs WHERE id = ANY($1::bigint[])', [stuckIds])).rows;
    for (const s of stuck) if (!s.summary?.requeued && s.summary?.country) await db.query("INSERT INTO jobs (name, status, summary) VALUES ($1, 'running', $2::jsonb)", [JOB_NAME, JSON.stringify({ country: s.summary.country, queued: true, requested_by: s.summary.requested_by ?? null, requeued: true })]);
  }
  const queued = (await db.query<{ id: number; summary: any }>("SELECT id, summary FROM jobs WHERE name = $1 AND status = 'running' AND summary->>'queued' = 'true' ORDER BY id", [JOB_NAME])).rows;
  for (const q of queued) out.push(await runPack(db, q.summary.country, { ...opts, by: opts.by ?? q.summary.requested_by ?? JOB_NAME }, q.id));
  return out;
}

let inProcess: Promise<unknown> | null = null;
/** The API server runs queued builds in the background at once (one at a time); the cron picks up what a restart left. */
export function kickPacks(db: Db, opts: PackRunOptions = {}): void {
  if (inProcess) return;
  inProcess = runQueuedPacks(db, opts).catch(() => undefined).finally(() => { inProcess = null; });
}

/* ── section rows ────────────────────────────────────────────────────────────────────────────────────────────── */

export interface WriteRowInput extends WriteSectionInput { country: string; section: SectionId; ttl_days?: number; built_by: string; now: Date }

/** Writes the next version of a section row and marks the previous one superseded (never overwritten). */
export async function writePackSection(db: Db, input: WriteRowInput): Promise<{ id: string; version: number }> {
  const prev = (await db.query<{ id: string; version: number }>('SELECT id, version FROM country_packs WHERE country = $1 AND section = $2 ORDER BY version DESC LIMIT 1', [input.country, input.section])).rows[0];
  const version = (prev?.version ?? 0) + 1;
  const id = randomUUID();
  await db.query(
    `INSERT INTO country_packs (id, country, section, version, body, source_items, sources, ttl_days, status, stale_reason, built_at, built_by, model, spend_gbp)
     VALUES ($14, $1, $2, $3, $4::jsonb, $5::text[], $6::jsonb, $7, $8, $9, $10, $11, $12, $13)`,
    [input.country, input.section, version, JSON.stringify(input.body), input.source_items ?? [], JSON.stringify(input.sources ?? []), input.ttl_days ?? sectionTtl(input.section),
     input.status, input.stale_reason ?? null, input.now.toISOString(), input.built_by, input.model ?? null, input.spend_gbp ?? null, id]);
  if (prev) await db.query('UPDATE country_packs SET superseded_by = $2 WHERE id = $1 AND superseded_by IS NULL', [prev.id, id]);
  return { id, version };
}

/* ── fetch and file ──────────────────────────────────────────────────────────────────────────────────────────── */

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const emptyCounts = (): SectionCounts => ({ sources: 0, fetched: 0, stored: 0, unchanged: 0, unreachable: 0, unfiled: 0 });

export interface FetchedSections { sections: SectionSources[]; counts: Record<SectionId, SectionCounts>; fetched: number; stored: number; unchanged: number; unreachable: number; unfiled: number; warnings: string[]; touched: string[] }

/**
 * Fetches and files every registry source of the country for the sections wanted (all ten by default), before any
 * model call. Returns per section the sources as the drafter sees them and the stored originals' ids. This is what
 * the weekly refresh (PR5, vault/src/country/refresh.ts) calls through `packSourcesFetcher` to re-read a stale section.
 */
export async function fetchAndFile(db: Db, country: string, sections: SectionId[] = SECTION_IDS, opts: FetchOptions = {}, onProgress?: (running: FetchedSections) => Promise<void>): Promise<FetchedSections> {
  assertCode(country);
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const resolved = sourcesFor(opts.registry ?? loadRegistry(), country);
  const storage = opts.storage ?? openStorage();
  const warnings: string[] = [];
  const ingest = opts.ingest === undefined ? openIngestOrNull(env, warnings) : opts.ingest;
  const pool = new HttpPool({ fetch: opts.fetch, clock: opts.clock });
  const wanted = SECTION_IDS.filter(s => sections.includes(s));
  const per = new Map<SectionId, SectionSources>(wanted.map(s => [s, { section: s, sources: [], items: [], ttl_days: sectionTtl(s) }]));
  const counts = Object.fromEntries(wanted.map(s => [s, emptyCounts()])) as Record<SectionId, SectionCounts>;
  const out: FetchedSections = { sections: [...per.values()], counts, fetched: 0, stored: 0, unchanged: 0, unreachable: 0, unfiled: 0, warnings, touched: [] };
  await ensureBase(db);

  for (const src of resolved.sources) {
    const bucket = per.get(src.section);
    if (!bucket) continue;
    const c = counts[src.section];
    c.sources++;
    if (src.ttl_days && src.ttl_days < bucket.ttl_days) bucket.ttl_days = ttlFor(src);
    const rec: PackSourceRecord = { id: src.id, section: src.section, url: src.url, licence: src.licence, attribution: src.attribution, fetched_at: null, item_id: null, sha256: null, reachable: false, ...(src.note ? { note: src.note } : {}) };
    bucket.sources.push(rec);
    const r = await fetchSource(src, { country, name: resolved.name, fetch: opts.fetch, clock: opts.clock, now, env, pool, maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs, masterDir: opts.masterDir, adapters: opts.adapters, onWarn: m => warnings.push(m) });
    rec.url = r.url;
    if (r.unreachable) {
      c.unreachable++; out.unreachable++;
      rec.note = r.reason;
      warnings.push(`${src.id}: ${r.reason}`);
      // What arrived although the source is not usable (a CSV whose header changed) is filed so the change is on record, and never drafted from.
      if (r.partial) {
        try {
          const st = await storeOriginal(db, storage, src, r.partial, country, { now: now(), ingest });
          rec.item_id = st.id; rec.sha256 = st.sha256; rec.status = st.status;
          if (st.status === 'unchanged') { c.unchanged++; out.unchanged++; } else { c.stored++; out.stored++; out.touched.push(`doc:${st.id}`); }
        } catch (e) { warnings.push(`${src.id}: the partial payload could not be filed: ${(e as Error).message}`); }
      }
      if (onProgress) await onProgress(out);
      continue;
    }
    rec.fetched_at = r.fetched_at; rec.reachable = true; rec.title = r.title;
    if (r.edition) rec.attribution = src.attribution.replace(/\{year\}/g, String(r.edition));
    try {
      const st = await storeOriginal(db, storage, src, r, country, { now: now(), ingest });
      rec.item_id = st.id; rec.sha256 = st.sha256; rec.status = st.status;
      if (st.warning) warnings.push(`${src.id}: ${st.warning}`);
      if (!bucket.items.includes(st.id)) bucket.items.push(st.id);
      c.fetched++; out.fetched++;
      if (st.status === 'unchanged') { c.unchanged++; out.unchanged++; }
      else { c.stored++; out.stored++; out.touched.push(`doc:${st.id}`); }
    } catch (e) {
      // Reached, but the store refused it (a bucket that does not exist, a refused key): the Vault's fault, not the
      // publisher's. The chip keeps the fetch, carries the fault, and the section says what to fix.
      rec.fault = 'storage'; rec.item_id = null; rec.note = `could not be filed: ${(e as Error).message}`;
      c.unfiled++; out.unfiled++;
      warnings.push(`${src.id}: ${rec.note}`);
    }
    if (onProgress) await onProgress(out);
  }
  return out;
}

/**
 * The `opts.sources(country, sections)` the weekly refresh takes: re-fetches and files the sections' sources and
 * returns them in the drafter's shape, `{section, sources, ttl_days}[]`.
 */
export function packSourcesFetcher(db: Db, opts: FetchOptions = {}): (country: string, sections: SectionId[]) => Promise<{ section: SectionId; sources: PackSourceRef[]; ttl_days: number; items: string[] }[]> {
  return async (country, sections) => (await fetchAndFile(db, country, sections, opts)).sections;
}

/* ── the build ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** The default drafter: L's draftSectionsWithSummary (PR5), which writes honest 'due' rows (stale_reason 'no_provider') when the provider is null. */
const DEFAULT_DRAFT: DraftHook = (ctx) => draftSectionsWithSummary(ctx);

export async function runPack(db: Db, country: string, opts: PackRunOptions = {}, jobId?: number): Promise<PackSummary> {
  assertCode(country);
  const now = opts.now ?? (() => new Date());
  const started = now();
  const by = opts.by ?? JOB_NAME;
  const log = opts.log ?? ((line: string) => console.log(line));
  const env = opts.env ?? process.env;
  const registry = opts.registry ?? loadRegistry();
  const resolved = sourcesFor(registry, country);
  const budget = opts.budgetGbp ?? packBudget(env);
  const storage = opts.storage ?? openStorage();
  const sections = Object.fromEntries(SECTION_IDS.map(s => [s, emptyCounts()])) as Record<SectionId, SectionCounts>;
  const summary: PackSummary = { country, name: resolved.name, status: 'ok', started_at: started.toISOString(), finished_at: null, duration_ms: 0, sections, fetched: 0, stored: 0, unchanged: 0, unreachable: 0, unfiled: 0, spend_gbp: 0, budget_gbp: budget, drafted: false, warnings: [], note: resolved.note, requested_by: by, queued: false };
  await ensureBase(db);
  const job = jobId ?? (await db.query<{ id: number }>("INSERT INTO jobs (name, status, summary) VALUES ($1, 'running', $2::jsonb) RETURNING id", [JOB_NAME, JSON.stringify({ country, queued: false })])).rows[0].id;
  await db.query('UPDATE jobs SET started_at = $2, summary = $3::jsonb WHERE id = $1', [job, started.toISOString(), JSON.stringify(summary)]);
  const progress = async () => { summary.duration_ms = now().getTime() - started.getTime(); await db.query('UPDATE jobs SET summary = $2::jsonb WHERE id = $1', [job, JSON.stringify(summary)]); };
  let touched: string[] = [];
  let perSection: SectionSources[] = SECTION_IDS.map(s => ({ section: s, sources: [], items: [], ttl_days: sectionTtl(s) }));

  try {
    // 1. Fetch and file every source, before any drafting.
    const copyCounts = (f: FetchedSections) => { Object.assign(summary.sections, f.counts); summary.fetched = f.fetched; summary.stored = f.stored; summary.unchanged = f.unchanged; summary.unreachable = f.unreachable; summary.unfiled = f.unfiled; };
    const fetched = await fetchAndFile(db, country, SECTION_IDS, { ...opts, registry, storage, env, now }, async (f) => { copyCounts(f); await progress(); });
    copyCounts(fetched);
    summary.warnings.push(...fetched.warnings);
    touched = fetched.touched; perSection = fetched.sections;
    await progress();

    // 1b. The World Monitor reading, filed as an original so the risk section can cite it (pack rework).
    const ingest = opts.ingest === undefined ? openIngestOrNull(env, summary.warnings) : opts.ingest;
    summary.world_monitor = await fileWorldMonitor(db, storage, country, resolved.name, perSection, { now, ingest, onTouched: id => touched.push(`doc:${id}`) });
    await progress();
    // 1c. Web search: the model's search names pages, the job fetches and files them, the sections cite the stored copies (D67 kept: the model fetches nothing).
    const provider0 = opts.provider === undefined ? (env.ANTHROPIC_API_KEY || env.LLM_PROVIDER ? openProvider(env) : null) : opts.provider;
    if (opts.webSearch !== false && env.PACK_WEB_SEARCH !== 'false' && provider0?.search) {
      summary.web = await webSearchOriginals(db, storage, country, resolved.name, provider0, perSection, { ...opts, now, env, ingest, log, onTouched: id => touched.push(`doc:${id}`) });
      summary.warnings.push(...summary.web.skipped.map(x => `web: ${x}`));
      await progress();
    }

    // 2. Draft each section from the stored originals only (the hook), or record what was fetched.
    const before = new Map<SectionId, number>((await db.query<{ section: SectionId; v: number }>('SELECT section, max(version)::int AS v FROM country_packs WHERE country = $1 GROUP BY section', [country])).rows.map(r => [r.section, r.v]));
    const provider = provider0;
    const hook = opts.draft === undefined ? DEFAULT_DRAFT : opts.draft;
    const ctx: DraftContext = {
      db, storage, provider, country, jobId: job, by, now: now(), budgetGbp: budget, refresh: opts.refresh ?? false,
      name: resolved.name, registry: resolved, sections: perSection, summary, spend: { gbp: 0 }, log,
      writeSection: async (section, input) => {
        const s = perSection.find(x => x.section === section);
        if (!s) throw new Error(`unknown section "${section}"`);
        const r = await writePackSection(db, { ...input, country, section, ttl_days: s.ttl_days, built_by: `job:${job}`, now: now(), sources: input.sources ?? s.sources, source_items: input.source_items ?? s.items });
        if (typeof input.spend_gbp === 'number') ctx.spend.gbp = round4(ctx.spend.gbp + input.spend_gbp);
        summary.spend_gbp = round4(ctx.spend.gbp);
        await progress();
        return r;
      },
    };
    let draftError: Error | null = null;
    if (hook) {
      try {
        const ds = await hook(ctx);
        summary.drafted = true;
        if (ds && typeof ds === 'object') { summary.draft = ds; if (typeof ds.spend_gbp === 'number') ctx.spend.gbp = round4(ds.spend_gbp); }
      } catch (e) { draftError = e as Error; summary.warnings.push(`draft: ${draftError.message}`); }
      summary.spend_gbp = round4(ctx.spend.gbp);
    }
    // Sections nobody wrote in this build are recorded 'empty' with their sources (their version did not move).
    const after = new Map<SectionId, number>((await db.query<{ section: SectionId; v: number }>('SELECT section, max(version)::int AS v FROM country_packs WHERE country = $1 GROUP BY section', [country])).rows.map(r => [r.section, r.v]));
    // A section the drafter kept (same originals, still fresh) stands at its version: it is neither rewritten nor recorded empty.
    const kept = new Set((summary.draft?.sections ?? []).filter(x => x.kept).map(x => x.section));
    for (const s of perSection) {
      if (kept.has(s.section)) continue;
      if ((after.get(s.section) ?? 0) > (before.get(s.section) ?? 0)) continue;
      await writePackSection(db, { country, section: s.section, body: EMPTY_BODY, status: 'empty', stale_reason: draftError ? `draft failed: ${draftError.message}` : null, ttl_days: s.ttl_days, built_by: `job:${job}`, now: now(), sources: s.sources, source_items: s.items });
    }
    if (draftError) throw draftError;
  } catch (e) {
    summary.status = 'failed';
    summary.error = (e as Error).message;
  }

  summary.finished_at = now().toISOString();
  summary.duration_ms = now().getTime() - started.getTime();
  await db.query('UPDATE jobs SET finished_at = $2, status = $3, summary = $4::jsonb WHERE id = $1', [job, summary.finished_at, summary.status, JSON.stringify(summary)]);
  await audit(db, by, 'country.pack.build', 'public', [`country:${country}`, ...touched.slice(0, 99)], { job_id: job, status: summary.status, fetched: summary.fetched, stored: summary.stored, unchanged: summary.unchanged, unreachable: summary.unreachable, spend_gbp: summary.spend_gbp });
  log(`country-pack ${country}: ${summary.status}, ${summary.fetched} fetched, ${summary.stored} filed, ${summary.unchanged} unchanged, ${summary.unreachable} unreachable${summary.unfiled ? `, ${summary.unfiled} reached but NOT FILED (fix the file store: vault/SETUP.md §1.5)` : ''}, £${summary.spend_gbp}${summary.error ? `, ${summary.error}` : ''}`);
  return summary;
}

/** The ingest deps for chunking at once, or null (with a warning) when the embedder refuses to open: the ingest-sync cron chunks later. */
function openIngestOrNull(env: NodeJS.ProcessEnv, warnings: string[]): IngestDeps | null {
  try { return { provider: null, embedder: openEmbedder(env) }; }
  catch (e) { warnings.push(`originals are filed but not chunked yet: ${(e as Error).message}`); return null; }
}

/* ── the view the Hub reads ──────────────────────────────────────────────────────────────────────────────────── */

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const chip = (s: PackSourceRef) => ({ id: s.id, url: s.url, licence: s.licence, attribution: s.attribution, fetched_at: s.fetched_at ?? null, item_id: s.item_id ?? null, reachable: !!s.reachable, ...(s.fault ? { fault: s.fault } : {}), ...(s.note ? { note: s.note } : {}) });

function sectionView(section: typeof SECTIONS[number], row: any | undefined): PackSectionView {
  const title = { en: section.en, es: section.es };
  if (!row) return { section: section.id, title, version: 0, status: 'empty', stale_reason: null, built_at: '', ttl_days: section.ttl_days, due_at: '', body: EMPTY_BODY, sources: [] };
  const built = new Date(row.built_at);
  return {
    section: section.id, title, version: row.version, status: row.status, stale_reason: row.stale_reason ?? null, built_at: built.toISOString(), ttl_days: row.ttl_days,
    due_at: ymd(built.getTime() + row.ttl_days * DAY), body: row.body ?? EMPTY_BODY, sources: (Array.isArray(row.sources) ? row.sources : []).map(chip),
  };
}

/* ── the World Monitor original and the web search step (pack rework) ─────────────────────────────────────── */

const WM_SOURCE = (country: string): CountrySource => ({ id: 'world-monitor-intel', section: 'risk', url: `https://worldmonitor.app/intelligence/country-risk/${country}`, access: 'json', licence: "World Monitor terms of service (the firm's subscription); figures quoted for screening", attribution: 'World Monitor, country risk and context', allowed_domains: ['worldmonitor.app'], note: 'The reading behind the country intel card, filed so the risk section can cite it.' });

/** Files the World Monitor country reading as an original of the risk section; returns what happened, for the summary. */
export async function fileWorldMonitor(db: Db, storage: Storage, country: string, name: string, perSection: SectionSources[], o: { now: () => Date; ingest: IngestDeps | null; onTouched?: (id: string) => void }): Promise<string> {
  if (!worldMonitorConfigured()) return 'not connected';
  const bucket = perSection.find(s => s.section === 'risk');
  if (!bucket) return 'risk section not in this build';
  let r: Awaited<ReturnType<typeof countryRisk>>;
  try { r = await countryRisk(country); } catch (e) { return `failed: ${(e as Error).message}`; }
  if (!r.ok) return r.reason;
  const src = WM_SOURCE(country);
  const payload = { country, name, fetched_at: r.fetched_at, risk: r.data };
  const fetched: FetchOk = { unreachable: false, url: src.url, url_final: src.url, bytes: Buffer.from(JSON.stringify(payload, null, 2)), mime: 'application/json', fetched_at: r.fetched_at, status: 200, title: `World Monitor: ${name} risk and context`, description: `risk score ${r.data.score ?? 'n/a'}, ${r.data.level ?? 'no advisory'}, sanctions ${r.data.sanctions_active ? 'active' : 'none recorded'}` };
  const rec: PackSourceRecord = { id: src.id, section: 'risk', url: src.url, licence: src.licence, attribution: src.attribution, fetched_at: r.fetched_at, item_id: null, sha256: null, reachable: true, note: src.note };
  try {
    const st = await storeOriginal(db, storage, src, fetched, country, { now: o.now(), ingest: o.ingest });
    rec.item_id = st.id; rec.sha256 = st.sha256; rec.status = st.status;
    if (!bucket.items.includes(st.id)) bucket.items.push(st.id);
    bucket.sources.push(rec);
    if (st.status !== 'unchanged') o.onTouched?.(st.id);
    return `filed (${st.status})`;
  } catch (e) { rec.fault = 'storage'; rec.note = `could not be filed: ${(e as Error).message}`; bucket.sources.push(rec); return `not filed: ${(e as Error).message}`; }
}

export interface WebSearchSummary { searches: number; pages: number; filed: number; unchanged: number; skipped: string[] }
const WEB_MAX_PAGES = 8;
const WEB_SYSTEM = 'You find public web pages that state, for one country, its hydrocarbon law and contract regime, fiscal terms (royalty, income tax, special taxes), how acreage is licensed and the current round, production and reserves, and sanctions. Prefer the regulator and ministry, law firm guides (Chambers, Legal 500), EITI, EIA, OPEC, the IMF and World Bank, and established trade press. Answer with one line per page: the URL and what it states. Never invent a URL.';
export const webQueries = (name: string, year: number): { section: SectionId; q: string }[] => [
  { section: 'fiscal', q: `${name} oil and gas fiscal terms royalty income tax ${year} hydrocarbons law contract regime` },
  { section: 'licensing', q: `${name} oil gas licensing round ${year} acreage award regulator` },
  { section: 'production', q: `${name} oil production reserves ${year} barrels per day` },
  { section: 'risk', q: `${name} oil gas sector sanctions restrictions ${year}` },
];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const sha8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

/**
 * The web search step: for each query the provider's search names pages (the model reads only the search snippets);
 * the job fetches each page itself under the pack's fetch rules, files it as an original of the section the query
 * served, and the section's chips show it as found by web search. Blocked hosts and pages already registered are skipped.
 */
export async function webSearchOriginals(db: Db, storage: Storage, country: string, name: string, provider: LlmProvider, perSection: SectionSources[], o: FetchOptions & { now: () => Date; env: NodeJS.ProcessEnv; ingest: IngestDeps | null; log?: (line: string) => void; maxPages?: number; onTouched?: (id: string) => void }): Promise<WebSearchSummary> {
  const out: WebSearchSummary = { searches: 0, pages: 0, filed: 0, unchanged: 0, skipped: [] };
  const known = new Set(perSection.flatMap(s => s.sources.map(x => x.url)));
  const pool = new HttpPool({ fetch: o.fetch, clock: o.clock });
  const max = o.maxPages ?? WEB_MAX_PAGES;
  for (const { section, q } of webQueries(name, o.now().getUTCFullYear())) {
    if (out.pages >= max) break;
    const bucket = perSection.find(s => s.section === section);
    if (!bucket) continue;
    let r;
    try { r = await provider.search!({ system: WEB_SYSTEM, prompt: `Country: ${name} (${country}). Find: ${q}`, maxUses: 3, purpose: 'country-pack.search', scope: 'public', refs: [`country:${country}`] }); out.searches++; }
    catch (e) { out.skipped.push(`search "${q}": ${(e as Error).message}`); continue; }
    if (r.error) out.skipped.push(`search "${q}": ${r.error}`);
    const urls = [...new Set([...r.citations.map(c => c.url), ...r.results.map(x => x.url)].filter(u => /^https?:\/\//i.test(u)))];
    for (const url of urls) {
      if (out.pages >= max) break;
      let host: string;
      try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
      if (isBlockedHost(host)) { out.skipped.push(`${host}: never read`); continue; }
      if (known.has(url)) continue;
      known.add(url);
      const src: CountrySource = { id: `web-${slug(host)}-${sha8(url)}`, section, url, access: /\.pdf(\?|$)/i.test(url) ? 'pdf' : 'html', licence: 'As published by the site; found by web search and quoted with attribution for screening, not advice', attribution: `${host} (found by web search)`, allowed_domains: [host], note: `Found by web search on ${o.now().toISOString().slice(0, 10)} for "${q}".` };
      const rec: PackSourceRecord = { id: src.id, section, url, licence: src.licence, attribution: src.attribution, fetched_at: null, item_id: null, sha256: null, reachable: false, note: src.note };
      out.pages++;
      const f = await fetchSource(src, { country, name, fetch: o.fetch, clock: o.clock, now: o.now, env: o.env, pool, maxBytes: o.maxBytes ?? 1_500_000, timeoutMs: o.timeoutMs, onWarn: m => out.skipped.push(m) });
      if (f.unreachable) { rec.note = `${src.note} ${f.reason}`; out.skipped.push(`${url}: ${f.reason}`); bucket.sources.push(rec); continue; }
      rec.fetched_at = f.fetched_at; rec.reachable = true; rec.title = f.title;
      try {
        const st = await storeOriginal(db, storage, src, f, country, { now: o.now(), ingest: o.ingest });
        rec.item_id = st.id; rec.sha256 = st.sha256; rec.status = st.status;
        if (!bucket.items.includes(st.id)) bucket.items.push(st.id);
        if (st.status === 'unchanged') out.unchanged++; else { out.filed++; o.onTouched?.(st.id); }
      } catch (e) { rec.fault = 'storage'; rec.note = `could not be filed: ${(e as Error).message}`; out.skipped.push(`${url}: could not be filed`); }
      bucket.sources.push(rec);
    }
  }
  o.log?.(`country-pack ${country}: web search ${out.searches} queries, ${out.pages} pages, ${out.filed} filed, ${out.unchanged} unchanged${out.skipped.length ? `, ${out.skipped.length} skipped` : ''}`);
  return out;
}

/** The current version of every section, the open or latest build, and the spend across every version built for the country. Reaps a stuck build first. */
export async function packView(db: Db, country: string, now = new Date()): Promise<PackView> {
  assertCode(country);
  await reapStalePacks(db, { country, now });
  const rows = (await db.query<any>('SELECT DISTINCT ON (section) * FROM country_packs WHERE country = $1 ORDER BY section, version DESC', [country])).rows;
  const byId = new Map<string, any>(rows.map((r: any) => [r.section, r]));
  const sections = SECTIONS.map(s => sectionView(s, byId.get(s.id)));
  const counts = { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 0 };
  for (const s of sections) { if (s.version > 0) counts.built++; counts[s.status]++; }
  const newest = rows.map((r: any) => new Date(r.built_at).getTime()).sort((a: number, b: number) => b - a)[0];
  const job = (await db.query<any>("SELECT id, status, started_at FROM jobs WHERE name = $2 AND summary->>'country' = $1 ORDER BY (status = 'running') DESC, id DESC LIMIT 1", [country, JOB_NAME])).rows[0];
  const spend = (await db.query<{ gbp: string | null }>('SELECT sum(spend_gbp)::text AS gbp FROM country_packs WHERE country = $1', [country])).rows[0];
  const terms = await loadTerms(db, country);
  return {
    terms, quality: packQuality(terms),
    country, assembled_at: newest ? new Date(newest).toISOString() : null, sections, counts,
    job: job ? { id: job.id, status: job.status, started_at: new Date(job.started_at).toISOString() } : null,
    spend_gbp: round4(Number(spend?.gbp ?? 0)),
  };
}

export async function packSectionView(db: Db, country: string, section: SectionId, now = new Date()): Promise<PackSectionView> {
  const v = await packView(db, country, now);
  return v.sections.find(s => s.section === section)!;
}

/* ── the cron ────────────────────────────────────────────────────────────────────────────────────────────────── */

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = await openDb();
  await migrate(db);
  const r = await runQueuedPacks(db);
  console.log(JSON.stringify(r.map(s => ({ country: s.country, status: s.status, fetched: s.fetched, stored: s.stored, unchanged: s.unchanged, unreachable: s.unreachable, spend_gbp: s.spend_gbp, duration_ms: s.duration_ms }))));
  await db.close();
  if (r.some(s => s.status === 'failed')) process.exitCode = 1;
}
