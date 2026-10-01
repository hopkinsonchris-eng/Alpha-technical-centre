/**
 * M11 orchestrator. Reads master/topics.json, runs the enabled feed adapters,
 * and turns every fetched record into a Vault Item:
 *   papers            type 'paper',         legal tag lt-public,      origin semantic-scholar | crossref | openalex
 *   regulator/agency  type 'feed-snapshot', legal tag lt-firm-public, origin regulator-feed
 * all in project 'firm', each with a manifest {url, fetched_at, sha256, rows} in
 * `extracted.manifest`. The sha256 is over the fetched payload, so a re-run with
 * no upstream change writes nothing; a changed payload under the same external
 * id becomes a new version of the same item (items are immutable, never edited).
 *
 * Papers are deduplicated across sources on DOI, external id and fuzzy title
 * (normalised tokens, Jaccard >= 0.9), and filtered by topic negative keywords.
 * The OnePetro rule holds by construction: adapters only call metadata APIs
 * (Http refuses the SPE library host) and only abstracts are stored.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { ensureBase } from '../db/seed.ts';
import { openStorage, originalKey, type Storage } from '../storage.ts';
import { validate } from '../schemas.ts';
import type { FeedAdapter, FeedRecord, TopicSpec } from './types.ts';
import { createAnhAdapter } from './anh-co.ts';
import { createAnpAdapter } from './anp-br.ts';
import { createArEnergiaAdapter } from './ar-energia.ts';
import { createCrossrefAdapter } from './crossref.ts';
import { createEiaAdapter } from './eia.ts';
import { createOpenAlexAdapter } from './openalex.ts';
import { createPerupetroAdapter } from './perupetro.ts';
import { createSecEdgarAdapter } from './sec-edgar.ts';
import { createSemanticScholarAdapter } from './semantic-scholar.ts';
import { normDoi, stableStringify, type AdapterOptions } from './util.ts';

export const TOPICS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../master/topics.json');
export const MINER_PROJECT = 'firm';
export const LT_PAPER = 'lt-public';
export const LT_FEED = 'lt-firm-public';
const MAX_BYTES = 50 * 1024 * 1024;

/* ── configuration ──────────────────────────────────────────────────── */

export interface SourceConfig { enabled?: boolean; [k: string]: unknown }
export interface MinersConfig {
  topics: TopicSpec[];
  sec_issuers: { cik: string; name: string }[];
  /** Negative keywords applied to every paper. */
  negative?: string[];
  sources: Record<string, SourceConfig>;
  lookback_days?: { weekly?: number; monthly?: number };
}

export function parseConfig(raw: any): MinersConfig {
  if (!raw || typeof raw !== 'object') throw new Error('topics.json must be an object');
  const topics: TopicSpec[] = (raw.topics ?? []).map((t: any) => {
    if (!t?.id || !t.query) throw new Error('each topic needs an id and a query');
    return { id: String(t.id), query: String(t.query), keywords: (t.keywords ?? []).map(String), negative: (t.negative ?? []).map(String) };
  });
  return { topics, sec_issuers: (raw.sec_issuers ?? []).map((i: any) => ({ cik: String(i.cik), name: String(i.name) })), negative: (raw.negative ?? []).map(String), sources: raw.sources ?? {}, lookback_days: raw.lookback_days };
}
export function loadConfig(file = TOPICS_PATH): MinersConfig { return parseConfig(JSON.parse(readFileSync(file, 'utf8'))); }

/* ── adapter registry ───────────────────────────────────────────────── */

interface Kind { type: 'paper' | 'feed-snapshot'; source: string; legal_tag: string }
const PAPER = (source: string): Kind => ({ type: 'paper', source, legal_tag: LT_PAPER });
const FEED: Kind = { type: 'feed-snapshot', source: 'regulator-feed', legal_tag: LT_FEED };
export const KINDS: Record<string, Kind> = {
  'semantic-scholar': PAPER('semantic-scholar'), crossref: PAPER('crossref'), openalex: PAPER('openalex'),
  'anh-co': FEED, 'anp-br': FEED, 'ar-energia': FEED, perupetro: FEED, 'sec-edgar': FEED, eia: FEED,
};
export const ADAPTER_IDS = Object.keys(KINDS);

