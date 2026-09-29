/**
 * Typed extraction for legal and finance documents (M09): nda, contract, licence, insurance, invoice,
 * purchase-order, proposal, timesheet, expense. Pulls parties, dates (effective, expiry, issue, due),
 * amounts and currency, governing law, paid status and a reference number, each with an evidence quote
 * copied from the text.
 *
 * Heuristics (regex) run first. An optional provider pass asks for the same fields as JSON, validates it
 * with zod, drops any fact whose quote is not found verbatim in the document, and only fills what the
 * heuristics missed, so a model cannot overwrite or invent evidence.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { LlmProvider } from '../llm/provider.ts';

export const LEGAL_FINANCE_TYPES = ['nda', 'contract', 'licence', 'insurance', 'invoice', 'purchase-order', 'proposal', 'timesheet', 'expense'] as const;
export type LegalFinanceType = (typeof LEGAL_FINANCE_TYPES)[number];
export const isLegalFinanceType = (t: string): t is LegalFinanceType => (LEGAL_FINANCE_TYPES as readonly string[]).includes(t);

export interface Ev<T = string> { value: T; quote: string; derived?: boolean }
export interface Party { name: string; role: string | null; quote: string }
export interface Amount { label: string; amount: number; currency: string | null; quote: string }
export interface LegalFinance {
  type: LegalFinanceType;
  parties: Party[];
  dates: { effective?: Ev; expiry?: Ev; issue?: Ev; due?: Ev };
  amounts: Amount[];
  total?: Amount;
  currency?: Ev;
  governing_law?: Ev;
  paid_status?: Ev<'paid' | 'unpaid' | 'partial'>;
  reference?: Ev;
  confidentiality_term?: Ev;
  /** Finance and legal records are partners-only unless the project says otherwise. */
  partners_only: true;
  method: 'heuristic' | 'heuristic+llm';
}

/* ── type inference (used by upload and sync when no type is given) ──── */

const TYPE_KEYWORDS: Array<[RegExp, string]> = [
  [/non[ -]?disclosure|\bnda\b|confidentiality agreement|acuerdo de confidencialidad/, 'nda'],
  [/purchase order|\bpo[ -]?\d|orden de compra/, 'purchase-order'],
  [/invoice|factura|\binv[ -]?\d/, 'invoice'],
  [/timesheet|time sheet|hoja de horas/, 'timesheet'],
  [/expense|reimbursement|gastos/, 'expense'],
  [/proposal|propuesta|quotation|\bquote\b/, 'proposal'],
  [/insurance|\bpolicy\b|p[oó]liza|seguro/, 'insurance'],
  [/licen[cs]e|licencia/, 'licence'],
  [/contract|agreement|contrato|\bmsa\b|engagement letter|subcontract/, 'contract'],
];

export function inferType(filename: string, mime = '', head = ''): string {
  const name = filename.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[_\-.]+/g, ' ');
  for (const [re, t] of TYPE_KEYWORDS) if (re.test(name)) return t;
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
  if (['txt', 'md', 'markdown', 'text'].includes(ext) && head) {
    const top = head.slice(0, 400).toLowerCase();
    for (const [re, t] of TYPE_KEYWORDS) if (re.test(top)) return t;
  }
  if (['xlsx', 'xls', 'xlsm', 'csv', 'tsv'].includes(ext) || /spreadsheet|excel|csv/.test(mime)) return 'spreadsheet';
  if (ext === 'pptx' || /presentation/.test(mime)) return 'presentation';
  if (ext === 'eml' || /rfc822/.test(mime)) return 'email';
  if (['pdf', 'docx'].includes(ext) || /pdf|wordprocessing/.test(mime)) return 'report';
  if (['txt', 'md', 'markdown', 'text'].includes(ext)) return 'note';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff'].includes(ext) || /^image\//.test(mime)) return 'image';
  return 'other';
}

