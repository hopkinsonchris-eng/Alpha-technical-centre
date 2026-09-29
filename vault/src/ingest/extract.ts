/**
 * Text extraction (M09). `extractText(bytes, mime, filename)` turns an original into Markdown-ish
 * text plus anchors (page, sheet cell, slide, heading) so a chunk can say where it came from.
 *
 *  - PDF:  pdfjs-dist text layer; a near-empty text layer means a scan, which is OCRed with
 *          tesseract.js when the language data is available locally (VAULT_TESSDATA_DIR, or
 *          VAULT_OCR_DOWNLOAD=1 to let tesseract fetch it). Otherwise `needs_ocr: true`.
 *  - DOCX: mammoth (HTML) → Markdown-ish text.     - XLSX/CSV/XLS: xlsx, one Markdown table per sheet.
 *  - PPTX: slide XML through jszip.                 - HTML, MD, TXT, JSON, EML: parsed here.
 * Anchor offsets are character offsets into `text`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Anchor { label: string; offset: number }
export interface Extracted {
  format: Format;
  text: string;
  anchors: Anchor[];
  pages?: number;
  /** A scanned PDF that could not be OCRed here: the text layer is (nearly) empty. */
  needs_ocr?: boolean;
  /** Text came from OCR. */
  ocr?: boolean;
  /** Title found in the document itself (first heading, EML subject, sheet name), if any. */
  title?: string;
  meta?: Record<string, unknown>;
}
export type Format = 'pdf' | 'docx' | 'xlsx' | 'csv' | 'pptx' | 'html' | 'md' | 'txt' | 'eml' | 'json';

export class UnsupportedFormat extends Error {
  constructor(public filename: string, public mime: string) { super(`unsupported document format: ${filename || '(unnamed)'} (${mime || 'unknown type'})`); }
}

const MAX_OCR_PAGES = Number(process.env.VAULT_OCR_MAX_PAGES ?? 60);
const VAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tessdataDir = () => process.env.VAULT_TESSDATA_DIR || path.join(VAULT_DIR, '.storage', 'tessdata');

/* ── format detection ───────────────────────────────────────────────── */

const EXT: Record<string, Format> = {
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', xlsm: 'xlsx', xls: 'xlsx', csv: 'csv', tsv: 'csv', pptx: 'pptx', html: 'html', htm: 'html',
  md: 'md', markdown: 'md', txt: 'txt', text: 'txt', log: 'txt', eml: 'eml', json: 'json',
};
const MIME: Array<[RegExp, Format]> = [
  [/pdf/, 'pdf'], [/wordprocessingml/, 'docx'], [/spreadsheetml|ms-excel/, 'xlsx'], [/csv|tab-separated/, 'csv'], [/presentationml/, 'pptx'],
  [/html/, 'html'], [/markdown/, 'md'], [/rfc822/, 'eml'], [/json/, 'json'], [/^text\//, 'txt'],
];

async function sniff(bytes: Uint8Array): Promise<Format | null> {
  const head = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file('word/document.xml')) return 'docx';
      if (zip.file('xl/workbook.xml')) return 'xlsx';
      if (zip.file('ppt/presentation.xml')) return 'pptx';
    } catch { /* not a zip we understand */ }
    return null;
  }
  const start = Buffer.from(bytes.subarray(0, 512)).toString('utf8');
  if (/^\s*<(!doctype html|html)/i.test(start)) return 'html';
  if (/^(From|Received|Return-Path|Message-ID|MIME-Version|Date|Subject):/im.test(start) && /^(From|Subject|To):/im.test(start)) return 'eml';
  return null;
}

export async function detectFormat(bytes: Uint8Array, mime: string, filename: string): Promise<Format | null> {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename ?? '')?.[1]?.toLowerCase();
  if (ext && EXT[ext]) return EXT[ext];
  const m = (mime ?? '').toLowerCase();
  for (const [re, f] of MIME) if (re.test(m)) return f;
  return sniff(bytes);
}

/* ── shared text helpers ────────────────────────────────────────────── */

