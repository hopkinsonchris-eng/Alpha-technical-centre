/**
 * Zoho WorkDrive sync (M09). Configured team folders (folder → project in vault/master/workdrive-map.json)
 * are listed by modified time; files that are new or changed since the stored item are downloaded and
 * created as Items with origin.source zoho-workdrive through the same path as an upload (ItemSink).
 *
 * Env: ZOHO_WORKDRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN, and optionally _ACCOUNTS_URL
 * (default https://accounts.zoho.com), _API_URL (default https://workdrive.zoho.com/api/v1),
 * _DOWNLOAD_URL (default https://download.zoho.com/v1/workdrive/download). Use the .eu / .in hosts for those data centres.
 * All HTTP goes through the injected fetch, so tests replay recorded JSON.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import type { ItemSink } from './items-client.ts';
import { inferType } from './legal-finance.ts';
import { oauthFromEnv, ZohoAuth } from './zoho-auth.ts';

const VAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WORKDRIVE_MAP_FILE = path.join(VAULT_DIR, 'master', 'workdrive-map.json');
const MAX_BYTES = 50 * 1024 * 1024;

export interface WorkdriveFolder {
  folder_id: string; project_id: string; name?: string;
  /** Force a vault type for every file in the folder (e.g. "contract" for Legal/); otherwise inferred from the file name. */
  type?: string | null;
  legal_tag?: string | null;
  recursive?: boolean;
  enabled?: boolean;
}
export interface BooksMap { project_id?: string; customer_projects?: Record<string, string> }
export interface WorkdriveMap { folders: WorkdriveFolder[]; books?: BooksMap }

export function loadWorkdriveMap(file = WORKDRIVE_MAP_FILE): WorkdriveMap {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return { folders: Array.isArray(j.folders) ? j.folders : [], books: j.books };
}

export interface WorkdriveConfig { auth: ZohoAuth; apiUrl: string; downloadUrl: string }
export function workdriveConfig(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): WorkdriveConfig | null {
  const oauth = oauthFromEnv('ZOHO_WORKDRIVE', env);
  if (!oauth) return null;
  return {
    auth: new ZohoAuth(oauth, fetchImpl),
    apiUrl: (env.ZOHO_WORKDRIVE_API_URL ?? 'https://workdrive.zoho.com/api/v1').replace(/\/$/, ''),
    downloadUrl: (env.ZOHO_WORKDRIVE_DOWNLOAD_URL ?? 'https://download.zoho.com/v1/workdrive/download').replace(/\/$/, ''),
  };
}

export interface SyncStats { listed: number; created: number; versioned: number; unchanged: number; skipped: number; failed: number; errors: string[]; items: Array<{ id: string; version: number }>; /** 7 Oct 2026: new or changed files left for the next run by the per-run cap */ deferred?: number; notes?: string[]; /** wave 6 */ moved?: number; hidden?: number; unchanged_by_changes?: number }
const emptyStats = (): SyncStats => ({ listed: 0, created: 0, versioned: 0, unchanged: 0, skipped: 0, failed: 0, errors: [], items: [], deferred: 0, notes: [] });

interface RemoteFile { id: string; name: string; mime: string; size: number; modifiedMs: number; path: string; url?: string; /** the file's own download URL from the listing (the EU data centre answers on download-accl.zoho.eu) */ download?: string }

const modifiedMs = (a: any): number => {
  const n = Number(a?.modified_time_in_millisecond ?? a?.modified_time_i);
  if (Number.isFinite(n) && n > 0) return n;
  const t = Date.parse(a?.modified_time ?? '');
  return Number.isFinite(t) ? t : 0;
};

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html', eml: 'message/rfc822',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

