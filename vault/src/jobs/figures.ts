/**
 * Project figures (wave 7 PR3, docs/vault-hub/wave7/05-markup.md §1.7; data review 03 §5.1 S1, §7.4).
 * One dated, unit-bearing figure per (project, asset, job, name), kept in project_figures:
 *   - from the newest non-superseded run per job (and per first asset): every numeric `outputs[*]`, unit from the
 *     output or the tool manifest, as_of the run's created date, source_ref run:<id>, provenance 'run', the row's
 *     status, supersession and `stale` copied from the run. An output without a unit is never stored (unit NOT NULL).
 *   - from register.current and register.plan: unit from register.<name>_unit when present, else kboe/d as the Hub
 *     assumes; as_of the accepted source's date when a research fact was accepted, else the project's last stage
 *     change; source_ref the accepted document (provenance 'research') or 'register' (provenance 'register').
 * Nightly (render.yml), on demand through POST /api/projects/:id/figures/refresh, and derivable live (deriveFigures)
 * so the standing never waits for the job. Rows are updated in place by key and marked superseded when nothing
 * derives them any more; nothing is deleted.
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Db } from '../db/client.ts';

export type Provenance = 'run' | 'register' | 'research';
export interface FigureRow {
  project_id: string; asset_id: string | null; job: string; name: string; value: number; unit: string;
  as_of: string;                      // YYYY-MM-DD
  source_ref: string;                 // run:<id> | doc:<id> | register
  provenance: Provenance; run_status: string | null; superseded: boolean; stale: boolean;
  /** The legal tag that governs who may see the figure (the run's or the accepted document's); null for the register itself. */
  legal_tag: string | null;
}
export interface FiguresSummary { projects: number; rows: number; superseded: number; without_unit: number }

export interface FigureProject { id: string; register: Record<string, any> | null; stage_history: { at: string }[] | null; created_at: string | Date }
export interface FigureRun { id: string; job: string; asset_ids: string[] | null; status: string; created_at: string | Date; stale: boolean; legal_tag: string; record: any }

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const day = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The unit a manifest declares for an output, when it declares one (`units: {name: unit}` or `outputs: {name: {unit}}`). */
function manifestUnit(manifest: any, name: string): string | null {
  return str(manifest?.units?.[name]) ?? str(manifest?.outputs?.[name]?.unit) ?? null;
}

