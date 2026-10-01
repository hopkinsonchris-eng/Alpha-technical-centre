#!/usr/bin/env node
// Builds hub/geo/countries-110m.json for the Hub globe (wave 2, docs/vault-hub/wave2/05-markup.md §1.1)
// from Natural Earth 1:110m Admin 0 countries (public domain). Keeps only what the globe needs:
// the ISO alpha-2 code and the English and Spanish names, with coordinates rounded to 2 dp.
// The output is committed; run this only to refresh it.
//   node scripts/build-geo.mjs [source.geojson] [outFile]
// Without a source path the Natural Earth GeoJSON is downloaded from the nvkelso mirror.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const out = path.resolve(process.argv[3] ?? path.join(root, 'hub', 'geo', 'countries-110m.json'));

// Natural Earth leaves ISO_A2 as -99 for a few features; ISO_A2_EH carries the usual code for most.
// The two unrecognised territories are drawn under the country that holds the ISO code.
const OVERRIDE = { CYN: 'CY', SOL: 'SO' };

export function prune(geojson) {
  const round = (n) => Math.round(n * 100) / 100;
  const ring = (r) => r.map(([x, y]) => [round(x), round(y)]);
  const features = [];
  for (const f of geojson.features) {
    const p = f.properties;
    let iso2 = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ISO_A2;
    if (!iso2 || iso2 === '-99') iso2 = OVERRIDE[p.ADM0_A3];
    if (!iso2 || !/^[A-Z]{2}$/.test(iso2)) throw new Error(`no ISO alpha-2 code for ${p.NAME} (${p.ADM0_A3})`);
    const g = f.geometry;
    const coordinates = g.type === 'Polygon' ? g.coordinates.map(ring) : g.coordinates.map((poly) => poly.map(ring));
    features.push({ type: 'Feature', properties: { iso2, en: p.NAME_EN || p.NAME, es: p.NAME_ES || p.NAME_EN || p.NAME }, geometry: { type: g.type, coordinates } });
  }
  features.sort((a, b) => a.properties.iso2.localeCompare(b.properties.iso2) || a.properties.en.localeCompare(b.properties.en));
  return { type: 'FeatureCollection', source: 'Natural Earth 1:110m Admin 0 countries, public domain (naturalearthdata.com)', features };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const src = process.argv[2];
  const raw = src ? readFileSync(src, 'utf8') : await (await fetch(SOURCE)).text();
  const pruned = prune(JSON.parse(raw));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(pruned) + '\n');
  console.log(`wrote ${path.relative(root, out)} (${pruned.features.length} features, ${Math.round(JSON.stringify(pruned).length / 1024)} KB)`);
}
