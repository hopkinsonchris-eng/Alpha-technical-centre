// Wave 6, PR 3 (W6-AC7): what came in since the person last looked, in scope, history excluded; the cited sentence per
// opportunity from the provider with uncited claims dropped; Mark all as seen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '../src/llm/provider.ts';
import { configureActivity } from '../src/api/activity.routes.ts';
import { keepCited } from '../src/llm/activity-brief.ts';
import { createApp } from '../src/app.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { seedMailProjects } from './fixtures/mail/seed.ts';

let h: Harness;
const T0 = new Date('2026-10-04T08:00:00Z');
before(async () => { h = await setup('vault-activity-'); await seedMailProjects(h.db); });
after(async () => { await h.db.close(); });
const api = async (method: string, url: string, body?: unknown, app = h.app) => { const res = await app.request(url, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }); return { status: res.status, body: (await res.json()) as any }; };

async function item(o: { type?: string; title: string; project: string; at: Date; ex?: Record<string, unknown>; origin?: string; tag?: string; hidden?: boolean; text?: string }) {
  const id = randomUUID();
  await h.db.query(`INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, content_hash, version, hidden, extracted)
    VALUES ($1,$2,$3,$4,$4,'{}',$5,$6,$7::jsonb,$8,1,$9,$10::jsonb)`, [id, o.type ?? 'email', o.title, o.at.toISOString(), o.project, o.tag ?? (o.project === 'firm' ? 'lt-firm' : `lt-${o.project === 'llanos-waterflood' ? 'frontera-energy' : o.project === 'middle-magdalena' ? 'ecopetrol' : 'costa-norte-petroleos'}-nda-2026`), JSON.stringify({ source: o.origin ?? 'zoho-mail', external_id: id }), 'sha256:' + id.replace(/-/g, '').padEnd(64, '0'), !!o.hidden, JSON.stringify(o.ex ?? {})]);
  if (o.text) await h.db.query('INSERT INTO chunks (item_id, ordinal, text, legal_tag, project_id) VALUES ($1,0,$2,$3,$4)', [id, o.text, o.tag ?? 'lt-firm', o.project]);
  return id;
}
const hours = (n: number) => new Date(T0.getTime() - n * 3600_000);

test('W6-AC7: counts since the last look, per-opportunity records in scope, history and bulk kept out; Mark all as seen moves the mark', async () => {
  configureActivity({ provider: null, now: () => T0 });
  const filed = await item({ title: 'Data room index', project: 'llanos-waterflood', at: hours(2), ex: { status: 'filed', direction: 'in', contacts: [{ email: 'jruiz@fronteraenergy.com', name: 'Jorge Ruiz', role: 'from' }] }, text: 'The data room index is attached; please countersign the NDA by Friday.' });
  await item({ title: 'Pressures', project: 'firm', at: hours(3), ex: { status: 'ready' } });
  await item({ title: 'Offer', project: 'firm', at: hours(3), ex: { status: 'review' } });
  await item({ title: 'Weekly digest', project: 'firm', at: hours(3), ex: { status: 'bulk', category: 'bulk' }, hidden: true });
  await item({ type: 'invoice', title: 'Invoice ATC-2026-0152', project: 'llanos-waterflood', at: hours(4), origin: 'zoho-books', ex: { paid_status: 'paid' } });
  await item({ type: 'report', title: 'Field report.pdf', project: 'middle-magdalena', at: hours(5), origin: 'zoho-workdrive' });
  await item({ title: 'Old history mail', project: 'llanos-waterflood', at: hours(1), ex: { status: 'filed', history: true } });
  await item({ title: 'Last week', project: 'llanos-waterflood', at: hours(30), ex: { status: 'filed' } });
  await h.db.query(`INSERT INTO review_queue (id, kind, payload, created_at) VALUES ($1, 'organisation', '{"domain":"newco.example"}'::jsonb, $2)`, [randomUUID(), hours(2).toISOString()]);
  const r = await api('GET', '/api/me/activity');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.since, hours(24).toISOString(), 'never looked: the last 24 hours');
  assert.deepEqual(r.body.counts, { messages_filed: 1, ready: 1, review: 1, invoices: 1, files: 1, organisations_proposed: 1, bulk_hidden: 1, records: 5 });
  assert.equal(r.body.brief_available, false);
  assert.deepEqual(r.body.projects.map((p: any) => [p.id, p.records.map((x: any) => x.title)]), [['llanos-waterflood', ['Data room index', 'Invoice ATC-2026-0152']], ['middle-magdalena', ['Field report.pdf']]]);
  const rec = r.body.projects[0].records[0];
  assert.equal(rec.ref, 'doc:' + filed); assert.equal(rec.from, 'Jorge Ruiz'); assert.equal(rec.direction, 'in'); assert.match(rec.snippet, /data room index/);
  // Since: an explicit time narrows it.
  const narrow = await api('GET', '/api/me/activity?since=' + encodeURIComponent(hours(2.5).toISOString()));
  assert.deepEqual([narrow.body.counts.messages_filed, narrow.body.counts.ready, narrow.body.counts.invoices], [1, 0, 0]);
  assert.equal((await api('GET', '/api/me/activity?since=yesterday')).status, 400);
  // Seen.
  const seen = await api('POST', '/api/me/activity/seen', {});
  assert.equal(seen.body.last_seen_activity_at, T0.toISOString());
  const after = await api('GET', '/api/me/activity');
  assert.equal(after.body.since, T0.toISOString()); assert.equal(after.body.counts.records, 0);
  // An associate outside the client projects sees nothing of them.
  await h.db.query(`INSERT INTO people (id, email, name, role) VALUES ('ana', 'ana@alpha-technical-centre.com', 'Ana', 'associate') ON CONFLICT (id) DO NOTHING`);
  const ana = await createApp({ db: h.db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'ana@alpha-technical-centre.com' } });
  const a = await api('GET', '/api/me/activity', undefined, ana);
  assert.equal(a.body.projects.length, 0); assert.equal(a.body.counts.invoices, 0);
});

