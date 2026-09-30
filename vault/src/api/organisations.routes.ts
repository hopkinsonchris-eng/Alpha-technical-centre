/**
 * Counterparty registry (M02): organisations, contacts and the counterparty
 * file that makes the vault letter-ready (R2): contacts, contracts in force,
 * every dispatch in both directions in date order, projects, open invoices.
 * Duplicates are refused on normalised name, web domain and registration number.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import {
  DISPATCH_SELECT, bad, canSee, conflict, dispatchView, jsonBody, loadAccess, notFound, requirePartner, route,
} from './common.ts';
import type { Db } from '../db/client.ts';

const KINDS = ['client', 'partner', 'operator', 'regulator', 'vendor', 'counsel', 'other'];
const LEGAL_SUFFIX = new Set(['sa', 'sas', 'sac', 'saa', 'ltd', 'ltda', 'limited', 'inc', 'incorporated', 'llc', 'llp', 'plc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'ag', 'srl', 'sl', 'spa', 'bv', 'nv', 'cv']);
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com']);
const TITLES = new Set(['ing', 'dr', 'dra', 'sr', 'sra', 'srta', 'mr', 'mrs', 'ms', 'miss', 'prof', 'eng', 'lic', 'msc', 'phd']);

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s: string) => ascii(s).replace(/[.'’]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** Organisation name with accents, punctuation and trailing legal-form words removed. */
export function normaliseOrgName(name: string): string {
  const t = tokens(name);
  while (t.length > 1 && LEGAL_SUFFIX.has(t[t.length - 1])) t.pop();
  return t.join(' ');
}
export function normalisePersonName(name: string): string { return tokens(name).filter(w => !TITLES.has(w)).join(' '); }
export const normaliseDomain = (d: string) => ascii(d).replace(/^[a-z]+:\/\//, '').replace(/^.*@/, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
const alnum = (s: string) => ascii(s).replace(/[^a-z0-9]/g, '');
const slug = (s: string) => tokens(s).join('-').slice(0, 60) || 'org';

interface OrgInput { name: string; kind: string; country: string | null; jurisdiction: string | null; registered_address: string | null; identifiers: { domains?: string[]; registration_no?: string; tax_id?: string; [k: string]: unknown }; notes: string | null }

function parseOrg(b: any, partial = false): Partial<OrgInput> {
  const o: Partial<OrgInput> = {};
  if (!partial || b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim()) throw bad('name is required', '/name'); o.name = b.name.trim(); }
  if (!partial || b.kind !== undefined) { if (!KINDS.includes(b.kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`, '/kind'); o.kind = b.kind; }
  for (const k of ['country', 'jurisdiction', 'registered_address', 'notes'] as const) {
    if (b[k] === undefined) { if (!partial) o[k] = null; continue; }
    if (b[k] !== null && typeof b[k] !== 'string') throw bad(`${k} must be a string`, `/${k}`);
    o[k] = b[k];
  }
  if (b.identifiers !== undefined || !partial) {
    const idn = b.identifiers ?? {};
    if (typeof idn !== 'object' || Array.isArray(idn) || idn === null) throw bad('identifiers must be an object', '/identifiers');
    if (idn.domains !== undefined && !(Array.isArray(idn.domains) && idn.domains.every((d: unknown) => typeof d === 'string'))) throw bad('identifiers.domains must be an array of strings', '/identifiers/domains');
    o.identifiers = { ...idn, ...(idn.domains !== undefined || !partial ? { domains: [...new Set<string>((idn.domains ?? []).map(normaliseDomain).filter(Boolean))] } : {}) };
  }
  return o;
}

interface Match { id: string; name: string; reason: 'name' | 'domain' | 'registration_no' | 'tax_id' }

async function orgDuplicates(db: Db, cand: Partial<OrgInput>, excludeId?: string): Promise<Match[]> {
  const rows = (await db.query<any>('SELECT id, name, identifiers FROM organisations')).rows.filter(r => r.id !== excludeId);
  const out: Match[] = [];
  const nn = cand.name ? normaliseOrgName(cand.name) : null;
  const doms = (cand.identifiers?.domains ?? []).filter(d => !FREE_MAIL.has(d));
  const reg = cand.identifiers?.registration_no ? alnum(String(cand.identifiers.registration_no)) : null;
  const tax = cand.identifiers?.tax_id ? alnum(String(cand.identifiers.tax_id)) : null;
  for (const r of rows) {
    const idn = r.identifiers ?? {};
    if (nn && normaliseOrgName(r.name) === nn) out.push({ id: r.id, name: r.name, reason: 'name' });
    else if (doms.length && (idn.domains ?? []).some((d: string) => doms.includes(normaliseDomain(d)))) out.push({ id: r.id, name: r.name, reason: 'domain' });
    else if (reg && idn.registration_no && alnum(String(idn.registration_no)) === reg) out.push({ id: r.id, name: r.name, reason: 'registration_no' });
    else if (tax && idn.tax_id && alnum(String(idn.tax_id)) === tax) out.push({ id: r.id, name: r.name, reason: 'tax_id' });
  }
  return out;
}

const duplicate = (what: string, matches: unknown[]) => conflict(`possible duplicate ${what}; use the existing record`, 'duplicate', { matches });

const ORG_COLS = 'id, name, kind, country, jurisdiction, registered_address, identifiers, notes, created_at, updated_at';

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/organisations', 'organisation.create', async (x) => {
    const b = await jsonBody(x.c);
    const o = parseOrg(b) as OrgInput;
    const matches = await orgDuplicates(x.db, o);
    if (matches.length && !(x.c.req.query('allow_duplicate') === 'true' && x.person.role === 'partner')) {
      x.a.refs = matches.map(m => `org:${m.id}`);
      throw duplicate('organisation', matches);
    }
    let id: string = b.id ?? slug(normaliseOrgName(o.name));
    if (b.id !== undefined && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(b.id)) throw bad('id must be a lowercase slug', '/id');
    if (b.id === undefined) { const base = id; for (let n = 2; (await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [id])).rows.length; n++) id = `${base}-${n}`; }
    await x.db.query('INSERT INTO organisations (id, name, kind, country, jurisdiction, registered_address, identifiers, notes) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
      [id, o.name, o.kind, o.country, o.jurisdiction, o.registered_address, JSON.stringify(o.identifiers), o.notes]);
    x.a.scope = 'firm'; x.a.refs = [`org:${id}`];
    return { status: 201, body: (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations WHERE id = $1`, [id])).rows[0] };
  });

  route(app, 'GET', '/api/organisations', 'organisation.list', async (x) => {
    const q = ascii((x.c.req.query('q') ?? '').trim()), kind = x.c.req.query('kind');
    if (kind && !KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}`, '?kind');
    let rows = (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations ${kind ? 'WHERE kind = $1' : ''} ORDER BY name`, kind ? [kind] : [])).rows;
    if (q) rows = rows.filter(r => ascii(r.name).includes(q) || r.id.includes(q) || (r.identifiers?.domains ?? []).some((d: string) => d.includes(q)));
    x.a.scope = 'firm'; x.a.refs = rows.map(r => `org:${r.id}`); x.a.detail = { q, kind: kind ?? null, count: rows.length };
    return { body: { organisations: rows } };
  });

  route(app, 'GET', '/api/organisations/:id', 'organisation.read', async (x) => {
    const id = x.c.req.param('id')!;
    const org = (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) throw notFound(`organisation "${id}" not found`);
    x.a.scope = 'firm'; x.a.refs = [`org:${id}`];
    const contacts = (await x.db.query<any>('SELECT id, organisation_id, name, role, emails, phones, postal_address, language, notes FROM contacts WHERE organisation_id = $1 ORDER BY name', [id])).rows;
    return { body: { ...org, contacts } };
  });

  route(app, 'PATCH', '/api/organisations/:id', 'organisation.update', async (x) => {
    const id = x.c.req.param('id')!;
    const cur = (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!cur) throw notFound(`organisation "${id}" not found`);
    x.a.scope = 'firm'; x.a.refs = [`org:${id}`];
    const b = await jsonBody(x.c);
    const patch = parseOrg(b, true);
    const merged = { ...cur, ...patch, identifiers: patch.identifiers ? { ...cur.identifiers, ...patch.identifiers } : cur.identifiers };
    // Only what this edit changes is checked, so a knowingly-created lookalike does not block edits to either record.
    const changed: Partial<OrgInput> = {};
    if (patch.name !== undefined && normaliseOrgName(patch.name) !== normaliseOrgName(cur.name)) changed.name = patch.name;
    if (patch.identifiers) {
      const idn: OrgInput['identifiers'] = { domains: (patch.identifiers.domains ?? []).filter(d => !(cur.identifiers?.domains ?? []).includes(d)) };
      for (const k of ['registration_no', 'tax_id'] as const) if (patch.identifiers[k] !== undefined && patch.identifiers[k] !== cur.identifiers?.[k]) idn[k] = patch.identifiers[k] as string;
      changed.identifiers = idn;
    }
    const matches = await orgDuplicates(x.db, changed, id);
    if (matches.length && !(x.c.req.query('allow_duplicate') === 'true' && x.person.role === 'partner')) throw duplicate('organisation', matches);
    await x.db.query(
      `UPDATE organisations SET name=$2, kind=$3, country=$4, jurisdiction=$5, registered_address=$6, identifiers=$7::jsonb, notes=$8, updated_at=now() WHERE id=$1`,
      [id, merged.name, merged.kind, merged.country, merged.jurisdiction, merged.registered_address, JSON.stringify(merged.identifiers), merged.notes]);
    return { body: (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations WHERE id = $1`, [id])).rows[0] };
  });

  route(app, 'DELETE', '/api/organisations/:id', 'organisation.delete', async (x) => {
    requirePartner(x.person, 'deleting an organisation');
    const id = x.c.req.param('id')!;
    x.a.scope = 'firm'; x.a.refs = [`org:${id}`];
    if (!(await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [id])).rows[0]) throw notFound(`organisation "${id}" not found`);
    const used = (await x.db.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM contacts WHERE organisation_id=$1) + (SELECT count(*) FROM projects WHERE client_id=$1) + (SELECT count(*) FROM legal_tags WHERE client_id=$1)
            + (SELECT count(*) FROM dispatches WHERE organisation_id=$1) + (SELECT count(*) FROM items WHERE $1 = ANY(organisation_ids) OR client_id=$1) + (SELECT count(*) FROM runs WHERE client_id=$1) AS n`, [id])).rows[0].n;
    if (Number(used) > 0) throw conflict(`organisation "${id}" is referenced by ${used} record(s) and cannot be deleted`, 'conflict');
    await x.db.query('DELETE FROM organisations WHERE id = $1', [id]);
    return { body: { deleted: id } };
  });

  route(app, 'POST', '/api/contacts', 'contact.create', async (x) => {
    const b = await jsonBody(x.c);
    if (typeof b.organisation_id !== 'string') throw bad('organisation_id is required', '/organisation_id');
    if (typeof b.name !== 'string' || !b.name.trim()) throw bad('name is required', '/name');
    for (const k of ['emails', 'phones']) if (b[k] !== undefined && !(Array.isArray(b[k]) && b[k].every((s: unknown) => typeof s === 'string'))) throw bad(`${k} must be an array of strings`, `/${k}`);
    for (const k of ['role', 'postal_address', 'notes', 'language']) if (b[k] != null && typeof b[k] !== 'string') throw bad(`${k} must be a string`, `/${k}`);
    const emails: string[] = [...new Set<string>((b.emails ?? []).map((e: string) => e.trim().toLowerCase()).filter(Boolean))];
    for (const e of emails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad(`"${e}" is not an email address`, '/emails');
    const language: string = b.language ?? 'en';
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(language)) throw bad('language must be a code such as en or es', '/language');
    if (!(await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [b.organisation_id])).rows[0]) throw bad(`organisation "${b.organisation_id}" does not exist`, '/organisation_id', 'unknown_organisation');
    x.a.scope = 'firm';
    const others = (await x.db.query<any>('SELECT id, organisation_id, name, emails FROM contacts')).rows;
    const nn = normalisePersonName(b.name);
    const matches = others.flatMap((c: any) => {
      if (c.emails.some((e: string) => emails.includes(e.toLowerCase()))) return [{ id: c.id, name: c.name, organisation_id: c.organisation_id, reason: 'email' }];
      if (c.organisation_id === b.organisation_id && normalisePersonName(c.name) === nn) return [{ id: c.id, name: c.name, organisation_id: c.organisation_id, reason: 'name' }];
      return [];
    });
    if (matches.length) { x.a.refs = matches.map(m => `contact:${m.id}`); throw duplicate('contact', matches); }
    let id: string = b.id ?? slug(normalisePersonName(b.name));
    if (b.id !== undefined && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(b.id)) throw bad('id must be a lowercase slug', '/id');
    if (b.id === undefined) { const base = id; for (let n = 2; others.some((c: any) => c.id === id); n++) id = `${base}-${n}`; }
    await x.db.query('INSERT INTO contacts (id, organisation_id, name, role, emails, phones, postal_address, language, notes) VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7,$8,$9)',
      [id, b.organisation_id, b.name.trim(), b.role ?? null, emails, b.phones ?? [], b.postal_address ?? null, language, b.notes ?? null]);
    x.a.refs = [`contact:${id}`, `org:${b.organisation_id}`];
    const row = (await x.db.query<any>('SELECT id, organisation_id, name, role, emails, phones, postal_address, language, notes FROM contacts WHERE id = $1', [id])).rows[0];
    return { status: 201, body: row };
  });

  route(app, 'GET', '/api/organisations/:id/file', 'organisation.file', async (x) => {
    const id = x.c.req.param('id')!;
    const org = (await x.db.query<any>(`SELECT ${ORG_COLS} FROM organisations WHERE id = $1`, [id])).rows[0];
    if (!org) throw notFound(`organisation "${id}" not found`);
    x.a.scope = 'firm'; x.a.refs = [`org:${id}`];
    const acc = await loadAccess(x.db, x.person, x.now);
    const today = x.now.toISOString().slice(0, 10);

    const contacts = (await x.db.query<any>('SELECT id, organisation_id, name, role, emails, phones, postal_address, language, notes FROM contacts WHERE organisation_id = $1 ORDER BY name', [id])).rows;

    const items = (await x.db.query<any>(`SELECT id, type, title, project_id, legal_tag, reference_no, authored_at, created_at, extracted, supersedes FROM items WHERE $1 = ANY(organisation_ids) AND NOT hidden`, [id])).rows
      .filter(i => canSee(acc, i.legal_tag, i.project_id));
    const superseded = new Set(items.map(i => i.supersedes).filter(Boolean));
    const d = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
    const contracts = items.filter(i => ['nda', 'contract', 'licence'].includes(i.type) && !superseded.has(i.id)).map(i => {
      const e = i.extracted ?? {};
      return { item_id: i.id, type: i.type, title: i.title, reference_no: i.reference_no ?? null, effective_date: d(e.effective_date) ?? d(i.authored_at instanceof Date ? i.authored_at.toISOString() : i.authored_at),
        expiry: d(e.expiry) ?? d(e.expires_at) ?? d(e.expiry_date), parties: e.parties ?? [], governing_law: e.governing_law ?? null, legal_tag: i.legal_tag, project_id: i.project_id };
    }).filter(c => (!c.effective_date || c.effective_date <= today) && (!c.expiry || c.expiry >= today))
      .sort((a, b) => (a.effective_date ?? '').localeCompare(b.effective_date ?? ''));

    const dispatches = (await x.db.query<any>(`SELECT ${DISPATCH_SELECT} FROM dispatches d JOIN items i ON i.id = d.item_id WHERE d.organisation_id = $1 ORDER BY d.occurred_at ASC, d.id`, [id])).rows
      .filter(r => !r.item_hidden && canSee(acc, r.item_legal_tag, r.item_project_id)).map(dispatchView);

    const projectIds = new Set<string>([...acc.projects.values()].filter(p => p.client_id === id).map(p => p.id));
    for (const i of items) projectIds.add(i.project_id);
    const projects = [...projectIds].map(pid => acc.projects.get(pid)).filter((p): p is NonNullable<typeof p> => !!p && canSee(acc, p.default_legal_tag, p.id))
      .map(p => ({ id: p.id, name: p.name, status: p.status, client_id: p.client_id })).sort((a, b) => a.name.localeCompare(b.name));

    const closed = new Set(['paid', 'void', 'voided', 'cancelled', 'canceled', 'written-off']);
    const invoices = items.filter(i => i.type === 'invoice').filter(i => {
      const e = i.extracted ?? {};
      return e.paid !== true && !closed.has(String(e.paid_status ?? e.status ?? '').toLowerCase());
    }).map(i => {
      const e = i.extracted ?? {};
      return { item_id: i.id, title: i.title, reference_no: i.reference_no ?? null, number: e.number ?? null, amount: e.amount ?? null, currency: e.currency ?? null,
        issued: e.issue_date ?? e.issued ?? null, due: e.due_date ?? e.due ?? null, status: e.paid_status ?? e.status ?? 'open' };
    });

    x.a.detail = { dispatches: dispatches.length, contracts: contracts.length };
    return { body: { organisation: org, contacts, contracts_in_force: contracts, dispatches, projects, open_invoices: invoices, generated_at: x.now.toISOString() } };
  });
}
