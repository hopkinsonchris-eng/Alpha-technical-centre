import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnhAdapter } from '../src/miners/anh-co.ts';
import { assertRateLimited, collect, fakeFetch, fx, mockClock, text } from './miners.helpers.ts';

test('anh-co: Socrata resources with $where on the year, one snapshot per resource per month (recorded rows), refused resource skipped with a warning', async () => {
  const clock = mockClock();
  const f = fakeFetch([
    [/resource\/fdvb-hsrf\.json/, () => fx('anh-fdvb-hsrf.json')],
    [/resource\/5dux-bfvx\.json/, () => fx('anh-5dux-bfvx.json')],
    [/resource\/4dai-7crq\.json/, () => text('{"error":true,"message":"no row or column access to non-tabular tables"}', 403)],
  ], clock);
  const warnings: string[] = [];
  const adapter = createAnhAdapter({ fetch: f.fetch, clock, onWarn: m => warnings.push(m), appToken: 'tok' });
  assert.equal(adapter.id, 'anh-co');
  assert.equal(adapter.schedule, 'monthly');
  const recs = await collect(adapter.fetch(new Date('2025-07-01T00:00:00Z'), []));
  assert.deepEqual(recs.map(r => r.external_id), [
    'anh-co:fdvb-hsrf:2025-12', 'anh-co:fdvb-hsrf:2026-01', 'anh-co:5dux-bfvx:2025-07', 'anh-co:5dux-bfvx:2025-08',
  ]);
  const jan = recs[1];
  assert.equal(jan.meta.rows, 3);
  assert.equal(jan.authored_at, '2026-01-01T00:00:00.000Z');
  assert.equal(jan.mime, 'application/json');
  const rows = JSON.parse(jan.file!.toString());
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r: any) => r.vigencia === '2026' && r.mes === '1'));
  assert.ok(rows[0].produccion_bls, 'oil production column preserved');
  assert.match(warnings.join('\n'), /4dai-7crq skipped/);

  const first = f.calls[0];
  assert.match(decodeURIComponent(first.url), /\$where=vigencia >= '2025'/);
  assert.equal((first.init!.headers as any)['x-app-token'], 'tok');
  assertRateLimited(f.calls, 2, clock);
});

test('anh-co: identical upstream rows give identical bytes whatever the row order', async () => {
  const rows = JSON.parse(fx('anh-fdvb-hsrf.json'));
  const run = async (data: unknown[]) => {
    const clock = mockClock();
    const f = fakeFetch([[/.*/, () => data]], clock);
    const a = createAnhAdapter({ fetch: f.fetch, clock, resources: [{ id: 'fdvb-hsrf', label: 'x' }] });
    return (await collect(a.fetch(new Date('2025-12-01T00:00:00Z'), []))).map(r => r.file!.toString('hex'));
  };
  assert.deepEqual(await run(rows), await run([...rows].reverse()));
});
