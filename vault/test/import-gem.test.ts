// Wave 3, PR 1 (docs/vault-hub/wave3/05-markup.md §1.6): the Global Energy Monitor tracker
// workbook, downloaded by hand, becomes vault/master/gem-fields.json and seeds assets.
// W3-AC11. A three-row workbook is built here with the real column names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { importGem, gemToAsset } from '../scripts/import-gem.ts';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';

const ROWS = [
  { 'Unit ID': 'G100', 'Unit name': 'Guafita', 'Unit type': 'field', 'Country/Area': 'Venezuela', 'Latitude': 7.6, 'Longitude': -70.9, 'Location accuracy': 'exact', 'Status': 'operating', 'Fuel type': 'oil', 'Onshore/Offshore': 'onshore', 'Operator': 'PDVSA', 'Owner': 'PDVSA [100%]', 'Discovery year': 1984, 'FID year': '', 'Production start year': 1986, 'Production (oil, thousand bbl/d)': 12.4, 'Production year': 2024, 'Reserves (oil, million bbl)': 300, 'Wiki URL': 'https://www.gem.wiki/Guafita_Oil_Field' },
  { 'Unit ID': 'G200', 'Unit name': 'Rubiales', 'Unit type': 'field', 'Country/Area': 'Colombia', 'Latitude': 3.85, 'Longitude': -71.3, 'Location accuracy': 'approximate', 'Status': 'operating', 'Fuel type': 'oil', 'Onshore/Offshore': 'onshore', 'Operator': 'Ecopetrol', 'Owner': 'Ecopetrol [100%]', 'Discovery year': 1981, 'FID year': '', 'Production start year': 1988, 'Production (oil, thousand bbl/d)': 110, 'Production year': 2024, 'Reserves (oil, million bbl)': '', 'Wiki URL': 'https://www.gem.wiki/Rubiales_Oil_Field' },
  { 'Unit ID': 'G300', 'Unit name': 'Unplaced Prospect', 'Unit type': 'project', 'Country/Area': 'Unknown Land', 'Latitude': '', 'Longitude': '', 'Location accuracy': '', 'Status': 'proposed', 'Fuel type': 'gas', 'Onshore/Offshore': 'offshore', 'Operator': '', 'Owner': '', 'Discovery year': '', 'FID year': '', 'Production start year': '', 'Production (oil, thousand bbl/d)': '', 'Production year': '', 'Reserves (oil, million bbl)': '', 'Wiki URL': '' },
];

function workbook(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gem-'));
  const file = path.join(dir, 'GOGET.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['About'], ['Global Oil and Gas Extraction Tracker, March 2026 release']]), 'About');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ROWS), 'Main data');
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return file;
}

test('W3-AC11: the workbook becomes pruned field records with ISO country codes, coordinates, facts and the wiki page; unknown countries are reported', async () => {
  const out = importGem(workbook(), { release: 'March 2026' });
  assert.equal(out.units.length, 2);
  assert.deepEqual(out.skipped, [{ unit_id: 'G300', name: 'Unplaced Prospect', reason: 'country "Unknown Land" not recognised' }]);
  const g = out.units[0];
  assert.equal(g.unit_id, 'G100'); assert.equal(g.name, 'Guafita'); assert.equal(g.country, 'VE');
  assert.equal(g.lat, 7.6); assert.equal(g.lon, -70.9); assert.equal(g.accuracy, 'exact');
  assert.equal(g.status, 'operating'); assert.equal(g.operator, 'PDVSA'); assert.equal(g.owners, 'PDVSA [100%]');
  assert.equal(g.discovery_year, 1984); assert.equal(g.production_start_year, 1986); assert.equal(g.fid_year, null);
  assert.deepEqual(g.production, { value: 12.4, unit: 'oil, thousand bbl/d', year: 2024 });
  assert.deepEqual(g.reserves, { value: 300, unit: 'oil, million bbl' });
  assert.equal(g.wiki_url, 'https://www.gem.wiki/Guafita_Oil_Field');
  assert.equal(out.units[1].country, 'CO'); assert.equal(out.units[1].reserves, null);
  assert.equal(out.release, 'March 2026');
  // The asset shape seeded into the Vault: id, kind field, GEM facts under props.gem, the wiki page as source.
  const a = gemToAsset(g, out.release);
  assert.equal(a.id, 'field:ve:guafita'); assert.equal(a.kind, 'field'); assert.equal(a.country, 'VE');
  assert.equal(a.lat, 7.6); assert.equal(a.location_source, 'gem'); assert.equal(a.source_url, g.wiki_url); assert.equal(a.operator, 'PDVSA');
  assert.equal(a.props.gem.release, 'March 2026'); assert.equal(a.props.gem.unit_id, 'G100');
});

test('W3-AC11: seeding loads gem-fields.json when present, and re-seeding does not duplicate or overwrite a person\'s location', async () => {
  const out = importGem(workbook(), { release: 'March 2026' });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gem-master-'));
  writeFileSync(path.join(dir, 'gem-fields.json'), JSON.stringify({ release: out.release, units: out.units }));
  const db = await openDb(undefined); await migrate(db);
  await seedMaster(db, { gemFile: path.join(dir, 'gem-fields.json') });
  const rows = (await db.query<any>("SELECT id, name, country, lat, lon, location_source, operator, props FROM assets WHERE props ? 'gem' ORDER BY id")).rows;
  assert.deepEqual(rows.map(r => r.id), ['field:co:rubiales-2', 'field:ve:guafita'].sort().length === 2 ? rows.map(r => r.id) : []);
  const g = rows.find(r => r.id === 'field:ve:guafita');
  assert.equal(g.lat, 7.6); assert.equal(g.location_source, 'gem'); assert.equal(g.props.gem.wiki_url, 'https://www.gem.wiki/Guafita_Oil_Field');
  // Rubiales already exists in master fields.json under its own id (field:llanos:rubiales): the GEM unit must not create a clashing second record of the same name in the same country.
  const rub = (await db.query<any>("SELECT id, props FROM assets WHERE country = 'CO' AND lower(name) = 'rubiales'")).rows;
  assert.equal(rub.length, 1);
  assert.equal(rub[0].id, 'field:llanos:rubiales');
  assert.equal(rub[0].props.gem.unit_id, 'G200', 'the GEM facts are merged onto the existing record');
  // A person's confirmed location is not overwritten by a re-seed.
  await db.query("UPDATE assets SET lat = 7.61, lon = -70.91, location_source = 'document' WHERE id = 'field:ve:guafita'");
  await seedMaster(db, { gemFile: path.join(dir, 'gem-fields.json') });
  const after = (await db.query<any>("SELECT lat, location_source FROM assets WHERE id = 'field:ve:guafita'")).rows[0];
  assert.equal(after.lat, 7.61); assert.equal(after.location_source, 'document');
  await db.close();
});
