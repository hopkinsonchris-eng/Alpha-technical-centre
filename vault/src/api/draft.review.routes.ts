/**
 * Write to… (wave 5, W5-D3; docs/vault-hub/wave5/05-markup.md §1.3): the routes around a draft.
 *   GET   /api/projects/:id/contacts   the project's contacts with organisation, role and last contact, and the
 *                                      register counterparties (holder, government, partners) with the organisation
 *                                      that carries each name, when one does
 *   PATCH /api/items/:id/review        the review of a draft note: one decision per paragraph (keep | keep-note | drop),
 *                                      notes, how many citations were opened and how long the review took
 *   POST  /api/items/:id/sent          mark a draft as sent: one outbound dispatch row, the note frozen with `extracted.sent`
 *                                      (the generic POST /api/dispatches, schema-validated, stays for recording any dispatch)
 * Drafting and rendering stay in draft.routes.ts.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, canSee, conflict, jsonBody, loadAccess, notFound, requireWritableProject, route, scopeLabel, uuidParam } from './common.ts';
import { counterpartiesOf } from '../llm/draft.ts';

const DECISIONS = ['keep', 'keep-note', 'drop'] as const;
const CHANNELS = ['email', 'post', 'courier', 'portal', 'hand', 'fax'] as const;

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/projects/:id/contacts', 'project.contacts', async (x) => {
    const id = x.c.req.param('id')!;
    const acc = await loadAccess(x.db, x.person, x.now);
    const p = acc.projects.get(id);
    if (!p || !canSee(acc, p.default_legal_tag, p.id)) throw notFound(`project "${id}" not found`);
    x.a.scope = scopeLabel(id); x.a.refs = [`project:${id}`];
    requireWritableProject(acc, id);                                   // the picker exists to write to someone: members and partners only
    const project = (await x.db.query<any>('SELECT client_id, register FROM projects WHERE id = $1', [id])).rows[0];
    const cp = counterpartiesOf(project?.register);
    const orgs = (await x.db.query<any>('SELECT id, name, kind FROM organisations')).rows;
    const byName = (name: string | undefined) => name ? orgs.find((o: any) => o.name.toLowerCase().startsWith(name.toLowerCase()) || name.toLowerCase().startsWith(o.name.toLowerCase()))?.id ?? null : null;
    const counterparties = [
      ...(cp?.holder ? [{ kind: 'holder', name: cp.holder, organisation_id: byName(cp.holder) }] : []),
      ...(cp?.government ? [{ kind: 'government', name: cp.government, organisation_id: byName(cp.government) }] : []),
      ...(cp?.partners ?? []).map(n => ({ kind: 'partner', name: n, organisation_id: byName(n) })),
    ];
    const roleOf = (orgId: string) => counterparties.find(c => c.organisation_id === orgId)?.kind ?? (orgId === project?.client_id ? 'client' : null);
    const rows = (await x.db.query<any>(`SELECT c.id, c.name, c.role, c.emails, c.language, c.relationship, o.id AS org_id, o.name AS org_name, o.kind AS org_kind,
                                               (SELECT max(d.occurred_at) FROM dispatches d WHERE c.id = ANY(d.contact_ids) OR d.organisation_id = o.id) AS last_contact
                                        FROM project_contacts pc JOIN contacts c ON c.id = pc.contact_id JOIN organisations o ON o.id = c.organisation_id
                                        WHERE pc.project_id = $1 ORDER BY o.name, c.name`, [id])).rows;
    // Contacts of the client and of each counterparty organisation join the list even when nobody attached them to the project.
    const orgIds = [...new Set([project?.client_id, ...counterparties.map(c => c.organisation_id)].filter(Boolean))] as string[];
    const extra = orgIds.length ? (await x.db.query<any>(`SELECT c.id, c.name, c.role, c.emails, c.language, c.relationship, o.id AS org_id, o.name AS org_name, o.kind AS org_kind,
                                               (SELECT max(d.occurred_at) FROM dispatches d WHERE c.id = ANY(d.contact_ids) OR d.organisation_id = o.id) AS last_contact
                                        FROM contacts c JOIN organisations o ON o.id = c.organisation_id WHERE o.id = ANY($1::text[]) ORDER BY o.name, c.name`, [orgIds])).rows : [];
    const seen = new Set<string>();
    const contacts = [...rows, ...extra].filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true))).map(r => ({
      id: r.id, name: r.name, role: r.role, emails: r.emails, language: r.language,
      organisation: { id: r.org_id, name: r.org_name, kind: r.org_kind, counterparty: roleOf(r.org_id) },
      last_contact: r.last_contact ? new Date(r.last_contact).toISOString() : (r.relationship?.last_contact_at ?? null),
      // wave 6 (P57): from the captured mail, who at the firm last spoke to them and who knows them best
      relationship: r.relationship && r.relationship.exchanges ? { last_contact_at: r.relationship.last_contact_at ?? null, last_contact_by: r.relationship.last_contact_by ?? null, last_direction: r.relationship.last_direction ?? null, strongest_connection: r.relationship.strongest_connection ?? null, exchanges: r.relationship.exchanges } : null,
    }));
    x.a.detail = { contacts: contacts.length, counterparties: counterparties.length };
    return { body: { project_id: id, client_id: project?.client_id ?? null, contacts, counterparties } };
  });

  route(app, 'PATCH', '/api/items/:id/review', 'draft.review', async (x) => {
    const id = uuidParam(x.c);
    const b = await jsonBody(x.c);
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden, type, extracted FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden || row.extracted?.kind !== 'draft') throw notFound(`draft ${id} not found`);
    x.a.refs = [`doc:${id}`]; x.a.scope = scopeLabel(row.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.legal_tag, row.project_id, `draft ${id}`, row);
    requireWritableProject(acc, row.project_id);
    if (row.extracted.sent) throw conflict(`draft ${id} was sent on ${String(row.extracted.sent.at).slice(0, 10)} and is frozen; write a new draft`);
    const n = (row.extracted.paragraphs as string[]).length;
    if (!Array.isArray(b.decisions) || b.decisions.length !== n || !b.decisions.every((d: unknown) => (DECISIONS as readonly unknown[]).includes(d))) throw bad(`decisions must list one of ${DECISIONS.join(', ')} for each of the ${n} paragraphs`, '/decisions');
    const notes: Record<string, string> = {};
    if (b.notes !== undefined) {
      if (!b.notes || typeof b.notes !== 'object' || Array.isArray(b.notes)) throw bad('notes must map a paragraph index to text', '/notes');
      for (const [k, v] of Object.entries(b.notes)) { if (!/^\d+$/.test(k) || Number(k) >= n || typeof v !== 'string') throw bad('notes must map a paragraph index to text', '/notes'); notes[k] = v.slice(0, 2000); }
    }
    const num = (k: string) => { const v = b[k]; if (v === undefined) return 0; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw bad(`${k} must be a non-negative number`, `/${k}`); return Math.round(v); };
    const review = { decisions: b.decisions, notes, citations_opened: num('citations_opened'), review_seconds: num('review_seconds'), by: x.person.id, at: x.now.toISOString() };
    await x.db.query("UPDATE items SET extracted = jsonb_set(extracted, '{review}', $2::jsonb) WHERE id = $1", [id, JSON.stringify(review)]);
    x.a.detail = { kept: b.decisions.filter((d: string) => d !== 'drop').length, dropped: b.decisions.filter((d: string) => d === 'drop').length, citations_opened: review.citations_opened };
    return { body: { id, review } };
  });

  route(app, 'POST', '/api/items/:id/sent', 'draft.sent', async (x) => {
    const b = await jsonBody(x.c);
    b.item_id = uuidParam(x.c);
    if (typeof b.organisation_id !== 'string') throw bad('organisation_id is required', '/organisation_id');
    const channel = b.channel ?? 'email';
    if (!(CHANNELS as readonly unknown[]).includes(channel)) throw bad(`channel must be one of ${CHANNELS.join(', ')}`, '/channel');
    if (b.contact_ids !== undefined && !(Array.isArray(b.contact_ids) && b.contact_ids.every((c: unknown) => typeof c === 'string'))) throw bad('contact_ids must be a list of contact ids', '/contact_ids');
    const row = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden, type, extracted, reference_no FROM items WHERE id = $1', [b.item_id])).rows[0];
    if (!row || row.hidden) throw notFound(`item ${b.item_id} not found`);
    x.a.refs = [`doc:${row.id}`, `org:${b.organisation_id}`]; x.a.scope = scopeLabel(row.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.legal_tag, row.project_id, `item ${row.id}`, row);
    if (row.project_id) requireWritableProject(acc, row.project_id);
    if (!(await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [b.organisation_id])).rows[0]) throw bad(`organisation "${b.organisation_id}" does not exist`, '/organisation_id', 'unknown_organisation');
    const contactIds: string[] = b.contact_ids ?? [];
    if (contactIds.length) {
      const known = (await x.db.query<any>('SELECT id FROM contacts WHERE id = ANY($1::text[]) AND organisation_id = $2', [contactIds, b.organisation_id])).rows.map((r: any) => r.id);
      const missing = contactIds.filter(c => !known.includes(c));
      if (missing.length) throw new ApiError(409, 'unknown_contact', `contact(s) ${missing.join(', ')} are not contacts of ${b.organisation_id}`);
    }
    if ((await x.db.query('SELECT 1 FROM dispatches WHERE item_id = $1 AND direction = $2', [row.id, 'out'])).rows[0]) throw conflict(`item ${row.id} was already sent; a later version is a new draft`);
    const id = randomUUID();
    await x.db.query(`INSERT INTO dispatches (id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, signed_by, recorded_by)
                      VALUES ($1,$2,'out',$3,$4::text[],$5,$6,$7,$8,$9,$9)`,
      [id, row.id, b.organisation_id, contactIds, channel, x.now.toISOString(), row.reference_no ?? null, typeof b.their_reference === 'string' ? b.their_reference : null, x.person.id]);
    if (row.extracted?.kind === 'draft') {
      const org = (await x.db.query<any>('SELECT name FROM organisations WHERE id = $1', [b.organisation_id])).rows[0];
      await x.db.query("UPDATE items SET extracted = jsonb_set(extracted, '{sent}', $2::jsonb) WHERE id = $1",
        [row.id, JSON.stringify({ dispatch_id: id, at: x.now.toISOString(), by: x.person.id, channel, organisation: org?.name ?? b.organisation_id, organisation_id: b.organisation_id, to: contactIds })]);
    }
    x.a.detail = { channel, contacts: contactIds.length };
    const d = (await x.db.query<any>('SELECT id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, signed_by FROM dispatches WHERE id = $1', [id])).rows[0];
    return { status: 201, body: { ...d, occurred_at: new Date(d.occurred_at).toISOString() } };
  });
}
