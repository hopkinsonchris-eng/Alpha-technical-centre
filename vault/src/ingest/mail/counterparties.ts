/**
 * Counterparties of a captured email (M10): which organisation and contacts it concerns, the Dispatch it creates, and the
 * organisation proposals for senders the registry does not know (AC16).
 *
 *  - outbound (Sent folder, or from a firm address): one Dispatch `direction: out` per recipient organisation, organisation
 *    from the recipient's contact record, else from a registry organisation with the recipient's web domain;
 *  - inbound from a known contact: one Dispatch `direction: in`;
 *  - anyone else at a domain the registry does not have (free mail excepted): a review_queue proposal of kind `organisation`
 *    with a name guess and the domain. A message that cannot get its Dispatch yet is marked `extracted.dispatch_pending`;
 *    resolvePendingDispatches() completes it once the organisation or contact exists.
 * Dispatches are inserted here, validated against the Dispatch schema and audited as `dispatch.create` by `mail-capture`:
 * POST /api/dispatches refuses the service account on client-NDA items, and the poller must be able to record its own mail.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.ts';
import { audit } from '../../audit.ts';
import { check } from '../../api/common.ts';
import { normaliseDomain, normaliseOrgName } from '../../api/organisations.routes.ts';
import { domainOf, firmDomains, isFreeMail } from './classify.ts';

export interface ContactRef { email: string; name?: string; role: 'from' | 'to' | 'cc'; firm?: boolean; contact_id?: string | null; organisation_id?: string | null }
export interface SyncOptions { firm?: string[]; propose?: boolean }
export interface SyncResult { dispatch_ids: string[]; organisation_ids: string[]; proposals: string[]; pending: boolean }

export const slug = (s: string, fallback = 'x') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;

async function orgsByDomain(db: Db): Promise<Map<string, { id: string; name: string }>> {
  const m = new Map<string, { id: string; name: string }>();
  for (const o of (await db.query<any>('SELECT id, name, identifiers FROM organisations ORDER BY created_at, id')).rows)
    for (const d of o.identifiers?.domains ?? []) { const n = normaliseDomain(d); if (n && !m.has(n)) m.set(n, { id: o.id, name: o.name }); }
  return m;
}

export async function contactsByEmail(db: Db, emails: string[]): Promise<Map<string, { id: string; organisation_id: string; name: string }>> {
  const list = [...new Set(emails.map(e => e.toLowerCase()))];
  const m = new Map<string, { id: string; organisation_id: string; name: string }>();
  if (!list.length) return m;
  const rows = (await db.query<any>(
    `SELECT c.id, c.organisation_id, c.name, lower(e) AS email FROM contacts c, unnest(c.emails) AS e WHERE lower(e) = ANY($1::text[]) ORDER BY c.id`, [list])).rows;
  for (const r of rows) if (!m.has(r.email)) m.set(r.email, { id: r.id, organisation_id: r.organisation_id, name: r.name });
  return m;
}

/** "andino-labs.co.uk" → "Andino Labs". */
export function orgNameFromDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean);
  const generic = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
  let core = parts.slice(0, -1);
  while (core.length > 1 && generic.has(core[core.length - 1])) core = core.slice(0, -1);
  const label = core[core.length - 1] ?? parts[0] ?? domain;
  return label.split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

export interface ProposalInput { domain: string; sender_email: string; sender_name?: string; item_id: string; subject: string; direction: 'in' | 'out' }

/** Propose an organisation for an unknown domain. null when free mail, already proposed and rejected, or the domain is known; the id otherwise (an open proposal for the domain is reused and gains this item). */
export async function proposeOrganisation(db: Db, p: ProposalInput): Promise<{ id: string; created: boolean } | null> {
  const domain = normaliseDomain(p.domain);
  if (!domain || isFreeMail(domain)) return null;
  if ((await orgsByDomain(db)).has(domain)) return null;
  const prior = (await db.query<{ id: string; status: string; payload: any }>(
    `SELECT id, status, payload FROM review_queue WHERE kind = 'organisation' AND payload->>'domain' = $1 AND status IN ('open','rejected') ORDER BY created_at LIMIT 1`, [domain])).rows[0];
  if (prior) {
    if (prior.status === 'rejected') return null;
    const ids: string[] = prior.payload.item_ids ?? [];
    if (!ids.includes(p.item_id)) await db.query(`UPDATE review_queue SET payload = jsonb_set(payload, '{item_ids}', $2::jsonb) WHERE id = $1`, [prior.id, JSON.stringify([...ids, p.item_id].slice(-20))]);
    return { id: prior.id, created: false };
  }
  const id = randomUUID();
  await db.query(`INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'organisation', $2::jsonb)`, [id, JSON.stringify({
    name: orgNameFromDomain(domain), domain, sender_email: p.sender_email, sender_name: p.sender_name ?? null, item_id: p.item_id, item_ids: [p.item_id],
    subject: p.subject, direction: p.direction, source: 'mail-capture', proposal: `Add ${orgNameFromDomain(domain)} (${domain}) to the counterparty registry`,
  })]);
  return { id, created: true };
}

