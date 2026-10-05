/**
 * The Vault as a Claude connector (wave 5, W5-D4; docs/vault-hub/wave5/05-markup.md §1.4): the OAuth 2.1
 * endpoints around POST /mcp.
 *   GET  /.well-known/oauth-protected-resource[/mcp]   who protects the MCP endpoint (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server       this server's metadata (RFC 8414)
 *   POST /oauth/register                               dynamic registration of a public client (RFC 7591)
 *   GET  /oauth/authorize                              behind Cloudflare Access: validate, show the consent page
 *   POST /oauth/authorize                              Allow or Cancel: a single-use code, or access_denied
 *   POST /oauth/token                                  authorization_code (PKCE S256) and refresh_token (rotating)
 *   GET  /api/me/connections, DELETE /api/me/connections/:id   the person's connected apps, and revocation
 * Everything outside /api authenticates itself: the authorise page with the Access token, the token endpoint
 * with the code or refresh token, discovery not at all. Rate limits are per address; the Worker forwards it.
 */
import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { authenticate, configFromEnv, type AuthConfig, type Person } from '../auth.ts';
import { audit } from '../audit.ts';
import { route } from './common.ts';
import { OAuthError, authorizationServerMetadata, b64url, exchangeCode, issuerFrom, issueCode, listConnections, protectedResourceMetadata, refreshTokens, registerClient, revokeConnection, validateAuthorize } from '../oauth/server.ts';

export interface OAuthDeps { fetch?: typeof fetch; issuer?: string; now?: () => Date; auth?: AuthConfig }
let deps: OAuthDeps = {};
/** Tests inject the fetch that reads client metadata documents, the issuer and the clock. */
export function configureOAuth(d: OAuthDeps) { deps = { ...deps, ...d }; }
/** The issuer: VAULT_PUBLIC_URL, or what a test configured. The MCP endpoint reads the same value for its resource. */
export const oauthIssuer = () => deps.issuer ?? issuerFrom();
const issuer = oauthIssuer;
const now = () => deps.now?.() ?? new Date();

/* ── small in-memory rate limits (one process; Render runs one) ── */
const buckets = new Map<string, { n: number; at: number }>();
export function limited(key: string, perMinute: number, t = Date.now()): number {
  const b = buckets.get(key);
  if (!b || t - b.at >= 60_000) { buckets.set(key, { n: 1, at: t }); return 0; }
  b.n++;
  return b.n > perMinute ? Math.ceil((b.at + 60_000 - t) / 1000) : 0;
}
if (buckets.size === 0) setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.at > 120_000) buckets.delete(k); }, 60_000).unref?.();
const addressOf = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'local';

/* ── consent nonces: the Allow must come from the page this server rendered ── */
const consents = new Map<string, { person: string; exp: number }>();
const nonce = (person: string) => { const n = b64url(randomBytes(18)); consents.set(n, { person, exp: Date.now() + 600_000 }); return n; };
const takeNonce = (n: string | undefined, person: string) => { const c = n ? consents.get(n) : undefined; if (c) consents.delete(n!); return !!c && c.person === person && c.exp > Date.now(); };

const oauthError = (c: Context, e: unknown) => {
  const err = e instanceof OAuthError ? e : new OAuthError(500, 'server_error', (e as Error).message);
  return c.json({ error: err.code, error_description: err.message }, err.status as any, { 'cache-control': 'no-store', pragma: 'no-cache' });
};
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/**
 * `formTo` names the origin the consent form's redirect may land on. Browsers apply
 * `form-action` to the redirect that follows a form submission as well as to the
 * submission itself, so without the client's origin here Safari and Chrome refuse the
 * 302 back to the app and the page just sits there after Allow.
 */
function page(title: string, body: string, status = 200, formTo?: string) {
  const formAction = formTo ? `form-action 'self' ${formTo}` : "form-action 'self'";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Alpha Technical Centre</title>
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/hub/hub.css"><style>.consent{max-width:560px;margin:48px auto;padding:0 20px}.consent .card{padding:24px}.consent h1{font-size:1.4rem;margin:0 0 8px}.consent p{margin:8px 0}.consent .es{color:var(--muted,#6b7280);font-size:.95em}.consent .actions{display:flex;gap:10px;margin-top:18px}.consent code{font-size:.95em}</style></head>
<body class="hub"><main class="consent"><div class="card">${body}</div></main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': `default-src 'self'; style-src 'self' 'unsafe-inline'; ${formAction}; frame-ancestors 'none'` } });
}
const denied = (title: string, en: string, es: string, status: number) => page(title, `<h1>${esc(title)}</h1><p>${esc(en)}</p><p class="es">${esc(es)}</p>`, status);

