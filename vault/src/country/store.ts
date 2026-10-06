/**
 * Filing a fetched source as a dated original (wave 7 PR4, 04-step-changes.md P1 step 2; W7-AC17). Every payload
 * becomes an immutable item under project 'firm' with the public legal tag, exactly as the miners' upsertItem files
 * a feed: `origin {source: 'country-pack', external_id: url, fetched_at}`, the sha256 in `extracted.manifest`, type
 * feed-snapshot (a page or dataset) or regulatory-filing (an instrument, a PDF). The same bytes under the same url
 * write nothing and answer 'unchanged'; different bytes become the next version of the same item (items are never
 * edited: a version row is added, the storage key is content-addressed). The existing ingest then extracts and
 * chunks the text so Find reaches the law itself; when no ingest deps are given the ingest-sync cron does it.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { Storage } from '../storage.ts';
import { originalKey } from '../storage.ts';
import { validate } from '../schemas.ts';
import { sha256 } from '../miners/run.ts';
import { ingestItem, type IngestDeps } from '../ingest/index.ts';
import type { FetchOk } from './fetch.ts';
import { PACK_ITEM_KIND, PACK_ITEM_TYPE, PACK_LEGAL_TAG, PACK_ORIGIN, PACK_PROJECT, type CountrySource } from './types.ts';

const MAX_BYTES = 50 * 1024 * 1024;

export interface StoreResult { id: string; version: number; status: 'created' | 'updated' | 'unchanged'; sha256: string; item_type: string; chunks: number | null; /** the original is filed but not indexed yet (the embedder refused): the ingest-sync cron chunks it later */ warning?: string }
export interface StoreOptions { now?: Date; /** When given, the original is extracted and chunked at once; otherwise the ingest-sync cron does it. */ ingest?: IngestDeps | null }

/** An instrument or a PDF is a regulatory filing; a page, an API answer or a dataset is a feed snapshot. */
export function itemTypeFor(source: Pick<CountrySource, 'access' | 'options'>): string {
  if (source.access === 'pdf' || source.options?.kind === 'filing') return PACK_ITEM_TYPE.filing;
  return PACK_ITEM_TYPE.page;
}

const fillYear = (s: string, edition?: number) => (edition ? s.replace(/\{year\}/g, String(edition)) : s);

