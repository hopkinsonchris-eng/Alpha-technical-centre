/**
 * Secrets at rest (wave 6, W6-AC1): a person's Zoho refresh token is sealed with AES-256-GCM under VAULT_TOKEN_KEY
 * before it is written, so a database copy alone cannot read anyone's mailbox. The key is 32 bytes, given as
 * base64 or hex; the sealed form is `v1.<iv>.<ciphertext>.<tag>` in base64url. A missing key is a configuration
 * error reported where the token would be stored, never a silent fallback to plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const b64url = (b: Buffer) => b.toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

export function tokenKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.VAULT_TOKEN_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('VAULT_TOKEN_KEY must be 32 bytes (base64 or hex)');
  return key;
}

export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${b64url(iv)}.${b64url(ct)}.${b64url(cipher.getAuthTag())}`;
}

export function openSecret(sealed: string, key: Buffer): string {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('sealed secret has an unknown shape');
  const d = createDecipheriv('aes-256-gcm', key, fromB64url(iv));
  d.setAuthTag(fromB64url(tag));
  try { return Buffer.concat([d.update(fromB64url(ct)), d.final()]).toString('utf8'); }
  catch { throw new Error('sealed secret cannot be opened with this key'); }
}
