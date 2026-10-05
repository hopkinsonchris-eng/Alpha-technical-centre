// Wave 6 (W6-AC1): a refresh token is sealed before it is stored and cannot be read without the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openSecret, sealSecret, tokenKeyFromEnv } from '../src/secrets.ts';

test('seal and open round-trip; a different key or a tampered ciphertext is refused', () => {
  const key = randomBytes(32), other = randomBytes(32);
  const sealed = sealSecret('1000.abc.def', key);
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(sealSecret('1000.abc.def', key), sealed, 'a fresh iv every time');
  assert.equal(openSecret(sealed, key), '1000.abc.def');
  assert.throws(() => openSecret(sealed, other), /cannot be opened/);
  const [v, iv, ct, tag] = sealed.split('.');
  assert.throws(() => openSecret([v, iv, ct.slice(0, -2) + 'AA', tag].join('.'), key), /cannot be opened/);
  assert.throws(() => openSecret('plain', key), /unknown shape/);
});

test('the key comes from VAULT_TOKEN_KEY as base64 or hex, or is derived from any secret of 32 characters or more; shorter is refused', () => {
  const key = randomBytes(32);
  assert.deepEqual(tokenKeyFromEnv({ VAULT_TOKEN_KEY: key.toString('base64') }), key);
  assert.deepEqual(tokenKeyFromEnv({ VAULT_TOKEN_KEY: key.toString('hex') }), key);
  assert.equal(tokenKeyFromEnv({}), null);
  const generated = 'Ab3dEf7hIj9kLm1nOp3qRs5tUv7wXy9zAb3dEf7h';          // the shape Render's Generate button produces
  const derived = tokenKeyFromEnv({ VAULT_TOKEN_KEY: generated })!;
  assert.equal(derived.length, 32);
  assert.deepEqual(tokenKeyFromEnv({ VAULT_TOKEN_KEY: generated }), derived, 'the same secret always gives the same key');
  assert.equal(openSecret(sealSecret('rt-1', derived), derived), 'rt-1');
  assert.throws(() => tokenKeyFromEnv({ VAULT_TOKEN_KEY: 'short' }), /at least 32 characters/);
});
