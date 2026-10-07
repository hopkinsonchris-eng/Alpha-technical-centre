import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider } from '../src/llm/provider.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { appSink } from '../src/ingest/items-client.ts';
import { loadWorkdriveMap, syncWorkdrive, workdriveConfig, type WorkdriveMap } from '../src/ingest/workdrive.ts';
import { ZohoAuth } from '../src/ingest/zoho-auth.ts';
import { runIngestSync } from '../src/jobs/ingest-sync.ts';
import { makeDocx, makeXlsx } from './fixtures/ingest/build.ts';
import { readFixture, readJson, setup, type Harness } from './fixtures/ingest/harness.ts';

let h: Harness;
before(async () => { h = await setup('vault-wd-'); });
after(async () => { await h.db.close(); });

const ENV = { ZOHO_WORKDRIVE_CLIENT_ID: 'cid', ZOHO_WORKDRIVE_CLIENT_SECRET: 'secret', ZOHO_WORKDRIVE_REFRESH_TOKEN: 'refresh' } as NodeJS.ProcessEnv;
const MAP: WorkdriveMap = { folders: [{ folder_id: 'F1', name: 'Orinoco / Deliverables', project_id: 'orinoco-partnership', recursive: true }] };

/** A recorded WorkDrive: token, JSON:API listings per "tick", and download bytes per file id. */
function recorded(tick: { value: 't1' | 't2' }, bytes: Record<string, Uint8Array | string>, changes?: { token: string; pages: Record<string, { data: any[]; next: string | null; status?: number }> }) {
  const log: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    log.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}${url.search}`);
    if (url.pathname === '/oauth/v2/token') return Response.json(readJson('workdrive/token.json'));
    // Wave 6 (P59): the Changes API, a start token per folder and pages of change records after a token.
    const start = /^\/api\/v1\/changes\/([^/]+)$/.exec(url.pathname);
    if (start) return changes ? Response.json({ data: { token: changes.token } }) : new Response('{}', { status: 404 });
    if (url.pathname === '/api/v1/changes') {
      const t = url.searchParams.get('page[next]') ?? '';
      const pg = changes?.pages[t];
      if (!pg) return new Response('{"errors":[{"title":"expired"}]}', { status: 400 });
      if (pg.status) return new Response('{}', { status: pg.status });
      return Response.json({ data: pg.data.map((a, i) => ({ id: 'ch' + i, type: 'changes', attributes: a })), cursor: { next: pg.next, has_next: false } });
    }
    assert.match(String((init?.headers as any)?.authorization ?? ''), /^Zoho-oauthtoken 1000\.recorded\.token$/, `request without token: ${url}`);
    const list = /\/files\/([^/]+)\/files$/.exec(url.pathname);
    if (list) {
      assert.equal(url.searchParams.get('page[limit]'), '50');
      assert.equal(url.searchParams.get('sort'), '-last_modified', 'the live API answers "Invalid Param found" to -modified_time (7 Oct 2026)');
      const file = { F1: `workdrive/list-root-${tick.value}.json`, SUB1: `workdrive/list-legal-${tick.value}.json` }[list[1]];
      return file ? Response.json(readJson(file)) : new Response('{}', { status: 404 });
    }
    const dl = /^\/v1\/workdrive\/download\/([^/]+)$/.exec(url.pathname);
    if (dl && /^download(-accl)?\.zoho\.(com|eu)$/.test(url.host)) {
      const b = bytes[dl[1]];
      return b === undefined ? new Response('gone', { status: 404 }) : new Response(b as BodyInit, { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, log };
}

test('the committed map has an example entry that is never synced', () => {
  const map = loadWorkdriveMap();
  assert.ok(map.folders.length >= 1);
  assert.match(map.folders[0].folder_id, /^EXAMPLE/);
  assert.ok(map.folders[0].project_id);
  assert.equal(workdriveConfig({} as any), null, 'no config without ZOHO_WORKDRIVE_* env');
});

test('ZohoAuth refreshes once, caches the token, and refreshes again after it expires', async () => {
  let calls = 0, clock = 0;
  const f = (async (u: string, init: any) => { calls++; assert.match(String(init.body), /grant_type=refresh_token/); return Response.json({ access_token: `t${calls}`, expires_in: 3600 }); }) as unknown as typeof fetch;
  const auth = new ZohoAuth({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', accountsUrl: 'https://accounts.zoho.eu/' }, f, () => clock);
  assert.equal(await auth.accessToken(), 't1');
  assert.equal(await auth.accessToken(), 't1');
  clock = 3600_000;
  assert.equal(await auth.accessToken(), 't2');
  const bad = new ZohoAuth({ clientId: 'a', clientSecret: 'b', refreshToken: 'c', accountsUrl: 'https://x' }, (async () => Response.json({ error: 'invalid_code' }, { status: 400 })) as unknown as typeof fetch);
  await assert.rejects(bad.accessToken(), /token refresh failed \(400\): invalid_code \(the refresh token is not valid at https:\/\/x: an EU token needs ACCOUNTS_URL/);
});

test('sync: new files become items, modified files become versions, unchanged files are not downloaded or versioned', async () => {
  const tick = { value: 't1' as 't1' | 't2' };
  const docxV1 = await makeDocx();
  const xlsx = makeXlsx();
  const nda = readFixture('nda.txt');
  const bytes: Record<string, Uint8Array | string> = { 'wd-001': docxV1, 'wd-002': xlsx, 'wd-003': nda };
  const { fetchImpl, log } = recorded(tick, bytes);
  const config = workdriveConfig(ENV, fetchImpl);
  const sink = appSink(h.app);
  const downloads = () => log.filter(l => /download(-accl)?\.zoho\./.test(l)).length;

  // 1. everything is new (the subfolder is walked)
  const first = await syncWorkdrive(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([first.listed, first.created, first.versioned, first.unchanged, first.failed], [3, 3, 0, 0, 0], first.errors.join('; '));
  assert.equal(downloads(), 3);
  const rows = (await h.db.query<any>(`SELECT id, type, title, version, origin, legal_tag, project_id, extracted, filing FROM items WHERE origin->>'source' = 'zoho-workdrive' ORDER BY title`)).rows;
  assert.deepEqual(rows.map(r => [r.title, r.type, r.version]), [['Carabobo screening report.docx', 'report', 1], ['NDA Orinoco.txt', 'nda', 1], ['Price deck.xlsx', 'spreadsheet', 1]]);
  for (const r of rows) {
    assert.equal(r.project_id, 'orinoco-partnership');
    assert.equal(r.legal_tag, 'lt-orinoco-nda-2026', 'project default tag');
    assert.match(r.origin.external_id, /^wd-00[123]$/);
    assert.ok(r.origin.fetched_at);
    assert.equal(r.filing.method, 'path');
    assert.ok(r.extracted.workdrive.modified_ms > 0);
  }
  assert.equal(rows.find(r => r.title.startsWith('NDA'))!.extracted.workdrive.path, 'Orinoco / Deliverables/Legal');
  const cursor = (await h.db.query<any>(`SELECT value FROM settings WHERE key = 'workdrive:last_sync'`)).rows[0].value;
  assert.equal(cursor.created, 3);

  // 2. nothing changed: no downloads, no versions
  const before = downloads();
  const second = await syncWorkdrive(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([second.listed, second.created, second.versioned, second.unchanged], [3, 0, 0, 3]);
  assert.equal(downloads(), before, 'unchanged files are not downloaded');

  // 3. the report has new bytes, the price deck was only touched (same bytes), the NDA is untouched
  tick.value = 't2';
  const { Document, Packer, Paragraph } = await import('docx');
  bytes['wd-001'] = new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Carabobo Screening Report, revised with the new fiscal terms.')] }] })));
  const third = await syncWorkdrive(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([third.listed, third.created, third.versioned, third.unchanged, third.failed], [3, 0, 1, 2, 0], third.errors.join('; '));
  assert.equal(downloads(), before + 2, 'the modified and the touched file are downloaded; the untouched one is not');
  const versions = (await h.db.query<any>(`SELECT title, version FROM items WHERE origin->>'source' = 'zoho-workdrive' ORDER BY title`)).rows.map(r => [r.title, r.version]);
  assert.deepEqual(versions, [['Carabobo screening report.docx', 2], ['NDA Orinoco.txt', 1], ['Price deck.xlsx', 1]]);
  const report = (await h.db.query<any>(`SELECT id FROM items WHERE title = 'Carabobo screening report.docx'`)).rows[0];
  assert.equal((await h.db.query<any>('SELECT count(*)::int AS n FROM item_versions WHERE item_id = $1', [report.id])).rows[0].n, 2);

  // 4. touched again with the same modified time as recorded: still nothing (the touch was remembered)
  const fourth = await syncWorkdrive(h.db, sink, { fetchImpl, config, map: MAP });
  assert.deepEqual([fourth.created, fourth.versioned, fourth.unchanged], [0, 0, 3]);

  // 5. the ingest-sync job then indexes everything the sync brought in (and only what lacks chunks)
  const deps = { provider: new FakeProvider(), embedder: new FakeEmbedder() };
  const job = await runIngestSync(h.db, { workdrive: false, books: false, deps });
  assert.equal(job.failed, 0, job.errors.join('; '));
  assert.equal(job.ingested, 3);
  const nda1 = (await h.db.query<any>(`SELECT id, extracted FROM items WHERE title = 'NDA Orinoco.txt'`)).rows[0];
  assert.equal(nda1.extracted.partners_only, true);
  assert.equal(nda1.extracted.expiry_date, '2029-02-13');
});

test('W6-AC10: after the first full listing the sync asks the Changes API; nothing changed means no listing; a delete hides the item; a move keeps the item with its new path; an expired token falls back to a full listing', async () => {
  const tick = { value: 't2' as 't1' | 't2' };
  const nda = readFixture('nda.txt');
  const bytes: Record<string, Uint8Array | string> = { 'wd-001': await makeDocx(), 'wd-002': makeXlsx(), 'wd-003': nda };
  const changes = { token: 'tok-1', pages: { 'tok-1': { data: [], next: 'tok-2' }, 'tok-2': { data: [{ action_category: 'DELETE', resource_group: 'FILE', resource_id: 'wd-002', resource_name: 'Price deck.xlsx', is_deleted: true }], next: 'tok-3' }, 'tok-3': { data: [{ action_category: 'MOVE', resource_group: 'FILE', resource_id: 'wd-003', resource_name: 'NDA Orinoco.txt', is_deleted: false }], next: 'tok-4' } } as Record<string, { data: any[]; next: string | null; status?: number }> };
  const { fetchImpl, log } = recorded(tick, bytes, changes);
  const config = workdriveConfig(ENV, fetchImpl);
  const sink = appSink(h.app);
  const map: WorkdriveMap = { folders: [{ folder_id: 'F1', name: 'Orinoco / Deliverables', project_id: 'orinoco-partnership', recursive: true }] };
  const listings = () => log.filter(l => /\/files\/[^/]+\/files/.test(l)).length;
  await h.db.query(`DELETE FROM settings WHERE key LIKE 'workdrive:changes:%'`);
  // 1. first run: no cursor, full listing, then the start token is stored
  const first = await syncWorkdrive(h.db, sink, { fetchImpl, config, map });
  assert.equal(first.failed, 0, first.errors.join('; '));
  assert.ok(listings() >= 1);
  assert.deepEqual((await h.db.query<any>(`SELECT value->>'token' AS t FROM settings WHERE key = 'workdrive:changes:F1'`)).rows[0].t, 'tok-1');
  // 2. nothing changed: the changes page is empty, no listing, the token advances
  const before = listings();
  const second = await syncWorkdrive(h.db, sink, { fetchImpl, config, map });
  assert.equal(listings(), before, 'no listing when nothing changed');
  assert.equal(second.unchanged_by_changes, 1);
  assert.equal((await h.db.query<any>(`SELECT value->>'token' AS t FROM settings WHERE key = 'workdrive:changes:F1'`)).rows[0].t, 'tok-2');
  // 3. a delete: the item is hidden, no listing needed
  const third = await syncWorkdrive(h.db, sink, { fetchImpl, config, map });
  assert.equal(third.hidden, 1);
  const deck = (await h.db.query<any>(`SELECT hidden, extracted->>'hidden_reason' AS why FROM items WHERE origin->>'source' = 'zoho-workdrive' AND external_id = 'wd-002'`)).rows[0];
  assert.equal(deck.hidden, true); assert.equal(deck.why, 'workdrive:deleted');
  assert.equal(listings(), before, 'a delete alone needs no listing');
  // 4. a move: a listing runs and the moved file keeps its item (same id, same version) with the new path
  const ndaBefore = (await h.db.query<any>(`SELECT id, version FROM items WHERE origin->>'source' = 'zoho-workdrive' AND external_id = 'wd-003'`)).rows[0];
  await h.db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{workdrive,path}', '"Somewhere/Old"'::jsonb) WHERE id = $1`, [ndaBefore.id]);
  const fourth = await syncWorkdrive(h.db, sink, { fetchImpl, config, map });
  assert.ok(listings() > before, 'a move lists again');
  assert.equal(fourth.moved, 1);
  const ndaAfter = (await h.db.query<any>(`SELECT id, version, extracted->'workdrive'->>'path' AS path FROM items WHERE origin->>'source' = 'zoho-workdrive' AND external_id = 'wd-003'`)).rows[0];
  assert.deepEqual([ndaAfter.id, ndaAfter.version, ndaAfter.path], [ndaBefore.id, ndaBefore.version, 'Orinoco / Deliverables/Legal']);
  assert.equal((await h.db.query<any>(`SELECT value->>'token' AS t FROM settings WHERE key = 'workdrive:changes:F1'`)).rows[0].t, 'tok-4');
  // 5. the token expired (older than the API keeps): a full listing and a fresh start token
  const n = listings();
  const fifth = await syncWorkdrive(h.db, sink, { fetchImpl, config, map });
  assert.ok(fifth.errors.some(e => /token expired/.test(e)));
  assert.ok(listings() > n);
  assert.equal((await h.db.query<any>(`SELECT value->>'token' AS t FROM settings WHERE key = 'workdrive:changes:F1'`)).rows[0].t, 'tok-1');
  await h.db.query(`DELETE FROM settings WHERE key LIKE 'workdrive:changes:%'`);
});

