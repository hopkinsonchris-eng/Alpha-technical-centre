// Wave 3, PR 3 (docs/vault-hub/wave3/05-markup.md §1.5): the World Monitor adapter. Server-side
// only, cached an hour, a 429 honoured for its Retry-After and never retried in a loop, 401/403
// reported as not connected. Smoke tests for W3-AC9 (adapter part) and W3-AC10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acledEvents, configureWorldMonitor, countryRisk, headlines, resetWorldMonitorCache, worldMonitorConfigured, NOT_CONNECTED } from '../src/intel/worldmonitor.ts';

const KEY = 'wm_' + 'a'.repeat(40);
let t = Date.parse('2026-10-01T09:00:00Z');
const now = () => new Date(t);
const calls: { url: string; key: string | null }[] = [];
const RISK = { cii: { combinedScore: 71.4, advisoryLevel: 'reconsider travel', components: { conflict: 80, governance: 60 }, computedAt: '2026-10-01T08:00:00Z' } };
const EVENTS = { events: [{ event_id_cnty: 'VEN12345', event_type: 'Protests', sub_event_type: 'Peaceful protest', admin1: 'Apure', location: 'Guasdualito', actor1: 'Protesters (Venezuela)', fatalities: 0, event_date: '2026-09-28', notes: 'Residents protested fuel shortages.' }] };
const NEWS = { headlines: [{ title: 'PDVSA restarts Apure field', source: { name: 'Reuters' }, url: 'https://example.com/a', published_at: '2026-09-30T10:00:00Z' }] };
let mode: 'ok' | '429' | '401' | '500' = 'ok';
const fakeFetch = (async (url: string, init: any) => {
  calls.push({ url, key: init?.headers?.['X-WorldMonitor-Key'] ?? null });
  if (mode === '429') return new Response('{"error":"rate limited"}', { status: 429, headers: { 'retry-after': '120' } });
  if (mode === '401') return new Response('{"error":"unauthorized"}', { status: 401 });
  if (mode === '500') return new Response('boom', { status: 500 });
  const u = new URL(url);
  const body = u.pathname.includes('get-country-risk') ? RISK : u.pathname.includes('list-acled-events') ? EVENTS : NEWS;
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

test('without a key every reader says not connected and nothing is fetched', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: null, now });
  assert.equal(worldMonitorConfigured(), false);
  const r = await countryRisk('VE');
  assert.deepEqual(r, { ok: false, reason: NOT_CONNECTED });
  assert.equal(calls.length, 0);
});

test('W3-AC9: with a key the risk, events and headlines are read with the key in the header, parsed, and cached for an hour per country', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  calls.length = 0;
  const r = await countryRisk('VE');
  assert.ok(r.ok);
  assert.deepEqual(r.data, { score: 71.4, level: 'reconsider travel', components: { conflict: 80, governance: 60 }, computed_at: '2026-10-01T08:00:00Z' });
  assert.equal(r.fetched_at, '2026-10-01T09:00:00.000Z');
  assert.equal(r.cached, false);
  assert.equal(calls[0].key, KEY);
  assert.match(calls[0].url, /^https:\/\/api\.worldmonitor\.app\/api\/intelligence\/v1\/get-country-risk\?country_code=VE$/);
  const e = await acledEvents('VE');
  assert.ok(e.ok);
  assert.equal(e.data.length, 1);
  assert.deepEqual(e.data[0], { id: 'VEN12345', type: 'Protests', sub_type: 'Peaceful protest', admin1: 'Apure', location: 'Guasdualito', actors: 'Protesters (Venezuela)', fatalities: 0, date: '2026-09-28', notes: 'Residents protested fuel shortages.' });
  assert.match(calls[1].url, /list-acled-events\?country=VE&start=\d+$/);
  const h = await headlines('VE');
  assert.ok(h.ok);
  assert.deepEqual(h.data, [{ n: 1, title: 'PDVSA restarts Apure field', source: 'Reuters', url: 'https://example.com/a', published_at: '2026-09-30T10:00:00Z' }]);
  // Cached: no second call within the hour, a different country is its own call, and the hour expires.
  const again = await countryRisk('VE');
  assert.ok(again.ok && again.cached);
  assert.equal(calls.length, 3);
  await countryRisk('KZ');
  assert.equal(calls.length, 4);
  t += 3_600_001;
  const fresh = await countryRisk('VE');
  assert.ok(fresh.ok && !fresh.cached);
  assert.equal(calls.length, 5);
});

test('W3-AC9: a 429 is honoured for its Retry-After and reported, never retried in a loop; 401 is "not connected" with the reason; a 500 is reported', async () => {
  configureWorldMonitor({ fetch: fakeFetch, apiKey: KEY, now });
  calls.length = 0; mode = '429';
  const r = await countryRisk('VE');
  assert.ok(!r.ok);
  assert.match(r.reason, /rate limited by World Monitor; retry after 120 s/);
  assert.equal(r.retry_after_s, 120);
  const e = await acledEvents('VE');
  assert.ok(!e.ok && /rate limited/.test(e.reason));
  assert.equal(calls.length, 1, 'no further call while the limit holds');
  t += 121_000; mode = 'ok';
  resetWorldMonitorCache();
  const ok = await countryRisk('VE');
  assert.ok(ok.ok);
  mode = '401'; resetWorldMonitorCache();
  const no = await countryRisk('KZ');
  assert.ok(!no.ok);
  assert.match(no.reason, /not connected: World Monitor answered HTTP 401/);
  mode = '500'; resetWorldMonitorCache();
  const bad = await headlines('KZ');
  assert.ok(!bad.ok && /HTTP 500/.test(bad.reason));
  mode = 'ok';
});
