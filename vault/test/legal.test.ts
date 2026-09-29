import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { unionTags, isVisible, parseScope, type LegalTag } from '../src/legal.ts';

const NOW = new Date('2026-09-29T12:00:00Z');

const arbTag: fc.Arbitrary<LegalTag> = fc.record({
  id: fc.constantFrom('lt-a', 'lt-b', 'lt-c', 'lt-d'),
  classification: fc.constantFrom('public', 'firm', 'client-nda'),
  data_type: fc.constantFrom('public', 'first-party', 'second-party', 'third-party', 'transferred'),
  client_id: fc.option(fc.constantFrom('frontera', 'orinoco'), { nil: null }),
  contract_id: fc.option(fc.constantFrom('nda-1', 'nda-2'), { nil: null }),
  originator: fc.constantFrom('ATC', 'Frontera', 'ANH'),
  expires_at: fc.option(fc.constantFrom('2025-01-01', '2026-09-28', '2026-09-29', '2030-12-31'), { nil: null }),
  personal_data: fc.boolean(),
  export_restricted: fc.boolean(),
  partners_only: fc.boolean(),
}).map(t => (t.classification === 'client-nda' && !t.client_id ? { ...t, client_id: 'frontera' } : t));

const strip = (t: LegalTag) => { const { id, notes, ...rest } = t; return rest; };

test('unionTags is commutative and idempotent', () => {
  fc.assert(fc.property(fc.array(arbTag, { minLength: 1, maxLength: 4 }), (tags) => {
    const a = unionTags(tags);
    const b = unionTags([...tags].reverse());
    assert.deepEqual(strip(a), strip(b));
    const twice = unionTags([a, a]);
    assert.deepEqual(strip(twice), strip(a));
  }));
});

test('any client-nda parent makes the union client-nda; expiry is the minimum', () => {
  fc.assert(fc.property(fc.array(arbTag, { minLength: 1, maxLength: 4 }), (tags) => {
    const u = unionTags(tags);
    if (tags.some(t => t.classification === 'client-nda')) assert.equal(u.classification, 'client-nda');
    const dates = tags.map(t => t.expires_at).filter((d): d is string => !!d).sort();
    assert.equal(u.expires_at ?? null, dates[0] ?? null);
    if (tags.some(t => t.partners_only)) assert.equal(u.partners_only, true);
  }));
});

test('two clients in one union is a conflict tag visible in neither client scope', () => {
  const a: LegalTag = { id: 'lt-frontera-nda', classification: 'client-nda', data_type: 'second-party', client_id: 'frontera', originator: 'Frontera' };
  const b: LegalTag = { id: 'lt-orinoco-nda', classification: 'client-nda', data_type: 'second-party', client_id: 'orinoco', originator: 'Orinoco' };
  const u = unionTags([a, b]);
  assert.equal(u.classification, 'client-nda');
  assert.match(u.notes ?? '', /conflict/);
  assert.equal(isVisible(u, { include_firm: true, include_public: true, client_id: 'frontera' }, NOW), false);
  assert.equal(isVisible(u, { include_firm: true, include_public: true, client_id: 'orinoco' }, NOW), false);
});

test('expired tags are never visible; client B is never visible in client A scope', () => {
  fc.assert(fc.property(arbTag, (t) => {
    const expired = { ...t, expires_at: '2020-01-01' };
    for (const scope of [
      { include_firm: true, include_public: true, is_partner: true },
      { include_firm: true, include_public: true, client_id: 'frontera', is_partner: true },
      { include_firm: false, include_public: true, is_partner: true },
    ]) assert.equal(isVisible(expired, scope, NOW), false);
    const b = { ...t, classification: 'client-nda' as const, client_id: 'orinoco', expires_at: null };
    assert.equal(isVisible(b, { include_firm: true, include_public: true, client_id: 'frontera', is_partner: true }, NOW), false);
  }));
});

test('visibility matrix for a client scope', () => {
  const scope = { include_firm: true, include_public: true, client_id: 'frontera', is_partner: false };
  const base = { data_type: 'first-party' as const, originator: 'ATC' };
  assert.equal(isVisible({ id: 'lt-p', classification: 'public', ...base }, scope, NOW), true);
  assert.equal(isVisible({ id: 'lt-f', classification: 'firm', ...base }, scope, NOW), true);
  assert.equal(isVisible({ id: 'lt-c', classification: 'client-nda', client_id: 'frontera', ...base }, scope, NOW), true);
  assert.equal(isVisible({ id: 'lt-c2', classification: 'client-nda', client_id: 'orinoco', ...base }, scope, NOW), false);
  assert.equal(isVisible({ id: 'lt-po', classification: 'firm', partners_only: true, ...base }, scope, NOW), false);
  assert.equal(isVisible({ id: 'lt-po', classification: 'firm', partners_only: true, ...base }, { ...scope, is_partner: true }, NOW), true);
  assert.equal(isVisible({ id: 'lt-today', classification: 'firm', expires_at: '2026-09-29', ...base }, scope, NOW), true, 'expires today is still visible today');
  assert.equal(isVisible({ id: 'lt-yday', classification: 'firm', expires_at: '2026-09-28', ...base }, scope, NOW), false);
});

test('parseScope grammar', () => {
  const resolve = (p: string) => (p === 'llanos-screen' ? 'frontera' : undefined);
  assert.deepEqual(parseScope('public', resolve), { include_public: true, include_firm: false });
  assert.deepEqual(parseScope('firm', resolve), { include_public: true, include_firm: true });
  assert.equal(parseScope('client:frontera', resolve).client_id, 'frontera');
  assert.equal(parseScope('project:llanos-screen', resolve).client_id, 'frontera');
  assert.throws(() => parseScope('project', resolve));
  assert.throws(() => parseScope('galaxy:1', resolve));
});
