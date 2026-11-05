import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { importRegister } from '../scripts/import-technology.ts';
import { EntryBody } from '../src/technology/model.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../firm/technology/register-2026-11.json');
const entry = (key: string, name: string, over: Record<string, unknown> = {}) => ({
  key, application: key.startsWith('AL') ? 'artificial-lift' : 'water-handling', name, summary: 'A technology summary long enough.', readiness: 4,
  evidence: [{ claim: 'c', tier: 'E2', source: 'https://example.org' }], scores: { capex: 3, opex: 3, benefit: 3, evidence: 3 },
  citations: { query: `"${name}"`, since_2016: 10, since_2023: 4 }, ...over,
});

test('import keeps the seed\'s keys, arrives as proposals, and is idempotent', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  const seed = { entries: [entry('AL05', 'Gas lift optimisation'), entry('WH03', 'Polymer gel')] };
  const s1 = await importRegister(db, seed, { author: 'import:test' });
  assert.deepEqual({ ...s1, errors: s1.errors.length }, { entries: 2, proposed: 2, unchanged: 0, citations: 2, errors: 0 });
  const rows = (await db.query("SELECT key, version, status, author FROM tech_entries ORDER BY key")).rows;
  assert.deepEqual(rows, [{ key: 'AL05', version: 1, status: 'proposed', author: 'import:test' }, { key: 'WH03', version: 1, status: 'proposed', author: 'import:test' }]);
  const s2 = await importRegister(db, seed, { author: 'import:test' });
  assert.equal(s2.proposed, 0); assert.equal(s2.unchanged, 2); assert.equal(s2.citations, 0);
  // an edited entry becomes the next version of the same key
  const s3 = await importRegister(db, { entries: [entry('AL05', 'Gas lift optimisation', { summary: 'A revised technology summary text.' })] }, { author: 'import:test' });
  assert.equal(s3.proposed, 1);
  assert.equal((await db.query("SELECT max(version)::int AS v FROM tech_entries WHERE key = 'AL05'")).rows[0].v, 2);
  await db.close();
});

test('a seed with any invalid entry imports nothing and names the problem', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  const s = await importRegister(db, { entries: [entry('AL01', 'Fine'), entry('AL02', 'Broken', { readiness: 9 }), { ...entry('AL03', 'Keyless'), key: undefined }] }, { author: 'import:test' });
  assert.equal(s.errors.length, 2);
  assert.deepEqual(s.errors.map(e => [e.index, e.path]), [[1, '/readiness'], [2, '/key']]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_entries')).rows[0].n, 0);
  await db.close();
});

test('the committed seed validates entry by entry', { skip: !existsSync(SEED) }, () => {
  const seed = JSON.parse(readFileSync(SEED, 'utf8'));
  assert.ok(seed.entries.length >= 32);
  const keys = new Set<string>();
  for (const [i, raw] of seed.entries.entries()) {
    const { citations: _c, ...body } = raw;
    const r = EntryBody.safeParse(body);
    assert.ok(r.success, `entry ${i} (${raw.key}): ${r.success ? '' : JSON.stringify(r.error.issues[0])}`);
    assert.ok(!keys.has(raw.key), `duplicate key ${raw.key}`); keys.add(raw.key);
    for (const e of body.evidence) assert.match(e.source, /^https?:\/\//, `${raw.key}: seed evidence must be public URLs`);
  }
});
