// Wave 7 PR1 (docs/vault-hub/wave7/05-markup.md §1.5, S34, S44): GET /api/settings/day-rates answers
// 200 with the firm's defaults until a partner saves rates, so neither Settings nor the public Plan
// Your Job page logs a 404 on every load. Any other unsaved key still answers 404.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-settings-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const DOMAIN = 'alpha-technical-centre.com';
let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let ana: Awaited<ReturnType<typeof createApp>>;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const call = async (a: typeof partner, method: string, url: string, body?: unknown) =>
  await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate')");
  partner = await appFor(`chris@${DOMAIN}`);
  ana = await appFor(`ana@${DOMAIN}`);
});
after(async () => { await db.close(); });

test('S34: day-rates answers 200 with defaults before anything is saved, for partners and associates alike', async () => {
  for (const who of [partner, ana]) {
    const r = await json(await call(who, 'GET', '/api/settings/day-rates'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.key, 'day-rates');
    assert.equal(r.body.defaults, true);
    assert.equal(r.body.updated_at, null);
    assert.equal(r.body.value.rates.Principal, 13500);
    assert.equal(r.body.value.rates.Junior, 5500);
    assert.equal(r.body.value.margin, 0);
    assert.ok(Array.isArray(r.body.value.partners) && r.body.value.partners.length >= 1);
  }
});

test('S34: other unsaved keys still answer 404', async () => {
  const r = await json(await call(partner, 'GET', '/api/settings/nothing-here'));
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'not_found');
});

test('S34: one PUT saves the rates; the next read is the saved value, not the defaults; an associate is refused with a readable reason', async () => {
  const value = { rates: { Principal: 15000, Senior: 12000, 'Mid-level': 9000, Junior: 6000 }, swMult: 110, miscMult: 100, dataMult: 100, margin: 5, partners: [] };
  const put = await json(await call(partner, 'PUT', '/api/settings/day-rates', { value }));
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const r = await json(await call(partner, 'GET', '/api/settings/day-rates'));
  assert.equal(r.status, 200);
  assert.equal(r.body.defaults, undefined);
  assert.equal(r.body.value.rates.Principal, 15000);
  assert.equal(r.body.updated_by, 'chris');
  const refused = await json(await call(ana, 'PUT', '/api/settings/day-rates', { value }));
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /partners/);
});