const decodeUtf8 = (b: Uint8Array) => {
  let s = new TextDecoder('utf-8').decode(b);
  if (s.includes('�') && !s.includes('\u0000')) { // not UTF-8: fall back to latin1 rather than lose accents
    const l = Buffer.from(b).toString('latin1');
    if ((l.match(/�/g) ?? []).length === 0) s = l;
  }
  return s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', euro: '€', pound: '£', copy: '©' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const cell = (s: unknown) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Accumulates text and records anchors at the offset where each piece starts. */
class Doc {
  text = '';
  anchors: Anchor[] = [];
  anchor(label: string) { this.anchors.push({ label, offset: this.text.length }); }
  add(s: string) { this.text += s; }
  /** Ensure the text ends with a blank line (paragraph break) before the next block. */
  para() { if (this.text && !this.text.endsWith('\n\n')) this.text += this.text.endsWith('\n') ? '\n' : '\n\n'; }
  block(s: string, anchor?: string) { if (!s.trim()) return; this.para(); if (anchor) this.anchor(anchor); this.add(s.trim() + '\n'); }
}

function finish(d: Doc, extra: Omit<Extracted, 'text' | 'anchors'>): Extracted {
  const text = d.text.trimEnd() + '\n';
  const anchors = d.anchors.filter(a => a.offset <= text.length);
  return { ...extra, text, anchors };
}

/* ── HTML / Markdown helpers (also used for DOCX, EML) ───────────────── */

/** Convert HTML to Markdown-ish text: headings, paragraphs, lists, tables as Markdown tables. */
export function htmlToMarkdown(html: string): { text: string; anchors: Anchor[]; title?: string } {
  let h = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head|noscript)\b[\s\S]*?<\/\1>/gi, '');
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  // tables first: each becomes a Markdown table block
  h = h.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => {
    const rows = [...t.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cell(decodeEntities(c[1].replace(/<[^>]+>/g, ' ')))));
    const width = Math.max(0, ...rows.map(r => r.length));
    if (!width) return '\n\n';
    const md = rows.map(r => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`);
    md.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
    return `\n\n${md.join('\n')}\n\n`;
  });
  h = h.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, inner) => `\n\n${'#'.repeat(Number(n))} ${inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/(p|div|section|article|ul|ol|blockquote|pre)>/gi, '\n\n').replace(/<(p|div|section|article|blockquote|pre)\b[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  h = decodeEntities(h).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  // whitespace runs inside lines
  h = h.split('\n').map(l => (l.startsWith('|') ? l : l.replace(/[ \t]{2,}/g, ' '))).join('\n');
  const t = markdownAnchors(h);
  return { text: h, anchors: t, title: titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : undefined };
}

/** Anchors at Markdown headings, and (for plain contracts) numbered clause headings and ALL-CAPS lines. */
export function markdownAnchors(text: string): Anchor[] {
  const out: Anchor[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    let label: string | null = null;
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
    if (h) label = h[1];
    else if (t.length > 2 && t.length <= 80 && /^(\d{1,2}(\.\d{1,2}){0,3}\.?|[A-Z]\.|Article\s+\d+|Section\s+\d+|Clause\s+\d+|ARTÍCULO\s+\d+|CL[ÁA]USULA\s+\w+)\s+\S/.test(t) && !/[.;:]$/.test(t.replace(/^\S+\s+/, '')) ) label = t;
    else if (t.length > 3 && t.length <= 60 && /^[A-Z0-9][A-Z0-9 &,'\-/():]+$/.test(t) && /[A-Z]{3}/.test(t) && !/\d{4,}/.test(t)) label = t;
    if (label) out.push({ label, offset: offset + (line.length - line.trimStart().length) });
    offset += line.length + 1;
  }
  return out;
}

/* ── per-format extractors ──────────────────────────────────────────── */

async function extractPdf(bytes: Uint8Array): Promise<Extracted> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isEvalSupported: false, verbosity: 0, disableFontFace: true });
  const pdf = await loading.promise;
  try {
    const pageTexts: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      pageTexts.push(pdfPageText(tc.items));
      page.cleanup();
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const title: string | undefined = (meta?.info as any)?.Title?.toString().trim() || undefined;
    // A page with (almost) no text layer is a picture; a document is a scan when at least half its pages are pictures.
    const nonSpace = (t: string) => t.replace(/\s+/g, '').length;
    const empty = pageTexts.map((t, i) => (nonSpace(t) < 15 ? i : -1)).filter(i => i >= 0);
    const scanned = pdf.numPages > 0 && empty.length / pdf.numPages >= 0.5;
    let ocr = false, needsOcr = false;
    if (scanned) {
      const ocrTexts = await ocrPdf(pdf, new Set(empty));
      if (ocrTexts) { ocr = true; for (const i of empty) if (ocrTexts[i]) pageTexts[i] = ocrTexts[i]; }
      else needsOcr = true;
    }
    const d = new Doc();
    pageTexts.forEach((t, i) => { d.para(); d.anchor(`page ${i + 1}`); d.add(`## Page ${i + 1}\n\n${t.trim()}\n`); });
    return finish(d, { format: 'pdf', pages: pdf.numPages, ...(needsOcr ? { needs_ocr: true } : {}), ...(ocr ? { ocr: true } : {}), title });
  } finally { await loading.destroy(); }
}

function pdfPageText(items: any[]): string {
  let out = '';
  let prevY: number | null = null, prevEnd = 0, prevH = 10;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x: number = it.transform?.[4] ?? 0, y: number = it.transform?.[5] ?? 0, h = Math.abs(it.height || it.transform?.[3] || 10) || 10;
    if (prevY !== null) {
      const dy = Math.abs(y - prevY);
      if (dy > h * 0.5) out += dy > h * 1.9 ? '\n\n' : '\n';
      else if (x - prevEnd > h * 0.15 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' ';
    }
    out += it.str;
    if (it.hasEOL && !out.endsWith('\n')) { out += '\n'; prevY = null; continue; }
    prevY = y; prevEnd = x + (it.width ?? 0); prevH = h;
  }
  void prevH;
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

/** OCR every page (up to VAULT_OCR_MAX_PAGES). Returns null when OCR cannot run here (no engine, canvas or language data). */
async function ocrPdf(pdf: any, only: Set<number>): Promise<string[] | null> {
  const dir = tessdataDir();
  const haveData = ['eng.traineddata.gz', 'eng.traineddata'].some(f => existsSync(path.join(dir, f)));
  if (!haveData && process.env.VAULT_OCR_DOWNLOAD !== '1') return null;
  let canvasMod: any, tess: any;
  try { canvasMod = await import('@napi-rs/canvas'); tess = await import('tesseract.js'); } catch { return null; }
  let worker: any;
  try {
    worker = await tess.createWorker(process.env.VAULT_OCR_LANG || 'eng', 1, {
      langPath: haveData ? dir : undefined, cachePath: dir, gzip: existsSync(path.join(dir, 'eng.traineddata.gz')), logger: () => {},
    });
    const out: string[] = [];
    const last = Math.min(pdf.numPages, MAX_OCR_PAGES);
    for (let n = 1; n <= pdf.numPages; n++) {
      if (n > last || !only.has(n - 1)) { out.push(''); continue; }
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 2 });
      const canvas = canvasMod.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas }).promise;
      const r = await worker.recognize(canvas.toBuffer('image/png'));
      out.push(String(r.data.text ?? ''));
      page.cleanup();
    }
    return out;
  } catch { return null; }
  finally { try { await worker?.terminate(); } catch { /* ignore */ } }
}