export interface BuildContext extends AdapterOptions { env?: NodeJS.ProcessEnv; seedIds?: () => Promise<string[]> | string[] }

/** Construct every adapter from configuration. Enabled-ness is decided by the caller. */
export function buildAdapters(cfg: MinersConfig, ctx: BuildContext = {}): Map<string, FeedAdapter> {
  const env = ctx.env ?? process.env;
  const c: AdapterOptions = { fetch: ctx.fetch, clock: ctx.clock, onWarn: ctx.onWarn };
  const src = (id: string) => cfg.sources[id] ?? {};
  const page = (s: SourceConfig, key: string) => (typeof s.page_size === 'number' ? { [key]: s.page_size } : {});
  return new Map<string, FeedAdapter>([
    ['semantic-scholar', createSemanticScholarAdapter({ ...c, apiKey: env.S2_API_KEY, seedIds: ctx.seedIds, ...page(src('semantic-scholar'), 'pageSize') })],
    ['crossref', createCrossrefAdapter({ ...c, mailto: env.CROSSREF_MAILTO ?? env.MINERS_MAILTO, ...page(src('crossref'), 'rows') })],
    ['openalex', createOpenAlexAdapter({ ...c, apiKey: env.OPENALEX_API_KEY, mailto: env.MINERS_MAILTO, ...page(src('openalex'), 'perPage') })],
    ['anh-co', createAnhAdapter({ ...c, appToken: env.SOCRATA_APP_TOKEN, ...(src('anh-co').resources ? { resources: src('anh-co').resources as any } : {}) })],
    ['anp-br', createAnpAdapter({ ...c, ...(src('anp-br').url_template ? { urlTemplate: String(src('anp-br').url_template) } : {}), ...(src('anp-br').encoding ? { encoding: src('anp-br').encoding as BufferEncoding } : {}) })],
    ['ar-energia', createArEnergiaAdapter({ ...c, ...(src('ar-energia').resources ? { resources: src('ar-energia').resources as any } : {}) })],
    ['perupetro', createPerupetroAdapter({ ...c, downloads: (src('perupetro').downloads as any) ?? [] })],
    ['sec-edgar', createSecEdgarAdapter({ ...c, issuers: cfg.sec_issuers, userAgent: env.SEC_USER_AGENT })],
    ['eia', createEiaAdapter({ ...c, apiKey: env.EIA_API_KEY, ...(src('eia').series ? { series: src('eia').series as any } : {}) })],
  ]);
}

/* ── dedupe ─────────────────────────────────────────────────────────── */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const normaliseTitle = (t: string) => fold(t).replace(/[^a-z0-9]+/g, ' ').trim();
export const titleTokens = (t: string): Set<string> => new Set(normaliseTitle(t).split(' ').filter(w => w.length > 1));
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
export const TITLE_THRESHOLD = 0.9;
const MIN_FUZZY_TOKENS = 3;

export interface IndexedPaper { id: string; source: string; external_id?: string; doi?: string; title: string }
export type DuplicateReason = 'doi' | 'external_id' | 'title';

