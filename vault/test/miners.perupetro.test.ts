import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { createPerupetroAdapter, summariseWorkbook } from '../src/miners/perupetro.ts';
import { assertRateLimited, collect, fakeFetch, mockClock, text } from './miners.helpers.ts';

/** A workbook shaped like Perupetro's monthly production statistics: a title row, then headers, then data. */
function workbook(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Producción fiscalizada de petróleo (bbl)'],
    ['Lote', 'Operador', 'Enero', 'Febrero'],
    ['Lote 192', 'Altamesa', 1200.5, 1300],
    ['Lote X', 'CNPC', 45000, 44000],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Petróleo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lote', 'Gas'], ['Lote 56', 1000]]), 'Gas');
  return Buffer.from(new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
}

test('perupetro: configured Excel downloads parsed with xlsx into one snapshot each', async () => {
  const clock = mockClock();
  const xlsx = workbook();
  const f = fakeFetch([
    [/produccion-petroleo\.xlsx$/, () => new Response(new Uint8Array(xlsx), { headers: { 'last-modified': 'Tue, 15 Sep 2026 10:00:00 GMT' } })],
    [/produccion-gas\.xlsx$/, () => new Response(new Uint8Array(xlsx))],
    [/missing\.xlsx$/, () => text('nope', 404)],
  ], clock);
  const warnings: string[] = [];
  const adapter = createPerupetroAdapter({
    fetch: f.fetch, clock, onWarn: m => warnings.push(m),
    downloads: [
      { id: 'petroleo-2026', url: 'https://example.test/produccion-petroleo.xlsx', label: 'Perupetro oil production 2026' },
      { id: 'gas-2026', url: 'https://example.test/produccion-gas.xlsx', label: 'Perupetro gas production 2026' },
      { id: 'gone', url: 'https://example.test/missing.xlsx', label: 'Missing' },
    ],
  });
  const recs = await collect(adapter.fetch(new Date('2026-09-01T00:00:00Z'), []));
  assert.equal(recs.length, 2);
  const r = recs[0];
  assert.equal(r.external_id, 'perupetro:petroleo-2026');
  assert.equal(r.authored_at, '2026-09-15T10:00:00.000Z');
  assert.deepEqual(r.file, xlsx);
  assert.equal(r.meta.rows, 3, 'two oil rows and one gas row');
  assert.deepEqual((r.meta.sheets as any[])[0], { name: 'Petróleo', rows: 2, header: ['Lote', 'Operador', 'Enero', 'Febrero'] });
  assert.match(warnings[0], /gone not available/);
  assertRateLimited(f.calls, 1, clock);
});

test('perupetro: summariseWorkbook reads header and row counts', () => {
  const s = summariseWorkbook(workbook());
  assert.deepEqual(s.sheets.map(x => [x.name, x.rows]), [['Petróleo', 2], ['Gas', 1]]);
});
