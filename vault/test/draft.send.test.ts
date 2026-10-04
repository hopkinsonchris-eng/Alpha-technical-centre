// Wave 6, PR 4 (docs/vault-hub/wave6/05-markup.md §1.5; W6-AC9): Send from the person's own mailbox: the draft rendered,
// the attachment uploaded, the message sent from the connected address only, the dispatch written, the draft frozen,
// and the sent copy captured on the next poll files to the draft's project citing the draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureDraft } from '../src/api/draft.routes.ts';
import { configureSend } from '../src/api/draft.send.routes.ts';
import { FakeProvider } from '../src/llm/provider.ts';
import { sealSecret } from '../src/secrets.ts';
import { serviceSink } from '../src/ingest/items-client.ts';
import { captureMessage } from '../src/ingest/mail/capture.ts';
import { filesystemStorage } from '../src/storage.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const DOMAIN = 'alpha-technical-centre.com';
const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const KEY = randomBytes(32).toString('base64');
const ENV = { VAULT_TOKEN_KEY: KEY, ZOHO_MAIL_CLIENT_ID: '1000.X', ZOHO_MAIL_CLIENT_SECRET: 'shh', ALLOWED_EMAIL_DOMAIN: DOMAIN };
const json = (b: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

function zohoFetch(log: Array<{ url: string; init: any }>, o: { fail?: number } = {}) {
  return (async (url: any, init: any = {}) => {
    const u = String(url); log.push({ url: u, init });
    if (u.endsWith('/oauth/v2/token')) return Response.json({ access_token: 'at-send', expires_in: 3600 });
    if (/\/messages\/attachments\?fileName=/.test(u)) return Response.json({ status: { code: 200 }, data: [{ storeName: 'store-1', attachmentName: decodeURIComponent(u.split('fileName=')[1]), attachmentPath: '/tmp/x' }] });
    if (/\/messages$/.test(u) && init.method === 'POST') { if (o.fail) return Response.json({ status: { code: o.fail, description: 'Too many' } }, { status: o.fail }); return Response.json({ status: { code: 200 }, data: { messageId: '9988776655', subject: JSON.parse(init.body).subject } }); }
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;
}

async function setup(o: { scopes?: string[]; connection?: boolean; fail?: number } = {}) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("UPDATE projects SET members = '{chris}' WHERE id = 'orinoco-partnership'");
  configureDraft({ provider: new FakeProvider(() => 'Dear María, thank you for the index.\n\nWe will return the NDA by Friday.\n\nKind regards.'), search: {} });
  const log: Array<{ url: string; init: any }> = [];
  configureSend({ fetch: zohoFetch(log, { fail: o.fail }), env: ENV, now: () => new Date('2026-10-04T15:00:00Z') });
  if (o.connection !== false) await db.query(`INSERT INTO mailbox_connections (id, person_id, provider, address, account_id, accounts_url, api_url, refresh_token_enc, scopes) VALUES ($1,'chris','zoho-mail',$2,'776','https://accounts.zoho.eu','https://mail.zoho.eu',$3,$4::text[])`,
    [randomUUID(), `chris@${DOMAIN}`, sealSecret('rt-send', Buffer.from(KEY, 'base64')), o.scopes ?? ['ZohoMail.accounts.READ', 'ZohoMail.folders.READ', 'ZohoMail.messages.READ', 'ZohoMail.messages.CREATE']]);
  const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` }, version: 'test' });
  const d: any = await (await app.request('/api/draft', json({ kind: 'letter', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Thank them for the data room index and promise the NDA by Friday.' }))).json();
  assert.ok(d.id, JSON.stringify(d));
  await app.request(`/api/items/${d.id}/review`, json({ decisions: ['keep', 'keep', 'drop'] }, 'PATCH'));
  return { db, app, log, draft: d };
}

test('W6-AC9: Send renders the letter, uploads it, sends from the connected address to the contacts, writes the dispatch and freezes the draft; a second Send is 409; from cannot be chosen', async () => {
  const { db, app, log, draft } = await setup();
  const r = await app.request(`/api/items/${draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], attachment: 'docx', subject: 'Data room index' }));
  assert.equal(r.status, 201, await r.clone().text());
  const b: any = await r.json();
  assert.equal(b.from, `chris@${DOMAIN}`); assert.deepEqual(b.contact_ids, ['maria-fernandez']); assert.ok(b.to[0].includes('@')); assert.equal(b.subject, 'Data room index');
  assert.match(b.reference_no, /^ATC-\d{4}-\d{4}$/); assert.deepEqual(b.attachments, [b.reference_no + '.docx']); assert.equal(b.zoho_message_id, '9988776655');
  const upload = log.find(l => l.url.includes('/messages/attachments?fileName='))!;
  assert.ok(upload, 'the DOCX was uploaded'); assert.match(upload.url, /mail\.zoho\.eu\/api\/accounts\/776\//); assert.ok((upload.init.body as Uint8Array).length > 500, 'a real DOCX');
  const send = log.find(l => /\/messages$/.test(l.url))!;
  const body = JSON.parse(send.init.body);
  assert.equal(body.fromAddress, `chris@${DOMAIN}`); assert.equal(body.toAddress, b.to.join(',')); assert.equal(body.attachments[0].storeName, 'store-1');
  assert.match(body.content, /Please find attached our letter ATC-/); assert.equal(body.mailFormat, 'plaintext');
  assert.equal(send.init.headers.authorization, 'Zoho-oauthtoken at-send');
  const row = (await db.query<any>("SELECT extracted->'sent' AS sent, reference_no FROM items WHERE id = $1", [draft.id])).rows[0];
  assert.equal(row.sent.via, 'zoho-mail'); assert.equal(row.sent.zoho_message_id, '9988776655'); assert.equal(row.sent.from, `chris@${DOMAIN}`); assert.deepEqual(row.sent.addresses, b.to); assert.equal(row.reference_no, b.reference_no);
  const d = (await db.query<any>('SELECT direction, channel, contact_ids, signed_by, notes FROM dispatches WHERE item_id = $1', [draft.id])).rows;
  assert.equal(d.length, 1); assert.deepEqual([d[0].direction, d[0].channel, d[0].contact_ids, d[0].signed_by], ['out', 'email', ['maria-fernandez'], 'chris']); assert.match(d[0].notes, /Sent from chris@/);
  assert.equal((await app.request(`/api/items/${draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'] }))).status, 409, 'frozen');
  assert.equal((await app.request(`/api/items/${draft.id}/review`, json({ decisions: ['keep', 'keep', 'keep'] }, 'PATCH'))).status, 409, 'the review is frozen too');
  const other = await setup();
  assert.equal((await other.app.request(`/api/items/${other.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], from: 'someone@else.example' }))).status, 400);
  assert.equal((await other.app.request(`/api/items/${other.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['nobody'] }))).status, 409);
  assert.equal((await other.app.request(`/api/items/${other.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], attachment: 'zip' }))).status, 400);
  const detail = (await db.query<any>(`SELECT detail FROM audit_events WHERE action = 'draft.send' ORDER BY id LIMIT 1`)).rows[0].detail;
  assert.equal(detail.from, `chris@${DOMAIN}`); assert.equal(detail.attachment, 'docx');
  await db.close(); await other.db.close();
});

