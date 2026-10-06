/**
 * Chunking and contextual retrieval (M09, practice scan P11).
 *
 * chunkText: ~600-token chunks (tokens ≈ chars/4) of own content, each preceded by a 15% overlap taken
 * from the end of the previous chunk, cut at paragraph boundaries where possible; a Markdown table is
 * kept whole when it fits and otherwise split by rows with its header repeated.
 * contextualise: an LLM-written 50-100 token context ("this chunk is from <title>, section <x>, about <y>")
 * is stored with each chunk and prepended before embedding and in the tsvector (the chunks table builds
 * tsv from context || text). One provider call per chunk today; the whole document rides in the system
 * prompt so provider-side prompt caching applies. FOLLOW-UP: move the per-chunk calls to the Anthropic
 * Message Batches API (50% cost, async) for bulk backfills; the (chunks, doc) → contexts shape is already batch-ready.
 */
import type { LlmProvider } from '../llm/provider.ts';
import type { Anchor } from './extract.ts';

export const TARGET_TOKENS = 600;
export const OVERLAP_RATIO = 0.15;
export const CONTEXT_MAX_TOKENS = 100;
export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export interface Chunk {
  ordinal: number;
  /** Overlap from the previous chunk followed by this chunk's own content. */
  text: string;
  /** Anchor (page, sheet cell, slide, heading) in force where this chunk's own content starts. */
  anchor: string | null;
  /** Offset in the source text where own content starts. */
  start: number;
  /** Length of the overlap prefix inside `text`. */
  overlap: number;
  context: string;
}
export interface ChunkOptions { targetTokens?: number; overlap?: number }

interface Unit { text: string; start: number; table: boolean }

const isTableLine = (l: string) => l.trimStart().startsWith('|');

/** Blocks separated by blank lines; a table is one block; a lone heading sticks to the block after it. */
function blocks(text: string): Unit[] {
  const out: Unit[] = [];
  let cur: string[] = [], curStart = 0, curTable = false, offset = 0;
  const flush = () => { if (cur.length) out.push({ text: cur.join('\n'), start: curStart, table: curTable }); cur = []; };
  for (const line of text.split('\n')) {
    const t = isTableLine(line);
    if (!line.trim()) flush();
    else {
      if (cur.length && t !== curTable) flush();
      if (!cur.length) { curStart = offset; curTable = t; }
      cur.push(line);
    }
    offset += line.length + 1;
  }
  flush();
  const merged: Unit[] = [];
  for (let i = 0; i < out.length; i++) {
    const b = out[i];
    if (/^#{1,6}\s/.test(b.text) && !b.text.includes('\n') && i + 1 < out.length) { out[i + 1] = { text: b.text + '\n\n' + out[i + 1].text, start: b.start, table: out[i + 1].table }; continue; }
    merged.push(b);
  }
  return merged;
}

/** Split a unit larger than `max` chars: table rows (header repeated), else sentence/line boundaries, else a hard cut at whitespace. */
function split(u: Unit, max: number): Unit[] {
  if (u.text.length <= max) return [u];
  const out: Unit[] = [];
  if (u.table || u.text.split('\n').filter(isTableLine).length > 2) {
    const lines = u.text.split('\n');
    const head = lines.filter((l, i) => i < 2 && isTableLine(l)).join('\n');
    const bodyStart = head ? head.split('\n').length : 0;
    let cur = head, curOffset = 0, off = 0;
    for (let i = 0; i < bodyStart; i++) off += lines[i].length + 1;
    let started = false;
    for (let i = bodyStart; i < lines.length; i++) {
      const l = lines[i];
      if (started && cur.length + l.length + 1 > max) { out.push({ text: cur, start: u.start + curOffset, table: true }); cur = head; started = false; }
      if (!started) curOffset = off;
      cur += (cur ? '\n' : '') + l; started = true; off += l.length + 1;
    }
    if (started) out.push({ text: cur, start: u.start + curOffset, table: true });
    return out.flatMap(p => (p.text.length > max ? splitProse(p, max) : [p]));
  }
  return splitProse(u, max);
}

function splitProse(u: Unit, max: number): Unit[] {
  const pieces: Unit[] = [];
  const sentences: Array<{ t: string; at: number }> = [];
  const re = /[.!?]["')\]]*\s+|\n/g;
  let last = 0;
  for (let m = re.exec(u.text); m; m = re.exec(u.text)) { sentences.push({ t: u.text.slice(last, m.index + m[0].length), at: last }); last = m.index + m[0].length; }
  if (last < u.text.length) sentences.push({ t: u.text.slice(last), at: last });
  let cur = '', curAt = 0;
  const push = () => { if (cur.trim()) pieces.push({ text: cur.trimEnd(), start: u.start + curAt, table: false }); cur = ''; };
  for (const s of sentences) {
    if (s.t.length > max) { // no sentence boundary in reach: cut at whitespace
      push();
      for (let i = 0; i < s.t.length;) {
        let end = Math.min(i + max, s.t.length);
        if (end < s.t.length) { const sp = s.t.lastIndexOf(' ', end); if (sp > i + max * 0.5) end = sp; }
        pieces.push({ text: s.t.slice(i, end).trim(), start: u.start + s.at + i, table: false });
        i = end;
      }
      continue;
    }
    if (cur && cur.length + s.t.length > max) push();
    if (!cur) curAt = s.at;
    cur += s.t;
  }
  push();
  return pieces.filter(p => p.text);
}

function anchorAt(anchors: Anchor[], offset: number): string | null {
  let best: Anchor | null = null;
  for (const a of anchors) if (a.offset <= offset && (!best || a.offset >= best.offset)) best = a;
  return best?.label ?? null;
}

/** The tail of `own` no longer than `max` chars, starting at a line (preferred) or word boundary. */
function tail(own: string, max: number): string {
  if (max <= 0 || !own) return '';
  if (own.length <= max) return own;
  const t = own.slice(-max);
  const nl = t.indexOf('\n');
  if (nl >= 0 && nl < t.length - 1) return t.slice(nl + 1).trim();
  const sp = t.indexOf(' ');
  return (sp >= 0 ? t.slice(sp + 1) : t).trim();
}

export function chunkText(text: string, anchors: Anchor[] = [], opts: ChunkOptions = {}): Chunk[] {
  const target = (opts.targetTokens ?? TARGET_TOKENS) * 4;
  const overlapChars = Math.round(target * (opts.overlap ?? OVERLAP_RATIO));
  const units = blocks(text).flatMap(b => split(b, target));
  // Pack own content: add a unit while that leaves the chunk closer to the target than stopping would.
  const groups: Unit[][] = [];
  let cur: Unit[] = [], len = 0;
  for (const u of units) {
    const add = u.text.length + (cur.length ? 2 : 0);
    if (cur.length && Math.abs(len + add - target) >= Math.abs(len - target)) { groups.push(cur); cur = []; len = 0; }
    len += u.text.length + (cur.length ? 2 : 0); cur.push(u);
  }
  if (cur.length) groups.push(cur);
  const size = (g: Unit[]) => g.reduce((n, u) => n + u.text.length + 2, -2);
  if (groups.length > 1 && size(groups.at(-1)!) < target * 0.3 && size(groups.at(-2)!) + size(groups.at(-1)!) + 2 <= target * 1.35) {
    groups.splice(-2, 2, [...groups.at(-2)!, ...groups.at(-1)!]);
  }
  const chunks: Chunk[] = [];
  let prevOwn = '';
  for (const g of groups) {
    const own = g.map(u => u.text).join('\n\n');
    const pre = chunks.length ? tail(prevOwn, overlapChars) : '';
    chunks.push({ ordinal: chunks.length, text: pre ? `${pre}\n\n${own}` : own, anchor: anchorAt(anchors, g[0].start), start: g[0].start, overlap: pre ? pre.length + 2 : 0, context: '' });
    prevOwn = own;
  }
  return chunks;
}

/* ── contextual retrieval ────────────────────────────────────────────── */

export interface ChunkDoc { title: string; type?: string; /** Full extracted text: put in the (cacheable) system prompt. */ text?: string }
export interface ContextOptions { concurrency?: number; maxDocChars?: number }

const clean = (s: string) => s.replace(/<\/?chunk>/gi, ' ').replace(/\s+/g, ' ').trim();

function clamp(s: string, maxTokens = CONTEXT_MAX_TOKENS): string {
  const max = maxTokens * 4;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s]+$/, '') + '…';
}

