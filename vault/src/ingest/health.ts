/**
 * Index health (14 Nov 2026): what a session or the Hub needs to know about a project's indexing without screenshots.
 *
 * Before this, nobody outside Render's dashboard could see whether the ingest job ran, what it did, or what it cost;
 * sessions worked from screenshots and twice reported indexing as working when it was not. This reads the same
 * tables the job writes (items.extracted.ingest / ingest_error / ocr_deferred, chunks, jobs, audit_events) and
 * returns, for one project:
 *   - files by state: indexed, waiting, of those failed and OCR-deferred, needs OCR, unsupported, empty, no original and no text of their own;
 *   - the last ingest-sync run (start, end, status, counts, first error) and how many runs the last 24 hours saw;
 *   - the project's newest per-file error;
 *   - model spend today (UTC) and in total, all features and the indexing calls alone, from the cost ledger.
 * Spend is firm-wide: indexing calls carry no project in the ledger.
 *
 * Callers check scope first (get_project_context goes through projectSummary, the route through resolveScope).
 */
import type { Db } from '../db/client.ts';
import { costOf, DEFAULT_MODEL } from '../prices.ts';
import { USD_PER_GBP } from '../llm/spend-guard.ts';
import { HAS_OWN_TEXT_SQL } from './index.ts';

/** Ledger actions the indexer writes (chunk context, field proposals, legal and finance extraction, folder filing). */
export const INDEXING_ACTIONS = ['llm.context', 'llm.extract.assets', 'llm.extract.legal-finance', 'llm.folders.file'];

export interface IndexCounts { total: number; indexed: number; waiting: number; failed: number; ocr_deferred: number; needs_ocr: number; unsupported: number; empty: number; no_original: number; readable: number; pct_indexed: number | null }
export interface LastRun { id: number; started_at: string; finished_at: string | null; status: string; ingested: number | null; failed: number | null; skipped: number | null; stopped_by: string | null; left: number | null; first_error: string | null }
export interface Spend { today_gbp: number; total_gbp: number; indexing_today_gbp: number; indexing_total_gbp: number; first_call_at: string | null }
export interface IndexHealth { project_id: string; as_of: string; files: IndexCounts; /** file extensions of the unsupported files, most first */ unsupported_by_ext: Array<{ ext: string; n: number }>; last_run: LastRun | null; runs_last_24h: number; ok_runs_last_24h: number; last_file_error: { title: string | null; at: string | null; message: string | null; attempts: number | null } | null; spend: Spend }

const gbp = (usd: number) => Math.round((usd / USD_PER_GBP) * 100) / 100;
const n = (v: unknown) => (v == null ? null : Number(v));

export async function indexCounts(db: Db, projectId: string): Promise<IndexCounts> {
  const r = (await db.query<any>(
    `WITH s AS (
       SELECT (i.storage_key IS NOT NULL OR ${HAS_OWN_TEXT_SQL}) AS has_orig,
              coalesce(i.extracted->'ingest'->>'version' = i.version::text, false) AS marked,
              i.extracted->'ingest'->>'status' AS st,
              coalesce(i.extracted->'ingest_error'->>'version' = i.version::text, false) AS failed,
              coalesce(i.extracted->>'ocr_deferred' = i.version::text, false) AS deferred,
              EXISTS (SELECT 1 FROM chunks c WHERE c.item_id = i.id AND c.item_version = i.version AND c.current) AS indexed
         FROM items i WHERE i.project_id = $1 AND NOT i.hidden)
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE indexed)::int AS indexed,
            count(*) FILTER (WHERE NOT indexed AND has_orig AND NOT marked)::int AS waiting,
            count(*) FILTER (WHERE NOT indexed AND has_orig AND NOT marked AND failed)::int AS failed,
            count(*) FILTER (WHERE NOT indexed AND has_orig AND NOT marked AND deferred)::int AS ocr_deferred,
            count(*) FILTER (WHERE NOT indexed AND marked AND st = 'needs_ocr')::int AS needs_ocr,
            count(*) FILTER (WHERE NOT indexed AND marked AND st = 'unsupported')::int AS unsupported,
            count(*) FILTER (WHERE NOT indexed AND marked AND st = 'empty')::int AS empty,
            count(*) FILTER (WHERE NOT indexed AND NOT has_orig)::int AS no_original
       FROM s`, [projectId])).rows[0];
  const readable = r.indexed + r.waiting + r.needs_ocr;
  return { ...r, readable, pct_indexed: readable ? Math.round((1000 * r.indexed) / readable) / 10 : null };
}

