// Wave 3, PR 2 (docs/vault-hub/wave3/05-markup.md §1.3, §1.7): fields named in a document become
// review-queue proposals (quote verbatim, anchor, gazetteer candidates), never attachments; accepting
// one attaches the field and files its dossier; members as well as partners may decide. W3-AC4, W3-AC5.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../src/llm/provider.ts';
import { configureLocate } from '../src/assets/gazetteers.ts';
import { extractAssets } from '../src/ingest/entities.ts';
import { setup, DOMAIN, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
const PID = 'orinoco-partnership';
before(async () => {
  h = await setup('vault-entities-');
  configureLocate({ fetch: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch });   // no network in tests
  await h.db.query("UPDATE projects SET country = 'VE', asset_ids = '{field:ve:barinas}' WHERE id = $1", [PID]);
  await h.db.query(`INSERT INTO assets (id, kind, name, country, lat, lon, location_source, status, operator, props, created_by) VALUES
    ('field:ve:guafita','field','Guafita','VE',7.98,-69.12,'gem','operating','PDVSA','{"gem":{"unit_id":"G100","release":"March 2026","status":"operating"}}','gem'),
    ('field:ve:la-victoria','field','La Victoria','VE',NULL,NULL,NULL,NULL,NULL,'{}','gem'),
    ('field:ve:barinas','field','Barinas','VE',8.62,-70.21,'gem',NULL,NULL,'{"gem":{"unit_id":"G1","release":"March 2026"}}','gem'),
    ('field:co:guafita','field','Guafita Norte','CO',7.2,-70.9,'gem',NULL,NULL,'{}','gem'),
    ('field:ve:bare','field','Bare','VE',8.9,-64.1,'gem',NULL,NULL,'{}','gem')`);
  await h.db.query("INSERT INTO people (id,email,name,role) VALUES ('ana','ana@alpha-technical-centre.com','Ana','associate'), ('ben','ben@alpha-technical-centre.com','Ben','associate')");
  await h.db.query("UPDATE projects SET members = members || '{ana}' WHERE id = $1", [PID]);
});
after(async () => { await h.db.close(); });

const TEXT = [
  '# Data room index',
  '',
  'Section 1. Production history. Current production comes from the Guafita and La Victoria fields in Apure state, operated by PDVSA.',
  'The Barinas field is already under review. Nowhere Field is a name no gazetteer knows.',
  '',
  'Section 2. Reserves. Independent certification is dated 2024.',
].join('\n');

const openAssetRows = async () => (await h.db.query<any>("SELECT id, payload FROM review_queue WHERE kind = 'asset' AND status = 'open' ORDER BY payload->>'name'")).rows;

test('W3-AC4: a document naming two known fields, one attached field and one unknown name yields exactly two proposals, each with a verbatim quote, an anchor and gazetteer candidates', async () => {
  const up = await h.upload([{ name: 'data-room-index.md', bytes: TEXT, type: 'text/markdown' }]);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.results[0].asset_proposals, 2);
  const rows = await openAssetRows();
  assert.deepEqual(rows.map(r => r.payload.name), ['Guafita', 'La Victoria']);
  for (const r of rows) {
    assert.equal(r.payload.project_id, PID);
    assert.equal(r.payload.item_id, up.body.results[0].item_id);
    assert.equal(r.payload.kind, 'field');
    assert.equal(r.payload.source, 'dictionary');
    assert.ok(TEXT.replace(/\s+/g, ' ').includes(r.payload.quote), `quote is verbatim: ${r.payload.quote}`);
    assert.ok(r.payload.quote.includes(r.payload.name));
    assert.equal(r.payload.anchor, 'Data room index');
    assert.match(r.payload.proposal, /Field named in "data-room-index.md": /);
  }
  const guafita = rows[0].payload;
  assert.ok(guafita.candidates.length >= 1 && guafita.candidates.length <= 3);
  assert.equal(guafita.candidates[0].asset_id, 'field:ve:guafita');
  assert.equal(guafita.candidates[0].source, 'gem');
  assert.equal(guafita.candidates[0].lat, 7.98);
  assert.ok(!guafita.candidates.some((c: any) => c.asset_id === 'field:co:guafita'), 'candidates stay in the project country');
  assert.equal(rows[1].payload.candidates[0].asset_id, 'field:ve:la-victoria');
  assert.equal(rows[1].payload.candidates[0].lat, null);

  // The same names in a second document do not open a second proposal while the first is open.
  const again = await h.upload([{ name: 'cover-letter.md', bytes: 'Please find the Guafita and La Victoria data attached.', type: 'text/markdown' }]);
  assert.equal(again.body.results[0].asset_proposals, 0);
  assert.equal((await openAssetRows()).length, 2);
});

