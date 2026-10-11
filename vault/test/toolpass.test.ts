// Tool passes (toolpass.routes.ts): a Hub user gets a 12-hour pass for an app that trusts the Vault, signed so the
// app can check it with the public key alone. Off until TOOL_PASS_SEED is set; service callers and unknown apps refused.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { passKey, PASS_LIFE_S } from '../src/api/toolpass.routes.ts';

const DOMAIN = 'alpha-technical-centre.com';
const SEED = 'test-seed-0123456789abcdef0123456789abcdef';
let db: Db;
const saved = process.env.TOOL_PASS_SEED;

before(async () => {
  db = await openDb(undefined); await migrate(db);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris',$1,'Chris Hopkinson','partner'),('ana',$2,'Ana','associate'),('bot',$3,'Bot','service')",
    [`chris@${DOMAIN}`, `ana@${DOMAIN}`, `bot@${DOMAIN}`]);
});
after(async () => { await db.close(); });
beforeEach(() => { process.env.TOOL_PASS_SEED = SEED; });
afterEach(() => { if (saved === undefined) delete process.env.TOOL_PASS_SEED; else process.env.TOOL_PASS_SEED = saved; });

const as = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const issue = async (email: string, body: unknown) => (await as(email)).request('/api/tool-pass', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rawKey = (b64u: string) => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(b64u, 'base64url')]), format: 'der', type: 'spki' });

test('a partner and an associate each get a pass the public key verifies', async () => {
  const pub = (await (await (await as(`chris@${DOMAIN}`)).request('/api/tool-pass/key')).json()).public_key;
  assert.equal(Buffer.from(pub, 'base64url').length, 32);
  for (const [email, role, name] of [[`chris@${DOMAIN}`, 'partner', 'Chris Hopkinson'], [`ana@${DOMAIN}`, 'associate', 'Ana']]) {
    const t0 = Math.floor(Date.now() / 1000);
    const res = await issue(email, { tool: 'apex-3d-model' });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.tool, 'apex-3d-model');
    const [v, body, sig] = j.pass.split('.');
    assert.equal(v, 'hub1');
    assert.ok(verify(null, Buffer.from(`hub1.${body}`), rawKey(pub), Buffer.from(sig, 'base64url')), 'signature verifies');
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    assert.deepEqual({ aud: p.aud, sub: p.sub, role: p.role, name: p.name }, { aud: 'apex-3d-model', sub: email, role, name });
    assert.ok(p.iat >= t0 - 1 && p.iat <= t0 + 5);
    assert.equal(p.exp - p.iat, PASS_LIFE_S);
    assert.equal(j.expires_at, new Date(p.exp * 1000).toISOString());
  }
  const audit = await db.query<{ n: string }>("SELECT count(*) AS n FROM audit_events WHERE action = 'tool-pass.issue' AND detail->>'tool' = 'apex-3d-model'");
  assert.equal(Number(audit.rows[0].n), 2);
});

test('the key is derived from the seed: same seed, same key; new seed, new key', () => {
  const a = passKey(SEED)!.pub, b = passKey(SEED)!.pub, c = passKey(SEED + 'x')!.pub;
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(passKey('too-short'), null);
  assert.equal(passKey(''), null);
});

test('an app that does not take passes, or a malformed body, is refused', async () => {
  for (const body of [{ tool: 'apex-asset-intelligence' }, { tool: '' }, {}, { tool: ['apex-3d-model'] }]) {
    const res = await issue(`chris@${DOMAIN}`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('a service caller gets no pass', async () => {
  const res = await issue(`bot@${DOMAIN}`, { tool: 'apex-3d-model' });
  assert.equal(res.status, 403);
});

test('without TOOL_PASS_SEED both routes answer 503 not_configured', async () => {
  delete process.env.TOOL_PASS_SEED;
  const res = await issue(`chris@${DOMAIN}`, { tool: 'apex-3d-model' });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, 'not_configured');
  assert.equal((await (await as(`chris@${DOMAIN}`)).request('/api/tool-pass/key')).status, 503);
});
