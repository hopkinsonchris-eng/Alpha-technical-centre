import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster, seedFixture, uuidFrom } from '../src/db/seed.ts';
import { validate } from '../src/schemas.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.resolve(HERE, '..');
const seedJson = JSON.parse(readFileSync(path.join(HERE, 'fixtures/ac15/seed.json'), 'utf8'));

async function fresh(): Promise<Db> { const db = await openDb(undefined); await migrate(db); return db; }
const n = async (db: Db, table: string) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const TABLES = ['people', 'assets', 'firm_assets', 'items', 'item_versions', 'legal_tags', 'projects'];
const snapshot = async (db: Db) => Object.fromEntries(await Promise.all(TABLES.map(async t => [t, await n(db, t)])));

test('seedMaster loads people, master data, firm assets and reference sets, and is idempotent', async () => {
  const db = await fresh();
  try {
    const first = await seedMaster(db);
    const rows = (f: string) => JSON.parse(readFileSync(path.join(VAULT, 'master', f), 'utf8'));
    assert.equal(first.people, rows('people.json').length);
    assert.equal(await n(db, 'people'), rows('people.json').length);
    assert.equal(await n(db, 'assets'), rows('basins.json').length + rows('fields.json').length + rows('wells.json').length);
    const chris = (await db.query<any>("SELECT role, signature_block FROM people WHERE id = 'chris'")).rows[0];
    assert.equal(chris.role, 'partner'); assert.match(chris.signature_block, /Managing Partner/);
    const well = (await db.query<any>("SELECT parent_id, props FROM assets WHERE id = 'well:llanos:cubiro:cub-1'")).rows[0];
    assert.equal(well.parent_id, 'field:llanos:cubiro'); assert.ok(well.props.note);

    // firm project and tags
    const tags = (await db.query<any>("SELECT id, classification FROM legal_tags ORDER BY id")).rows;
    assert.deepEqual(tags, [{ id: 'lt-firm', classification: 'firm' }, { id: 'lt-public', classification: 'public' }]);
    const firm = (await db.query<any>("SELECT client_id, default_legal_tag FROM projects WHERE id = 'firm'")).rows[0];
    assert.deepEqual(firm, { client_id: null, default_legal_tag: 'lt-firm' });

    // firm assets, with content hashes of the committed files
    const fa = (await db.query<any>("SELECT id, kind, language, path, content_hash, is_current FROM firm_assets ORDER BY id")).rows;
    assert.equal(fa.length, 8);
    const es = fa.find((a: any) => a.id === 'letterhead-es-v1');
    assert.deepEqual([es.kind, es.language, es.path, es.is_current], ['letterhead', 'es', 'vault/firm/assets/letterhead-es.docx', true]);
    assert.ok(fa.every((a: any) => /^sha256:[0-9a-f]{64}$/.test(a.content_hash)));

    // reference sets become items of type reference-set under project firm, tag lt-firm, origin tool
    const refFiles = readdirSync(path.join(VAULT, 'reference'), { recursive: true }).map(String).filter(f => f.endsWith('.json'));
    const refs = (await db.query<any>("SELECT id, title, project_id, legal_tag, origin, external_id, version, content_hash, mime, extracted FROM items WHERE type = 'reference-set' ORDER BY external_id")).rows;
    assert.equal(refs.length, refFiles.length);
    assert.deepEqual(refs.map((r: any) => r.external_id), ['fiscal_terms/co/anh-e-and-p-2026', 'price_decks/brent-2026-09']);
    const brent = refs.find((r: any) => r.external_id === 'price_decks/brent-2026-09');
    assert.deepEqual([brent.project_id, brent.legal_tag, brent.origin, brent.version, brent.mime], ['firm', 'lt-firm', { source: 'tool', external_id: 'price_decks/brent-2026-09' }, 1, 'application/json']);
    assert.equal(brent.extracted.content.brent_usd_bbl['2030+'], 70);
    assert.equal(brent.id, uuidFrom('reference:price_decks/brent-2026-09'));
    assert.match(brent.content_hash, /^sha256:[0-9a-f]{64}$/);

    // items produced by the seed are valid VaultItems
    const item = (await db.query<any>("SELECT * FROM items WHERE id = $1", [brent.id])).rows[0];
    const record = { id: item.id, type: item.type, title: item.title, created_at: new Date(item.created_at).toISOString(), project_id: item.project_id, legal_tag: item.legal_tag, origin: item.origin, content_hash: item.content_hash, version: item.version, mime: item.mime };
    assert.deepEqual(validate('vault-item', record), []);

    // idempotent: a second and third run change nothing
    const before = await snapshot(db);
    await seedMaster(db); const again = await seedMaster(db);
    assert.deepEqual(await snapshot(db), before);
    assert.equal(again.reference_versions_added, 0);
    assert.equal(await n(db, 'item_versions'), refs.length);
  } finally { await db.close(); }
});

