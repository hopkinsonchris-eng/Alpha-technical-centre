import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { validate } from '../src/schemas.ts';
import { normaliseOrgName, normalisePersonName } from '../src/api/organisations.routes.ts';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const seed = JSON.parse(readFileSync(path.join(FIX, 'ac15/seed.json'), 'utf8'));
const DOMAIN = 'alpha-technical-centre.com';
const ORG = 'petrolera-del-orinoco';

let db: Db;
let app: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof app, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, seed);
  app = await appFor(`chris@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('AC7: the counterparty file lists all six dispatches in date order with reference numbers, and the NDA in force', async () => {
  const r = await call(app, 'GET', `/api/organisations/${ORG}/file`);
  assert.equal(r.status, 200);
  const file = await r.json();
  assert.equal(file.organisation.id, ORG);
  assert.equal(file.organisation.registered_address, seed.organisation.registered_address);
  assert.deepEqual(file.contacts.map((c: any) => c.id).sort(), ['luis-paredes', 'maria-fernandez']);

  assert.equal(file.dispatches.length, 6);
  assert.deepEqual(file.dispatches.map((d: any) => [d.occurred_at.slice(0, 10), d.reference_no, d.their_reference, d.direction, d.channel]), [
    ['2026-02-03', 'ATC-2026-0098', null, 'out', 'email'],
    ['2026-02-10', null, 'PDO-GC-2026-014', 'in', 'email'],
    ['2026-02-14', 'ATC-2026-0103', null, 'out', 'courier'],
    ['2026-04-22', 'ATC-2026-0117', null, 'out', 'email'],
    ['2026-06-30', null, 'PDO-PR-2026-088', 'in', 'portal'],
    ['2026-07-08', 'ATC-2026-0131', null, 'out', 'post'],
  ]);
  assert.deepEqual(file.dispatches.map((d: any) => d.id), seed.dispatches.map((d: any) => d.id));
  assert.equal(file.dispatches[0].item.title, 'Introduction and capability statement');
  assert.equal(file.dispatches[2].in_reply_to, seed.dispatches[1].id);
  for (const d of file.dispatches) { const { item, ...schemaShape } = d; assert.deepEqual(validate('dispatch', { ...schemaShape, notes: schemaShape.notes ?? '' }), [], d.id); }

  assert.equal(file.contracts_in_force.length, 1);
  assert.deepEqual(
    (({ item_id, type, reference_no, effective_date, expiry, governing_law }) => ({ item_id, type, reference_no, effective_date, expiry, governing_law }))(file.contracts_in_force[0]),
    { item_id: seed.nda_item.id, type: 'nda', reference_no: 'ATC-2026-0103', effective_date: '2026-02-14', expiry: '2028-02-13', governing_law: 'England and Wales' });
  assert.deepEqual(file.projects.map((p: any) => p.id), ['orinoco-partnership']);
  assert.deepEqual(file.open_invoices, []);

  // an NDA past its expiry is no longer in force
  await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{expiry}', '"2026-06-01"') WHERE id = $1`, [seed.nda_item.id]);
  assert.deepEqual((await (await call(app, 'GET', `/api/organisations/${ORG}/file`)).json()).contracts_in_force, []);
  await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{expiry}', '"2028-02-13"') WHERE id = $1`, [seed.nda_item.id]);
  assert.equal((await (await call(app, 'GET', `/api/organisations/${ORG}/file`)).json()).contracts_in_force.length, 1);
  assert.equal((await call(app, 'GET', '/api/organisations/nobody/file')).status, 404);
});

