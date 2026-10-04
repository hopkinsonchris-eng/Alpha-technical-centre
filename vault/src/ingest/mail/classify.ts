/**
 * Project classifier and exclusion rules for captured mail (M10).
 *
 * Signals, per project (raw score 0..1):
 *   contact  0.5  a sender or recipient address is on the project's contact list
 *   domain   0.35 no address match, but a participant's domain is the domain of one of the project's contacts or of its client
 *                 (free-mail domains never count)
 *   thread   0.3  the message continues a conversation already filed to the project
 *   tokens   0.2  the project name, client name or asset names appear in the subject (full weight) or body (half)
 *
 * The score becomes a confidence on a fixed curve: 0.5 (a full address match) maps to 0.85, the filing threshold, so a known
 * contact files directly and an unknown sender never does; 0.35 (domain) maps to 0.595 and needs a thread or token hit to file;
 * 1.0 maps to 1.0. When the top candidates are within 0.1 of each other and the winner would otherwise file, the provider
 * breaks the tie; without an answer (no provider, bad reply) their confidence is capped at 0.6 and the message goes to the queue.
 *
 * The exclusion list (settings key `mail_exclusions`: addresses, domains, label names) and personal labels decide whether a
 * message is ingested at all.
 */
import type { Db } from '../../db/client.ts';
import type { LlmProvider } from '../../llm/provider.ts';
import { normaliseDomain, normaliseOrgName } from '../../api/organisations.routes.ts';
import type { RawMessage } from './types.ts';
import { recallDecisions } from './rules.ts';

export const FILE_THRESHOLD = 0.85;
export const WEIGHTS = { contact: 0.5, domain: 0.35, thread: 0.3, tokens: 0.2 } as const;
const TIE_WINDOW = 0.1;
const UNRESOLVED_CAP = 0.6;

export type Signal = 'contact' | 'domain' | 'thread' | 'tokens' | 'llm' | 'memory';
/** ready: one candidate at or above READY_THRESHOLD on a message with a known counterparty, so one tap files it; review: anything else unfiled. */
export const READY_THRESHOLD = 0.6;
export interface Evidence { signal: Signal; detail: string; weight: number }
export interface Candidate { project_id: string; score: number; confidence: number; evidence: Evidence[] }
export interface Classification {
  project_id: string | null;
  confidence: number;
  evidence: Evidence[];
  /** Every project with a non-zero score, best first. */
  candidates: Candidate[];
  tie_break?: 'llm' | 'unresolved';
  /** The memory said "not a project email" for this conversation (P51): file to the firm inbox, do not queue. */
  dismissed?: boolean;
}
export interface ClassifyOptions { provider?: LlmProvider | null; firmDomains?: string[]; threshold?: number; /** Consult the filing memory (default true). */ memory?: boolean }

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com', 'aol.com', 'zoho.com', 'gmx.com', 'msn.com']);
export const isFreeMail = (d: string) => FREE_MAIL.has(d);

export function firmDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.MAIL_FIRM_DOMAINS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([(env.ALLOWED_EMAIL_DOMAIN ?? 'alpha-technical-centre.com').toLowerCase(), ...extra])];
}
export const domainOf = (address: string) => normaliseDomain(address.split('@')[1] ?? '');
export const isFirmAddress = (address: string, firm: string[]) => firm.includes(domainOf(address));

/** score 0..1 → confidence 0..1 (see the header). */
export function confidenceOf(score: number): number {
  const c = score <= 0.5 ? (0.85 * score) / 0.5 : 0.85 + (score - 0.5) * 0.3;
  return Math.round(Math.min(1, Math.max(0, c)) * 1000) / 1000;
}

/* ── text ────────────────────────────────────────────────────────────── */

const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s: string) => ascii(s).replace(/[^a-z0-9]+/g, ' ').trim();
const STOP = new Set(('the and for with from into over under this that these those about your our their its a an of in on at to by as or de la el los las del y en con por para un una que se al lo su sus project projects proyecto proyectos study estudio screening review analysis analisis ' +
  'field campo basin cuenca block bloque development desarrollo economics economia partnership update data report informe note notes plan planning brownfield greenfield workshop request').split(/\s+/));

/* ── project index ───────────────────────────────────────────────────── */

interface ProjectInfo {
  id: string; name: string; client: string | null; status: string; assets: string[];
  emails: Set<string>; domains: Set<string>;
  phrases: string[]; words: string[];
}