test('the sync job reports a source that is not configured instead of failing, and runs WorkDrive through the injected fetch', async () => {
  const off = await syncWorkdrive(h.db, appSink(h.app), { config: null, map: MAP });
  assert.match(off.errors[0], /not configured/);
  const tick = { value: 't2' as 't1' | 't2' };
  const { fetchImpl } = recorded(tick, {});
  const s = await runIngestSync(h.db, { workdrive: { fetchImpl, config: workdriveConfig(ENV, fetchImpl), map: MAP }, books: false, sink: appSink(h.app), deps: { provider: new FakeProvider(), embedder: new FakeEmbedder() } });
  assert.equal(s.workdrive?.unchanged, 3);
  assert.equal(s.failed, 0);
  const brokenFetch = (async (u: string | URL) => (String(u).includes('oauth') ? Response.json(readJson('workdrive/token.json')) : new Response('boom', { status: 500 }))) as unknown as typeof fetch;
  const bad = await syncWorkdrive(h.db, appSink(h.app), { fetchImpl: brokenFetch, config: workdriveConfig(ENV, brokenFetch), map: MAP });
  assert.equal(bad.failed, 1);
  assert.match(bad.errors[0], /list F1 failed \(500\)/);
});

/* ── 7 October 2026: the first live run against the EU data centre ── */

