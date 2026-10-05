/**
 * Legal tags (wave 7, S1 / W7-AC1). Until now nothing created a client's NDA tag, so every client project was
 * created under lt-firm and confidentiality was not structural. This file is the one door that writes a
 * client-nda tag; projects.routes.ts then creates the project under it and every record inherits it.
 *
 *   POST /api/legal-tags    partners only. Body (the New project form in hub/hub.js can post this when a client is chosen):
 *                             { id: "lt-frontera-nda-2026",      lt-[a-z0-9-]+ (3 to 64 characters after "lt-"), unique
 *                               name: "Frontera NDA 2026",       what the Hub shows; stored in `notes` (the Tier A legal-tag
 *                                                                schema has no name field)
 *                               client_id: "frontera",           an organisation that exists
 *                               expires_at: "2027-03-31",        YYYY-MM-DD, today or later: the NDA's term
 *                               contract_id?: "NDA-2026-014",    optional
 *                               country_of_origin?: ["CO"],      optional ISO codes
 *                               data_type?: "second-party" }     optional; second-party (the client's own data) by default
 *                           201 → the LegalTag as docs/vault-hub/schemas/legal-tag.schema.json defines it, plus `name`.
 *                           400 invalid (path names the field), 400 unknown_organisation, 403 for non-partners, 409 conflict
 *                           when the id exists. Audited as legal_tag.create with scope client:<id> and ref tag:<id>.
 *   GET  /api/legal-tags    { tags: [...] } the tags the caller may file under: public and firm tags for everyone; a
 *                           client's NDA tags for partners and for members of that client's projects. Expired tags,
 *                           multi-client (conflict) tags and derived unions are never offered. ?client=<id> narrows.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { bad, conflict, jsonBody, loadAccess, requirePartner, route, type Access } from './common.ts';
import { isExpired, type LegalTag } from '../legal.ts';

const ID_RE = /^lt-[a-z0-9-]{3,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATA_TYPES = ['public', 'first-party', 'second-party', 'third-party', 'transferred'];
const COLS = `id, classification, data_type, client_id, contract_id, country_of_origin, originator, to_char(expires_at,'YYYY-MM-DD') AS expires_at, personal_data, export_restricted, partners_only, notes`;

/** The LegalTag shape of the schema (nulls dropped) with the Hub's `name` beside it. */
export function tagView(r: any) {
  const t: Record<string, unknown> = { id: r.id, classification: r.classification, data_type: r.data_type, originator: r.originator };
  if (r.client_id != null) t.client_id = r.client_id;
  if (r.contract_id != null) t.contract_id = r.contract_id;
  if (r.country_of_origin?.length) t.country_of_origin = r.country_of_origin;
  if (r.expires_at != null) t.expires_at = r.expires_at;
  if (r.personal_data) t.personal_data = true;
  if (r.export_restricted) t.export_restricted = true;
  if (r.partners_only) t.partners_only = true;
  if (r.notes != null) t.notes = r.notes;
  return { ...t, name: r.notes ?? r.id };
}

const isDerived = (t: LegalTag) => (t.notes ?? '').startsWith('derived:') || t.id.startsWith('lt-union-');
const isConflict = (t: LegalTag) => !!t.client_id && t.client_id.includes('+');

/** Tags the caller may file under: everyone the public and firm ones; a client's NDA tags only partners and that client's project members. */
export function usableTags(acc: Access): LegalTag[] {
  const clients = new Set([...acc.projects.values()].filter(p => p.client_id && (acc.person.role === 'partner' || p.members.includes(acc.person.id))).map(p => p.client_id!));
  return [...acc.tags.values()].filter(t => {
    if (isExpired(t, acc.now) || isConflict(t) || isDerived(t)) return false;
    if (t.partners_only && acc.person.role !== 'partner') return false;
    if (t.classification !== 'client-nda') return true;
    return acc.person.role === 'partner' || clients.has(t.client_id!);
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/legal-tags', 'legal_tag.create', async (x) => {
    requirePartner(x.person, 'creating a legal tag');
    const b = await jsonBody(x.c);
    if (typeof b.id !== 'string' || !ID_RE.test(b.id)) throw bad('id must look like lt-<client>-nda-<year>: "lt-" then 3 to 64 lowercase letters, digits or hyphens', '/id');
    if (typeof b.name !== 'string' || !b.name.trim()) throw bad('name is required', '/name');
    if (typeof b.client_id !== 'string' || !b.client_id.trim()) throw bad('client_id is required: an NDA tag belongs to one client', '/client_id');
    if (typeof b.expires_at !== 'string' || !DATE_RE.test(b.expires_at) || Number.isNaN(Date.parse(b.expires_at))) throw bad('expires_at must be a date, YYYY-MM-DD: the NDA\'s term', '/expires_at');
    if (b.expires_at < x.now.toISOString().slice(0, 10)) throw bad(`expires_at ${b.expires_at} is in the past; an expired tag would hide every record under it`, '/expires_at');
    const dataType = b.data_type ?? 'second-party';
    if (!DATA_TYPES.includes(dataType)) throw bad(`data_type must be one of ${DATA_TYPES.join(', ')}`, '/data_type');
    if (b.contract_id !== undefined && b.contract_id !== null && typeof b.contract_id !== 'string') throw bad('contract_id must be a string', '/contract_id');
    const countries: string[] = b.country_of_origin ?? [];
    if (!Array.isArray(countries) || !countries.every(c => typeof c === 'string' && /^[A-Z]{2}$/.test(c))) throw bad('country_of_origin must be an array of ISO 3166-1 alpha-2 codes', '/country_of_origin');
    const org = (await x.db.query<{ id: string; name: string }>('SELECT id, name FROM organisations WHERE id = $1', [b.client_id])).rows[0];
    if (!org) throw bad(`organisation "${b.client_id}" does not exist`, '/client_id', 'unknown_organisation');
    x.a.scope = `client:${org.id}`; x.a.refs = [`tag:${b.id}`];
    const acc = await loadAccess(x.db, x.person, x.now);
    if (acc.tags.has(b.id)) throw conflict(`legal tag "${b.id}" already exists`);
    const ins = await x.db.query<any>(
      `INSERT INTO legal_tags (id, classification, data_type, client_id, contract_id, country_of_origin, originator, expires_at, personal_data, export_restricted, partners_only, notes)
       VALUES ($1,'client-nda',$2,$3,$4,$5::text[],$6,$7::date,false,false,false,$8) ON CONFLICT (id) DO NOTHING RETURNING ${COLS}`,
      [b.id, dataType, org.id, b.contract_id ?? null, countries, org.name, b.expires_at, b.name.trim()]);
    if (!ins.rows.length) throw conflict(`legal tag "${b.id}" already exists`);
    x.a.detail = { client_id: org.id, expires_at: b.expires_at, data_type: dataType };
    return { status: 201, body: tagView(ins.rows[0]) };
  });

  route(app, 'GET', '/api/legal-tags', 'legal_tag.list', async (x) => {
    const acc = await loadAccess(x.db, x.person, x.now);
    const client = x.c.req.query('client')?.trim() || undefined;
    const tags = usableTags(acc).filter(t => !client || t.client_id === client);
    x.a.scope = client ? `client:${client}` : 'firm'; x.a.refs = tags.map(t => `tag:${t.id}`); x.a.detail = { count: tags.length, client: client ?? null };
    return { body: { tags: tags.map(tagView) } };
  });
}
