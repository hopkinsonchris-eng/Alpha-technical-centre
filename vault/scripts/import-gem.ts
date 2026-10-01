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
  unit_id: string; name: string; unit_type: string | null; country: string; country_name: string;
  lat: number | null; lon: number | null; accuracy: string | null; status: string | null; fuel: string | null; onshore: string | null;
  operator: string | null; owners: string | null; discovery_year: number | null; fid_year: number | null; production_start_year: number | null;
  production: { value: number; unit: string; year: number | null } | null; reserves: { value: number; unit: string } | null; wiki_url: string | null;
}
export interface GemImport { release: string; imported_at: string; units: GemUnit[]; skipped: { unit_id: string; name: string; reason: string }[] }

const ALIAS: Record<string, string[]> = {
  unit_id: ['unit id', 'gem unit id', 'id'], name: ['unit name', 'name', 'unit'], unit_type: ['unit type', 'type'], country: ['country/area', 'country', 'country or area'],
  lat: ['latitude', 'lat'], lon: ['longitude', 'lon', 'lng'], accuracy: ['location accuracy', 'coordinate accuracy', 'accuracy'], status: ['status', 'unit status'],
  fuel: ['fuel type', 'fuel'], onshore: ['onshore/offshore', 'onshore or offshore', 'location (onshore/offshore)'], operator: ['operator'], owners: ['owner', 'owner(s)', 'owners', 'ownership'],
  discovery_year: ['discovery year'], fid_year: ['fid year', 'final investment decision year'], production_start_year: ['production start year', 'start year'],
  production_year: ['production year'], wiki_url: ['wiki url', 'wiki page', 'gem wiki', 'wiki'],
};
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numOrNull = (v: unknown): number | null => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const strOrNull = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s ? s : null; };

function columnMap(headers: string[]): { fixed: Record<string, string>; production: string[]; reserves: string[] } {
  const fixed: Record<string, string> = {};
  const production: string[] = [], reserves: string[] = [];
  for (const h of headers) {
    const n = norm(h);
    for (const [key, names] of Object.entries(ALIAS)) if (!fixed[key] && names.includes(n)) fixed[key] = h;
    if (/^production \(/.test(n) || /^production,/.test(n)) production.push(h);
    if (/^reserves \(/.test(n) || /^reserves,/.test(n)) reserves.push(h);
  }
  return { fixed, production, reserves };
}
const unitOf = (header: string) => { const m = /\((.+)\)/.exec(header); return m ? m[1].trim() : header.replace(/^(production|reserves),?\s*/i, '').trim(); };

/** Reads the workbook, finds the sheet that carries unit names, and prunes it. */
export function importGem(file: string, opts: { release?: string; now?: Date } = {}): GemImport {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
  let rows: Record<string, unknown>[] = [], map: ReturnType<typeof columnMap> | null = null;
  for (const name of wb.SheetNames) {
    const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
    if (!sheet.length) continue;
    const m = columnMap(Object.keys(sheet[0]));
    if (m.fixed.name && m.fixed.country) { rows = sheet; map = m; break; }
  }
  if (!map) throw new Error(`${path.basename(file)}: no sheet with "Unit name" and "Country/Area" columns`);
  const release = opts.release ?? inferRelease(wb) ?? 'unknown release';
  const units: GemUnit[] = []; const skipped: GemImport['skipped'] = [];
  const f = map.fixed;
  for (const r of rows) {
    const name = String(r[f.name] ?? '').trim();
    const unitId = strOrNull(r[f.unit_id]) ?? slugAssetId('gem', null, name);
    if (!name) continue;
    const countryName = String(r[f.country] ?? '').trim();
    const cc = countryCodeOf(countryName);
    if (!cc) { skipped.push({ unit_id: unitId, name, reason: `country "${countryName}" not recognised` }); continue; }
    const lat = numOrNull(r[f.lat]), lon = numOrNull(r[f.lon]);
    const prodCol = map.production.find(h => numOrNull(r[h]) !== null);
    const resCol = map.reserves.find(h => numOrNull(r[h]) !== null);
    units.push({
      unit_id: unitId, name, unit_type: strOrNull(r[f.unit_type]), country: cc, country_name: countryName,
      lat: lat !== null && Math.abs(lat) <= 90 ? lat : null, lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
      accuracy: strOrNull(r[f.accuracy]), status: strOrNull(r[f.status]), fuel: strOrNull(r[f.fuel]), onshore: strOrNull(r[f.onshore]),
      operator: strOrNull(r[f.operator]), owners: strOrNull(r[f.owners]),
      discovery_year: numOrNull(r[f.discovery_year]), fid_year: numOrNull(r[f.fid_year]), production_start_year: numOrNull(r[f.production_start_year]),
      production: prodCol ? { value: numOrNull(r[prodCol])!, unit: unitOf(prodCol), year: numOrNull(r[f.production_year]) } : null,
      reserves: resCol ? { value: numOrNull(r[resCol])!, unit: unitOf(resCol) } : null,
      wiki_url: strOrNull(r[f.wiki_url]),
    });
  }
  return { release, imported_at: (opts.now ?? new Date()).toISOString(), units, skipped };
}

function inferRelease(wb: XLSX.WorkBook): string | null {
  for (const name of wb.SheetNames) {
    const text = XLSX.utils.sheet_to_csv(wb.Sheets[name]).slice(0, 4000);
    const m = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\s+release/i.exec(text);
    if (m) return `${m[1]} ${m[2]}`;
  }
  return null;
}

/** The asset row seedMaster writes for a GEM unit. */
export function gemToAsset(u: GemUnit, release: string) {
  const kind = u.unit_type && /block/i.test(u.unit_type) ? 'block' : 'field';
  return {
    id: slugAssetId(kind, u.country, u.name), kind, name: u.name, country: u.country, operator: u.operator, source_url: u.wiki_url,
    lat: u.lat, lon: u.lon, location_source: u.lat !== null ? 'gem' : null, status: u.status,
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
  writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  console.log(`wrote ${out}: ${res.units.length} units (${res.release}), ${res.skipped.length} skipped${res.skipped.length ? ': ' + res.skipped.slice(0, 5).map(s => s.name + ' (' + s.reason + ')').join('; ') : ''}`);
}
