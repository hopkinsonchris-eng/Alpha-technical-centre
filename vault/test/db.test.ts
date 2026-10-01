import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';

const EXPECTED_TABLES = ['people','organisations','contacts','legal_tags','projects','project_contacts','assets','firm_assets','tools','runs','run_inputs','items','item_versions','item_cites','dispatches','reference_counters','lessons','analogue_rows','chunks','filing_queue','review_queue','jobs','mail_cursors','settings','audit_events','schema_migrations'];

test('001_init applies to an empty database and is idempotent', async () => {
  const db = await openDb(undefined);
  try {
    const first = await migrate(db);
    assert.deepEqual(first, ['001_init.sql', '002_opportunities.sql', '003_country_briefs.sql']);
    const second = await migrate(db);
    assert.deepEqual(second, []);
    const { rows } = await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
    const names = new Set(rows.map(r => r.table_name));
    for (const t of EXPECTED_TABLES) assert.ok(names.has(t), `missing table ${t}`);
  } finally { await db.close(); }
});

test('audit_events refuses UPDATE and DELETE', async () => {
  const db = await openDb(undefined);
  try {
    await migrate(db);
    await db.query("INSERT INTO audit_events (person_id, action) VALUES ('chris','test')");
    await assert.rejects(db.query("UPDATE audit_events SET action='x'"), /append-only/);
    await assert.rejects(db.query('DELETE FROM audit_events'), /append-only/);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM audit_events');
    assert.equal(rows[0].n, 1);
  } finally { await db.close(); }
});

test('chunks accept a 1024-d embedding and build a tsvector', async () => {
  const db = await openDb(undefined);
  try {
    await migrate(db);
    await db.query("INSERT INTO organisations (id,name,kind) VALUES ('frontera','Frontera Energy','client')");
    await db.query("INSERT INTO legal_tags (id,classification,data_type,client_id,originator) VALUES ('lt-frontera-nda','client-nda','second-party','frontera','Frontera')");
    await db.query("INSERT INTO projects (id,client_id,name,default_legal_tag) VALUES ('llanos','frontera','Llanos screening','lt-frontera-nda')");
    await db.query("INSERT INTO people (id,email,name,role) VALUES ('chris','chris@alpha-technical-centre.com','Chris Hopkinson','partner')");
    const id = '11111111-1111-4111-8111-111111111111';
    await db.query("INSERT INTO items (id,type,title,created_at,project_id,client_id,legal_tag,origin,content_hash) VALUES ($1,'report','Cubiro waterflood note',now(),'llanos','frontera','lt-frontera-nda','{\"source\":\"upload\"}','sha256:'||repeat('0',64))", [id]);
    const vec = '[' + Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0)).join(',') + ']';
    await db.query('INSERT INTO chunks (item_id, item_version, ordinal, context, text, legal_tag, client_id, project_id, embedding) VALUES ($1,1,0,$2,$3,$4,$5,$6,$7::vector)',
      [id, 'Section 3 of the Cubiro waterflood note', 'Recovery factor of 0.31 from the 2019 pilot in Cubiro', 'lt-frontera-nda', 'frontera', 'llanos', vec]);
    const { rows } = await db.query("SELECT ordinal FROM chunks WHERE tsv @@ plainto_tsquery('simple','cubiro pilot')");
    assert.equal(rows.length, 1);
    const near = await db.query('SELECT ordinal, embedding <=> $1::vector AS d FROM chunks ORDER BY d LIMIT 1', [vec]);
    assert.ok(near.rows[0].d < 1e-6);
  } finally { await db.close(); }
});