/** Pure: the figures a project's runs and register give today. No reads, no writes. */
export function deriveFigures(project: FigureProject, runs: FigureRun[], manifests: Map<string, any> = new Map()): { rows: FigureRow[]; without_unit: number } {
  const rows: FigureRow[] = [];
  let without_unit = 0;
  // Newest run per (job, asset) that is not superseded; when every run of the job is superseded, the newest one, marked.
  const groups = new Map<string, FigureRun[]>();
  for (const r of runs) {
    const asset = r.asset_ids?.[0] ?? null;
    const key = `${r.job}\u0000${asset ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const at = (r: FigureRun) => (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at));
  for (const group of groups.values()) {
    group.sort((a, b) => at(b).localeCompare(at(a)) || b.id.localeCompare(a.id));
    const live = group.find(r => r.status !== 'superseded');
    const src = live ?? group[0];
    const outputs = src.record?.outputs ?? {};
    for (const [name, out] of Object.entries<any>(outputs)) {
      const value = num(out?.value);
      if (value === null) continue;
      const unit = str(out?.unit) ?? manifestUnit(manifests.get(src.job), name);
      if (!unit) { without_unit++; continue; }
      rows.push({
        project_id: project.id, asset_id: src.asset_ids?.[0] ?? null, job: src.job, name, value, unit,
        as_of: day(src.created_at)!, source_ref: `run:${src.id}`, provenance: 'run', run_status: src.status,
        superseded: !live, stale: !!src.stale, legal_tag: src.legal_tag,
      });
    }
  }
  // The register: current and plan.
  const reg = project.register ?? {};
  const history = project.stage_history ?? [];
  const projectDate = day(history.length ? history[history.length - 1].at : null) ?? day(project.created_at) ?? new Date().toISOString().slice(0, 10);
  for (const name of ['current', 'plan'] as const) {
    let value = num(reg[name]);
    let unit = str(reg[`${name}_unit`]) ?? 'kboe/d';
    if (value === null && name === 'current' && num(reg.current_kboed) !== null) { value = num(reg.current_kboed); unit = 'kboe/d'; }
    if (value === null) continue;
    const source = reg[`${name}_source`];
    const accepted = source && typeof source === 'object';
    const docId = accepted && typeof source.item_id === 'string' && UUID.test(source.item_id) ? source.item_id.toLowerCase() : null;
    rows.push({
      project_id: project.id, asset_id: null, job: 'register', name, value, unit,
      as_of: (accepted ? day(source.accepted_at) : null) ?? projectDate,
      source_ref: docId ? `doc:${docId}` : 'register', provenance: accepted ? 'research' : 'register', run_status: null,
      superseded: false, stale: false, legal_tag: null,
    });
  }
  return { rows, without_unit };
}

async function manifestsOf(db: Db): Promise<Map<string, any>> {
  return new Map((await db.query<{ id: string; manifest: any }>('SELECT id, manifest FROM tools')).rows.map(t => [t.id, t.manifest]));
}

export const RUN_SELECT = 'SELECT id, job, asset_ids, status, created_at, stale, legal_tag, record FROM runs WHERE project_id = $1 AND NOT hidden ORDER BY created_at DESC, id DESC';
export const PROJECT_SELECT = 'SELECT id, register, stage_history, created_at FROM projects';

/** Fill project_figures for one project or for all of them; returns what was done. Records a `figures` job row. */
export async function refreshFigures(db: Db, opts: { projectId?: string; now?: Date } = {}): Promise<FiguresSummary> {
  const now = opts.now ?? new Date();
  const summary: FiguresSummary = { projects: 0, rows: 0, superseded: 0, without_unit: 0 };
  const jobId = (await db.query<{ id: number }>("INSERT INTO jobs (name, status, started_at) VALUES ('figures', 'running', $1) RETURNING id", [now.toISOString()])).rows[0].id;
  try {
    const manifests = await manifestsOf(db);
    const projects = opts.projectId
      ? (await db.query<FigureProject>(`${PROJECT_SELECT} WHERE id = $1`, [opts.projectId])).rows
      : (await db.query<FigureProject>(`${PROJECT_SELECT} ORDER BY id`)).rows;
    for (const p of projects) {
      summary.projects++;
      const runs = (await db.query<FigureRun>(RUN_SELECT, [p.id])).rows;
      const { rows, without_unit } = deriveFigures(p, runs, manifests);
      summary.without_unit += without_unit;
      const existing = (await db.query<{ id: string; asset_id: string | null; job: string; name: string; superseded: boolean }>('SELECT id, asset_id, job, name, superseded FROM project_figures WHERE project_id = $1', [p.id])).rows;
      const key = (r: { asset_id: string | null; job: string; name: string }) => `${r.asset_id ?? ''}\u0000${r.job}\u0000${r.name}`;
      const byKey = new Map(existing.map(e => [key(e), e]));
      const seen = new Set<string>();
      for (const r of rows) {
        const k = key(r); seen.add(k);
        const cur = byKey.get(k);
        if (cur) {
          await db.query(
            `UPDATE project_figures SET value = $2, unit = $3, as_of = $4, source_ref = $5, provenance = $6, run_status = $7, superseded = $8, stale = $9, computed_at = $10 WHERE id = $1`,
            [cur.id, r.value, r.unit, r.as_of, r.source_ref, r.provenance, r.run_status, r.superseded, r.stale, now.toISOString()]);
        } else {
          await db.query(
            `INSERT INTO project_figures (id, project_id, asset_id, job, name, value, unit, as_of, source_ref, provenance, run_status, superseded, stale, computed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [randomUUID(), p.id, r.asset_id, r.job, r.name, r.value, r.unit, r.as_of, r.source_ref, r.provenance, r.run_status, r.superseded, r.stale, now.toISOString()]);
        }
        summary.rows++;
        if (r.superseded) summary.superseded++;
      }
      // Keys nothing derives any more (an output the newer run no longer gives, a cleared register field): marked, never deleted.
      for (const e of existing) {
        if (seen.has(key(e)) || e.superseded) continue;
        await db.query('UPDATE project_figures SET superseded = true, computed_at = $2 WHERE id = $1', [e.id, now.toISOString()]);
        summary.superseded++;
      }
    }
    await db.query("UPDATE jobs SET status = 'ok', finished_at = now(), summary = $2::jsonb WHERE id = $1", [jobId, JSON.stringify(summary)]);
  } catch (e) {
    await db.query("UPDATE jobs SET status = 'failed', finished_at = now(), summary = $2::jsonb WHERE id = $1", [jobId, JSON.stringify({ ...summary, error: (e as Error).message })]);
    throw e;
  }
  return summary;
}

/* ── the nightly entry point (render.yml: atc-vault-figures) ───────── */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDb } = await import('../db/client.ts');
  const { migrate } = await import('../db/migrate.ts');
  const db = await openDb();
  await migrate(db);
  const s = await refreshFigures(db);
  console.log(JSON.stringify(s));
  await db.close();
}
