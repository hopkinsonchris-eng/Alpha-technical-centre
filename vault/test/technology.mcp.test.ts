import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture } from '../src/db/seed.ts';
import { personForEmail } from '../src/auth.ts';
import { buildMcpServer } from '../src/mcp/server.ts';
import { insertEntry } from '../src/technology/store.ts';
import { EntryBody } from '../src/technology/model.ts';

const SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/ac15/seed.json');
const DOMAIN = 'alpha-technical-centre.com';

async function connect(db: Db, who: string): Promise<Client> {
  const person = await personForEmail(db, `${who}@${DOMAIN}`);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await buildMcpServer({ db, person }).connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return client;
}
const call = async (c: Client, name: string, args: Record<string, unknown>) => (await c.callTool({ name, arguments: args })) as any;
const body = (over: Record<string, unknown>) => EntryBody.parse({
  application: 'artificial-lift', summary: 'A technology summary long enough to pass.', readiness: 4,
  evidence: [{ claim: 'c', tier: 'E2', source: 'https://example.org' }], scores: { capex: 3, opex: 3, benefit: 3, evidence: 3 }, ...over,
});

test('find, match and suggest through the MCP tools, under the caller\'s scope', async () => {
  const db = await openDb(undefined); await migrate(db); await seedMaster(db); await seedFixture(db, SEED);
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'),('ben','ben@alpha-technical-centre.com','Ben','associate') ON CONFLICT DO NOTHING");
  await db.query("UPDATE projects SET members = '{chris,ana}' WHERE id = 'orinoco-partnership'");
  const now = new Date();
  await insertEntry(db, body({ name: 'Shallow lift', screening: { depth_m: { max: 1000 } } }), { author: 'chris', status: 'confirmed', now });
  await insertEntry(db, body({ name: 'Deep lift', screening: { depth_m: { max: 5000 } } }), { author: 'chris', status: 'confirmed', now });
  await insertEntry(db, body({ name: 'Unconfirmed idea' }), { author: 'chris', status: 'proposed', now });
  await db.query("INSERT INTO tech_conditions (id, project_id, conditions, set_by) VALUES (gen_random_uuid(), 'orinoco-partnership', '{\"depth_m\": 2500}', 'ana')");

  const ana = await connect(db, 'ana'), ben = await connect(db, 'ben');
  const found = await call(ana, 'find_technologies', { application: 'artificial-lift' });
  assert.equal(found.isError, undefined, JSON.stringify(found.structuredContent));
  assert.deepEqual(found.structuredContent.entries.map((e: any) => e.name).sort(), ['Deep lift', 'Shallow lift'], 'proposals are not in the register');

  const m = await call(ana, 'match_technologies', { project_id: 'orinoco-partnership' });
  assert.equal(m.structuredContent.count, 1, 'the failing entry is excluded by default');
  assert.equal(m.structuredContent.entries[0].name, 'Deep lift');
  assert.equal(m.structuredContent.excluded_failed, 1);
  assert.equal(m.structuredContent.sources.depth_m.from, 'stored');
  const all = await call(ana, 'match_technologies', { project_id: 'orinoco-partnership', include_failed: true });
  assert.equal(all.structuredContent.entries.find((e: any) => e.name === 'Shallow lift').verdict, 'fail');

  assert.equal((await call(ben, 'match_technologies', { project_id: 'orinoco-partnership' })).isError, true, 'a non-member cannot screen a client project');
  const key = m.structuredContent.entries[0].key;
  const s = await call(ana, 'suggest_technology', { project_id: 'orinoco-partnership', key, status: 'shortlisted', note: 'passes depth' });
  assert.equal(s.isError, undefined, JSON.stringify(s.structuredContent));
  assert.equal((await call(ben, 'suggest_technology', { project_id: 'orinoco-partnership', key, status: 'dismissed' })).isError, true);
  const ev = (await db.query("SELECT action, scope FROM audit_events WHERE action LIKE 'mcp.%technolog%' ORDER BY id")).rows;
  assert.ok(ev.some((e: any) => e.action === 'mcp.suggest_technology' && e.scope === 'project:orinoco-partnership'));
  await ana.close(); await ben.close(); await db.close();
});