/* ── dates ───────────────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_SRC = [
  String.raw`\d{4}-\d{2}-\d{2}`,
  String.raw`\d{1,2}(?:st|nd|rd|th)?(?:\s+de)?\s+(?:${MONTH_RE})\.?,?(?:\s+de)?\s+\d{4}`,
  String.raw`(?:${MONTH_RE})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`,
  String.raw`\d{1,2}[/.-]\d{1,2}[/.-]\d{4}`,
].join('|');

const pad = (n: number) => String(n).padStart(2, '0');
const validYmd = (y: number, m: number, d: number) => y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseDate(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? t : null;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) { const [d, mo, y] = [+m[1], +m[2], +m[3]]; return validYmd(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; } // day-first
  m = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?(?: de)? (${MONTH_RE})\.?,?(?: de)? (\d{4})$`).exec(t);
  if (m) return validYmd(+m[3], MONTHS[m[2]], +m[1]) ? `${m[3]}-${pad(MONTHS[m[2]])}-${pad(+m[1])}` : null;
  m = new RegExp(String.raw`^(${MONTH_RE})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$`).exec(t);
  if (m) return validYmd(+m[3], MONTHS[m[1]], +m[2]) ? `${m[3]}-${pad(MONTHS[m[1]])}-${pad(+m[2])}` : null;
  return null;
}

function addTerm(iso: string, n: number, unit: 'year' | 'month' | 'day'): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (unit === 'year') dt.setUTCFullYear(dt.getUTCFullYear() + n);
  else if (unit === 'month') dt.setUTCMonth(dt.getUTCMonth() + n);
  else dt.setUTCDate(dt.getUTCDate() + n);
  // term ends the day before the anniversary for years and months
  if (unit !== 'day') dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/* ── quotes ──────────────────────────────────────────────────────────── */

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The sentence or line around [index, index+len), whitespace-collapsed, at most ~300 chars. */
function quoteAround(text: string, index: number, len: number): string {
  const start = Math.max(0, text.slice(0, index).lastIndexOf('\n') + 1);
  let lineEnd = text.indexOf('\n', index + len);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(start, lineEnd);
  if (line.length <= 300) return squash(line);
  // A long line is a paragraph: cut at the sentence around the match.
  const before = text.slice(start, index);
  const prev = [...before.matchAll(/[.!?]["')\]]*\s+/g)].pop();
  const a = prev ? start + prev.index! + prev[0].length : start;
  const next = /[.!?]["')\]]*(?=\s|$)/.exec(text.slice(index + len, lineEnd));
  const b = next ? index + len + next.index + next[0].length : lineEnd;
  const q = squash(text.slice(a, b));
  if (q.length <= 300) return q;
  const from = Math.max(0, Math.min(index - a - 100, q.length - 300));
  let w = q.slice(from, from + 300);
  if (from > 0) w = w.slice(w.indexOf(' ') + 1);
  if (from + 300 < q.length) w = w.slice(0, w.lastIndexOf(' '));
  return w;
}

/** True when `quote` occurs in `text`, ignoring whitespace runs and case. */
export const quoteInText = (text: string, quote: string) => squash(text).toLowerCase().includes(squash(quote).toLowerCase());

/* ── amounts ─────────────────────────────────────────────────────────── */

const CODES = 'USD|EUR|GBP|COP|ARS|PEN|BRL|MXN|CAD|CLP|AUD|CHF|VES';
const SYMBOL_CODE: Record<string, string> = { 'US$': 'USD', '$': 'USD', '€': 'EUR', '£': 'GBP', dollars: 'USD', euros: 'EUR' };
const NUM = String.raw`\d[\d.,]*\d|\d`;
const AMOUNT_A = new RegExp(String.raw`(US\$|${CODES}|€|£|\$)\s?(${NUM})`, 'g');
const AMOUNT_B = new RegExp(String.raw`(${NUM})\s?(${CODES}|dollars|euros)\b`, 'gi');
const LABELLED = new RegExp(String.raw`\b(grand total|total due|total amount|amount due|balance due|total a pagar|importe total|total|subtotal|sub-total)\b[^\d\n]{0,25}(${NUM})`, 'gi');

export function parseNumber(raw: string): number | null {
  let s = raw.replace(/\s/g, '');
  const c = s.lastIndexOf(','), d = s.lastIndexOf('.');
  if (c >= 0 && d >= 0) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT_LABELS: Array<[RegExp, string]> = [
  [/grand total|total due|total a pagar|importe total|total amount/i, 'total'], [/amount due|balance due/i, 'balance'],
  [/sub-?total/i, 'subtotal'], [/\btotal\b/i, 'total'], [/\b(?:vat|iva|tax|impuesto)\b/i, 'tax'], [/premium|prima/i, 'premium'],
  [/sum insured|limit of (?:liability|indemnity)|limit/i, 'limit'], [/deductible|excess/i, 'deductible'], [/licen[cs]e fee|annual fee|fee|honorarios/i, 'fee'],
  [/day rate|rate/i, 'rate'], [/price|precio/i, 'price'],
];
const labelOf = (line: string) => AMOUNT_LABELS.find(([re]) => re.test(line))?.[1] ?? 'amount';

function findAmounts(text: string): { amounts: Amount[]; docCurrency?: Ev } {
  const amounts: Amount[] = [];
  const seen = new Set<string>();
  const cur = /\b(?:currency|moneda)\s*[:\-]\s*(USD|EUR|GBP|COP|ARS|PEN|BRL|MXN|CAD|CLP|AUD|CHF|VES)\b/i.exec(text);
  const docCurrency = cur ? { value: cur[1].toUpperCase(), quote: quoteAround(text, cur.index, cur[0].length) } : undefined;
  for (const line of text.split('\n')) {
    const q = squash(line);
    const push = (rawNum: string, currency: string | null, label: string) => {
      const n = parseNumber(rawNum);
      if (n === null) return;
      const key = `${label}|${n}|${q}`;
      if (seen.has(key)) return;
      seen.add(key);
      amounts.push({ label, amount: n, currency, quote: q.slice(0, 300) });
    };
    if (q) {
      const lab = labelOf(q);
      for (const m of q.matchAll(AMOUNT_A)) push(m[2], (SYMBOL_CODE[m[1]] ?? m[1]).toUpperCase(), lab);
      for (const m of q.matchAll(AMOUNT_B)) push(m[1], (SYMBOL_CODE[m[2].toLowerCase()] ?? m[2]).toUpperCase(), lab);
      for (const m of q.matchAll(LABELLED)) if (!amounts.some(a => a.quote === q.slice(0, 300) && a.amount === parseNumber(m[2]))) push(m[2], null, labelOf(m[1]));
    }
  }
  return { amounts, docCurrency };
}

function pickTotal(amounts: Amount[]): Amount | undefined {
  const rank = (a: Amount) => (/\b(?:grand total|total due|total amount|importe total|total a pagar)\b/i.test(a.quote) ? 0 : a.label === 'total' ? 1 : a.label === 'balance' ? 2
    : ['premium', 'fee', 'price'].includes(a.label) ? 3 : 4);
  return [...amounts].sort((x, y) => rank(x) - rank(y))[0];
}

/* ── heuristics ──────────────────────────────────────────────────────── */

const GAP = String.raw`[^\d\n]{0,32}?`;
const dateAfter = (label: string) => new RegExp(String.raw`(?:${label})${GAP}\b(${DATE_SRC})`, 'i');

function findDate(text: string, label: string): Ev | undefined {
  const re = new RegExp(dateAfter(label).source, 'ig');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const iso = parseDate(m[1]);
    if (iso) return { value: iso, quote: quoteAround(text, m.index, m[0].length) };
  }
  return undefined;
}

const LABEL = {
  effective: String.raw`effective(?:\s+date)?|date of (?:this )?agreement|\bdated\b|made (?:and entered into )?(?:as of|on)|entered into (?:as of|on)|commencement date|start date|inception(?:\s+date)?|period of (?:insurance|cover(?:age)?)\s*(?:from|:)|valid from|fecha (?:de )?(?:entrada en vigor|efectiva|de inicio)|con fecha`,
  expiry: String.raw`expir(?:y|ation|es|ing|ed)(?:\s+date)?|end date|valid (?:until|through|to)|terminat\w+ date|(?:until|through)|period of (?:insurance|cover(?:age)?)[^\n\d]{0,20}?\bto\b|fecha de (?:vencimiento|expiraci[oó]n|terminaci[oó]n)|hasta el`,
  issue: String.raw`invoice date|date of issue|issue date|issued(?:\s+on)?|fecha de (?:emisi[oó]n|factura)|order date|expense date|date submitted`,
  due: String.raw`due(?:\s+date)?|payment due|pay(?:able)?\s+(?:by|on|before)|fecha de vencimiento|fecha l[ií]mite de pago|vencimiento`,
};

const NUMWORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, diez: 10 };
const TERM_RE = new RegExp(String.raw`(?:for (?:a )?(?:period|term) of|term of|remain in (?:full )?(?:force|effect) for|surviv\w+ (?:for )?(?:a period of )?|durante|por un (?:plazo|per[ií]odo|periodo) de|vigencia de)\s*(${Object.keys(NUMWORDS).join('|')}|\d+)\s*(?:\(\s*\d+\s*\)\s*)?(year|month|a[ñn]o|mes)s?`, 'ig');

function findParties(text: string): Party[] {
  const parties: Party[] = [];
  const add = (name: string, role: string | null, quote: string) => {
    let n = name.replace(/\s+/g, ' ').trim();
    n = n.split(/,\s+(?:a|an|una|un|with|organi[sz]ed|incorporated|registered|whose|having|existing|constituid[ao]|con domicilio)\b/i)[0].trim();
    n = n.replace(/[\s,;:]+$/, '');
    if (/\.$/.test(n) && !/\b(?:S\.A|S\.L|S\.A\.S|Inc|Ltd|Ltda|Corp|Co|LLC|N\.V|B\.V)\.$/i.test(n)) n = n.slice(0, -1).trim();
    if (n.length < 2 || n.length > 100 || /^\d+$/.test(n)) return;
    if (parties.some(p => p.name.toLowerCase() === n.toLowerCase())) return;
    parties.push({ name: n, role, quote: squash(quote).slice(0, 300) });
  };
  // "between A ("Discloser") and B ("Recipient")"
  const between = /(?:between|entre)\s+([A-Z][^()“”"\n]{2,120}?)\s*\(\s*(?:hereinafter\s+)?(?:referred to as\s+|the\s+|together[^“"]*)?[“"']([^”"']+)[”"']\s*\)\s*,?\s*(?:and|y)\s+([A-Z][^()“”"\n]{2,120}?)\s*\(\s*(?:hereinafter\s+)?(?:referred to as\s+|the\s+)?[“"']([^”"']+)[”"']\s*\)/s.exec(text);
  if (between) {
    const q = between[0];
    add(between[1], between[2], q); add(between[3], between[4], q);
  }
  const labelled = /^[ \t]*(?:[-*]\s*)?(Disclosing Party|Receiving Party|Party [AB12]|First Party|Second Party|Client|Customer|Supplier|Vendor|Bill(?:ed)? To|Billed From|From|Insured|Insurer|Licensor|Licensee|Prepared for|Prepared by|Consultant|Contractor|Buyer|Seller|Payee|Employee|Company)[ \t]*[:\-][ \t]*(.{2,120})$/gim;
  for (const m of text.matchAll(labelled)) add(m[2], m[1], m[0]);
  return parties;
}

function findGoverningLaw(text: string): Ev | undefined {
  const pats = [
    /laws? of (?:the )?(England and Wales|State of [A-Z][a-z]+(?: [A-Z][a-z]+)?|Republic of [A-Z][a-z]+)/,
    /governed by(?:,? and construed (?:and enforced )?in accordance with,?)?(?: the)? laws? of (?:the )?([A-Z][\w'’ ,-]{2,60}?)(?=[,.;\n]| and | without | excluding | applicable)/,
    /governing law\s*[:\-]\s*(?:the )?(?:laws? of )?([A-Z][\w'’ ,-]{2,60}?)(?=[.;\n]|$)/i,
    /(?:se regir[aá]|regid[oa]|interpretad[oa]) por las leyes de(?:l)? ([A-Z][\wáéíóúñ ]{2,60}?)(?=[,.;\n])/,
  ];
  for (const re of pats) {
    const m = re.exec(text);
    if (m) return { value: squash(m[1]).replace(/[\s,]+$/, ''), quote: quoteAround(text, m.index, m[0].length) };
  }
  return undefined;
}

function findPaid(text: string, amounts: Amount[]): Ev<'paid' | 'unpaid' | 'partial'> | undefined {
  const tries: Array<[RegExp, 'paid' | 'unpaid' | 'partial']> = [
    [/partially paid|partial payment|pago parcial/i, 'partial'],
    [/\bpaid in full\b|\bfully paid\b|\bpayment received\b|\bstatus\s*[:\-]\s*paid\b|^\s*paid\s*$|\bpagad[oa]\b|\bestado\s*[:\-]\s*pagad[oa]\b/im, 'paid'],
    [/\bbalance due\s*[:\-]?\s*(?:US\$|USD|EUR|GBP|COP|€|£|\$)?\s?0(?:[.,]0+)?(?![\d,.])/i, 'paid'],
    [/\bstatus\s*[:\-]\s*(?:unpaid|open|overdue|sent|due|pending)\b|\bunpaid\b|\bnot yet paid\b|\bpayment pending\b|\bpendiente de pago\b/i, 'unpaid'],
  ];
  for (const [re, v] of tries) {
    const m = re.exec(text);
    if (m) return { value: v, quote: quoteAround(text, m.index, m[0].length) };
  }
  const due = amounts.find(a => /amount due|balance due|total due/i.test(a.quote) && a.amount > 0);
  return due ? { value: 'unpaid', quote: due.quote } : undefined;
}

function findReference(text: string): Ev | undefined {
  const m = /\b(?:invoice|inv|purchase order|po|policy|licen[cs]e|contract|agreement|proposal|timesheet|expense|reference|ref)(?:\s*(?:no\.?|number|num\.?|#|n[uú]mero))?\s*[:#\-]\s*([A-Z0-9][A-Z0-9\-/._]{2,30})/i.exec(text);
  return m ? { value: m[1].replace(/[.\-/_]+$/, ''), quote: quoteAround(text, m.index, m[0].length) } : undefined;
}

const INVOICE_LIKE = new Set<LegalFinanceType>(['invoice', 'purchase-order', 'expense']);

export function extractLegalFinanceHeuristic(text: string, type: LegalFinanceType): LegalFinance {
  const out: LegalFinance = { type, parties: findParties(text), dates: {}, amounts: [], partners_only: true, method: 'heuristic' };
  const financeDoc = ['invoice', 'purchase-order', 'expense', 'timesheet', 'proposal'].includes(type);
  if (!financeDoc || type === 'proposal') out.dates.effective = findDate(text, LABEL.effective);
  if (financeDoc) {
    out.dates.issue = findDate(text, LABEL.issue) ?? findDate(text, String.raw`\bdate`);
    out.dates.due = findDate(text, LABEL.due);
    if (!out.dates.due && out.dates.issue) {
      const net = /\bnet\s*(\d{1,3})\b|\bpayment terms?\s*[:\-]?\s*(\d{1,3})\s*days\b/i.exec(text);
      const days = net ? Number(net[1] ?? net[2]) : 0;
      if (days) out.dates.due = { value: addTerm(out.dates.issue.value, days, 'day'), quote: quoteAround(text, net!.index, net![0].length), derived: true };
    }
    if (type === 'proposal' || type === 'purchase-order') out.dates.expiry = findDate(text, String.raw`valid (?:until|through|to)|expir\w+(?:\s+date)?|delivery date`);
  } else {
    out.dates.expiry = findDate(text, LABEL.expiry);
    // "from <date> to <date>" (insurance periods, licence terms)
    const range = new RegExp(String.raw`\b(?:from|desde)\s+(${DATE_SRC})\s+(?:to|until|through|hasta(?: el)?)\s+(${DATE_SRC})`, 'i').exec(text);
    if (range) {
      const [from, to] = [parseDate(range[1]), parseDate(range[2])];
      const quote = quoteAround(text, range.index, range[0].length);
      if (from && !out.dates.effective) out.dates.effective = { value: from, quote };
      if (to && !out.dates.expiry) out.dates.expiry = { value: to, quote };
    }
    // NDAs and contracts often state a term rather than an end date.
    for (const m of text.matchAll(TERM_RE)) {
      const n = NUMWORDS[m[1].toLowerCase()] ?? Number(m[1]);
      const unit = /^(year|a[ñn]o)/i.test(m[2]) ? 'year' : 'month';
      const quote = quoteAround(text, m.index!, m[0].length);
      const survive = /surviv/i.test(m[0]) || /confidential|secrecy|confidencial/i.test(quote) && !/\bagreement\b.*\bterm\b|\bterm of this\b/i.test(quote);
      if (survive && !out.confidentiality_term) out.confidentiality_term = { value: `${n} ${unit}${n === 1 ? '' : 's'}`, quote };
      if (!survive && !out.dates.expiry && out.dates.effective) out.dates.expiry = { value: addTerm(out.dates.effective.value, n, unit), quote, derived: true };
    }
    if (!out.dates.expiry && out.confidentiality_term && out.dates.effective && type === 'nda') {
      const [n, u] = out.confidentiality_term.value.split(' ');
      out.dates.expiry = { value: addTerm(out.dates.effective.value, Number(n), u.startsWith('year') ? 'year' : 'month'), quote: out.confidentiality_term.quote, derived: true };
    }
  }
  const { amounts, docCurrency } = findAmounts(text);
  out.amounts = amounts.slice(0, 40);
  out.total = pickTotal(amounts);
  out.currency = docCurrency ?? (out.total?.currency ? { value: out.total.currency, quote: out.total.quote } : (() => { const a = amounts.find(x => x.currency); return a ? { value: a.currency!, quote: a.quote } : undefined; })());
  if (out.total && !out.total.currency && out.currency) out.total = { ...out.total, currency: out.currency.value };
  out.governing_law = findGoverningLaw(text);
  if (INVOICE_LIKE.has(type)) out.paid_status = findPaid(text, amounts);
  out.reference = findReference(text);
  return out;
}

/* ── optional provider pass ──────────────────────────────────────────── */

const zEv = z.object({ value: z.string().min(1), quote: z.string().min(3) });
export const LlmLegalFinanceSchema = z.object({
  parties: z.array(z.object({ name: z.string().min(1), role: z.string().nullish(), quote: z.string().min(3) })).default([]),
  dates: z.object({ effective: zEv.nullish(), expiry: zEv.nullish(), issue: zEv.nullish(), due: zEv.nullish() }).default({}),
  amounts: z.array(z.object({ label: z.string(), amount: z.number(), currency: z.string().nullish(), quote: z.string().min(3) })).default([]),
  currency: zEv.nullish(),
  governing_law: zEv.nullish(),
  paid_status: z.object({ value: z.enum(['paid', 'unpaid', 'partial']), quote: z.string().min(3) }).nullish(),
  reference: zEv.nullish(),
});
export type LlmLegalFinance = z.infer<typeof LlmLegalFinanceSchema>;

const LLM_SYSTEM = [
  'You extract structured facts from a legal or finance document. Reply with one JSON object and nothing else.',
  'Shape: {"parties":[{"name","role","quote"}],"dates":{"effective":{"value":"YYYY-MM-DD","quote"},"expiry":{...},"issue":{...},"due":{...}},',
  '"amounts":[{"label","amount":number,"currency":"USD","quote"}],"currency":{"value","quote"},"governing_law":{"value","quote"},"paid_status":{"value":"paid|unpaid|partial","quote"},"reference":{"value","quote"}}.',
  'Every fact needs a "quote": an exact, verbatim excerpt of the document that supports it. Omit any fact you cannot quote. Never guess.',
].join('\n');

function parseJsonObject(s: string): unknown {
  const body = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** Merge model output into heuristic results: only missing facts, only with a quote found verbatim in the text. */
export function mergeLlm(base: LegalFinance, raw: unknown, text: string): { merged: LegalFinance; used: boolean } {
  const parsed = LlmLegalFinanceSchema.safeParse(raw);
  if (!parsed.success) return { merged: base, used: false };
  const v = parsed.data, out: LegalFinance = { ...base, dates: { ...base.dates }, parties: [...base.parties], amounts: [...base.amounts] };
  let used = false;
  const ok = (q: string) => quoteInText(text, q);
  for (const k of ['effective', 'expiry', 'issue', 'due'] as const) {
    const d = v.dates[k];
    if (d && !out.dates[k] && ok(d.quote)) { const iso = parseDate(d.value); if (iso) { out.dates[k] = { value: iso, quote: squash(d.quote) }; used = true; } }
  }
  for (const p of v.parties) if (ok(p.quote) && !out.parties.some(x => x.name.toLowerCase() === p.name.toLowerCase())) { out.parties.push({ name: p.name, role: p.role ?? null, quote: squash(p.quote) }); used = true; }
  for (const a of v.amounts) if (ok(a.quote) && !out.amounts.some(x => x.amount === a.amount && x.label === a.label)) { out.amounts.push({ label: a.label, amount: a.amount, currency: a.currency ?? null, quote: squash(a.quote) }); used = true; }
  if (!out.total && out.amounts.length) out.total = pickTotal(out.amounts);
  if (v.currency && !out.currency && ok(v.currency.quote)) { out.currency = { value: v.currency.value.toUpperCase(), quote: squash(v.currency.quote) }; used = true; }
  if (v.governing_law && !out.governing_law && ok(v.governing_law.quote)) { out.governing_law = { value: v.governing_law.value, quote: squash(v.governing_law.quote) }; used = true; }
  if (v.paid_status && !out.paid_status && INVOICE_LIKE.has(base.type) && ok(v.paid_status.quote)) { out.paid_status = { value: v.paid_status.value, quote: squash(v.paid_status.quote) }; used = true; }
  if (v.reference && !out.reference && ok(v.reference.quote)) { out.reference = { value: v.reference.value, quote: squash(v.reference.quote) }; used = true; }
  if (used) out.method = 'heuristic+llm';
  return { merged: out, used };
}

export async function extractLegalFinance(text: string, type: LegalFinanceType, opts: { provider?: LlmProvider | null } = {}): Promise<LegalFinance> {
  const base = extractLegalFinanceHeuristic(text, type);
  if (!opts.provider) return base;
  try {
    const r = await opts.provider.complete({ system: LLM_SYSTEM, messages: [{ role: 'user', content: `Document type: ${type}\n\n${text.slice(0, 20000)}` }], maxTokens: 1500, temperature: 0 });
    return mergeLlm(base, parseJsonObject(r.text), text).merged;
  } catch { return base; }
}

/* ── writing the result ──────────────────────────────────────────────── */

/** Flat facts for `items.extracted` alongside the full typed record under `legal_finance`. */
export function flatten(lf: LegalFinance): Record<string, unknown> {
  const o: Record<string, unknown> = { partners_only: true, legal_finance: lf };
  if (lf.parties.length) o.parties = lf.parties.map(p => p.name);
  if (lf.dates.effective) o.effective_date = lf.dates.effective.value;
  if (lf.dates.expiry) o.expiry_date = lf.dates.expiry.value;
  if (lf.dates.issue) o.issue_date = lf.dates.issue.value;
  if (lf.dates.due) o.due_date = lf.dates.due.value;
  if (lf.total) o.amount = lf.total.amount;
  if (lf.currency) o.currency = lf.currency.value;
  if (lf.governing_law) o.governing_law = lf.governing_law.value;
  if (lf.paid_status) o.paid_status = lf.paid_status.value;
  if (lf.reference) o.reference = lf.reference.value;
  if (lf.confidentiality_term) o.confidentiality_term = lf.confidentiality_term.value;
  return o;
}

export interface NdaItem { id: string; version: number; client_id: string | null; project_id: string; legal_tag: string; title?: string }

/**
 * An NDA's expiry is proposed as its client's legal-tag expiry through the review queue (a partner accepts
 * it in the Hub). Idempotent: one open row per (item, expiry); nothing when the tag already carries that date.
 */
export async function proposeNdaExpiry(db: Db, item: NdaItem, lf: LegalFinance): Promise<string | null> {
  if (lf.type !== 'nda' || !lf.dates.expiry || !item.client_id) return null;
  const expiry = lf.dates.expiry;
  const tag = (await db.query<{ expires_at: string | null }>(`SELECT to_char(expires_at,'YYYY-MM-DD') AS expires_at FROM legal_tags WHERE id = $1`, [item.legal_tag])).rows[0];
  if (tag?.expires_at === expiry.value) return null;
  const dup = await db.query(`SELECT id FROM review_queue WHERE kind = 'nda-expiry' AND status = 'open' AND payload->>'item_id' = $1 AND payload->>'proposed_expires_at' = $2`, [item.id, expiry.value]);
  if (dup.rows.length) return null;
  const id = randomUUID();
  await db.query(`INSERT INTO review_queue (id, kind, payload) VALUES ($1, 'nda-expiry', $2::jsonb)`, [id, JSON.stringify({
    item_id: item.id, item_version: item.version, item_title: item.title ?? null, client_id: item.client_id, project_id: item.project_id, legal_tag: item.legal_tag,
    current_expires_at: tag?.expires_at ?? null, proposed_expires_at: expiry.value, derived: !!expiry.derived, evidence: expiry.quote,
    parties: lf.parties.map(p => p.name), proposal: `Set the expiry of ${item.legal_tag} (client ${item.client_id}) to ${expiry.value}`,
  })]);
  return id;
}
