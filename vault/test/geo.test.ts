// Wave 3 PR 4: which country a point falls in, from the same polygons the globe draws, and the
// location check that flags a field sitting outside its project's country.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryOfPoint, geoAvailable, locationCheck } from '../src/assets/geo.ts';

test('countryOfPoint reads the committed polygons: inland points resolve, the open sea does not', () => {
  assert.equal(geoAvailable(), true);
  assert.equal(countryOfPoint(7.98, -69.12), 'VE', 'Guafita, Apure');
  assert.equal(countryOfPoint(35.85, -119.52), 'US', 'Trico gas field, Kern County, California');
  assert.equal(countryOfPoint(4.6, -74.1), 'CO', 'Bogotá');
  assert.equal(countryOfPoint(48.0, 67.3), 'KZ');
  assert.equal(countryOfPoint(30.0, 31.2), 'EG', 'Cairo');
  assert.equal(countryOfPoint(0, -30), null, 'mid-Atlantic');
  assert.equal(countryOfPoint(NaN, 1), null);
});

test('locationCheck: the polygon decides when there are coordinates, the gazetteer code otherwise, and a coastal miss is not evidence', () => {
  assert.deepEqual(locationCheck('VE', { lat: 35.85, lon: -119.52, country: 'VE' }), { expected: 'VE', found: 'US', method: 'polygon', outside: true });
  assert.deepEqual(locationCheck('VE', { lat: 7.98, lon: -69.12, country: null }), { expected: 'VE', found: 'VE', method: 'polygon', outside: false });
  assert.deepEqual(locationCheck('VE', { lat: 0, lon: -30, country: 'US' }), { expected: 'VE', found: null, method: 'polygon', outside: false });
  assert.deepEqual(locationCheck('VE', { lat: null, lon: null, country: 'US' }), { expected: 'VE', found: 'US', method: 'gazetteer', outside: true });
  assert.deepEqual(locationCheck('VE', { lat: null, lon: null, country: 'VE' }), { expected: 'VE', found: 'VE', method: 'gazetteer', outside: false });
  assert.deepEqual(locationCheck('VE', { lat: null, lon: null, country: null }), { expected: 'VE', found: null, method: 'none', outside: false });
  assert.equal(locationCheck(null, { lat: 1, lon: 1, country: 'US' }), null, 'a project without a country has nothing to check against');
});
