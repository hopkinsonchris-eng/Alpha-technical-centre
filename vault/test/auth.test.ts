import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { verifyAccessJwt, type AuthConfig } from '../src/auth.ts';

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test'; jwk.alg = 'RS256';
  const cfg: AuthConfig = { teamDomain: 'alphatc.cloudflareaccess.com', audience: 'aud-123', allowedEmailDomain: 'alpha-technical-centre.com', jwks: createLocalJWKSet({ keys: [jwk] }) };
  const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string } = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setAudience(opts.aud ?? 'aud-123').setIssuer(opts.iss ?? 'https://alphatc.cloudflareaccess.com').setIssuedAt().setExpirationTime('10m').sign(privateKey);
  const db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@alpha-technical-centre.com','Chris Hopkinson','partner')");
  return { cfg, sign, db, app: await createApp({ db, auth: cfg, version: 'test' }) };
}

test('health needs no token', async () => {
  const { app, db } = await setup();
  const r = await app.request('/api/health');
  assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.migrations, 10);
  await db.close();
});

test('no token is 401; a valid Access token maps to the seeded partner', async () => {
  const { app, sign, db } = await setup();
  assert.equal((await app.request('/api/me')).status, 401);
  const r = await app.request('/api/me', { headers: { 'cf-access-jwt-assertion': await sign({ email: 'Chris@alpha-technical-centre.com' }) } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' });
  await db.close();
});

test('unknown staff email becomes an associate on first sight; outside domain is refused', async () => {
  const { app, sign, db } = await setup();
  const r = await app.request('/api/me', { headers: { 'cf-access-jwt-assertion': await sign({ email: 'ana.perez@alpha-technical-centre.com' }) } });
  assert.equal(r.status, 200);
  const p = await r.json(); assert.equal(p.id, 'ana.perez'); assert.equal(p.role, 'associate'); assert.equal(p.name, 'Ana Perez');
  const bad = await app.request('/api/me', { headers: { 'cf-access-jwt-assertion': await sign({ email: 'someone@gmail.com' }) } });
  assert.equal(bad.status, 401);
  await db.close();
});

test('wrong audience, wrong issuer and tampered tokens are refused', async () => {
  const { cfg, sign } = await setup();
  await assert.rejects(verifyAccessJwt(await sign({ email: 'chris@alpha-technical-centre.com' }, { aud: 'other' }), cfg), /invalid Access token/);
  await assert.rejects(verifyAccessJwt(await sign({ email: 'chris@alpha-technical-centre.com' }, { iss: 'https://evil.example' }), cfg), /invalid Access token/);
  const t = await sign({ email: 'chris@alpha-technical-centre.com' });
  await assert.rejects(verifyAccessJwt(t.slice(0, -4) + 'AAAA', cfg), /invalid Access token/);
  await assert.rejects(verifyAccessJwt(await sign({}), cfg), /no email/);
});

test('CF_ACCESS_AUD may list several application tags, comma separated', async () => {
  const { cfg, sign } = await setup();
  const two: AuthConfig = { ...cfg, audience: 'aud-123, aud-connector' };
  assert.equal(await verifyAccessJwt(await sign({ email: 'chris@alpha-technical-centre.com' }, { aud: 'aud-connector' }), two), 'chris@alpha-technical-centre.com');
  assert.equal(await verifyAccessJwt(await sign({ email: 'chris@alpha-technical-centre.com' }), two), 'chris@alpha-technical-centre.com');
  await assert.rejects(verifyAccessJwt(await sign({ email: 'chris@alpha-technical-centre.com' }, { aud: 'other' }), two), /invalid Access token/);
});

test('DEV_USER_EMAIL bypass works only when set, and never in production config', async () => {
  const { db } = await setup();
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' } });
  assert.equal((await app.request('/api/me')).status, 200);
  const { configFromEnv } = await import('../src/auth.ts');
  assert.equal(configFromEnv({ NODE_ENV: 'production', DEV_USER_EMAIL: 'x@alpha-technical-centre.com' } as any).devUserEmail, undefined);
  await db.close();
});
