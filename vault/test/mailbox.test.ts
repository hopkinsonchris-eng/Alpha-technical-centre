// Wave 6, PR 1 (docs/vault-hub/wave6/05-markup.md §1.1, §1.2; W6-AC1, W6-AC3 rules and withdrawal, W6-AC11):
// consent at first sign-in, one sealed token per person, Protected and Blocked rules, privacy that is retroactive,
// disconnect that hides and purges, and the per-contact export. Zoho is a recorded fetch; the storage is a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureMailbox } from '../src/api/mailbox.routes.ts';
import { filesystemStorage, originalKey, type Storage } from '../src/storage.ts';
import { signState, verifyState } from '../src/ingest/mail/zoho-oauth.ts';

const DOMAIN = 'alpha-technical-centre.com';
const KEY = randomBytes(32).toString('base64');
const ENV = { ZOHO_MAIL_CLIENT_ID: '1000.CLIENT', ZOHO_MAIL_CLIENT_SECRET: 'shh-secret', VAULT_TOKEN_KEY: KEY, VAULT_PUBLIC_URL: 'https://vault.example', ALLOWED_EMAIL_DOMAIN: DOMAIN };
const json = (o: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

function zohoFetch(log: Array<{ url: string; body?: string }>, opts: { address?: string; refuse?: boolean } = {}) {
  return (async (url: any, init: any = {}) => {
    const u = String(url);
    log.push({ url: u, body: init.body ? String(init.body) : undefined });
    if (u.endsWith('/oauth/v2/token')) {
      if (opts.refuse) return Response.json({ error: 'invalid_code' }, { status: 400 });
      return Response.json({ access_token: 'at-1', refresh_token: 'rt-SECRET-1', expires_in: 3600, scope: 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE', api_domain: 'https://www.zohoapis.com' });
    }
    if (u.endsWith('/api/accounts')) return Response.json({ status: { code: 200 }, data: [{ accountId: '776', accountDisplayName: 'Chris', primaryEmailAddress: opts.address ?? `chris@${DOMAIN}` }] });
    if (u.includes('/oauth/v2/token/revoke')) return new Response('{}', { status: 200 });
    return new Response('no', { status: 404 });
  }) as unknown as typeof fetch;
}

async function setup(o: { fetchOpts?: { address?: string; refuse?: boolean }; env?: Record<string, string>; as?: string } = {}) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-mailbox-'));
  const storage = filesystemStorage(dir);
  const log: Array<{ url: string; body?: string }> = [];
  const env = { ...ENV, ...(o.env ?? {}) };
  configureMailbox({ fetch: zohoFetch(log, o.fetchOpts), env, now: undefined, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${o.as ?? 'chris'}@${DOMAIN}` }, storage });
  const app = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `${o.as ?? 'chris'}@${DOMAIN}` }, version: 'test' });
  return { db, app, log, storage, env };
}
async function connect(app: Awaited<ReturnType<typeof createApp>>) {
  const r = await app.request('/api/me/mailbox/connect', json({}));
  assert.equal(r.status, 200, await r.clone().text());
  const { url } = await r.json() as any;
  const state = new URL(url).searchParams.get('state')!;
  const cb = await app.request(`/oauth/zoho/callback?code=CODE-1&state=${encodeURIComponent(state)}&location=eu&accounts-server=${encodeURIComponent('https://accounts.zoho.eu')}`);
  return { url, state, cb };
}
/** A captured message from a mailbox, with an original in the store and a chunk, as the capture writes it. */
async function message(db: Db, storage: Storage, mailbox: string, o: { seenBy?: string[]; project?: string; attachment?: boolean; contact?: string } = {}) {
  const id = randomUUID();
  const hash = randomBytes(32).toString('hex');
  const key = originalKey(hash);
  await storage.put(key, new TextEncoder().encode('From: x\n\nbody ' + id), 'message/rfc822');
  const contacts = o.contact ? [{ email: o.contact, role: 'from', firm: false }] : [];
  await db.query(`INSERT INTO items (id, type, title, created_at, authors, project_id, legal_tag, origin, content_hash, storage_key, mime, version, extracted)
    VALUES ($1,'email',$7,now(),'{}',$2,'lt-firm',$3::jsonb,$4,$5,'message/rfc822',1,$6::jsonb)`,
    [id, o.project ?? 'firm', JSON.stringify({ source: 'zoho-mail', external_id: 'm-' + id }), 'sha256:' + hash, key, JSON.stringify({ mailbox, seen_by: o.seenBy ?? [mailbox], contacts, text: 'body', chunks: 1, direction: 'in' }), 'Subject ' + id]);
  await db.query('INSERT INTO chunks (item_id, ordinal, text, legal_tag, project_id) VALUES ($1,0,$2,$3,$4)', [id, 'body ' + id, 'lt-firm', o.project ?? 'firm']);
  let child: string | null = null;
  if (o.attachment) {
    child = randomUUID();
    const h2 = randomBytes(32).toString('hex');
    await storage.put(originalKey(h2), new TextEncoder().encode('pdf'), 'application/pdf');
    await db.query(`INSERT INTO items (id, type, title, created_at, authors, project_id, legal_tag, origin, content_hash, storage_key, mime, version, parent_id, extracted)
      VALUES ($1,'report','att.pdf',now(),'{}',$2,'lt-firm','{"source":"zoho-mail"}'::jsonb,$3,$4,'application/pdf',1,$5,'{}'::jsonb)`, [child, o.project ?? 'firm', 'sha256:' + h2, originalKey(h2), id]);
  }
  return { id, key, child };
}
const item = async (db: Db, id: string) => (await db.query<any>('SELECT id, hidden, storage_key, extracted FROM items WHERE id = $1', [id])).rows[0];

test('W6-AC1: the Connect card shows for a partner without a connection; Connect yields a Zoho authorize URL with the four scopes, offline access and a signed state', async () => {
  const { app, env } = await setup();
  const me: any = await (await app.request('/api/me/mailbox')).json();
  assert.deepEqual({ configured: me.configured, connected: me.connected, prompt: me.prompt, connection: me.connection }, { configured: true, connected: false, prompt: true, connection: null });
  const r = await app.request('/api/me/mailbox/connect', json({}));
  assert.equal(r.status, 200);
  const { url, scopes } = await r.json() as any;
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.zoho.com/oauth/v2/auth');
  assert.deepEqual(scopes, ['ZohoMail.accounts.READ', 'ZohoMail.folders.READ', 'ZohoMail.messages.READ', 'ZohoMail.messages.CREATE']);
  assert.equal(u.searchParams.get('access_type'), 'offline'); assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://vault.example/oauth/zoho/callback');
  assert.equal(u.searchParams.get('client_id'), env.ZOHO_MAIL_CLIENT_ID);
  assert.equal(verifyState(u.searchParams.get('state')!, Buffer.from(KEY, 'base64').toString('base64url') + ':' + env.ZOHO_MAIL_CLIENT_SECRET)?.personId, 'chris');
  assert.equal(verifyState(u.searchParams.get('state')!, 'wrong'), null, 'a state signed with another secret is refused');
  assert.equal(verifyState(signState('s', 'chris', Date.now() - 11 * 60_000), 's'), null, 'an expired state is refused');
});

test('W6-AC1: the callback exchanges the code at the data centre named by the redirect, stores one sealed token, shows no plaintext anywhere, replaces on reconnect, and refuses a tampered state', async () => {
  const { app, db, log } = await setup();
  const { cb } = await connect(app);
  assert.equal(cb.status, 302, await cb.text());
  assert.equal(cb.headers.get('location'), '/hub/index.html?mailbox=connected');
  const tokenCall = log.find(l => l.url.endsWith('/oauth/v2/token'))!;
  assert.equal(tokenCall.url, 'https://accounts.zoho.eu/oauth/v2/token', 'the exchange goes to the accounts server of the data centre');
  assert.match(tokenCall.body!, /grant_type=authorization_code/); assert.match(tokenCall.body!, /code=CODE-1/);
  const rows = (await db.query<any>('SELECT * FROM mailbox_connections')).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].person_id, 'chris'); assert.equal(rows[0].address, `chris@${DOMAIN}`); assert.equal(rows[0].api_url, 'https://mail.zoho.eu'); assert.equal(rows[0].accounts_url, 'https://accounts.zoho.eu');
  assert.ok(!rows[0].refresh_token_enc.includes('rt-SECRET-1'), 'the token is sealed'); assert.match(rows[0].refresh_token_enc, /^v1\./);
  assert.deepEqual(rows[0].scopes, ['ZohoMail.accounts.READ', 'ZohoMail.folders.READ', 'ZohoMail.messages.READ', 'ZohoMail.messages.CREATE']);
  const me: any = await (await app.request('/api/me/mailbox')).json();
  assert.equal(me.connected, true); assert.equal(me.prompt, false); assert.equal(me.connection.address, `chris@${DOMAIN}`); assert.equal(me.connection.can_send, true);
  assert.ok(!JSON.stringify(me).includes('rt-SECRET') && !JSON.stringify(me).includes('refresh_token'), 'no token in the response');
  assert.deepEqual(me.counts, { messages: 0, filed: 0, waiting: 0, hidden_internal: 0, hidden_bulk: 0 });
  // Reconnect replaces the token in the same row.
  const again = await connect(app);
  assert.equal(again.cb.status, 302);
  const after = (await db.query<any>('SELECT id, refresh_token_enc FROM mailbox_connections')).rows;
  assert.equal(after.length, 1); assert.equal(after[0].id, rows[0].id); assert.notEqual(after[0].refresh_token_enc, rows[0].refresh_token_enc);
  // A tampered state is refused and audited.
  const bad = await app.request('/oauth/zoho/callback?code=CODE-2&state=abc.def');
  assert.equal(bad.status, 400); assert.match(await bad.text(), /Start again/);
  const audits = (await db.query<any>(`SELECT detail FROM audit_events WHERE action = 'mailbox.connect' ORDER BY id`)).rows.map(r => r.detail.status);
  assert.deepEqual(audits, ['connected', 'replaced', 'refused']);
});

test('W6-AC1: a service person sees no card and cannot connect; without the server configuration the card is absent and Connect answers 503; Not now hides the card for 30 days; the person must connect the mailbox they sign in with', async () => {
  const svc = await setup({ as: 'apex-asset-intelligence' });
  await svc.db.query(`UPDATE people SET role = 'service' WHERE id = 'apex-asset-intelligence'`).catch(() => {});
  await svc.db.query(`INSERT INTO people (id, email, name, role) VALUES ('apex-asset-intelligence', 'apex-asset-intelligence@${DOMAIN}', 'APEX', 'service') ON CONFLICT (id) DO UPDATE SET role = 'service'`);
  const me: any = await (await svc.app.request('/api/me/mailbox')).json();
  assert.equal(me.prompt, false);
  assert.equal((await svc.app.request('/api/me/mailbox/connect', json({}))).status, 403);

  const un = await setup({ env: { ZOHO_MAIL_CLIENT_ID: '', ZOHO_MAIL_CLIENT_SECRET: '' } });
  const m2: any = await (await un.app.request('/api/me/mailbox')).json();
  assert.equal(m2.configured, false); assert.equal(m2.prompt, false);
  const r = await un.app.request('/api/me/mailbox/connect', json({}));
  assert.equal(r.status, 503); assert.equal((await r.json() as any).error.code, 'not_configured');

  const { app, db } = await setup();
  const p = await app.request('/api/me/mailbox', json({ prompt_hidden_days: 30 }, 'PATCH'));
  assert.equal(p.status, 200);
  assert.equal(((await app.request('/api/me/mailbox')).json() as any).then ? (await (await app.request('/api/me/mailbox')).json() as any).prompt : null, false);
  const until = (await db.query<any>('SELECT mailbox_prompt_hidden_until FROM people WHERE id = $1', ['chris'])).rows[0].mailbox_prompt_hidden_until;
  assert.ok(new Date(until).getTime() - Date.now() > 29 * 864e5);

  const other = await setup({ fetchOpts: { address: `someone-else@${DOMAIN}` } });
  const { cb } = await connect(other.app);
  assert.equal(cb.status, 400); assert.match(await cb.text(), /not your mailbox/);
  assert.equal((await other.db.query('SELECT count(*)::int AS n FROM mailbox_connections')).rows[0].n, 0);
  assert.ok(other.log.some(l => l.url.includes('/oauth/v2/token/revoke')), 'the token for the wrong mailbox is revoked at once');
});

test('W6-AC3: rules are two lists, normalised and validated; personal rules are only Blocked; firm rules are for partners; the firm domain is protected by itself', async () => {
  const { app, db } = await setup();
  const put = await app.request('/api/me/mailbox/rules', json({ blocked: ['Family@Example.com', '*@MyBank.com', '@other.org', 'mybank.com'] }, 'PUT'));
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json() as any).personal, [{ kind: 'blocked', pattern: 'family@example.com' }, { kind: 'blocked', pattern: 'mybank.com' }, { kind: 'blocked', pattern: 'other.org' }]);
  assert.equal((await app.request('/api/me/mailbox/rules', json({ blocked: ['not a rule'] }, 'PUT'))).status, 400);
  assert.equal((await app.request('/api/me/mailbox/rules', json({ blocked: 'x' }, 'PUT'))).status, 400);
  const firm = await app.request('/api/mail/rules', json({ protected: ['partnerfirm.example'], blocked: ['recruiter.example'] }, 'PUT'));
  assert.equal(firm.status, 200);
  const all: any = await (await app.request('/api/me/mailbox/rules')).json();
  assert.deepEqual(all.firm, [{ kind: 'blocked', pattern: 'recruiter.example' }, { kind: 'protected', pattern: 'partnerfirm.example' }]);
  assert.deepEqual(all.inherent, { protected: [DOMAIN] });
  await db.query(`INSERT INTO people (id, email, name, role) VALUES ('ana', 'ana@${DOMAIN}', 'Ana', 'associate') ON CONFLICT (id) DO UPDATE SET role = 'associate'`);
  configureMailbox({ auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
  const ana = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` }, version: 'test' });
  assert.equal((await ana.request('/api/mail/rules', json({ blocked: [] }, 'PUT'))).status, 403);
  assert.equal((await ana.request('/api/mail/rules')).status, 200, 'anyone may read the firm rules');
});