test('live shape: the byte size comes from storage_info.size_in_bytes (size is "976.06 KB"), a file past the cap is skipped and named, the file\'s own download_url is used, and a run files at most maxPerRun new files, leaving the rest for the next run with the full listing kept', async () => {
  const nda = readFixture('nda.txt');
  const entry = (id: string, name: string, bytes: number, extra: any = {}) => ({ id, type: 'files', attributes: { name, extn: name.split('.').pop(), type: 'document', is_folder: false, modified_time_in_millisecond: 1791371482525, storage_info: { size: '976.06 KB', size_in_bytes: bytes }, permalink: `https://workdrive.zoho.eu/file/${id}`, ...extra } });
  const listing = { data: [
    entry('eu-001', 'One.txt', nda.length, { download_url: 'https://download-accl.zoho.eu/v1/workdrive/download/eu-001' }),
    entry('eu-002', 'Huge.txt', 60 * 1024 * 1024),
    entry('eu-003', 'Three.txt', nda.length),
  ] };
  const log: string[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    log.push(`${init?.method ?? 'GET'} ${url.host}${url.pathname}${url.search}`);
    if (url.pathname === '/oauth/v2/token') return Response.json(readJson('workdrive/token.json'));
    if (/^\/api\/v1\/changes\//.test(url.pathname)) return Response.json({ data: { token: 'tok-eu' } });
    if (url.pathname === '/api/v1/changes') return Response.json({ data: [], cursor: { next: null, has_next: false } });
    if (/\/files\/EU1\/files$/.test(url.pathname)) return Response.json(listing);
    if (/\/v1\/workdrive\/download\//.test(url.pathname)) return new Response(nda as BodyInit, { status: 200 });
    return new Response('unexpected', { status: 500 });
  }) as unknown as typeof fetch;
  const config = workdriveConfig({ ...ENV, ZOHO_WORKDRIVE_API_URL: 'https://workdrive.zoho.eu/api/v1', ZOHO_WORKDRIVE_DOWNLOAD_URL: 'https://download.zoho.eu/v1/workdrive/download', ZOHO_WORKDRIVE_ACCOUNTS_URL: 'https://accounts.zoho.eu' } as any, fetchImpl);
  const map = { folders: [{ folder_id: 'EU1', name: 'Parker Creek', project_id: 'orinoco-partnership', recursive: true, enabled: true }] } as any;
  const sink = appSink(h.app);
  const first = await syncWorkdrive(h.db, sink, { fetchImpl, config, map, maxPerRun: 1 });
  assert.equal(first.listed, 3);
  assert.equal(first.created, 1, first.errors.join('; '));
  assert.equal(first.skipped, 1); assert.ok(first.errors.some(e => /Huge\.txt: larger than/.test(e)), 'the file past the cap is named');
  assert.equal(first.deferred, 1, 'one new file is left for the next run');
  assert.ok(first.notes?.some(n => /1 file.* left for the next run/.test(n)), JSON.stringify(first.notes));
  assert.ok(log.some(l => l.startsWith('GET download-accl.zoho.eu/v1/workdrive/download/eu-001')), 'the file\'s own download_url is used');
  assert.ok(!log.some(l => l.includes('download/eu-003')), 'the deferred file was not downloaded');
  assert.equal((await h.db.query<any>(`SELECT value FROM settings WHERE key = 'workdrive:changes:EU1'`)).rows.length, 0, 'no changes cursor while files are deferred: the next run lists in full');
  const second = await syncWorkdrive(h.db, sink, { fetchImpl, config, map, maxPerRun: 1 });
  assert.equal(second.created, 1); assert.equal(second.unchanged, 1); assert.equal(second.deferred, 0);
  assert.ok(log.some(l => l.includes('download.zoho.eu/v1/workdrive/download/eu-003')), 'without a download_url the configured download host is used');
  assert.equal((await h.db.query<any>(`SELECT value FROM settings WHERE key = 'workdrive:changes:EU1'`)).rows.length, 1, 'the changes cursor is stored once nothing is deferred');
});

