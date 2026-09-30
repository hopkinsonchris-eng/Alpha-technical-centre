/**
 * Radar bridge (M11). Two directions between the insight-radar skill and the Vault:
 *  - importRadarLedger: every URL cited by an edition in insights-data/radar-ledger.json
 *    becomes a paper item (deduplicated by URL, across all sources)
 *  - readingList: the papers the skill offers as its reading list, read from the
 *    Vault instead of a gitignored folder (the same rows as GET /api/items?type=paper&since=)
 * Radar items carry no abstract; they are leads and citations, not extraction input.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { isVisible, parseScope, type LegalTag } from '../legal.ts';
import { openStorage, type Storage } from '../storage.ts';
import { ensureMinerBase, LT_PAPER, sha256, upsertItem } from './run.ts';
import { stableStringify } from './util.ts';

export const LEDGER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../insights-data/radar-ledger.json');

export interface LedgerEdition {
  edition: string; slug?: string; filename?: string; published?: string; title?: string;
  developments?: { name: string; discipline?: string; tier?: string; readiness?: number; urls?: string[] }[];
  sources?: { title?: string; url: string; tier?: string }[];
}

/** Compare URLs without scheme, `www.`, fragment, tracking parameters or a trailing slash. */
export function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/i.test(k)) x.searchParams.delete(k);
    const qs = x.searchParams.toString();
    return `${x.hostname.toLowerCase().replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${qs ? `?${qs}` : ''}`;
  } catch { return u.trim().toLowerCase(); }
}

export interface RadarImportSummary { editions: number; urls: number; created: number; existing: number; updated: number }

export async function importRadarLedger(db: Db, opts: { ledgerPath?: string; storage?: Storage; now?: Date } = {}): Promise<RadarImportSummary> {
  const file = opts.ledgerPath ?? LEDGER_PATH;
  const out: RadarImportSummary = { editions: 0, urls: 0, created: 0, existing: 0, updated: 0 };
  if (!existsSync(file)) return out;
  const ledger = JSON.parse(readFileSync(file, 'utf8')) as { editions?: LedgerEdition[] };
  const now = opts.now ?? new Date();
  const storage = opts.storage ?? openStorage();
  await ensureMinerBase(db);

  const known = new Map<string, string>(); // normalised url -> item id
  for (const r of (await db.query<any>(`SELECT id, origin->>'url' AS url, external_id FROM items WHERE type = 'paper' AND NOT hidden`)).rows) {
    for (const u of [r.url, r.external_id]) if (typeof u === 'string' && /^https?:/i.test(u)) known.set(normUrl(u), r.id);
  }

  for (const ed of ledger.editions ?? []) {
    out.editions++;
    const leads = new Map<string, { url: string; title: string; tier?: string; discipline?: string; readiness?: number; developments: string[] }>();
    for (const d of ed.developments ?? []) {
      for (const url of d.urls ?? []) {
        const l = leads.get(normUrl(url)) ?? { url, title: d.name, tier: d.tier, discipline: d.discipline, readiness: d.readiness, developments: [] };
        l.developments.push(d.name); leads.set(normUrl(url), l);
      }
    }
    for (const s of ed.sources ?? []) {
      const l = leads.get(normUrl(s.url)) ?? { url: s.url, title: s.title ?? s.url, tier: s.tier, developments: [] as string[] };
      if (s.title) l.title = s.title; // a source's own title beats the development's name
      leads.set(normUrl(s.url), l);
    }
    for (const [key, l] of leads) {
      const url = l.url;
      out.urls++;
      if (known.has(key)) { out.existing++; continue; }
      const payload = Buffer.from(stableStringify({ title: l.title, url, edition: ed.edition, developments: l.developments }));
      const r = await upsertItem(db, storage, {
        type: 'paper', title: l.title, authored_at: null, authors: [], legal_tag: LT_PAPER,
        origin: { source: 'assistant', external_id: url, url, fetched_at: now.toISOString() },
        bytes: payload, mime: 'application/json',
        extracted: {
          manifest: { url, fetched_at: now.toISOString(), sha256: sha256(payload), rows: 1 },
          radar: { edition: ed.edition, ...(ed.slug ? { slug: ed.slug } : {}), ...(l.discipline ? { discipline: l.discipline } : {}), ...(l.tier ? { tier: l.tier } : {}), ...(l.readiness != null ? { readiness: l.readiness } : {}), developments: [...new Set(l.developments)] },
        },
        tags: [`radar:${ed.edition}`, ...(l.tier ? [`tier:${l.tier}`] : []), 'miner:radar-ledger'],
      }, now);
      known.set(key, r.id);
      out[r.status === 'created' ? 'created' : r.status === 'updated' ? 'updated' : 'existing']++;
    }
  }
  return out;
}

export interface ReadingListEntry {
  id: string; title: string; url: string | null; doi: string | null; authors: string[]; authored_at: string | null; added_at: string;
  source: string; legal_tag: string; tags: string[]; abstract_chars: number; topic_id: string | null; radar_edition: string | null;
}

/**
 * Papers added to the Vault at or after `since`, newest first: the skill's reading list.
 * Visible under the firm scope only, so nothing tagged for a client can reach the article pipeline.
 */
export async function readingList(db: Db, since: Date | string, opts: { limit?: number; now?: Date } = {}): Promise<ReadingListEntry[]> {
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) throw new Error('since must be a date');
  const now = opts.now ?? new Date();
  const rows = (await db.query<any>(
    `SELECT i.id, i.title, i.authors, i.authored_at, i.created_at, i.origin, i.legal_tag, i.tags, i.extracted,
            lt.classification, lt.data_type, lt.client_id, lt.contract_id, lt.country_of_origin, lt.originator, to_char(lt.expires_at,'YYYY-MM-DD') AS expires_at,
            lt.personal_data, lt.export_restricted, lt.partners_only
       FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag
      WHERE i.type = 'paper' AND NOT i.hidden AND i.created_at >= $1 ORDER BY i.created_at DESC, i.id`, [from.toISOString()])).rows;
  const scope = { ...parseScope('firm', () => undefined), is_partner: false };
  const out: ReadingListEntry[] = [];
  for (const r of rows) {
    const tag: LegalTag = { id: r.legal_tag, classification: r.classification, data_type: r.data_type, client_id: r.client_id, contract_id: r.contract_id, country_of_origin: r.country_of_origin,
      originator: r.originator, expires_at: r.expires_at, personal_data: r.personal_data, export_restricted: r.export_restricted, partners_only: r.partners_only };
    if (!isVisible(tag, scope, now)) continue;
    const ex = r.extracted ?? {};
    out.push({
      id: r.id, title: r.title, url: r.origin?.url ?? null, doi: ex.doi ?? null, authors: r.authors ?? [], authored_at: r.authored_at ? new Date(r.authored_at).toISOString() : null,
      added_at: new Date(r.created_at).toISOString(), source: r.origin?.source ?? 'unknown', legal_tag: r.legal_tag, tags: r.tags ?? [],
      abstract_chars: ex.abstract_chars ?? 0, topic_id: ex.topic_id ?? null, radar_edition: ex.radar?.edition ?? null,
    });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}
