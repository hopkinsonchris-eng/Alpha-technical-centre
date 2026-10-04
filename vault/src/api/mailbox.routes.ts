/**
 * Each person's mailbox, by consent (wave 6, docs/vault-hub/wave6/05-markup.md §1.1, §1.2; D60, D61, P50, P54, P58).
 *   POST   /api/me/mailbox/connect        the Zoho authorize URL for the signed-in person (signed state)
 *   GET    /oauth/zoho/callback           behind Cloudflare Access: exchange the code, read the account, store one sealed token
 *   GET    /api/me/mailbox                the connection, what it holds, whether to show the Connect card
 *   PATCH  /api/me/mailbox                privacy level (retroactive), history window, hide the card for a while
 *   DELETE /api/me/mailbox                revoke at Zoho, hide the messages only this mailbox saw, purge their originals
 *   GET/PUT /api/me/mailbox/rules         the person's Blocked list;  GET/PUT /api/mail/rules  the firm's Protected and Blocked (partners)
 *   GET    /api/contacts/:id/export       what the Vault holds that names a contact (a subject access request), in scope
 * The refresh token is sealed with VAULT_TOKEN_KEY and never appears in a response; the Zoho client secret stays on the server.
 */
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { authenticate, configFromEnv, type AuthConfig, type Person } from '../auth.ts';
import { audit } from '../audit.ts';
import { openStorage, type Storage } from '../storage.ts';
import { openSecret, sealSecret, tokenKeyFromEnv } from '../secrets.ts';
import { ApiError, bad, canSee, forbidden, iso, jsonBody, loadAccess, notFound, requirePartner, route } from './common.ts';
import { authorizeUrl, exchangeCode, fetchAccount, mailApiUrl, revokeRefreshToken, signState, verifyState, zohoMailClientFromEnv, type ZohoMailClient } from '../ingest/mail/zoho-oauth.ts';
import { applyPrivacy, mailboxCounts, PRIVACY_LEVELS, withdrawMailbox, type Privacy } from '../ingest/mail/privacy.ts';
import { normaliseDomain } from './organisations.routes.ts';
import { firmDomains } from '../ingest/mail/classify.ts';

export interface MailboxDeps { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => Date; auth?: AuthConfig; storage?: Storage | null }
let deps: MailboxDeps = {};
/** Tests inject the Zoho endpoints (fetch), the environment (client id and secret, token key), the clock, the auth and a storage. */
export function configureMailbox(d: MailboxDeps) { deps = { ...deps, ...d }; }
const env = () => deps.env ?? process.env;
const now = () => deps.now?.() ?? new Date();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
function page(title: string, en: string, es: string, status = 400) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Alpha Technical Centre</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/hub/hub.css"><style>.consent{max-width:560px;margin:48px auto;padding:0 20px}.consent .card{padding:24px}.consent h1{font-size:1.4rem;margin:0 0 8px}.consent p{margin:8px 0}.consent .es{color:var(--muted,#6b7280);font-size:.95em}</style></head>
<body class="hub"><main class="consent"><div class="card"><h1>${esc(title)}</h1><p>${esc(en)}</p><p class="es">${esc(es)}</p><p><a class="btn btn-outline btn-sm" href="/hub/settings.html">Settings · Ajustes</a></p></div></main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' } });
}

/** A pattern is an address (kept whole) or a domain (no @, no wildcard); anything else is refused. */
export function normalisePattern(raw: unknown): string {
  if (typeof raw !== 'string') throw bad('a rule is an address or a domain', '/rules');
  const t = raw.trim().toLowerCase().replace(/^\*@/, '@');
  if (!t) throw bad('a rule is an address or a domain', '/rules');
  if (t.includes('@')) {
    const [local, domain] = t.startsWith('@') ? ['', t.slice(1)] : t.split('@');
    const d = normaliseDomain(domain ?? '');
    if (!d || !d.includes('.')) throw bad(`"${raw}" is not an address or a domain`, '/rules');
    return local ? `${local}@${d}` : d;
  }
  const d = normaliseDomain(t);
  if (!d.includes('.')) throw bad(`"${raw}" is not an address or a domain`, '/rules');
  return d;
}