/** In-memory index of papers already in the Vault (plus those written this run). */
export class PaperIndex {
  private byDoi = new Map<string, IndexedPaper>();
  private byExt = new Map<string, IndexedPaper>();
  private titles: { tokens: Set<string>; paper: IndexedPaper }[] = [];
  static async load(db: Db): Promise<PaperIndex> {
    const idx = new PaperIndex();
    const rows = (await db.query<any>(`SELECT id, title, origin->>'source' AS source, external_id, extracted->>'doi' AS doi FROM items WHERE type = 'paper' AND NOT hidden`)).rows;
    for (const r of rows) idx.add({ id: r.id, source: r.source, external_id: r.external_id ?? undefined, doi: r.doi ?? undefined, title: r.title });
    return idx;
  }
  add(p: IndexedPaper): void {
    const doi = normDoi(p.doi) ?? normDoi(p.external_id);
    if (doi) this.byDoi.set(doi, p);
    if (p.external_id) this.byExt.set(p.external_id, p);
    const tokens = titleTokens(p.title);
    if (tokens.size >= MIN_FUZZY_TOKENS) this.titles.push({ tokens, paper: p });
  }
  /** A different-source paper this record duplicates, if any. Same source and external id is a version, not a duplicate. */
  find(source: string, rec: { external_id: string; title: string; doi?: string }): { paper: IndexedPaper; reason: DuplicateReason } | null {
    const doi = normDoi(rec.doi) ?? normDoi(rec.external_id);
    const d = doi && this.byDoi.get(doi);
    if (d && !(d.source === source && d.external_id === rec.external_id)) return { paper: d, reason: 'doi' };
    const e = this.byExt.get(rec.external_id);
    if (e && e.source !== source) return { paper: e, reason: 'external_id' };
    if (e) return null; // same source and id: an update of the same item
    const tokens = titleTokens(rec.title);
    if (tokens.size >= MIN_FUZZY_TOKENS) {
      for (const t of this.titles) {
        const lo = Math.min(tokens.size, t.tokens.size), hi = Math.max(tokens.size, t.tokens.size);
        if (lo / hi < TITLE_THRESHOLD) continue;
        if (jaccard(tokens, t.tokens) >= TITLE_THRESHOLD && !(t.paper.source === source && t.paper.external_id === rec.external_id)) return { paper: t.paper, reason: 'title' };
      }
    }
    return null;
  }
}

/* ── keyword filters ────────────────────────────────────────────────── */

const padded = (s: string) => ` ${normaliseTitle(s)} `;
export const mentionsAny = (haystack: string, needles: string[]) => { const h = padded(haystack); return needles.some(n => { const t = normaliseTitle(n); return t !== '' && h.includes(` ${t} `); }); };
/** Substring match for keywords, so "polymer" also finds "polymers" and "polymer-flooding". */
export const containsAny = (haystack: string, needles: string[]) => { const h = fold(haystack); return needles.some(n => n.trim() !== '' && h.includes(fold(n))); };

export type Verdict = 'keep' | 'negative' | 'off-topic';
export function screenPaper(rec: FeedRecord, cfg: MinersConfig): Verdict {
  const topic = cfg.topics.find(t => t.id === rec.meta.topic_id);
  const negatives = [...(cfg.negative ?? []), ...(topic ? topic.negative : cfg.topics.flatMap(t => t.negative))];
  const body = `${rec.title} ${rec.text ?? ''}`;
  if (mentionsAny(body, negatives)) return 'negative';
  if (topic && topic.keywords.length && rec.text && !containsAny(body, topic.keywords)) return 'off-topic';
  return 'keep';
}

/* ── writing items ──────────────────────────────────────────────────── */

export const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export interface NewItem {
  type: 'paper' | 'feed-snapshot';
  title: string;
  authored_at: string | null;
  authors: string[];
  legal_tag: string;
  origin: { source: string; external_id?: string; url?: string; fetched_at?: string; query?: string };
  bytes: Buffer;
  mime: string;
  extracted?: Record<string, unknown>;
  tags?: string[];
  project_id?: string;
}
export interface UpsertResult { id: string; version: number; status: 'created' | 'updated' | 'unchanged' }

/**
 * Insert an item or, when the same origin (source + external id) already exists
 * in the project and the bytes differ, add a version. Identical bytes change nothing.
 * Mirrors POST /api/items for a service caller (no HTTP context to reuse).
 */
