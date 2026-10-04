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

test('the key comes from VAULT_TOKEN_KEY as base64 or hex and must be 32 bytes', () => {
  const key = randomBytes(32);
  assert.deepEqual(tokenKeyFromEnv({ VAULT_TOKEN_KEY: key.toString('base64') }), key);
  assert.deepEqual(tokenKeyFromEnv({ VAULT_TOKEN_KEY: key.toString('hex') }), key);
  assert.equal(tokenKeyFromEnv({}), null);
  assert.throws(() => tokenKeyFromEnv({ VAULT_TOKEN_KEY: 'short' }), /32 bytes/);
});
