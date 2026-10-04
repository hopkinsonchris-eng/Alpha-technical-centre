/* ============================================================
   Record panel content (wave 2, docs/vault-hub/wave2/05-markup.md §1.2).
   A record is shown the way a Salesforce record page shows one: a highlights
   strip of the five to seven fields that matter for its kind, related cards
   you can pivot through, and the raw record behind a closed disclosure. The
   panel chrome (open, close, sheet) stays in project.js; this module only
   builds what goes inside it.

   renderRecord({ kind, ref, rec, node, entry, ctx }) → DocumentFragment
     kind   'run' | 'doc' | 'ref'
     rec    the API record (null when unavailable)
     node   the lineage node, entry the timeline entry (either may be absent)
     ctx    { project, entryById, lineage, versionsOf(id), open(ref, title) }
   ============================================================ */
import { mk, dv, add, fmtShortDate, num, RUN_STATUS } from './hub.js';
import { firstReason } from './components/stale-badge.js';
import { buildViewer } from './viewer.js';

const TYPE_LABEL = {
  report: ['Report', 'Informe'], letter: ['Letter', 'Carta'], email: ['Email', 'Correo'], spreadsheet: ['Spreadsheet', 'Hoja de cálculo'],
  paper: ['Paper', 'Artículo'], invoice: ['Invoice', 'Factura'], note: ['Note', 'Nota'], nda: ['NDA', 'Acuerdo de confidencialidad'],
  contract: ['Contract', 'Contrato'], proposal: ['Proposal', 'Propuesta'], presentation: ['Presentation', 'Presentación'], scan: ['Scan', 'Escaneo'],
  dataset: ['Dataset', 'Conjunto de datos'], image: ['Image', 'Imagen'],
};
const MIME_SHORT = {
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'message/rfc822': 'eml', 'text/csv': 'csv',
};
const INGEST_WORD = {
  ok: ['indexed', 'indexado'], skipped: ['indexed', 'indexado'], empty: ['no text found', 'sin texto'], needs_ocr: ['needs OCR', 'necesita OCR'],
  unsupported: ['format not supported', 'formato no admitido'], no_original: ['original missing', 'falta el original'],
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const short = (ref) => (ref && ref.length > 40 ? ref.slice(0, 40) + '…' : ref);
const hashShort = (h) => (h ? h.replace(/^(sha256:[0-9a-f]{8})[0-9a-f]+$/, '$1…') : '');
const idOf = (ref) => ref.slice(ref.indexOf(':') + 1);

/** Human label for a ref: the lineage node's label, the timeline entry's title, or the ref itself. */
function labelOf(ref, ctx) {
  const node = ctx.lineage && (ctx.lineage.nodes || []).find((n) => n.id === ref);
  if (node && node.label) return node.label;
  const e = ctx.entryById && ctx.entryById.get(idOf(ref));
  if (e && e.title) return e.title;
  return ref.startsWith('ref:') ? ref.slice(4) : ref;
}

/** A list item that pivots to another record (runs and documents) or just names a reference set. */
function refItem(ref, ctx, extra) {
  const li = mk('li', null, null, null, { 'data-ref': ref });
  const label = labelOf(ref, ctx);
  if (/^(run|doc):/.test(ref)) {
    const b = dv('button', 'hub-linkbtn hub-rp-pivot', label, { type: 'button', 'data-pivot': ref });
    b.addEventListener('click', () => ctx.open(ref, label, b));
    add(li, b);
  } else add(li, dv('span', 'mono', label));
  if (extra) add(li, document.createTextNode(' '), extra);
  return li;
}

function card(key, titleEn, titleEs, body) {
  const c = mk('article', 'hub-rp-card', null, null, { 'data-related': key });
  add(c, mk('h4', null, titleEn, titleEs), body);
  return c;
}
function listCard(key, titleEn, titleEs, refs, ctx) {
  const ul = mk('ul', 'hub-rp-list');
  for (const r of refs) add(ul, refItem(r, ctx));
  return card(key, titleEn, titleEs, ul);
}
const h = (dl, key, en, es, valueNode) => add(dl, mk('dt', null, en, es), add(mk('dd', null, null, null, { 'data-h': key }), valueNode));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** Edges leaving this ref that mean "something used or quoted it": runs that took it as an input, documents that cite it. */
function citedBy(ref, ctx) {
  const edges = (ctx.lineage && ctx.lineage.edges) || [];
  return edges.filter((e) => e.from === ref && (e.type === 'cites' || e.type === 'input')).map((e) => e.to);
}

function staleNode(entry, node, rec) {
  const stale = (entry && entry.stale) || (node && node.stale) || (rec && rec.stale);
  if (!stale) return mk('span', null, 'No', 'No');
  const why = firstReason((entry && entry.stale_reasons) || (rec && rec.stale_reasons));
  return add(mk('span'), mk('span', 'hub-stale', 'Stale', 'Obsoleta'), document.createTextNode(' '), why ? dv('span', null, why) : mk('span', null, 'no reason recorded', 'sin motivo registrado'));
}

const DRAFT_KIND = { email: ['Email draft', 'Borrador de correo'], letter: ['Letter draft', 'Borrador de carta'], 'report-section': ['Report section draft', 'Borrador de sección de informe'], 'calc-note': ['Calc note draft', 'Borrador de nota de cálculo'] };
const DECISION_WORD = { keep: ['kept', 'mantenido'], 'keep-note': ['kept with a note', 'mantenido con nota'], drop: ['dropped', 'quitado'] };
const QUESTION_RE = /^\[QUESTION FOR YOU: ?(.*)\]$/s;
const CITE_RE = /\[((?:run|doc|lesson|ref|wm):[^\]]+)\]/g;