test('W6-AC7: the brief is one cited sentence per opportunity; an uncited claim is dropped, a citation outside the records is stripped, a project with nothing new says so; counts only without a provider', async () => {
  await h.db.query(`UPDATE people SET last_seen_activity_at = NULL WHERE id = 'chris'`);
  const ids = (await h.db.query<any>(`SELECT id, project_id, title FROM items WHERE title IN ('Data room index', 'Invoice ATC-2026-0152', 'Field report.pdf')`)).rows;
  const dr = ids.find(i => i.title === 'Data room index').id, inv = ids.find(i => i.title.startsWith('Invoice')).id, rep = ids.find(i => i.title.endsWith('.pdf')).id;
  const seen: string[] = [];
  const fake = new FakeProvider(req => {
    seen.push(req.messages.at(-1)!.content);
    return `PROJECT llanos-waterflood: Jorge Ruiz sent the data-room index and asked for the NDA countersigned by Friday [doc:${dr}]. Invoice ATC-2026-0152 was paid [doc:${inv}]. The pipeline repair cost USD 2.3 million. Something cited elsewhere [doc:00000000-0000-4000-8000-000000000999].\nPROJECT middle-magdalena: A field report arrived [doc:${rep}][doc:${dr}].`;
  });
  configureActivity({ provider: fake, now: () => T0 });
  const r = await api('POST', '/api/me/activity/brief', { language: 'en' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.provider, 'fake-1');
  assert.match(seen[0], /PROJECT llanos-waterflood \(Llanos Basin waterflood screening\)/);
  assert.match(seen[0], /data room index is attached/, "the records' first lines go to the model");
  const ll = r.body.projects.find((p: any) => p.project_id === 'llanos-waterflood');
  assert.equal(ll.sentence, `Jorge Ruiz sent the data-room index and asked for the NDA countersigned by Friday [doc:${dr}]. Invoice ATC-2026-0152 was paid [doc:${inv}].`);
  assert.deepEqual(ll.citations.sort(), ['doc:' + dr, 'doc:' + inv].sort()); assert.equal(ll.dropped, 2, 'the uncited figure and the outside citation are gone');
  const mm = r.body.projects.find((p: any) => p.project_id === 'middle-magdalena');
  assert.equal(mm.sentence, `A field report arrived [doc:${rep}].`, "a citation to another project's record is stripped");
  assert.ok(Array.isArray(ll.records) && ll.records.length === 2);
  assert.equal((await h.db.query<any>(`SELECT detail->>'dropped' AS d FROM audit_events WHERE action = 'activity.brief' ORDER BY id DESC LIMIT 1`)).rows[0].d, '2', 'the audit counts the dropped sentences, not stripped citations');
  configureActivity({ provider: null });
  const none = await api('POST', '/api/me/activity/brief', {});
  assert.equal(none.body.provider, null); assert.ok(none.body.projects.every((p: any) => p.sentence === null));
  assert.deepEqual(keepCited('No citation at all. Cited [doc:a]. Half cited [doc:b] and [doc:a].', new Set(['doc:a'])), { sentence: 'Cited [doc:a]. Half cited and [doc:a].', citations: ['doc:a'], dropped: 1 });
});