/** The Dispatch this one answers: an earlier dispatch in the same conversation, the in-reply-to message's first. */
async function replyTarget(db: Db, itemId: string, ex: any, occurredAt: string, orgId: string): Promise<string | null> {
  const refs: string[] = [ex.in_reply_to, ...(ex.references ?? [])].filter(Boolean);
  const thread: string | null = ex.thread_id ?? null;
  if (!refs.length && !thread) return null;
  const r = (await db.query<{ id: string }>(
    `SELECT d.id FROM dispatches d JOIN items i ON i.id = d.item_id
      WHERE i.id <> $1 AND i.type = 'email' AND d.occurred_at <= $2::timestamptz AND (i.external_id = ANY($3::text[]) OR ($4::text IS NOT NULL AND i.extracted->>'thread_id' = $4))
      ORDER BY (i.external_id = $5) DESC NULLS LAST, (d.organisation_id = $6) DESC, d.occurred_at DESC LIMIT 1`,
    [itemId, occurredAt, refs, thread, ex.in_reply_to ?? '', orgId])).rows[0];
  return r?.id ?? null;
}

/** Create what the item's counterparties call for: dispatches, organisation ids on the item, proposals. Idempotent. */
export async function syncCounterparties(db: Db, itemId: string, o: SyncOptions = {}): Promise<SyncResult> {
  const none: SyncResult = { dispatch_ids: [], organisation_ids: [], proposals: [], pending: false };
  const item = (await db.query<any>(`SELECT id, title, project_id, authored_at, created_at, organisation_ids, extracted FROM items WHERE id = $1 AND NOT hidden`, [itemId])).rows[0];
  if (!item) return none;
  const ex = item.extracted ?? {};
  const direction: 'in' | 'out' | undefined = ex.direction;
  if (direction !== 'in' && direction !== 'out') return none;
  const firm = o.firm ?? firmDomains();
  const all: ContactRef[] = ex.contacts ?? [];
  const cps = all.filter(c => !(c.firm ?? firm.includes(domainOf(c.email))) && (direction === 'out' ? c.role !== 'from' : c.role === 'from'));
  if (!cps.length) return none;

  const cmap = await contactsByEmail(db, cps.map(c => c.email));
  const dmap = await orgsByDomain(db);
  const groups = new Map<string, Set<string>>();          // organisation id → contact ids
  const unresolved: ContactRef[] = [];
  for (const cp of cps) {
    const email = cp.email.toLowerCase();
    const c = cmap.get(email);
    if (c) { (groups.get(c.organisation_id) ?? groups.set(c.organisation_id, new Set()).get(c.organisation_id)!).add(c.id); continue; }
    const d = domainOf(email);
    const org = direction === 'out' && d && !isFreeMail(d) ? dmap.get(d) : undefined;
    if (org) { if (!groups.has(org.id)) groups.set(org.id, new Set()); continue; }
    unresolved.push(cp);
  }

  const done = new Set((await db.query<{ organisation_id: string }>('SELECT organisation_id FROM dispatches WHERE item_id = $1', [itemId])).rows.map(r => r.organisation_id));
  const occurredAt = new Date(item.authored_at ?? item.created_at).toISOString();
  const signer = direction === 'out'
    ? (await db.query<{ id: string }>('SELECT id FROM people WHERE email = $1', [(all.find(c => c.role === 'from')?.email ?? '').toLowerCase()])).rows[0]?.id ?? null
    : null;
  const result: SyncResult = { dispatch_ids: [], organisation_ids: [...groups.keys()], proposals: [], pending: false };

  for (const [orgId, contactIds] of [...groups].slice(0, 5)) {
    if (done.has(orgId)) continue;
    const rec: Record<string, unknown> = {
      id: randomUUID(), item_id: item.id, direction, organisation_id: orgId, contact_ids: [...contactIds], channel: 'email', occurred_at: occurredAt,
      reference_no: null, their_reference: null, in_reply_to: await replyTarget(db, item.id, ex, occurredAt, orgId), signed_by: signer,
      acknowledged_at: null, tracking: null, recorded_by: 'mail-capture',
    };
    if (item.title) rec.notes = String(item.title).slice(0, 300);
    check('dispatch', rec);
    await db.query(
      `INSERT INTO dispatches (id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, in_reply_to, signed_by, acknowledged_at, tracking, recorded_by, notes)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [rec.id, item.id, direction, orgId, rec.contact_ids, 'email', occurredAt, null, null, rec.in_reply_to, signer, null, null, 'mail-capture', rec.notes ?? null]);
    await audit(db, 'mail-capture', 'dispatch.create', `project:${item.project_id}`, [`dispatch:${rec.id}`, `doc:${item.id}`, `org:${orgId}`], { status: 201, direction, channel: 'email' });
    result.dispatch_ids.push(rec.id as string);
  }

  const orgIds = [...new Set<string>([...(item.organisation_ids ?? []), ...groups.keys()])];
  const hasDispatch = done.size + result.dispatch_ids.length > 0;
  result.pending = !hasDispatch;
  if (orgIds.length !== (item.organisation_ids ?? []).length || !!ex.dispatch_pending !== result.pending) {
    await db.query(`UPDATE items SET organisation_ids = $2::text[], extracted = extracted || $3::jsonb WHERE id = $1`, [item.id, orgIds, JSON.stringify({ dispatch_pending: result.pending })]);
  }

  if (o.propose !== false) {
    const seen = new Set<string>();
    for (const cp of unresolved) {
      const d = domainOf(cp.email);
      if (!d || seen.has(d)) continue;
      seen.add(d);
      const p = await proposeOrganisation(db, { domain: d, sender_email: cp.email, sender_name: cp.name, item_id: item.id, subject: item.title ?? '', direction });
      if (p) result.proposals.push(p.id);
    }
  }
  return result;
}

/** Give the mail items still waiting for an organisation their Dispatch, now that organisations or contacts may exist. Returns the dispatches created. */
export async function resolvePendingDispatches(db: Db, o: { firm?: string[]; limit?: number } = {}): Promise<number> {
  const rows = (await db.query<{ id: string }>(
    `SELECT id FROM items WHERE type = 'email' AND NOT hidden AND parent_id IS NULL AND extracted->>'dispatch_pending' = 'true' ORDER BY created_at DESC LIMIT $1`, [o.limit ?? 500])).rows;
  let n = 0;
  for (const r of rows) n += (await syncCounterparties(db, r.id, { firm: o.firm, propose: false })).dispatch_ids.length;
  return n;
}

/** Registry contact for an email address, created when there is none. Organisation: the one that owns the domain, else the project's client (free mail), else a new one from the domain. */
export async function ensureContact(db: Db, p: { email: string; name?: string; projectClientId?: string | null }): Promise<{ contact_id: string; organisation_id: string; created: boolean }> {
  const email = p.email.toLowerCase();
  const found = (await contactsByEmail(db, [email])).get(email);
  if (found) return { contact_id: found.id, organisation_id: found.organisation_id, created: false };
  const domain = domainOf(email);
  const free = !domain || isFreeMail(domain);
  let orgId: string | undefined = free ? undefined : (await orgsByDomain(db)).get(domain)?.id;
  if (!orgId && free && p.projectClientId) orgId = p.projectClientId;
  if (!orgId) {
    const name = free ? (p.name || email.split('@')[0]) : orgNameFromDomain(domain);
    const nn = normaliseOrgName(name);
    const same = (await db.query<any>('SELECT id, name FROM organisations')).rows.find(r => normaliseOrgName(r.name) === nn);
    if (same) orgId = same.id;
    else {
      const base = slug(nn, 'org');
      let id = base;
      for (let n = 2; (await db.query('SELECT 1 FROM organisations WHERE id = $1', [id])).rows.length; n++) id = `${base}-${n}`;
      await db.query(`INSERT INTO organisations (id, name, kind, identifiers, notes) VALUES ($1,$2,'other',$3::jsonb,$4)`,
        [id, name, JSON.stringify({ domains: free ? [] : [domain] }), 'Created when a filing-queue message was assigned; confirm the name and kind in the Hub.']);
      await audit(db, 'mail-capture', 'organisation.create', 'firm', [`org:${id}`], { status: 201, source: 'queue-assign' });
      if (!free) await db.query(`UPDATE review_queue SET status = 'accepted', resolved_by = 'mail-capture', resolved_at = now() WHERE kind = 'organisation' AND status = 'open' AND payload->>'domain' = $1`, [domain]);
      orgId = id;
    }
  }
  const name = (p.name || email.split('@')[0]).trim();
  const base = slug(name, 'contact');
  let id = base;
  for (let n = 2; (await db.query('SELECT 1 FROM contacts WHERE id = $1', [id])).rows.length; n++) id = `${base}-${n}`;
  await db.query('INSERT INTO contacts (id, organisation_id, name, emails, notes) VALUES ($1,$2,$3,$4::text[],$5)', [id, orgId, name, [email], 'Added from the filing queue.']);
  await audit(db, 'mail-capture', 'contact.create', 'firm', [`contact:${id}`, `org:${orgId}`], { status: 201, source: 'queue-assign' });
  return { contact_id: id, organisation_id: orgId as string, created: true };
}
