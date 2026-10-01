/**
 * Seed loaders (M02).
 *  - seedMaster(db): master data and reference sets committed in the repo
 *    (vault/master, vault/reference, vault/firm/assets) into Postgres. Runs on
 *    deploy and in tests; idempotent (safe to run any number of times).
 *  - seedFixture(db, seedJson): the AC15 counterparty (organisation, contacts,
 *    legal tag, project, NDA, items, six dispatches) for tests.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.ts';

const VAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_DIR = path.resolve(VAULT_DIR, '..');
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

/** Deterministic UUID (v5 layout) so re-seeding hits the same rows. */
export function uuidFrom(name: string): string {
  const h = createHash('sha1').update(`atc-vault:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** lt-firm, lt-public and the internal 'firm' project must exist before anything else can be filed. */
export async function ensureBase(db: Db): Promise<void> {
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator) VALUES ('lt-firm','firm','first-party','ATC') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO legal_tags (id, classification, data_type, originator) VALUES ('lt-public','public','public','public sources') ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO projects (id, client_id, name, status, default_legal_tag) VALUES ('firm', NULL, 'ATC internal', 'active', 'lt-firm') ON CONFLICT (id) DO NOTHING`);
}

interface ItemRow {
  id: string; type: string; title: string; created_at: string; authored_at?: string | null; authors?: string[]; client_id?: string | null; project_id: string;
  asset_ids?: string[]; organisation_ids?: string[]; legal_tag: string; origin: { source: string; external_id?: string; [k: string]: unknown };
  storage_key?: string | null; mime?: string | null; content_hash: string; version?: number; supersedes?: string | null; reference_no?: string | null;
  filing?: unknown; extracted?: unknown; tags?: string[]; cites?: string[];
}

