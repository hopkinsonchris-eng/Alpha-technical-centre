/**
 * The terms card (pack rework, docs/vault-hub/wave7/07-pack-rework.md): one model call per build over every original
 * of the country, answered as fixed fields; a value stands only when it cites a stored original. `packQuality` is the
 * bar the card and the tests hold a pack to. Nothing here touches the network.
 */
import { TERMS, TERM_IDS, type PackQuality, type TermId, type TermValue, type TermsCard } from './types.ts';

/** What each field asks for, put to the model verbatim. */
export const TERM_QUESTIONS: Record<TermId, string> = {
  regime: 'The contract or licence regime under which a company explores and produces (concession or licence, production sharing, service or risk service contract, joint venture with the state company, or a mix), named as the law names it.',
  state_share: 'The state or national oil company\'s participation or carried interest in upstream projects, as a share or a rule.',
  royalty: 'The royalty rate or rates on production, and what they apply to.',
  income_tax: 'The income tax rate on upstream oil and gas profits, and any special rate for the sector.',
  special_taxes: 'Other taxes and levies on the sector: extraction, windfall, export, surface, integrated or special hydrocarbon taxes, with rates.',
  cost_recovery: 'Cost recovery, cost oil ceilings, ring-fencing and loss rules where the regime has them.',
  stability: 'Fiscal or legal stability clauses, arbitration and dispute rules for foreign investors.',
  local_content: 'Local content or domestic preference rules for contractors and suppliers.',
  regulator: 'The body that regulates upstream activity and grants rights, named in full with its abbreviation.',
  noc: 'The national oil company and its role in projects.',
  awards: 'How acreage is awarded: licensing rounds, permanent offer, open door, direct negotiation; the current or last round and its date.',
  sanctions: 'Sanctions, embargoes or restrictions that touch the sector or foreign companies working there, and the licences or exemptions in force.',
};

/** The format the model answers in; parsed by parseTermsReply. */
export function termsFormat(): string {
  return [
    'Answer in this exact line format and nothing else. For each TERM give a value only when an original states it; otherwise give nothing for that term and ask in a QUESTION line.',
    ...TERMS.map(t => `TERM ${t.id} EN: <one sentence, with the figure or the name> [doc:<id>]\nTERM ${t.id} ES: <the same in Spanish> [doc:<id>]`),
    'AS OF <term id>: <YYYY-MM-DD the cited original states for the fact, when it states one>',
    'QUESTION EN: <what no original answered>',
    'QUESTION ES: <the same in Spanish>',
    '', 'The terms, with what each asks for:',
    ...TERMS.map(t => `- ${t.id} (${t.en}): ${TERM_QUESTIONS[t.id]}`),
  ].join('\n');
}

export interface ParsedTerms { fields: Partial<Record<TermId, { en?: string; es?: string; as_of?: string }>>; questions: { en: string; es: string }[] }

/** Pairs the EN and ES lines per term; a term without an EN line is absent. */
export function parseTermsReply(text: string): ParsedTerms {
  const out: ParsedTerms = { fields: {}, questions: [] };
  let pendingQ: string | null = null;
  const known = new Set<string>(TERM_IDS);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpExecArray | null;
    if ((m = /^TERM\s+([a-z_]+)\s+(EN|ES)\s*:\s*(.+)$/i.exec(line))) {
      const id = m[1].toLowerCase(); if (!known.has(id)) continue;
      const f = (out.fields[id as TermId] ??= {});
      if (m[2].toUpperCase() === 'EN') f.en = m[3].trim(); else f.es = m[3].trim();
    } else if ((m = /^AS\s+OF\s+([a-z_]+)\s*:\s*(\d{4}-\d{2}-\d{2})/i.exec(line))) {
      const id = m[1].toLowerCase(); if (known.has(id)) (out.fields[id as TermId] ??= {}).as_of = m[2];
    } else if ((m = /^QUESTION\s+EN\s*:\s*(.+)$/i.exec(line))) { if (pendingQ !== null) out.questions.push({ en: pendingQ, es: pendingQ }); pendingQ = m[1].trim(); }
    else if ((m = /^QUESTION\s+ES\s*:\s*(.+)$/i.exec(line))) { if (pendingQ !== null) { out.questions.push({ en: pendingQ, es: m[1].trim() }); pendingQ = null; } else out.questions.push({ en: m[1].trim(), es: m[1].trim() }); }
  }
  if (pendingQ !== null) out.questions.push({ en: pendingQ, es: pendingQ });
  return out;
}