export async function upsertItem(db: Db, storage: Storage, it: NewItem, now = new Date()): Promise<UpsertResult> {
  if (it.bytes.length > MAX_BYTES) throw new Error(`payload for "${it.title}" exceeds ${MAX_BYTES} bytes`);
  const hash = sha256(it.bytes);
  const project = it.project_id ?? MINER_PROJECT;
  const meta = {
    id: randomUUID(), type: it.type, title: it.title, created_at: now.toISOString(), authored_at: it.authored_at, authors: it.authors, client_id: null, project_id: project,
    asset_ids: [], legal_tag: it.legal_tag, origin: it.origin, storage_key: originalKey(hash), mime: it.mime, content_hash: `sha256:${hash}`, version: 1,
    supersedes: null, cites: [], filing: { method: 'tool' }, extracted: it.extracted ?? {}, stale: false, tags: it.tags ?? [], organisation_ids: [], reference_no: null,
  };
  const errs = validate('vault-item', meta);
  if (errs.length) throw new Error(`vault-item invalid for "${it.title}": ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);

  const extId = it.origin.external_id ?? null;
  const existing = extId
    ? (await db.query<any>(`SELECT id, version, content_hash FROM items WHERE origin->>'source' = $1 AND external_id = $2 AND project_id = $3`, [it.origin.source, extId, project])).rows[0]
    : undefined;
  if (existing && existing.content_hash === meta.content_hash) return { id: existing.id, version: existing.version, status: 'unchanged' };

  if (!(await storage.exists(meta.storage_key))) await storage.put(meta.storage_key, it.bytes, it.mime);
  const cols = [meta.title, meta.authored_at, meta.authors, meta.legal_tag, JSON.stringify(meta.origin), extId, meta.storage_key, meta.mime, meta.content_hash, JSON.stringify(meta.filing), JSON.stringify(meta.extracted), meta.tags];
  if (!existing) {
    await db.query(
      `INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, storage_key, mime, content_hash, version, filing, extracted, tags)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9::jsonb,$10,$11,$12,$13,1,$14::jsonb,$15::jsonb,$16::text[])`,
      [meta.id, meta.type, cols[0], meta.created_at, cols[1], cols[2], project, cols[3], cols[4], cols[5], cols[6], cols[7], cols[8], cols[9], cols[10], cols[11]]);
    await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key) VALUES ($1,1,$2,$3)', [meta.id, meta.content_hash, meta.storage_key]);
    return { id: meta.id, version: 1, status: 'created' };
  }
  const version = existing.version + 1;
  const upd = await db.query(
    `UPDATE items SET title=$3, authored_at=coalesce($4, authored_at), authors=$5::text[], legal_tag=$6, origin=$7::jsonb, storage_key=$8, mime=$9, content_hash=$10, version=$2,
       filing=$11::jsonb, extracted=$12::jsonb, tags=$13::text[], stale=false WHERE id=$1 AND version=$14 RETURNING id`,
    [existing.id, version, cols[0], cols[1], cols[2], cols[3], cols[4], cols[6], cols[7], cols[8], cols[9], cols[10], cols[11], existing.version]);
  if (!upd.rows.length) throw new Error(`item ${existing.id} changed while it was being saved`);
  await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key) VALUES ($1,$2,$3,$4)', [existing.id, version, meta.content_hash, meta.storage_key]);
  return { id: existing.id, version, status: 'updated' };
}

/** lt-firm-public (public data held by the firm, not for republication), lt-public and the 'firm' project. */
export async function ensureMinerBase(db: Db): Promise<void> {
  await ensureBase(db);
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator, notes) VALUES ($1,'firm','public','public regulator and agency data',$2) ON CONFLICT (id) DO NOTHING`,
    [LT_FEED, 'Public feeds and open datasets fetched by the M11 miners; held for firm use, not republished.']);
}