/* ── drafts written in the Hub ───────────────────────────────────────── */

/** The draft as saved: each paragraph with its citations as pivots, the decision and note from the saved review,
 *  then the review's own line (saved when, by whom; or not yet) and, for a partner, a way back into Write to…. */
function draftView(rec, ctx) {
  const ex = rec.extracted;
  const review = ex.review && Array.isArray(ex.review.decisions) ? ex.review : null;
  const host = mk('div', 'hub-rp-draft', null, null, { 'data-draft-view': '', 'data-review': review ? 'saved' : 'none' });
  const titleOf = (ref) => { const s = (ex.sources || []).find((x) => x.ref === ref); return s ? s.title : labelOf(ref, ctx); };
  ex.paragraphs.forEach((text, i) => {
    const decision = review ? review.decisions[i] : null;
    const p = mk('div', 'hub-dr-para', null, null, { 'data-i': String(i), ...(decision ? { 'data-decision': decision } : {}) });
    const q = QUESTION_RE.exec(text);
    const body = mk('p', q ? 'hub-dr-text hub-uncited' : 'hub-dr-text');
    if (q) {
      const quoted = /"([\s\S]*)"\s*$/.exec(q[1]);
      body.setAttribute('data-uncited', ''); add(body, mk('span', 'hub-dr-flag', 'No record to cite: ', 'Sin registro que citar: '), dv('span', null, quoted ? quoted[1] : q[1]));
    } else {
      let last = 0;
      for (const m of text.matchAll(CITE_RE)) {
        if (m.index > last) add(body, dv('span', null, text.slice(last, m.index)));
        const ref = m[1], label = titleOf(ref);
        if (/^(run|doc):/.test(ref)) { const b = dv('button', 'hub-cite hub-rp-pivot', label, { type: 'button', 'data-pivot': ref, title: ref }); b.addEventListener('click', () => ctx.open(ref, label, b)); add(body, b); }
        else add(body, dv('span', 'hub-cite', label, { title: ref }));
        last = m.index + m[0].length;
      }
      if (last < text.length) add(body, dv('span', null, text.slice(last)));
    }
    add(p, body);
    if (decision) {
      const w = DECISION_WORD[decision] || [decision, decision];
      const line = mk('div', 'hub-rp-decision', null, null, { 'data-decided': decision });
      add(line, mk('span', 'hub-pill ' + (decision === 'drop' ? 'muted' : 'gold'), w[0], w[1]));
      const note = review.notes && review.notes[String(i)];
      if (note) add(line, dv('span', 'hub-rp-note', note, { 'data-note': String(i) }));
      add(p, line);
    }
    add(host, p);
  });
  const foot = mk('div', 'hub-rp-draft-foot', null, null, { 'data-draft-foot': '' });
  if (ex.sent && ex.sent.at) {
    const d = fmtShortDate(ex.sent.at);
    add(foot, mk('p', null, 'Sent' + (ex.sent.organisation ? ' to ' + ex.sent.organisation : '') + ' on ' + d.en + '. The draft is frozen.', 'Enviado' + (ex.sent.organisation ? ' a ' + ex.sent.organisation : '') + ' el ' + d.es + '. El borrador está congelado.'));
  } else if (review) {
    const d = review.at ? fmtShortDate(review.at) : null;
    const kept = review.decisions.filter((x) => x !== 'drop').length, dropped = review.decisions.length - kept;
    add(foot, mk('p', null, 'Review saved' + (d ? ' ' + d.en : '') + (review.by ? ' by ' + review.by : '') + ' · ' + plural(kept, 'paragraph kept', 'paragraphs kept') + ', ' + dropped + ' dropped.', 'Revisión guardada' + (d ? ' el ' + d.es : '') + (review.by ? ' por ' + review.by : '') + ' · ' + plural(kept, 'párrafo mantenido', 'párrafos mantenidos') + ', ' + dropped + ' quitados.'));
  } else add(foot, mk('p', 'hub-muted', 'Review not saved yet: the draft is kept as written.', 'Revisión aún sin guardar: el borrador se conserva tal como se escribió.'));
  if (typeof ctx.openDraft === 'function') {
    const b = mk('button', 'btn btn-primary btn-sm', ex.sent ? 'Open in Write to…' : 'Continue in Write to…', ex.sent ? 'Abrir en Escribir a…' : 'Continuar en Escribir a…', { type: 'button', 'data-open-draft': rec.id });
    b.addEventListener('click', () => ctx.openDraft(rec, b));
    add(foot, b);
  }
  add(host, foot);
  return host;
}

