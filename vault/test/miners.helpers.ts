/** Shared helpers for the M11 miner tests: mock clock, routed fake fetch, fixtures, zip writer, database. Not a test file. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';
import type { Clock } from '../src/miners/util.ts';

export const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'miners');
export const fx = (name: string) => readFileSync(path.join(FIX, name), 'utf8');
export const fxJson = (name: string) => JSON.parse(fx(name));
export const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

export interface MockClock extends Clock { t: number; sleeps: number[] }
/** Time only moves when something sleeps, so the spacing of requests is exactly what the rate limiter enforced. */
export function mockClock(start = Date.UTC(2026, 8, 29)): MockClock {
  const c: MockClock = { t: start, sleeps: [], now: () => c.t, sleep: async (ms) => { c.sleeps.push(ms); c.t += ms; } };
  return c;
}

export type Route = [RegExp, (url: string, init: RequestInit | undefined) => Response | object | string | Buffer];
export interface Call { url: string; init?: RequestInit; at: number }
const asResponse = (x: Response | object | string | Buffer): Response =>
  x instanceof Response ? x : Buffer.isBuffer(x) ? new Response(new Uint8Array(x), { status: 200 }) : typeof x === 'string' ? new Response(x, { status: 200 }) : Response.json(x);
export const text = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });

/** A fetch that answers from recorded fixtures by URL pattern and records every call with the mock time. Unmatched URLs fail the test. */
export function fakeFetch(routes: Route[], clock: Clock) {
  const calls: Call[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init, at: clock.now() });
    for (const [re, h] of routes) if (re.test(url)) return asResponse(h(url, init));
    throw new Error(`no recorded response for ${url}`);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> { const out: T[] = []; for await (const x of it) out.push(x); return out; }

/** Every consecutive pair of requests is at least 1000/perSecond ms apart, and time really had to advance. */
export function assertRateLimited(calls: Call[], perSecond: number, clock: MockClock) {
  assert.ok(calls.length >= 3, `need at least 3 requests to see spacing, got ${calls.length}`);
  const gap = 1000 / perSecond;
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].at - calls[i - 1].at >= gap - 1, `requests ${i - 1} and ${i} were ${calls[i].at - calls[i - 1].at} ms apart, need >= ${gap}`);
  assert.ok(clock.sleeps.length >= calls.length - 1, 'the limiter slept between requests');
}

/** Minimal zip writer (deflate) for building ANP-style archives in tests. */
export function buildZip(entries: { name: string; data: Buffer | string }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data), comp = deflateRawSync(data), name = Buffer.from(e.name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export const tmpDir = (p = 'miners-') => mkdtempSync(path.join(os.tmpdir(), p));

/** A migrated, seeded in-memory database and a throwaway storage directory. */
export async function testDb() {
  const { openDb } = await import('../src/db/client.ts');
  const { migrate } = await import('../src/db/migrate.ts');
  const { seedMaster } = await import('../src/db/seed.ts');
  const { filesystemStorage } = await import('../src/storage.ts');
  const db = await openDb(undefined);
  await migrate(db);
  await seedMaster(db);
  return { db, storage: filesystemStorage(tmpDir('miners-store-')) };
}
