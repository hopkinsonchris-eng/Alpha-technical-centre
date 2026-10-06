// The one brake in front of every model call (6 Oct 2026: unrecorded ingest calls spent an account's credit in a
// quarter of an hour). The guard reads the day's ledger, counts this process's calls on top, refuses at the cap,
// writes a ledger row for every call that names a purpose, and the ingest cron stops each run at its own cap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { createApp } from '../src/app.ts';
import { AnthropicProvider, FakeProvider } from '../src/llm/provider.ts';
import { BudgetExceeded, assertBudget, installSpendGuard, processSpendGbp, spendToday, uninstallSpendGuard, dailyBudgetGbp, DEFAULT_DAILY_BUDGET_GBP } from '../src/llm/spend-guard.ts';
import { FakeEmbedder } from '../src/ingest/embed.ts';
import { runIngestSync, ingestBudgetGbp, DEFAULT_INGEST_BUDGET_GBP } from '../src/jobs/ingest-sync.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';

/** A Messages API that answers the same usage every time: 120 in, 80 cached, 9 out, Sonnet 5.5 ($0.000346, £0.00027). */
function fakeFetch(outputTokens = 9) {
  return (async () => new Response(JSON.stringify({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"facts":[]}' }], usage: { input_tokens: 120, cache_read_input_tokens: 80, output_tokens: outputTokens } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}
type Db = Awaited<ReturnType<typeof openDb>>;
let db: Db;
before(async () => { db = await openDb(undefined); await migrate(db); });
after(async () => { uninstallSpendGuard(); await db.close(); });

test('the cap: calls count as they are made, a purpose writes a ledger row, the cap refuses with a message that names the variable, and the ledger is re-read on its interval', async () => {
  const clock = { t: Date.parse('2026-10-06T12:00:00Z') };
  installSpendGuard(db, { env: { VAULT_DAILY_BUDGET_GBP: '0.001' } as NodeJS.ProcessEnv, clock: () => clock.t, refreshMs: 1000 });
  const p = new AnthropicProvider('sk-test', 'claude-sonnet-5-5', fakeFetch());
  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220, purpose: 'context', by: 'chris', scope: 'firm', refs: ['doc:1'] });
  const rows = (await db.query<any>("SELECT person_id, action, scope, refs, detail, tokens_in, tokens_cached, tokens_out, cost_usd::text AS cost_usd FROM audit_events WHERE action LIKE 'llm.%' ORDER BY id")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'llm.context'); assert.equal(rows[0].person_id, 'chris'); assert.equal(rows[0].scope, 'firm'); assert.deepEqual(rows[0].refs, ['doc:1']);
  assert.equal(rows[0].tokens_in, 120); assert.equal(rows[0].tokens_cached, 80); assert.equal(rows[0].tokens_out, 9);
  assert.equal(rows[0].detail.model, 'claude-sonnet-5-5');
  assert.ok(Math.abs(Number(rows[0].cost_usd) - 0.00035) < 0.00002, `priced from the list: ${rows[0].cost_usd}`);
  // A call without a purpose writes no row (its caller records its own) but still counts.
  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220 });
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'llm.%'")).rows[0].n, 1);
  let s = (await spendToday())!;
  assert.equal(s.cap_gbp, 0.001); assert.equal(s.exhausted, false);
  assert.ok(Math.abs(s.unflushed_gbp - 0.00054) < 0.0001, `two calls counted in this process: ${s.unflushed_gbp}`);
  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220, purpose: 'context' });
  await p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220, purpose: 'context' });
  s = (await spendToday())!;
  assert.equal(s.exhausted, true, `four calls at £0.00027 pass £0.001: ${s.today_gbp}`);
  await assert.rejects(() => p.complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], maxTokens: 220 }), (e: any) => e instanceof BudgetExceeded && e.name === 'BudgetExceeded' && /model budget spent today: £0\.00 of £0\.001 \(VAULT_DAILY_BUDGET_GBP\); calls resume at 00:00 UTC/.test(e.message));
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'llm.%'")).rows[0].n, 3, 'the refused call bought nothing and wrote nothing');
  await assert.rejects(() => p.search!({ system: 'S', prompt: 'P', maxUses: 1 }), BudgetExceeded);
  // The ledger is re-read on the interval: the three recorded rows; the unrecorded call is counted only by the process that made it.
  clock.t += 1500;
  s = (await spendToday())!;
  assert.ok(Math.abs(s.ledger_gbp - 0.00081) < 0.0001, `ledger: ${s.ledger_gbp}`); assert.equal(s.unflushed_gbp, 0);
  // The day turns at 00:00 UTC: a new day starts from the ledger's rows for that day.
  clock.t = Date.parse('2026-10-07T00:00:01Z');
  s = (await spendToday())!;
  assert.equal(s.today_gbp, 0); assert.equal(s.exhausted, false);
  await assertBudget();
  assert.ok(processSpendGbp() > 0.001, 'the process meter is cumulative');
});

