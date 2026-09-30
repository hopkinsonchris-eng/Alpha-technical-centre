/**
 * App tokens (M05, decision D6). The two external APEX apps push run records
 * with a bearer token instead of a Cloudflare Access login.
 *
 *   APP_TOKENS=apex-asset-intelligence:<secret>,apex-3d-model:<secret>
 *
 * A token maps to a service Person `{ id: 'app:<tool>', role: 'service' }`
 * that may only POST /api/app/runs for its own job. This file does not touch
 * src/auth.ts: Access JWTs and DEV_USER_EMAIL keep working exactly as before.
 * Entries with an empty tool or a secret shorter than MIN_SECRET are ignored
 * (they can never match), so a typo fails closed.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthError, type Person } from './auth.ts';
import type { Db } from './db/client.ts';

export const MIN_SECRET = 16;

export interface AppPerson extends Person { role: 'service'; tool: string }

/** Parse APP_TOKENS into [tool, secret] pairs. The secret is everything after the first colon. */
export function parseAppTokens(raw: string | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf(':');
    if (i < 1) continue;
    const tool = part.slice(0, i).trim(), secret = part.slice(i + 1).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(tool) || secret.length < MIN_SECRET) continue;
    out.push([tool, secret]);
  }
  return out;
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export const appPersonFor = (tool: string): AppPerson =>
  ({ id: `app:${tool}`, email: `${tool}@app.invalid`, name: `${tool} (app)`, role: 'service', tool });

/**
 * Read `Authorization: Bearer <token>` and match it against APP_TOKENS.
 * Every configured secret is compared (constant time, on equal-length digests)
 * so timing does not reveal which tool or how much of a token matched.
 * Throws AuthError (401) when the header is missing, malformed or unknown.
 */
export function verifyAppToken(headers: { get(name: string): string | null | undefined }, env: Record<string, string | undefined> = process.env): AppPerson {
  const header = headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) throw new AuthError('missing app token: send Authorization: Bearer <token>');
  const given = digest(m[1]);
  let tool: string | null = null;
  for (const [t, secret] of parseAppTokens(env.APP_TOKENS)) {
    if (timingSafeEqual(given, digest(secret)) && tool === null) tool = t;
  }
  if (tool === null) throw new AuthError('invalid app token');
  return appPersonFor(tool);
}

/** Add the service person for an app on first sight (role service). Idempotent. */
export async function ensureAppPerson(db: Db, p: AppPerson): Promise<AppPerson> {
  await db.query('INSERT INTO people (id, email, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [p.id, p.email, p.name, 'service']);
  return p;
}
