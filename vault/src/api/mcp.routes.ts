/**
 * Company MCP endpoint (M14): POST /mcp (streamable HTTP, stateless, JSON responses).
 * The /api/* middleware does not cover /mcp, so authentication happens here with the same `authenticate`
 * the API uses: a Cloudflare Access JWT for people, an Access service token (which arrives as the same
 * Cf-Access-Jwt-Assertion header) for CLI clients. A fresh McpServer is built per request, bound to the caller.
 * GET (a server-initiated stream) and DELETE (sessions) are not offered: 405.
 */
import type { Context, Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { authenticate, AuthError, configFromEnv, type AuthConfig } from '../auth.ts';
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
  const person = async (c: Context) => authenticate(c.req.raw.headers, authConfig(), db);
  const unauthenticated = (c: Context, e: unknown) => c.json(rpcError(-32001, e instanceof AuthError ? e.message : 'authentication failed'), e instanceof AuthError ? 401 : 500);

  app.post('/mcp', async (c) => {
    let who;
    try { who = await person(c); } catch (e) { return unauthenticated(c, e); }
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