async function loadIndex(db: Db): Promise<ProjectInfo[]> {
  const projects = (await db.query<any>(`SELECT p.id, p.name, p.status, p.asset_ids, p.client_id, o.name AS client_name, o.identifiers AS client_identifiers
      FROM projects p LEFT JOIN organisations o ON o.id = p.client_id WHERE p.id <> 'firm'`)).rows;
  const contacts = (await db.query<any>(`SELECT pc.project_id, c.emails, o.identifiers FROM project_contacts pc JOIN contacts c ON c.id = pc.contact_id JOIN organisations o ON o.id = c.organisation_id`)).rows;
  const assets = new Map((await db.query<any>('SELECT id, name FROM assets')).rows.map(a => [a.id as string, a.name as string]));
  const byProject = new Map<string, ProjectInfo>();
  for (const p of projects) {
    const domains = new Set<string>();
    for (const d of p.client_identifiers?.domains ?? []) domains.add(normaliseDomain(d));
    byProject.set(p.id, {
      id: p.id, name: p.name, client: p.client_name ?? null, status: p.status,
      assets: (p.asset_ids ?? []).map((a: string) => assets.get(a)).filter(Boolean) as string[],
      emails: new Set(), domains, phrases: [], words: [],
    });
  }
  for (const c of contacts) {
    const p = byProject.get(c.project_id);
    if (!p) continue;
    for (const e of c.emails ?? []) { p.emails.add(String(e).toLowerCase()); const d = domainOf(String(e)); if (d) p.domains.add(d); }
    for (const d of c.identifiers?.domains ?? []) p.domains.add(normaliseDomain(d));
  }
  for (const p of byProject.values()) for (const d of [...p.domains]) if (isFreeMail(d) || !d) p.domains.delete(d);
  // Terms: client name and asset names as phrases; project-name words that no other project's name uses.
  const nameWords = new Map<string, Set<string>>();
  for (const p of byProject.values()) nameWords.set(p.id, new Set(words(p.name).split(' ').filter(w => w.length >= 4 && !STOP.has(w))));
  for (const p of byProject.values()) {
    if (p.client) { const c = normaliseOrgName(p.client); if (c.length >= 4) p.phrases.push(c); }
    for (const a of p.assets) { const w = words(a); if (w.length >= 3) p.phrases.push(w); }
    const others = new Set<string>();
    for (const [id, ws] of nameWords) if (id !== p.id) for (const w of ws) others.add(w);
    const clientWords = new Set(p.client ? words(p.client).split(' ') : []);
    p.words = [...nameWords.get(p.id)!].filter(w => !others.has(w) && !clientWords.has(w));
  }
  return [...byProject.values()];
}

/** project_id → messages of this conversation already filed there (not in the unfiled 'firm' inbox). */
async function threadProjects(db: Db, msg: RawMessage): Promise<Map<string, number>> {
  const ids = [...new Set([msg.in_reply_to, ...msg.references, msg.thread_id].filter((x): x is string => !!x && x !== msg.external_id))];
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = (await db.query<{ project_id: string; n: number }>(
    `SELECT project_id, count(*)::int AS n FROM items
      WHERE type = 'email' AND NOT hidden AND project_id <> 'firm' AND parent_id IS NULL
        AND origin->>'source' IN ('zoho-mail','gmail')
        AND (external_id = ANY($1::text[]) OR extracted->>'thread_id' = ANY($1::text[]))
      GROUP BY project_id`, [ids])).rows;
  for (const r of rows) out.set(r.project_id, r.n);
  return out;
}

/* ── scoring ─────────────────────────────────────────────────────────── */

