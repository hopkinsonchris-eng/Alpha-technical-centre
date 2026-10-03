// Wave 5, PR 1 (docs/vault-hub/wave5/05-markup.md §1.1, W5-AC1): originals live in Supabase Storage,
// reached with plain fetch and the service key; the store is shared by the API and every cron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStorage, supabaseStorage, originalKey } from '../src/storage.ts';

/** An in-memory Supabase Storage: the object routes, the service-key check and the not-found shape the real one answers. */
function fakeSupabase(url = 'https://abc.supabase.co', key = 'service-key') {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  const notFound = () => new Response(JSON.stringify({ statusCode: '404', error: 'Not found', message: 'The resource was not found', code: 'NoSuchKey' }), { status: 400, headers: { 'cache-control': 'no-store', 'content-type': 'application/json' } });
  const f = (async (input: any, init: RequestInit = {}) => {
    const u = String(input); const h: Record<string, string> = {};
    new Headers(init.headers as any).forEach((v, k) => { h[k] = v; });
    calls.push({ method: init.method ?? 'GET', url: u, headers: h });
    if (!u.startsWith(url + '/storage/v1/object/')) return new Response('no route', { status: 404 });
    if (h.authorization !== `Bearer ${key}`) return new Response(JSON.stringify({ statusCode: '401', error: 'Unauthorized', message: 'invalid JWT', code: 'Unauthorized' }), { status: 400 });
    const rest = u.slice((url + '/storage/v1/object/').length);
    const info = rest.startsWith('info/');
    const path = decodeURIComponent(info ? rest.slice(5) : rest);
    if ((init.method ?? 'GET') === 'POST') {
      const body = new Uint8Array(await new Response(init.body as any).arrayBuffer());
      if (objects.has(path) && h['x-upsert'] !== 'true') return new Response(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists', code: 'KeyAlreadyExists' }), { status: 400 });
      objects.set(path, { bytes: body, mime: h['content-type'] });
      return Response.json({ Key: path, Id: 'x' });
    }
    const o = objects.get(path);
    if (!o) return notFound();
    if (info) return Response.json({ name: path, size: o.bytes.length, contentType: o.mime });
    return new Response(o.bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': o.mime } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls, objects };
}

test('W5-AC1: put, get and exists go to the bucket with the service key; a missing key is null and false; errors are named', async () => {
  const fx = fakeSupabase();
  const s = supabaseStorage({ url: 'https://abc.supabase.co/', serviceKey: 'service-key', bucket: 'vault', fetch: fx.fetch });
  const key = originalKey('ab'.repeat(32));
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await s.put(key, bytes, 'application/pdf');
  const put = fx.calls[0];
  assert.equal(put.method, 'POST'); assert.equal(put.url, 'https://abc.supabase.co/storage/v1/object/vault/' + key);
  assert.equal(put.headers['x-upsert'], 'true'); assert.equal(put.headers['content-type'], 'application/pdf'); assert.equal(put.headers.apikey, 'service-key');
  await s.put(key, bytes, 'application/pdf');                                   // idempotent: the same key again replaces
  assert.deepEqual(await s.get(key), bytes);
  assert.equal(await s.exists(key), true);
  assert.equal(await s.get('originals/zz/missing'), null);
  assert.equal(await s.exists('originals/zz/missing'), false);
  assert.equal(fx.objects.size, 1);
  const wrongKey = supabaseStorage({ url: 'https://abc.supabase.co', serviceKey: 'nope', fetch: fx.fetch });
  await assert.rejects(() => wrongKey.get(key), /supabase storage get .*401|Unauthorized/);
  await assert.rejects(() => s.put('../escape', bytes, 'text/plain'), /invalid storage key/);
});

test('W5-AC1: openStorage picks the backend from the environment and refuses a container disk in production', () => {
  const fx = fakeSupabase();
  const env = { VAULT_STORAGE: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_KEY: 'service-key', VAULT_STORAGE_BUCKET: 'vault' } as NodeJS.ProcessEnv;
  assert.ok(openStorage(env, { fetch: fx.fetch }));
  assert.throws(() => openStorage({ VAULT_STORAGE: 'supabase' } as NodeJS.ProcessEnv), /SUPABASE_URL and SUPABASE_SERVICE_KEY/);
  assert.throws(() => openStorage({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), /loses every original/);
  assert.ok(openStorage({ NODE_ENV: 'production', VAULT_STORAGE_DIR: '/var/data/vault' } as NodeJS.ProcessEnv), 'a persistent disk named on purpose is allowed');
  assert.ok(openStorage({} as NodeJS.ProcessEnv), 'development and tests default to the filesystem');
});