test('W6-AC9: without a connection, or without the send scope, Send says so (409) and Mark as sent still works; an email draft goes as its own text without an attachment; a Zoho failure sends nothing and freezes nothing', async () => {
  const none = await setup({ connection: false });
  const r1 = await none.app.request(`/api/items/${none.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'] }));
  assert.equal(r1.status, 409); assert.equal((await r1.json() as any).error.code, 'no_mailbox');
  assert.equal((await none.app.request(`/api/items/${none.draft.id}/sent`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], channel: 'email' }))).status, 201);
  await none.db.close();
  const ro = await setup({ scopes: ['ZohoMail.messages.READ'] });
  const r2 = await ro.app.request(`/api/items/${ro.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'] }));
  assert.equal(r2.status, 409); assert.equal((await r2.json() as any).error.code, 'no_send_scope');
  await ro.db.close();
  const em = await setup();
  const e: any = await (await em.app.request('/api/draft', json({ kind: 'email', project_id: 'orinoco-partnership', organisation_id: 'petrolera-del-orinoco', brief: 'Ask for the index.' }))).json();
  const r3 = await em.app.request(`/api/items/${e.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], attachment: 'none' }));
  assert.equal(r3.status, 201, await r3.clone().text());
  const send = em.log.filter(l => /\/messages$/.test(l.url)).pop()!;
  const body = JSON.parse(send.init.body);
  assert.match(body.content, /Dear María, thank you for the index\./); assert.equal(body.attachments, undefined);
  assert.equal(em.log.some(l => l.url.includes('/messages/attachments')), false);
  await em.db.close();
  const bad = await setup({ fail: 429 });
  const r4 = await bad.app.request(`/api/items/${bad.draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'] }));
  assert.equal(r4.status, 429); assert.equal((await r4.json() as any).error.code, 'send_failed');
  assert.equal((await bad.db.query<any>("SELECT extracted->'sent' AS s FROM items WHERE id = $1", [bad.draft.id])).rows[0].s, null, 'nothing recorded');
  assert.equal((await bad.db.query<any>('SELECT count(*)::int AS n FROM dispatches WHERE item_id = $1', [bad.draft.id])).rows[0].n, 0);
  await bad.db.close();
});

test('W6-AC9: the sent copy, captured on the next poll, files to the draft\'s project with the draft cited and the draft pointing at it', async () => {
  const { db, app, draft } = await setup();
  const r: any = await (await app.request(`/api/items/${draft.id}/send`, json({ organisation_id: 'petrolera-del-orinoco', contact_ids: ['maria-fernandez'], subject: 'Data room index' }))).json();
  const storage = filesystemStorage(await mkdtemp(path.join(tmpdir(), 'vault-send-')));
  const cap = await captureMessage(db, storage, {
    mailbox: `chris@${DOMAIN}`, external_id: 'zoho-sent-1@mail.zoho.eu', thread_id: 'zoho-sent-1@mail.zoho.eu', in_reply_to: null, references: [], from: { address: `chris@${DOMAIN}`, name: 'Chris' },
    to: r.to.map((a: string) => ({ address: a })), cc: [], subject: 'Data room index', date: '2026-10-04T15:00:20.000Z', text: 'Please find attached our letter.', attachments: [], labels: [], folder: 'sent',
  }, { sink: await serviceSink(db), ingest: null, origin: 'zoho-mail', context: { person_id: 'chris', privacy: 'all' } });
  assert.equal(cap.status, 'created'); assert.equal(cap.project_id, 'orinoco-partnership'); assert.equal(cap.filed, true); assert.equal(cap.confidence, 1);
  const it = (await db.query<any>('SELECT extracted FROM items WHERE id = $1', [cap.item_id])).rows[0].extracted;
  assert.equal(it.sent_draft_id, draft.id); assert.equal(it.classification.evidence[0].detail, `sent from the Hub as ${r.reference_no}`);
  assert.equal((await db.query<any>('SELECT count(*)::int AS n FROM item_cites WHERE item_id = $1 AND ref = $2', [cap.item_id, 'doc:' + draft.id])).rows[0].n, 1);
  assert.equal((await db.query<any>("SELECT extracted->'sent'->>'captured_item_id' AS c FROM items WHERE id = $1", [draft.id])).rows[0].c, cap.item_id);
  await db.close();
});