const DOC_CITE_RE = /\[doc:([^\]]+)\]/g;
const strip = (s: string) => { const t = s.replace(/\s*\[(?:run|doc|lesson|ref|wm):[^\]]+\]/g, '').replace(/\s+/g, ' ').trim(); return t && !/[.!?…]$/.test(t) ? `${t}.` : t; };

/**
 * A value stands only when its English line cites an original the build offered; the Spanish inherits the citation.
 * `asOf` gives an original's own date when the model stated none. Unanswered required terms become questions.
 */
export function checkTerms(parsed: ParsedTerms, allowed: Set<string>, asOf: (itemId: string) => string | null): { fields: Record<TermId, TermValue | null>; questions: { en: string; es: string }[]; citations: string[] } {
  const fields = Object.fromEntries(TERM_IDS.map(id => [id, null])) as Record<TermId, TermValue | null>;
  const questions = [...parsed.questions];
  const citations = new Set<string>();
  for (const t of TERMS) {
    const f = parsed.fields[t.id];
    if (!f?.en) continue;
    const cites = [...new Set([...f.en.matchAll(DOC_CITE_RE)].map(m => `doc:${m[1]}`).filter(c => allowed.has(c)))];
    if (!cites.length) { questions.push({ en: `${t.en}: ${strip(f.en)} (not cited to an original)`, es: `${t.es}: ${strip(f.es || f.en)} (sin cita a un original)` }); continue; }
    for (const c of cites) citations.add(c);
    const as_of = f.as_of ?? asOf(cites[0].slice(4)) ?? null;
    fields[t.id] = { en: `${strip(f.en)} ${cites.map(c => `[${c}]`).join(' ')}`, es: `${strip(f.es || f.en)} ${cites.map(c => `[${c}]`).join(' ')}`, cites, as_of };
  }
  for (const t of TERMS) if (t.required && !fields[t.id] && !questions.some(q => q.en.startsWith(`${t.en}:`))) questions.push({ en: `${t.en}: not published in the originals.`, es: `${t.es}: no publicado en los originales.` });
  return { fields, questions, citations: [...citations] };
}

/** The bar: every required term carries a cited value. */
export function packQuality(terms: TermsCard | null): PackQuality {
  const missing = TERMS.filter(t => t.required && !(terms?.fields?.[t.id]?.cites?.length)).map(t => t.id);
  return { ok: !!terms && missing.length === 0, missing };
}

/** The card as markdown lines (the connector resource prints it first). */
export function termsMarkdown(terms: TermsCard | null, quality: PackQuality): string[] {
  const lines: string[] = ['## Terms · Términos', ''];
  if (!terms) { lines.push('- Not drafted yet.', ''); return lines; }
  lines.push(`- Status: ${terms.status}${terms.stale_reason ? ` (${terms.stale_reason})` : ''}; as of ${terms.built_at ? terms.built_at.slice(0, 10) : 'undated'}; version ${terms.version}; ${quality.ok ? 'meets the bar' : `below standard: missing ${quality.missing.join(', ')}`}`);
  for (const t of TERMS) {
    const v = terms.fields[t.id];
    lines.push(`- ${t.en} · ${t.es}: ${v ? `${v.en}${v.as_of ? ` (as of ${v.as_of})` : ''}` : 'not published'}`);
    if (v) lines.push(`  - ES: ${v.es}`);
  }
  if (terms.questions.length) { lines.push('- Questions:'); for (const q of terms.questions) lines.push(`  - ${q.en}`, `    - ES: ${q.es}`); }
  lines.push('');
  return lines;
}