/** Insert an item at its stated version (with its item_versions row and cites) unless the id exists. Returns true when inserted. */
async function insertItem(db: Db, i: ItemRow): Promise<boolean> {
  const r = await db.query(
    `INSERT INTO items (id, type, title, created_at, authored_at, authors, client_id, project_id, asset_ids, organisation_ids, legal_tag, origin, external_id,
       storage_key, mime, content_hash, version, supersedes, reference_no, filing, extracted, tags)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9::text[],$10::text[],$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21::jsonb,$22::text[])
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [i.id, i.type, i.title, i.created_at, i.authored_at ?? null, i.authors ?? [], i.client_id ?? null, i.project_id, i.asset_ids ?? [], i.organisation_ids ?? [], i.legal_tag,
     JSON.stringify(i.origin), i.origin.external_id ?? null, i.storage_key ?? null, i.mime ?? null, i.content_hash, i.version ?? 1, i.supersedes ?? null, i.reference_no ?? null,
     JSON.stringify(i.filing ?? {}), JSON.stringify(i.extracted ?? {}), i.tags ?? []]);
  if (!r.rows.length) return false;
  await db.query('INSERT INTO item_versions (item_id, version, content_hash, storage_key, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [i.id, i.version ?? 1, i.content_hash, i.storage_key ?? null, i.created_at]);
  for (const ref of i.cites ?? []) await db.query('INSERT INTO item_cites (item_id, ref) VALUES ($1,$2) ON CONFLICT DO NOTHING', [i.id, ref]);
  return true;
}

function* jsonFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* jsonFiles(p);
    else if (name.endsWith('.json')) yield p;
  }
}

export interface MasterSummary { people: number; assets: number; firm_assets: number; reference_sets: number; reference_versions_added: number }

export interface SeedOptions { gemFile?: string }

export async function seedMaster(db: Db, opts: SeedOptions = {}): Promise<MasterSummary> {
  await ensureBase(db);
  const summary: MasterSummary = { people: 0, assets: 0, firm_assets: 0, reference_sets: 0, reference_versions_added: 0 };

  for (const p of readJson(path.join(VAULT_DIR, 'master/people.json'))) {
    await db.query(
      `INSERT INTO people (id, email, name, role, disciplines, signature_block) VALUES ($1,$2,$3,$4,$5::text[],$6)
       ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, role = excluded.role, disciplines = excluded.disciplines, signature_block = excluded.signature_block`,
      [p.id, p.email, p.name, p.role, p.disciplines ?? [], p.signature_block ?? null]);
    summary.people++;
  }

  // Parents before children: basins, fields, wells.
  for (const file of ['basins.json', 'fields.json', 'wells.json']) {
    for (const a of readJson(path.join(VAULT_DIR, 'master', file))) {
      await db.query(
        `INSERT INTO assets (id, kind, name, parent_id, country, operator, source_url, props) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, name = excluded.name, parent_id = excluded.parent_id, country = excluded.country,
           operator = excluded.operator, source_url = excluded.source_url, props = excluded.props`,
        [a.id, a.kind, a.name, a.parent_id ?? null, a.country ?? null, a.operator ?? null, a.source_url ?? null, JSON.stringify(a.props ?? {})]);
      summary.assets++;
    }
  }

  // Wave 3: Global Energy Monitor units (master/gem-fields.json, written by scripts/import-gem.ts).
  // A unit whose name already exists in the country (master fields.json) gains the GEM facts on that
  // record; otherwise it is inserted. A location a person confirmed is never overwritten.
  const gemFile = opts.gemFile ?? path.join(VAULT_DIR, 'master/gem-fields.json');
  if (existsSync(gemFile)) {
    const { gemToAsset } = await import('../../scripts/import-gem.ts');
    const gem = readJson(gemFile);
    for (const u of gem.units ?? []) {
      const a = gemToAsset(u, gem.release ?? 'unknown release');
      const existing = (await db.query<{ id: string }>('SELECT id FROM assets WHERE country = $1 AND lower(name) = lower($2) LIMIT 1', [a.country, a.name])).rows[0];
      if (existing) {
        await db.query(
          `UPDATE assets SET props = props || $2::jsonb, operator = coalesce(operator, $3), source_url = coalesce(source_url, $4), status = coalesce(status, $5),
             lat = CASE WHEN lat IS NULL THEN $6 ELSE lat END, lon = CASE WHEN lon IS NULL THEN $7 ELSE lon END,
             location_source = CASE WHEN lat IS NULL AND $6::double precision IS NOT NULL THEN 'gem' ELSE location_source END WHERE id = $1`,
          [existing.id, JSON.stringify(a.props), a.operator, a.source_url, a.status, a.lat, a.lon]);
      } else {
        await db.query(
          `INSERT INTO assets (id, kind, name, country, operator, source_url, props, lat, lon, location_source, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'gem')
           ON CONFLICT (id) DO UPDATE SET props = assets.props || excluded.props, operator = coalesce(assets.operator, excluded.operator), source_url = coalesce(assets.source_url, excluded.source_url), status = coalesce(assets.status, excluded.status)`,
          [a.id, a.kind, a.name, a.country, a.operator, a.source_url, JSON.stringify(a.props), a.lat, a.lon, a.location_source, a.status]);
      }
      summary.assets++;
    }
  }

  const assetsFile = path.join(VAULT_DIR, 'firm/assets/assets.json');
  if (existsSync(assetsFile)) {
    for (const a of readJson(assetsFile)) {
      const file = path.join(REPO_DIR, a.path);
      const hash = existsSync(file) ? `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` : null;
      await db.query(
        `INSERT INTO firm_assets (id, kind, language, version, path, content_hash, is_current) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, language = excluded.language, version = excluded.version, path = excluded.path,
           content_hash = excluded.content_hash, is_current = excluded.is_current`,
        [a.id, a.kind, a.language ?? 'en', a.version ?? 1, a.path, hash, a.is_current ?? true]);
      summary.firm_assets++;
    }
  }

  // Reference sets become items (project 'firm', tag lt-firm, origin tool). A changed file adds a version.
  for (const file of jsonFiles(path.join(VAULT_DIR, 'reference'))) {
    const bytes = readFileSync(file);
    const ref = JSON.parse(bytes.toString('utf8'));
    if (typeof ref.id !== 'string') throw new Error(`${file}: a reference set needs an "id"`);
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const at = ref.as_of ? new Date(ref.as_of).toISOString() : new Date(statSync(file).mtimeMs).toISOString();
    const cur = (await db.query<{ id: string; version: number; content_hash: string }>(
      `SELECT id, version, content_hash FROM items WHERE origin->>'source' = 'tool' AND external_id = $1 AND type = 'reference-set'`, [ref.id])).rows[0];
    summary.reference_sets++;
    if (!cur) {
      await insertItem(db, {
        id: uuidFrom(`reference:${ref.id}`), type: 'reference-set', title: ref.id, created_at: at, authored_at: at, project_id: 'firm', legal_tag: 'lt-firm',
        origin: { source: 'tool', external_id: ref.id }, mime: 'application/json', content_hash: hash, version: 1, extracted: { content: ref },
        tags: ['reference', ref.id.split('/')[0]],
      });
    } else if (cur.content_hash !== hash) {
      await db.query(`UPDATE items SET content_hash = $2, version = version + 1, extracted = $3::jsonb, stale = false WHERE id = $1`, [cur.id, hash, JSON.stringify({ content: ref })]);
      await db.query('INSERT INTO item_versions (item_id, version, content_hash) VALUES ($1,$2,$3)', [cur.id, cur.version + 1, hash]);
      summary.reference_versions_added++;
    }
  }
  return summary;
}

export interface FixtureSummary { contacts: number; items: number; dispatches: number }

/** Load test/fixtures/ac15/seed.json (pass the parsed object, or a path to it). Requires seedMaster to have run (people). */
export async function seedFixture(db: Db, seedJson: any): Promise<FixtureSummary> {
  const s = typeof seedJson === 'string' ? readJson(seedJson) : seedJson;
  await ensureBase(db);
  const o = s.organisation;
  await db.query(
    `INSERT INTO organisations (id, name, kind, country, jurisdiction, registered_address, identifiers, notes) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (id) DO NOTHING`,
    [o.id, o.name, o.kind, o.country ?? null, o.jurisdiction ?? null, o.registered_address ?? null, JSON.stringify(o.identifiers ?? {}), o.notes ?? null]);
  let contacts = 0;
  for (const c of s.contacts ?? []) {
    await db.query(
      `INSERT INTO contacts (id, organisation_id, name, role, emails, phones, postal_address, language, notes) VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.organisation_id, c.name, c.role ?? null, c.emails ?? [], c.phones ?? [], c.postal_address ?? null, c.language ?? 'en', c.notes ?? null]);
    contacts++;
  }
  const t = s.legal_tag;
  await db.query(
    `INSERT INTO legal_tags (id, classification, data_type, client_id, contract_id, country_of_origin, originator, expires_at, personal_data, export_restricted, partners_only, notes)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
    [t.id, t.classification, t.data_type, t.client_id ?? null, t.contract_id ?? null, t.country_of_origin ?? [], t.originator, t.expires_at ?? null,
     !!t.personal_data, !!t.export_restricted, !!t.partners_only, t.notes ?? null]);
  const p = s.project;
  await db.query(
    `INSERT INTO projects (id, client_id, name, status, default_legal_tag, asset_ids, members) VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[]) ON CONFLICT (id) DO NOTHING`,
    [p.id, p.client_id ?? null, p.name, p.status ?? 'active', p.default_legal_tag, p.asset_ids ?? [], p.members ?? []]);
  for (const c of s.contacts ?? []) await db.query('INSERT INTO project_contacts (project_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, c.id]);

  // The NDA is listed twice in the fixture (as nda_item and as the "Signed mutual NDA" letter, same id): the typed nda_item wins.
  let items = 0;
  for (const i of [...(s.nda_item ? [s.nda_item] : []), ...(s.items ?? [])]) if (await insertItem(db, i)) items++;
  let dispatches = 0;
  for (const d of s.dispatches ?? []) {
    const r = await db.query(
      `INSERT INTO dispatches (id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, in_reply_to, signed_by, acknowledged_at, tracking, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [d.id, d.item_id, d.direction, d.organisation_id, d.contact_ids ?? [], d.channel, d.occurred_at, d.reference_no ?? null, d.their_reference ?? null, d.in_reply_to ?? null,
       d.signed_by ?? null, d.acknowledged_at ?? null, d.tracking ?? null, d.recorded_by, d.notes ?? null]);
    if (r.rows.length) dispatches++;
  }
  return { contacts, items, dispatches };
}