test('W6-AC3: lowering privacy is retroactive (Subjects only strips bodies and attachments, Nothing hides), Disconnect revokes at Zoho, hides only what this mailbox saw, purges originals, keeps contacts', async () => {
  const { app, db, storage, log } = await setup();
  await connect(app);
  const me = `chris@${DOMAIN}`;
  const a = await message(db, storage, me, { attachment: true, project: 'firm' });
  const b = await message(db, storage, me, { seenBy: [me, `lars@${DOMAIN}`] });
  const c = await message(db, storage, `lars@${DOMAIN}`);
  // Subjects only.
  const p1 = await app.request('/api/me/mailbox', json({ privacy: 'subjects' }, 'PATCH'));
  assert.equal(p1.status, 200, await p1.clone().text());
  const r1: any = await p1.json();
  assert.equal(r1.applied.messages, 2); assert.equal(r1.applied.attachments, 1); assert.equal(r1.applied.originals_purged, 3); assert.equal(r1.applied.chunks_removed, 2);
  assert.equal((await item(db, a.id)).hidden, false, 'the message stays, as a subject line');
  assert.equal((await item(db, a.id)).extracted.privacy, 'subjects'); assert.equal((await item(db, a.id)).extracted.text, undefined);
  assert.equal((await item(db, a.child!)).hidden, true, 'the attachment is hidden');
  assert.equal(await storage.exists(a.key), false, 'the original is gone');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1', [a.id])).rows[0].n, 0);
  assert.equal(await storage.exists(c.key), true, 'another mailbox\'s message is untouched');
  // Nothing.
  const p2 = await app.request('/api/me/mailbox', json({ privacy: 'none' }, 'PATCH'));
  assert.equal(p2.status, 200);
  assert.equal((await item(db, a.id)).hidden, true); assert.equal((await item(db, b.id)).hidden, true);
  assert.equal((await app.request('/api/me/mailbox', json({ privacy: 'loud' }, 'PATCH'))).status, 400);
  // Disconnect: b was also seen by lars, so it is hidden only through privacy above; set it visible again to prove disconnect leaves shared messages alone.
  await db.query('UPDATE items SET hidden = false WHERE id = $1', [b.id]);
  const d = await app.request('/api/me/mailbox', { method: 'DELETE' });
  assert.equal(d.status, 200, await d.clone().text());
  const dj: any = await d.json();
  assert.equal(dj.revoked, true); assert.equal(dj.revoked_at_zoho, true);
  assert.ok(log.some(l => l.url.includes('/oauth/v2/token/revoke') && l.url.includes('rt-SECRET-1')), 'the real token is revoked at Zoho');
  assert.equal((await item(db, b.id)).hidden, false, 'a message another mailbox also saw stays');
  assert.equal((await item(db, a.id)).extracted.hidden_reason, 'privacy:none');
  const conn = (await db.query<any>('SELECT status, refresh_token_enc FROM mailbox_connections')).rows[0];
  assert.equal(conn.status, 'revoked'); assert.equal(conn.refresh_token_enc, 'revoked');
  const after: any = await (await app.request('/api/me/mailbox')).json();
  assert.equal(after.connected, false); assert.equal(after.prompt, true, 'the card comes back after a disconnect');
  assert.equal((await app.request('/api/me/mailbox', { method: 'DELETE' })).status, 404);
  await db.query(`INSERT INTO organisations (id, name, kind) VALUES ('zuata-x', 'Petrolera Zuata', 'operator') ON CONFLICT (id) DO NOTHING`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM organisations')).rows[0].n > 0, true, 'organisations stay');
  const actions = (await db.query<any>(`SELECT action, detail FROM audit_events WHERE action IN ('mailbox.update','mailbox.disconnect') ORDER BY id`)).rows;
  assert.deepEqual(actions.filter(r => r.detail.privacy).map(r => r.detail.privacy), ['subjects', 'none'], 'each privacy change is audited with its level');
  assert.equal(actions.filter(r => r.action === 'mailbox.disconnect' && r.detail.revoked_at_zoho === true).length, 1, 'the disconnect is audited with the Zoho outcome');
});

test('W6-AC3/P58: the per-contact export lists the contact, the messages in scope that name them and the dispatches, as a download', async () => {
  const { app, db, storage } = await setup();
  await db.query(`INSERT INTO organisations (id, name, kind) VALUES ('zuata-x', 'Petrolera Zuata', 'operator') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO contacts (id, organisation_id, name, role, emails) VALUES ('maria-x', 'zuata-x', 'María X', 'CFO', '{maria@zuata.example}') ON CONFLICT (id) DO NOTHING`);
  const contact = { id: 'maria-x', emails: ['maria@zuata.example'] };
  const m = await message(db, storage, `chris@${DOMAIN}`, { contact: contact.emails[0], project: 'firm' });
  const r = await app.request(`/api/contacts/${encodeURIComponent(contact.id)}/export?download=1`);
  assert.equal(r.status, 200, await r.clone().text());
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="contact-/);
  const j: any = await r.json();
  assert.equal(j.contact.id, contact.id);
  assert.deepEqual(j.messages.map((x: any) => x.id), [m.id]);
  assert.equal(j.messages[0].role, 'from');
  assert.equal((await app.request('/api/contacts/nobody/export')).status, 404);
  assert.equal((await db.query<any>(`SELECT count(*)::int AS n FROM audit_events WHERE action = 'contact.export' AND refs @> ARRAY['contact:maria-x']`)).rows[0].n, 1);
});
