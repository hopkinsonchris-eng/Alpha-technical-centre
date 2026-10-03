// Wave 5, PR 4 (docs/vault-hub/wave5/05-markup.md §1.4, W5-AC8 to AC12, AC14): the Vault as an OAuth 2.1
// authorisation server for its own MCP endpoint. The Access identity is the dev user; the client metadata
// document is a stubbed fetch; the MCP client sends the Vault's bearer token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';
import { createApp } from '../src/app.ts';
import { configureOAuth } from '../src/api/oauth.routes.ts';
import { b64url } from '../src/oauth/server.ts';

const DOMAIN = 'alpha-technical-centre.com';
const ISSUER = 'https://vault.example';
const CIMD = 'https://claude.ai/oauth/claude-code-client-metadata';
const CIMD_DOC = { client_id: CIMD, client_name: 'Claude Code', client_uri: 'https://claude.ai', redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
const fakeFetch = (docs: Record<string, unknown>) => (async (url: any) => { const d = docs[String(url)]; return d ? Response.json(d) : new Response('no', { status: 404 }); }) as unknown as typeof fetch;
const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });
const json = (o: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const pkce = () => { const verifier = b64url(randomBytes(48)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };

async function setup(docs: Record<string, unknown> = { [CIMD]: CIMD_DOC }) {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db);
  configureOAuth({ fetch: fakeFetch(docs), issuer: ISSUER, now: undefined, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  const signedIn = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` }, version: 'test' });
  const anonymous = await createApp({ db, auth: { allowedEmailDomain: DOMAIN }, version: 'test' });
  return { db, signedIn, anonymous };
}
/** Walks the code flow for a registered client and returns the tokens. */
async function connect(app: Awaited<ReturnType<typeof createApp>>, clientId: string, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', resource: ISSUER + '/mcp', scope: 'vault' });
  const pageRes = await app.request('/oauth/authorize?' + q);
  const html = await pageRes.text();
  assert.equal(pageRes.status, 200, html.slice(0, 300));
  const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];
  const allow = await app.request('/oauth/authorize', form({ ...Object.fromEntries(q), nonce, decision: 'allow' }));
  assert.equal(allow.status, 302, await allow.text());
  const loc = new URL(allow.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, redirect); assert.equal(loc.searchParams.get('state'), 'xyz');
  const code = loc.searchParams.get('code')!;
  const t = await app.request('/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirect, code_verifier: verifier, resource: ISSUER + '/mcp' }));
  assert.equal(t.status, 200, await t.clone().text());
  assert.equal(t.headers.get('cache-control'), 'no-store');
  return { tokens: await t.json() as any, html, verifier, code };
}
async function mcpAs(app: Awaited<ReturnType<typeof createApp>>, bearer: string) {
  const client = new Client({ name: 'test', version: '0' });
  const f = (url: any, init: any = {}) => app.request(url, { ...init, headers: { ...(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers ?? {}), authorization: 'Bearer ' + bearer } });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: f as any }));
  return client;
}

test('W5-AC8: discovery documents name the resource and the server; an unauthenticated /mcp call answers 401 with the handshake', async () => {
  const { db, anonymous } = await setup();
  const prm: any = await (await anonymous.request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.deepEqual(prm, { resource: ISSUER + '/mcp', authorization_servers: [ISSUER], bearer_methods_supported: ['header'], scopes_supported: ['vault'], resource_name: 'Alpha Technical Centre Vault' });
  const as: any = await (await anonymous.request('/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, ISSUER); assert.equal(as.authorization_endpoint, ISSUER + '/oauth/authorize'); assert.equal(as.token_endpoint, ISSUER + '/oauth/token'); assert.equal(as.registration_endpoint, ISSUER + '/oauth/register');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']); assert.deepEqual(as.token_endpoint_auth_methods_supported, ['none']); assert.equal(as.client_id_metadata_document_supported, true);
  assert.deepEqual(as.grant_types_supported, ['authorization_code', 'refresh_token']);
  const r = await anonymous.request('/mcp', json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') ?? '', /^Bearer error="invalid_token".*resource_metadata="https:\/\/vault\.example\/\.well-known\/oauth-protected-resource\/mcp"/);
  await db.close();
});

test('W5-AC9: a public client registers with Claude\'s callback or a loopback; anything else is refused', async () => {
  const { db, anonymous } = await setup();
  const ok = await anonymous.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback'], token_endpoint_auth_method: 'none' }));
  assert.equal(ok.status, 201);
  const c: any = await ok.json();
  assert.match(c.client_id, /^c_/); assert.equal(c.client_secret, undefined); assert.equal(c.token_endpoint_auth_method, 'none');
  for (const bad of [['https://evil.example/cb'], ['http://localhost/cb?x=1'], []]) {
    const r = await anonymous.request('/oauth/register', json({ redirect_uris: bad }));
    assert.equal(r.status, 400); assert.equal(((await r.json()) as any).error, 'invalid_redirect_uri');
  }
  assert.equal((await anonymous.request('/oauth/register', json({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'client_secret_basic' }))).status, 400);
  await db.close();
});

test('W5-AC10/AC11: the authorise page needs the Access identity, refuses a bad client or redirect without redirecting, names a metadata-document client by host; the code flow and PKCE work; reuse and a bad verifier fail', async () => {
  const { db, signedIn, anonymous } = await setup();
  const reg: any = await (await anonymous.request('/oauth/register', json({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }))).json();
  const { challenge } = pkce();
  const base = { client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's' };
  configureOAuth({ auth: { allowedEmailDomain: DOMAIN } });
  assert.equal((await anonymous.request('/oauth/authorize?' + new URLSearchParams(base))).status, 401, 'no Access identity: no page');
  configureOAuth({ auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  assert.equal((await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, redirect_uri: 'https://evil.example/cb' }))).status, 400, 'a wrong redirect never redirects');
  assert.equal((await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, client_id: 'c_unknown' }))).status, 400);
  const noPkce = await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, code_challenge: '', code_challenge_method: '' }));
  assert.equal(noPkce.status, 302); assert.match(noPkce.headers.get('location')!, /error=invalid_request/);
  const wrongRes = await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, resource: 'https://other.example/mcp' }));
  assert.equal(wrongRes.status, 302); assert.match(wrongRes.headers.get('location')!, /error=invalid_target/);
  // The page names the person and the client; Cancel answers access_denied.
  const pageRes = await signedIn.request('/oauth/authorize?' + new URLSearchParams(base));
  const html = await pageRes.text();
  assert.ok(html.includes('Chris') && html.includes('Claude') && html.includes('Allow'), html.slice(0, 300));
  const nonce = /name="nonce" value="([^"]+)"/.exec(html)![1];
  const deny = await signedIn.request('/oauth/authorize', form({ ...base, nonce, decision: 'deny' }));
  assert.equal(deny.status, 302); assert.match(deny.headers.get('location')!, /error=access_denied&state=s|state=s&error=access_denied|error=access_denied/);
  assert.equal((await signedIn.request('/oauth/authorize', form({ ...base, nonce, decision: 'allow' }))).status, 400, 'a nonce is single use');
  // A metadata-document client: fetched, validated, shown by host.
  const cimd = await connect(signedIn, CIMD, 'http://localhost:3118/callback');
  assert.ok(cimd.html.includes('claude.ai'), 'consent names the host');
  assert.equal(cimd.tokens.token_type, 'Bearer'); assert.equal(cimd.tokens.expires_in, 3600); assert.ok(cimd.tokens.refresh_token);
  const stored = (await db.query<any>("SELECT id, name, metadata_url FROM oauth_clients WHERE id = $1", [CIMD])).rows[0];
  assert.equal(stored.name, 'Claude Code'); assert.equal(stored.metadata_url, CIMD);
  // A document that does not name itself is refused.
  configureOAuth({ fetch: fakeFetch({ 'https://evil.example/client': { ...CIMD_DOC, client_id: 'https://other.example/client' } }) });
  assert.equal((await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, client_id: 'https://evil.example/client', redirect_uri: 'http://localhost/callback' }))).status, 400);
  configureOAuth({ fetch: fakeFetch({ [CIMD]: CIMD_DOC }) });
  // The registered client's code flow; reuse of the code and a wrong verifier.
  const flow = await connect(signedIn, reg.client_id);
  const again = await signedIn.request('/oauth/token', form({ grant_type: 'authorization_code', code: flow.code, client_id: reg.client_id, code_verifier: flow.verifier }));
  assert.equal(again.status, 400); assert.equal(((await again.json()) as any).error, 'invalid_grant');
  const { verifier: v2, challenge: c2 } = pkce();
  const p2 = await signedIn.request('/oauth/authorize?' + new URLSearchParams({ ...base, code_challenge: c2 }));
  const n2 = /name="nonce" value="([^"]+)"/.exec(await p2.text())![1];
  const a2 = await signedIn.request('/oauth/authorize', form({ ...base, code_challenge: c2, nonce: n2, decision: 'allow' }));
  const code2 = new URL(a2.headers.get('location')!).searchParams.get('code')!;
  const wrong = await signedIn.request('/oauth/token', form({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, code_verifier: 'not-' + v2 }));
  assert.equal(wrong.status, 400); assert.equal(((await wrong.json()) as any).error, 'invalid_grant');
  assert.equal((await signedIn.request('/oauth/token', form({ grant_type: 'password', username: 'x' }))).status, 400);
  await db.close();
});

test('W5-AC11/AC12/AC14: a bearer token runs tools as the person with audit; refresh rotates and a reused refresh token revokes the family; Settings lists and revokes connections', async () => {
  const { db, signedIn, anonymous } = await setup();
  const { tokens } = await connect(signedIn, CIMD, 'http://localhost:3118/callback');
  const client = await mcpAs(anonymous, tokens.access_token);
  const names = (await client.listTools()).tools.map(t => t.name);
  assert.ok(names.includes('search_vault'));
  const r: any = await client.callTool({ name: 'get_lessons', arguments: { scope: 'firm' } });
  assert.ok(!r.isError, JSON.stringify(r));
  const ev = (await db.query<any>("SELECT person_id FROM audit_events WHERE action = 'mcp.get_lessons' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(ev.person_id, 'chris', 'the tool ran as the person behind the token');
  await client.close();
  assert.equal((await anonymous.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer nope' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 401);
  // Refresh rotates; the old refresh token is dead and reusing it revokes everything.
  const r1 = await anonymous.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CIMD }));
  assert.equal(r1.status, 200);
  const t2: any = await r1.json();
  assert.notEqual(t2.refresh_token, tokens.refresh_token); assert.notEqual(t2.access_token, tokens.access_token);
  const reuse = await anonymous.request('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: CIMD }));
  assert.equal(reuse.status, 400); assert.equal(((await reuse.json()) as any).error, 'invalid_grant');
  assert.equal((await anonymous.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t2.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 401, 'the family is revoked after reuse');
  // A fresh connection appears in Settings and can be revoked there.
  const { tokens: t3 } = await connect(signedIn, CIMD, 'http://localhost:3118/callback');
  const list: any = await (await signedIn.request('/api/me/connections')).json();
  const live = list.connections.filter((c: any) => !c.revoked);
  assert.equal(live.length, 1); assert.equal(live[0].client, 'Claude Code'); assert.equal(live[0].host, 'claude.ai');
  const del = await signedIn.request('/api/me/connections/' + live[0].id, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await anonymous.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t3.access_token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 401);
  assert.equal((await signedIn.request('/api/me/connections/' + live[0].id, { method: 'DELETE' })).status, 200, 'revoking twice is harmless');
  await db.close();
});
