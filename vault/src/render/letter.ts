/**
 * Letter rendering (M13, R2). Turns a drafted letter into a finished document
 * on ATC letterhead: DOCX (built with the docx package from the brand assets)
 * and PDF (printed from the HTML rendering in headless Chromium). Everything
 * the letter needs comes from the Vault: counterparty, contact, reference
 * numbers, dispatch history, signatory and the house style.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Packer, Paragraph, TextRun, Header, Footer, ImageRun, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, HeadingLevel } from 'docx';
import { findChromium } from '../rerun/runner.ts';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../firm/assets');
const NAVY = '0B1F3A', GOLD = 'C9A84C', STEEL = '6B7A8D';

export interface LetterInput {
  language: 'en' | 'es';
  reference_no: string;
  their_reference?: string | null;
  date: Date;
  organisation: { name: string; registered_address?: string | null };
  contact?: { name: string; role?: string | null; postal_address?: string | null } | null;
  subject?: string | null;
  salutation?: string | null;
  paragraphs: string[];              // body, one paragraph per entry; citations like [run:…] are stripped for the sent copy
  closing?: string | null;
  signatory: { name: string; signature_block?: string | null };
  previous_correspondence?: Array<{ date: string; direction: 'out' | 'in'; reference: string | null; subject: string }>;
  confidentiality_note?: string | null;
  keep_citations?: boolean;          // vault copy keeps them; the sent copy does not
}

const T = {
  en: { ourRef: 'Our ref', yourRef: 'Your ref', prev: 'Previous correspondence', date: 'Date', dir: 'Dir.', ref: 'Reference', subj: 'Subject', sincerely: 'Yours sincerely', faithfully: 'Yours faithfully', dear: 'Dear', tagline: 'Technical evaluation for upstream oil and gas in Latin America', confidential: 'Confidential', footer: 'Alpha Technical Centre · a wholly-owned subsidiary of Alpha Energy Latin America · info@alpha-technical-centre.com · www.alpha-technical-centre.com' },
  es: { ourRef: 'Nuestra ref.', yourRef: 'Su ref.', prev: 'Correspondencia previa', date: 'Fecha', dir: 'Dir.', ref: 'Referencia', subj: 'Asunto', sincerely: 'Atentamente', faithfully: 'Atentamente', dear: 'Estimado/a', tagline: 'Evaluación técnica para el upstream de petróleo y gas en América Latina', confidential: 'Confidencial', footer: 'Alpha Technical Centre · filial de Alpha Energy Latin America · info@alpha-technical-centre.com · www.alpha-technical-centre.com' },
};

export function dateWords(d: Date, lang: 'en' | 'es'): string {
  return new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d).replace(/ de /g, lang === 'es' ? ' de ' : ' ');
}

export const CITATION_RE = /\s?\[(run|doc|lesson|ref):[^\]]+\]/g;
export function stripCitations(s: string): string { return s.replace(CITATION_RE, '').replace(/\s{2,}/g, ' ').trim(); }

function body(input: LetterInput): string[] {
  return input.paragraphs.map(p => (input.keep_citations ? p : stripCitations(p)));
}
const text = (input: LetterInput, s: string | null | undefined) => (s == null ? s : input.keep_citations ? s : stripCitations(s));

/** Plain HTML with print styles; used for the PDF and the Hub preview. */
export function letterHtml(input: LetterInput): string {
  const t = T[input.language];
  const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const logo = existsSync(path.join(ASSETS, 'logo-lockup-dark.png')) ? `data:image/png;base64,${readFileSync(path.join(ASSETS, 'logo-lockup-dark.png')).toString('base64')}` : '';
  const addr = [input.contact?.name, input.contact?.role, input.organisation.name, input.contact?.postal_address ?? input.organisation.registered_address].filter(Boolean).map(esc).join('<br>');
  const salutation = input.salutation ?? (input.contact ? `${t.dear} ${input.contact.name.split(' ').slice(-2).join(' ')},` : (input.language === 'es' ? 'Estimados señores:' : 'Dear Sirs,'));
  const closing = input.closing ?? (input.contact ? t.sincerely : t.faithfully);
  const prev = (input.previous_correspondence ?? []).map(p => `<tr><td>${esc(p.date)}</td><td>${p.direction === 'out' ? '→' : '←'}</td><td class="mono">${esc(p.reference ?? '—')}</td><td>${esc(p.subject)}</td></tr>`).join('');
  return `<!doctype html><html lang="${input.language}"><head><meta charset="utf-8"><title>${esc(input.reference_no)}</title>
<style>
@page { size: A4; margin: 22mm 20mm 20mm 20mm; }
body { font-family: 'Barlow', Arial, Helvetica, sans-serif; color: #${NAVY}; font-size: 11pt; line-height: 1.45; margin: 0; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #${GOLD}; padding-bottom: 8px; margin-bottom: 18px; }
.head img { height: 40px; } .tag { font-size: 8.5pt; color: #${STEEL}; text-align: right; }
.wordmark { font-family: 'Playfair Display', Georgia, serif; font-weight: 700; letter-spacing: .04em; font-size: 14pt; }
.refs { display: flex; justify-content: space-between; font-size: 9.5pt; margin-bottom: 14px; } .mono { font-family: 'Barlow Condensed', 'Arial Narrow', monospace; letter-spacing: .03em; }
.addr { margin: 0 0 14px; } .subject { font-weight: 600; margin: 14px 0 4px; } .conf { font-size: 9pt; color: #${STEEL}; margin-bottom: 12px; }
p { margin: 0 0 10px; text-align: justify; } .sig { margin-top: 22px; white-space: pre-line; } .sig .name { font-family: 'Playfair Display', Georgia, serif; font-style: italic; font-size: 15pt; margin-bottom: 6px; }
.prev { margin-top: 26px; font-size: 9pt; } .prev h4 { font-size: 8pt; letter-spacing: .12em; text-transform: uppercase; color: #${STEEL}; margin: 0 0 6px; }
.prev table { border-collapse: collapse; width: 100%; } .prev td, .prev th { text-align: left; padding: 3px 6px 3px 0; border-bottom: 1px solid #D8DCE2; vertical-align: top; } .prev th { font-size: 7.5pt; letter-spacing: .1em; color: #${STEEL}; text-transform: uppercase; }
.foot { position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #${GOLD}; font-size: 7.5pt; color: #${STEEL}; text-align: center; padding-top: 4px; }
</style></head><body>
<div class="head"><div>${logo ? `<img src="${logo}" alt="Alpha Technical Centre">` : '<div class="wordmark">ALPHA TECHNICAL CENTRE</div>'}</div><div class="tag">${esc(t.tagline)}</div></div>
<div class="refs"><div><span class="mono">${esc(t.ourRef)}: ${esc(input.reference_no)}</span>${input.their_reference ? `&nbsp;&nbsp;&nbsp;<span class="mono">${esc(t.yourRef)}: ${esc(input.their_reference)}</span>` : ''}</div><div>${esc(dateWords(input.date, input.language))}</div></div>
<div class="addr">${addr}</div>
${input.subject ? `<div class="subject">${esc(text(input, input.subject))}</div>` : ''}${input.confidentiality_note ? `<div class="conf">${esc(text(input, input.confidentiality_note))}</div>` : ''}
<p>${esc(salutation)}</p>
${body(input).map(p => `<p>${esc(p)}</p>`).join('\n')}
<p>${esc(closing)},</p>
<div class="sig"><div class="name">${esc(input.signatory.name)}</div>${esc(input.signatory.signature_block ?? input.signatory.name)}</div>
${prev ? `<div class="prev"><h4>${esc(t.prev)} · ${esc(input.organisation.name)}</h4><table><thead><tr><th>${t.date}</th><th>${t.dir}</th><th>${t.ref}</th><th>${t.subj}</th></tr></thead><tbody>${prev}</tbody></table></div>` : ''}
<div class="foot">${esc(t.footer)} · ${esc(input.reference_no)}</div>
</body></html>`;
}

