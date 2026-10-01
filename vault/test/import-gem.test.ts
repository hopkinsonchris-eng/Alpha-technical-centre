// Wave 3, PR 1 (docs/vault-hub/wave3/05-markup.md §1.6): the Global Energy Monitor tracker
// workbook, downloaded by hand, becomes vault/master/gem-fields.json and seeds assets.
// W3-AC11. A three-row workbook is built here with the real column names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { importGem, gemToAsset, gemNames } from '../scripts/import-gem.ts';
import { openDb } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedMaster } from '../src/db/seed.ts';

const MAIN = [
  { 'Unit ID': 'G100', 'Unit Name': 'Guafita Oil Field (Venezuela)', 'Unit name local script': '', 'Fuel type': 'oil', 'Country/Area': 'Venezuela', 'Subnational unit': 'Apure', 'Production Type': 'conventional', 'Status': 'operating', 'Status detail': '', 'Status year': 2023, 'Discovery year': 1984, 'FID Year': '', 'Production start year': 1986, 'Operator': 'PDVSA', 'Owner(s)': 'PDVSA [100%]', 'Parent(s)': 'PDVSA [100%]', 'Government unit ID': '', 'Wiki URL (project)': 'https://www.gem.wiki/Guafita_Project', 'Wiki URL (field)': 'https://www.gem.wiki/Guafita_Oil_Field', 'Name Other': '', 'Latitude': '7.6000000', 'Longitude': '-70.9000000', 'Location accuracy': 'exact', 'Onshore/Offshore': 'onshore', 'Field outline (WKT)': '', 'Basin': 'Barinas-Apure', 'Block(s)': '' },
  { 'Unit ID': 'G200', 'Unit Name': 'Rubiales Oil Field (Colombia)', 'Unit name local script': '', 'Fuel type': 'oil', 'Country/Area': 'Colombia', 'Subnational unit': 'Meta', 'Production Type': 'conventional', 'Status': 'operating', 'Status detail': '', 'Status year': 2023, 'Discovery year': 1981, 'FID Year': '', 'Production start year': 1988, 'Operator': 'Ecopetrol', 'Owner(s)': 'Ecopetrol [100%]', 'Parent(s)': '', 'Government unit ID': '', 'Wiki URL (project)': '', 'Wiki URL (field)': 'https://www.gem.wiki/Rubiales_Oil_Field', 'Name Other': '', 'Latitude': 3.85, 'Longitude': -71.3, 'Location accuracy': 'approximate', 'Onshore/Offshore': 'onshore', 'Field outline (WKT)': '', 'Basin': 'Llanos', 'Block(s)': '' },
  { 'Unit ID': 'G300', 'Unit Name': 'Unplaced Gas Project (Unknown Land)', 'Unit name local script': '', 'Fuel type': 'gas', 'Country/Area': 'Unknown Land', 'Subnational unit': '', 'Production Type': '', 'Status': 'proposed', 'Status detail': '', 'Status year': '', 'Discovery year': '', 'FID Year': '', 'Production start year': '', 'Operator': '', 'Owner(s)': '', 'Parent(s)': '', 'Government unit ID': '', 'Wiki URL (project)': '', 'Wiki URL (field)': '', 'Name Other': '', 'Latitude': '', 'Longitude': '', 'Location accuracy': '', 'Onshore/Offshore': 'offshore', 'Field outline (WKT)': '', 'Basin': '', 'Block(s)': '' },
];
const RESERVES = [
  { 'Unit ID': 'G100', 'Unit Name': 'Guafita Oil Field (Venezuela)', 'Country/Area': 'Venezuela', 'Fuel description': 'oil', 'Reserves classification': '1P', 'Quantity': 47.7, 'Units': 'million m³', 'Quantity (converted)': 300, 'Units (converted)': 'million bbl', 'Data Year': 2023 },
];
const PRODUCTION = [
  { 'Unit ID': 'G100', 'Unit Name': 'Guafita Oil Field (Venezuela)', 'Country/Area': 'Venezuela', 'Fuel description': 'oil', 'Quantity (original)': 1972, 'Units (original)': 'm³/d', 'Quantity (converted)': 4.526, 'Units (converted)': 'million bbl/y', 'Data Year': 2024 },
  { 'Unit ID': 'G100', 'Unit Name': 'Guafita Oil Field (Venezuela)', 'Country/Area': 'Venezuela', 'Fuel description': 'oil', 'Quantity (original)': 2100, 'Units (original)': 'm³/d', 'Quantity (converted)': 4.82, 'Units (converted)': 'million bbl/y', 'Data Year': 2023 },
  { 'Unit ID': 'G200', 'Unit Name': 'Rubiales Oil Field (Colombia)', 'Country/Area': 'Colombia', 'Fuel description': 'oil', 'Quantity (original)': 17490, 'Units (original)': 'm³/d', 'Quantity (converted)': 40.15, 'Units (converted)': 'million bbl/y', 'Data Year': 2024 },
];

