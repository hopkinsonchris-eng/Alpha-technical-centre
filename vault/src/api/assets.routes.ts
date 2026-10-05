/**
 * Fields on projects (wave 3, docs/vault-hub/wave3/05-markup.md §1.7).
 *   GET    /api/assets/locate?name=&country=         candidates from the Vault, GEM, GeoNames, Wikidata
 *   GET    /api/assets/:id                           one asset
 *   GET    /api/projects/:id/assets                  the project's attached assets with their dossier items
 *   POST   /api/projects/:id/assets {asset_id}|{create:{…}}   attach (creating if needed), file the dossier
 *   DELETE /api/projects/:id/assets/:asset_id        detach (the asset and its dossier stay)
 *   GET    /api/assets/:id/file                       wave 7 PR3 (A3): the asset's lineage and children, and the runs,
 *                                                     items, dossier and analogue rows on it and everything under it,
 *                                                     across the projects in scope, each row scope-checked
 * Writes need a writable project (partners; members on client projects; anyone on internal
 * ones); a project the caller cannot see answers 404. Coordinates always carry a source.
 * Wave 7 PR3 (S6): `create.parent_id` puts a basin, block, field, reservoir or well under its parent (the parent
 * must sit above the child); a GEM record that names a basin is linked to it on attach.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, canSee, jsonBody, loadAccess, notFound, requireWritableProject, route, scopeLabel, type Access, type Ctx } from './common.ts';
import { ASSET_KINDS, configureLocate, locate, slugAssetId, type AssetKind, type LocateOptions } from '../assets/gazetteers.ts';
import { fileDossier, type AssetRow } from '../assets/dossier.ts';
import { locationCheck, type LocationCheck } from '../assets/geo.ts';
import { assetDescendants, assetLineage, linkGemParent, parentAllowed } from '../assets/hierarchy.ts';
import { ApiError, type ProjectRow } from './common.ts';
import { triggerResearch } from './research.routes.ts';
import { RUN_COLS, runView } from './runs.routes.ts';
import { ITEM_COLS, citesOf, itemRecord } from './items.routes.ts';

/** Tests inject fetch and the GeoNames user; production reads the environment. */
export function configureGazetteers(o: LocateOptions) { configureLocate(o); }

const ASSET_COLS = 'id, kind, name, parent_id, country, operator, source_url, props, lat, lon, location_source, status, created_by, created_at';
const COUNTRY_RE = /^[A-Z]{2}$/;

async function readAsset(x: Ctx, id: string): Promise<AssetRow | null> {
  const r = (await x.db.query<any>(`SELECT ${ASSET_COLS} FROM assets WHERE id = $1`, [id])).rows[0];
  return r ?? null;
}

function visibleProject(acc: Access, id: string) {
  const p = acc.projects.get(id);
  if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
  return p;
}