export async function lastIngestRun(db: Db): Promise<{ last: LastRun | null; runs24: number; ok24: number }> {
  const row = (await db.query<any>(`SELECT id, started_at, finished_at, status, summary FROM jobs WHERE name = 'ingest-sync' ORDER BY id DESC LIMIT 1`)).rows[0];
  const c = (await db.query<any>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'ok')::int AS ok FROM jobs WHERE name = 'ingest-sync' AND started_at > now() - interval '24 hours'`)).rows[0];
  if (!row) return { last: null, runs24: c.n, ok24: c.ok };
  const s = row.summary ?? {};
  const iso = (d: any) => (d ? new Date(d).toISOString() : null);
  return {
    last: { id: Number(row.id), started_at: iso(row.started_at)!, finished_at: iso(row.finished_at), status: row.status, ingested: n(s.ingested), failed: n(s.failed), skipped: n(s.skipped), stopped_by: s.stopped_by ?? null, left: n(s.left), first_error: Array.isArray(s.errors) && s.errors.length ? String(s.errors[0]).slice(0, 300) : null },
    runs24: c.n, ok24: c.ok,
  };
}

/** Model spend from the cost ledger, priced as the spend guard prices it: cost_usd when the row has it, else tokens × price. */
export async function modelSpend(db: Db, now = new Date()): Promise<Spend> {
  const day = now.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const num = (expr: string) => `CASE WHEN ${expr} ~ '^[0-9]+$' THEN (${expr})::bigint ELSE 0 END`;
  const rows = (await db.query<any>(
    `SELECT action = ANY($2::text[]) AS indexing, at >= $1::timestamptz AS today, detail->>'model' AS model, coalesce(detail->>'batch', '') = 'true' AS batch,
            sum(cost_usd)::float8 AS cost_usd,
            sum(CASE WHEN cost_usd IS NULL THEN coalesce(tokens_in::bigint, ${num("detail->>'tokens_in'")}) ELSE 0 END)::float8 AS t_in,
            sum(CASE WHEN cost_usd IS NULL THEN coalesce(tokens_cached::bigint, ${num("detail->>'tokens_cached'")}) ELSE 0 END)::float8 AS t_cached,
            sum(CASE WHEN cost_usd IS NULL THEN coalesce(tokens_out::bigint, ${num("detail->>'tokens_out'")}) ELSE 0 END)::float8 AS t_out,
            min(at) AS first_at
       FROM audit_events
      WHERE tokens_in IS NOT NULL OR tokens_cached IS NOT NULL OR tokens_out IS NOT NULL OR cost_usd IS NOT NULL OR detail->>'tokens_in' IS NOT NULL OR detail->>'tokens_out' IS NOT NULL
      GROUP BY 1, 2, 3, 4`, [day, INDEXING_ACTIONS])).rows;
  let today = 0, total = 0, iToday = 0, iTotal = 0; let first: Date | null = null;
  for (const r of rows) {
    const u = { input: Number(r.t_in ?? 0), cached: Number(r.t_cached ?? 0), output: Number(r.t_out ?? 0) };
    const usd = Number(r.cost_usd ?? 0) + (costOf(r.model ?? DEFAULT_MODEL, u, { batch: r.batch }) ?? costOf(DEFAULT_MODEL, u) ?? 0);
    total += usd; if (r.today) today += usd;
    if (r.indexing) { iTotal += usd; if (r.today) iToday += usd; }
    if (r.first_at && (!first || new Date(r.first_at) < first)) first = new Date(r.first_at);
  }
  return { today_gbp: gbp(today), total_gbp: gbp(total), indexing_today_gbp: gbp(iToday), indexing_total_gbp: gbp(iTotal), first_call_at: first ? first.toISOString() : null };
}

export async function indexHealth(db: Db, projectId: string, now = new Date()): Promise<IndexHealth> {
  const [files, runs, spend] = [await indexCounts(db, projectId), await lastIngestRun(db), await modelSpend(db, now)];
  const e = (await db.query<any>(
    `SELECT title, extracted->'ingest_error' AS e FROM items
      WHERE project_id = $1 AND NOT hidden AND extracted->'ingest_error'->>'version' = version::text
      ORDER BY extracted->'ingest_error'->>'at' DESC NULLS LAST LIMIT 1`, [projectId])).rows[0];
  const ext = (await db.query<any>(
    `SELECT lower(coalesce(substring(coalesce(extracted->>'filename', title) from '\\.([A-Za-z0-9]{1,8})$'), '(none)')) AS ext, count(*)::int AS n
       FROM items WHERE project_id = $1 AND NOT hidden AND extracted->'ingest'->>'status' = 'unsupported' AND extracted->'ingest'->>'version' = version::text
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 15`, [projectId])).rows.map((r: any) => ({ ext: r.ext, n: r.n }));
  return {
    project_id: projectId, as_of: now.toISOString(), files, unsupported_by_ext: ext, last_run: runs.last, runs_last_24h: runs.runs24, ok_runs_last_24h: runs.ok24,
    last_file_error: e ? { title: e.title ?? null, at: e.e?.at ?? null, message: e.e?.message ? String(e.e.message).slice(0, 300) : null, attempts: n(e.e?.attempts) } : null,
    spend,
  };
}

/** The same, as lines for get_project_context's markdown. */
export function healthLines(h: IndexHealth): string[] {
  const f = h.files, r = h.last_run;
  const lines = ['', '## Index health', '',
    `- Files: ${f.total}; indexed ${f.indexed} of ${f.readable} readable (${f.pct_indexed ?? '-'}%); waiting ${f.waiting} (failed before ${f.failed}, OCR deferred ${f.ocr_deferred}); needs OCR ${f.needs_ocr}; unsupported ${f.unsupported}; empty ${f.empty}; no original ${f.no_original}`,
    ...(h.unsupported_by_ext.length ? [`- Unsupported by type: ${h.unsupported_by_ext.map(e => `${e.ext} ${e.n}`).join(', ')}`] : []),
    r ? `- Last ingest run #${r.id}: started ${r.started_at}, ${r.finished_at ? `finished ${r.finished_at}` : 'not finished'}, ${r.status}; ingested ${r.ingested ?? '-'}, failed ${r.failed ?? '-'}${r.stopped_by ? `, stopped by ${r.stopped_by} with ${r.left ?? '?'} left` : ''}${r.first_error ? `; first error: ${r.first_error}` : ''}` : '- Last ingest run: none recorded',
    `- Ingest runs in the last 24 hours: ${h.runs_last_24h} (${h.ok_runs_last_24h} ok)`,
    `- Newest file error: ${h.last_file_error ? `${h.last_file_error.title ?? '?'} at ${h.last_file_error.at ?? '?'} (attempt ${h.last_file_error.attempts ?? '?'}): ${h.last_file_error.message ?? ''}` : 'none'}`,
    `- Model spend (firm-wide): today £${h.spend.today_gbp.toFixed(2)}, indexing £${h.spend.indexing_today_gbp.toFixed(2)}; in total £${h.spend.total_gbp.toFixed(2)}, indexing £${h.spend.indexing_total_gbp.toFixed(2)} (ledger since ${h.spend.first_call_at?.slice(0, 10) ?? '-'})`,
    `- As of ${h.as_of}`];
  return lines;
}
