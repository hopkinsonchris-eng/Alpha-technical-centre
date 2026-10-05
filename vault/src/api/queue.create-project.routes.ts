/**
 * Wave 7 PR3 (docs/vault-hub/wave7/03-data-hierarchy.md §5.2 A8, §5.3 H7; 05-markup.md W7-AC16): a project from the queue.
 *   POST /api/queue/filing/:id/create-project   (partners)
 *        {name?, id?, country?, organisation_id?, client_id?, default_legal_tag?, stage?}
 * Collapses "email arrives → project → file the email" into one action from a filing-queue row. The project is created
 * with `country` from the sender's organisation, `origin_ref` = the message, `register.holder` and a project_organisations
 * row (role holder) from that organisation, status `prospect`; then the row is filed to the new project through the
 * assign route itself (same audit, same contact and dispatch handling), so the two paths cannot drift.
 * The sender's organisation is the contact's, else the registry organisation with the sender's domain, else the body's
 * `organisation_id`; without one the call refuses (409 unknown_organisation): the review queue proposes it first.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, conflict, iso, loadAccess, notFound, requirePartner, route, scopeLabel, uuidParam } from './common.ts';
import { contactsByEmail } from '../ingest/mail/counterparties.ts';
import { normaliseDomain } from './organisations.routes.ts';
import { domainOf } from '../ingest/mail/classify.ts';
import { DEFAULT_STAGE, STAGES, isCountryCode, stageEntry } from '../opportunities.ts';
import { triggerResearch } from './research.routes.ts';

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** "RE: Fwd: Cubiro water injection data request" → "Cubiro water injection data request". */
export function subjectToName(subject: string | null | undefined): string {
  let s = String(subject ?? '').trim();
  for (let i = 0; i < 6; i++) { const t = s.replace(/^(re|fw|fwd|aw|rv|sv)\s*:\s*/i, '').replace(/^\[[^\]]{1,40}\]\s*/, ''); if (t === s) break; s = t.trim(); }
  return s;
}
/** A project id from a name: lower-case ASCII, hyphens, at most 64 characters. */
export function slugOf(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
}

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'POST', '/api/queue/filing/:id/create-project', 'queue.filing.create_project', async (x) => {
    requirePartner(x.person, 'creating a project from the queue');
    const id = uuidParam(x.c);
    let b: any = {};
    try { b = await x.c.req.json(); } catch { b = {}; }
    if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('request body must be a JSON object', '/', 'invalid_json');

    const q = (await x.db.query<any>('SELECT id, item_id, status FROM filing_queue WHERE id = $1', [id])).rows[0];
    if (!q) throw notFound(`filing queue row ${id} not found`);
    const item = (await x.db.query<any>('SELECT id, title, project_id, legal_tag, extracted, hidden FROM items WHERE id = $1', [q.item_id])).rows[0];
    if (!item || item.hidden) throw notFound(`item ${q.item_id} not found`);
    x.a.refs = [`doc:${item.id}`]; x.a.scope = 'firm';
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, item.legal_tag, item.project_id, `item ${item.id}`);
    if (q.status !== 'open') throw conflict(`filing queue row ${id} is already ${q.status}`);

    // The sender's organisation.
    const ex = item.extracted ?? {};
    const from = (ex.contacts ?? []).find((c: any) => c && c.role === 'from') ?? null;
    let orgId: string | null = typeof b.organisation_id === 'string' && b.organisation_id ? b.organisation_id : null;
    if (!orgId && from?.email) {
      const known = (await contactsByEmail(x.db, [from.email])).get(String(from.email).toLowerCase());
      if (known) orgId = known.organisation_id;
      else {
        const domain = normaliseDomain(domainOf(from.email) ?? '');
        if (domain) {
          const row = (await x.db.query<{ id: string }>(
            `SELECT id FROM organisations WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(identifiers->'domains', '[]'::jsonb)) d WHERE lower(d) = $1) ORDER BY created_at, id LIMIT 1`, [domain])).rows[0];
          if (row) orgId = row.id;
        }
      }
    }
    const org = orgId ? (await x.db.query<any>('SELECT id, name, kind, country FROM organisations WHERE id = $1', [orgId])).rows[0] : null;
    if (orgId && !org) throw bad(`organisation "${orgId}" does not exist`, '/organisation_id', 'unknown_organisation');
    if (!org) throw conflict(`the sender of item ${item.id} is not in the registry yet: add the organisation (the review queue proposes it) or send organisation_id`, 'unknown_organisation');

    // The project row, the way POST /api/projects builds one, plus where it came from.
    const name = (typeof b.name === 'string' && b.name.trim()) || subjectToName(item.title) || `${org.name} opportunity`;
    const pid = typeof b.id === 'string' && b.id ? b.id : slugOf(name);
    if (!SLUG.test(pid)) throw bad('id must be a lowercase slug (a-z, 0-9, hyphen; 2-64 characters)', '/id');
    if (acc.projects.has(pid)) throw conflict(`project "${pid}" already exists: send another id`, 'conflict');
    let country: string | null = null;
    if (b.country !== undefined && b.country !== null && b.country !== '') { if (!isCountryCode(b.country)) throw bad('country must be an ISO 3166-1 alpha-2 code', '/country'); country = b.country; }
    else if (isCountryCode(org.country)) country = org.country;
    const clientId: string | null = typeof b.client_id === 'string' && b.client_id ? b.client_id : null;
    if (clientId && !(await x.db.query('SELECT 1 FROM organisations WHERE id = $1', [clientId])).rows[0]) throw bad(`organisation "${clientId}" does not exist`, '/client_id', 'unknown_organisation');
    const tagId: string | undefined = b.default_legal_tag ?? (clientId === null ? 'lt-firm' : undefined);
    if (!tagId) throw bad('default_legal_tag is required for a client project', '/default_legal_tag');
    const tag = acc.tags.get(tagId);
    if (!tag) throw bad(`legal tag "${tagId}" does not exist`, '/default_legal_tag', 'unknown_legal_tag');
    if (tag.classification === 'client-nda' && tag.client_id !== clientId) throw bad(`legal tag "${tagId}" belongs to client "${tag.client_id}", not "${clientId}"`, '/default_legal_tag');
    const stage = typeof b.stage === 'string' && (STAGES as readonly string[]).includes(b.stage) ? b.stage : DEFAULT_STAGE;
    const register = { holder: org.name, ...(from?.name || from?.email ? { source: String(from.name || from.email) } : {}) };
    await x.db.query(
      `INSERT INTO projects (id, client_id, name, status, default_legal_tag, asset_ids, members, country, lat, lon, stage, stage_history, register, origin_ref, stage_changed_at)
       VALUES ($1,$2,$3,'prospect',$4,'{}'::text[],$5::text[],$6,NULL,NULL,$7,$8::jsonb,$9::jsonb,$10,$11)`,
      [pid, clientId, name, tagId, [x.person.id], country, stage, JSON.stringify([stageEntry(stage, x.person.id, x.now)]), JSON.stringify(register), `doc:${item.id}`, x.now.toISOString()]);
    await x.db.query(`INSERT INTO project_organisations (project_id, organisation_id, role, since) VALUES ($1,$2,'holder',$3) ON CONFLICT DO NOTHING`, [pid, org.id, x.now.toISOString().slice(0, 10)]);
    x.a.scope = scopeLabel(pid); x.a.refs = [`project:${pid}`, `doc:${item.id}`];

    // File the row through the assign route: the same code path as "File to …" on the queue page.
    const headers = new Headers();
    for (const [k, v] of x.c.req.raw.headers) if (!/^(content-length|content-type|host|transfer-encoding)$/i.test(k)) headers.set(k, v);
    headers.set('content-type', 'application/json'); headers.set('accept', 'application/json');
    const res = await app.request(`/api/queue/filing/${id}/assign`, { method: 'POST', headers, body: JSON.stringify({ project_id: pid }) });
    const assigned: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, assigned?.error?.code ?? 'assign_failed', `project "${pid}" was created but the message was not filed: ${assigned?.error?.message ?? res.status}`, undefined, { project_id: pid });

    try { await triggerResearch(x.db, pid, x.person.id, [name, org.name]); } catch (e) { console.error('[queue.filing.create_project] research not queued', (e as Error).message); }
    const row = (await x.db.query<any>('SELECT id, client_id, name, status, default_legal_tag, asset_ids, members, created_at, closed_at, country, lat, lon, stage, stage_history, register, origin_ref, stage_changed_at FROM projects WHERE id = $1', [pid])).rows[0];
    const contacts = (await x.db.query<{ contact_id: string }>('SELECT contact_id FROM project_contacts WHERE project_id = $1 ORDER BY contact_id', [pid])).rows.map(r => r.contact_id);
    x.a.detail = { project: pid, organisation: org.id, country, contacts_added: (assigned.contacts ?? []).length };
    return {
      status: 201,
      body: {
        project: { ...row, created_at: iso(row.created_at), closed_at: iso(row.closed_at), stage_changed_at: iso(row.stage_changed_at), contacts, organisations: [{ organisation_id: org.id, name: org.name, role: 'holder' }] },
        assigned,
      },
    };
  });
}
