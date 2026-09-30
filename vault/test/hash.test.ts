import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, runInputHash } from '../src/hash.ts';

test('server hash equals the browser client hash for the same objects', async () => {
  // Shims so the browser module can load in Node without a DOM.
  (globalThis as any).localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
  (globalThis as any).document ??= { addEventListener() {}, visibilityState: 'visible' };
  const { vault } = await import('../../js/vault-client.js' as any);
  const cases = [
    { b: 1, a: [2, 1.0, { z: 'x', y: null }] },
    { inputs: [{ ref: 'tool:x', kind: 'manual' }], params: { k: 150, h: 45.0, nested: { list: [3, 2, 1] } }, assumptions: {} },
    { s: 'áé"\\', t: true, f: false, n: -0, u: undefined, fn: () => 1 },
    { d: new Date('2026-09-29T00:00:00Z') },
  ];
  for (const c of cases) assert.equal(canonicalHash(c), await vault.canonicalHash(c), JSON.stringify(c));
  assert.throws(() => canonicalHash({ x: NaN }), /cannot be hashed/);
  await assert.rejects(vault.canonicalHash({ x: NaN }));
});

test('runInputHash ignores outputs and key order', () => {
  const a = runInputHash({ inputs: [], params: { b: 1, a: 2 }, assumptions: undefined });
  const b = runInputHash({ inputs: [], params: { a: 2, b: 1 }, assumptions: {} });
  assert.equal(a, b);
});