/* ── documents ───────────────────────────────────────────────────────── */

async function renderDoc({ ref, rec, node, entry, ctx }) {
  const frag = document.createDocumentFragment();
  const src = rec || {};
  const type = src.type || (node && node.type) || (entry && entry.type) || '';
  const dl = mk('dl', 'hub-kv hub-rp-highlights', null, null, { 'data-highlights': '' });
  const ex0 = src.extracted || {};
  const dk = ex0.kind === 'draft' ? (DRAFT_KIND[ex0.draft_kind] || DRAFT_KIND.email) : null;
  const tl = dk || TYPE_LABEL[type];
  h(dl, 'type', 'Type', 'Tipo', tl ? mk('span', null, tl[0], tl[1]) : dv('span', null, cap(type)));
  const pid = src.project_id || (node && node.project_id) || (ctx.project && ctx.project.id);
  const pname = ctx.project && ctx.project.id === pid ? ctx.project.name : pid;
  h(dl, 'project', 'Project', 'Proyecto', pid ? dv('a', 'hub-inline-link', pname, { href: '/hub/project.html?id=' + encodeURIComponent(pid) }) : mk('span', null, '—', '—'));
  h(dl, 'legal_tag', 'Legal tag', 'Etiqueta legal', dv('span', 'hub-lt', src.legal_tag || (entry && entry.legal_tag)));
  const version = src.version || (entry && entry.version) || 1;
  const supersedes = src.supersedes || (entry && entry.supersedes);
  const vText = 'v' + version + (supersedes ? ' · supersedes v' + Math.max(1, version - 1) : '');
  const vTextEs = 'v' + version + (supersedes ? ' · reemplaza v' + Math.max(1, version - 1) : '');
  h(dl, 'version', 'Version', 'Versión', mk('span', null, vText, vTextEs));
  const when = src.created_at || (entry && entry.at);
  const d = when ? fmtShortDate(when) : null;
  const source = src.origin && src.origin.source;
  h(dl, 'ingested', 'Ingested', 'Ingresado', d ? add(mk('span'), mk('span', null, d.en, d.es), source ? dv('span', 'hub-muted', ' · ' + source) : null) : mk('span', null, '—', '—'));
  const ex = src.extracted || {};
  let indexed;
  if (ex.ingest && (ex.ingest.status === 'ok' || ex.ingest.status === 'skipped')) {
    const bits = [plural(Number(ex.chunks || 0), 'chunk', 'chunks')];
    const bitsEs = [plural(Number(ex.chunks || 0), 'fragmento', 'fragmentos')];
    if (ex.pages) { bits.push(plural(ex.pages, 'page', 'pages')); bitsEs.push(plural(ex.pages, 'página', 'páginas')); }
    if (ex.text_chars) { bits.push(num(ex.text_chars) + ' characters'); bitsEs.push(num(ex.text_chars) + ' caracteres'); }
    indexed = mk('span', null, bits.join(' · '), bitsEs.join(' · '));
  } else if (ex.ingest && INGEST_WORD[ex.ingest.status]) indexed = mk('span', null, INGEST_WORD[ex.ingest.status][0], INGEST_WORD[ex.ingest.status][1]);
  else indexed = mk('span', 'hub-muted', 'not indexed yet', 'aún no indexado');
  h(dl, 'indexed', 'Indexed', 'Indexado', indexed);
  h(dl, 'stale', 'Stale', 'Obsoleto', staleNode(entry, node, rec));
  add(frag, dl);

  if (!rec) return frag;   // nothing more is known without the record

  // View (wave 5): the original itself, when the store has it; a record filed without one, or whose original
  // predates durable storage, says so instead.
  // A draft written in the Hub has no original file: the draft itself is the record, with the review as saved.
  const viewBody = ex.kind === 'draft' && Array.isArray(ex.paragraphs) ? draftView(rec, ctx)
    : rec.storage_key && !(ex.ingest && ex.ingest.status === 'no_original') ? buildViewer(rec)
    : mk('p', 'hub-muted', rec.storage_key ? 'Original missing: upload it again.' : 'Filed without an original.', rec.storage_key ? 'Falta el original: súbalo de nuevo.' : 'Registrado sin original.');
  add(frag, add(mk('div', 'hub-rp-card hub-rp-view', null, null, { 'data-view': '' }), mk('h4', null, ex.kind === 'draft' ? 'The draft' : 'View', ex.kind === 'draft' ? 'El borrador' : 'Ver'), viewBody));

  // Related: versions, cites, cited by, original.
  const rel = mk('div', 'hub-rp-related');
  const versions = await ctx.versionsOf(rec.id);
  const vul = mk('ul', 'hub-rp-list');
  const list = versions && versions.length ? versions : [{ version, created_at: rec.created_at, content_hash: rec.content_hash }];
  for (const v of list) {
    const vd = v.created_at ? fmtShortDate(v.created_at) : null;
    add(vul, add(mk('li', null, null, null, { 'data-version': String(v.version) }), dv('b', null, 'v' + v.version), vd ? mk('span', null, ' · ' + vd.en, ' · ' + vd.es) : null, v.content_hash ? dv('span', 'mono hub-muted', ' · ' + hashShort(v.content_hash)) : null));
  }
  add(rel, card('versions', plural(list.length, 'version', 'versions'), plural(list.length, 'versión', 'versiones'), vul));
  const cites = Array.isArray(rec.cites) ? rec.cites : [];
  if (cites.length) add(rel, listCard('cites', 'Cites', 'Cita', cites, ctx));
  const by = citedBy(ref, ctx);
  if (by.length) add(rel, listCard('cited-by', 'Used by', 'Usado por', by, ctx));
  const orig = mk('dl', 'hub-kv hub-rp-orig');
  const fmt = MIME_SHORT[rec.mime] || (rec.storage_key && /\.([a-z0-9]{2,5})$/i.exec(rec.storage_key) || [])[1] || (ex.format || '');
  if (fmt) add(orig, mk('dt', null, 'Format', 'Formato'), dv('dd', null, fmt));
  if (rec.content_hash) add(orig, mk('dt', null, 'Hash', 'Hash'), dv('dd', 'mono', hashShort(rec.content_hash), { title: rec.content_hash }));
  if (rec.storage_key) add(orig, mk('dt', null, 'Stored at', 'Guardado en'), dv('dd', 'mono', rec.storage_key));
  if (rec.reference_no) add(orig, mk('dt', null, 'Reference no.', 'N.º de referencia'), dv('dd', 'mono', rec.reference_no));
  add(rel, card('original', 'Original', 'Original', orig));
  add(frag, rel);
  return frag;
}

