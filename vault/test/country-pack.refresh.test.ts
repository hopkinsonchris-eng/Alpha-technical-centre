// Wave 7 PR5 (docs/vault-hub/wave7/05-markup.md §1.8, W7-AC20): a section past its TTL or with a changed source is marked
// by the nightly job and rebuilt by the weekly cron under the budget, with a "what changed" line; a country with no active
// project is not refreshed; spend appears on the cost page by feature. Written before the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { baseDb, seedClient, seedOriginal, sourceOf, type SeededOriginal } from './country-pack.helpers.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { draftSections } from '../src/llm/country-pack.ts';
import { markStale, refreshStale } from '../src/country/refresh.ts';
import { featureOf } from '../src/cost.ts';
import type { Db } from '../src/db/client.ts';

const ids = (prompt: string) => [...new Set([...prompt.matchAll(/\[doc:([0-9a-f-]{36})\]/g)].map(m => m[1]))];
const reply = (figure: string) => (req: LlmRequest) => {
  const a = ids(req.messages[0].content)[0];
  return [`HEADLINE EN: Royalty is ${figure} [doc:${a}]`, `HEADLINE ES: La regalía es ${figure} [doc:${a}]`, `EN: Royalty is ${figure} of gross production [doc:${a}].`, `ES: La regalía es ${figure} de la producción bruta [doc:${a}].`, `EN: Ownership vests in the state [doc:${a}].`, `ES: La propiedad corresponde al Estado [doc:${a}].`].join('\n');
};

/** A built pack for one country: legal (180 d), licensing (7 d), fiscal (90 d), all fresh at `builtAt`. */
async function buildPack(db: Db, country: string, builtAt: Date): Promise<Record<string, SeededOriginal>> {
  const o: Record<string, SeededOriginal> = {};
  for (const section of ['legal', 'licensing', 'fiscal'] as const) o[section] = await seedOriginal(db, { country, section, source_id: `${section}-src`, url: `https://regulator.example/${country}/${section}`, text: `${section} text for ${country}: royalty 5 %.` });
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  await draftSections({ db, provider: new FakeProvider(reply('5 %')), country, jobId, by: 'chris', now: builtAt, budgetGbp: 2,
    sections: (['legal', 'licensing', 'fiscal'] as const).map(section => ({ section, sources: [sourceOf(o[section])] })) });
  return o;
}
const head = async (db: Db, country: string) => Object.fromEntries((await db.query('SELECT section, version, status, stale_reason, body FROM country_packs WHERE country = $1 AND superseded_by IS NULL', [country])).rows.map((r: any) => [r.section, r]));

test('W7-AC20 markStale: past its TTL a section is due; a source with a newer version makes it stale naming the item; a fresh one is untouched; older versions are never touched', async () => {
  const db = await baseDb();
  const built = new Date('2026-09-20T05:00:00Z');
  const o = await buildPack(db, 'NA', built);
  // The fiscal source changed: the fetch filed a new version of the item (same lineage, new hash).
  await db.query("UPDATE items SET content_hash = $2, version = 2, extracted = extracted || '{\"text\":\"fiscal text for NA: royalty 6 %.\"}'::jsonb WHERE id = $1", [o.fiscal.id, 'sha256:' + 'b'.repeat(64)]);
  const s = await markStale(db, new Date('2026-10-05T03:15:00Z'));      // 15 days after the build
  const h = await head(db, 'NA');
  assert.equal(h.legal.status, 'fresh'); assert.equal(h.legal.stale_reason, null);
  assert.equal(h.licensing.status, 'due'); assert.equal(h.licensing.stale_reason, 'ttl');
  assert.equal(h.fiscal.status, 'stale'); assert.equal(h.fiscal.stale_reason, `source_changed:${o.fiscal.id}`);
  assert.deepEqual({ due: s.due, stale: s.stale }, { due: 1, stale: 1 });
  // Idempotent: a second night changes nothing more.
  const s2 = await markStale(db, new Date('2026-10-06T03:15:00Z'));
  assert.deepEqual({ due: s2.due, stale: s2.stale }, { due: 0, stale: 0 });
  // A superseding item (a new row in the lineage) also counts as a changed source.
  const newer = randomUUID();
  await db.query(`INSERT INTO items (id, type, title, created_at, authors, project_id, legal_tag, origin, content_hash, version, supersedes, extracted)
                  SELECT $1, type, title, now(), authors, project_id, legal_tag, origin, $3, version + 1, id, extracted FROM items WHERE id = $2`, [newer, o.legal.id, 'sha256:' + 'c'.repeat(64)]);
  const s3 = await markStale(db, new Date('2026-10-07T03:15:00Z'));
  assert.equal(s3.stale, 1);
  assert.equal((await head(db, 'NA')).legal.stale_reason, `source_changed:${newer}`);
  await db.close();
});

