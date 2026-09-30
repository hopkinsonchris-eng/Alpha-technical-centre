import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pgPoolConfig } from '../src/db/client.ts';

const SUPABASE = 'postgresql://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';

test('sslmode=require on a hosted database encrypts without a CA and says so', () => {
  const cfg = pgPoolConfig(`${SUPABASE}?sslmode=require`, {});
  assert.equal(cfg.connectionString, SUPABASE, 'sslmode is stripped so the driver does not force verify-full');
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
  assert.match(cfg.warning ?? '', /DATABASE_SSL_CA/);
});

test('a hosted database with no sslmode is still encrypted', () => {
  const cfg = pgPoolConfig(SUPABASE, {});
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
});

test('DATABASE_SSL_CA as inline PEM verifies the server certificate', () => {
  const cfg = pgPoolConfig(`${SUPABASE}?sslmode=require`, { DATABASE_SSL_CA: PEM });
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true, ca: PEM });
  assert.equal(cfg.warning, undefined);
});

test('DATABASE_SSL_CA as a file path reads the PEM from disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atc-ca-'));
  const file = join(dir, 'ca.crt');
  writeFileSync(file, PEM);
  const cfg = pgPoolConfig(SUPABASE, { DATABASE_SSL_CA: file });
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true, ca: PEM });
});

test('sslmode=disable and localhost do not use TLS', () => {
  assert.equal(pgPoolConfig(`${SUPABASE}?sslmode=disable`, {}).ssl, false);
  assert.equal(pgPoolConfig('postgresql://u:p@localhost:5432/atc', {}).ssl, false);
  assert.equal(pgPoolConfig('postgresql://u:p@127.0.0.1:5432/atc', {}).ssl, false);
});

test('other query parameters survive the sslmode strip', () => {
  const cfg = pgPoolConfig(`${SUPABASE}?sslmode=require&application_name=atc&options=-c%20search_path%3Dpublic`, {});
  assert.equal(cfg.connectionString, `${SUPABASE}?application_name=atc&options=-c%20search_path%3Dpublic`);
});
