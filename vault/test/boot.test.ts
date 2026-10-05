import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { boot } from '../src/db/boot.ts';

// The production server must load the committed master data on every start: the partner list,
// the firm's assets (letterhead, templates) and the reference sets. Without that, the first
// person to log in is created as an associate and no letter can be put on letterhead.

test('boot migrates and seeds master data on a fresh database', async () => {
  const db = await openDb(undefined);
  try {
    const r = await boot(db);
    assert.deepEqual(r.migrations, ['001_init.sql', '002_opportunities.sql', '003_country_briefs.sql', '004_assets_wave3.sql', '005_research.sql', '006_oauth.sql', '007_mailboxes.sql', '008_standing.sql', '009_country_packs.sql', '010_rounds.sql', '011_round_queue.sql']);
    assert.ok(r.master.people >= 1);
    const chris = (await db.query<{ role: string }>("SELECT role FROM people WHERE email = 'chris@alpha-technical-centre.com'")).rows[0];
    assert.equal(chris?.role, 'partner');
    const letterhead = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM firm_assets WHERE kind = 'letterhead' AND is_current")).rows[0].n;
    assert.ok(letterhead >= 1, 'letterhead is registered');
  } finally { await db.close(); }
});

test('boot promotes a partner who was created as an associate by an earlier login, and is idempotent', async () => {
  const db = await openDb(undefined);
  try {
    await migrate(db);
    // What personForEmail does on a first login against an unseeded database.
    await db.query("INSERT INTO people (id, email, name, role) VALUES ('chris', 'chris@alpha-technical-centre.com', 'Chris', 'associate')");
    const first = await boot(db);
    assert.deepEqual(first.migrations, []);
    const chris = (await db.query<{ role: string; name: string }>("SELECT role, name FROM people WHERE id = 'chris'")).rows[0];
    assert.deepEqual(chris, { role: 'partner', name: 'Chris Hopkinson' });
    const people = Number((await db.query("SELECT count(*) AS n FROM people")).rows[0].n);
    const items = Number((await db.query("SELECT count(*) AS n FROM items")).rows[0].n);
    const second = await boot(db);
    assert.equal(second.master.reference_versions_added, 0);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM people")).rows[0].n), people);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM items")).rows[0].n), items);
  } finally { await db.close(); }
});