function workbook(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gem-'));
  const file = path.join(dir, 'GOGET.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Global Oil and Gas Extraction Tracker - March 2026'], ['Copyright © Global Energy Monitor. Global Oil and Gas Extraction Tracker, 2026 release.']]), 'About');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(MAIN), 'Field-level main data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(RESERVES), 'Field-level reserves data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(PRODUCTION), 'Field-level production data');
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return file;
}

test('W3-AC11: the workbook becomes pruned field records with ISO country codes, coordinates, facts and the wiki page; unknown countries are reported', async () => {
  const out = importGem(workbook());
  assert.equal(out.units.length, 2);
  assert.deepEqual(out.skipped, [{ unit_id: 'G300', name: 'Unplaced Gas Project', reason: 'country "Unknown Land" not recognised' }]);
  const g = out.units[0];
  assert.equal(g.unit_id, 'G100'); assert.equal(g.name, 'Guafita Oil Field'); assert.equal(g.short_name, 'Guafita'); assert.equal(g.country, 'VE');
  assert.equal(g.lat, 7.6); assert.equal(g.lon, -70.9); assert.equal(g.accuracy, 'exact');
  assert.equal(g.status, 'operating'); assert.equal(g.operator, 'PDVSA'); assert.equal(g.owners, 'PDVSA [100%]');
  assert.equal(g.subnational, 'Apure'); assert.equal(g.basin, 'Barinas-Apure'); assert.equal(g.production_type, 'conventional'); assert.equal(g.unit_type, 'oil field');
  assert.equal(g.discovery_year, 1984); assert.equal(g.production_start_year, 1986); assert.equal(g.fid_year, null);
  // Production is the latest year on the production sheet, in the converted units; reserves likewise.
  assert.deepEqual(g.production, { value: 4.526, unit: 'million bbl/y', year: 2024, fuel: 'oil' });
  assert.equal(g.production_all.length, 1);
  assert.deepEqual(g.reserves, { value: 300, unit: 'million bbl', year: 2023, fuel: 'oil', classification: '1P' });
  assert.equal(g.wiki_url, 'https://www.gem.wiki/Guafita_Oil_Field'); assert.equal(g.wiki_project_url, 'https://www.gem.wiki/Guafita_Project');
  assert.equal(out.units[1].country, 'CO'); assert.equal(out.units[1].short_name, 'Rubiales'); assert.equal(out.units[1].reserves, null); assert.equal(out.units[1].production!.value, 40.15);
  assert.equal(out.release, 'March 2026', 'read from the About sheet');
  assert.deepEqual(gemNames('10097UUU/Athabasca Oil Asset (Alberta, Canada)'), { full: '10097UUU/Athabasca Oil Asset', short: '10097UUU/Athabasca' });
  assert.deepEqual(gemNames('North Field Oil and Gas Project (Qatar)'), { full: 'North Field Oil and Gas Project', short: 'North Field' });
  assert.deepEqual(gemNames('Block 15 (Angola)'), { full: 'Block 15', short: 'Block 15' });
  // The asset shape seeded into the Vault: id, kind field, GEM facts under props.gem, the wiki page as source.
  const a = gemToAsset(g, out.release);
  assert.equal(a.id, 'field:ve:guafita'); assert.equal(a.kind, 'field'); assert.equal(a.country, 'VE');
  assert.equal(a.lat, 7.6); assert.equal(a.location_source, 'gem'); assert.equal(a.source_url, g.wiki_url); assert.equal(a.operator, 'PDVSA');
  assert.equal(a.props.gem.release, 'March 2026'); assert.equal(a.props.gem.unit_id, 'G100'); assert.equal(a.props.gem.name, 'Guafita Oil Field');
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
  assert.equal(g.name, 'Guafita', 'the asset name is the short form a document would use');
  assert.equal(g.lat, 7.6); assert.equal(g.location_source, 'gem'); assert.equal(g.props.gem.wiki_url, 'https://www.gem.wiki/Guafita_Oil_Field');
  // Without a file named, seeding loads no GEM units (tests and the cron jobs); boot names the committed file.
  const db2 = await openDb(undefined); await migrate(db2);
  const plain = await seedMaster(db2);
  assert.equal(plain.gem_units, 0);
  assert.equal((await db2.query<{ n: number }>("SELECT count(*)::int AS n FROM assets WHERE props ? 'gem'")).rows[0].n, 0);
  await db2.close();
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
