/**
 * Filing queue (M10): mail the classifier could not file with confidence ≥ 0.85.
 *   GET  /api/queue/filing?status=open|assigned|dismissed|all    the queue, each row with suggestions
 *   POST /api/queue/filing/:id/assign   {project_id}   files the message (and its attachments) to the project, adds the sender to the
 *                                       project's contacts so the next message from them files directly, resolves the row
 *   POST /api/queue/filing/:id/dismiss                  "not a project email": stays in project `firm` tagged firm/inbox, resolves the row
 * Unfiled messages live in the internal `firm` project until someone decides. Assigning is a filing decision, not an edit of the
 * message: project, client, legal tag (raised to the project's, never lowered) and the chunks' copy of them move with it; the
 * original bytes and every version stay as they were. The review queue (organisation proposals, NDA expiries) is in rerun.routes.ts.
 */
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { assertVisible, bad, canSee, conflict, iso, jsonBody, loadAccess, notFound, requireWritableProject, resolveTag, route, scopeLabel, uuidParam, type Ctx, type Access } from './common.ts';
import { ensureContact, syncCounterparties } from '../ingest/mail/counterparties.ts';
import { rememberDecision } from '../ingest/mail/rules.ts';
import { firmDomains, domainOf } from '../ingest/mail/classify.ts';

const STATUSES = ['open', 'assigned', 'dismissed'];

