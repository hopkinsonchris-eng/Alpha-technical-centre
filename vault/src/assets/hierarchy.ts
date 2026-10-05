/**
 * The asset hierarchy (wave 7 PR3, docs/vault-hub/wave7/03-data-hierarchy.md S6): country > basin > block > field
 * > reservoir > well, through `assets.parent_id`, which the enum has allowed since 001 and nothing wrote.
 *   assetLineage(db, id)      the asset and its ancestors, self first (depth 0), up to the root
 *   assetDescendants(db, id)  everything under the asset (depth 1 and down)
 *   parentAllowed(child, parent)  a parent must sit above its child in the hierarchy
 *   ensureBasinAsset(db, …)   the basin a tracker names, reused by name within the country, created once
 *   linkGemParent(db, asset)  one GEM unit → the basin its record names, when it has no parent yet
 *   linkGemBasins(db)         every GEM unit without a parent, for the nightly job and after a seed
 * A parent a person set is never overwritten.
 */
import type { Db } from '../db/client.ts';
import { slugAssetId } from './gazetteers.ts';

export interface LineageRow { id: string; kind: string; name: string; parent_id: string | null; country: string | null; depth: number }

/** Where each kind sits; a parent must have a smaller level than its child. */
export const KIND_LEVEL: Record<string, number> = { country: 0, basin: 1, block: 2, field: 3, reservoir: 4, well: 5 };

export function parentAllowed(childKind: string, parentKind: string): boolean {
  const c = KIND_LEVEL[childKind], p = KIND_LEVEL[parentKind];
  return c !== undefined && p !== undefined && p < c;
}

const LINEAGE_SQL = `WITH RECURSIVE up AS (
    SELECT id, kind, name, parent_id, country, 0 AS depth, ARRAY[id] AS seen FROM assets WHERE id = $1
    UNION ALL
    SELECT a.id, a.kind, a.name, a.parent_id, a.country, up.depth + 1, up.seen || a.id FROM assets a JOIN up ON a.id = up.parent_id WHERE NOT a.id = ANY(up.seen)
  ) SELECT id, kind, name, parent_id, country, depth FROM up ORDER BY depth`;

const DESCENDANTS_SQL = `WITH RECURSIVE down AS (
    SELECT id, kind, name, parent_id, country, 1 AS depth, ARRAY[id] AS seen FROM assets WHERE parent_id = $1
    UNION ALL
    SELECT a.id, a.kind, a.name, a.parent_id, a.country, down.depth + 1, down.seen || a.id FROM assets a JOIN down ON a.parent_id = down.id WHERE NOT a.id = ANY(down.seen)
  ) SELECT id, kind, name, parent_id, country, depth FROM down ORDER BY depth, id`;

/** The asset itself at depth 0, then each parent in turn. An unknown id gives an empty list. A cycle stops at the first repeat. */
export async function assetLineage(db: Db, assetId: string): Promise<LineageRow[]> {
  return (await db.query<LineageRow>(LINEAGE_SQL, [assetId])).rows;
}

/** Everything under the asset, nearest first. */
export async function assetDescendants(db: Db, assetId: string): Promise<LineageRow[]> {
  return (await db.query<LineageRow>(DESCENDANTS_SQL, [assetId])).rows;
}

/**
 * The basin asset for a name a tracker gives. An existing basin of that name in the country (or master data's
 * country-less basins such as basin:llanos) is reused; otherwise one is created with the tracker as its source.
 */
export async function ensureBasinAsset(db: Db, country: string | null, name: string, by: string): Promise<{ id: string; created: boolean }> {
  const clean = name.trim();
  const hit = (await db.query<{ id: string }>(
    `SELECT id FROM assets WHERE kind = 'basin' AND lower(name) = lower($1) AND (country = $2 OR country IS NULL OR $2 IS NULL) ORDER BY (country = $2) DESC NULLS LAST, id LIMIT 1`,
    [clean, country])).rows[0];
  if (hit) return { id: hit.id, created: false };
  const base = slugAssetId('basin', country, clean);
  let id = base;
  for (let n = 2; (await db.query('SELECT 1 FROM assets WHERE id = $1', [id])).rows.length; n++) id = `${base}-${n}`;
  await db.query(`INSERT INTO assets (id, kind, name, country, props, created_by) VALUES ($1, 'basin', $2, $3, $4::jsonb, $5)`,
    [id, clean, country, JSON.stringify({ source: 'gem', note: 'basin named by the Global Energy Monitor tracker' }), by]);
  return { id, created: true };
}

export interface GemLinkable { id: string; parent_id: string | null; country: string | null; props: Record<string, any> | null }

/** Links one GEM unit to the basin its tracker record names. Returns the parent id set, or null when nothing was done. */
export async function linkGemParent(db: Db, asset: GemLinkable, by = 'gem'): Promise<{ parent_id: string; created: boolean } | null> {
  if (asset.parent_id) return null;
  const basin = asset.props?.gem?.basin;
  if (typeof basin !== 'string' || !basin.trim()) return null;
  const { id, created } = await ensureBasinAsset(db, asset.country ?? null, basin, by);
  if (id === asset.id) return null;
  const upd = await db.query('UPDATE assets SET parent_id = $2 WHERE id = $1 AND parent_id IS NULL RETURNING id', [asset.id, id]);
  return upd.rows.length ? { parent_id: id, created } : null;
}

/** Every GEM unit still without a parent: the bulk pass after a seed or on the nightly job. */
export async function linkGemBasins(db: Db): Promise<{ linked: number; basins_created: number }> {
  const rows = (await db.query<GemLinkable>(`SELECT id, parent_id, country, props FROM assets WHERE parent_id IS NULL AND kind <> 'basin' AND props->'gem'->>'basin' IS NOT NULL AND props->'gem'->>'basin' <> '' ORDER BY id`)).rows;
  let linked = 0, basins_created = 0;
  for (const a of rows) {
    const r = await linkGemParent(db, a);
    if (r) { linked++; if (r.created) basins_created++; }
  }
  return { linked, basins_created };
}
