/**
 * Authentication (M01). Cloudflare Access is the only login. Every request to
 * the API carries a `Cf-Access-Jwt-Assertion` header (a JWT signed by the
 * team's Access keys). We verify it against the team's JWKS, check the
 * audience (the Access application AUD tag) and map the email to a Person.
 *
 * Local development and tests: set DEV_USER_EMAIL to skip Access. This is
 * refused when NODE_ENV=production.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Db } from './db/client.ts';

export interface Person { id: string; email: string; name: string; role: 'partner' | 'associate' | 'service' }

export interface AuthConfig {
  teamDomain?: string;      // e.g. alphatc.cloudflareaccess.com
  audience?: string;        // Access application AUD tag
  allowedEmailDomain: string; // alpha-technical-centre.com
  devUserEmail?: string;
  jwks?: JWTVerifyGetKey;   // injected in tests
}

export function configFromEnv(env = process.env): AuthConfig {
  const cfg: AuthConfig = {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    audience: env.CF_ACCESS_AUD,
    allowedEmailDomain: env.ALLOWED_EMAIL_DOMAIN ?? 'alpha-technical-centre.com',
    devUserEmail: env.NODE_ENV === 'production' ? undefined : env.DEV_USER_EMAIL,
  };
  if (cfg.teamDomain) cfg.jwks = createRemoteJWKSet(new URL(`https://${cfg.teamDomain}/cdn-cgi/access/certs`));
  return cfg;
}

export class AuthError extends Error { status = 401; constructor(msg: string) { super(msg); } }

/** Verify the Access JWT and return the asserted email. */
export async function verifyAccessJwt(token: string, cfg: AuthConfig): Promise<string> {
  if (!cfg.jwks || !cfg.audience) throw new AuthError('Access is not configured');
  let payload;
  try {
    ({ payload } = await jwtVerify(token, cfg.jwks, { audience: cfg.audience, issuer: cfg.teamDomain ? `https://${cfg.teamDomain}` : undefined }));
  } catch (e) {
    throw new AuthError(`invalid Access token: ${(e as Error).message}`);
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!email) throw new AuthError('Access token carries no email');
  if (!email.endsWith('@' + cfg.allowedEmailDomain)) throw new AuthError('email domain not allowed');
  return email;
}

/** Map an email to a Person, creating an associate on first sight. Partners are seeded from master/people.json. */
export async function personForEmail(db: Db, email: string): Promise<Person> {
  const found = await db.query<Person>('SELECT id, email, name, role FROM people WHERE email = $1', [email]);
  if (found.rows[0]) return found.rows[0];
  const id = email.split('@')[0].replace(/[^a-z0-9.-]/g, '');
  const name = id.split(/[.-]/).map(s => s ? s[0].toUpperCase() + s.slice(1) : s).join(' ');
  await db.query('INSERT INTO people (id, email, name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING', [id, email, name, 'associate']);
  return { id, email, name, role: 'associate' };
}

/** Resolve the caller from request headers. */
export async function authenticate(headers: { get(name: string): string | null | undefined }, cfg: AuthConfig, db: Db): Promise<Person> {
  const token = headers.get('cf-access-jwt-assertion');
  if (token) return personForEmail(db, await verifyAccessJwt(token, cfg));
  if (cfg.devUserEmail) return personForEmail(db, cfg.devUserEmail.toLowerCase());
  throw new AuthError('no Access token');
}