export async function classify(db: Db, msg: RawMessage, opts: ClassifyOptions = {}): Promise<Classification> {
  const firm = opts.firmDomains ?? firmDomains();
  const threshold = opts.threshold ?? FILE_THRESHOLD;
  const [index, threads, memory] = await Promise.all([loadIndex(db), threadProjects(db, msg), opts.memory === false ? [] : recallDecisions(db, msg, firm)]);
  const settled = memory.find(m => m.weight >= 1);
  if (settled) {
    const ev: Evidence = { signal: 'memory', detail: settled.detail, weight: 1 };
    if (!settled.project_id) return { project_id: null, confidence: 0, evidence: [ev], candidates: [], dismissed: true };
    return { project_id: settled.project_id, confidence: 1, evidence: [ev], candidates: [{ project_id: settled.project_id, score: 1, confidence: 1, evidence: [ev] }] };
  }
  const participants = [msg.from, ...msg.to, ...msg.cc].map(a => a.address.toLowerCase()).filter(a => a && !isFirmAddress(a, firm));
  const subject = ` ${words(msg.subject)} `;
  const body = ` ${words(msg.text.slice(0, 6000))} `;
  const subjectTokens = subject.trim().split(' '), bodyTokens = body.trim().split(' ');
  // A distinctive name word matches itself and longer forms of it (fiscal → fiscales).
  const has = (tokens: string[], w: string) => tokens.some(t => t === w || (w.length >= 5 && t.length > w.length && t.startsWith(w)));

  const candidates: Candidate[] = [];
  for (const p of index) {
    if ((p.status === 'closed' || p.status === 'archived') && !threads.has(p.id)) continue;
    const evidence: Evidence[] = [];
    const hit = participants.find(a => p.emails.has(a));
    if (hit) evidence.push({ signal: 'contact', detail: hit, weight: WEIGHTS.contact });
    else {
      const d = participants.map(domainOf).find(x => x && !isFreeMail(x) && p.domains.has(x));
      if (d) evidence.push({ signal: 'domain', detail: d, weight: WEIGHTS.domain });
    }
    if (threads.has(p.id)) evidence.push({ signal: 'thread', detail: `${threads.get(p.id)} earlier message(s) in this conversation filed here`, weight: WEIGHTS.thread });

    let hits = 0; const found: string[] = [];
    for (const ph of p.phrases) {
      const q = ` ${ph} `;
      if (subject.includes(q)) { hits += 1; found.push(ph); } else if (body.includes(q)) { hits += 0.5; found.push(ph); }
    }
    for (const w of p.words) {
      if (has(subjectTokens, w)) { hits += 1; found.push(w); } else if (has(bodyTokens, w)) { hits += 0.5; found.push(w); }
    }
    if (hits > 0) evidence.push({ signal: 'tokens', detail: found.slice(0, 6).join(', '), weight: Math.round(WEIGHTS.tokens * Math.min(1, hits / 2) * 1000) / 1000 });
    for (const m of memory) if (m.project_id === p.id && m.weight < 1) evidence.push({ signal: 'memory', detail: m.detail, weight: m.weight });

    const score = Math.round(evidence.reduce((s, e) => s + e.weight, 0) * 1000) / 1000;
    if (score > 0) candidates.push({ project_id: p.id, score, confidence: confidenceOf(score), evidence });
  }
  candidates.sort((a, b) => b.score - a.score || a.project_id.localeCompare(b.project_id));
  if (!candidates.length) return { project_id: null, confidence: 0, evidence: [], candidates: [] };

  const top = candidates[0];
  const tied = candidates.filter(c => top.score - c.score <= TIE_WINDOW + 1e-9);
  if (tied.length < 2 || top.confidence < threshold) return { project_id: top.project_id, confidence: top.confidence, evidence: top.evidence, candidates };

  const pick = await tieBreak(opts.provider ?? null, msg, tied.slice(0, 4), index);
  if (pick) {
    const chosen = candidates.find(c => c.project_id === pick.project_id)!;
    const confidence = Math.min(chosen.confidence, pick.confidence);
    const evidence = [...chosen.evidence, { signal: 'llm' as const, detail: `tie-break chose ${chosen.project_id} (${pick.confidence})`, weight: 0 }];
    chosen.confidence = confidence; chosen.evidence = evidence;
    for (const c of tied) if (c !== chosen) c.confidence = Math.min(c.confidence, UNRESOLVED_CAP);
    candidates.sort((a, b) => b.confidence - a.confidence || b.score - a.score);
    return { project_id: chosen.project_id, confidence, evidence, candidates, tie_break: 'llm' };
  }
  for (const c of tied) c.confidence = Math.min(c.confidence, UNRESOLVED_CAP);
  return { project_id: top.project_id, confidence: top.confidence, evidence: [...top.evidence, { signal: 'llm', detail: `tied with ${tied.slice(1).map(c => c.project_id).join(', ')}; no tie-break`, weight: 0 }], candidates, tie_break: 'unresolved' };
}