/** JSON:API listing of a folder, paged 50 at a time, newest first (sort=-modified_time). */
async function listFolder(cfg: WorkdriveConfig, fetchImpl: typeof fetch, folderId: string, trail: string, recursive: boolean, out: RemoteFile[]): Promise<void> {
  for (let offset = 0; ; offset += 50) {
    // sort=-last_modified: the live API (EU, 7 Oct 2026) answers "Invalid Param found" to -modified_time.
    const url = `${cfg.apiUrl}/files/${encodeURIComponent(folderId)}/files?page%5Blimit%5D=50&page%5Boffset%5D=${offset}&sort=-last_modified`;
    const res = await fetchImpl(url, { headers: await cfg.auth.headers({ accept: 'application/vnd.api+json' }) });
    if (!res.ok) throw new Error(`workdrive list ${folderId} failed (${res.status})`);
    const j: any = await res.json();
    const data: any[] = j.data ?? [];
    for (const d of data) {
      const a = d.attributes ?? {};
      const name: string = a.name ?? a.display_attr_name ?? d.id;
      if (a.is_folder === true || a.type === 'folder') {
        if (recursive) await listFolder(cfg, fetchImpl, d.id, `${trail}/${name}`, true, out);
        continue;
      }
      const ext = (a.extn ?? /\.([A-Za-z0-9]+)$/.exec(name)?.[1] ?? '').toLowerCase();
      // The byte count is storage_info.size_in_bytes; storage_info.size is a display string ("976.06 KB") on the live API.
      const size = Number(a.storage_info?.size_in_bytes ?? a.size_in_bytes ?? a.storage_info?.size ?? a.size ?? 0);
      out.push({
        id: d.id, name: /\.[A-Za-z0-9]+$/.test(name) || !ext ? name : `${name}.${ext}`, size: Number.isFinite(size) ? size : 0,
        mime: a.content_type ?? MIME_BY_EXT[ext] ?? 'application/octet-stream', modifiedMs: modifiedMs(a), path: trail, url: a.permalink,
        ...(typeof a.download_url === 'string' && /^https:\/\//.test(a.download_url) ? { download: a.download_url } : {}),
      });
    }
    if (data.length < 50) break;
  }
}

async function setCursor(db: Db, key: string, value: unknown): Promise<void> {
  await db.query(`INSERT INTO settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'ingest-sync') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = 'ingest-sync', updated_at = now()`, [key, JSON.stringify(value)]);
}

export interface WorkdriveOptions { fetchImpl?: typeof fetch; config?: WorkdriveConfig | null; map?: WorkdriveMap; now?: () => Date; /** Wave 6 (P59): use the Changes API after the first full listing (default true). */ changes?: boolean; /** 7 Oct 2026: new or changed files downloaded in one run (default WORKDRIVE_MAX_FILES_PER_RUN or 150); the rest wait for the next run, which lists in full. */ maxPerRun?: number }

/* ── wave 6 (P59): the Changes API, one cursor per mapped folder ── */
interface Change { action: string; group: string; resourceId: string | null; name: string | null; deleted: boolean }
interface ChangesPage { changes: Change[]; next: string | null; expired: boolean }

async function getCursor<T = any>(db: Db, key: string): Promise<T | null> {
  return (await db.query<{ value: T }>('SELECT value FROM settings WHERE key = $1', [key])).rows[0]?.value ?? null;
}

/** The start token for a folder: everything from now on. */
async function changesStart(cfg: WorkdriveConfig, fetchImpl: typeof fetch, folderId: string): Promise<string | null> {
  const res = await fetchImpl(`${cfg.apiUrl}/changes/${encodeURIComponent(folderId)}?page%5Btoken%5D=latest&page%5Blimit%5D=50`, { headers: await cfg.auth.headers({ accept: 'application/vnd.api+json' }) });
  if (!res.ok) return null;
  const j: any = await res.json().catch(() => ({}));
  return j?.data?.token ?? j?.data?.attributes?.token ?? j?.token ?? null;
}

/** The changes after a token. `expired` means the token is older than the API keeps (31 days) and a full listing is due. */
async function changesAfter(cfg: WorkdriveConfig, fetchImpl: typeof fetch, token: string): Promise<ChangesPage> {
  const out: ChangesPage = { changes: [], next: null, expired: false };
  let next: string | null = token;
  for (let page = 0; next && page < 40; page++) {
    const res = await fetchImpl(`${cfg.apiUrl}/changes?page%5Bnext%5D=${encodeURIComponent(next)}`, { headers: await cfg.auth.headers({ accept: 'application/vnd.api+json' }) });
    if (!res.ok) { if (res.status === 400 || res.status === 404 || res.status === 410) { out.expired = true; return out; } throw new Error(`workdrive changes failed (${res.status})`); }
    const j: any = await res.json();
    for (const d of j.data ?? []) {
      const a = d.attributes ?? d;
      out.changes.push({ action: String(a.action_category ?? a.action ?? '').toUpperCase(), group: String(a.resource_group ?? a.resource_type ?? '').toUpperCase(), resourceId: a.resource_id ?? a.resourceId ?? d.id ?? null, name: a.resource_name ?? null, deleted: a.is_deleted === true || String(a.action_category ?? '').toUpperCase() === 'DELETE' });
    }
    const cursor = j.cursor ?? j.data?.cursor ?? j.links ?? {};
    const token2 = cursor.next ?? j.data?.token ?? null;
    out.next = token2 ?? out.next;
    next = cursor.has_next && token2 ? token2 : null;
  }
  return out;
}

export async function syncWorkdrive(db: Db, sink: ItemSink, opts: WorkdriveOptions = {}): Promise<SyncStats> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const cfg = opts.config === undefined ? workdriveConfig(process.env, fetchImpl) : opts.config;
  const stats = emptyStats();
  if (!cfg) { stats.errors.push('ZOHO_WORKDRIVE_* is not configured'); return stats; }
  const map = opts.map ?? loadWorkdriveMap();
  const startedAt = (opts.now?.() ?? new Date()).toISOString();

  for (const folder of map.folders) {
    if (folder.enabled === false || /^EXAMPLE/i.test(folder.folder_id)) continue;
    // Wave 6 (P59): after the first full listing, ask the Changes API whether anything moved; list again only when it did.
    const cursorKey = `workdrive:changes:${folder.folder_id}`;
    let needList = true, nextToken: string | null = null;
    if (opts.changes !== false) {
      const stored = await getCursor<{ token: string }>(db, cursorKey);
      if (stored?.token) {
        try {
          const page = await changesAfter(cfg, fetchImpl, stored.token);
          if (page.expired) { needList = true; nextToken = null; stats.errors.push(`${folder.name ?? folder.folder_id}: changes token expired; full listing`); }
          else {
            nextToken = page.next ?? stored.token;
            const deleted = page.changes.filter(c => c.deleted && c.group !== 'FOLDER' && c.resourceId);
            for (const d of deleted) {
              const hid = await db.query(`UPDATE items SET hidden = true, extracted = extracted || '{"hidden_reason":"workdrive:deleted"}'::jsonb WHERE origin->>'source' = 'zoho-workdrive' AND external_id = $1 AND project_id = $2 AND NOT hidden RETURNING id`, [d.resourceId, folder.project_id]);
              stats.hidden = (stats.hidden ?? 0) + hid.rows.length;
            }
            needList = page.changes.some(c => !c.deleted);
            if (!needList) stats.unchanged_by_changes = (stats.unchanged_by_changes ?? 0) + 1;
          }
        } catch (e) { stats.errors.push(`${folder.name ?? folder.folder_id}: ${(e as Error).message}`); needList = true; }
      }
    }
    if (!needList) { if (nextToken) await setCursor(db, cursorKey, { token: nextToken, at: startedAt }); continue; }
    const files: RemoteFile[] = [];
    try { await listFolder(cfg, fetchImpl, folder.folder_id, folder.name ?? folder.folder_id, folder.recursive !== false, files); }
    catch (e) { stats.failed++; stats.errors.push((e as Error).message); continue; }
    // The changes cursor is stored only once every listed file has been handled: a run that defers files must list in full next time.
    const token = opts.changes !== false ? (nextToken ?? await changesStart(cfg, fetchImpl, folder.folder_id)) : null;
    files.sort((a, b) => a.modifiedMs - b.modifiedMs);
    stats.listed += files.length;
    const cap = Math.max(1, Number(opts.maxPerRun ?? process.env.WORKDRIVE_MAX_FILES_PER_RUN ?? 150) || 150);
    let downloaded = 0, deferred = 0;
    for (const f of files) {
      try {
        const known = (await db.query<{ id: string; extracted: any }>(
          `SELECT id, extracted FROM items WHERE origin->>'source' = 'zoho-workdrive' AND external_id = $1 AND project_id = $2`, [f.id, folder.project_id])).rows[0];
        const seenMs = Number(known?.extracted?.workdrive?.modified_ms ?? 0);
        if (known && f.modifiedMs && seenMs >= f.modifiedMs) {
          // A move keeps the item and its versions; only the path changes (wave 6, W6-AC10).
          if (known.extracted?.workdrive?.path !== f.path) { await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{workdrive,path}', to_jsonb($2::text)) WHERE id = $1`, [known.id, f.path]); stats.moved = (stats.moved ?? 0) + 1; }
          stats.unchanged++; continue;
        }
        if (f.size > MAX_BYTES) { stats.skipped++; stats.errors.push(`${f.name}: larger than ${MAX_BYTES} bytes, skipped`); continue; }
        if (downloaded >= cap) { deferred++; continue; }
        downloaded++;
        const dl = await fetchImpl(f.download ?? `${cfg.downloadUrl}/${encodeURIComponent(f.id)}`, { headers: await cfg.auth.headers() });
        if (!dl.ok) throw new Error(`workdrive download ${f.id} failed (${dl.status})`);
        const bytes = new Uint8Array(await dl.arrayBuffer());
        const meta: Record<string, unknown> = {
          type: folder.type || inferType(f.name, f.mime), title: f.name, project_id: folder.project_id,
          origin: { source: 'zoho-workdrive', external_id: f.id, ...(f.url ? { url: f.url } : {}), fetched_at: startedAt },
          filing: { method: 'path', confidence: 1, confirmed_by: null },
          extracted: { filename: f.name, workdrive: { modified_ms: f.modifiedMs, path: f.path, size: bytes.length } },
          ...(folder.legal_tag ? { legal_tag: folder.legal_tag } : {}),
        };
        const r = await sink({ meta, bytes, mime: f.mime, filename: f.name });
        if (r.deduplicated) {
          stats.unchanged++;
          if (known) await db.query(`UPDATE items SET extracted = extracted || jsonb_build_object('workdrive', coalesce(extracted->'workdrive', '{}'::jsonb) || $2::jsonb) WHERE id = $1`, [known.id, JSON.stringify({ modified_ms: f.modifiedMs })]);
        } else {
          if (r.version === 1) stats.created++; else stats.versioned++;
          stats.items.push({ id: r.id, version: r.version });
        }
      } catch (e) { stats.failed++; stats.errors.push(`${f.name}: ${(e as Error).message}`); }
    }
    if (deferred) {
      stats.deferred = (stats.deferred ?? 0) + deferred;
      (stats.notes ??= []).push(`${folder.name ?? folder.folder_id}: ${deferred} file${deferred === 1 ? '' : 's'} left for the next run (WORKDRIVE_MAX_FILES_PER_RUN=${cap})`);
      await db.query('DELETE FROM settings WHERE key = $1', [cursorKey]);
    } else if (token) await setCursor(db, cursorKey, { token, at: startedAt });
  }
  await setCursor(db, 'workdrive:last_sync', { at: startedAt, ...stats, items: undefined });
  return stats;
}
