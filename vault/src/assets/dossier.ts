/**
 * The dossier filed when a field is attached (wave 3, docs/vault-hub/wave3/05-markup.md §1.4).
 * One public note per gazetteer record the asset carries (Global Energy Monitor, Wikidata,
 * GeoNames): legal tag lt-public, origin naming the source and record id, the facts under
 * extracted.kind = 'dossier'. Deduplicated on external_id per project, so re-attaching files
 * nothing new. Ordinary records afterwards: searchable, citable, on the timeline.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/client.ts';

export const GEM_ATTRIBUTION = 'Global Oil and Gas Extraction Tracker, Global Energy Monitor, {release} release, CC BY 4.0 (https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/)';

export interface AssetRow { id: string; kind: string; name: string; parent_id?: string | null; country: string | null; lat: number | null; lon: number | null; location_source: string | null; source_url: string | null; operator: string | null; props: Record<string, any> }

interface DossierSource { source: 'gem' | 'wikidata' | 'geonames'; external_id: string; url: string | null; facts: Record<string, unknown>; summary: string }

function sources(asset: AssetRow): DossierSource[] {
  const out: DossierSource[] = [];
  const g = asset.props?.gem;
  if (g && g.unit_id) {
    const release = g.release ?? 'current';
    const bits = [g.status && `status ${g.status}`, g.unit_type && `${g.unit_type}`, g.onshore, g.operator && `operator ${g.operator}`, g.owners && `owners ${g.owners}`,
      g.discovery_year && `discovered ${g.discovery_year}`, g.production_start_year && `producing since ${g.production_start_year}`,
      g.production?.value != null && `production ${g.production.value} ${g.production.unit ?? ''}${g.production.year ? ' (' + g.production.year + ')' : ''}`,
      g.reserves?.value != null && `reserves ${g.reserves.value} ${g.reserves.unit ?? ''}`].filter(Boolean);
    out.push({ source: 'gem', external_id: `gem:${g.unit_id}`, url: g.wiki_url ?? asset.source_url ?? null,
      facts: { ...g, attribution: GEM_ATTRIBUTION.replace('{release}', release) },
      summary: `${asset.name}: ${bits.join('; ')}. Source: Global Energy Monitor, ${release} release${g.wiki_url ? ', ' + g.wiki_url : ''}.` });
  }
  const w = asset.props?.wikidata;
  if (w && w.id) out.push({ source: 'wikidata', external_id: `wikidata:${w.id}`, url: `https://www.wikidata.org/wiki/${w.id}`, facts: { ...w, attribution: 'Wikidata, CC0' },
    summary: `${asset.name}: ${w.label ?? w.id}${w.operator ? ', operator ' + w.operator : ''}${asset.lat != null ? `, at ${asset.lat}, ${asset.lon}` : ''}. Source: Wikidata ${w.id}.` });
  const n = asset.props?.geonames;
  if (n && n.id) out.push({ source: 'geonames', external_id: `geonames:${n.id}`, url: `https://www.geonames.org/${n.id}`, facts: { ...n, attribution: 'GeoNames, CC BY 4.0' },
    summary: `${asset.name}: GeoNames ${n.feature_code ?? 'OILF'}${n.admin1 ? ' in ' + n.admin1 : ''}${asset.lat != null ? `, at ${asset.lat}, ${asset.lon}` : ''}. Source: GeoNames ${n.id}.` });
  return out;
}

/** Files the dossier items for an asset into a project; returns the ids of the items created now. */
export async function fileDossier(db: Db, projectId: string, asset: AssetRow, by: string, now: Date): Promise<string[]> {
  const ids: string[] = [];
  for (const s of sources(asset)) {
    const dup = (await db.query('SELECT 1 FROM items WHERE project_id = $1 AND external_id = $2 AND NOT hidden', [projectId, s.external_id])).rows.length;
    if (dup) continue;
    const id = randomUUID();
    const extracted = { kind: 'dossier', asset_id: asset.id, asset_name: asset.name, source: s.source, source_url: s.url, summary: s.summary, ...s.facts };
    const hash = 'sha256:' + createHash('sha256').update(JSON.stringify({ external_id: s.external_id, facts: s.facts })).digest('hex');
    await db.query(
      `INSERT INTO items (id, type, title, created_at, authors, client_id, project_id, asset_ids, legal_tag, origin, external_id, content_hash, version, extracted, tags)
       VALUES ($1,'note',$2,$3,$4::text[],NULL,$5,$6::text[],'lt-public',$7::jsonb,$8,$9,1,$10::jsonb,$11::text[])`,
      [id, `Field dossier: ${asset.name}`, now.toISOString(), [by], projectId, [asset.id], JSON.stringify({ source: s.source, external_id: s.external_id, fetched_at: now.toISOString(), url: s.url }),
       s.external_id, hash, JSON.stringify(extracted), ['dossier', s.source]]);
    ids.push(id);
  }
  return ids;
}