test('W3-AC4: with a model, a candidate whose quote is not verbatim in the text is dropped; one whose quote is kept, with its kind', async () => {
  const provider = new FakeProvider(() => JSON.stringify({ candidates: [
    { name: 'Phantom', kind: 'field', quote: 'the Phantom field produces 50,000 bopd' },           // not in the text: dropped
    { name: 'Zuata', kind: 'block', quote: 'bids for the Zuata block close in March.' },             // verbatim: kept
    { name: 'Guafita', kind: 'field', quote: 'Current production comes from the Guafita and La Victoria fields' }, // also found by the dictionary: one candidate
  ] }));
  const text = TEXT + '\n\nSection 3. Licensing. Bids for the Zuata block close in March.';
  const project = (await h.db.query<any>('SELECT id, country, asset_ids FROM projects WHERE id = $1', [PID])).rows[0];
  const found = await extractAssets(h.db, text, [{ label: 'Data room index', offset: 0 }], project, provider);
  assert.deepEqual(found.map(c => [c.name, c.kind, c.source]).sort(), [['Guafita', 'field', 'dictionary'], ['La Victoria', 'field', 'dictionary'], ['Zuata', 'block', 'model']]);
  const zuata = found.find(c => c.name === 'Zuata')!;
  assert.equal(zuata.quote, 'Bids for the Zuata block close in March.');
  assert.ok(!found.some(c => c.name === 'Barinas'), 'an attached field is not proposed again');
  assert.ok(!found.some(c => c.name === 'Phantom'));
  // Without a provider the dictionary pass alone runs.
  const plain = await extractAssets(h.db, text, [], project, null);
  assert.deepEqual(plain.map(c => c.name).sort(), ['Guafita', 'La Victoria']);
  // A short name that is also an ordinary word is proposed only as written and next to a field word.
  const bareWord = await extractAssets(h.db, 'The hillside was bare and the road was closed. Bare rock everywhere.', [], project, null);
  assert.deepEqual(bareWord, []);
  const bareField = await extractAssets(h.db, 'Workover candidates in the Bare field are listed below.', [], project, null);
  assert.deepEqual(bareField.map(c => c.name), ['Bare']);
});

test('W3-AC5: accepting with a chosen candidate attaches it and files the dossier; accepting with nothing chosen attaches by name without a location; a member may decide; a non-member may not; rejecting resolves', async () => {
  const { createApp } = await import('../src/app.ts');
  const ana = await createApp({ db: h.db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
  const ben = await createApp({ db: h.db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ben@${DOMAIN}` } });
  const rows = await openAssetRows();
  const [guafita, victoria] = rows;
  // A non-member associate cannot see a client project, so its proposal does not exist for them (404, never 403: confidentiality is structural).
  const no = await ben.request(`/api/queue/review/${guafita.id}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(no.status, 404);
  assert.equal((await h.db.query<any>('SELECT status FROM review_queue WHERE id = $1', [guafita.id])).rows[0].status, 'open');
  // A member (not a partner) accepts with the gazetteer candidate.
  const ok = await ana.request(`/api/queue/review/${guafita.id}/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: 'field:ve:guafita' }) });
  const okText = await ok.text();
  assert.equal(ok.status, 200, okText);
  const body: any = JSON.parse(okText);
  assert.equal(body.status, 'accepted');
  assert.equal(body.asset.id, 'field:ve:guafita');
  assert.equal(body.dossier.length, 1, 'the GEM dossier is filed');
  const p = (await h.db.query<any>('SELECT asset_ids FROM projects WHERE id = $1', [PID])).rows[0];
  assert.ok(p.asset_ids.includes('field:ve:guafita'));
  const d = (await h.db.query<any>("SELECT legal_tag, external_id FROM items WHERE id = $1", [body.dossier[0]])).rows[0];
  assert.deepEqual(d, { legal_tag: 'lt-public', external_id: 'gem:G100' });
  assert.equal((await h.db.query<any>('SELECT status, resolved_by FROM review_queue WHERE id = $1', [guafita.id])).rows[0].resolved_by, 'ana');
  // Accepting with nothing chosen attaches the name alone, without a location.
  const bare = await h.app.request(`/api/queue/review/${victoria.id}/accept`, { method: 'POST' });
  const bareText = await bare.text();
  assert.equal(bare.status, 200, bareText);
  const bb: any = JSON.parse(bareText);
  assert.equal(bb.asset.name, 'La Victoria');
  assert.equal(bb.asset.lat, null);
  assert.equal(bb.asset.location_source, null);
  assert.equal(bb.dossier.length, 0);
  // A resolved row cannot be decided twice; rejecting an open one resolves it.
  assert.equal((await h.app.request(`/api/queue/review/${victoria.id}/reject`, { method: 'POST' })).status, 409);
  const extra = await h.upload([{ name: 'memo.md', bytes: 'The Boscán field is mentioned once.', type: 'text/markdown' }]);
  await h.db.query(`INSERT INTO assets (id, kind, name, country, props, created_by) VALUES ('field:ve:boscan','field','Boscán','VE','{}','gem')`);
  const extra2 = await h.upload([{ name: 'memo2.md', bytes: 'The Boscán field is mentioned twice.', type: 'text/markdown' }]);
  assert.equal(extra.body.results[0].asset_proposals + extra2.body.results[0].asset_proposals, 1);
  const boscan = (await openAssetRows()).find(r => r.payload.name === 'Boscán')!;
  const rej = await ana.request(`/api/queue/review/${boscan.id}/reject`, { method: 'POST' });
  assert.equal(rej.status, 200);
  assert.equal((await h.db.query<any>('SELECT status FROM review_queue WHERE id = $1', [boscan.id])).rows[0].status, 'rejected');
  assert.ok(!(await h.db.query<any>('SELECT asset_ids FROM projects WHERE id = $1', [PID])).rows[0].asset_ids.some((a: string) => /boscan/.test(a)));
});
