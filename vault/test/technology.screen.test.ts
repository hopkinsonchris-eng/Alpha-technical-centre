import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNumeric, deriveConditions, mergeConditions, screen } from '../src/technology/screen.ts';
import { Conditions, EntryBody } from '../src/technology/model.ts';

test('numeric screening: fail, marginal, pass, unknown (AC5)', () => {
  const lim = { max: 2000 };
  assert.equal(checkNumeric('depth_m', 3000, lim).result, 'fail');
  assert.equal(checkNumeric('depth_m', 2150, lim).result, 'marginal');
  assert.equal(checkNumeric('depth_m', 1500, lim).result, 'pass');
  assert.equal(checkNumeric('depth_m', undefined, lim).result, 'unknown');
  assert.equal(checkNumeric('api', 9, { min: 10 }).result, 'marginal');
  assert.equal(checkNumeric('api', 8, { min: 10 }).result, 'fail');
  assert.equal(checkNumeric('api', 30, { min: 10, max: 45 }).result, 'pass');
  assert.match(checkNumeric('depth_m', 3000, lim).why, /exceeds the 2,000 maximum/);
});

test('project fit: 1 on any fail; else 5 − 1 per marginal − 0.25 per unknown, floor 2 (AC5)', () => {
  const s = { depth_m: { max: 2000 }, api: { min: 10 }, water_cut: { max: 0.95 }, environment: ['onshore', 'shallow-water'] as any, sand: 'moderate' as const, needs_power: true };
  assert.equal(screen(s, { depth_m: 1500, api: 30, water_cut: 0.9, environment: 'shallow-water', sand: 'low', power_reliable: true }).fit, 5);
  const r = screen(s, { depth_m: 2150, api: 30, environment: 'shallow-water', sand: 'low', power_reliable: false });
  assert.equal(r.verdict, 'marginal');
  assert.deepEqual(r.counts, { pass: 3, marginal: 2, fail: 0, unknown: 1 });
  assert.equal(r.fit, 2.75);
  assert.equal(screen(s, { depth_m: 1500, environment: 'subsea' }).verdict, 'fail');
  assert.equal(screen(s, { depth_m: 1500, environment: 'subsea' }).fit, 1);
  assert.equal(screen(s, { sand: 'high' }).checks.find(c => c.key === 'sand')!.result, 'marginal', 'one level over a moderate tolerance');
  assert.equal(screen({ sand: 'low' }, { sand: 'moderate' }).checks[0].result, 'marginal');
  assert.equal(screen({ sand: 'low' }, { sand: 'high' }).checks[0].result, 'fail', 'two levels over');
  const blank = screen(s, {});
  assert.equal(blank.verdict, 'unscreened'); assert.equal(blank.fit, 3.5, 'six unknowns: 5 − 6 × 0.25');
  assert.equal(screen({ depth_m: { max: 1 }, api: { max: 1 }, water_cut: { max: 1 }, gor_scf_bbl: { max: 1 } }, { depth_m: 1.05, api: 1.05, water_cut: 1.05, gor_scf_bbl: 1.05 }).fit, 2, 'four marginals floor at 2');
});

test('an entry without screening limits is unscreened and keeps a neutral fit', () => {
  const r = screen({}, { depth_m: 1000 });
  assert.equal(r.verdict, 'unscreened'); assert.equal(r.checks.length, 0); assert.equal(r.fit, 3);
});

test('conditions derive from figures with unit conversion; stored wins key by key (AC6)', () => {
  const figs = [
    { name: 'Reservoir depth (TVD)', value: 7000, unit: 'ft', as_of: '2026-10-01', source_ref: 'run:a' },
    { name: 'Oil gravity', value: 24, unit: '°API', as_of: '2026-10-01', source_ref: 'doc:b' },
    { name: 'Water cut', value: 85, unit: '%', as_of: '2026-09-01', source_ref: 'run:c' },
    { name: 'Water cut', value: 88, unit: '%', as_of: '2026-10-15', source_ref: 'run:d' },
    { name: 'Bottomhole temperature', value: 212, unit: 'degF', as_of: '2026-10-01' },
    { name: 'GOR', value: 100, unit: 'm3/m3' },
    { name: 'Average viscosity', value: 3, unit: 'furlongs' },
    { name: 'Old depth', value: 1, unit: 'm', stale: true },
  ];
  const d = deriveConditions(figs);
  assert.equal(d.depth_m.value, 2133.6); assert.equal(d.depth_m.from, 'figure'); assert.equal(d.depth_m.ref, 'run:a');
  assert.equal(d.api.value, 24);
  assert.equal(d.water_cut.value, 0.88, 'the newest figure wins'); assert.equal(d.water_cut.ref, 'run:d');
  assert.equal(d.temperature_c.value, 100);
  assert.equal(d.gor_scf_bbl.value, 561.46);
  assert.equal(d.viscosity_cp, undefined, 'a unit the rules do not understand is skipped');
  const m = mergeConditions({ depth_m: 1800, environment: 'shallow-water' }, d, { set_at: '2026-11-05T00:00:00Z' });
  assert.equal(m.conditions.depth_m, 1800); assert.equal(m.sources.depth_m.from, 'stored');
  assert.equal(m.conditions.api, 24); assert.equal(m.sources.api.from, 'figure');
  assert.equal(m.conditions.environment, 'shallow-water');
});

test('the entry and conditions models reject unknown keys and bad ranges', () => {
  const ok = { application: 'artificial-lift', name: 'Plunger lift', summary: 'A free piston lifts liquid slugs.', readiness: 4, evidence: [{ claim: 'x', tier: 'E2', source: 'https://example.org/a' }], scores: { capex: 5, opex: 5, benefit: 2, evidence: 4 } };
  assert.equal(EntryBody.safeParse(ok).success, true);
  assert.equal(EntryBody.safeParse({ ...ok, colour: 'red' }).success, false);
  assert.equal(EntryBody.safeParse({ ...ok, screening: { depth_m: { min: 5, max: 1 } } }).success, false);
  assert.equal(EntryBody.safeParse({ ...ok, screening: { depth_m: {} } }).success, false);
  assert.equal(EntryBody.safeParse({ ...ok, evidence: [{ claim: 'x', tier: 'E5', source: 'https://e.org' }] }).success, false, 'E5 is never citable');
  assert.equal(EntryBody.safeParse({ ...ok, evidence: [{ claim: 'x', tier: 'E1', source: 'file:///etc/passwd' }] }).success, false);
  assert.equal(Conditions.safeParse({ depth_m: 'deep' }).success, false);
  assert.equal(Conditions.safeParse({ environment: 'moon' }).success, false);
});
