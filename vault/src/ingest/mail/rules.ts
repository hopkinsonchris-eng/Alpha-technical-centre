/**
 * Capture rules (wave 6, D61, P54, P56, P51).
 *   Blocked:   an address or domain on the firm's list, or on the mailbox owner's own list, hides the message whoever else is on it.
 *   Protected: an address or domain on the firm's list; the firm's own domains and everyone with a Hub login are protected by rule.
 *              A message is hidden when every participant is protected (mail between colleagues only).
 *   Bulk:      list and automated mail (headers, no-reply senders, an unsubscribe line in an inbound message) is kept apart.
 *   Memory:    every Assign, Accept and Not a project email is remembered by thread, counterparty domain and attachment
 *              names, so one person's decision files everyone's copies; a thread decided scores 1.0 for that project.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/client.ts';
import { normaliseDomain } from '../../api/organisations.routes.ts';
import { domainOf, firmDomains, isFreeMail } from './classify.ts';
import type { RawMessage } from './types.ts';

export interface Rules { firm: { protected: string[]; blocked: string[] }; personal: Map<string, string[]>; people: Set<string>; firmDomains: string[] }
export type RuleHit = { kind: 'blocked'; detail: string } | { kind: 'protected' } | null;

export async function loadRules(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<Rules> {
  const rows = (await db.query<{ owner_id: string | null; kind: 'protected' | 'blocked'; pattern: string }>('SELECT owner_id, kind, pattern FROM mail_rules')).rows;
  const firm = { protected: [] as string[], blocked: [] as string[] };
  const personal = new Map<string, string[]>();
  for (const r of rows) {
    if (r.owner_id) { if (r.kind === 'blocked') (personal.get(r.owner_id) ?? personal.set(r.owner_id, []).get(r.owner_id)!).push(r.pattern); }
    else firm[r.kind].push(r.pattern);
  }
  const people = new Set((await db.query<{ email: string }>('SELECT lower(email) AS email FROM people')).rows.map(r => r.email));
  return { firm, personal, people, firmDomains: firmDomains(env) };
}

const matches = (address: string, patterns: string[]) => { const d = domainOf(address); return patterns.some(p => p === address || (!p.includes('@') && p === d)); };

/** Why this message must not be kept, by the rules: blocked (firm or the mailbox owner's), or protected (colleagues only). */
export function ruleHit(msg: RawMessage, rules: Rules, ownerId?: string | null): RuleHit {
  const everyone = [msg.from, ...msg.to, ...msg.cc].map(a => a.address.toLowerCase()).filter(Boolean);
  const blocked = [...rules.firm.blocked, ...((ownerId && rules.personal.get(ownerId)) ?? [])];
  for (const a of everyone) if (matches(a, blocked)) return { kind: 'blocked', detail: a };
  const isProtected = (a: string) => rules.people.has(a) || rules.firmDomains.includes(domainOf(a)) || matches(a, rules.firm.protected);
  if (everyone.length && everyone.every(isProtected)) return { kind: 'protected' };
  return null;
}

const NOREPLY = /^(no-?reply|noreply|do-?not-?reply|donotreply|newsletter|news|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|marketing|unsubscribe|digest|info-noreply)([-+._].*)?$/i;
const UNSUB = /\b(unsubscribe|darse de baja|cancelar (la |tu |su )?suscripci[oó]n|manage (your )?preferences|view (this )?(email )?in (your )?browser)\b/i;

/** Bulk: list headers, a no-reply sender, or an unsubscribe line in inbound mail. Returns the evidence, or null for person-to-person mail. */
export function bulkReason(msg: RawMessage, firm: string[] = firmDomains()): string | null {
  if (msg.bulk_signals?.length) return msg.bulk_signals.join(', ');
  const from = msg.from.address.toLowerCase();
  if (!from || firm.includes(domainOf(from))) return null;
  if (NOREPLY.test(from.split('@')[0])) return `sender ${from}`;
  if (msg.folder !== 'sent' && UNSUB.test(msg.text.slice(-3000))) return 'unsubscribe line';
  return null;
}