test('seedMaster adds a version when a committed reference file changes, and leaves the item id alone', async () => {
  const db = await fresh();
  try {
    await seedMaster(db);
    const id = uuidFrom('reference:price_decks/brent-2026-09');
    await db.query("UPDATE items SET content_hash = $2 WHERE id = $1", [id, 'sha256:' + '0'.repeat(64)]);   // as if the file had been different at last deploy
    const s = await seedMaster(db);
    assert.equal(s.reference_versions_added, 1);
    const item = (await db.query<any>('SELECT version, content_hash FROM items WHERE id = $1', [id])).rows[0];
    assert.equal(item.version, 2);
    assert.notEqual(item.content_hash, 'sha256:' + '0'.repeat(64));
    assert.deepEqual((await db.query<any>('SELECT version FROM item_versions WHERE item_id = $1 ORDER BY version', [id])).rows.map((r: any) => r.version), [1, 2]);
    assert.equal((await seedMaster(db)).reference_versions_added, 0);
  } finally { await db.close(); }
});

test('seedFixture loads the AC15 organisation, contacts, tag, project, NDA, items and six dispatches, idempotently', async () => {
  const db = await fresh();
  try {
    await seedMaster(db);
    const first = await seedFixture(db, seedJson);
    assert.deepEqual(first, { contacts: 2, items: 6, dispatches: 6 });   // nda_item duplicates the "Signed mutual NDA" id: 1 + 5 distinct items
    assert.equal((await db.query('SELECT 1 FROM organisations WHERE id = $1', ['petrolera-del-orinoco'])).rows.length, 1);
    assert.equal(await n(db, 'contacts'), 2);
    assert.equal(await n(db, 'dispatches'), 6);
    assert.equal(await n(db, 'project_contacts'), 2);
    const tag = (await db.query<any>("SELECT classification, client_id, to_char(expires_at,'YYYY-MM-DD') AS expires FROM legal_tags WHERE id = 'lt-orinoco-nda-2026'")).rows[0];
    assert.deepEqual(tag, { classification: 'client-nda', client_id: 'petrolera-del-orinoco', expires: '2028-02-13' });
    const nda = (await db.query<any>("SELECT type, legal_tag, reference_no, extracted FROM items WHERE id = $1", [seedJson.nda_item.id])).rows[0];
    assert.deepEqual([nda.type, nda.legal_tag, nda.reference_no, nda.extracted.expiry], ['nda', 'lt-firm', 'ATC-2026-0103', '2028-02-13']);
    const ds = (await db.query<any>("SELECT reference_no FROM dispatches ORDER BY occurred_at")).rows.map((r: any) => r.reference_no);
    assert.deepEqual(ds, ['ATC-2026-0098', null, 'ATC-2026-0103', 'ATC-2026-0117', null, 'ATC-2026-0131']);
    assert.equal(await n(db, 'item_versions') >= 6, true);

    const before = await snapshot(db);
    const again = await seedFixture(db, seedJson);
    assert.deepEqual(again, { contacts: 2, items: 0, dispatches: 0 });
    assert.deepEqual(await snapshot(db), before);
    assert.equal(await n(db, 'dispatches'), 6);
    // a path works as well as a parsed object
    assert.deepEqual(await seedFixture(db, path.join(HERE, 'fixtures/ac15/seed.json')), { contacts: 2, items: 0, dispatches: 0 });
  } finally { await db.close(); }
});

test('seedFixture needs the people seedMaster loads (signed_by) and works once they exist', async () => {
  const db = await fresh();
  try {
    await assert.rejects(seedFixture(db, seedJson), /violates foreign key|signed_by|people/i);
    await seedMaster(db);
    assert.equal((await seedFixture(db, seedJson)).dispatches, 6);
  } finally { await db.close(); }
});
