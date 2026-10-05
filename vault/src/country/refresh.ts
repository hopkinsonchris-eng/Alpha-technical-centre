/**
 * Keeping the country pack fresh (wave 7 PR5, W7-AC20; docs/vault-hub/wave7/04-step-changes.md P1 step 4).
 *   markStale(db, now)        nightly, from the staleness job: a section is 'due' once built_at + ttl_days has passed
 *                             and 'stale' (stale_reason 'source_changed:<item id>') when a source item has a newer
 *                             version: a different content hash on the same row, or a row that supersedes it
 *   refreshStale(db, opts)    weekly: for every country with an active or prospect project, rebuild its due and stale
 *                             sections only, under the per-build budget, writing what changed; a country with no
 *                             active project is never refreshed; spend is audited per section (cost page, 'country-pack')
 * Both only ever move a head row's status forward or write a new version; no row is deleted.
 */
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { audit } from '../audit.ts';
import { draftSectionsWithSummary, type DraftCtx, type DraftSummary, type PackSourceRef } from '../llm/country-pack.ts';
import { SECTION_IDS, type PackStatus, type SectionId } from './types.ts';

const DAY = 86_400_000;
const hex = (h: string | null | undefined) => String(h ?? '').replace(/^sha256:/, '').toLowerCase();

interface Head { id: string; country: string; section: SectionId; status: PackStatus; stale_reason: string | null; built_at: string; ttl_days: number; sources: PackSourceRef[] }
const heads = async (db: Db, country?: string): Promise<Head[]> =>
  (await db.query<Head>(`SELECT id::text AS id, trim(country) AS country, section, status, stale_reason, built_at, ttl_days, sources FROM country_packs
                          WHERE superseded_by IS NULL ${country ? 'AND country = $1' : ''} ORDER BY country, section`, country ? [country] : [])).rows;

/** The newest row of an item's lineage (walking `supersedes` forward) with its hash; null when the item is gone. */
export async function latestVersionOf(db: Db, itemId: string): Promise<{ id: string; hash: string; version: number; fetched_at: string | null } | null> {
  let cur = (await db.query<any>("SELECT id::text AS id, content_hash, version, origin->>'fetched_at' AS fetched_at FROM items WHERE id = $1", [itemId])).rows[0];
  if (!cur) return null;
  for (let guard = 0; guard < 1000; guard++) {
    const next = (await db.query<any>("SELECT id::text AS id, content_hash, version, origin->>'fetched_at' AS fetched_at FROM items WHERE supersedes = $1 AND NOT hidden ORDER BY version DESC LIMIT 1", [cur.id])).rows[0];
    if (!next) break;
    cur = next;
  }
  return { id: cur.id, hash: hex(cur.content_hash), version: Number(cur.version) || 1, fetched_at: cur.fetched_at ?? null };
}

export interface MarkSummary { checked: number; due: number; stale: number }

export async function markStale(db: Db, now = new Date()): Promise<MarkSummary> {
  const summary: MarkSummary = { checked: 0, due: 0, stale: 0 };
  for (const h of await heads(db)) {
    summary.checked++;
    if (h.status === 'stale') continue;
    // A changed source outranks the clock: check it first, on fresh and due sections alike.
    let changed: string | null = null;
    for (const s of h.sources ?? []) {
      if (!s.item_id) continue;
      const latest = await latestVersionOf(db, s.item_id);
      if (!latest) continue;
      if (latest.id !== s.item_id || (s.sha256 && latest.hash !== hex(s.sha256))) { changed = latest.id; break; }
    }
    if (changed) {
      await db.query("UPDATE country_packs SET status = 'stale', stale_reason = $2 WHERE id = $1", [h.id, `source_changed:${changed}`]);
      summary.stale++;
      continue;
    }
    if (h.status === 'due') continue;
    if (new Date(h.built_at).getTime() + Number(h.ttl_days) * DAY <= now.getTime()) {
      await db.query("UPDATE country_packs SET status = 'due', stale_reason = 'ttl' WHERE id = $1", [h.id]);
      summary.due++;
    }
  }
  return summary;
}

export interface RefreshOpts {
  provider: LlmProvider | null; now?: Date; budgetGbp: number; by?: string;
  /** The job's own fetch, when wired: re-fetches the sections' sources and returns them resolved. Absent, the previous build's sources are reused at their newest stored version (nothing is fetched). */
  sources?: (country: string, sections: SectionId[]) => Promise<DraftCtx['sections']>;
}
export interface RefreshSummary {
  job_id: number; countries: { country: string; sections: DraftSummary['sections']; spend_gbp: number; stopped_by: 'budget' | null }[];
  rebuilt: number; changed: { country: string; section: SectionId; lines: number }[]; spend_gbp: number; skipped_no_project: string[];
}