async function tieBreak(provider: LlmProvider | null, msg: RawMessage, tied: Candidate[], index: ProjectInfo[]): Promise<{ project_id: string; confidence: number } | null> {
  if (!provider) return null;
  const info = new Map(index.map(p => [p.id, p]));
  const list = tied.map(c => {
    const p = info.get(c.project_id)!;
    return `- id: ${p.id}\n  name: ${p.name}\n  client: ${p.client ?? 'none'}\n  assets: ${p.assets.join(', ') || 'none'}\n  matched on: ${c.evidence.map(e => `${e.signal} ${e.detail}`).join('; ')}`;
  }).join('\n');
  const user = `From: ${msg.from.address}\nTo: ${msg.to.map(a => a.address).join(', ')}\nSubject: ${msg.subject}\n\n${msg.text.slice(0, 1500)}\n\nCandidate projects:\n${list}`;
  try {
    const r = await provider.complete({
      system: 'You file one email into exactly one of the candidate projects of a consulting firm. Judge from the content, not from who wrote it. ' +
        'Reply with JSON only: {"project_id": "<one candidate id, or none>", "confidence": <number 0 to 1>}. Use none when the content does not settle it.',
      messages: [{ role: 'user', content: user }], maxTokens: 120, temperature: 0,
    });
    const j = /\{[\s\S]*\}/.exec(r.text)?.[0];
    if (!j) return null;
    const o = JSON.parse(j);
    const id = typeof o.project_id === 'string' ? o.project_id : '';
    const conf = Number(o.confidence);
    if (!tied.some(c => c.project_id === id) || !Number.isFinite(conf)) return null;
    return { project_id: id, confidence: Math.round(Math.min(1, Math.max(0, conf)) * 1000) / 1000 };
  } catch { return null; }
}

/* ── exclusions ──────────────────────────────────────────────────────── */

export interface Exclusions { addresses: string[]; domains: string[]; labels: string[] }
export type ExclusionReason = { kind: 'address' | 'domain' | 'label' | 'personal-label' };

const normLabel = (l: string) => l.trim().replace(/^[\\$]+/, '').toLowerCase();
const PERSONAL = /^(personal|private|privado|personal[\/.:_ -].*)$/;

/** settings.mail_exclusions: {addresses, domains, labels}, or a flat list where entries with @ are addresses (or @domain) and the rest are label names. */
export async function loadExclusions(db: Db): Promise<Exclusions> {
  const row = (await db.query<{ value: any }>(`SELECT value FROM settings WHERE key = 'mail_exclusions'`)).rows[0];
  return parseExclusions(row?.value);
}
export function parseExclusions(v: unknown): Exclusions {
  const out: Exclusions = { addresses: [], domains: [], labels: [] };
  const add = (s: unknown, as?: 'address' | 'label') => {
    if (typeof s !== 'string' || !s.trim()) return;
    const t = s.trim().toLowerCase();
    if (as === 'label' || (!as && !t.includes('@'))) { out.labels.push(normLabel(t)); return; }
    if (t.startsWith('@') || t.startsWith('*@')) out.domains.push(normaliseDomain(t.replace(/^\*?@/, '')));
    else out.addresses.push(t);
  };
  if (Array.isArray(v)) v.forEach(s => add(s));
  else if (v && typeof v === 'object') {
    const o = v as any;
    for (const s of Array.isArray(o.addresses) ? o.addresses : []) add(s, 'address');
    for (const s of Array.isArray(o.domains) ? o.domains : []) out.domains.push(normaliseDomain(String(s)));
    for (const s of Array.isArray(o.labels) ? o.labels : []) add(s, 'label');
  }
  return out;
}

/** Why this message must not be ingested, or null. Excluded senders and labels, and personal labels, always; recipients only when the firm sent it. */
export function excludedReason(msg: RawMessage, ex: Exclusions, firm: string[] = firmDomains()): ExclusionReason | null {
  if (msg.labels.some(l => PERSONAL.test(normLabel(l)))) return { kind: 'personal-label' };
  if (msg.labels.some(l => ex.labels.includes(normLabel(l)))) return { kind: 'label' };
  const check = (a: string): ExclusionReason | null => {
    const addr = a.toLowerCase();
    if (ex.addresses.includes(addr)) return { kind: 'address' };
    if (ex.domains.includes(domainOf(addr))) return { kind: 'domain' };
    return null;
  };
  const fromHit = check(msg.from.address);
  if (fromHit) return fromHit;
  if (msg.folder === 'sent' || isFirmAddress(msg.from.address, firm)) for (const a of [...msg.to, ...msg.cc]) { const h = check(a.address); if (h) return h; }
  return null;
}