async function connectionOf(db: RouteDeps['db'], personId: string) {
  return (await db.query<any>(`SELECT * FROM mailbox_connections WHERE person_id = $1 AND status <> 'revoked' ORDER BY connected_at DESC LIMIT 1`, [personId])).rows[0] ?? null;
}
function view(c: any) {
  return c ? {
    id: c.id, address: c.address, provider: c.provider, status: c.status, privacy: c.privacy, scopes: c.scopes ?? [], can_send: (c.scopes ?? []).includes('ZohoMail.messages.CREATE'),
    connected_at: iso(c.connected_at), last_poll_at: iso(c.last_poll_at), last_error: c.last_error ?? null,
    history: { window_days: c.history_window_days, done_at: iso(c.history_done_at), cursor: c.history_cursor ?? null },
  } : null;
}
async function rulesOf(db: RouteDeps['db'], ownerId: string | null): Promise<Array<{ kind: 'protected' | 'blocked'; pattern: string }>> {
  return (await db.query<any>(`SELECT kind, pattern FROM mail_rules WHERE ${ownerId ? 'owner_id = $1' : 'owner_id IS NULL'} ORDER BY kind, pattern`, ownerId ? [ownerId] : [])).rows;
}
async function replaceRules(db: RouteDeps['db'], ownerId: string | null, by: string, rules: Array<{ kind: 'protected' | 'blocked'; pattern: string }>) {
  await db.query(`DELETE FROM mail_rules WHERE ${ownerId ? 'owner_id = $1' : 'owner_id IS NULL'}`, ownerId ? [ownerId] : []);
  for (const r of rules) await db.query('INSERT INTO mail_rules (id, owner_id, kind, pattern, created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [randomUUID(), ownerId, r.kind, r.pattern, by]);
}
const listOf = (v: unknown, path: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 500) throw bad('a list of up to 500 addresses or domains', path);
  return [...new Set(v.map(normalisePattern))];
};

