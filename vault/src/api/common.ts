/**
 * Shared plumbing for the M02 route files (not a route module itself: only
 * `*.routes.ts` files are mounted). Holds:
 *  - ApiError and the `{error:{code,message,path?}}` body
 *  - route(): registers a handler and writes exactly one audit event per request
 *  - Access: the caller's scope. Every read goes through isVisible().
 *  - legal-tag resolution (union of parents, never lowered)
 */
import { createHash } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Env } from '../app.ts';
import type { Db } from '../db/client.ts';
import type { Person } from '../auth.ts';
import { audit } from '../audit.ts';
import { isExpired, isVisible, parseScope, unionTags, type LegalTag, type Scope } from '../legal.ts';
import { validator, type SchemaName } from '../schemas.ts';

/* ── errors ─────────────────────────────────────────────────────────── */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public path?: string, public extra?: Record<string, unknown>) { super(message); }
}
export const bad = (message: string, path?: string, code = 'invalid') => new ApiError(400, code, message, path);
export const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
export const notFound = (message: string) => new ApiError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict', extra?: Record<string, unknown>) => new ApiError(409, code, message, undefined, extra);

export function errorBody(e: ApiError) {
  return { error: { code: e.code, message: e.message, ...(e.path ? { path: e.path } : {}), ...(e.extra ?? {}) } };
}

export interface PathError { path: string; message: string }

/** Validate against a schema; on failure throw 400 carrying the JSON path of the first error and the full list. */
export function check(name: SchemaName, data: unknown): void {
  const v = validator(name);
  if (v(data)) return;
  const errors: PathError[] = (v.errors ?? []).map((e: any) => {
    let p: string = e.instancePath || '';
    if (e.keyword === 'required' && e.params?.missingProperty) p += '/' + e.params.missingProperty;
    if (e.keyword === 'additionalProperties' && e.params?.additionalProperty) p += '/' + e.params.additionalProperty;
    return { path: p || '/', message: e.message ?? 'invalid' };
  });
  const first = errors[0] ?? { path: '/', message: 'invalid' };
  throw new ApiError(400, 'invalid', `${name} ${first.path}: ${first.message}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`, first.path, { errors });
}

/* ── small helpers ──────────────────────────────────────────────────── */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
export const iso = (d: unknown): string | null => d == null ? null : new Date(d as any).toISOString();

export function uuidParam(c: Context, name = 'id'): string {
  const v = c.req.param(name);
  if (!v || !UUID_RE.test(v)) throw notFound(`no such record "${v}"`);
  return v.toLowerCase();
}