/** Validates a {create:{…}} block and inserts the asset with a distinct id. */
async function createAsset(x: Ctx, c: any, country: string | null): Promise<AssetRow> {
  if (!c || typeof c !== 'object') throw bad('create must be an object', '/create');
  if (typeof c.name !== 'string' || !c.name.trim()) throw bad('name is required', '/create/name');
  if (!ASSET_KINDS.includes(c.kind)) throw bad(`kind must be one of ${ASSET_KINDS.join(', ')}`, '/create/kind');
  const hasLat = c.lat !== undefined && c.lat !== null, hasLon = c.lon !== undefined && c.lon !== null;
  if (hasLat && (typeof c.lat !== 'number' || Math.abs(c.lat) > 90)) throw bad('lat must be a number between -90 and 90', '/create/lat');
  if (hasLat !== hasLon) throw bad('lat and lon go together', hasLat ? '/create/lon' : '/create/lat');
  if (hasLon && (typeof c.lon !== 'number' || Math.abs(c.lon) > 180)) throw bad('lon must be a number between -180 and 180', '/create/lon');
  // Wave 7 PR3 (S6): a parent must exist and sit above the child; the child inherits its country unless one is given.
  let parent: AssetRow | null = null;
  if (c.parent_id !== undefined && c.parent_id !== null) {
    if (typeof c.parent_id !== 'string' || !c.parent_id) throw bad('parent_id must be an asset id', '/create/parent_id');
    parent = await readAsset(x, c.parent_id);
    if (!parent) throw bad(`parent asset "${c.parent_id}" does not exist`, '/create/parent_id', 'unknown_asset');
    if (!parentAllowed(c.kind, parent.kind)) throw bad(`a ${c.kind} cannot sit under a ${parent.kind}`, '/create/parent_id');
  }
  const cc = typeof c.country === 'string' && COUNTRY_RE.test(c.country) ? c.country : (parent?.country ?? country);
  const source: string | null = hasLat ? (typeof c.location_source === 'string' && c.location_source ? c.location_source : 'manual') : null;
  const base = slugAssetId(c.kind, cc, c.name.trim());
  let id = base;
  for (let n = 2; (await x.db.query('SELECT 1 FROM assets WHERE id = $1', [id])).rows.length; n++) id = `${base}-${n}`;
  const props: Record<string, unknown> = {};
  const detail = c.detail && typeof c.detail === 'object' ? c.detail : null;
  if (source === 'gem' && detail) props.gem = { ...detail, unit_id: detail.unit_id ?? c.source_id };
  if (source === 'wikidata') props.wikidata = { ...(detail ?? {}), id: c.source_id };
  if (source === 'geonames') props.geonames = { ...(detail ?? {}), id: c.source_id };
  await x.db.query(
    `INSERT INTO assets (id, kind, name, parent_id, country, operator, source_url, props, lat, lon, location_source, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
    [id, c.kind as AssetKind, c.name.trim(), parent?.id ?? null, cc, typeof c.operator === 'string' ? c.operator : (detail?.operator ?? null),
     typeof c.source_url === 'string' ? c.source_url : null, JSON.stringify(props), hasLat ? c.lat : null, hasLon ? c.lon : null, source, typeof c.status === 'string' ? c.status : (detail?.status ?? null), x.person.id]);
  const created = (await readAsset(x, id))!;
  // A GEM record that names a basin lands under it (created once per country); a parent given explicitly wins.
  if (!created.parent_id && await linkGemParent(x.db, created as any, x.person.id)) return (await readAsset(x, id))!;
  return created;
}

export interface AttachResult { asset: AssetRow & { location_check: LocationCheck | null }; created: boolean; already: boolean; dossier: string[] }

/** The asset with where it sits against the project's country (wave 3 PR 4). */
export const withCheck = (a: AssetRow, projectCountry: string | null) => ({ ...a, location_check: locationCheck(projectCountry, { lat: a.lat, lon: a.lon, country: a.country }) });

/**
 * Attaches an asset to a writable project from `{asset_id}` or `{create:{…}}` and files its
 * dossier. Shared with the review queue, where accepting a proposal attaches the same way.
 * A record that sits outside the project's country (by its coordinates, or by the gazetteer's
 * country code when it has none) is refused with 409 outside_country until the caller sends
 * `confirm_outside: true`; the Hub asks the person first.
 */
export async function attachAsset(x: Ctx, p: ProjectRow, b: any): Promise<AttachResult> {
  let asset: AssetRow | null = null;
  let created = false;
  if (typeof b.asset_id === 'string') {
    asset = await readAsset(x, b.asset_id);
    if (!asset) throw bad(`asset "${b.asset_id}" does not exist`, '/asset_id', 'unknown_asset');
    // Wave 7 PR3 (S6): a seeded GEM unit that never got its basin gets it the first time someone attaches it.
    if (!asset.parent_id && await linkGemParent(x.db, asset as any, x.person.id)) asset = (await readAsset(x, asset.id))!;
  } else if (b.create !== undefined) {
    if (!b.create || typeof b.create !== 'object') throw bad('create must be an object', '/create');
    const c = b.create;
    const check = locationCheck(p.country ?? null, { lat: typeof c.lat === 'number' ? c.lat : null, lon: typeof c.lon === 'number' ? c.lon : null, country: typeof c.country === 'string' && COUNTRY_RE.test(c.country) ? c.country : null });
    if (check?.outside && b.confirm_outside !== true) throw new ApiError(409, 'outside_country', `this record sits in ${check.found}, not ${check.expected}; send confirm_outside: true to attach it anyway`, '/create', { location_check: check });
    asset = await createAsset(x, c, p.country ?? null);
    created = true;
  } else throw bad('send asset_id or create', '/');
  const check = locationCheck(p.country ?? null, { lat: asset.lat, lon: asset.lon, country: asset.country });
  if (check?.outside && b.confirm_outside !== true && !p.asset_ids.includes(asset.id)) throw new ApiError(409, 'outside_country', `${asset.name} sits in ${check.found}, not ${check.expected}; send confirm_outside: true to attach it anyway`, '/asset_id', { location_check: check });
  const already = p.asset_ids.includes(asset.id);
  if (!already) { await x.db.query('UPDATE projects SET asset_ids = array_append(asset_ids, $2) WHERE id = $1', [p.id, asset.id]); p.asset_ids.push(asset.id); }
  const dossier = await fileDossier(x.db, p.id, asset, x.person.id, x.now);
  // Wave 4: a newly attached field queues (or extends) the project's research run (§1.3).
  if (!already) await triggerResearch(x.db, p.id, x.person.id, [asset.name]);
  return { asset: withCheck(asset, p.country ?? null), created, already, dossier };
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/assets/locate', 'asset.locate', async (x) => {
    const name = (x.c.req.query('name') ?? '').trim();
    const country = x.c.req.query('country') || null;
    if (name.length < 2) throw bad('name is required (two characters or more)', '?name');
    if (country && !COUNTRY_RE.test(country)) throw bad('country must be an ISO 3166-1 alpha-2 code in capitals', '?country');
    const r = await locate(x.db, name, country);
    x.a.scope = 'public'; x.a.detail = { name, country, candidates: r.candidates.length, unavailable: r.unavailable.map(u => u.source) };
    return { body: r };
  });

  route(app, 'GET', '/api/assets/:id', 'asset.read', async (x) => {
    const a = await readAsset(x, x.c.req.param('id')!);
    if (!a) throw notFound(`asset "${x.c.req.param('id')}" not found`);
    x.a.scope = 'public'; x.a.refs = [`asset:${a.id}`];
    return { body: a };
  });

  // Wave 7 PR3 (A3, W7-AC14): the asset as a level you can open. Master data is public; every record on it is
  // scope-checked row by row, so two callers see two files of the same field.
  route(app, 'GET', '/api/assets/:id/file', 'asset.file', async (x) => {
    const a = await readAsset(x, x.c.req.param('id')!);
    if (!a) throw notFound(`asset "${x.c.req.param('id')}" not found`);
    const acc = await loadAccess(x.db, x.person, x.now);
    const lineage = (await assetLineage(x.db, a.id)).filter(r => r.depth > 0);
    const descendants = await assetDescendants(x.db, a.id);
    const ids = [a.id, ...descendants.map(d => d.id)];
    const runRows = (await x.db.query<any>(`SELECT ${RUN_COLS} FROM runs WHERE NOT hidden AND asset_ids && $1::text[] ORDER BY created_at DESC, id`, [ids])).rows
      .filter(r => canSee(acc, r.legal_tag, r.project_id));
    const itemRows = (await x.db.query<any>(`SELECT ${ITEM_COLS} FROM items WHERE NOT hidden AND asset_ids && $1::text[] ORDER BY coalesce(authored_at, created_at) DESC, id`, [ids])).rows
      .filter(r => canSee(acc, r.legal_tag, r.project_id, r));
    const cites = await citesOf(x, itemRows.map(r => r.id));
    const isDossier = (r: any) => r.extracted?.kind === 'dossier';
    const items = itemRows.filter(r => !isDossier(r)).map(r => itemRecord(r, cites.get(r.id) ?? []));
    const dossier = itemRows.filter(isDossier).map(r => itemRecord(r, cites.get(r.id) ?? []));
    // Analogue rows: our own evaluations carry their run's project; paper rows carry only their tag.
    const rowsRaw = (await x.db.query<any>('SELECT id, source_ref, asset_id, legal_tag, provenance, as_of, row FROM analogue_rows WHERE asset_id = ANY($1::text[]) ORDER BY as_of DESC, id', [ids])).rows;
    const runProjects = new Map<string, string>();
    const sourceRuns = rowsRaw.map(r => /^run:([0-9a-f-]{36})$/i.exec(r.source_ref)?.[1]).filter((v): v is string => !!v);
    if (sourceRuns.length) for (const r of (await x.db.query<any>('SELECT id::text AS id, project_id, hidden FROM runs WHERE id = ANY($1::uuid[])', [sourceRuns])).rows) if (!r.hidden) runProjects.set(r.id, r.project_id);
    const analogues = rowsRaw.filter(r => {
      const rid = /^run:([0-9a-f-]{36})$/i.exec(r.source_ref)?.[1]?.toLowerCase();
      if (rid && !runProjects.has(rid)) return false;
      return canSee(acc, r.legal_tag, rid ? runProjects.get(rid) : null);
    }).map(r => ({ id: r.id, source_ref: r.source_ref, asset_id: r.asset_id, legal_tag: r.legal_tag, provenance: r.provenance, as_of: typeof r.as_of === 'string' ? r.as_of.slice(0, 10) : new Date(r.as_of).toISOString().slice(0, 10), row: r.row }));
    const projects = [...new Set<string>([...runRows.map(r => r.project_id), ...itemRows.map(r => r.project_id)])].sort();
    x.a.scope = 'firm'; x.a.refs = [`asset:${a.id}`, ...runRows.map(r => `run:${r.id}`), ...itemRows.map(r => `doc:${r.id}`)];
    x.a.detail = { runs: runRows.length, items: items.length, dossier: dossier.length, analogues: analogues.length, descendants: descendants.length, projects: projects.length };
    return { body: { asset: a, lineage, children: descendants.filter(d => d.depth === 1), descendants, projects, runs: runRows.map(runView), items, dossier, analogues } };
  });

  route(app, 'GET', '/api/projects/:id/assets', 'project.assets', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id); x.a.refs = [`project:${p.id}`];
    const rows = p.asset_ids.length ? (await x.db.query<any>(`SELECT ${ASSET_COLS} FROM assets WHERE id = ANY($1::text[])`, [p.asset_ids])).rows : [];
    const dossier = p.asset_ids.length ? (await x.db.query<any>(`SELECT id, asset_ids FROM items WHERE project_id = $1 AND NOT hidden AND extracted->>'kind' = 'dossier' ORDER BY created_at`, [p.id])).rows : [];
    const byId = new Map(rows.map((r: any) => [r.id, r]));
    const assets = p.asset_ids.filter(id => byId.has(id)).map(id => ({ ...withCheck(byId.get(id), p.country ?? null), dossier: dossier.filter((d: any) => (d.asset_ids ?? []).includes(id)).map((d: any) => d.id) }));
    return { body: { project_id: p.id, assets } };
  });

  route(app, 'POST', '/api/projects/:id/assets', 'project.asset.attach', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id);
    requireWritableProject(acc, p.id);
    const b = await jsonBody(x.c);
    const { asset, created, already, dossier } = await attachAsset(x, p, b);
    x.a.refs = [`project:${p.id}`, `asset:${asset.id}`, ...dossier.map(d => `doc:${d}`)];
    x.a.detail = { asset_id: asset.id, created, already, dossier: dossier.length, location_source: asset.location_source, outside: !!asset.location_check?.outside };
    return { status: created ? 201 : 200, body: { asset, attached: true, already, created, dossier } };
  });

  route(app, 'DELETE', '/api/projects/:id/assets/:asset_id', 'project.asset.detach', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = visibleProject(acc, x.c.req.param('id')!);
    x.a.scope = scopeLabel(p.id);
    requireWritableProject(acc, p.id);
    const id = x.c.req.param('asset_id')!;
    if (!p.asset_ids.includes(id)) throw notFound(`asset "${id}" is not attached to project "${p.id}"`);
    await x.db.query('UPDATE projects SET asset_ids = array_remove(asset_ids, $2) WHERE id = $1', [p.id, id]);
    x.a.refs = [`project:${p.id}`, `asset:${id}`];
    return { body: { project_id: p.id, asset_id: id, detached: true } };
  });
}
