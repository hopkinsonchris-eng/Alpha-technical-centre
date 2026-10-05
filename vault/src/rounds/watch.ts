/**
 * The round watch (wave 7 PR6; docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21; 04-step-changes.md P2; practice P63).
 * Weekly, for every country with an active or prospect project: the pack's own licensing pages (the registry's
 * 'licensing' sources with a page to read, html or pdf; the datasets stay the pack's) are fetched through the pack's
 * fetch and filed through the pack's store, so a watched page is the same stored original the pack cites. The sha256
 * is compared with the newest stored version: an unchanged page writes nothing and is skipped; a changed or first-seen
 * page is read once by the extractor, and each accepted proposal becomes a 'proposed' round event in the review queue.
 * An unreachable page is recorded in the job summary with "since", the first failure date, carried forward from the
 * latest 'round-watch' job summary while it stays down; never silently. One jobs row 'round-watch' per run with
 * RoundWatchSummary; spend is audited like the pack's ('llm.round-watch', feature 'round-watch' on the cost page).
 *   npx tsx src/jobs/round-watch.ts        (Render cron "atc-vault-round-watch", Sundays 04:30 UTC)
 */
import { audit } from '../audit.ts';
import type { Db } from '../db/client.ts';
import { ensureBase } from '../db/seed.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openEmbedder } from '../ingest/embed.ts';
import { extractText } from '../ingest/extract.ts';
import type { IngestDeps } from '../ingest/index.ts';
import { openProvider, type LlmProvider } from '../llm/provider.ts';
import { costOf } from '../prices.ts';
import type { Clock } from '../miners/util.ts';
import { loadRegistry, sourcesFor } from '../country/registry.ts';
import { fetchSource, HttpPool } from '../country/fetch.ts';
import { storeOriginal } from '../country/store.ts';
import type { CountryRegistry, CountrySource, SourceAccess } from '../country/types.ts';
import { extractRounds, ROUND_AUDIT_ACTION } from './extract.ts';
import { proposeRounds } from './store.ts';
import type { RoundWatchSummary } from './types.ts';

export const JOB_NAME = 'round-watch';
/** A page the extractor can read; a dataset (arcgis, ckan, csv, json, rss) belongs to the pack, not the watch. */
export const WATCHED_ACCESS: SourceAccess[] = ['html', 'pdf'];
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface WatchOptions {
  registry?: CountryRegistry;
  /** The countries to watch; default: those with an active or prospect project. */
  countries?: string[];
  now?: () => Date; storage?: Storage; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; clock?: Clock;
  /** Chunk each original at once; null leaves it to the ingest-sync cron. Default: open the embedder, or null when it refuses. */
  ingest?: IngestDeps | null;
  /** The extractor's provider: openProvider() when ANTHROPIC_API_KEY is set, else null (pages are filed, nothing proposed). */
  provider?: LlmProvider | null;
  by?: string; log?: (line: string) => void; maxBytes?: number; timeoutMs?: number;
}

/** The licensing pages of a country as the registry resolves them (its own entries first, then the generic set). */
export function watchedSources(registry: CountryRegistry, country: string): CountrySource[] {
  return sourcesFor(registry, country).sources.filter(s => s.section === 'licensing' && WATCHED_ACCESS.includes(s.access));
}

/** Countries with an active or prospect project, upper case, sorted: the same rule as the pack's weekly refresh. */
export async function activeCountries(db: Db): Promise<string[]> {
  return (await db.query<{ country: string }>("SELECT DISTINCT upper(trim(country)) AS country FROM projects WHERE status IN ('active', 'prospect') AND country IS NOT NULL AND trim(country) <> '' ORDER BY 1")).rows.map(r => r.country);
}

/** source_id → the first failure date, from the latest round-watch job summary; empty when the last run reached everything. */
export async function previousSince(db: Db): Promise<Map<string, string>> {
  const last = (await db.query<{ summary: any }>(`SELECT summary FROM jobs WHERE name = $1 AND status <> 'running' ORDER BY id DESC LIMIT 1`, [JOB_NAME])).rows[0];
  const out = new Map<string, string>();
  for (const u of Array.isArray(last?.summary?.unreachable) ? last.summary.unreachable : []) if (u && typeof u.source_id === 'string' && typeof u.since === 'string') out.set(u.source_id, u.since);
  return out;
}

function openIngestOrNull(env: NodeJS.ProcessEnv, log: (l: string) => void): IngestDeps | null {
  try { return { provider: null, embedder: openEmbedder(env) }; }
  catch (e) { log(`round-watch: originals are filed but not chunked yet: ${(e as Error).message}`); return null; }
}