export function register(app: Hono<Env>, _deps: RouteDeps): void {
  route(app, 'GET', '/api/queue/filing', 'queue.filing.list', async (x) => {
    const status = x.c.req.query('status') ?? 'open';
    if (status !== 'all' && !STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}, all`, '?status');
    const rows = (await x.db.query<any>(
      `SELECT q.id, q.item_id, q.suggestions, q.status, q.created_at, q.resolved_by, q.resolved_at, i.title, i.authored_at, i.project_id, i.legal_tag, i.extracted, i.filing
         FROM filing_queue q JOIN items i ON i.id = q.item_id
        WHERE NOT i.hidden ${status === 'all' ? '' : 'AND q.status = $1'} ORDER BY q.created_at DESC, q.id LIMIT 500`, status === 'all' ? [] : [status])).rows;
    const acc = await loadAccess(x.db, x.person, x.now);
    const visible = rows.filter(r => canSee(acc, r.legal_tag, r.project_id));
    const items = visible.map(r => {
      const ex = r.extracted ?? {};
      const from = (ex.contacts ?? []).find((c: any) => c.role === 'from');
      const suggestions = (r.suggestions ?? []).map((s: any) => ({ ...s, project_name: acc.projects.get(s.project_id)?.name ?? s.project_id }));
      return {
        id: r.id, item_id: r.item_id, status: r.status, group: ex.status === 'ready' ? 'ready' : 'review', created_at: iso(r.created_at), resolved_by: r.resolved_by ?? null, resolved_at: iso(r.resolved_at),
        subject: r.title, date: iso(r.authored_at), from: from?.name || from?.email || null, from_address: from?.email ?? null,
        to: (ex.contacts ?? []).filter((c: any) => c.role === 'to').map((c: any) => c.email), direction: ex.direction ?? null, folder: ex.folder ?? null,
        attachments: (ex.attachments ?? []).length, project_id: r.project_id, suggestions,
        suggested_project_id: suggestions[0]?.project_id ?? null, suggested_project_name: suggestions[0]?.project_name ?? null, confidence: suggestions[0]?.confidence ?? null,
      };
    });
    x.a.scope = 'firm'; x.a.refs = visible.map(r => `doc:${r.item_id}`); x.a.detail = { count: items.length, status };
    return { body: { items } };
  });

  /** File one queue row to a project: the item and its attachments move, the counterparties join the project, the memory learns. */
  async function assignRow(x: Ctx, acc: Access, q: { id: string; item_id: string; status: string }, item: any, projectId: string) {
    if (q.status !== 'open') throw conflict(`filing queue row ${q.id} is already ${q.status}`);
    assertVisible(acc, item.legal_tag, item.project_id, `item ${item.id}`);
    if (projectId === 'firm') throw bad('assign to a client or internal project; use dismiss for "not a project email"', '/project_id');
    const target = requireWritableProject(acc, projectId);
    const tag = await resolveTag(x.db, acc, [item.legal_tag, target.default_legal_tag]);
    const id = q.id;

    const family = [item.id, ...(await x.db.query<{ id: string }>('SELECT id FROM items WHERE parent_id = $1', [item.id])).rows.map(r => r.id)];
    const filing = JSON.stringify({ method: 'manual', confidence: 1, confirmed_by: x.person.id });
    await x.db.query(`UPDATE items SET project_id = $2, client_id = $3, legal_tag = $4, filing = $5::jsonb, tags = array_remove(tags, 'unfiled') WHERE id = ANY($1::uuid[])`,
      [family, target.id, target.client_id, tag, filing]);
    await x.db.query(`UPDATE chunks SET project_id = $2, client_id = $3, legal_tag = $4, expires_at = (SELECT expires_at FROM legal_tags WHERE id = $4) WHERE item_id = ANY($1::uuid[])`,
      [family, target.id, target.client_id, tag]);

    // The sender (or, for mail the firm sent, the recipients) join the project's contacts, so the next message files directly.
    const ex = item.extracted ?? {};
    const firm = firmDomains();
    const people = (ex.contacts ?? []).filter((c: any) => !firm.includes(domainOf(c.email)) && (ex.direction === 'out' ? c.role !== 'from' : c.role === 'from')).slice(0, 5);
    const contacts: Array<{ contact_id: string; organisation_id: string; created: boolean }> = [];
    for (const p of people) {
      const c = await ensureContact(x.db, { email: p.email, name: p.name, projectClientId: target.client_id });
      await x.db.query('INSERT INTO project_contacts (project_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [target.id, c.contact_id]);
      contacts.push(c);
    }
    const sync = await syncCounterparties(x.db, item.id, { firm });
    await x.db.query(`UPDATE filing_queue SET status = 'assigned', resolved_by = $2, resolved_at = $3 WHERE id = $1`, [id, x.person.id, x.now.toISOString()]);
    await x.db.query(`UPDATE items SET extracted = extracted || '{"status":"filed"}'::jsonb WHERE id = $1`, [item.id]);
    await rememberDecision(x.db, item.id, target.id, x.person.id, firm);   // wave 6 (P51): the thread, the domain and the attachment names teach the filer
    return { id, status: 'assigned' as const, item_id: item.id as string, project_id: target.id, legal_tag: tag, contacts, dispatch_ids: sync.dispatch_ids, family };
  }

  route(app, 'POST', '/api/queue/filing/:id/assign', 'queue.filing.assign', async (x) => {
    const id = uuidParam(x.c);
    const b = await jsonBody(x.c);
    if (typeof b.project_id !== 'string' || !b.project_id) throw bad('project_id is required', '/project_id');
    const q = (await x.db.query<any>('SELECT id, item_id, status FROM filing_queue WHERE id = $1', [id])).rows[0];
    if (!q) throw notFound(`filing queue row ${id} not found`);
    const item = (await x.db.query<any>('SELECT id, project_id, legal_tag, extracted, hidden FROM items WHERE id = $1', [q.item_id])).rows[0];
    if (!item || item.hidden) throw notFound(`item ${q.item_id} not found`);
    x.a.refs = [`doc:${item.id}`]; x.a.scope = scopeLabel(b.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    const r = await assignRow(x, acc, q, item, b.project_id);
    x.a.refs = r.family.map(f => `doc:${f}`);
    x.a.detail = { project: r.project_id, contacts_added: r.contacts.length, dispatches: r.dispatch_ids.length };
    const { family: _f, ...body } = r;
    return { body };
  });

  // Wave 6 (P52): every open row the capture marked ready (one candidate at or above the bar, a known counterparty) files to its suggestion in one tap.
  route(app, 'POST', '/api/queue/filing/accept-ready', 'queue.filing.accept_ready', async (x) => {
    const b = await jsonBody(x.c).catch(() => ({}));
    const only: string[] | null = Array.isArray(b?.ids) ? b.ids.map(String) : null;
    const rows = (await x.db.query<any>(
      `SELECT q.id, q.item_id, q.status, q.suggestions, i.project_id, i.legal_tag, i.extracted, i.hidden FROM filing_queue q JOIN items i ON i.id = q.item_id
        WHERE q.status = 'open' AND NOT i.hidden AND i.extracted->>'status' = 'ready' ${only ? 'AND q.id = ANY($1::uuid[])' : ''} ORDER BY q.created_at`, only ? [only] : [])).rows;
    const acc = await loadAccess(x.db, x.person, x.now);
    const filed: Array<{ id: string; item_id: string; project_id: string }> = [], skipped: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const projectId = r.suggestions?.[0]?.project_id;
      if (!projectId) { skipped.push({ id: r.id, reason: 'no suggestion' }); continue; }
      try {
        const done = await assignRow(x, acc, { id: r.id, item_id: r.item_id, status: r.status }, { id: r.item_id, project_id: r.project_id, legal_tag: r.legal_tag, extracted: r.extracted, hidden: r.hidden }, projectId);
        filed.push({ id: done.id, item_id: done.item_id, project_id: done.project_id });
      } catch (e) { skipped.push({ id: r.id, reason: (e as Error).message }); }
    }
    x.a.scope = 'firm'; x.a.refs = filed.map(f => `doc:${f.item_id}`); x.a.detail = { filed: filed.length, skipped: skipped.length };
    return { body: { filed, skipped } };
  });

  route(app, 'POST', '/api/queue/filing/:id/dismiss', 'queue.filing.dismiss', async (x) => {
    const id = uuidParam(x.c);
    const q = (await x.db.query<any>('SELECT id, item_id, status FROM filing_queue WHERE id = $1', [id])).rows[0];
    if (!q) throw notFound(`filing queue row ${id} not found`);
    const item = (await x.db.query<any>('SELECT id, project_id, legal_tag, hidden FROM items WHERE id = $1', [q.item_id])).rows[0];
    if (!item || item.hidden) throw notFound(`item ${q.item_id} not found`);
    x.a.refs = [`doc:${item.id}`]; x.a.scope = scopeLabel(item.project_id);
    if (q.status !== 'open') throw conflict(`filing queue row ${id} is already ${q.status}`);
    assertVisible(await loadAccess(x.db, x.person, x.now), item.legal_tag, item.project_id, `item ${item.id}`);
    if (item.project_id !== 'firm') throw conflict(`item ${item.id} is filed in project "${item.project_id}", not in the firm inbox`);
    const family = [item.id, ...(await x.db.query<{ id: string }>('SELECT id FROM items WHERE parent_id = $1', [item.id])).rows.map(r => r.id)];
    await x.db.query(`UPDATE items SET filing = $2::jsonb, tags = array_append(array_remove(array_remove(tags, 'unfiled'), 'firm/inbox'), 'firm/inbox') WHERE id = ANY($1::uuid[])`,
      [family, JSON.stringify({ method: 'manual', confidence: 1, confirmed_by: x.person.id })]);
    await x.db.query(`UPDATE filing_queue SET status = 'dismissed', resolved_by = $2, resolved_at = $3 WHERE id = $1`, [id, x.person.id, x.now.toISOString()]);
    await x.db.query(`UPDATE items SET extracted = extracted || '{"status":"dismissed"}'::jsonb WHERE id = $1`, [item.id]);
    await rememberDecision(x.db, item.id, null, x.person.id);              // wave 6 (P51): "not a project email" is remembered for the thread
    x.a.refs = family.map(f => `doc:${f}`);
    return { body: { id, status: 'dismissed', item_id: item.id, project_id: 'firm' } };
  });
}