async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const mammoth: any = await import('mammoth');
  const res = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const md = htmlToMarkdown(res.value ?? '');
  return { format: 'docx', text: md.text, anchors: md.anchors, title: md.anchors[0]?.label };
}

async function extractSheets(bytes: Uint8Array, csv: boolean): Promise<Extracted> {
  const XLSX: any = await import('xlsx');
  const wb = csv ? XLSX.read(decodeUtf8(bytes), { type: 'string', raw: false }) : XLSX.read(bytes, { type: 'buffer', cellDates: true });
  const d = new Doc();
  const MAX_ROWS = 20000;
  for (const name of wb.SheetNames as string[]) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows: string[][] = [];
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + MAX_ROWS - 1); r++) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellObj = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell(cellObj ? (cellObj.w ?? cellObj.v ?? '') : ''));
      }
      rows.push(row);
    }
    if (!rows.some(r => r.some(Boolean))) continue;
    const width = range.e.c - range.s.c + 1;
    const first = XLSX.utils.encode_cell({ r: range.s.r, c: range.s.c }), lastRef = XLSX.utils.encode_cell({ r: range.e.r, c: range.e.c });
    d.para(); d.anchor(`sheet ${name}`);
    d.add(`## Sheet: ${name}\n\nRange ${first}:${lastRef}\n\n`);
    // Markdown needs a header row: the sheet's first row is the header, later rows keep their true cell references as anchors.
    const line = (r: string[]) => `| ${r.join(' | ')} |`;
    d.anchor(`${name}!${first}`);
    d.add(line(rows[0]) + '\n' + `| ${Array(width).fill('---').join(' | ')} |\n`);
    for (let i = 1; i < rows.length; i++) {
      d.anchor(`${name}!${XLSX.utils.encode_cell({ r: range.s.r + i, c: range.s.c })}`);
      d.add(line(rows[i]) + '\n');
    }
    if (range.e.r - range.s.r + 1 > MAX_ROWS) d.add(`\n_Sheet truncated at ${MAX_ROWS} rows._\n`);
  }
  return finish(d, { format: csv ? 'csv' : 'xlsx', title: wb.SheetNames[0], meta: { sheets: wb.SheetNames } });
}