export async function storeOriginal(db: Db, storage: Storage, source: CountrySource, fetched: FetchOk, country: string, opts: StoreOptions = {}): Promise<StoreResult> {
  if (fetched.bytes.length > MAX_BYTES) throw new Error(`payload for "${source.id}" exceeds ${MAX_BYTES} bytes`);
  const now = opts.now ?? new Date();
  const hash = sha256(fetched.bytes);
  const type = itemTypeFor(source);
  const title = fetched.title?.trim() || `${source.id} (${country})`;
  const attribution = fillYear(source.attribution, fetched.edition);
  const origin = { source: PACK_ORIGIN, external_id: fetched.url, url: fetched.url_final, fetched_at: fetched.fetched_at };
  const extracted: Record<string, unknown> = {
    kind: PACK_ITEM_KIND,
    manifest: {
      url: fetched.url, fetched_at: fetched.fetched_at, sha256: hash, bytes: fetched.bytes.length, mime: fetched.mime,
      ...(fetched.url_final !== fetched.url ? { url_final: fetched.url_final } : {}), ...(fetched.edition ? { edition: fetched.edition } : {}),
      ...(fetched.source_modified ? { source_modified: fetched.source_modified } : {}), ...(typeof fetched.rows === 'number' ? { rows: fetched.rows } : {}),
    },
    pack: { country, section: source.section, source_id: source.id },
    licence: source.licence, attribution, title, description: fetched.description, access: source.access,
  };
  const tags = ['country-pack', `country:${country}`, `section:${source.section}`, `source:${source.id}`];
  const meta = {
    id: randomUUID(), type, title, created_at: now.toISOString(), authored_at: fetched.fetched_at, authors: [], client_id: null, project_id: PACK_PROJECT,
    asset_ids: [], legal_tag: PACK_LEGAL_TAG, origin, storage_key: originalKey(hash), mime: fetched.mime, content_hash: `sha256:${hash}`, version: 1,
    supersedes: null, cites: [], filing: { method: 'tool' }, extracted, stale: false, tags, organisation_ids: [], reference_no: null,
  };
  // The item schema (Tier A) lists the origins it knew at wave 1; the pack origin is new, so the structural check runs with
  // the miners' feed origin in its place and the row is written with the pack origin the contract fixes.
  const errs = validate('vault-item', { ...meta, origin: { ...origin, source: 'regulator-feed' } });
  if (errs.length) throw new Error(`vault-item invalid for "${title}": ${errs.map(e => `${e.path} ${e.message}`).join('; ')}`);

  const existing = (await db.query<{ id: string; version: number; content_hash: string }>(
    `SELECT id, version, content_hash FROM items WHERE origin->>'source' = $1 AND external_id = $2 AND project_id = $3`, [PACK_ORIGIN, fetched.url, PACK_PROJECT])).rows[0];
  if (existing && existing.content_hash === meta.content_hash) return { id: existing.id, version: existing.version, status: 'unchanged', sha256: hash, item_type: type, chunks: null };

  if (!(await storage.exists(meta.storage_key))) await storage.put(meta.storage_key, fetched.bytes, fetched.mime);
  let id: string, version: number, status: 'created' | 'updated';
  if (!existing) {
    await db.query(
      `INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, storage_key, mime, content_hash, version, filing, extracted, tags)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9::jsonb,$10,$11,$12,$13,1,$14::jsonb,$15::jsonb,$16::text[])`,
      [meta.id, type, title, meta.created_at, meta.authored_at, [], PACK_PROJECT, PACK_LEGAL_TAG, JSON.stringify(origin), fetched.url, meta.storage_key, fetched.mime, meta.content_hash, JSON.stringify(meta.filing), JSON.stringify(extracted), tags]);
    await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key) VALUES ($1,1,$2,$3)', [meta.id, meta.content_hash, meta.storage_key]);
    id = meta.id; version = 1; status = 'created';
  } else {
    version = existing.version + 1;
    const upd = await db.query(
      `UPDATE items SET title=$3, authored_at=$4, legal_tag=$5, origin=$6::jsonb, storage_key=$7, mime=$8, content_hash=$9, version=$2, filing=$10::jsonb, extracted=$11::jsonb, tags=$12::text[], stale=false
         WHERE id=$1 AND version=$13 RETURNING id`,
      [existing.id, version, title, meta.authored_at, PACK_LEGAL_TAG, JSON.stringify(origin), meta.storage_key, fetched.mime, meta.content_hash, JSON.stringify(meta.filing), JSON.stringify(extracted), tags, existing.version]);
    if (!upd.rows.length) throw new Error(`item ${existing.id} changed while it was being saved`);
    await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key) VALUES ($1,$2,$3,$4)', [existing.id, version, meta.content_hash, meta.storage_key]);
    id = existing.id; status = 'updated';
  }

  // The original is filed once the bytes and the row are saved. Indexing it is a second step that can fail on its own
  // (an embedder rate limit, a key refused): that leaves the item unchunked for the ingest-sync cron, which picks up
  // every item without current chunks, and is never reported as "could not be filed".
  let chunks: number | null = null, warning: string | undefined;
  if (opts.ingest) {
    try { chunks = (await ingestItem(db, storage, id, opts.ingest, { now: () => now })).chunks; }
    catch (e) { warning = `filed, not indexed yet (the ingest-sync cron will chunk it): ${(e as Error).message.slice(0, 200)}`; }
  }
  return { id, version, status, sha256: hash, item_type: type, chunks, ...(warning ? { warning } : {}) };
}
