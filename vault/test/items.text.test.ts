// Wave 7 PR2 (docs/vault-hub/wave7/05-markup.md §1.4, W7-AC8): GET /api/items/:id?text=1 returns the item's
// extracted text assembled from its current chunks in order, with each chunk's overlap prefix removed, so the
// record panel can show the record itself. The flag is additive (the plain read is unchanged) and the read is
// scope-checked exactly as the item itself: whoever cannot read the item cannot read its text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-items-text-'));

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster, seedFixture } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { EMBED_DIMS, vectorLiteral } = await import('../src/ingest/embed.ts');
type Db = Awaited<ReturnType<typeof openDb>>;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const DOMAIN = 'alpha-technical-centre.com';
const PROJECT = 'orinoco-partnership';
const TAG = 'lt-orinoco-nda-2026';

let db: Db;
const appFor = (email: string) => createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: email } });
const vec = vectorLiteral(new Array(EMBED_DIMS).fill(0));

/** An item with its chunks written the way ingest writes them: each chunk after the first starts with the tail of the one before. */
async function seedItem(chunks: string[], opts: { version?: number; type?: string; staleChunks?: string[] } = {}) {
  const id = randomUUID();
  const version = opts.version ?? 1;
  await db.query(
    `INSERT INTO items (id,type,title,created_at,authors,client_id,project_id,legal_tag,origin,content_hash,version,extracted)
     VALUES ($1,$2,'A letter',now(),'{chris}','petrolera-del-orinoco',$3,$4,'{"source":"test"}'::jsonb,$5,$6,'{"chunks":2,"format":"txt"}'::jsonb)`,
    [id, opts.type ?? 'letter', PROJECT, TAG, 'sha256:' + id.replace(/-/g, '').padEnd(64, '0'), version]);
  const write = async (texts: string[], v: number, current: boolean) => {
    for (let i = 0; i < texts.length; i++) {
      await db.query('INSERT INTO chunks (item_id, item_version, ordinal, anchor, context, text, legal_tag, client_id, project_id, current, embedding) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::vector)',
        [id, v, i, 'p' + (i + 1), 'ctx ' + i, texts[i], TAG, 'petrolera-del-orinoco', PROJECT, current, vec]);
    }
  };
  if (opts.staleChunks) await write(opts.staleChunks, version - 1, false);
  await write(chunks, version, true);
  return id;
}

before(async () => {
  db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  await seedFixture(db, JSON.parse(readFileSync(path.join(FIX, 'ac15/seed.json'), 'utf8')));
  await db.query("INSERT INTO people (id,email,name,role) VALUES ('ana',$1,'Ana','associate') ON CONFLICT (id) DO NOTHING", [`ana@${DOMAIN}`]);
});
after(async () => { await db.close(); });

test('GET /api/items/:id?text=1 assembles extracted.text from the current chunks in order, dropping the overlap each chunk repeats; the plain read carries no text', async () => {
  const chris = await appFor(`chris@${DOMAIN}`);
  const first = 'Dear Jorge,\n\nThank you for the data room index. The Cubiro screen gives 3,100 bopd of technical potential.';
  const tail = first.slice(-40);                                            // ingest prepends ~15 % of the previous chunk
  const second = tail + '\n\nWe would welcome the pipeline repair report when convenient.\n\nYours sincerely,\nChris';
  const id = await seedItem([first, second], { version: 2, staleChunks: ['An older version of the letter that was superseded.'] });

  const plain = await chris.request(`/api/items/${id}`);
  assert.equal(plain.status, 200);
  const plainBody = await plain.json();
  assert.equal('text' in (plainBody.extracted ?? {}), false, 'the plain read is unchanged');

  const r = await chris.request(`/api/items/${id}?text=1`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.id, id);
  assert.equal(body.extracted.chunks, 2, 'the stored extracted fields are kept');
  assert.equal(body.extracted.text, first + '\n\nWe would welcome the pipeline repair report when convenient.\n\nYours sincerely,\nChris');
  assert.ok(!body.extracted.text.includes('older version'), 'superseded chunks are not part of the text');
  assert.equal(body.extracted.text.indexOf(tail), first.length - 40, 'the overlap appears once');
  assert.deepEqual(body.extracted.text_anchors, [{ ordinal: 0, anchor: 'p1', offset: 0 }, { ordinal: 1, anchor: 'p2', offset: first.length }]);
});

test('GET /api/items/:id?text=1 on an item with no chunks answers with an empty text, never an error', async () => {
  const chris = await appFor(`chris@${DOMAIN}`);
  const id = await seedItem([]);
  const r = await chris.request(`/api/items/${id}?text=1`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.extracted.text, '');
  assert.deepEqual(body.extracted.text_anchors, []);
});

test('the text is scope-checked exactly as the item: an associate outside the NDA tag gets the same refusal with or without ?text=1, and no text leaks', async () => {
  const ana = await appFor(`ana@${DOMAIN}`);
  const id = await seedItem(['Confidential: reserves of 120 MMbbl.']);
  const plain = await ana.request(`/api/items/${id}`);
  const withText = await ana.request(`/api/items/${id}?text=1`);
  assert.ok(plain.status === 403 || plain.status === 404, `plain read refused (${plain.status})`);
  assert.equal(withText.status, plain.status, 'the same refusal with ?text=1');
  const text = await withText.text();
  assert.ok(!text.includes('120 MMbbl'), 'no text leaks in the refusal');
  // The audit row names the item and the scope either way.
  const audit = (await db.query<any>("SELECT action, refs FROM audit_events WHERE action = 'item.read' AND refs @> $1::text[] ORDER BY id DESC LIMIT 1", [[`doc:${id}`]])).rows[0];
  assert.ok(audit, 'the read is audited');
});