/** Deterministic context used when no provider is configured or a call fails. */
export function templateContext(doc: ChunkDoc, chunk: Pick<Chunk, 'anchor' | 'text'>): string {
  const first = clean(chunk.text).slice(0, 80);
  return clamp(`This chunk is from "${doc.title}"${doc.type ? ` (${doc.type})` : ''}${chunk.anchor ? `, section ${chunk.anchor}` : ''}, beginning "${first}".`);
}

export async function contextualise(chunks: Chunk[], doc: ChunkDoc, provider: LlmProvider | null, opts: ContextOptions = {}): Promise<Chunk[]> {
  const out = chunks.map(c => ({ ...c }));
  if (!provider) { for (const c of out) c.context = templateContext(doc, c); return out; }
  const system = [
    'You situate a chunk of a document inside the whole document so it can be found by search.',
    'Reply with 50 to 100 tokens of plain prose and nothing else, in the form: "This chunk is from <document title>, section <section>, about <what the chunk covers>".',
    'Name the parties, dates, amounts, wells, fields or projects the chunk concerns when they are clear. Do not quote the chunk at length.',
    `<document title="${doc.title.replace(/"/g, "'")}"${doc.type ? ` type="${doc.type}"` : ''}>`,
    (doc.text ?? '').slice(0, opts.maxDocChars ?? 120_000),
    '</document>',
  ].join('\n');
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= out.length) return;
      const c = out[i];
      const user = `This chunk is from "${doc.title}", section ${c.anchor ?? 'start'}.\n<chunk>\n${c.text.slice(0, 6000)}\n</chunk>\nWrite the context for this chunk.`;
      try {
        const r = await provider.complete({ system, messages: [{ role: 'user', content: user }], maxTokens: 220, temperature: 0, purpose: 'context' });
        c.context = clamp(clean(r.text)) || templateContext(doc, c);
      } catch { c.context = templateContext(doc, c); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, out.length)) }, worker));
  return out;
}