export function register(app: Hono<Env>, { db }: RouteDeps): void {
  const cfg = () => deps.auth ?? configFromEnv();
  const client = (): ZohoMailClient | null => zohoMailClientFromEnv(env());
  const key = () => tokenKeyFromEnv(env());
  const stateSecret = () => { const k = key(); const c = client(); return (k ? k.toString('base64url') : '') + ':' + (c?.clientSecret ?? ''); };
  let storage: Storage | null | undefined;
  const store = () => (deps.storage !== undefined ? deps.storage : (storage ??= openStorage(env(), { fetch: deps.fetch })));
  const configured = () => !!client() && !!key();

  route(app, 'POST', '/api/me/mailbox/connect', 'mailbox.connect.start', async (x) => {
    if (x.person.role === 'service') throw forbidden('an app has no mailbox to connect');
    const c = client();
    if (!c || !key()) throw new ApiError(503, 'not_configured', 'mailbox connections need ZOHO_MAIL_CLIENT_ID, ZOHO_MAIL_CLIENT_SECRET and VAULT_TOKEN_KEY on the server (vault/SETUP.md §7)');
    const url = authorizeUrl(c, signState(stateSecret(), x.person.id, now().getTime()));
    x.a.scope = 'firm'; x.a.detail = { provider: 'zoho-mail' };
    return { body: { url, scopes: new URL(url).searchParams.get('scope')!.split(',') } };
  });

  // The callback is reached through the Access login (the Worker routes /oauth* to the Vault): the person is the Access identity, never the state alone.
  app.get('/oauth/zoho/callback', async (c: Context) => {
    let person: Person;
    try { person = await authenticate(c.req.raw.headers, cfg(), db); }
    catch { return page('Sign in first', 'This page is reached through the firm\'s sign-in. Open the Hub and press Connect again.', 'A esta página se llega mediante el inicio de sesión de la firma. Abra el Hub y pulse Conectar de nuevo.', 401); }
    const q = c.req.query();
    const zc = client(), k = key();
    if (!zc || !k) return page('Not configured', 'Mailbox connections are not configured on this server.', 'Las conexiones de buzón no están configuradas en este servidor.', 503);
    const st = verifyState(q.state, stateSecret(), now().getTime());
    if (!st || st.personId !== person.id) {
      await audit(db, person.id, 'mailbox.connect', 'firm', [], { status: 'refused', reason: 'state' });
      return page('Start again', 'This connection request was not started by you, or it expired. Open the Hub and press Connect again.', 'Esta solicitud no la inició usted, o caducó. Abra el Hub y pulse Conectar de nuevo.', 400);
    }
    if (q.error || !q.code) {
      await audit(db, person.id, 'mailbox.connect', 'firm', [], { status: 'denied', reason: q.error ?? 'no_code' });
      return c.redirect('/hub/index.html?mailbox=denied', 302);
    }
    try {
      const f = deps.fetch ?? fetch;
      const tokens = await exchangeCode(zc, q.code, q['accounts-server'], f);
      const apiUrl = mailApiUrl(zc, q.location);
      const account = await fetchAccount(apiUrl, tokens.access_token, f);
      if (account.address !== person.email.toLowerCase()) {
        await audit(db, person.id, 'mailbox.connect', 'firm', [], { status: 'refused', reason: 'other_mailbox' });
        await revokeRefreshToken(q['accounts-server'] ?? zc.accountsUrl, tokens.refresh_token, f);
        return page('That is not your mailbox', `The Zoho account you approved is ${account.address}; the Hub signs you in as ${person.email}. Connect the mailbox you sign in with.`, `La cuenta de Zoho aprobada es ${account.address}; el Hub le identifica como ${person.email}. Conecte el buzón con el que inicia sesión.`, 400);
      }
      const sealed = sealSecret(tokens.refresh_token, k);
      const accountsUrl = (q['accounts-server'] && /^https:\/\/accounts\.zoho(cloud)?\.[a-z.]+$/i.test(q['accounts-server']) ? q['accounts-server'] : zc.accountsUrl).replace(/\/+$/, '');
      const existing = await connectionOf(db, person.id);
      let id: string;
      if (existing) {
        id = existing.id;
        await db.query(`UPDATE mailbox_connections SET address = $2, account_id = $3, accounts_url = $4, api_url = $5, refresh_token_enc = $6, scopes = $7::text[], status = 'connected', last_error = NULL, connected_at = $8 WHERE id = $1`,
          [id, account.address, account.accountId, accountsUrl, apiUrl, sealed, tokens.scope, now().toISOString()]);
      } else {
        id = randomUUID();
        await db.query(`INSERT INTO mailbox_connections (id, person_id, provider, address, account_id, accounts_url, api_url, refresh_token_enc, scopes, connected_at) VALUES ($1,$2,'zoho-mail',$3,$4,$5,$6,$7,$8::text[],$9)`,
          [id, person.id, account.address, account.accountId, accountsUrl, apiUrl, sealed, tokens.scope, now().toISOString()]);
      }
      await db.query('UPDATE people SET mailbox_prompt_hidden_until = NULL WHERE id = $1', [person.id]);
      await audit(db, person.id, 'mailbox.connect', 'firm', [`mailbox:${id}`], { status: existing ? 'replaced' : 'connected', address: account.address, scopes: tokens.scope, api_url: apiUrl });
      return c.redirect('/hub/index.html?mailbox=connected', 302);
    } catch (e) {
      await audit(db, person.id, 'mailbox.connect', 'firm', [], { status: 'failed', message: (e as Error).message.slice(0, 200) });
      return page('The mailbox could not be connected', `${(e as Error).message}. Nothing was stored.`, 'No se guardó nada.', 502);
    }
  });

  route(app, 'GET', '/api/me/mailbox', 'mailbox.read', async (x) => {
    const conn = await connectionOf(x.db, x.person.id);
    const person = (await x.db.query<any>('SELECT mailbox_prompt_hidden_until FROM people WHERE id = $1', [x.person.id])).rows[0];
    const hiddenUntil = person?.mailbox_prompt_hidden_until ? new Date(person.mailbox_prompt_hidden_until) : null;
    const prompt = !conn && x.person.role !== 'service' && configured() && (!hiddenUntil || hiddenUntil < x.now);
    x.a.scope = 'firm'; x.a.detail = { connected: !!conn };
    return { body: { configured: configured(), connected: !!conn, prompt, connection: view(conn), counts: conn ? await mailboxCounts(x.db, conn.address) : null, firm_domains: firmDomains(env()) } };
  });

  route(app, 'PATCH', '/api/me/mailbox', 'mailbox.update', async (x) => {
    const b = await jsonBody(x.c);
    const conn = await connectionOf(x.db, x.person.id);
    const out: Record<string, unknown> = {};
    if (b.prompt_hidden_days !== undefined) {
      const days = Number(b.prompt_hidden_days);
      if (!Number.isFinite(days) || days < 0 || days > 365) throw bad('prompt_hidden_days must be 0 to 365', '/prompt_hidden_days');
      const until = days ? new Date(x.now.getTime() + days * 864e5) : null;
      await x.db.query('UPDATE people SET mailbox_prompt_hidden_until = $2 WHERE id = $1', [x.person.id, until]);
      out.prompt_hidden_until = until ? until.toISOString() : null;
    }
    if (b.privacy !== undefined || b.history_window_days !== undefined) {
      if (!conn) throw notFound('no mailbox is connected');
      if (b.history_window_days !== undefined) {
        const d = Number(b.history_window_days);
        if (!Number.isInteger(d) || d < 0 || d > 3650) throw bad('history_window_days must be 0 to 3650', '/history_window_days');
        await x.db.query('UPDATE mailbox_connections SET history_window_days = $2 WHERE id = $1', [conn.id, d]);
        out.history_window_days = d;
      }
      if (b.privacy !== undefined) {
        if (!PRIVACY_LEVELS.includes(b.privacy)) throw bad(`privacy must be one of ${PRIVACY_LEVELS.join(', ')}`, '/privacy');
        const level = b.privacy as Privacy;
        await x.db.query('UPDATE mailbox_connections SET privacy = $2 WHERE id = $1', [conn.id, level]);
        const applied = await applyPrivacy(x.db, store(), conn.address, level);
        out.privacy = level; out.applied = applied;
        x.a.refs = [`mailbox:${conn.id}`];
      }
    }
    x.a.scope = 'firm'; x.a.detail = out;
    return { body: { ...out, connection: view(await connectionOf(x.db, x.person.id)) } };
  });

  route(app, 'DELETE', '/api/me/mailbox', 'mailbox.disconnect', async (x) => {
    const conn = await connectionOf(x.db, x.person.id);
    if (!conn) throw notFound('no mailbox is connected');
    const k = key();
    let revoked = false;
    if (k) { try { revoked = await revokeRefreshToken(conn.accounts_url, openSecret(conn.refresh_token_enc, k), deps.fetch ?? fetch); } catch { revoked = false; } }
    await x.db.query(`UPDATE mailbox_connections SET status = 'revoked', revoked_at = $2, refresh_token_enc = 'revoked' WHERE id = $1`, [conn.id, x.now.toISOString()]);
    const withdrawn = await withdrawMailbox(x.db, store(), conn.address);
    x.a.scope = 'firm'; x.a.refs = [`mailbox:${conn.id}`]; x.a.detail = { revoked_at_zoho: revoked, ...withdrawn };
    return { body: { id: conn.id, revoked: true, revoked_at_zoho: revoked, withdrawn } };
  });

  route(app, 'GET', '/api/me/mailbox/rules', 'mailbox.rules.read', async (x) => {
    x.a.scope = 'firm';
    return { body: { personal: await rulesOf(x.db, x.person.id), firm: await rulesOf(x.db, null), inherent: { protected: firmDomains(env()) } } };
  });
  route(app, 'PUT', '/api/me/mailbox/rules', 'mailbox.rules.write', async (x) => {
    const b = await jsonBody(x.c);
    const blocked = listOf(b.blocked, '/blocked');
    await replaceRules(x.db, x.person.id, x.person.id, blocked.map(pattern => ({ kind: 'blocked' as const, pattern })));
    x.a.scope = 'firm'; x.a.detail = { blocked: blocked.length };
    return { body: { personal: await rulesOf(x.db, x.person.id) } };
  });
  route(app, 'GET', '/api/mail/rules', 'mail.rules.read', async (x) => {
    x.a.scope = 'firm';
    return { body: { firm: await rulesOf(x.db, null), inherent: { protected: firmDomains(env()) } } };
  });
  route(app, 'PUT', '/api/mail/rules', 'mail.rules.write', async (x) => {
    requirePartner(x.person, 'the firm\'s mail rules');
    const b = await jsonBody(x.c);
    const protectedList = listOf(b.protected, '/protected'), blocked = listOf(b.blocked, '/blocked');
    await replaceRules(x.db, null, x.person.id, [...protectedList.map(pattern => ({ kind: 'protected' as const, pattern })), ...blocked.map(pattern => ({ kind: 'blocked' as const, pattern }))]);
    x.a.scope = 'firm'; x.a.detail = { protected: protectedList.length, blocked: blocked.length };
    return { body: { firm: await rulesOf(x.db, null), inherent: { protected: firmDomains(env()) } } };
  });

  // A subject access request: everything in the caller's scope that names the contact, as metadata (never the message bodies of others' mail).
  route(app, 'GET', '/api/contacts/:id/export', 'contact.export', async (x) => {
    const id = x.c.req.param('id');
    const contact = (await x.db.query<any>('SELECT c.*, o.name AS organisation_name FROM contacts c JOIN organisations o ON o.id = c.organisation_id WHERE c.id = $1', [id])).rows[0];
    if (!contact) throw notFound(`contact ${id} not found`);
    const emails: string[] = (contact.emails ?? []).map((e: string) => e.toLowerCase());
    const acc = await loadAccess(x.db, x.person, x.now);
    const rows = emails.length ? (await x.db.query<any>(
      `SELECT id, type, title, authored_at, created_at, project_id, legal_tag, extracted, origin FROM items i
        WHERE NOT hidden AND parent_id IS NULL AND type = 'email' AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(extracted->'contacts') = 'array' THEN extracted->'contacts' ELSE '[]'::jsonb END) c WHERE lower(c->>'email') = ANY($1::text[]))
        ORDER BY authored_at DESC LIMIT 5000`, [emails])).rows : [];
    const visible = rows.filter(r => canSee(acc, r.legal_tag, r.project_id, r));
    const dispatches = (await x.db.query<any>('SELECT id, item_id, direction, channel, occurred_at, reference_no FROM dispatches WHERE $1 = ANY(contact_ids) ORDER BY occurred_at DESC', [id])).rows;
    const body = {
      exported_at: x.now.toISOString(), exported_by: x.person.id,
      contact: { id: contact.id, name: contact.name, role: contact.role, emails: contact.emails, phones: contact.phones, postal_address: contact.postal_address, language: contact.language, notes: contact.notes, organisation: { id: contact.organisation_id, name: contact.organisation_name }, created_at: iso(contact.created_at), relationship: contact.relationship ?? {} },
      messages: visible.map(r => ({ id: r.id, subject: r.title, date: iso(r.authored_at), project_id: r.project_id, direction: r.extracted?.direction ?? null, mailbox: r.extracted?.mailbox ?? null, source: r.origin?.source ?? null, role: (r.extracted?.contacts ?? []).find((c: any) => emails.includes(String(c.email).toLowerCase()))?.role ?? null, attachments: (r.extracted?.attachments ?? []).map((a: any) => a.filename) })),
      dispatches: dispatches.map(d => ({ ...d, occurred_at: iso(d.occurred_at) })),
      purposes: 'Correspondence about the firm\'s opportunities and projects, kept to run and evidence that work; retained for the life of the project file.',
    };
    x.a.scope = 'firm'; x.a.refs = [`contact:${id}`]; x.a.detail = { messages: visible.length, dispatches: dispatches.length };
    const download = x.c.req.query('download') === '1';
    return { body: download ? new Response(JSON.stringify(body, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="contact-${id}.json"`, 'cache-control': 'private, no-store' } }) : body };
  });
}