test('W7-AC20 refreshStale: rebuilds only the due and stale sections of countries with an active or prospect project, writes what changed, records spend by feature; a country with no active project is never refreshed', async () => {
  const db = await baseDb();
  await seedClient(db, 'NA', 'p-na', 'active');
  await seedClient(db, 'GY', 'p-gy', 'archived');
  await seedClient(db, 'CO', 'p-co', 'prospect');
  const built = new Date('2026-09-20T05:00:00Z');
  const na = await buildPack(db, 'NA', built);
  const gy = await buildPack(db, 'GY', built);
  const co = await buildPack(db, 'CO', built);
  for (const o of [na, gy, co]) await db.query("UPDATE items SET content_hash = $2, version = 2, extracted = extracted || '{\"text\":\"fiscal text: royalty 6 %.\"}'::jsonb WHERE id = $1", [o.fiscal.id, 'sha256:' + 'b'.repeat(64)]);
  const now = new Date('2026-10-05T05:00:00Z');
  await markStale(db, now);
  for (const c of ['NA', 'GY', 'CO']) { const h = await head(db, c); assert.equal(h.licensing.status, 'due'); assert.equal(h.fiscal.status, 'stale'); assert.equal(h.legal.status, 'fresh'); }

  const prompts: LlmRequest[] = [];
  const provider = new FakeProvider((req) => { prompts.push(req); return reply('6 %')(req); });
  const r = await refreshStale(db, { provider, now, budgetGbp: 2, by: 'job:country-pack-refresh' });
  assert.deepEqual(r.countries.map(c => c.country).sort(), ['CO', 'NA'], 'GY (archived) is never refreshed');
  assert.equal(prompts.length, 6, 'licensing and fiscal for each of the two countries, plus the terms card per country; legal was fresh');
  for (const c of ['NA', 'CO']) {
    const h = await head(db, c);
    assert.equal(h.legal.version, 1); assert.equal(h.legal.status, 'fresh');
    assert.equal(h.licensing.version, 2); assert.equal(h.licensing.status, 'fresh');
    assert.equal(h.fiscal.version, 2); assert.equal(h.fiscal.status, 'fresh'); assert.equal(h.fiscal.stale_reason, null);
    assert.ok(h.fiscal.body.changed_since.some((x: any) => /^Changed: .*6 %/.test(x.en) && /^Cambió: /.test(x.es)), `what changed: ${JSON.stringify(h.fiscal.body.changed_since)}`);
    // The stale section was redrafted from the newest version of its source.
    assert.ok(prompts.some(p => p.system.includes('royalty 6 %')), 'the new text reached the drafter (the originals travel in the cached system block)');
  }
  const g = await head(db, 'GY');
  assert.equal(g.fiscal.version, 1); assert.equal(g.fiscal.status, 'stale');
  // Older versions stay, pointed at their successors.
  const old = (await db.query("SELECT superseded_by FROM country_packs WHERE country = 'NA' AND section = 'fiscal' AND version = 1")).rows[0];
  assert.ok(old.superseded_by);
  // The run is a job row and its spend is on the cost page under the pack's own feature.
  const job = (await db.query("SELECT name, status, summary FROM jobs WHERE name = 'country-pack-refresh' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(job.status, 'ok'); assert.equal(job.summary.rebuilt, 4);
  const spend = (await db.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'llm.country-pack' AND detail->>'refresh' = 'true'")).rows[0].n;
  assert.equal(spend, 6);
  assert.equal(featureOf('llm.country-pack'), 'country-pack');
  assert.deepEqual(r.changed.filter(c => c.country === 'NA' && c.section === 'fiscal').length, 1);
  assert.ok(r.spend_gbp >= 0);
  // Nothing left to do: a second run touches nothing.
  const r2 = await refreshStale(db, { provider, now: new Date('2026-10-05T06:00:00Z'), budgetGbp: 2, by: 'job:country-pack-refresh' });
  assert.equal(r2.rebuilt, 0); assert.equal(prompts.length, 6);
  await db.close();
});

test('W7-AC20 refreshStale: the budget is per country; a section the budget did not reach stays due with reason budget', async () => {
  const db = await baseDb();
  await seedClient(db, 'NA', 'p-na', 'active');
  const o = await buildPack(db, 'NA', new Date('2026-06-01T05:00:00Z'));    // legal (180 d) is still fresh on 5 Oct; licensing and fiscal are past their TTL
  await markStale(db, new Date('2026-10-05T05:00:00Z'));
  void o;
  const provider = new FakeProvider(reply('5 %'));
  provider.model = 'claude-sonnet-5-5';
  const r = await refreshStale(db, { provider, now: new Date('2026-10-05T05:00:00Z'), budgetGbp: 0.00001, by: 'job:country-pack-refresh' });
  const h = await head(db, 'NA');
  const done = Object.values(h).filter((x: any) => x.version === 2);
  const left = Object.values(h).filter((x: any) => x.status === 'due' && x.stale_reason === 'budget');
  assert.equal(done.length, 1); assert.equal(left.length, 1);
  assert.equal(r.countries[0].stopped_by, 'budget');
  await db.close();
});
