/**
 * OAuth 2.1 authorisation server for the Vault's own MCP endpoint (wave 5, W5-D4;
 * docs/vault-hub/wave5/05-markup.md §1.4). Built to what the hosted Claude app accepts:
 * discovery by 401 + resource metadata, authorisation code with PKCE S256, public clients
 * registered dynamically (RFC 7591) or identified by a Client ID Metadata Document, rotating
 * refresh tokens, tokens stored hashed with the resource they were issued for. The person
 * behind a token is whoever Cloudflare Access signed in on the authorise page.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { personForEmail } from '../auth.ts';

export const SCOPE = 'vault';
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_S = 30 * 86400;
export const CODE_TTL_S = 600;
export const CIMD_TTL_MS = 3600_000;
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

export class OAuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const invalid = (code: string, message: string, status = 400) => new OAuthError(status, code, message);

export const sha256 = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
export const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = () => b64url(randomBytes(32));

export function issuerFrom(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VAULT_PUBLIC_URL ?? 'https://www.alpha-technical-centre.com').replace(/\/+$/, '');
}
export const resourceFor = (issuer: string) => `${issuer}/mcp`;

export function protectedResourceMetadata(issuer: string) {
  return { resource: resourceFor(issuer), authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: [SCOPE], resource_name: 'Alpha Technical Centre Vault' };
}
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'], client_id_metadata_document_supported: true, scopes_supported: [SCOPE],
  };
}

/** The redirect URIs a public client may register: Claude's hosted callback, or a loopback address on any port. */
export function redirectAllowed(uri: string): boolean {
  if (uri === CLAUDE_CALLBACK) return true;
  try { const u = new URL(uri); return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname === '::1' ? '[::1]' : u.hostname) && !u.search && !u.hash; } catch { return false; }
}
/** Exact match, except that a loopback redirect ignores the port (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (!(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname === '::1' ? '[::1]' : u.hostname))) return false;
    return registered.some(r => { try { const x = new URL(r); return x.protocol === 'http:' && x.hostname === u.hostname && x.pathname === u.pathname; } catch { return false; } });
  } catch { return false; }
}

export interface Client { id: string; name: string; redirect_uris: string[]; metadata_url: string | null }

export async function registerClient(db: Db, body: any): Promise<Client & { client_id_issued_at: number }> {
  if (!body || typeof body !== 'object') throw invalid('invalid_client_metadata', 'a JSON object is required');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every((u: unknown) => typeof u === 'string')) throw invalid('invalid_redirect_uri', 'redirect_uris must list at least one URI');
  for (const u of uris) if (!redirectAllowed(u)) throw invalid('invalid_redirect_uri', `redirect URI not allowed: ${u} (Claude's callback or a loopback address only)`);
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') throw invalid('invalid_client_metadata', 'only public clients (token_endpoint_auth_method "none") are registered');
  const name = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 120) : 'MCP client';
  const id = 'c_' + b64url(randomBytes(18));
  await db.query('INSERT INTO oauth_clients (id, name, redirect_uris) VALUES ($1,$2,$3::text[])', [id, name, uris]);
  return { id, name, redirect_uris: uris, metadata_url: null, client_id_issued_at: Math.floor(Date.now() / 1000) };
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|fc|fd|172\.(1[6-9]|2\d|3[01])\.)/i;
/** A registered client by id, or a Client ID Metadata Document fetched from its https URL, validated and cached for an hour. */
export async function resolveClient(db: Db, clientId: string, fetchImpl: typeof fetch, now = new Date()): Promise<Client> {
  if (/^https:\/\//.test(clientId)) {
    let u: URL;
    try { u = new URL(clientId); } catch { throw invalid('invalid_client', 'client_id is not a valid URL'); }
    if (u.pathname === '/' || u.hash || PRIVATE_HOST.test(u.hostname)) throw invalid('invalid_client', 'a client metadata document must live at an https URL with a path on a public host');
    const cached = (await db.query<any>('SELECT id, name, redirect_uris, metadata_url, fetched_at FROM oauth_clients WHERE id = $1', [clientId])).rows[0];
    if (cached && cached.fetched_at && now.getTime() - new Date(cached.fetched_at).getTime() < CIMD_TTL_MS) return cached;
    let doc: any;
    try {
      const res = await fetchImpl(clientId, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      if (txt.length > 64 * 1024) throw new Error('document too large');
      doc = JSON.parse(txt);
    } catch (e) { throw invalid('invalid_client', `the client metadata document could not be read: ${(e as Error).message}`); }
    if (doc?.client_id !== clientId) throw invalid('invalid_client', 'the client metadata document does not name itself');
    if (!Array.isArray(doc.redirect_uris) || !doc.redirect_uris.every((r: unknown) => typeof r === 'string' && redirectAllowed(r))) throw invalid('invalid_client', 'the client metadata document lists a redirect URI that is not allowed');
    if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') throw invalid('invalid_client', 'only public clients are accepted');
    const name = typeof doc.client_name === 'string' ? doc.client_name.slice(0, 120) : u.hostname;
    await db.query(`INSERT INTO oauth_clients (id, name, redirect_uris, metadata_url, fetched_at) VALUES ($1,$2,$3::text[],$1,$4)
                    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, redirect_uris = EXCLUDED.redirect_uris, fetched_at = EXCLUDED.fetched_at`, [clientId, name, doc.redirect_uris, now.toISOString()]);
    return { id: clientId, name, redirect_uris: doc.redirect_uris, metadata_url: clientId };
  }
  const row = (await db.query<any>('SELECT id, name, redirect_uris, metadata_url FROM oauth_clients WHERE id = $1', [clientId])).rows[0];
  if (!row) throw invalid('invalid_client', 'unknown client_id');
  return row;
}

export interface AuthorizeRequest { client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; state?: string; scope?: string; resource?: string }

/** Validates an authorisation request. Errors in the client or redirect URI must never redirect; the rest may. */
export async function validateAuthorize(db: Db, q: AuthorizeRequest, issuer: string, fetchImpl: typeof fetch, now = new Date()): Promise<{ client: Client; redirect_uri: string; code_challenge: string; state: string | null; scope: string; resource: string; error?: string }> {
  if (!q.client_id) throw invalid('invalid_request', 'client_id is required');
  const client = await resolveClient(db, q.client_id, fetchImpl, now);
  if (!q.redirect_uri || !redirectMatches(client.redirect_uris, q.redirect_uri)) throw invalid('invalid_request', 'redirect_uri does not match the client');
  const out = { client, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state ?? null, scope: SCOPE, resource: resourceFor(issuer), error: undefined as string | undefined };
  if (q.response_type !== 'code') out.error = 'unsupported_response_type';
  else if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) out.error = 'invalid_request';
  else if (q.resource && q.resource !== resourceFor(issuer)) out.error = 'invalid_target';
  else if (q.scope && q.scope.split(/\s+/).some(s => s && s !== SCOPE && s !== 'offline_access')) out.error = 'invalid_scope';
  return out;
}