/** The sources of the previous build, each pointed at the newest stored version of its item; unreachable ones stay as they were. */
async function reuseSources(db: Db, country: string, sections: SectionId[]): Promise<DraftCtx['sections']> {
  const out: DraftCtx['sections'] = [];
  for (const h of (await heads(db, country)).filter(h => sections.includes(h.section))) {
    const sources: PackSourceRef[] = [];
    for (const s of h.sources ?? []) {
      if (!s.item_id || s.id === 'world-monitor') { if (s.id !== 'world-monitor') sources.push(s); continue; }
      const latest = await latestVersionOf(db, s.item_id);
      sources.push(latest ? { ...s, item_id: latest.id, sha256: latest.hash, fetched_at: latest.fetched_at ?? s.fetched_at, reachable: true } : s);
    }
    out.push({ section: h.section, sources, ttl_days: Number(h.ttl_days) });
  }
  return out;
}

export async function refreshStale(db: Db, opts: RefreshOpts): Promise<RefreshSummary> {
  const now = opts.now ?? new Date();
  const by = opts.by ?? 'job:country-pack-refresh';
  const { rows } = await db.query<{ id: number }>("INSERT INTO jobs (name) VALUES ('country-pack-refresh') RETURNING id");
  const jobId = Number(rows[0].id);
  const summary: RefreshSummary = { job_id: jobId, countries: [], rebuilt: 0, changed: [], spend_gbp: 0, skipped_no_project: [] };
  try {
    const active = new Set((await db.query<{ country: string }>("SELECT DISTINCT upper(trim(country)) AS country FROM projects WHERE status IN ('active', 'prospect') AND country IS NOT NULL AND trim(country) <> ''")).rows.map(r => r.country));
    const work = new Map<string, SectionId[]>();
    for (const h of await heads(db)) {
      if (h.status !== 'due' && h.status !== 'stale') continue;
      if (!active.has(h.country)) { if (!summary.skipped_no_project.includes(h.country)) summary.skipped_no_project.push(h.country); continue; }
      (work.get(h.country) ?? work.set(h.country, []).get(h.country)!).push(h.section);
    }
    for (const [country, list] of [...work.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const order = new Map(SECTION_IDS.map((s, i) => [s, i]));
      const sections = [...new Set(list)].sort((a, b) => order.get(a)! - order.get(b)!);
      const resolved = opts.sources ? await opts.sources(country, sections) : await reuseSources(db, country, sections);
      // The derived section follows whenever anything else is rebuilt.
      if (!resolved.some(s => s.section === 'questions') && resolved.length) resolved.push({ section: 'questions', sources: [] });
      const r = await draftSectionsWithSummary({ db, provider: opts.provider, country, jobId, by, now, budgetGbp: opts.budgetGbp, sections: resolved, refresh: true });
      const rebuilt = r.sections.filter(s => s.stale_reason !== 'budget' && s.section !== 'questions');
      summary.countries.push({ country, sections: r.sections, spend_gbp: r.spend_gbp, stopped_by: r.stopped_by });
      summary.rebuilt += rebuilt.length;
      for (const s of r.sections) if (s.changed) summary.changed.push({ country, section: s.section, lines: s.changed });
      summary.spend_gbp = Math.round((summary.spend_gbp + r.spend_gbp) * 10000) / 10000;
    }
    await db.query("UPDATE jobs SET finished_at = now(), status = 'ok', summary = $2::jsonb WHERE id = $1", [jobId, JSON.stringify({ countries: summary.countries.map(c => ({ country: c.country, sections: c.sections.length, spend_gbp: c.spend_gbp, stopped_by: c.stopped_by })), rebuilt: summary.rebuilt, changed: summary.changed, spend_gbp: summary.spend_gbp, skipped_no_project: summary.skipped_no_project })]);
    await audit(db, by, 'country-pack.refresh', 'public', summary.countries.map(c => `country:${c.country}`), { job_id: jobId, rebuilt: summary.rebuilt, changed: summary.changed.length, spend_gbp: summary.spend_gbp, skipped_no_project: summary.skipped_no_project.length });
    return summary;
  } catch (e) {
    await db.query("UPDATE jobs SET finished_at = now(), status = 'failed', summary = $2::jsonb WHERE id = $1", [jobId, JSON.stringify({ error: (e as Error).message, rebuilt: summary.rebuilt, spend_gbp: summary.spend_gbp })]);
    throw e;
  }
}