async function extractPptx(bytes: Uint8Array): Promise<Extracted> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const num = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  const paras = (xml: string) => [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map(p => decodeEntities([...p[0].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(t => t[1]).join('')).trim()).filter(Boolean);
  const d = new Doc();
  let title: string | undefined;
  for (let i = 0; i < slides.length; i++) {
    const n = num(slides[i]);
    const lines = paras(await zip.file(slides[i])!.async('string'));
    const notes = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    const noteLines = notes ? paras(await notes.async('string')).filter(l => !/^\d+$/.test(l)) : [];
    if (!lines.length && !noteLines.length) continue;
    title ??= lines[0];
    d.para(); d.anchor(`slide ${n}`);
    d.add(`## Slide ${n}\n\n${lines.map((l, j) => (j === 0 ? `### ${l}` : `- ${l}`)).join('\n')}\n`);
    if (noteLines.length) d.add(`\nNotes: ${noteLines.join(' ')}\n`);
  }
  return finish(d, { format: 'pptx', pages: slides.length, title });
}

function extractHtml(bytes: Uint8Array): Extracted {
  const r = htmlToMarkdown(decodeUtf8(bytes));
  return { format: 'html', text: r.text, anchors: r.anchors, title: r.title ?? r.anchors[0]?.label };
}

function extractPlain(bytes: Uint8Array, format: 'md' | 'txt'): Extracted {
  const text = decodeUtf8(bytes).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const anchors = markdownAnchors(text);
  return { format, text, anchors, title: anchors[0]?.label };
}

function extractJson(bytes: Uint8Array): Extracted {
  const raw = decodeUtf8(bytes);
  let text = raw;
  try { text = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep as is */ }
  return { format: 'json', text: text.trimEnd() + '\n', anchors: [] };
}

/* ── EML ─────────────────────────────────────────────────────────────── */

function parseHeaders(block: string): Record<string, string> {
  const h: Record<string, string> = {};
  const unfolded = block.replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (m && !(m[1].toLowerCase() in h)) h[m[1].toLowerCase()] = mimeWords(m[2].trim());
  }
  return h;
}
function mimeWords(s: string): string {
  return s.replace(/=\?([\w-]+)\?([bq])\?([^?]*)\?=/gi, (_m, cs: string, enc: string, data: string) => {
    try {
      const buf = enc.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, hx: string) => String.fromCharCode(parseInt(hx, 16))), 'latin1');
      return new TextDecoder(/utf-?8/i.test(cs) ? 'utf-8' : 'latin1').decode(buf);
    } catch { return data; }
  });
}
function decodeBody(body: string, encoding: string, charset: string): string {
  let buf: Buffer;
  const enc = encoding.toLowerCase();
  if (enc === 'base64') buf = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  else if (enc === 'quoted-printable') buf = Buffer.from(body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_m, hx: string) => String.fromCharCode(parseInt(hx, 16))), 'latin1');
  else buf = Buffer.from(body, 'utf8');
  if (enc === '7bit' || enc === '8bit' || enc === '' || enc === 'binary') return body;
  try { return new TextDecoder(/utf-?8/i.test(charset) || !charset ? 'utf-8' : 'latin1').decode(buf); } catch { return buf.toString('latin1'); }
}
function emlParts(raw: string, headers: Record<string, string>): { plain?: string; html?: string; attachments: string[] } {
  const ct = headers['content-type'] ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(ct)?.[1];
  const charset = /charset="?([^";]+)"?/i.exec(ct)?.[1] ?? '';
  const enc = headers['content-transfer-encoding'] ?? '';
  const out: { plain?: string; html?: string; attachments: string[] } = { attachments: [] };
  if (/^multipart\//i.test(ct) && boundary) {
    const esc = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = raw.split(new RegExp(`\\n?--${esc}(?:--)?[ \\t]*\\n?`)).slice(1);
    for (const p of parts) {
      const cut = p.indexOf('\n\n');
      if (cut < 0) continue;
      const ph = parseHeaders(p.slice(0, cut)), pb = p.slice(cut + 2);
      const sub = emlParts(pb, ph);
      const disp = ph['content-disposition'] ?? '';
      const name = /filename\*?="?([^";]+)"?/i.exec(disp)?.[1] ?? /name="?([^";]+)"?/i.exec(ph['content-type'] ?? '')?.[1];
      if (/attachment/i.test(disp) && name) { out.attachments.push(mimeWords(name)); continue; }
      out.plain ??= sub.plain; out.html ??= sub.html; out.attachments.push(...sub.attachments);
    }
    return out;
  }
  const body = decodeBody(raw, enc, charset);
  if (/text\/html/i.test(ct)) out.html = body; else if (/^text\//i.test(ct) || !ct) out.plain = body;
  return out;
}