test('GET /api/health carries the day\'s spend against the cap; a fake provider is never counted; the defaults are £10 a day and £2 an ingest run', async () => {
  const clock = { t: Date.parse('2026-10-06T13:00:00Z') };
  installSpendGuard(db, { env: { VAULT_DAILY_BUDGET_GBP: '5' } as NodeJS.ProcessEnv, clock: () => clock.t, refreshMs: 0 });
  const app = await createApp({ db, auth: { allowedEmailDomain: 'alpha-technical-centre.com', devUserEmail: 'chris@alpha-technical-centre.com' } });
  const j = await (await app.request('/api/health')).json();
  assert.equal(j.llm.cap_gbp, 5); assert.equal(j.llm.exhausted, false); assert.equal(typeof j.llm.today_gbp, 'number'); assert.match(j.llm.as_of, /^2026-10-06T13/);
  const before = (await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'llm.%'")).rows[0].n;
  await new FakeProvider().complete({ system: 'S', messages: [{ role: 'user', content: 'U' }], purpose: 'context' });
  assert.equal((await db.query<any>("SELECT count(*)::int AS n FROM audit_events WHERE action LIKE 'llm.%'")).rows[0].n, before);
  assert.equal(dailyBudgetGbp({} as NodeJS.ProcessEnv), DEFAULT_DAILY_BUDGET_GBP); assert.equal(DEFAULT_DAILY_BUDGET_GBP, 10);
  assert.equal(dailyBudgetGbp({ VAULT_DAILY_BUDGET_GBP: '25' } as NodeJS.ProcessEnv), 25);
  assert.equal(dailyBudgetGbp({ VAULT_DAILY_BUDGET_GBP: 'lots' } as NodeJS.ProcessEnv), 10);
  assert.equal(ingestBudgetGbp({} as NodeJS.ProcessEnv), DEFAULT_INGEST_BUDGET_GBP); assert.equal(DEFAULT_INGEST_BUDGET_GBP, 2);
});

test('the ingest cron stops a run at INGEST_BUDGET_GBP and leaves the rest of the backlog for the next run, saying so', async () => {
  let h: Harness | null = null;
  try {
    h = await setup('vault-spend-ingest-');
    installSpendGuard(h.db, { env: { VAULT_DAILY_BUDGET_GBP: '1000' } as NodeJS.ProcessEnv, refreshMs: 0 });
    // Two filed originals with their chunks and ingest record removed: exactly what the cron picks up.
    const up = await h.upload([{ name: 'a.md', bytes: '# A\n\nThe Guafita field was discovered in 1984 and produces from the Escandalosa formation.\n' }, { name: 'b.md', bytes: '# B\n\nThe Cumarebo field in Falcón state produced light oil from 1931.\n' }]);
    assert.equal(up.status, 201, JSON.stringify(up.body));
    const ids: string[] = (up.body.results ?? []).map((x: any) => x.item_id).filter(Boolean);
    assert.equal(ids.length, 2, JSON.stringify(up.body));
    await h.db.query('DELETE FROM chunks WHERE item_id = ANY($1::uuid[])', [ids]);
    await h.db.query("UPDATE items SET extracted = extracted - 'ingest' WHERE id = ANY($1::uuid[])", [ids]);
    // A provider whose every call costs about $1 (100,000 output tokens): the first item passes the £0.5 cap on its own.
    const costly = new AnthropicProvider('sk-test', 'claude-sonnet-5-5', fakeFetch(100_000));
    process.env.INGEST_BUDGET_GBP = '0.5';
    const s = await runIngestSync(h.db, { deps: { provider: costly, embedder: new FakeEmbedder() }, storage: h.storage, workdrive: false, books: false });
    assert.equal(s.stopped_by, 'budget', JSON.stringify(s));
    assert.equal(s.left, 1);
    assert.equal(s.ingested + s.failed + s.needs_attention + s.skipped, 1, 'one item was worked before the cap');
    const rows = (await h.db.query<any>("SELECT action FROM audit_events WHERE action LIKE 'llm.%'")).rows;
    assert.ok(rows.some(r => r.action === 'llm.context'), 'the chunk context calls are on the ledger now');
    assert.ok(processSpendGbp() >= 0.5);
  } finally {
    delete process.env.INGEST_BUDGET_GBP;
    if (h) await h.db.close();
  }
});
