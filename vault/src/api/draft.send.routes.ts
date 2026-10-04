/**
 * Send from the person's own mailbox (wave 6, docs/vault-hub/wave6/05-markup.md §1.5; D63, P60; W6-AC9).
 *   POST /api/items/:id/send   {organisation_id, contact_ids[], subject?, cc?, attachment: 'docx'|'pdf'|'none', cover?}
 * The draft is rendered through the Vault's own render route, the file uploaded to Zoho, the message sent from the
 * connected address (never another), the dispatch row written and the draft frozen, exactly as Mark as sent does.
 * A person without a connection, or whose grant lacks the send scope, is told so (409) and keeps Mark as sent.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Env } from '../app.ts';
import type { RouteDeps } from './index.ts';
import { ApiError, assertVisible, bad, conflict, jsonBody, loadAccess, notFound, requireWritableProject, route, scopeLabel, uuidParam } from './common.ts';
import { openSecret, tokenKeyFromEnv } from '../secrets.ts';
import { SEND_SCOPE, zohoMailClientFromEnv } from '../ingest/mail/zoho-oauth.ts';
import { sendMail, ZohoSendError } from '../ingest/mail/zoho-send.ts';

export interface SendDeps { fetch?: typeof fetch; env?: NodeJS.ProcessEnv; now?: () => Date }
let deps: SendDeps = {};
/** Tests inject the Zoho endpoints (fetch), the environment (client, token key) and the clock. */
export function configureSend(d: SendDeps) { deps = { ...deps, ...d }; }
const env = () => deps.env ?? process.env;