/* ── runs ────────────────────────────────────────────────────────────── */

function headline(outputs) {
  const bits = [];
  for (const [k, o] of Object.entries(outputs || {})) {
    if (k === 'method' || !o || typeof o.value !== 'number') continue;
    bits.push(k.replace(/_/g, ' ') + ' ' + num(o.value) + (o.unit ? ' ' + o.unit : ''));
    if (bits.length === 3) break;
  }
  return bits.join(' · ');
}

function renderRun({ ref, rec, node, entry, ctx }) {
  const frag = document.createDocumentFragment();
  const src = rec || {};
  const dl = mk('dl', 'hub-kv hub-rp-highlights', null, null, { 'data-highlights': '' });
  const job = src.job || (node && node.job) || (entry && entry.job);
  const ver = src.tool_version || (entry && entry.tool_version);
  h(dl, 'tool', 'Tool', 'Herramienta', job ? dv('a', 'hub-inline-link mono', job + (ver ? '@' + ver : ''), { href: '/hub/tool.html?id=' + encodeURIComponent(job) }) : mk('span', null, '—', '—'));
  const status = src.status || (node && node.status) || (entry && entry.status);
  const st = RUN_STATUS[status] || [status, status, 'muted'];
  h(dl, 'status', 'Status', 'Estado', status ? mk('span', 'hub-pill ' + st[2], st[0], st[1], { 'data-status': status }) : mk('span', null, '—', '—'));
  const hl = headline(src.outputs);
  h(dl, 'headline', 'Headline', 'Cifras', hl ? dv('span', null, hl) : mk('span', 'hub-muted', 'no numeric outputs', 'sin resultados numéricos'));
  const inputs = Array.isArray(src.inputs) ? src.inputs : [];
  h(dl, 'inputs', 'Inputs', 'Entradas', dv('span', null, String(inputs.length)));
  h(dl, 'legal_tag', 'Legal tag', 'Etiqueta legal', dv('span', 'hub-lt', src.legal_tag || (entry && entry.legal_tag)));
  h(dl, 'stale', 'Stale', 'Obsoleto', staleNode(entry, node, rec));
  add(frag, dl);
  if (!rec) return frag;

  const rel = mk('div', 'hub-rp-related');
  const pid = rec.project_id || (ctx.project && ctx.project.id);
  const pname = ctx.project && ctx.project.id === pid ? ctx.project.name : pid;
  add(rel, card('project', 'Project', 'Proyecto', dv('a', 'hub-inline-link', pname, { href: '/hub/project.html?id=' + encodeURIComponent(pid) })));
  const iul = mk('ul', 'hub-rp-list');
  if (inputs.length) for (const i of inputs) add(iul, refItem(i.ref, ctx, i.role ? dv('span', 'hub-muted', '· ' + i.role) : null));
  else add(iul, mk('li', 'hub-muted', 'None declared', 'Ninguna declarada'));
  add(rel, card('inputs', 'Inputs', 'Entradas', iul));
  const sup = rec.supersedes || (entry && entry.supersedes), by = entry && entry.superseded_by;
  if (sup || by) {
    const sul = mk('ul', 'hub-rp-list');
    if (sup) add(sul, refItem('run:' + sup, ctx, mk('span', 'hub-muted', '· superseded by this run', '· reemplazada por esta ejecución')));
    if (by) add(sul, refItem('run:' + by, ctx, mk('span', 'hub-muted', '· supersedes this run', '· reemplaza esta ejecución')));
    add(rel, card('supersedes', 'Supersession', 'Reemplazo', sul));
  }
  const cb = citedBy(ref, ctx);
  if (cb.length) add(rel, listCard('cited-by', 'Quoted by', 'Citada por', cb, ctx));
  add(frag, rel);
  return frag;
}

/* ── reference sets and unknown refs ────────────────────────────────── */

function renderRef({ ref, node, entry }) {
  const frag = document.createDocumentFragment();
  const dl = mk('dl', 'hub-kv hub-rp-highlights', null, null, { 'data-highlights': '' });
  h(dl, 'ref', 'Reference', 'Referencia', dv('span', 'mono', ref));
  h(dl, 'kind', 'Kind', 'Clase', dv('span', null, (node && node.kind) || (entry && entry.kind) || 'reference'));
  add(frag, dl);
  return frag;
}

/** Builds the panel body for a record. Returns a fragment: highlights, related cards; the caller appends notices and the Details disclosure. */
export async function renderRecord(args) {
  if (args.kind === 'doc') return renderDoc(args);
  if (args.kind === 'run') return renderRun(args);
  return renderRef(args);
}

/** The closed Details disclosure holding the raw record (escaped so it is safe as a data value). */
export function detailsNode(summary) {
  const det = mk('details', 'hub-rp-details');
  add(det, mk('summary', null, 'Full record', 'Registro completo'));
  add(det, dv('pre', 'hub-json', JSON.stringify(summary, null, 2).replace(/</g, '\\u003c'), { 'data-json': '' }));
  return det;
}

export { short };
