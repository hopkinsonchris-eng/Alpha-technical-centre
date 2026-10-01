#!/usr/bin/env tsx
/**
 * Global Oil and Gas Extraction Tracker → vault/master/gem-fields.json (wave 3,
 * docs/vault-hub/wave3/05-markup.md §1.6). The tracker is downloaded by hand
 * from https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/download-data/
 * (it sits behind a form); this script prunes the workbook to what the Vault
 * needs and seedMaster loads the result into `assets`. Licence CC BY 4.0;
 * the attribution travels on every dossier.
 *   npx tsx scripts/import-gem.ts <GOGET.xlsx> [--release "March 2026"] [--out master/gem-fields.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { countryCodeOf, slugAssetId } from '../src/assets/gazetteers.ts';

export interface GemUnit {
  unit_id: string;
  /** GEM's unit name without the trailing country, e.g. "Guafita Oil Field" */
  name: string;
  /** the name a document would use, e.g. "Guafita"; what the Vault stores as the asset name */
  short_name: string;
  unit_type: string | null; production_type: string | null; country: string; country_name: string; subnational: string | null;
  lat: number | null; lon: number | null; accuracy: string | null; status: string | null; status_year: number | null; fuel: string | null; onshore: string | null;
  operator: string | null; owners: string | null; parents: string | null; basin: string | null; blocks: string | null; name_other: string | null;
  discovery_year: number | null; fid_year: number | null; production_start_year: number | null;
  production: { value: number; unit: string; year: number | null; fuel: string | null } | null;
  production_all: { value: number; unit: string; year: number | null; fuel: string | null }[];
  reserves: { value: number; unit: string; year: number | null; fuel: string | null; classification: string | null } | null;
  reserves_all: { value: number; unit: string; year: number | null; fuel: string | null; classification: string | null }[];
  wiki_url: string | null; wiki_project_url: string | null;
}
export interface GemImport { release: string; imported_at: string; units: GemUnit[]; skipped: { unit_id: string; name: string; reason: string }[] }

/** Column aliases for the field-level main sheet (the March 2026 headings first, older spellings after). */
const ALIAS: Record<string, string[]> = {
  unit_id: ['unit id', 'gem unit id', 'id'], name: ['unit name', 'name', 'unit'], unit_type: ['unit type', 'type'], production_type: ['production type'],
  country: ['country/area', 'country', 'country or area'], subnational: ['subnational unit', 'state/province', 'region'],
  lat: ['latitude', 'lat'], lon: ['longitude', 'lon', 'lng'], accuracy: ['location accuracy', 'coordinate accuracy', 'accuracy'], status: ['status', 'unit status'], status_year: ['status year'],
  fuel: ['fuel type', 'fuel'], onshore: ['onshore/offshore', 'onshore or offshore', 'location (onshore/offshore)'], operator: ['operator'], owners: ['owner(s)', 'owner', 'owners', 'ownership'], parents: ['parent(s)', 'parent', 'parents'],
  discovery_year: ['discovery year'], fid_year: ['fid year', 'final investment decision year'], production_start_year: ['production start year', 'start year'],
  basin: ['basin'], blocks: ['block(s)', 'blocks', 'block'], name_other: ['name other', 'other names', 'alias'],
  wiki_url: ['wiki url (field)', 'wiki url', 'wiki page', 'gem wiki', 'wiki'], wiki_project_url: ['wiki url (project)'],
};
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numOrNull = (v: unknown): number | null => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const strOrNull = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s ? s : null; };

function columnMap(headers: string[]): Record<string, string> {
  const fixed: Record<string, string> = {};
  for (const h of headers) { const n = norm(h); for (const [key, names] of Object.entries(ALIAS)) if (!fixed[key] && names.includes(n)) fixed[key] = h; }
  return fixed;
}

