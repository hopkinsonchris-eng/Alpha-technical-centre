/**
 * Staleness engine (M08). Recomputed from scratch on every run; no
 * incremental state. Rules are frozen in docs/vault-hub/modules/M08:
 *   R1 tool_version < aliases.current and a breaking version lies in (run, current]
 *   R2 an input of kind run refers to a run that is stale or superseded
 *   R3 an input of kind document|reference refers to an item whose latest
 *      version hash differs from the recorded hash (or the item is superseded)
 *   R4 the run's legal tag has expired (reported separately, record hidden)
 * An item is stale when anything in cites[] is stale or superseded.
 *
 * Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md §7.2, §7.3): a reference set (`ref:price_decks/<id>`) is
 * the item whose external_id is the reference id, so R3 fires when a new deck lands (G7). The advisory age flags
 * G1 to G6 are computed in a separate pass into runs.age_flags and items.age_flags and never set `stale`:
 *   G1 a live run is older than the newest foreground document on its project
 *   G2 a draft older than 90 days with a newer live run on the same job
 *   G3 a country brief past its max_age_days            (summary only: briefs carry no flag column)
 *   G4 a GEM dossier older than the tracker release the asset now carries
 *   G5 a register `current` with no source, or one older than a later accepted production fact   (summary only)
 *   G6 a milestone past its due date with no done_at     (summary only)
 */
import type { Db } from '../db/client.ts';
import { linkGemBasins } from '../assets/hierarchy.ts';

export interface StaleReason { rule: 'R1' | 'R2' | 'R3' | 'R4' | 'CITES'; ref: string; detail: string }
export interface AgeFlag { rule: 'G1' | 'G2' | 'G4'; ref: string; detail: string }
export interface AgeSummary {
  runs_checked: number; runs_flagged: number; items_checked: number; items_flagged: number;
  G3: { country: string; language: string; created_at: string; max_age_days: number; age_days: number }[];
  G5: string[];
  G6: { id: string; project_id: string; kind: string; title: string; due_at: string }[];
}
export interface StalenessSummary {
  runs_checked: number; runs_stale: number; items_checked: number; items_stale: number; expired: number; by_project: Record<string, { runs: number; items: number }>;
  age?: AgeSummary; gem_basins?: { linked: number; basins_created: number };
}

interface ToolRow { id: string; manifest: any }
interface RunRow { id: string; job: string; tool_version: string; status: string; supersedes: string | null; project_id: string; legal_tag: string; expires_at: string | null }
interface InputRow { run_id: string; ref: string; kind: string; version: string | null; hash: string | null }
interface ItemRow { id: string; project_id: string; content_hash: string; version: number; supersedes: string | null; expires_at: string | null; external_id: string | null; type: string }
interface CiteRow { item_id: string; ref: string }
interface Latest { hash: string; superseded: boolean; version: number | null }

export function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
  return 0;
}

/** R1 helper: is there a breaking version v with run < v <= current? */
export function breakingBetween(manifest: any, runVersion: string): { current: string; breaking: string | null } {
  const current: string = manifest?.aliases?.current ?? runVersion;
  if (cmpSemver(runVersion, current) >= 0) return { current, breaking: null };
  const versions: any[] = manifest?.versions ?? [];
  const b = versions.filter(v => v.breaking && cmpSemver(v.version, runVersion) > 0 && cmpSemver(v.version, current) <= 0)
    .sort((x, y) => cmpSemver(x.version, y.version))[0];
  return { current, breaking: b ? b.version : null };
}