const ATTACHMENTS = ['docx', 'pdf', 'none'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function register(app: Hono<Env>, { db }: RouteDeps): void {
  route(app, 'POST', '/api/items/:id/send', 'draft.send', async (x) => {
    const id = uuidParam(x.c);
    const b = await jsonBody(x.c);
    if (typeof b.organisation_id !== 'string' || !b.organisation_id) throw bad('organisation_id is required', '/organisation_id');
    if (!Array.isArray(b.contact_ids) || !b.contact_ids.length || !b.contact_ids.every((c: unknown) => typeof c === 'string')) throw bad('contact_ids must name at least one contact', '/contact_ids');
    const attachment = b.attachment ?? 'docx';
    if (!(ATTACHMENTS as readonly unknown[]).includes(attachment)) throw bad(`attachment must be one of ${ATTACHMENTS.join(', ')}`, '/attachment');
    if (b.from !== undefined) throw bad('the message leaves from your connected mailbox; from cannot be chosen', '/from');
    const cc: string[] = Array.isArray(b.cc) ? b.cc.map(String) : [];
    if (cc.some(a => !EMAIL_RE.test(a))) throw bad('cc must be email addresses', '/cc');

    const row = (await x.db.query<any>('SELECT id, title, project_id, legal_tag, hidden, type, extracted, reference_no FROM items WHERE id = $1', [id])).rows[0];
    if (!row || row.hidden || row.extracted?.kind !== 'draft') throw notFound(`draft ${id} not found`);
    x.a.refs = [`doc:${row.id}`, `org:${b.organisation_id}`]; x.a.scope = scopeLabel(row.project_id);
    const acc = await loadAccess(x.db, x.person, x.now);
    assertVisible(acc, row.legal_tag, row.project_id, `draft ${id}`, row);
    if (row.project_id) requireWritableProject(acc, row.project_id);
    if (row.extracted.sent || (await x.db.query('SELECT 1 FROM dispatches WHERE item_id = $1 AND direction = $2', [row.id, 'out'])).rows[0]) throw conflict(`draft ${id} was already sent; a later version is a new draft`);

    // The person's own mailbox, with the send scope.
    const conn = (await x.db.query<any>(`SELECT * FROM mailbox_connections WHERE person_id = $1 AND status <> 'revoked' ORDER BY connected_at DESC LIMIT 1`, [x.person.id])).rows[0];
    if (!conn) throw new ApiError(409, 'no_mailbox', 'connect your mailbox (Settings → Your mailbox) to send from here; Mark as sent records a message sent elsewhere');
    if (!(conn.scopes ?? []).includes(SEND_SCOPE)) throw new ApiError(409, 'no_send_scope', 'your mailbox connection does not allow sending; reconnect it from Settings to allow it');
    const key = tokenKeyFromEnv(env()), client = zohoMailClientFromEnv(env());
    if (!key || !client) throw new ApiError(503, 'not_configured', 'sending needs ZOHO_MAIL_CLIENT_ID, ZOHO_MAIL_CLIENT_SECRET and VAULT_TOKEN_KEY on the server');

    // Recipients: the named contacts of the organisation, first address each.
    const org = (await x.db.query<any>('SELECT id, name FROM organisations WHERE id = $1', [b.organisation_id])).rows[0];
    if (!org) throw bad(`organisation "${b.organisation_id}" does not exist`, '/organisation_id', 'unknown_organisation');
    const contacts = (await x.db.query<any>('SELECT id, name, emails FROM contacts WHERE id = ANY($1::text[]) AND organisation_id = $2', [b.contact_ids, org.id])).rows;
    const missing = (b.contact_ids as string[]).filter(c => !contacts.some((k: any) => k.id === c));
    if (missing.length) throw new ApiError(409, 'unknown_contact', `contact(s) ${missing.join(', ')} are not contacts of ${org.id}`);
    const to = contacts.map((c: any) => (c.emails ?? [])[0]).filter((a: string) => a && EMAIL_RE.test(a));
    if (!to.length) throw new ApiError(409, 'no_address', `none of the contacts has an email address`);

    // The body: the kept paragraphs for an email; a cover line and the letterhead file for anything else.
    const ex = row.extracted;
    const kept: string[] = (ex.paragraphs as string[]).filter((p, i) => !/^\[QUESTION FOR YOU/.test(p) && ex.review?.decisions?.[i] !== 'drop').map(p => p.replace(/\s*\[(?:run|doc|lesson|ref|wm):[^\]]+\]/g, ''));
    const subject: string = typeof b.subject === 'string' && b.subject.trim() ? b.subject.trim().slice(0, 200) : (ex.brief ? String(ex.brief).slice(0, 120) : row.title);
    const attachments: Array<{ filename: string; mime: string; bytes: Uint8Array }> = [];
    let reference_no: string | null = row.reference_no ?? ex.reference_no ?? null;
    if (attachment !== 'none') {
      const headers = new Headers(); const jwt = x.c.req.header('cf-access-jwt-assertion'); if (jwt) headers.set('cf-access-jwt-assertion', jwt);
      headers.set('content-type', 'application/json');
      const rendered = await app.request(`/api/render?format=${attachment}`, { method: 'POST', headers, body: JSON.stringify({ draft_id: row.id, subject }) });
      if (!rendered.ok) { const j: any = await rendered.json().catch(() => ({})); throw new ApiError(rendered.status === 501 ? 501 : 502, j?.error?.code ?? 'render_failed', `the ${attachment.toUpperCase()} could not be rendered: ${j?.error?.message ?? rendered.status}`); }
      const cd = rendered.headers.get('content-disposition') ?? '';
      const filename = (/filename="([^"]+)"/.exec(cd) ?? [])[1] ?? `draft.${attachment}`;
      reference_no = reference_no ?? filename.replace(/\.(docx|pdf)$/, '');
      attachments.push({ filename, mime: rendered.headers.get('content-type') ?? 'application/octet-stream', bytes: new Uint8Array(await rendered.arrayBuffer()) });
    }
    const cover: string = typeof b.cover === 'string' && b.cover.trim() ? b.cover.trim() : (ex.language === 'es' ? `Adjuntamos nuestra carta ${reference_no ?? ''}.`.replace('  ', ' ') : `Please find attached our letter ${reference_no ?? ''}.`.replace('  ', ' '));
    const text = ex.draft_kind === 'email' || attachment === 'none' ? kept.join('\n\n') : cover;

    let result;
    try {
      result = await sendMail({ address: conn.address, accountId: conn.account_id, apiUrl: conn.api_url, accountsUrl: conn.accounts_url, clientId: client.clientId, clientSecret: client.clientSecret, refreshToken: openSecret(conn.refresh_token_enc, key) }, { to, cc, subject, text, attachments }, deps.fetch ?? fetch);
    } catch (e) { throw e instanceof ZohoSendError ? new ApiError(e.status === 429 ? 429 : 502, 'send_failed', e.message) : e; }

    // The record: the same dispatch row Mark as sent writes, plus how it left.
    const dispatchId = randomUUID();
    const at = (deps.now?.() ?? x.now).toISOString();
    await x.db.query(`INSERT INTO dispatches (id, item_id, direction, organisation_id, contact_ids, channel, occurred_at, reference_no, their_reference, signed_by, recorded_by, notes)
                      VALUES ($1,$2,'out',$3,$4::text[],'email',$5,$6,NULL,$7,$7,$8)`, [dispatchId, row.id, org.id, contacts.map((c: any) => c.id), at, reference_no, x.person.id, `Sent from ${conn.address} through the Hub`]);
    const sent = { dispatch_id: dispatchId, at, by: x.person.id, channel: 'email', organisation: org.name, organisation_id: org.id, to: contacts.map((c: any) => c.id), addresses: to, from: conn.address, subject, zoho_message_id: result.message_id || null, attachments: result.attachments, reference_no, via: 'zoho-mail' };
    await x.db.query("UPDATE items SET extracted = jsonb_set(extracted, '{sent}', $2::jsonb), reference_no = coalesce(reference_no, $3) WHERE id = $1", [row.id, JSON.stringify(sent), reference_no]);
    x.a.detail = { to: to.length, cc: cc.length, attachment, from: conn.address, zoho_message_id: result.message_id || null };
    return { status: 201, body: { id: dispatchId, item_id: row.id, direction: 'out', organisation_id: org.id, contact_ids: contacts.map((c: any) => c.id), channel: 'email', occurred_at: at, reference_no, from: conn.address, to, subject, attachments: result.attachments, zoho_message_id: result.message_id || null } };
  });
}