export async function watchRounds(db: Db, opts: WatchOptions = {}): Promise<RoundWatchSummary & { job_id: number }> {
  const now = opts.now ?? (() => new Date());
  const env = opts.env ?? process.env;
  const by = opts.by ?? `job:${JOB_NAME}`;
  const log = opts.log ?? ((line: string) => console.log(line));
  const registry = opts.registry ?? loadRegistry();
  const storage = opts.storage ?? openStorage();
  const ingest = opts.ingest === undefined ? openIngestOrNull(env, log) : opts.ingest;
  const provider = opts.provider === undefined ? (env.ANTHROPIC_API_KEY || env.LLM_PROVIDER ? openProvider(env) : null) : opts.provider;
  const pool = new HttpPool({ fetch: opts.fetch, clock: opts.clock });
  const summary: RoundWatchSummary = { pages: 0, unchanged: 0, changed: 0, unreachable: [], proposals: 0, refused_quotes: 0, spend_gbp: 0 };
  await ensureBase(db);
  const since = await previousSince(db);
  const started = now();
  const job = Number((await db.query<{ id: number }>("INSERT INTO jobs (name, status, started_at, summary) VALUES ($1, 'running', $2, '{}'::jsonb) RETURNING id", [JOB_NAME, started.toISOString()])).rows[0].id);
  const refs: string[] = [];
  const countries = opts.countries ? [...new Set(opts.countries.map(c => c.toUpperCase()))].sort() : await activeCountries(db);

  try {
    for (const country of countries) {
      const resolved = sourcesFor(registry, country);
      for (const src of watchedSources(registry, country)) {
        summary.pages++;
        const down = (reason: string) => {
          const first = since.get(src.id) ?? ymd(now());
          summary.unreachable.push({ source_id: src.id, since: first });
          log(`round-watch ${country} ${src.id}: unreachable since ${first}: ${reason}`);
        };
        const r = await fetchSource(src, { country, name: resolved.name, fetch: opts.fetch, clock: opts.clock, now, env, pool, maxBytes: opts.maxBytes, timeoutMs: opts.timeoutMs });
        if (r.unreachable) { down(r.reason); continue; }
        let stored: Awaited<ReturnType<typeof storeOriginal>>;
        try { stored = await storeOriginal(db, storage, src, r, country, { now: now(), ingest }); }
        catch (e) { down(`could not be filed: ${(e as Error).message}`); continue; }
        if (stored.status === 'unchanged') { summary.unchanged++; continue; }
        summary.changed++;
        refs.push(`doc:${stored.id}`);
        // The changed page is read once, from its extracted text; the model never sees the URL.
        let text = '';
        try { text = (await extractText(r.bytes, r.mime, r.title || src.id)).text; }
        catch (e) { log(`round-watch ${country} ${src.id}: filed as version ${stored.version} but its text could not be extracted: ${(e as Error).message}`); }
        const ex = await extractRounds(provider, country, text, r.url, stored.id, r.fetched_at);
        summary.refused_quotes += ex.refused_quotes;
        for (const w of ex.warnings) log(`round-watch ${country} ${src.id}: ${w}`);
        if (ex.called) {
          summary.spend_gbp = round4(summary.spend_gbp + ex.spend_gbp);
          await db.query(`INSERT INTO audit_events (person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out, cost_usd) VALUES ($1,$2,'public',$3::text[],$4::jsonb,$5,$6,$7,$8)`,
            [by, ROUND_AUDIT_ACTION, [`doc:${stored.id}`], JSON.stringify({ model: ex.model ?? null, country, source_id: src.id, job_id: job, spend_gbp: ex.spend_gbp, proposals: ex.proposals.length, refused_quotes: ex.refused_quotes, refused: ex.refused }),
             ex.usage?.input ?? 0, ex.usage?.cached ?? 0, ex.usage?.output ?? 0, ex.usage ? (costOf(ex.model, ex.usage) ?? null) : null]);
        }
        const pr = await proposeRounds(db, ex.proposals, now());
        summary.proposals += pr.inserted.length;
        log(`round-watch ${country} ${src.id}: version ${stored.version} ${stored.status}, ${ex.proposals.length} read, ${pr.inserted.length} proposed, ${pr.duplicates} already known, ${ex.refused_quotes} refused for the quote`);
      }
    }
    await db.query("UPDATE jobs SET finished_at = $2, status = 'ok', summary = $3::jsonb WHERE id = $1", [job, now().toISOString(), JSON.stringify(summary)]);
    await audit(db, by, 'round.watch', 'public', [...countries.map(c => `country:${c}`), ...refs.slice(0, 90)], { job_id: job, ...summary, unreachable: summary.unreachable.length });
    log(`round-watch: ${summary.pages} pages, ${summary.unchanged} unchanged, ${summary.changed} changed, ${summary.unreachable.length} unreachable, ${summary.proposals} proposed, £${summary.spend_gbp}`);
    return { job_id: job, ...summary };
  } catch (e) {
    await db.query("UPDATE jobs SET finished_at = $2, status = 'failed', summary = $3::jsonb WHERE id = $1", [job, now().toISOString(), JSON.stringify({ ...summary, error: (e as Error).message })]);
    throw e;
  }
}
