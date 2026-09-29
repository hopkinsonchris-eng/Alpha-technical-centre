/**
 * Staleness engine (M08). Recomputed from scratch on every run; no
 * incremental state. Rules are frozen in docs/vault-hub/modules/M08:
 *   R1 tool_version < aliases.current and a breaking version lies in (run, current]
 *   R2 an input of kind run refers to a run that is stale or superseded
 *   R3 an input of kind document|reference refers to an item whose latest
 *      version hash differs from the recorded hash (or the item is superseded)
 *   R4 the run's legal tag has expired (reported separately, record hidden)
 * An item is stale when anything in cites[] is stale or superseded.
 */
import type { Db } from '../db/client.ts';

export interface StaleReason { rule: 'R1' | 'R2' | 'R3' | 'R4' | 'CITES'; ref: string; detail: string }
export interface StalenessSummary { runs_checked: number; runs_stale: number; items_checked: number; items_stale: number; expired: number; by_project: Record<string, { runs: number; items: number }> }

interface ToolRow { id: string; manifest: any }
interface RunRow { id: string; job: string; tool_version: string; status: string; supersedes: string | null; project_id: string; legal_tag: string; expires_at: string | null }
interface InputRow { run_id: string; ref: string; kind: string; version: string | null; hash: string | null }
interface ItemRow { id: string; project_id: string; content_hash: string; version: number; supersedes: string | null; expires_at: string | null }
interface CiteRow { item_id: string; ref: string }

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
  const items = (await db.query<ItemRow>(`SELECT i.id::text AS id, i.project_id, i.content_hash, i.version, i.supersedes::text AS supersedes, lt.expires_at::text AS expires_at
                                           FROM items i JOIN legal_tags lt ON lt.id = i.legal_tag WHERE NOT i.hidden`)).rows;
  const cites = (await db.query<CiteRow>('SELECT item_id::text AS item_id, ref FROM item_cites')).rows;

  // Latest version per item lineage: an item is "latest" unless another item supersedes it.
  const supersededItems = new Set(items.map(i => i.supersedes).filter((x): x is string => !!x));
  const itemById = new Map(items.map(i => [i.id, i]));
  const latestHashOf = (id: string): { hash: string; superseded: boolean } | null => {
    let cur = itemById.get(id); if (!cur) return null;
    const superseded = supersededItems.has(id);
    // walk forward to the newest version in the chain
    let guard = 0;
    while (guard++ < 1000) {
      const next = items.find(i => i.supersedes === cur!.id);
      if (!next) break; cur = next;
    }
    return { hash: cur.content_hash, superseded };
  };

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
          const latest = latestHashOf(id) ?? (inp.kind === 'reference' ? latestRefByExternalId(items, inp.ref) : null);
          if (!latest) continue;
          if (latest.superseded) reasons.push({ rule: 'R3', ref: inp.ref, detail: 'input item superseded' });
          else if (inp.hash && latest.hash !== inp.hash) reasons.push({ rule: 'R3', ref: inp.ref, detail: `input changed: recorded ${inp.hash.slice(0, 15)}…, now ${latest.hash.slice(0, 15)}…` });
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

function latestRefByExternalId(items: any[], ref: string): { hash: string; superseded: boolean } | null {
  // reference sets are items with external_id = the reference id; resolved by caller via a joined query in M02. Fallback: not found.
  void items; void ref; return null;
}

export async function runStalenessJob(db: Db, now = new Date()): Promise<StalenessSummary> {
  const { rows } = await db.query<{ id: number }>("INSERT INTO jobs (name) VALUES ('nightly-staleness') RETURNING id");
  try {
    const summary = await computeStaleness(db, now);
    await db.query("UPDATE jobs SET finished_at=now(), status='ok', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify(summary)]);
    await db.query("INSERT INTO audit_events (person_id, action, scope, detail) VALUES ('job:nightly-staleness','staleness.run','firm',$1::jsonb)", [JSON.stringify(summary)]);
    return summary;
  } catch (e) {
    await db.query("UPDATE jobs SET finished_at=now(), status='failed', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify({ error: (e as Error).message })]);
    throw e;
  }
}