/** "Guafita Oil Field (Venezuela)" → full "Guafita Oil Field", short "Guafita"; the short form is what documents say. */
export function gemNames(raw: string): { full: string; short: string } {
  const full = String(raw ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  let short = full.replace(/\s+(?:(?:oil|gas|condensate|oil and gas|gas and oil|oil & gas)\s+)?(?:field|asset|project|complex|unit|development)s?$/i, '').trim();
  if (short.length < 3 || /^[\d\W]+$/.test(short)) short = full;
  return { full, short };
}

/** A per-unit quantity sheet (reserves or production): the latest year per unit, oil before gas, converted units first. */
function quantities(wb: XLSX.WorkBook, sheetName: RegExp): Map<string, { value: number; unit: string; year: number | null; fuel: string | null; classification: string | null }[]> {
  const out = new Map<string, { value: number; unit: string; year: number | null; fuel: string | null; classification: string | null }[]>();
  const name = wb.SheetNames.find(n => sheetName.test(n));
  if (!name) return out;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
  if (!rows.length) return out;
  const h = Object.keys(rows[0]);
  const col = (...names: string[]) => h.find(x => names.includes(norm(x)));
  const idCol = col('unit id', 'project id'), fuelCol = col('fuel description', 'fuel type', 'fuel'), yearCol = col('data year', 'year');
  const qConv = col('quantity (converted)'), uConv = col('units (converted)'), qOrig = col('quantity (original)', 'quantity'), uOrig = col('units (original)', 'units'), cls = col('reserves classification', 'classification');
  if (!idCol) return out;
  for (const r of rows) {
    const id = strOrNull(r[idCol]); if (!id) continue;
    const value = qConv && numOrNull(r[qConv]) !== null ? numOrNull(r[qConv])! : qOrig ? numOrNull(r[qOrig]) : null;
    if (value === null) continue;
    const unit = (qConv && numOrNull(r[qConv]) !== null && uConv ? strOrNull(r[uConv]) : uOrig ? strOrNull(r[uOrig]) : null) ?? '';
    const row = { value, unit, year: yearCol ? numOrNull(r[yearCol]) : null, fuel: fuelCol ? strOrNull(r[fuelCol]) : null, classification: cls ? strOrNull(r[cls]) : null };
    if (!out.has(id)) out.set(id, []);
    out.get(id)!.push(row);
  }
  const fuelRank = (f: string | null) => (/^oil/i.test(f ?? '') ? 0 : /condensate|ngl/i.test(f ?? '') ? 1 : /gas/i.test(f ?? '') ? 2 : 3);
  for (const list of out.values()) list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || fuelRank(a.fuel) - fuelRank(b.fuel));
  return out;
}