/** Item fields for one fetched record. */
export function itemFromRecord(adapterId: string, rec: FeedRecord, fetchedAt: Date): NewItem {
  const kind = KINDS[adapterId];
  if (!kind) throw new Error(`unknown adapter "${adapterId}"`);
  const doi = normDoi(rec.meta.doi);
  let bytes: Buffer, mime: string, rows: number;
  if (kind.type === 'paper') {
    // The stored original is the bibliographic record with its abstract: metadata and abstract only.
    bytes = Buffer.from(stableStringify({ title: rec.title, abstract: rec.text ?? null, doi: doi ?? null, authors: rec.authors, authored_at: rec.authored_at }));
    mime = 'application/json'; rows = 1;
  } else {
    bytes = rec.file ?? Buffer.from(stableStringify({ title: rec.title, text: rec.text ?? null, meta: rec.meta }));
    mime = rec.mime ?? 'application/json';
    rows = typeof rec.meta.rows === 'number' ? rec.meta.rows : 1;
  }
  const keep = ['topic_id', 'venue', 'dataset', 'period', 'via', 'resource', 'route', 'cik', 'entity', 'latest_filed'];
  const extracted: Record<string, unknown> = {
    manifest: { url: rec.url, fetched_at: fetchedAt.toISOString(), sha256: sha256(bytes), rows },
    ...(doi ? { doi } : {}),
    ...(kind.type === 'paper' ? { abstract_chars: rec.text?.length ?? 0 } : {}),
    ...Object.fromEntries(keep.filter(k => rec.meta[k] != null).map(k => [k, rec.meta[k]])),
  };
  const tags = [`miner:${adapterId}`, ...(rec.meta.topic_id ? [`topic:${rec.meta.topic_id}`] : []), ...(doi ? [`doi:${doi}`] : [])];
  return {
    type: kind.type, title: rec.title, authored_at: rec.authored_at, authors: rec.authors, legal_tag: kind.legal_tag,
    origin: { source: kind.source, external_id: rec.external_id, url: rec.url, fetched_at: fetchedAt.toISOString() },
    bytes, mime, extracted, tags,
  };
}

/* ── the run ────────────────────────────────────────────────────────── */

export interface AdapterCounts { fetched: number; created: number; updated: number; unchanged: number; duplicates: number; negative: number; off_topic: number; skipped?: string; error?: string }
export interface RunSummary { started_at: string; since: Record<string, string>; adapters: Record<string, AdapterCounts>; created: number; updated: number; unchanged: number; warnings: string[]; stopped?: string }

export interface RunOptions {
  config?: MinersConfig;
  now?: Date;
  /** Override the per-schedule look-back window. */
  since?: Date;
  /** Schedules to run; default weekly only. The weekly job adds monthly on the first week of a month. */
  schedules?: ('weekly' | 'monthly')[];
  /** Restrict to these adapter ids (they must still be enabled unless `force`). */
  only?: string[];
  force?: boolean;
  storage?: Storage;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  clock?: AdapterOptions['clock'];
  /** Replace adapters (tests). */
  adapters?: FeedAdapter[];
  /** Wave 4: file under this project instead of 'firm', and stamp each item with the query that found it. */
  projectId?: string;
  queryOf?: (topicId: string | null) => string | null;
  /** Wave 4: stop fetching when the clock passes this instant; the summary names where it stopped. */
  budgetUntil?: Date;
  /** Wave 4: called after every record is filed (or skipped), with the running summary, so a caller can show progress. */
  onProgress?: (summary: RunSummary, adapterId: string) => void | Promise<void>;
}

const DAY = 86_400_000;

