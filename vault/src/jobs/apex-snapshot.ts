/**
 * Snapshot job (M05, D6 fallback): poll the Asset Intelligence app's /api/state
 * and file one run per saved asset into project `firm` (or APEX_AI_PROJECT).
 * Runs go through createRun, so validation, legal tags and dedupe are the
 * same as everywhere: an identical snapshot creates nothing new.
 *
 *   APEX_AI_BASE_URL=... APEX_AI_TOKEN=... npx tsx src/jobs/apex-snapshot.ts
 *   APEX_AI_SINCE=<ISO date> limits it to assets saved since then (default: everything).
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import { appPersonFor, ensureAppPerson } from '../app-tokens.ts';
import { createRun } from '../api/runs.routes.ts';
import type { Ctx } from '../api/common.ts';
import { createAdapter, ID, type AssetIntelligenceAdapter, type SnapshotStats } from '../adapters/apex-asset-intelligence.ts';
import type { AdapterOptions, RunRecordDraft } from '../adapters/common.ts';

export interface SnapshotSummary extends SnapshotStats { project: string; created: number; deduplicated: number; failed: number; errors: string[] }

/** Insert a draft through createRun as the app's service person. Returns whether it was new. */
export async function ingestDraft(db: Db, draft: RunRecordDraft, project: { id: string; legal_tag: string }, now = new Date()): Promise<{ id: string; deduplicated: boolean }> {
  const person = await ensureAppPerson(db, appPersonFor(draft.job));
  const rec = { ...draft, id: randomUUID(), created_at: now.toISOString(), project_id: project.id, legal_tag: project.legal_tag };
  const x = { c: undefined, person, db, now, a: { scope: null, refs: [], detail: {} } } as unknown as Ctx;
  const r = await createRun(x, rec, null);
  return r.body as { id: string; deduplicated: boolean };
}

export async function runSnapshotJob(db: Db, o: AdapterOptions & { project?: string; since?: Date; adapter?: AssetIntelligenceAdapter; now?: Date } = {}): Promise<SnapshotSummary> {
  const env = o.env ?? process.env;
  const now = o.now ?? new Date();
  const projectId = o.project ?? env.APEX_AI_PROJECT ?? 'firm';
  const since = o.since ?? (env.APEX_AI_SINCE ? new Date(env.APEX_AI_SINCE) : new Date(0));
  const proj = (await db.query<{ id: string; default_legal_tag: string }>('SELECT id, default_legal_tag FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!proj) throw new Error(`project "${projectId}" does not exist`);
  const { rows } = await db.query<{ id: number }>("INSERT INTO jobs (name) VALUES ('apex-snapshot') RETURNING id");
  const adapter = o.adapter ?? createAdapter(o);
  const s: SnapshotSummary = { project: projectId, created: 0, deduplicated: 0, failed: 0, errors: [], assets_seen: 0, mapped: 0, skipped_unknown_shape: 0, skipped_no_outputs: 0, skipped_before_since: 0 };
  try {
    for await (const d of adapter.snapshot!(since)) {
      try {
        const r = await ingestDraft(db, d, { id: proj.id, legal_tag: proj.default_legal_tag }, now);
        if (r.deduplicated) s.deduplicated++; else s.created++;
      } catch (e: any) { s.failed++; if (s.errors.length < 10) s.errors.push(`${d.title ?? d.input_hash}: ${e.message}`); }
    }
    Object.assign(s, adapter.lastStats ?? {});
    await db.query("UPDATE jobs SET finished_at=now(), status='ok', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify(s)]);
    await db.query("INSERT INTO audit_events (person_id, action, scope, detail) VALUES ($1,'apex.snapshot',$2,$3::jsonb)", [`app:${ID}`, `project:${projectId}`, JSON.stringify(s)]);
    return s;
  } catch (e) {
    await db.query("UPDATE jobs SET finished_at=now(), status='failed', summary=$2::jsonb WHERE id=$1", [rows[0].id, JSON.stringify({ error: (e as Error).message })]);
    throw e;
  }
}

// CLI entry: `tsx src/jobs/apex-snapshot.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { openDb } = await import('../db/client.ts');
  const { migrate } = await import('../db/migrate.ts');
  const db = await openDb();
  await migrate(db);
  try { console.log(JSON.stringify(await runSnapshotJob(db))); } finally { await db.close(); }
}
