// Wave 7 PR5 (docs/vault-hub/wave7/05-markup.md §1.8, W7-AC19): vault://countries/{cc}/pack.md answers through the
// connector (the countries with a pack are listed; the markdown carries the ten sections, every sentence with its
// citation, the as-of and status per section and the caveat lines) and get_project_context carries the pack's
// headlines for the project's country. Written before the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDb, DOMAIN, seedClient, seedOriginal, sourceOf, unreachable } from './country-pack.helpers.ts';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/app.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { draftSections } from '../src/llm/country-pack.ts';
import type { Db } from '../src/db/client.ts';

const ids = (prompt: string) => [...new Set([...prompt.matchAll(/\[doc:([0-9a-f-]{36})\]/g)].map(m => m[1]))];
const reply = (req: LlmRequest) => {
  const a = ids(req.messages[0].content)[0];
  return [`HEADLINE EN: Hydrocarbons vest in the state [doc:${a}]`, `HEADLINE ES: Los hidrocarburos pertenecen al Estado [doc:${a}]`, `EN: Royalty is 5 % of gross production [doc:${a}].`, `ES: La regalía es el 5 % de la producción bruta [doc:${a}].`, `QUESTION EN: Who signs the model contract?`, `QUESTION ES: ¿Quién firma el contrato modelo?`].join('\n');
};

async function seed(): Promise<{ db: Db; act: string }> {
  const db = await baseDb();
  await seedClient(db, 'NA', 'p-na', 'active');
  await seedClient(db, 'BR', 'p-br', 'active');
  const act = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'mme-petroleum-act', url: 'https://mme.gov.na/petroleum-act.pdf', text: 'Petroleum Act 2 of 1991. Ownership vests in the State.' });
  const psa = await seedOriginal(db, { country: 'NA', section: 'fiscal', source_id: 'resourcecontracts', url: 'https://resourcecontracts.org/contract/na-1', text: 'Royalty 5 %.' });
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  await draftSections({ db, provider: new FakeProvider(reply), country: 'NA', jobId, by: 'chris', now: new Date('2026-10-05T09:00:00Z'), budgetGbp: 2,
    sections: [{ section: 'legal', sources: [sourceOf(act, { attribution: 'Ministry of Mines and Energy, Namibia' })] }, { section: 'fiscal', sources: [sourceOf(psa, { licence: 'CC BY-SA 4.0', attribution: 'ResourceContracts.org, CC BY-SA 4.0' })] },
      { section: 'licensing', sources: [unreachable('mme-licensing', 'https://mme.gov.na/licensing')] }, { section: 'service', sources: [] }, { section: 'questions', sources: [] }] });
  return { db, act: act.id };
}

const devAuth = { allowedEmailDomain: DOMAIN, get devUserEmail() { return process.env.DEV_USER_EMAIL; } };
async function connect(db: Db, who: 'chris' | 'ana') {
  const app = await createApp({ db, auth: devAuth, version: 'test' });
  const fetchAs = (url: any, init: any) => { process.env.DEV_USER_EMAIL = `${who}@${DOMAIN}`; return app.request(url, init); };
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: fetchAs as any }));
  return client;
}

test('W7-AC19: the pack resource lists the countries with a pack and renders the ten sections with citations, as-of, status and caveats', async () => {
  const { db, act } = await seed();
  const client = await connect(db, 'ana');
  const list = await client.listResources();
  const packs = list.resources.filter(r => r.uri.startsWith('vault://countries/'));
  assert.deepEqual(packs.map(r => r.uri), ['vault://countries/NA/pack.md'], 'only the country with a pack is listed');
  const res = await client.readResource({ uri: 'vault://countries/NA/pack.md' });
  const md = (res.contents[0] as any).text as string;
  assert.match(md, /^# Country pack: Namibia \(NA\)/m);
  assert.match(md, /assembled 2026-10-05/);
  // Ten sections in order, each with its status and as-of.
  const heads = [...md.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  assert.equal(heads.length, 10);
  assert.match(heads[0], /^Legal framework/); assert.match(heads[9], /^What no source answered/);
  assert.match(md, /Legal framework[^\n]*\n+- Status: fresh; as of 2026-10-05; due 2027-04-03/);
  assert.match(md, new RegExp(`Royalty is 5 % of gross production\\. \\[doc:${act}\\]`));
  assert.match(md, /orientation for screening; verify against the instrument in force/);
  assert.match(md, /no public register; the firm's contacts here are/);
  assert.match(md, /Licensing and the current round[^\n]*\n+- Status: unreachable/); assert.match(md, /no source reached/i);
  assert.match(md, /Who works there[^\n]*\n+- Status: empty; not built/);
  assert.match(md, /Who signs the model contract\?/);
  assert.match(md, /Ministry of Mines and Energy, Namibia/); assert.match(md, /ResourceContracts\.org, CC BY-SA 4\.0/);
  assert.match(md, /mme-petroleum-act[^\n]*fetched 2026-10-01/);
  // A country with no pack is not found, and a bad code is refused.
  await assert.rejects(client.readResource({ uri: 'vault://countries/BR/pack.md' }), /not_found/);
  await assert.rejects(client.readResource({ uri: 'vault://countries/ZZ/pack.md' }), /not_found|invalid/);
  const audited = (await db.query("SELECT detail FROM audit_events WHERE action = 'mcp.resource.read' AND detail->>'uri' = 'vault://countries/NA/pack.md'")).rows;
  assert.equal(audited.length, 1);
  await db.close();
});

test('W7-AC19: get_project_context carries the pack headlines for the project\'s country, and nothing for a country without one', async () => {
  const { db } = await seed();
  const client = await connect(db, 'chris');
  const na = (await client.callTool({ name: 'get_project_context', arguments: { project_id: 'p-na' } })) as any;
  assert.ok(!na.isError, JSON.stringify(na));
  const pack = na.structuredContent.pack;
  assert.ok(pack, 'the pack block is present');
  assert.equal(pack.country, 'NA'); assert.equal(pack.assembled_at.slice(0, 10), '2026-10-05');
  assert.equal(pack.headlines.length, 10);
  assert.deepEqual(Object.keys(pack.headlines[0]), ['section', 'en', 'status', 'due_at']);
  const legal = pack.headlines.find((h: any) => h.section === 'legal');
  assert.match(legal.en, /Hydrocarbons vest in the state\. \[doc:/); assert.equal(legal.status, 'fresh'); assert.equal(legal.due_at, '2027-04-03');
  assert.equal(pack.headlines.find((h: any) => h.section === 'companies').status, 'empty');
  assert.match(na.structuredContent.markdown, /## Country pack \(NA\)/);
  const br = (await client.callTool({ name: 'get_project_context', arguments: { project_id: 'p-br' } })) as any;
  assert.equal(br.structuredContent.pack, null);
  await db.close();
});