test('the file shows open invoices and hides dispatches of items the caller cannot see', async () => {
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator, partners_only) VALUES ('lt-finance','firm','first-party','ATC', true)`);
  await db.query(`INSERT INTO items (id,type,title,created_at,project_id,organisation_ids,legal_tag,origin,content_hash,extracted) VALUES
    ('00000000-0000-4000-8000-0000000000a1','invoice','Invoice 2026-14','2026-08-01','firm','{${ORG}}','lt-finance','{"source":"zoho-books"}','sha256:${'1'.repeat(64)}','{"number":"2026-14","amount":12500,"currency":"USD","due_date":"2026-09-01"}'),
    ('00000000-0000-4000-8000-0000000000a2','invoice','Invoice 2026-09','2026-05-01','firm','{${ORG}}','lt-finance','{"source":"zoho-books"}','sha256:${'2'.repeat(64)}','{"number":"2026-09","paid_status":"paid"}')`);
  const partner = await (await call(app, 'GET', `/api/organisations/${ORG}/file`)).json();
  assert.deepEqual(partner.open_invoices.map((i: any) => [i.number, i.amount, i.currency, i.due]), [['2026-14', 12500, 'USD', '2026-09-01']]);
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  const forAna = await (await call(ana, 'GET', `/api/organisations/${ORG}/file`)).json();
  assert.deepEqual(forAna.open_invoices, [], 'finance is partners-only');
  // Ana is not on the project: dispatches of client-nda emails are hidden, the NDA (firm) and its courier dispatch remain
  assert.deepEqual(forAna.dispatches.map((d: any) => d.reference_no), ['ATC-2026-0103']);
  assert.equal(forAna.contracts_in_force.length, 1);
  assert.equal(forAna.contacts.length, 2);
});

test('AC7: reserving references concurrently never yields the same number; numbering continues after the seeded ATC-2026-0131', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => call(app, 'POST', '/api/references/reserve').then(r => r.json())));
  const refs = results.map(r => r.reference_no);
  assert.equal(new Set(refs).size, 12, refs.join(','));
  for (const r of refs) assert.match(r, /^ATC-\d{4}-\d{4}$/);
  const year = new Date().getUTCFullYear();
  assert.deepEqual(refs.map(r => Number(r.slice(-4))).sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => 132 + i), 'continues after 0131');
  assert.ok(refs.every(r => r.startsWith(`ATC-${year}-`)));
  const next = await call(app, 'POST', '/api/references/reserve', { year: 2027 });
  assert.equal(next.status, 201);
  assert.deepEqual(await next.json(), { reference_no: 'ATC-2027-0001', year: 2027, number: 1 });
  assert.equal((await call(app, 'POST', '/api/references/reserve', { year: 99 })).status, 400);
  // reserved numbers are accepted by the dispatch schema
  assert.deepEqual(validate('dispatch', { id: '00000000-0000-4000-8000-000000000099', item_id: seed.items[0].id, direction: 'out', organisation_id: ORG, channel: 'email', occurred_at: '2026-09-01T00:00:00Z', recorded_by: 'chris', reference_no: refs[0] }), []);
});

test('organisations: create, duplicate detection on name, domain and registration number, update, delete', async () => {
  const create = (b: unknown, qs = '') => call(app, 'POST', `/api/organisations${qs}`, b);
  let r = await create({ name: 'Acme Energía S.A.', kind: 'operator', country: 'CO', identifiers: { registration_no: 'NIT 900.123.456-7', domains: ['https://www.acme-energia.com/'] } });
  assert.equal(r.status, 201);
  const acme = await r.json();
  assert.equal(acme.id, 'acme-energia');   // slug from the normalised name
  assert.deepEqual(acme.identifiers.domains, ['acme-energia.com']);

  const dup = async (b: unknown) => { const x = await create(b); assert.equal(x.status, 409, JSON.stringify(b)); const j = await x.json(); assert.equal(j.error.code, 'duplicate'); return j.error.matches[0]; };
  assert.deepEqual(await dup({ name: 'ACME ENERGIA SA', kind: 'operator' }), { id: acme.id, name: 'Acme Energía S.A.', reason: 'name' });
  assert.equal((await dup({ name: 'Acme Energia Limited', kind: 'vendor' })).reason, 'name');
  assert.equal((await dup({ name: 'Totally Different Name', kind: 'vendor', identifiers: { domains: ['ACME-ENERGIA.com'] } })).reason, 'domain');
  assert.equal((await dup({ name: 'Another Name', kind: 'vendor', identifiers: { registration_no: 'nit900123456-7' } })).reason, 'registration_no');
  // free-mail domains do not count as identity
  assert.equal((await create({ name: 'Gmail Consultant One', kind: 'vendor', identifiers: { domains: ['gmail.com'] } })).status, 201);
  assert.equal((await create({ name: 'Gmail Consultant Two', kind: 'vendor', identifiers: { domains: ['gmail.com'] } })).status, 201);
  // a partner can knowingly create a lookalike
  assert.equal((await create({ name: 'Acme Energia Inc', kind: 'vendor', country: 'US' }, '?allow_duplicate=true')).status, 201);
  // validation
  assert.equal((await (await create({ name: '', kind: 'operator' })).json()).error.path, '/name');
  assert.equal((await (await create({ name: 'X Corp', kind: 'martian' })).json()).error.path, '/kind');
  assert.equal((await (await create({ name: 'Y Corp', kind: 'vendor', identifiers: { domains: 'nope' } })).json()).error.path, '/identifiers/domains');

  // list, search, read
  const names = async (qs: string) => (await (await call(app, 'GET', `/api/organisations${qs}`)).json()).organisations.map((o: any) => o.id);
  assert.ok((await names('?q=acme')).includes(acme.id));
  assert.ok((await names('?q=ENERGIA')).includes(acme.id));
  assert.ok((await names('?q=acme-energia.com')).includes(acme.id));
  assert.deepEqual(await names('?kind=regulator'), []);
  assert.equal((await call(app, 'GET', '/api/organisations?kind=bogus')).status, 400);
  const one = await (await call(app, 'GET', `/api/organisations/${ORG}`)).json();
  assert.equal(one.contacts.length, 2);
  assert.equal((await call(app, 'GET', '/api/organisations/missing')).status, 404);

  // update: fields merge, identifiers merge, duplicates are still refused
  const upd = await call(app, 'PATCH', `/api/organisations/${acme.id}`, { registered_address: 'Calle 100 #7-33, Bogotá', identifiers: { tax_id: '900123456' } });
  assert.equal(upd.status, 200);
  const u = await upd.json();
  assert.equal(u.registered_address, 'Calle 100 #7-33, Bogotá');
  assert.deepEqual(u.identifiers, { registration_no: 'NIT 900.123.456-7', domains: ['acme-energia.com'], tax_id: '900123456' });
  const clash = await call(app, 'PATCH', `/api/organisations/${acme.id}`, { name: 'Petrolera del Orinoco' });
  assert.equal(clash.status, 409);
  assert.equal((await call(app, 'PATCH', '/api/organisations/missing', { name: 'x' })).status, 404);

  // delete: partners only, and only when nothing refers to it
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  assert.equal((await call(ana, 'DELETE', `/api/organisations/${acme.id}`)).status, 403);
  assert.equal((await call(app, 'DELETE', `/api/organisations/${ORG}`)).status, 409);
  assert.equal((await call(app, 'DELETE', `/api/organisations/${acme.id}`)).status, 200);
  assert.equal((await call(app, 'GET', `/api/organisations/${acme.id}`)).status, 404);
});

test('name normalisation', () => {
  assert.equal(normaliseOrgName('Petrolera del Orinoco S.A.'), 'petrolera del orinoco');
  assert.equal(normaliseOrgName('  ECOPETROL  S.A. '), 'ecopetrol');
  assert.equal(normaliseOrgName('Shell plc'), 'shell');
  assert.equal(normaliseOrgName('Ltd'), 'ltd', 'a name that is only a suffix is kept');
  assert.equal(normalisePersonName('Ing. María Fernández'), 'maria fernandez');
  assert.equal(normalisePersonName('Dr. Luis Paredes'), 'luis paredes');
});

test('contacts: create, duplicates by email or by name within the organisation, validation', async () => {
  const create = (b: unknown) => call(app, 'POST', '/api/contacts', b);
  const r = await create({ organisation_id: ORG, name: 'Ing. Carlos Rojas', role: 'Geólogo Jefe', emails: ['CRojas@PetroleraDelOrinoco.com'], phones: ['+58 212 555 0100'], language: 'es' });
  assert.equal(r.status, 201);
  const c = await r.json();
  assert.deepEqual([c.id, c.emails, c.language], ['carlos-rojas', ['crojas@petroleradelorinoco.com'], 'es']);
  assert.equal((await call(app, 'GET', `/api/organisations/${ORG}`).then(x => x.json())).contacts.length, 3);

  const byEmail = await create({ organisation_id: ORG, name: 'Someone Else', emails: ['crojas@petroleradelorinoco.com'] });
  assert.equal(byEmail.status, 409);
  assert.equal((await byEmail.json()).error.matches[0].reason, 'email');
  const byName = await create({ organisation_id: ORG, name: 'Carlos Rojas' });
  assert.equal(byName.status, 409);
  assert.equal((await byName.json()).error.matches[0].reason, 'name');
  assert.equal((await create({ organisation_id: ORG, name: 'María Fernández' })).status, 409);
  // the same person name at another organisation is a different person
  await call(app, 'POST', '/api/organisations', { name: 'Other Oil Co', kind: 'operator', id: 'other-oil' });
  assert.equal((await create({ organisation_id: 'other-oil', name: 'Carlos Rojas' })).status, 201);

  assert.equal((await (await create({ name: 'No Org' })).json()).error.path, '/organisation_id');
  assert.equal((await (await create({ organisation_id: 'ghost', name: 'Ghost' })).json()).error.path, '/organisation_id');
  assert.equal((await (await create({ organisation_id: ORG, name: 'Bad Email', emails: ['nope'] })).json()).error.path, '/emails');
  assert.equal((await (await create({ organisation_id: ORG, name: 'Bad Lang', language: 'Spanish' })).json()).error.path, '/language');
});

test('dispatch register: list filters, create, acknowledge', async () => {
  const list = async (qs: string) => (await (await call(app, 'GET', `/api/dispatches${qs}`)).json()).dispatches;
  const all = await list(`?organisation=${ORG}`);
  assert.equal(all.length, 6);
  assert.equal(all[0].reference_no, 'ATC-2026-0131', 'newest first by default');
  assert.deepEqual((await list(`?organisation=${ORG}&order=asc`)).map((d: any) => d.id), seed.dispatches.map((d: any) => d.id));
  assert.equal((await list(`?organisation=${ORG}&direction=in`)).length, 2);
  assert.equal((await list(`?organisation=${ORG}&since=2026-06-01`)).length, 2);
  assert.equal((await list('?organisation=nobody')).length, 0);
  assert.equal((await call(app, 'GET', '/api/dispatches?direction=sideways')).status, 400);

  const item = await (await call(app, 'POST', '/api/items', { type: 'letter', title: 'Follow-up letter', project_id: 'orinoco-partnership', origin: { source: 'assistant' },
    content_hash: 'sha256:' + '7'.repeat(64), organisation_ids: [ORG] })).json();
  const ref = (await (await call(app, 'POST', '/api/references/reserve')).json()).reference_no;
  const made = await call(app, 'POST', '/api/dispatches', { item_id: item.id, direction: 'out', organisation_id: ORG, contact_ids: ['maria-fernandez'], channel: 'courier',
    occurred_at: '2026-09-28T10:00:00Z', reference_no: ref, signed_by: 'chris', in_reply_to: seed.dispatches[5].id, tracking: 'DHL 123' });
  assert.equal(made.status, 201);
  const d = await made.json();
  assert.equal(d.recorded_by, 'chris'); assert.equal(d.reference_no, ref); assert.equal(d.acknowledged_at, null); assert.equal(d.item.title, 'Follow-up letter');
  assert.equal((await list(`?organisation=${ORG}`)).length, 7);
  const file = await (await call(app, 'GET', `/api/organisations/${ORG}/file`)).json();
  assert.equal(file.dispatches.at(-1).id, d.id, 'appears last in the file');

  const ack = await call(app, 'POST', `/api/dispatches/${d.id}/acknowledge`, { at: '2026-09-29T08:00:00Z' });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).acknowledged_at, '2026-09-29T08:00:00.000Z');
  assert.equal((await call(app, 'POST', `/api/dispatches/${d.id}/acknowledge`)).status, 409);
  assert.equal((await call(app, 'POST', `/api/dispatches/${seed.dispatches[1].id}/acknowledge`)).status, 200, 'no body means now');
  assert.equal((await call(app, 'POST', '/api/dispatches/00000000-0000-4000-8000-0000000000ff/acknowledge')).status, 404);

  // reference defaults from the item; validation and referential checks
  const withRef = await (await call(app, 'POST', '/api/dispatches', { item_id: seed.items[0].id, direction: 'in', organisation_id: ORG, channel: 'hand', occurred_at: '2026-09-29T00:00:00Z' })).json();
  assert.equal(withRef.reference_no, 'ATC-2026-0098');
  const bad = async (b: any, p: string) => { const x = await call(app, 'POST', '/api/dispatches', { item_id: item.id, direction: 'out', organisation_id: ORG, channel: 'email', occurred_at: '2026-09-29T00:00:00Z', ...b }); assert.equal(x.status, 400, JSON.stringify(b)); assert.equal((await x.json()).error.path, p); };
  await bad({ channel: 'pigeon' }, '/channel');
  await bad({ reference_no: 'REF-1' }, '/reference_no');
  await bad({ item_id: '00000000-0000-4000-8000-0000000000fe' }, '/item_id');
  await bad({ organisation_id: 'ghost' }, '/organisation_id');
  await bad({ contact_ids: ['ghost'] }, '/contact_ids');
  await bad({ contact_ids: ['carlos-rojas'], organisation_id: 'other-oil' }, '/contact_ids');
  await bad({ in_reply_to: '00000000-0000-4000-8000-0000000000fd' }, '/in_reply_to');
  await bad({ signed_by: 'ghost' }, '/signed_by');
  const notMe = await call(app, 'POST', '/api/dispatches', { item_id: item.id, direction: 'out', organisation_id: ORG, channel: 'email', occurred_at: '2026-09-29T00:00:00Z', recorded_by: 'someone' });
  assert.equal(notMe.status, 403);
});

test('firm assets: list, current by kind and language, ambiguity, and settings', async () => {
  const fa = await (await call(app, 'GET', '/api/firm-assets')).json();
  assert.equal(fa.firm_assets.length, 8);
  const lh = await call(app, 'GET', '/api/firm-assets/letterhead/current?language=es');
  assert.equal(lh.status, 200);
  const es = await lh.json();
  assert.deepEqual([es.id, es.kind, es.language, es.version, es.path], ['letterhead-es-v1', 'letterhead', 'es', 1, 'vault/firm/assets/letterhead-es.docx']);
  assert.match(es.content_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await (await call(app, 'GET', '/api/firm-assets/letterhead/current')).json()).id, 'letterhead-en-v1', 'language defaults to en');
  assert.equal((await call(app, 'GET', '/api/firm-assets/letterhead/current?language=fr')).status, 404);
  const amb = await call(app, 'GET', '/api/firm-assets/template/current');
  assert.equal(amb.status, 400);
  assert.equal((await amb.json()).error.code, 'ambiguous');
  assert.equal((await (await call(app, 'GET', '/api/firm-assets/template/current?name=letter-template')).json()).id, 'letter-template-v1');
  assert.equal((await call(app, 'GET', '/api/firm-assets/wallpaper/current')).status, 400);
  assert.equal((await (await call(app, 'GET', '/api/firm-assets?kind=logo')).json()).firm_assets.length, 3);
  assert.equal((await call(app, 'GET', '/api/firm-assets?kind=bogus')).status, 400);

  // settings: partners write, everyone reads
  const put = await call(app, 'PUT', '/api/settings/day-rates', { value: { partner: 1800, associate: 900 } });
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).value, { partner: 1800, associate: 900 });
  await call(app, 'PUT', '/api/settings/day-rates', { value: { partner: 2000 } });
  const ana = await appFor(`ana.perez@${DOMAIN}`);
  assert.deepEqual((await (await call(ana, 'GET', '/api/settings/day-rates')).json()).value, { partner: 2000 });
  assert.deepEqual((await (await call(ana, 'GET', '/api/settings')).json()).settings, { 'day-rates': { partner: 2000 } });
  assert.equal((await call(ana, 'PUT', '/api/settings/day-rates', { value: 1 })).status, 403);
  assert.equal((await call(app, 'PUT', '/api/settings/Bad Key', { value: 1 })).status, 400);
  assert.equal((await call(app, 'PUT', '/api/settings/no-value', { nope: 1 })).status, 400);
  assert.equal((await call(app, 'GET', '/api/settings/missing')).status, 404);
  assert.equal((await call(app, 'DELETE', '/api/settings/day-rates')).status, 200);
  assert.equal((await call(app, 'GET', '/api/settings/day-rates')).status, 404);
});