export async function letterDocx(input: LetterInput): Promise<Buffer> {
  const t = T[input.language];
  const logoPath = path.join(ASSETS, 'logo-lockup-light.png');
  const logo = existsSync(logoPath) ? readFileSync(logoPath) : null;
  const run = (text: string, o: Partial<{ bold: boolean; italics: boolean; size: number; color: string; font: string }> = {}) => new TextRun({ text, font: o.font ?? 'Barlow', size: o.size ?? 22, bold: o.bold, italics: o.italics, color: o.color ?? NAVY });
  const para = (text: string, o: Partial<{ bold: boolean; italics: boolean; size: number; color: string; font: string; after: number; align: (typeof AlignmentType)[keyof typeof AlignmentType] }> = {}) => new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 160 }, children: [run(text, o)] });
  const header = new Header({ children: [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.SINGLE, size: 12, color: GOLD }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 }, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 45, type: WidthType.PERCENTAGE }, children: [logo ? new Paragraph({ children: [new ImageRun({ data: logo, transformation: { width: 220, height: 59 }, type: 'png' })] }) : para('ALPHA TECHNICAL CENTRE', { font: 'Playfair Display', bold: true })] }),
      new TableCell({ width: { size: 55, type: WidthType.PERCENTAGE }, children: [para(t.tagline, { size: 18, color: STEEL, align: AlignmentType.RIGHT })] }),
    ] })] }), new Paragraph({ text: '' })] });
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, children: [run(`${t.footer} · ${input.reference_no}`, { size: 15, color: STEEL })] })] });
  const salutation = input.salutation ?? (input.contact ? `${t.dear} ${input.contact.name.split(' ').slice(-2).join(' ')},` : (input.language === 'es' ? 'Estimados señores:' : 'Dear Sirs,'));
  const closing = input.closing ?? (input.contact ? t.sincerely : t.faithfully);
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({ spacing: { after: 60 }, children: [run(`${t.ourRef}: ${input.reference_no}`, { font: 'Barlow Condensed', size: 19 }), ...(input.their_reference ? [run(`      ${t.yourRef}: ${input.their_reference}`, { font: 'Barlow Condensed', size: 19 })] : [])] }));
  children.push(para(dateWords(input.date, input.language), { after: 240 }));
  for (const line of [input.contact?.name, input.contact?.role, input.organisation.name, input.contact?.postal_address ?? input.organisation.registered_address].filter(Boolean) as string[]) children.push(para(line, { after: 0 }));
  children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  if (input.subject) children.push(para(text(input, input.subject)!, { bold: true, after: 60 }));
  if (input.confidentiality_note) children.push(para(text(input, input.confidentiality_note)!, { size: 18, color: STEEL, after: 200 }));
  children.push(para(salutation));
  for (const p of body(input)) children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 160 }, children: [run(p)] }));
  children.push(para(`${closing},`, { after: 360 }));
  children.push(para(input.signatory.name, { font: 'Playfair Display', italics: true, size: 30, after: 80 }));
  for (const line of (input.signatory.signature_block ?? input.signatory.name).split('\n')) children.push(para(line, { after: 0 }));
  const prev = input.previous_correspondence ?? [];
  if (prev.length) {
    children.push(new Paragraph({ text: '', spacing: { after: 240 } }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_4, spacing: { after: 80 }, children: [run(`${t.prev} · ${input.organisation.name}`, { size: 16, color: STEEL, bold: true })] }));
    const cell = (text: string, bold = false) => new TableCell({ children: [new Paragraph({ children: [run(text, { size: 17, bold })] })] });
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ tableHeader: true, children: [cell(t.date, true), cell(t.dir, true), cell(t.ref, true), cell(t.subj, true)] }),
      ...prev.map(p => new TableRow({ children: [cell(p.date), cell(p.direction === 'out' ? '→' : '←'), cell(p.reference ?? '—'), cell(p.subject)] })),
    ] }));
  }
  const doc = new Document({ creator: 'Alpha Technical Centre', title: input.reference_no, styles: { default: { document: { run: { font: 'Barlow', size: 22, color: NAVY } } } },
    sections: [{ properties: { page: { margin: { top: 1400, bottom: 1100, left: 1300, right: 1300 } } }, headers: { default: header }, footers: { default: footer }, children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

/** PDF via headless Chromium; throws {status:503} when no browser is available. */
export async function htmlToPdf(html: string, executablePath: string | null = findChromium()): Promise<Buffer> {
  if (!executablePath) throw Object.assign(new Error('PDF rendering unavailable: no Chromium found'), { status: 503, code: 'renderer_unavailable' });
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', r => r.abort());          // fonts are embedded or fall back; nothing leaves the box
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
  } finally { await browser.close(); }
}