export async function computeStaleness(db: Db, now = new Date()): Promise<StalenessSummary> {
  const today = now.toISOString().slice(0, 10);
  const tools = new Map((await db.query<ToolRow>('SELECT id, manifest FROM tools')).rows.map(t => [t.id, t.manifest]));
  const runs = (await db.query<RunRow>(`SELECT r.id::text AS id, r.job, r.tool_version, r.status, r.supersedes::text AS supersedes, r.project_id, r.legal_tag, lt.expires_at::text AS expires_at
                                         FROM runs r JOIN legal_tags lt ON lt.id = r.legal_tag WHERE NOT r.hidden`)).rows;
  const inputs = (await db.query<InputRow>('SELECT run_id::text AS run_id, ref, kind, version, hash FROM run_inputs')).rows;
  const items = (await db.query<ItemRow>(`SELECT i.id::text AS id, i.project_id, i.content_hash, i.version, i.supersedes::text AS supersedes, lt.expires_at::text AS expires_at, i.external_id, i.type
                                           FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag WHERE NOT i.hidden`)).rows;
  const cites = (await db.query<CiteRow>('SELECT item_id::text AS item_id, ref FROM item_cites')).rows;

  // Latest version per item lineage: an item is "latest" unless another item supersedes it.
  const supersededItems = new Set(items.map(i => i.supersedes).filter((x): x is string => !!x));
  const itemById = new Map(items.map(i => [i.id, i]));
  const latestHashOf = (id: string): Latest | null => {
    let cur = itemById.get(id); if (!cur) return null;
    const superseded = supersededItems.has(id);
    // walk forward to the newest version in the chain
    let guard = 0;
    while (guard++ < 1000) {
      const next = items.find(i => i.supersedes === cur!.id);
      if (!next) break; cur = next;
    }
    return { hash: cur.content_hash, superseded, version: Number.isFinite(Number(cur.version)) ? Number(cur.version) : null };
  };
  const versionOf = (v: string | null): number | null => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

  const runById = new Map(runs.map(r => [r.id, r]));
  const inputsByRun = new Map<string, InputRow[]>();
  for (const i of inputs) (inputsByRun.get(i.run_id) ?? inputsByRun.set(i.run_id, []).get(i.run_id)!).push(i);
  const supersededRuns = new Set(runs.map(r => r.supersedes).filter((x): x is string => !!x));

  const runReasons = new Map<string, StaleReason[]>();
  const expired = new Set<string>();
  // Iterate to a fixed point so R2 propagates through chains of runs.
  let changed = true, passes = 0;
  while (changed && passes++ < 50) {
    changed = false;
    for (const r of runs) {
      if (r.status === 'superseded') continue;
      const reasons: StaleReason[] = [];
      if (r.expires_at && r.expires_at < today) { expired.add(r.id); reasons.push({ rule: 'R4', ref: `tag:${r.legal_tag}`, detail: `legal tag expired ${r.expires_at}` }); }
      const m = tools.get(r.job);
      if (m) {
        const { current, breaking } = breakingBetween(m, r.tool_version);
        if (breaking) reasons.push({ rule: 'R1', ref: `tool:${r.job}`, detail: `run on ${r.tool_version}; ${breaking} is breaking; current is ${current}` });
      }
      for (const inp of inputsByRun.get(r.id) ?? []) {
        if (inp.kind === 'run') {
          const id = inp.ref.replace(/^run:/, '');
          const dep = runById.get(id);
          if (!dep) continue;
          if (dep.status === 'superseded' || supersededRuns.has(id)) reasons.push({ rule: 'R2', ref: inp.ref, detail: 'input run superseded' });
          else if ((runReasons.get(id) ?? []).length) reasons.push({ rule: 'R2', ref: inp.ref, detail: 'input run is stale' });
        } else if (inp.kind === 'document' || inp.kind === 'reference') {
          const id = inp.ref.replace(/^(doc|ref):/, '');
          const latest = latestHashOf(id) ?? (inp.kind === 'reference' ? latestRefByExternalId(items, inp.ref, latestHashOf) : null);
          if (!latest) continue;
          const recorded = versionOf(inp.version);
          if (latest.superseded) reasons.push({ rule: 'R3', ref: inp.ref, detail: 'input item superseded' });
          else if (inp.hash && latest.hash !== inp.hash) reasons.push({ rule: 'R3', ref: inp.ref, detail: `input changed: recorded ${inp.hash.slice(0, 15)}…, now ${latest.hash.slice(0, 15)}…` });
          else if (!inp.hash && recorded !== null && latest.version !== null && latest.version > recorded) reasons.push({ rule: 'R3', ref: inp.ref, detail: `input changed: recorded version ${recorded}, now ${latest.version}` });
        }
      }
      const prev = runReasons.get(r.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(reasons)) { runReasons.set(r.id, reasons); changed = true; }
    }
  }

  // Items: stale when any cited run/item is stale or superseded.
  const citesByItem = new Map<string, string[]>();
  for (const c of cites) (citesByItem.get(c.item_id) ?? citesByItem.set(c.item_id, []).get(c.item_id)!).push(c.ref);
  const itemReasons = new Map<string, StaleReason[]>();
  changed = true; passes = 0;
  while (changed && passes++ < 50) {
    changed = false;
    for (const it of items) {
      const reasons: StaleReason[] = [];
      for (const ref of citesByItem.get(it.id) ?? []) {
        if (ref.startsWith('run:')) {
          const id = ref.slice(4); const dep = runById.get(id);
          if (!dep) continue;
          if (dep.status === 'superseded' || supersededRuns.has(id)) reasons.push({ rule: 'CITES', ref, detail: 'cited run superseded' });
          else if ((runReasons.get(id) ?? []).length) reasons.push({ rule: 'CITES', ref, detail: 'cited run is stale' });
        } else if (ref.startsWith('doc:')) {
          const id = ref.slice(4);
          if (supersededItems.has(id)) reasons.push({ rule: 'CITES', ref, detail: 'cited document superseded' });
          else if ((itemReasons.get(id) ?? []).length) reasons.push({ rule: 'CITES', ref, detail: 'cited document is stale' });
        }
      }
      const prev = itemReasons.get(it.id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(reasons)) { itemReasons.set(it.id, reasons); changed = true; }
    }
  }

  const summary: StalenessSummary = { runs_checked: runs.length, runs_stale: 0, items_checked: items.length, items_stale: 0, expired: expired.size, by_project: {} };
  const bump = (p: string, k: 'runs' | 'items') => { (summary.by_project[p] ??= { runs: 0, items: 0 })[k]++; };
  for (const r of runs) {
    const reasons = runReasons.get(r.id) ?? [];
    const stale = reasons.some(x => x.rule !== 'R4');
    if (stale) { summary.runs_stale++; bump(r.project_id, 'runs'); }
    await db.query('UPDATE runs SET stale=$2, stale_reasons=$3::jsonb, hidden = hidden OR $4 WHERE id=$1::uuid', [r.id, stale, JSON.stringify(reasons), expired.has(r.id)]);
  }
  for (const it of items) {
    const reasons = itemReasons.get(it.id) ?? [];
    const stale = reasons.length > 0;
    if (stale) { summary.items_stale++; bump(it.project_id, 'items'); }
    await db.query('UPDATE items SET stale=$2, stale_reasons=$3::jsonb WHERE id=$1::uuid', [it.id, stale, JSON.stringify(reasons)]);
  }
  return summary;
}

