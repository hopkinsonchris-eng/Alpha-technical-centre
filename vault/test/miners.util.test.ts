import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Http, HttpError, TokenBucket, groupByMonth, parseNum, readZip, toMonth } from '../src/miners/util.ts';
import { buildZip, fakeFetch, mockClock, text } from './miners.helpers.ts';

test('token bucket: first call is immediate, later calls are spaced 1000/perSecond ms under a mock clock', async () => {
  const clock = mockClock();
  const b = new TokenBucket(4, clock);
  const stamps: number[] = [];
  for (let i = 0; i < 6; i++) { await b.take(); stamps.push(clock.now()); }
  const t0 = stamps[0];
  assert.deepEqual(stamps.map(s => s - t0), [0, 250, 500, 750, 1000, 1250]);
});

test('token bucket: idle time earns at most one token (no bursts)', async () => {
  const clock = mockClock();
  const b = new TokenBucket(2, clock);
  await b.take();
  clock.t += 60_000;
  const t = clock.t;
  await b.take(); await b.take();
  assert.equal(clock.t - t, 500, 'the second call after a long idle still waits');
});

test('token bucket: concurrent callers are served in order and still spaced', async () => {
  const clock = mockClock();
  const b = new TokenBucket(1, clock);
  const at: number[] = [];
  await Promise.all([1, 2, 3].map(async () => { await b.take(); at.push(clock.now()); }));
  assert.deepEqual([at[1] - at[0], at[2] - at[1]], [1000, 1000]);
});

test('http: 429 is retried after Retry-After through the limiter; other errors surface as HttpError; the SPE library host is refused', async () => {
  const clock = mockClock();
  let n = 0;
  const f = fakeFetch([
    [/flaky/, () => (++n < 3 ? text('slow down', 429, { 'retry-after': '3' }) : { ok: true })],
    [/broken/, () => text('boom', 500)],
  ], clock);
  const http = new Http(1, { fetch: f.fetch, clock });
  assert.deepEqual(await http.json('https://example.test/flaky'), { ok: true });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[1].at - f.calls[0].at >= 3000);
  await assert.rejects(http.json('https://example.test/broken'), (e: any) => e instanceof HttpError && e.status === 500);
  const host = ['www', 'onepetro', 'org'].join('.');
  await assert.rejects(http.json(`https://${host}/servlet/x`), /never the SPE library/);
  assert.equal(f.calls.length, 4, 'the refused request never reached fetch');
});

test('http: API keys are redacted from error messages', async () => {
  const clock = mockClock();
  const f = fakeFetch([[/./, () => text('no', 403)]], clock);
  await assert.rejects(new Http(1, { fetch: f.fetch, clock }).json('https://api.example.test/x?api_key=SECRET123&a=1'), (e: any) => !/SECRET123/.test(e.message) && /api_key=\*\*\*/.test(e.message));
});

test('zip: reads deflated and stored entries as streams', async () => {
  const zip = buildZip([{ name: 'a.csv', data: 'x;y\n1;2\n'.repeat(1000) }, { name: 'dir/b.txt', data: 'hello' }]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map(e => e.name), ['a.csv', 'dir/b.txt']);
  const read = async (s: Readable) => { let out = ''; for await (const c of s) out += c.toString(); return out; };
  assert.equal((await read(entries[0].open())).length, 8 * 1000);
  assert.equal(await read(entries[1].open()), 'hello');
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /not a zip/);
});

test('helpers: numbers, months and grouping', () => {
  assert.equal(parseNum('1.234,50'), 1234.5);
  assert.equal(parseNum('1,234.50'), 1234.5);
  assert.equal(parseNum('8,731.00'), 8731);
  assert.equal(parseNum('12,5'), 12.5);
  assert.equal(parseNum(''), null);
  assert.equal(parseNum('n/a'), null);
  assert.equal(toMonth('2026', '3'), '2026-03');
  assert.equal(toMonth('2026-03-01T00:00:00'), '2026-03');
  assert.equal(toMonth('Marzo', '3'), null);
  const g = groupByMonth([{ m: '2026-02' }, { m: '2025-01' }, { m: '2026-01' }, { m: null }], r => r.m, new Date('2025-12-15T00:00:00Z'));
  assert.deepEqual([...g.keys()], ['2026-01', '2026-02']);
});