/* ── the filing memory ── */
export type DecisionKey = { key_kind: 'thread' | 'domain' | 'attachment'; key: string };

/** The keys a message is remembered by: its conversation, each counterparty domain, and each attachment name. */
export function decisionKeys(ex: { thread_id?: string; contacts?: Array<{ email: string; firm?: boolean }>; attachments?: Array<{ filename: string }> }, firm: string[] = firmDomains()): DecisionKey[] {
  const out: DecisionKey[] = [];
  if (ex.thread_id) out.push({ key_kind: 'thread', key: ex.thread_id });
  const seen = new Set<string>();
  for (const c of ex.contacts ?? []) {
    const d = domainOf(String(c.email ?? ''));
    if (!d || c.firm || firm.includes(d) || isFreeMail(d) || seen.has(d)) continue;
    seen.add(d); out.push({ key_kind: 'domain', key: d });
  }
  for (const a of ex.attachments ?? []) { const n = String(a.filename ?? '').toLowerCase().trim(); if (n && n.length >= 6) out.push({ key_kind: 'attachment', key: n }); }
  return out;
}

/** Remember a decision for an item: project_id null means "not a project email". */
export async function rememberDecision(db: Db, itemId: string, projectId: string | null, by: string, firm?: string[]): Promise<number> {
  const row = (await db.query<{ extracted: any }>('SELECT extracted FROM items WHERE id = $1', [itemId])).rows[0];
  if (!row) return 0;
  const keys = decisionKeys(row.extracted ?? {}, firm);
  for (const k of keys) await db.query('INSERT INTO filing_decisions (id, key_kind, key, project_id, item_id, decided_by) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), k.key_kind, k.key, projectId, itemId, by]);
  return keys.length;
}

export interface MemoryHit { signal: 'memory'; project_id: string | null; weight: number; detail: string }

/**
 * What the memory says about a message: a decided thread settles it (weight 1); a counterparty domain decided three
 * times the same way adds 0.35; attachment names decided twice add 0.2. "Not a project email" counts the same way with project_id null.
 */
export async function recallDecisions(db: Db, msg: { thread_id: string; in_reply_to: string | null; references: string[]; from: { address: string }; to: Array<{ address: string }>; cc: Array<{ address: string }>; attachments: Array<{ filename: string }> }, firm: string[] = firmDomains()): Promise<MemoryHit[]> {
  const threadKeys = [...new Set([msg.thread_id, msg.in_reply_to, ...msg.references].filter((x): x is string => !!x))];
  const contacts = [msg.from, ...msg.to, ...msg.cc].map(a => ({ email: a.address }));
  const keys = decisionKeys({ contacts, attachments: msg.attachments }, firm);
  const out: MemoryHit[] = [];
  if (threadKeys.length) {
    const t = (await db.query<{ project_id: string | null }>(`SELECT project_id FROM filing_decisions WHERE key_kind = 'thread' AND key = ANY($1::text[]) ORDER BY decided_at DESC LIMIT 1`, [threadKeys])).rows[0];
    if (t) out.push({ signal: 'memory', project_id: t.project_id, weight: 1, detail: 'this conversation was filed by hand' });
  }
  for (const k of keys) {
    const rows = (await db.query<{ project_id: string | null; n: number }>(`SELECT project_id, count(*)::int AS n FROM filing_decisions WHERE key_kind = $1 AND key = $2 GROUP BY project_id ORDER BY n DESC LIMIT 1`, [k.key_kind, k.key])).rows[0];
    if (!rows) continue;
    const need = k.key_kind === 'domain' ? 3 : 2;
    if (rows.n >= need) out.push({ signal: 'memory', project_id: rows.project_id, weight: k.key_kind === 'domain' ? 0.35 : 0.2, detail: `${k.key_kind} ${k.key} decided ${rows.n} times` });
  }
  return out;
}