/**
 * A reference set is the item whose external_id is the reference id (`ref:price_decks/brent-2026-09` →
 * `price_decks/brent-2026-09`), filed by seedMaster from vault/reference with origin.source 'tool'. A new version
 * bumps the row's version and hash (seed) or adds a row that supersedes it (POST /api/items); either way the
 * newest version in the chain is what the run is held against. Nothing filed: nothing to compare, never stale.
 */
function latestRefByExternalId(items: ItemRow[], ref: string, latestOf: (id: string) => Latest | null): Latest | null {
  const externalId = ref.replace(/^ref:/, '');
  if (!externalId) return null;
  const candidates = items.filter(i => i.external_id === externalId && i.type === 'reference-set');
  const pool = candidates.length ? candidates : items.filter(i => i.external_id === externalId);
  if (!pool.length) return null;
  // The newest row of the lineage: the one nothing supersedes, highest version first when several roots exist.
  const superseded = new Set(items.map(i => i.supersedes).filter((x): x is string => !!x));
  const heads = pool.filter(i => !superseded.has(i.id)).sort((a, b) => Number(b.version) - Number(a.version) || a.id.localeCompare(b.id));
  const head = heads[0] ?? pool[0];
  const latest = latestOf(head.id);
  return latest ? { ...latest, superseded: false } : null;
}

/* ── advisory age (wave 7 PR3, 03 §7.3) ─────────────────────────────── */