/** Reads the workbook: the field-level main sheet joined to the reserves and production sheets by unit id. */
export function importGem(file: string, opts: { release?: string; now?: Date } = {}): GemImport {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  let rows: Record<string, unknown>[] = [], f: Record<string, string> | null = null;
  const candidates = wb.SheetNames.map(name => ({ name, sheet: XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' }) })).filter(x => x.sheet.length);
  // The main sheet carries names, countries and coordinates; the reserves and production sheets carry names and countries but no coordinates.
  const main = candidates.find(x => { const m = columnMap(Object.keys(x.sheet[0])); return m.name && m.country && m.lat; }) ?? candidates.find(x => { const m = columnMap(Object.keys(x.sheet[0])); return m.name && m.country; });
  if (main) { rows = main.sheet; f = columnMap(Object.keys(main.sheet[0])); }
  if (!f) throw new Error(`${path.basename(file)}: no sheet with "Unit name" and "Country/Area" columns`);
  const release = opts.release ?? inferRelease(wb) ?? 'unknown release';
  const reserves = quantities(wb, /field-level reserves|^reserves/i), production = quantities(wb, /field-level production|^production/i);
  const units: GemUnit[] = []; const skipped: GemImport['skipped'] = [];
  for (const r of rows) {
    const rawName = String(r[f.name] ?? '').trim();
    if (!rawName) continue;
    const { full, short } = gemNames(rawName);
    const unitId = strOrNull(r[f.unit_id]) ?? slugAssetId('gem', null, full);
    const countryName = String(r[f.country] ?? '').trim();
    const cc = countryCodeOf(countryName);
    if (!cc) { skipped.push({ unit_id: unitId, name: full, reason: `country "${countryName}" not recognised` }); continue; }
    const lat = numOrNull(r[f.lat]), lon = numOrNull(r[f.lon]);
    const typeFromName = /\b(oil and gas|oil|gas|condensate)?\s*(field|asset|project|complex)\b/i.exec(full);
    const prod = production.get(unitId) ?? [], res = reserves.get(unitId) ?? [];
    units.push({
      unit_id: unitId, name: full, short_name: short, unit_type: f.unit_type ? strOrNull(r[f.unit_type]) : (typeFromName ? typeFromName[0].toLowerCase() : null), production_type: f.production_type ? strOrNull(r[f.production_type]) : null,
      country: cc, country_name: countryName, subnational: f.subnational ? strOrNull(r[f.subnational]) : null,
      lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
      accuracy: strOrNull(r[f.accuracy]), status: strOrNull(r[f.status]), status_year: f.status_year ? numOrNull(r[f.status_year]) : null, fuel: strOrNull(r[f.fuel]), onshore: strOrNull(r[f.onshore]),
      operator: strOrNull(r[f.operator]), owners: strOrNull(r[f.owners]), parents: f.parents ? strOrNull(r[f.parents]) : null, basin: f.basin ? strOrNull(r[f.basin]) : null, blocks: f.blocks ? strOrNull(r[f.blocks]) : null, name_other: f.name_other ? strOrNull(r[f.name_other]) : null,
      discovery_year: numOrNull(r[f.discovery_year]), fid_year: numOrNull(r[f.fid_year]), production_start_year: numOrNull(r[f.production_start_year]),
      production: prod[0] ? { value: prod[0].value, unit: prod[0].unit, year: prod[0].year, fuel: prod[0].fuel } : null,
      production_all: prod.filter(x => x.year === prod[0]?.year).map(x => ({ value: x.value, unit: x.unit, year: x.year, fuel: x.fuel })),
      reserves: res[0] ?? null, reserves_all: res,
      wiki_url: strOrNull(r[f.wiki_url]) ?? (f.wiki_project_url ? strOrNull(r[f.wiki_project_url]) : null), wiki_project_url: f.wiki_project_url ? strOrNull(r[f.wiki_project_url]) : null,
    });
  }
  return { release, imported_at: (opts.now ?? new Date()).toISOString(), units, skipped };
}

/** One unit per line, repeated single-row arrays dropped, so the committed file stays reviewable and small. */
export function writeGem(res: GemImport): string {
  const slim = res.units.map(u => {
    const o: any = { ...u };
    if (o.production_all.length <= 1) delete o.production_all;
    if (o.reserves_all.length <= 1) delete o.reserves_all;
    for (const k of Object.keys(o)) if (o[k] === null) delete o[k];
    return JSON.stringify(o);
  });
  return `{"release":${JSON.stringify(res.release)},"imported_at":${JSON.stringify(res.imported_at)},"skipped":${JSON.stringify(res.skipped)},\n"units":[\n${slim.join(',\n')}\n]}\n`;
}

function inferRelease(wb: XLSX.WorkBook): string | null {
  for (const name of wb.SheetNames) {
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[name]).slice(0, 4000);
    const m = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)/i.exec(text);
    if (m) return `${m[1]} ${m[2]}`;
  }
  return null;
}

/** The asset row seedMaster writes for a GEM unit. */
export function gemToAsset(u: GemUnit, release: string) {
  const kind = u.unit_type && /block/i.test(u.unit_type) ? 'block' : 'field';
  const name = u.short_name || u.name;
  const lat = u.lat ?? null, lon = u.lon ?? null;
  return {
    id: slugAssetId(kind, u.country, name), kind, name, country: u.country, operator: u.operator ?? null, source_url: u.wiki_url ?? null,
    lat, lon, location_source: lat !== null && lon !== null ? 'gem' : null, status: u.status ?? null,
    props: { gem: { ...u, release } },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: npx tsx scripts/import-gem.ts <GOGET.xlsx> [--release "March 2026"] [--out master/gem-fields.json]'); process.exit(2); }
  const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const out = path.resolve(opt('--out') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '../master/gem-fields.json'));
  const res = importGem(file, { release: opt('--release') });
  writeFileSync(out, writeGem(res));
  console.log(`wrote ${out}: ${res.units.length} units (${res.release}), ${res.skipped.length} skipped${res.skipped.length ? ': ' + res.skipped.slice(0, 5).map(s => s.name + ' (' + s.reason + ')').join('; ') : ''}`);
}
