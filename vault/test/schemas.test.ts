import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaNames, validate, type SchemaName } from '../src/schemas.ts';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('seven schemas are present', () => {
  assert.deepEqual(schemaNames(), ['analogue-row', 'dispatch', 'legal-tag', 'lesson', 'run-record', 'tool-manifest', 'vault-item']);
});

for (const name of schemaNames()) {
  test(`${name}: every fixture validates or fails exactly as labelled`, () => {
    const dir = path.join(FIX, name);
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.ok(files.filter(f => f.startsWith('valid-')).length >= 3, 'at least 3 valid fixtures');
    assert.ok(files.filter(f => f.startsWith('invalid-')).length >= 3, 'at least 3 invalid fixtures');
    for (const f of files) {
      const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      const errs = validate(name as SchemaName, data);
      if (f.startsWith('valid-')) assert.deepEqual(errs, [], `${name}/${f} should be valid`);
      else assert.ok(errs.length > 0, `${name}/${f} should be invalid`);
    }
  });
}

test('AC15 seed validates against its schemas', () => {
  const seed = JSON.parse(readFileSync(path.join(FIX, 'ac15', 'seed.json'), 'utf8'));
  assert.deepEqual(validate('legal-tag', seed.legal_tag), []);
  assert.deepEqual(validate('vault-item', seed.nda_item), []);
  for (const it of seed.items) assert.deepEqual(validate('vault-item', it), []);
  for (const d of seed.dispatches) assert.deepEqual(validate('dispatch', d), []);
  assert.equal(seed.dispatches.length, 6);
});

test('validation errors carry the JSON path', () => {
  const errs = validate('run-record', { id: 'not-a-uuid' });
  assert.ok(errs.some(e => e.path === '/id'));
  assert.ok(errs.some(e => /required/.test(e.message)));
});