export async function runMiners(db: Db, opts: RunOptions = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const cfg = opts.config ?? loadConfig();
  const env = opts.env ?? process.env;
  const storage = opts.storage ?? openStorage();
  const warnings: string[] = [];
  const schedules = opts.schedules ?? ['weekly'];
  await ensureMinerBase(db);

  const seedIds = async () => (await db.query<{ external_id: string }>(
    `SELECT external_id FROM items WHERE type='paper' AND origin->>'source'='semantic-scholar' AND external_id IS NOT NULL AND NOT hidden ORDER BY created_at DESC LIMIT 100`)).rows.map(r => r.external_id);
  const built = buildAdapters(cfg, { fetch: opts.fetch, clock: opts.clock, env, seedIds, onWarn: m => warnings.push(m) });
  const adapters = opts.adapters ? new Map(opts.adapters.map(a => [a.id, a])) : built;

  const summary: RunSummary = { started_at: now.toISOString(), since: {}, adapters: {}, created: 0, updated: 0, unchanged: 0, warnings };
  const job = (await db.query<{ id: number }>(`INSERT INTO jobs (name, started_at, summary) VALUES ($1, $2, $3::jsonb) RETURNING id`, [opts.projectId ? 'miners-research' : 'miners', now.toISOString(), JSON.stringify(opts.projectId ? { project_id: opts.projectId } : {})])).rows[0];
  const index = await PaperIndex.load(db);
  const touched: string[] = [];

  for (const [id, adapter] of adapters) {
    if (opts.only && !opts.only.includes(id)) continue;
    if (!opts.force && !cfg.sources[id]?.enabled && !opts.adapters) continue;
    if (!schedules.includes(adapter.schedule)) continue;
    const counts: AdapterCounts = { fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, negative: 0, off_topic: 0 };
    summary.adapters[id] = counts;
    if (id === 'eia' && !env.EIA_API_KEY && !opts.adapters) { counts.skipped = 'EIA_API_KEY not set'; continue; }
    const kind = KINDS[id] ?? FEED;
    const days = adapter.schedule === 'weekly' ? cfg.lookback_days?.weekly ?? 8 : cfg.lookback_days?.monthly ?? 40;
    const since = opts.since ?? new Date(now.getTime() - days * DAY);
    summary.since[id] = since.toISOString();
    try {
      for await (const rec of adapter.fetch(since, cfg.topics)) {
        if (opts.budgetUntil && (opts.clock?.now?.() ?? Date.now()) >= opts.budgetUntil.getTime()) { summary.stopped = `${id}: ${String(rec.meta.topic_id ?? rec.title)}`; break; }
        counts.fetched++;
        if (kind.type === 'paper') {
          const v = screenPaper(rec, cfg);
          if (v === 'negative') { counts.negative++; continue; }
          if (v === 'off-topic') { counts.off_topic++; continue; }
          const dup = index.find(kind.source, { external_id: rec.external_id, title: rec.title, doi: rec.meta.doi as string | undefined });
          if (dup) { counts.duplicates++; continue; }
        }
        const it = itemFromRecord(id, rec, now);
        if (opts.projectId) { it.project_id = opts.projectId; const qq = opts.queryOf?.(typeof rec.meta.topic_id === 'string' ? rec.meta.topic_id : null); if (qq) it.origin = { ...it.origin, query: qq } as NewItem['origin']; }
        const r = await upsertItem(db, storage, it, now);
        counts[r.status === 'created' ? 'created' : r.status === 'updated' ? 'updated' : 'unchanged']++;
        if (r.status !== 'unchanged') touched.push(`doc:${r.id}`);
        if (kind.type === 'paper' && r.status === 'created') index.add({ id: r.id, source: kind.source, external_id: rec.external_id, doi: normDoi(rec.meta.doi), title: rec.title });
        if (opts.onProgress) await opts.onProgress({ ...summary, created: summary.created + counts.created, updated: summary.updated + counts.updated, unchanged: summary.unchanged + counts.unchanged }, id);
      }
    } catch (e) {
      counts.error = (e as Error).message;
      warnings.push(`${id}: ${counts.error}`);
    }
    summary.created += counts.created; summary.updated += counts.updated; summary.unchanged += counts.unchanged;
  }

  const failed = Object.values(summary.adapters).some(c => c.error);
  await db.query(`UPDATE jobs SET finished_at = now(), status = $2, summary = $3::jsonb WHERE id = $1`, [job.id, failed ? 'failed' : 'ok', JSON.stringify(summary)]);
  await audit(db, 'miners', 'miners.run', 'firm', touched.slice(0, 100), { created: summary.created, updated: summary.updated, unchanged: summary.unchanged, adapters: Object.keys(summary.adapters) });
  return summary;
}
