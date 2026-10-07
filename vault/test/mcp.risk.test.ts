// Wave 8 (docs/vault-hub/wave8/01-risk-on-the-map.md, W8-AC6): get_project_context carries the project country's World
// Monitor reading (index, level, trend, sanctions, change since the previous reading) and its advisories when the feed
// is connected, and no such block without a key; the key never appears. Written before the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDb, DOMAIN, seedClient } from './country-pack.helpers.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.ts';
import { configureWorldMonitor } from '../src/intel/worldmonitor.ts';
import type { Db } from '../src/db/client.ts';

const KEY = 'wm_' + 'd'.repeat(40);
const RISK = { cii: { combinedScore: 50.4, trend: 'TREND_DIRECTION_RISING', computedAt: Date.parse('2026-10-01T08:00:00Z') }, advisoryLevel: 'reconsider', sanctionsActive: true, sanctionsCount: 212 };
const fakeFetch = (async (url: string) => {
  const ep = new URL(url).pathname.split('/').pop()!;
  const bodies: Record<string, unknown> = {
    'get-country-risk': RISK,
    'list-security-advisories': { advisories: [{ title: 'Venezuela: reconsider travel', link: 'https://example.com/adv', pubDate: '2026-09-01', source: 'US State Department', level: '3', country: 'VE' }] },
  };
  return new Response(JSON.stringify(bodies[ep] ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

const devAuth = { allowedEmailDomain: DOMAIN, get devUserEmail() { return process.env.DEV_USER_EMAIL; } };
async function connect(db: Db) {
  const app = await createApp({ db, auth: devAuth, version: 'test' });
  const fetchAs = (url: any, init: any) => { process.env.DEV_USER_EMAIL = `chris@${DOMAIN}`; return app.request(url, init); };
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: fetchAs as any }));
  return client;
}

test('W8-AC6: with World Monitor connected the project context carries the risk block and the advisory; the change follows the log; without a key there is no block; the key never appears', async () => {
  const db = await baseDb();
  await seedClient(db, 'VE', 'p-ve', 'active');
  const client = await connect(db);
  configureWorldMonitor({ apiKey: KEY, fetch: fakeFetch });
  const a = (await client.callTool({ name: 'get_project_context', arguments: { project_id: 'p-ve' } })) as any;
  const md: string = a.structuredContent.markdown;
  assert.match(md, /## Country risk \(World Monitor, VE\)/);
  assert.match(md, /- Instability index: 50 \(reconsider\), trend rising, as of 2026-10-01; sanctions active \(212 designations\)/);
  assert.match(md, /- Change: first reading on record/);
  assert.match(md, /- Advisory: Venezuela: reconsider travel \(US State Department, level 3, 2026-09-01\)/);
  assert.ok(!md.includes(KEY));
  // A later reading: the change since the first is stated.
  RISK.cii.combinedScore = 66; RISK.cii.computedAt = Date.parse('2026-10-02T08:00:00Z');
  configureWorldMonitor({ apiKey: KEY, fetch: fakeFetch });
  const b = (await client.callTool({ name: 'get_project_context', arguments: { project_id: 'p-ve' } })) as any;
  assert.match(b.structuredContent.markdown, /- Instability index: 66 /);
  assert.match(b.structuredContent.markdown, /- Change: \+15\.6 since 2026-10-01/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM country_risk_log WHERE country = 'VE'")).rows[0].n, 2);
  configureWorldMonitor({ apiKey: null });
  const c = (await client.callTool({ name: 'get_project_context', arguments: { project_id: 'p-ve' } })) as any;
  assert.ok(!/Country risk \(World Monitor/.test(c.structuredContent.markdown), 'no block without a key');
  await db.close();
});