export async function issueCode(db: Db, a: { client_id: string; person_id: string; redirect_uri: string; code_challenge: string; resource: string; scope: string }, now = new Date()): Promise<string> {
  const code = token();
  await db.query('INSERT INTO oauth_codes (code_hash, client_id, person_id, redirect_uri, code_challenge, resource, scope, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [sha256(code), a.client_id, a.person_id, a.redirect_uri, a.code_challenge, a.resource, a.scope, new Date(now.getTime() + CODE_TTL_S * 1000).toISOString()]);
  return code;
}

export interface TokenResponse { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

async function mint(db: Db, family: string, client_id: string, person_id: string, scope: string, resource: string, now: Date): Promise<TokenResponse> {
  const access = token(), refresh = token();
  await db.query('INSERT INTO oauth_tokens (token_hash, kind, family, client_id, person_id, scope, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8), ($9,$10,$3,$4,$5,$6,$7,$11)',
    [sha256(access), 'access', family, client_id, person_id, scope, resource, new Date(now.getTime() + ACCESS_TTL_S * 1000).toISOString(),
     sha256(refresh), 'refresh', new Date(now.getTime() + REFRESH_TTL_S * 1000).toISOString()]);
  await db.query('UPDATE oauth_clients SET last_used_at = $2 WHERE id = $1', [client_id, now.toISOString()]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

export async function exchangeCode(db: Db, p: { code?: string; client_id?: string; redirect_uri?: string; code_verifier?: string; resource?: string }, now = new Date()): Promise<TokenResponse> {
  if (!p.code || !p.client_id || !p.code_verifier) throw invalid('invalid_request', 'code, client_id and code_verifier are required');
  const row = (await db.query<any>('SELECT * FROM oauth_codes WHERE code_hash = $1', [sha256(p.code)])).rows[0];
  if (!row) throw invalid('invalid_grant', 'unknown or expired code');
  if (row.used_at) {
    // A code presented twice: whoever holds the family's tokens loses them (RFC 6749 §4.1.2).
    await db.query('UPDATE oauth_tokens SET revoked_at = $2 WHERE person_id = $1 AND client_id = $3 AND revoked_at IS NULL AND created_at >= $4', [row.person_id, now.toISOString(), row.client_id, row.used_at]);
    throw invalid('invalid_grant', 'code already used');
  }
  if (new Date(row.expires_at).getTime() < now.getTime()) throw invalid('invalid_grant', 'code expired');
  if (row.client_id !== p.client_id) throw invalid('invalid_grant', 'code was issued to another client');
  if (p.redirect_uri && p.redirect_uri !== row.redirect_uri) throw invalid('invalid_grant', 'redirect_uri does not match');
  if (b64url(createHash('sha256').update(p.code_verifier).digest()) !== row.code_challenge) throw invalid('invalid_grant', 'PKCE verification failed');
  if (p.resource && p.resource !== row.resource) throw invalid('invalid_target', 'resource does not match the code');
  await db.query('UPDATE oauth_codes SET used_at = $2 WHERE code_hash = $1', [row.code_hash, now.toISOString()]);
  return mint(db, randomUUID(), row.client_id, row.person_id, row.scope, row.resource, now);
}

export async function refreshTokens(db: Db, p: { refresh_token?: string; client_id?: string; resource?: string }, now = new Date()): Promise<TokenResponse> {
  if (!p.refresh_token || !p.client_id) throw invalid('invalid_request', 'refresh_token and client_id are required');
  const row = (await db.query<any>("SELECT * FROM oauth_tokens WHERE token_hash = $1 AND kind = 'refresh'", [sha256(p.refresh_token)])).rows[0];
  if (!row || row.client_id !== p.client_id) throw invalid('invalid_grant', 'unknown refresh token');
  if (row.revoked_at) {
    // Reuse of a rotated token: the whole family is revoked (someone else holds a copy).
    await db.query('UPDATE oauth_tokens SET revoked_at = coalesce(revoked_at, $2) WHERE family = $1', [row.family, now.toISOString()]);
    throw invalid('invalid_grant', 'refresh token was already used; the connection is revoked');
  }
  if (new Date(row.expires_at).getTime() < now.getTime()) throw invalid('invalid_grant', 'refresh token expired');
  if (p.resource && p.resource !== row.resource) throw invalid('invalid_target', 'resource does not match the token');
  await db.query('UPDATE oauth_tokens SET revoked_at = $2 WHERE family = $1 AND revoked_at IS NULL', [row.family, now.toISOString()]);
  return mint(db, row.family, row.client_id, row.person_id, row.scope, row.resource, now);
}

/** The person behind a bearer token, or null when it is unknown, expired, revoked or for another resource. */
export async function authenticateBearer(db: Db, bearer: string, resource: string, now = new Date()): Promise<(Person & { family: string }) | null> {
  const row = (await db.query<any>("SELECT t.family, t.person_id, t.expires_at, t.revoked_at, t.resource, p.email FROM oauth_tokens t JOIN people p ON p.id = t.person_id WHERE t.token_hash = $1 AND t.kind = 'access'", [sha256(bearer)])).rows[0];
  if (!row || row.revoked_at || row.resource !== resource || new Date(row.expires_at).getTime() < now.getTime()) return null;
  await db.query('UPDATE oauth_tokens SET last_used_at = $2 WHERE token_hash = $1', [sha256(bearer), now.toISOString()]);
  const person = await personForEmail(db, row.email);
  return { ...person, family: row.family };
}

export async function listConnections(db: Db, personId: string) {
  return (await db.query<any>(`SELECT t.family AS id, c.name AS client_name, c.metadata_url, min(t.created_at) AS first_used, max(coalesce(t.last_used_at, t.created_at)) AS last_used,
                                      bool_and(t.revoked_at IS NOT NULL) AS revoked, max(t.expires_at) FILTER (WHERE t.kind = 'refresh' AND t.revoked_at IS NULL) AS expires_at
                               FROM oauth_tokens t JOIN oauth_clients c ON c.id = t.client_id WHERE t.person_id = $1 GROUP BY t.family, c.name, c.metadata_url ORDER BY min(t.created_at) DESC`, [personId])).rows
    .map((r: any) => ({ id: r.id, client: r.client_name, host: r.metadata_url ? new URL(r.metadata_url).hostname : null, first_used: new Date(r.first_used).toISOString(), last_used: new Date(r.last_used).toISOString(), revoked: !!r.revoked, expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null }));
}
export async function revokeConnection(db: Db, personId: string, family: string, now = new Date()): Promise<boolean> {
  const r = await db.query<{ family: string }>('UPDATE oauth_tokens SET revoked_at = coalesce(revoked_at, $3) WHERE family = $1 AND person_id = $2 RETURNING family', [family, personId, now.toISOString()]);
  return r.rows.length > 0;
}