export function register(app: Hono<Env>, { db }: RouteDeps): void {
  const cfg = () => deps.auth ?? configFromEnv();
  const signedIn = (c: Context): Promise<Person> => authenticate(c.req.raw.headers, cfg(), db);

  app.get('/.well-known/oauth-protected-resource', (c) => c.json(protectedResourceMetadata(issuer()), 200, { 'cache-control': 'public, max-age=300' }));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(protectedResourceMetadata(issuer()), 200, { 'cache-control': 'public, max-age=300' }));
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(authorizationServerMetadata(issuer()), 200, { 'cache-control': 'public, max-age=300' }));

  app.post('/oauth/register', async (c) => {
    const wait = limited(`register:${addressOf(c)}`, 30);
    if (wait) return c.json({ error: 'too_many_requests', error_description: 'try again later' }, 429, { 'retry-after': String(wait) });
    try {
      const body = await c.req.json().catch(() => null);
      const client = await registerClient(db, body);
      await audit(db, 'app:oauth', 'oauth.register', 'firm', [`oauth-client:${client.id}`], { name: client.name, redirect_uris: client.redirect_uris });
      return c.json({ client_id: client.id, client_id_issued_at: client.client_id_issued_at, client_name: client.name, redirect_uris: client.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, 201, { 'cache-control': 'no-store' });
    } catch (e) { return oauthError(c, e); }
  });

  const authorizeParams = (src: Record<string, string | undefined>) => ({
    client_id: src.client_id ?? '', redirect_uri: src.redirect_uri ?? '', response_type: src.response_type ?? '', code_challenge: src.code_challenge ?? '',
    code_challenge_method: src.code_challenge_method ?? '', state: src.state, scope: src.scope, resource: src.resource,
  });
  const redirectWith = (c: Context, uri: string, params: Record<string, string | null | undefined>) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    return c.redirect(u.toString(), 302);
  };

  app.get('/oauth/authorize', async (c) => {
    let person: Person;
    try { person = await signedIn(c); } catch { return denied('Sign in first', 'This page is reached through the firm\'s sign-in. Open it again from the connector.', 'A esta página se llega mediante el inicio de sesión de la firma. Ábrala de nuevo desde el conector.', 401); }
    const q = authorizeParams(c.req.query());
    let v;
    try { v = await validateAuthorize(db, q, issuer(), deps.fetch ?? fetch, now()); }
    catch (e) { const err = e as OAuthError; return denied('This app cannot connect', `${err.message}. Nothing was authorised.`, 'No se autorizó nada.', err.status === 500 ? 500 : 400); }
    if (v.error) return redirectWith(c, v.redirect_uri, { error: v.error, error_description: v.error === 'invalid_request' ? 'PKCE S256 is required' : undefined, state: v.state });
    const host = v.client.metadata_url ? new URL(v.client.metadata_url).hostname : null;
    const who = `${esc(person.name)} (${esc(person.email)})`;
    const n = nonce(person.id);
    const hidden = Object.entries({ client_id: v.client.id, redirect_uri: v.redirect_uri, response_type: 'code', code_challenge: v.code_challenge, code_challenge_method: 'S256', state: v.state ?? '', scope: v.scope, resource: v.resource, nonce: n })
      .map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val)}">`).join('');
    return page('Connect to the Vault', `<h1>Allow ${host ? `<code>${esc(host)}</code>` : esc(v.client.name)} to use the Vault as you?</h1>
<p>${host ? `The app at <code>${esc(host)}</code>` : esc(v.client.name)} asks to search, read, draft and file in the Alpha Technical Centre Vault as <b>${who}</b>. Everything it does is scoped to what you may see and recorded in the audit log under your name. You can revoke it any time under Settings → Connected apps.</p>
<p class="es">La aplicación pide buscar, leer, redactar y archivar en el Vault como <b>${who}</b>. Todo queda limitado a lo que usted puede ver y registrado a su nombre. Puede revocarlo en Ajustes → Aplicaciones conectadas.</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="actions"><button class="btn btn-primary" type="submit" name="decision" value="allow">Allow · Permitir</button><button class="btn btn-outline" type="submit" name="decision" value="deny">Cancel · Cancelar</button></div></form>`, 200, new URL(v.redirect_uri).origin);
  });

  app.post('/oauth/authorize', async (c) => {
    let person: Person;
    try { person = await signedIn(c); } catch { return denied('Sign in first', 'The sign-in expired. Open the connector again.', 'La sesión caducó. Abra de nuevo el conector.', 401); }
    const form = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === 'string' ? v : undefined])) as Record<string, string | undefined>;
    const q = authorizeParams(form);
    let v;
    try { v = await validateAuthorize(db, q, issuer(), deps.fetch ?? fetch, now()); }
    catch (e) { const err = e as OAuthError; return denied('This app cannot connect', `${err.message}. Nothing was authorised.`, 'No se autorizó nada.', 400); }
    if (v.error) return redirectWith(c, v.redirect_uri, { error: v.error, state: v.state });
    if (!takeNonce(form.nonce, person.id)) return denied('Start again', 'This consent form is stale. Open the connector again.', 'Este formulario caducó. Abra de nuevo el conector.', 400);
    if (form.decision !== 'allow') {
      await audit(db, person.id, 'oauth.consent', 'firm', [`oauth-client:${v.client.id}`], { decision: 'deny' });
      return redirectWith(c, v.redirect_uri, { error: 'access_denied', state: v.state });
    }
    const code = await issueCode(db, { client_id: v.client.id, person_id: person.id, redirect_uri: v.redirect_uri, code_challenge: v.code_challenge, resource: v.resource, scope: v.scope }, now());
    await audit(db, person.id, 'oauth.consent', 'firm', [`oauth-client:${v.client.id}`], { decision: 'allow', client: v.client.name });
    return redirectWith(c, v.redirect_uri, { code, state: v.state });
  });

  app.post('/oauth/token', async (c) => {
    const wait = limited(`token:${addressOf(c)}`, 60);
    if (wait) return c.json({ error: 'too_many_requests', error_description: 'try again later' }, 429, { 'retry-after': String(wait), 'cache-control': 'no-store' });
    let p: Record<string, string | undefined>;
    try {
      const ct = c.req.header('content-type') ?? '';
      p = ct.includes('application/json') ? await c.req.json() : Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
    } catch { return oauthError(c, new OAuthError(400, 'invalid_request', 'the body must be form-encoded or JSON')); }
    try {
      let t;
      if (p.grant_type === 'authorization_code') t = await exchangeCode(db, p, now());
      else if (p.grant_type === 'refresh_token') t = await refreshTokens(db, p, now());
      else throw new OAuthError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
      await audit(db, 'app:oauth', 'oauth.token', 'firm', [`oauth-client:${p.client_id}`], { grant: p.grant_type });
      return c.json(t, 200, { 'cache-control': 'no-store', pragma: 'no-cache' });
    } catch (e) {
      await audit(db, 'app:oauth', 'oauth.token', 'firm', [`oauth-client:${p.client_id ?? 'unknown'}`], { grant: p.grant_type ?? null, error: e instanceof OAuthError ? e.code : 'server_error' });
      return oauthError(c, e);
    }
  });

  route(app, 'GET', '/api/me/connections', 'oauth.connections', async (x) => {
    x.a.scope = 'firm';
    return { body: { connections: await listConnections(x.db, x.person.id) } };
  });
  route(app, 'DELETE', '/api/me/connections/:id', 'oauth.revoke', async (x) => {
    const id = x.c.req.param('id')!;
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new (await import('./common.ts')).ApiError(404, 'not_found', 'unknown connection');
    const ok = await revokeConnection(x.db, x.person.id, id, x.now);
    if (!ok) throw new (await import('./common.ts')).ApiError(404, 'not_found', 'unknown connection');
    x.a.scope = 'firm'; x.a.refs = [`oauth-connection:${id}`];
    return { body: { id, revoked: true } };
  });
}
