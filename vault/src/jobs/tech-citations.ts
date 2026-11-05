/**
 * Monthly paper counts for the technology register (M19). For every current entry, counts papers matching the
 * entry's citation query since 2016 and since 2023 (Semantic Scholar bulk search: exact phrases, | for OR, + for AND)
 * and appends one tech_citations row per key. It never edits an entry: counts are metadata, and anything that changes
 * what an entry claims goes through a proposal and a partner. Semantic Scholar rate-limits shared IPs hard, so the job
 * paces itself and backs off; S2_API_KEY (the key the miners already use) raises the limit.
 *
 *   npx tsx src/jobs/tech-citations.ts        (Render cron "atc-vault-tech-citations", 05:30 UTC on the 2nd of each month)
 *
 * Exit code is non-zero when any key could not be counted; keys that were counted are still recorded.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/client.ts';
import { appendCitation, currentEntries, latestCitations } from '../technology/store.ts';

export const S2_URL = 'https://api.semanticscholar.org/graph/v1/paper/search/bulk';
export interface CitationDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; apiKey?: string; paceMs?: number; maxTries?: number; now?: Date }
export interface CitationSummary { keys: number; counted: number; failed: Array<{ key: string; error: string }>; skipped: string[] }

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Total papers for `query` published from `year` on; retries 429 and 5xx with linear backoff, throws on anything else. */
export async function countPapers(query: string, year: number, deps: CitationDeps = {}): Promise<number> {
  const f = deps.fetch ?? fetch, sleep = deps.sleep ?? realSleep, tries = deps.maxTries ?? 8;
  const url = `${S2_URL}?${new URLSearchParams({ query, year: `${year}-`, fields: 'title' })}`;
  let last = '';
  for (let i = 0; i < tries; i++) {
    let res: Response;
    try { res = await f(url, { headers: { accept: 'application/json', ...(deps.apiKey ? { 'x-api-key': deps.apiKey } : {}) } }); }
    catch (e) { last = (e as Error).message; await sleep(Math.min(10_000 * (i + 1), 60_000)); continue; }
    if (res.status === 429 || res.status >= 500) { last = `HTTP ${res.status}`; await sleep(Math.min(10_000 * (i + 1), 60_000)); continue; }
    if (!res.ok) throw new Error(`Semantic Scholar answered HTTP ${res.status}`);
    const body: any = await res.json();
    if (typeof body?.total !== 'number') throw new Error('Semantic Scholar answer had no total');
    return body.total;
  }
  throw new Error(`gave up after ${tries} tries (${last})`);
}

export async function refreshCitations(db: Db, deps: CitationDeps = {}): Promise<CitationSummary> {
  const sleep = deps.sleep ?? realSleep, pace = deps.paceMs ?? 4_000, now = deps.now ?? new Date();
  const entries = await currentEntries(db);
  const prior = await latestCitations(db, entries.map(e => e.key));
  const out: CitationSummary = { keys: entries.length, counted: 0, failed: [], skipped: [] };
  for (const e of entries) {
    const query = e.record.citation_query ?? prior.get(e.key)?.query;
    if (!query) { out.skipped.push(e.key); continue; }
    try {
      const since2016 = await countPapers(query, 2016, deps); await sleep(pace);
      const since2023 = await countPapers(query, 2023, deps); await sleep(pace);
      await appendCitation(db, { key: e.key, query, source: 'semantic-scholar', since_2016: since2016, since_2023: since2023, counted_by: 'job:tech-citations', counted_at: now.toISOString() });
      out.counted++;
    } catch (err) {
      out.failed.push({ key: e.key, error: (err as Error).message });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { openDb } = await import('../db/client.ts');
  const { migrate } = await import('../db/migrate.ts');
  const db = await openDb();
  await migrate(db);
  try {
    const s = await refreshCitations(db, { apiKey: process.env.S2_API_KEY || undefined });
    console.log(JSON.stringify(s));
    if (s.failed.length) process.exitCode = 1;
  } catch (e) {
    console.error(`tech-citations failed: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
