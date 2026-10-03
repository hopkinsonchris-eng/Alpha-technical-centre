/**
 * Company MCP endpoint (M14): POST /mcp (streamable HTTP, stateless, JSON responses).
 * The /api/* middleware does not cover /mcp, so authentication happens here: a bearer token the Vault issued
 * (wave 5: the Claude app as a connector, see oauth.routes.ts), else the same `authenticate` the API uses: a
 * Cloudflare Access JWT for people, an Access service token for CLI clients. An unauthenticated call answers
 * 401 with the WWW-Authenticate handshake the connector needs. A fresh McpServer is built per request.
 * GET (a server-initiated stream) and DELETE (sessions) are not offered: 405.
 */
import type { Context, Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { authenticate, AuthError, configFromEnv, type AuthConfig, type Person } from '../auth.ts';
import { authenticateBearer, resourceFor } from '../oauth/server.ts';
import { limited, oauthIssuer } from './oauth.routes.ts';
import { buildMcpServer } from '../mcp/server.ts';

let cached: { key: string; cfg: AuthConfig } | undefined;
/** Read from the environment (as the server does at boot); the remote key set is built once per distinct configuration. */
function authConfig(): AuthConfig {
  const e = process.env;
  const key = JSON.stringify([e.CF_ACCESS_TEAM_DOMAIN, e.CF_ACCESS_AUD, e.ALLOWED_EMAIL_DOMAIN, e.NODE_ENV === 'production' ? '' : e.DEV_USER_EMAIL]);
  if (!cached || cached.key !== key) cached = { key, cfg: configFromEnv() };
  return cached.cfg;
}

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

export function register(app: Hono<Env>, { db }: RouteDeps): void {
  // Wave 5 (W5-D4): a Vault-issued bearer token first (the Claude app), then the Access token as before.
  const person = async (c: Context): Promise<Person> => {
    const auth = c.req.header('authorization');
    if (auth && /^bearer\s+/i.test(auth)) {
      const who = await authenticateBearer(db, auth.replace(/^bearer\s+/i, '').trim(), resourceFor(oauthIssuer()));
      if (!who) throw new AuthError('invalid or expired token');
      return who;
    }
    return authenticate(c.req.raw.headers, authConfig(), db);
  };
  const handshake = () => ({ 'WWW-Authenticate': `Bearer error="invalid_token", error_description="Authentication required", resource_metadata="${oauthIssuer()}/.well-known/oauth-protected-resource/mcp"` });
  const unauthenticated = (c: Context, e: unknown) => c.json(rpcError(-32001, e instanceof AuthError ? e.message : 'authentication failed'), e instanceof AuthError ? 401 : 500, e instanceof AuthError ? handshake() : {});

  app.post('/mcp', async (c) => {
    let who;
    try { who = await person(c); } catch (e) { return unauthenticated(c, e); }
    const wait = limited(`mcp:${who.id}`, 120);
    if (wait) return c.json(rpcError(-32000, `rate limit: ${120} calls a minute; retry after ${wait} s`), 429, { 'retry-after': String(wait) });
    const server = buildMcpServer({ db, person: who });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try { return await transport.handleRequest(c.req.raw); }
    finally { void transport.close().catch(() => {}); void server.close().catch(() => {}); }
  });

  const notAllowed = async (c: Context) => {
    try { await person(c); } catch (e) { return unauthenticated(c, e); }
    return c.json(rpcError(-32000, 'Method not allowed: this server answers POST /mcp only (stateless, JSON responses)'), 405, { Allow: 'POST' });
  };
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
