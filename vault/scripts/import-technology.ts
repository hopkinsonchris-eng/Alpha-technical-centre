/**
 * Import a technology-register seed file (M19) as proposals for partner review.
 *
 *   npx tsx scripts/import-technology.ts firm/technology/register-2026-11.json [--author import:register-2026-11]
 *
 * The seed is `{ "entries": [ <entry body with key>, ... ] }`; an entry may carry `citations: {query, since_2016,
 * since_2023, counted_at}`, which is appended to tech_citations with source 'import'. Every entry arrives as
 * `proposed`: nothing reaches the register until a partner confirms it in the Hub. Idempotent per key and content:
 * running the same file twice adds nothing; an edited entry becomes the key's next proposed version.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../src/db/client.ts';
import { EntryBody, issuePath } from '../src/technology/model.ts';
import { appendCitation, insertEntry, latestCitations } from '../src/technology/store.ts';

export interface ImportSummary { entries: number; proposed: number; unchanged: number; citations: number; errors: Array<{ index: number; key?: string; path: string; message: string }> }

export async function importRegister(db: Db, seed: any, opts: { author: string; now?: Date }): Promise<ImportSummary> {
  const now = opts.now ?? new Date();
  const list: any[] = Array.isArray(seed?.entries) ? seed.entries : [];
  const out: ImportSummary = { entries: list.length, proposed: 0, unchanged: 0, citations: 0, errors: [] };
  // Validate everything first: a seed with any invalid entry imports nothing.
  const parsed = list.map((raw, index) => {
    const { citations, ...body } = raw ?? {};
    const r = EntryBody.safeParse(body);
    if (!r.success) { out.errors.push({ index, key: raw?.key, ...issuePath(r.error) }); return null; }
    if (!r.data.key) { out.errors.push({ index, path: '/key', message: 'a seed entry needs its key' }); return null; }
    return { body: r.data, citations };
  });
  if (out.errors.length) return out;
  const prior = await latestCitations(db, parsed.map(p => p!.body.key!));
  for (const p of parsed) {
    const { body, citations } = p!;
    const r = await insertEntry(db, body, { author: opts.author, status: 'proposed', now, seedKey: true });
    if (r.duplicate) out.unchanged++; else out.proposed++;
    if (citations && typeof citations.query === 'string') {
      const last = prior.get(body.key!);
      const same = last && last.query === citations.query && last.since_2016 === (citations.since_2016 ?? null) && last.since_2023 === (citations.since_2023 ?? null);
      if (!same) {
        await appendCitation(db, { key: body.key!, query: citations.query, source: 'import', since_2016: citations.since_2016 ?? null, since_2023: citations.since_2023 ?? null, counted_by: opts.author, counted_at: citations.counted_at ?? now.toISOString() });
        out.citations++;
      }
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const file = process.argv[2];
  if (!file) { console.error('usage: tsx scripts/import-technology.ts <seed.json> [--author import:<name>]'); process.exit(2); }
  const ai = process.argv.indexOf('--author');
  const author = ai > 0 ? process.argv[ai + 1] : `import:${path.basename(file, '.json')}`;
  const { openDb } = await import('../src/db/client.ts');
  const { migrate } = await import('../src/db/migrate.ts');
  const db = await openDb();
  await migrate(db);
  try {
    const s = await importRegister(db, JSON.parse(readFileSync(file, 'utf8')), { author });
    console.log(JSON.stringify(s, null, 2));
    if (s.errors.length) process.exitCode = 1;
  } finally { await db.close(); }
}