export async function jsonBody(c: Context): Promise<any> {
  let body: unknown;
  try { body = await c.req.json(); } catch { throw bad('request body must be valid JSON', '/', 'invalid_json'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw bad('request body must be a JSON object', '/', 'invalid_json');
  return body;
}

export function intParam(c: Context, name: string, def: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw bad(`${name} must be a positive integer`, `?${name}`);
  return Math.min(n, max);
}

export function sinceParam(c: Context): string | undefined {
  const raw = c.req.query('since');
  if (!raw) return undefined;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) throw bad('since must be an ISO date or date-time', '?since');
  return new Date(t).toISOString();
}

/* ── route wrapper: exactly one audit event per request ─────────────── */

export interface AuditInfo { scope: string | null; refs: string[]; detail: Record<string, unknown> }
export interface Ctx { c: Context<Env>; person: Person; db: Db; now: Date; a: AuditInfo }
export type Handler = (x: Ctx) => Promise<{ status?: number; body: unknown }>;

function pgToApi(e: any): ApiError | null {
  switch (e?.code) {
    case '23505': return conflict(`already exists${e.detail ? ': ' + e.detail : ''}`, 'conflict');
    case '23503': return bad(`references a record that does not exist${e.detail ? ': ' + e.detail : ''}`, undefined, 'invalid_reference');
    case '22P02': case '22007': case '22008': return bad(`invalid value: ${e.message}`);
    case '23514': return bad(`violates a database rule: ${e.message}`);
    default: return null;
  }
}

/**
 * Register a handler. The wrapper audits once whatever happens: success,
 * an ApiError (detail.status carries the code) or an unexpected failure.
 */
export function route(app: Hono<Env>, method: string | string[], path: string, action: string, handler: Handler): void {
  const methods = Array.isArray(method) ? method : [method];
  app.on(methods, path, async (c) => {
    const ctx: Ctx = { c, person: c.get('person'), db: c.get('db'), now: new Date(), a: { scope: null, refs: [], detail: {} } };
    let status = 200; let body: unknown; let errCode: string | undefined;
    try {
      const r = await handler(ctx);
      status = r.status ?? 200; body = r.body;
    } catch (e) {
      const api = e instanceof ApiError ? e : pgToApi(e);
      if (api) { status = api.status; body = errorBody(api); errCode = api.code; }
      else {
        status = 500; errCode = 'error'; body = { error: { code: 'error', message: (e as Error).message } };
        console.error(`[${action}]`, e);
      }
    }
    await audit(ctx.db, ctx.person.id, action, ctx.a.scope, ctx.a.refs.slice(0, 100), { ...ctx.a.detail, status, ...(errCode ? { error: errCode } : {}) });
    if (body instanceof Response) return body;          // binary downloads (DOCX, PDF) pass through untouched
    return c.json(body as any, status as any);
  });
}

/* ── access: who may see and write what ─────────────────────────────── */

export interface ProjectRow {
  id: string; client_id: string | null; name: string; status: string; default_legal_tag: string;
  asset_ids: string[]; members: string[]; created_at: string; closed_at: string | null;
  // wave 2: opportunity fields (db/002_opportunities.sql)
  country: string | null; lat: number | null; lon: number | null; stage: string;
  stage_history: { stage: string; at: string; by: string }[]; register: Record<string, unknown>;
}
export interface Access { person: Person; now: Date; tags: Map<string, LegalTag>; projects: Map<string, ProjectRow> }

export async function loadAccess(db: Db, person: Person, now = new Date()): Promise<Access> {
  const tagRows = (await db.query<any>(`SELECT id, classification, data_type, client_id, contract_id, country_of_origin, originator,
      to_char(expires_at,'YYYY-MM-DD') AS expires_at, personal_data, export_restricted, partners_only, notes FROM legal_tags`)).rows;
  const projRows = (await db.query<any>('SELECT id, client_id, name, status, default_legal_tag, asset_ids, members, created_at, closed_at, country, lat, lon, stage, stage_history, register FROM projects')).rows;
  return {
    person, now,
    tags: new Map(tagRows.map((t: LegalTag) => [t.id, t])),
    projects: new Map(projRows.map((p: any) => [p.id, { ...p, created_at: iso(p.created_at)!, closed_at: iso(p.closed_at) }])),
  };
}

const isConflictTag = (t: LegalTag) => !!t.client_id && t.client_id.includes('+');

/** The scope the caller holds for a record in `projectId` carrying `tag`. */
export function scopeFor(acc: Access, projectId: string | null | undefined, tag: LegalTag): Scope {
  const project = projectId ? acc.projects.get(projectId) : undefined;
  const clientOf = (id: string) => acc.projects.get(id)?.client_id ?? undefined;
  if (acc.person.role === 'partner') {
    const s = tag.client_id && !isConflictTag(tag) ? parseScope(`client:${tag.client_id}`, clientOf) : parseScope('firm', clientOf);
    return { ...s, is_partner: true };
  }
  if (project && project.members.includes(acc.person.id)) return { ...parseScope(`project:${project.id}`, clientOf), is_partner: false };
  return { ...parseScope('firm', clientOf), is_partner: false };
}

/** Finance and legal records (invoices, NDAs, contracts…) are partners-only unless a partner opens them per project. */
export const PARTNERS_ONLY_TYPES = new Set(['invoice', 'purchase-order', 'timesheet', 'expense', 'bank-statement', 'nda', 'contract', 'licence', 'insurance', 'corporate-record', 'proposal']);
export function itemPartnersOnly(row: { type?: string; extracted?: any }): boolean {
  if (row?.extracted?.partners_only === true) return true;
  if (row?.extracted?.partners_only === false) return false;
  return !!row?.type && PARTNERS_ONLY_TYPES.has(row.type);
}

export function canSee(acc: Access, tagId: string, projectId: string | null | undefined, row?: { type?: string; extracted?: any }): boolean {
  const tag = acc.tags.get(tagId);
  if (!tag) return false;
  if (row && acc.person.role !== 'partner' && itemPartnersOnly(row)) return false;
  // Partners see every record that has not expired, including multi-client
  // derivations that no single-client scope may see (isVisible refuses those).
  if (acc.person.role === 'partner' && isConflictTag(tag)) return !isExpired(tag, acc.now);
  return isVisible(tag, scopeFor(acc, projectId, tag), acc.now);
}

/** 404 when expired (the record is hidden by its tag), 403 when outside the caller's scope. */
export function assertVisible(acc: Access, tagId: string, projectId: string | null | undefined, what: string, row?: { type?: string; extracted?: any }): void {
  const tag = acc.tags.get(tagId);
  if (!tag || isExpired(tag, acc.now)) throw notFound(`${what} not found`);
  if (!canSee(acc, tagId, projectId, row)) throw forbidden(`${what} is outside your scope`);
}

export function scopeLabel(projectId?: string | null, clientId?: string | null): string {
  return projectId ? `project:${projectId}` : clientId ? `client:${clientId}` : 'firm';
}

export function isPartner(p: Person) { return p.role === 'partner'; }
export function requirePartner(p: Person, what: string): void {
  if (!isPartner(p)) throw forbidden(`${what} is restricted to partners`);
}

/** Write access to a project: partners and service accounts anywhere, members on client projects, anyone on internal ones. */
export function requireWritableProject(acc: Access, projectId: string, path = '/project_id'): ProjectRow {
  const p = acc.projects.get(projectId);
  if (!p) throw bad(`project "${projectId}" does not exist`, path, 'unknown_project');
  const role = acc.person.role;
  if (role === 'partner' || role === 'service' || !p.client_id || p.members.includes(acc.person.id)) return p;
  throw forbidden(`you are not a member of project "${projectId}"`);
}

/* ── legal-tag resolution ───────────────────────────────────────────── */

const same = (a: LegalTag, b: LegalTag) =>
  a.classification === b.classification && a.data_type === b.data_type && (a.client_id ?? null) === (b.client_id ?? null) &&
  (a.expires_at ?? null) === (b.expires_at ?? null) && !!a.partners_only === !!b.partners_only &&
  !!a.personal_data === !!b.personal_data && !!a.export_restricted === !!b.export_restricted;

/**
 * Resolve the tag a new derived record must carry: the union of every parent
 * tag id given. Returns an existing tag id whenever one already says the same
 * thing; otherwise a derived tag is stored (deterministic id) so the foreign
 * key holds. Callers cannot lower the result. Mixing two clients' confidential
 * inputs is refused (409): no single scope could ever see the record.
 */
export async function resolveTag(db: Db, acc: Access, tagIds: string[]): Promise<string> {
  const ids = [...new Set(tagIds)];
  const tags = ids.map(id => {
    const t = acc.tags.get(id);
    if (!t) throw bad(`legal tag "${id}" does not exist`, '/legal_tag', 'unknown_legal_tag');
    return t;
  });
  if (tags.length === 1) return finish(tags[0].id);
  const u = unionTags(tags);
  if (isConflictTag(u)) throw conflict(`inputs belong to more than one client (${u.client_id}); a record cannot be derived from both`, 'legal_tag_conflict');
  // Prefer the most specific existing tag that already carries the union's meaning.
  const cover = tags.filter(t => same(t, u)).sort((a, b) => Number(!!b.client_id) - Number(!!a.client_id) || a.id.localeCompare(b.id))[0];
  if (cover) return finish(cover.id);
  const hash = createHash('sha1').update(JSON.stringify([u.classification, u.data_type, u.client_id, u.expires_at, u.partners_only, u.personal_data, u.export_restricted, ids.sort()])).digest('hex').slice(0, 8);
  const id = `${u.id.replace(/[^a-z0-9-]/g, '-').slice(0, 54)}-${hash}`;
  await db.query(
    `INSERT INTO legal_tags (id, classification, data_type, client_id, contract_id, country_of_origin, originator, expires_at, personal_data, export_restricted, partners_only, notes)
     VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
    [id, u.classification, u.data_type, u.client_id ?? null, u.contract_id ?? null, u.country_of_origin ?? [], u.originator, u.expires_at ?? null,
     !!u.personal_data, !!u.export_restricted, !!u.partners_only, `derived: union of ${ids.join(', ')}`],
  );
  acc.tags.set(id, { ...u, id });
  return finish(id);

  function finish(id: string): string {
    const t = acc.tags.get(id)!;
    if (isExpired(t, acc.now)) throw bad(`legal tag "${id}" expired ${t.expires_at}`, '/legal_tag', 'expired_legal_tag');
    return id;
  }
}

/** Tags of the run:/doc: refs that exist in the vault (unknown refs, reference sets and manual inputs contribute nothing). */
export async function tagsOfRefs(db: Db, refs: string[]): Promise<string[]> {
  const runIds = new Set<string>(), docIds = new Set<string>();
  for (const r of refs) {
    const m = /^(run|doc):([0-9a-f-]{36})$/i.exec(r);
    if (!m) continue;
    (m[1] === 'run' ? runIds : docIds).add(m[2].toLowerCase());
  }
  const out: string[] = [];
  if (runIds.size) out.push(...(await db.query<{ legal_tag: string }>('SELECT legal_tag FROM runs WHERE id = ANY($1::uuid[])', [[...runIds]])).rows.map(r => r.legal_tag));
  if (docIds.size) out.push(...(await db.query<{ legal_tag: string }>('SELECT legal_tag FROM items WHERE id = ANY($1::uuid[])', [[...docIds]])).rows.map(r => r.legal_tag));
  return out;
}

/* ── dispatch shape, shared by the register and the counterparty file ── */

export const DISPATCH_SELECT = `d.id, d.item_id, d.direction, d.organisation_id, d.contact_ids, d.channel, d.occurred_at, d.reference_no, d.their_reference,
  d.in_reply_to, d.signed_by, d.acknowledged_at, d.tracking, d.recorded_by, d.notes,
  i.title AS item_title, i.type AS item_type, i.legal_tag AS item_legal_tag, i.project_id AS item_project_id, i.hidden AS item_hidden`;

/** A Dispatch as the schema describes it, plus the item it carries (title and type) for display. */
export function dispatchView(r: any) {
  return {
    id: r.id, item_id: r.item_id, direction: r.direction, organisation_id: r.organisation_id, contact_ids: r.contact_ids ?? [], channel: r.channel,
    occurred_at: iso(r.occurred_at), reference_no: r.reference_no ?? null, their_reference: r.their_reference ?? null, in_reply_to: r.in_reply_to ?? null,
    signed_by: r.signed_by ?? null, acknowledged_at: iso(r.acknowledged_at), tracking: r.tracking ?? null, recorded_by: r.recorded_by, ...(r.notes ? { notes: r.notes } : {}),
    item: { id: r.item_id, title: r.item_title, type: r.item_type },
  };
}