const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
/** "March 2026" → a date; anything else → null. */
export function parseRelease(s: unknown): Date | null {
  const m = /^\s*([A-Za-z]+)\s+(20\d\d)\s*$/.exec(String(s ?? ''));
  if (!m || MONTHS[m[1].toLowerCase()] === undefined) return null;
  return new Date(Date.UTC(Number(m[2]), MONTHS[m[1].toLowerCase()], 1));
}
const ymd = (d: unknown): string => new Date(d as any).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** The item types that count as a delivered or received document for G1: what a letter, report or data-room file says is "the record". */
const FOREGROUND_TYPES = ['letter', 'report', 'spreadsheet', 'data-room-file'];

export async function computeAgeFlags(db: Db, now = new Date()): Promise<AgeSummary> {
  const runs = (await db.query<{ id: string; job: string; project_id: string; status: string; created_at: string; age_flags: AgeFlag[] }>(
    'SELECT id::text AS id, job, project_id, status, created_at, age_flags FROM runs WHERE NOT hidden ORDER BY created_at, id')).rows;
  // The newest foreground document per project: the listed types, and a human email that carries an attachment; never a draft, a finding, a dossier, history or bulk mail.
  const docs = (await db.query<{ id: string; project_id: string; title: string; at: string }>(
    `SELECT DISTINCT ON (i.project_id) i.id::text AS id, i.project_id, i.title, coalesce(i.authored_at, i.created_at) AS at FROM items i
      WHERE NOT i.hidden AND coalesce(i.extracted->>'kind', '') NOT IN ('draft', 'research', 'dossier') AND coalesce(i.extracted->>'history', 'false') <> 'true' AND coalesce(i.extracted->>'category', '') <> 'bulk'
        AND (i.type = ANY($1::text[]) OR (i.type = 'email' AND EXISTS (SELECT 1 FROM items c WHERE c.parent_id = i.id)))
      ORDER BY i.project_id, coalesce(i.authored_at, i.created_at) DESC, i.id`, [FOREGROUND_TYPES])).rows;
  const newestDoc = new Map(docs.map(d => [d.project_id, d]));
  const live = runs.filter(r => r.status !== 'superseded');
  const newestOnJob = new Map<string, typeof runs[number]>();
  for (const r of live) { const k = `${r.project_id}|${r.job}`; const cur = newestOnJob.get(k); if (!cur || new Date(r.created_at) > new Date(cur.created_at)) newestOnJob.set(k, r); }

  const summary: AgeSummary = { runs_checked: runs.length, runs_flagged: 0, items_checked: 0, items_flagged: 0, G3: [], G5: [], G6: [] };
  for (const r of runs) {
    const flags: AgeFlag[] = [];
    if (r.status !== 'superseded') {
      const created = new Date(r.created_at);
      const doc = newestDoc.get(r.project_id);
      if (doc && new Date(doc.at) > created) flags.push({ rule: 'G1', ref: `doc:${doc.id}`, detail: `older than ${doc.title}, ${ymd(doc.at)}: check its inputs` });
      const newer = newestOnJob.get(`${r.project_id}|${r.job}`);
      if (r.status === 'draft' && now.getTime() - created.getTime() > 90 * DAY && newer && newer.id !== r.id && new Date(newer.created_at) > created) {
        flags.push({ rule: 'G2', ref: `run:${newer.id}`, detail: `draft superseded in practice: a newer run on ${r.job} from ${ymd(newer.created_at)}` });
      }
    }
    if (flags.length) summary.runs_flagged++;
    if (JSON.stringify(flags) !== JSON.stringify(r.age_flags ?? [])) await db.query('UPDATE runs SET age_flags = $2::jsonb WHERE id = $1::uuid', [r.id, JSON.stringify(flags)]);
  }

  // G4: a GEM dossier older than the release the asset now carries.
  const dossiers = (await db.query<{ id: string; asset_id: string | null; release: string | null; age_flags: AgeFlag[] }>(
    `SELECT id::text AS id, extracted->>'asset_id' AS asset_id, extracted->>'release' AS release, age_flags FROM items WHERE NOT hidden AND extracted->>'kind' = 'dossier' AND extracted->>'source' = 'gem'`)).rows;
  const assetRelease = new Map((await db.query<{ id: string; release: string | null }>("SELECT id, props->'gem'->>'release' AS release FROM assets WHERE props ? 'gem'")).rows.map(a => [a.id, a.release]));
  summary.items_checked = dossiers.length;
  for (const d of dossiers) {
    const flags: AgeFlag[] = [];
    const mine = parseRelease(d.release), theirs = d.asset_id ? parseRelease(assetRelease.get(d.asset_id)) : null;
    if (mine && theirs && theirs > mine) flags.push({ rule: 'G4', ref: `asset:${d.asset_id}`, detail: `GEM release moved: refresh dossier (dossier from ${d.release}, tracker now ${assetRelease.get(d.asset_id!)})` });
    if (flags.length) summary.items_flagged++;
    if (JSON.stringify(flags) !== JSON.stringify(d.age_flags ?? [])) await db.query('UPDATE items SET age_flags = $2::jsonb WHERE id = $1::uuid', [d.id, JSON.stringify(flags)]);
  }
  // Any other item that carries a stale age flag from an earlier pass loses it (recomputed from scratch, like staleness).
  await db.query(`UPDATE items SET age_flags = '[]'::jsonb WHERE age_flags <> '[]'::jsonb AND NOT (NOT hidden AND coalesce(extracted->>'kind', '') = 'dossier' AND coalesce(extracted->>'source', '') = 'gem')`);

  // G3: the newest brief per country and language, past its own max age.
  const briefs = (await db.query<{ country: string; language: string; created_at: string; max_age_days: number }>(
    'SELECT DISTINCT ON (country, language) country, language, created_at, max_age_days FROM country_briefs ORDER BY country, language, created_at DESC')).rows;
  for (const b of briefs) {
    const age = Math.floor((now.getTime() - new Date(b.created_at).getTime()) / DAY);
    if (age > b.max_age_days) summary.G3.push({ country: b.country.trim(), language: b.language, created_at: new Date(b.created_at).toISOString(), max_age_days: b.max_age_days, age_days: age });
  }
  // G5: a register `current` with no source, or a source older than a later accepted production fact.
  const accepted = new Map((await db.query<{ project_id: string; at: string }>(
    `SELECT payload->>'project_id' AS project_id, max(resolved_at) AS at FROM review_queue WHERE status = 'accepted' AND payload->>'fact_kind' = 'production' AND payload->>'project_id' IS NOT NULL GROUP BY 1`)).rows.map(r => [r.project_id, r.at]));
  const projects = (await db.query<{ id: string; current: string | null; accepted_at: string | null }>(
    `SELECT id, register->>'current' AS current, register->'current_source'->>'accepted_at' AS accepted_at FROM projects WHERE status <> 'archived' AND coalesce(register->>'current', '') <> '' ORDER BY id`)).rows;
  for (const p of projects) {
    const later = accepted.get(p.id);
    if (!p.accepted_at || (later && new Date(later) > new Date(p.accepted_at))) summary.G5.push(p.id);
  }
  // G6: a dated obligation past due with nothing done.
  summary.G6 = (await db.query<{ id: string; project_id: string; kind: string; title: string; due_at: string }>(
    'SELECT id::text AS id, project_id, kind, title, due_at::text AS due_at FROM project_milestones WHERE done_at IS NULL AND due_at IS NOT NULL AND due_at < $1::date ORDER BY due_at, id', [now.toISOString().slice(0, 10)])).rows;
  return summary;
}

export async function runStalenessJob(db: Db, now = new Date()): Promise<StalenessSummary> {
  const { rows } = await db.query<{ id: number }>("INSERT INTO jobs (name) VALUES ('nightly-staleness') RETURNING id");
  try {
    const summary = await computeStaleness(db, now);
    summary.age = await computeAgeFlags(db, now);
    // Wave 7 PR3 (S6): GEM units seeded without their basin are linked on the same night (a no-op once done).
    summary.gem_basins = await linkGemBasins(db);
    await db.query("UPDATE jobs SET finished_at=now(), status='ok', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify(summary)]);
    await db.query("INSERT INTO audit_events (person_id, action, scope, detail) VALUES ('job:nightly-staleness','staleness.run','firm',$1::jsonb)", [JSON.stringify(summary)]);
    return summary;
  } catch (e) {
    await db.query("UPDATE jobs SET finished_at=now(), status='failed', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify({ error: (e as Error).message })]);
    throw e;
  }
}