function extractEml(bytes: Uint8Array): Extracted {
  const raw = decodeUtf8(bytes);
  const cut = raw.indexOf('\n\n');
  const headers = parseHeaders(cut < 0 ? raw : raw.slice(0, cut));
  const parts = emlParts(cut < 0 ? '' : raw.slice(cut + 2), headers);
  const body = (parts.plain ?? (parts.html ? htmlToMarkdown(parts.html).text : '')).replace(/\n{3,}/g, '\n\n').trim();
  const d = new Doc();
  const subject = headers.subject || '(no subject)';
  d.anchor('headers');
  d.add(`# ${subject}\n\n`);
  for (const k of ['from', 'to', 'cc', 'date', 'message-id', 'in-reply-to']) if (headers[k]) d.add(`${k[0].toUpperCase()}${k.slice(1)}: ${headers[k]}\n`);
  if (parts.attachments.length) d.add(`Attachments: ${parts.attachments.join(', ')}\n`);
  d.add('\n'); d.anchor('body'); d.add(body + '\n');
  return finish(d, { format: 'eml', title: subject, meta: { headers: Object.fromEntries(['from', 'to', 'cc', 'date', 'subject', 'message-id'].filter(k => headers[k]).map(k => [k, headers[k]])), attachments: parts.attachments } });
}

/* ── entry point ─────────────────────────────────────────────────────── */

export async function extractText(bytes: Uint8Array, mime: string, filename: string): Promise<Extracted> {
  const format = await detectFormat(bytes, mime, filename);
  if (!format) throw new UnsupportedFormat(filename, mime);
  let r: Extracted;
  switch (format) {
    case 'pdf': r = await extractPdf(bytes); break;
    case 'docx': r = await extractDocx(bytes); break;
    case 'xlsx': r = await extractSheets(bytes, false); break;
    case 'csv': r = await extractSheets(bytes, true); break;
    case 'pptx': r = await extractPptx(bytes); break;
    case 'html': r = extractHtml(bytes); break;
    case 'md': r = extractPlain(bytes, 'md'); break;
    case 'txt': r = extractPlain(bytes, 'txt'); break;
    case 'eml': r = extractEml(bytes); break;
    case 'json': r = extractJson(bytes); break;
  }
  if (!r.anchors.length && r.text.trim()) r.anchors = [{ label: 'start', offset: 0 }];
  return r;
}
