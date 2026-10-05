/* ============================================================
   Record panel content (wave 2, docs/vault-hub/wave2/05-markup.md §1.2;
   wave 7 PR2, docs/vault-hub/wave7/05-markup.md §1.4, R5, W7-AC8).
   The panel shows the record: the title (panel chrome), one meta line,
   then the content itself: the viewer for PDFs and images, the extracted
   text for mail, letters, text, DOCX and CSV (GET /api/items/:id?text=1)
   with the Find term highlighted and the passage anchored, a draft as its
   paragraphs, a dossier as its facts, a paper as its abstract. Then the
   actions (Open original, Download, Write a reply, Cite), the related
   cards (versions, cites, used by) and a closed Technical disclosure with
   the hash, the storage key, the chunks and the raw JSON, last.
   A run: outputs as a two-column table with the manifest's labels and
   units, assumptions with provenance dots, inputs as links, and Open in
   tool, Re-run, Compare with previous.
   The panel chrome (open, close, sheet) stays in project.js; this module
   only builds what goes inside it.

   renderRecord({ kind, ref, rec, node, entry, ctx }) → DocumentFragment
     kind   'run' | 'doc' | 'ref'
     rec    the API record (null when unavailable)
     node   the lineage node, entry the timeline entry (either may be absent)
     ctx    { project, entryById, lineage, catalog, versionsOf(id), open(ref, title),
              openDraft(rec), openReply(rec), highlight, passage, siteRoot }
   ============================================================ */
import { mk, dv, add, fmtShortDate, num, RUN_STATUS, api, openTarget, armOnOpen } from './hub.js';
import { firstReason } from './components/stale-badge.js';
import { buildViewer, viewerKind, originalUrl } from './viewer.js';

const TYPE_LABEL = {
  report: ['Report', 'Informe'], letter: ['Letter', 'Carta'], email: ['Email', 'Correo'], spreadsheet: ['Spreadsheet', 'Hoja de cálculo'],
  paper: ['Paper', 'Artículo'], invoice: ['Invoice', 'Factura'], note: ['Note', 'Nota'], nda: ['NDA', 'Acuerdo de confidencialidad'],
  contract: ['Contract', 'Contrato'], proposal: ['Proposal', 'Propuesta'], presentation: ['Presentation', 'Presentación'], scan: ['Scan', 'Escaneo'],
  dataset: ['Dataset', 'Conjunto de datos'], image: ['Image', 'Imagen'], text: ['Text', 'Texto'], research: ['Research finding', 'Hallazgo'],
};
const MIME_SHORT = {
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'message/rfc822': 'eml', 'text/csv': 'csv', 'text/markdown': 'md',
};
const INGEST_WORD = {
  ok: ['indexed', 'indexado'], skipped: ['indexed', 'indexado'], empty: ['no text found', 'sin texto'], needs_ocr: ['needs OCR', 'necesita OCR'],
  unsupported: ['format not supported', 'formato no admitido'], no_original: ['original missing', 'falta el original'],
};
/** The labels a figure wears in the panel, keyed by the names the tool manifests list under produces[]; the unit comes from the run's own output. */
const OUTPUT_LABEL = {
  technical_potential_bopd: ['Technical potential', 'Potencial técnico'], uplift_bopd: ['Uplift', 'Incremento'], npv10: ['NPV10', 'VPN10'], npv10_musd: ['NPV10', 'VPN10'],
  irr: ['IRR', 'TIR'], irr_pct: ['IRR', 'TIR'], government_take: ['Government take', 'Participación del Estado'], payback_year: ['Payback year', 'Año de recuperación'],
  production_profile: ['Production profile', 'Perfil de producción'], operating_point_rate: ['Operating point rate', 'Caudal del punto de operación'],
  operating_point_bhp: ['Operating point BHP', 'Presión de fondo del punto de operación'], cum_oil_np: ['Cumulative oil (Np)', 'Petróleo acumulado (Np)'],
  cum_water_wp: ['Cumulative water (Wp)', 'Agua acumulada (Wp)'], avg_reservoir_pressure: ['Average reservoir pressure', 'Presión media del yacimiento'],
  production_forecast_p10_p50_p90: ['Production forecast P10 / P50 / P90', 'Pronóstico de producción P10 / P50 / P90'],
  scope_of_work: ['Scope of work', 'Alcance del trabajo'], cost_estimate: ['Cost estimate', 'Estimación de costes'], oil_price: ['Oil price', 'Precio del crudo'],
  recovery_factor: ['Recovery factor', 'Factor de recuperación'], opex: ['Opex', 'Opex'], capex: ['Capex', 'Capex'], discount_rate: ['Discount rate', 'Tasa de descuento'],
};
const IMPLIED_UNIT = { bopd: 'bopd', musd: 'MUSD', pct: '%', mmbbl: 'MMbbl', psi: 'psi', bbl: 'bbl' };
const PROVENANCE = {
  measured: ['Measured', 'Medido'], reference: ['Reference set', 'Conjunto de referencia'], document: ['From a document', 'De un documento'],
  analogue: ['Analogue', 'Análogo'], assumed: ['Assumed', 'Supuesto'], model: ['Model', 'Modelo'], manual: ['Entered by hand', 'Introducido a mano'],
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const short = (ref) => (ref && ref.length > 40 ? ref.slice(0, 40) + '…' : ref);
const hashShort = (h) => (h ? h.replace(/^(sha256:[0-9a-f]{8})[0-9a-f]+$/, '$1…') : '');
const idOf = (ref) => ref.slice(ref.indexOf(':') + 1);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
function listCard(key, titleEn, titleEs, refs, ctx, titles) {
  const ul = mk('ul', 'hub-rp-list');
  const c = titles && titles.size ? { ...ctx, entryById: new Map([...(ctx.entryById || new Map()), ...[...titles].map(([r, t]) => [idOf(r), { title: t }])]) } : ctx;
  for (const r of refs) add(ul, refItem(r, c));
  return card(key, titleEn, titleEs, ul);
}
const h = (dl, key, en, es, valueNode) => add(dl, mk('dt', null, en, es), add(mk('dd', null, null, null, { 'data-h': key }), valueNode));

/** Edges leaving this ref that mean "something used or quoted it": runs that took it as an input, documents that cite it.
 *  Wave 7 PR3 (H6): the record's own `cited_by` (built on the server from item_cites, across projects) comes first when the route gives it. */
function citedBy(ref, ctx, rec) {
  const own = rec && Array.isArray(rec.cited_by) ? rec.cited_by.map((c) => (typeof c === 'string' ? c : c && (c.ref || (c.id ? 'doc:' + c.id : null)))).filter(Boolean) : [];
  const edges = (ctx.lineage && ctx.lineage.edges) || [];
  const fromLineage = edges.filter((e) => e.from === ref && (e.type === 'cites' || e.type === 'input')).map((e) => e.to);
  return [...new Set([...own, ...fromLineage])];
}
/** Titles the server sends beside its cited_by refs, so a record outside the loaded project still reads as its title. */
function citedTitles(rec) {
  const m = new Map();
  for (const c of (rec && Array.isArray(rec.cited_by)) ? rec.cited_by : []) if (c && typeof c === 'object' && (c.ref || c.id) && c.title) m.set(c.ref || 'doc:' + c.id, c.title);
  return m;
}

/** Wave 7 PR3: a run's staleness and age flags sit under facets.vault (the Tier A record forbids them top level); an item keeps them top level. */
const vaultFacet = (rec) => (rec && rec.facets && rec.facets.vault && typeof rec.facets.vault === 'object' ? rec.facets.vault : null);
const recStale = (rec) => { const v = vaultFacet(rec); return v ? !!v.stale : !!(rec && rec.stale); };
const recStaleReasons = (rec) => { const v = vaultFacet(rec); return v ? v.stale_reasons : rec && rec.stale_reasons; };
const recAgeFlags = (rec) => { const v = vaultFacet(rec); const f = v && Array.isArray(v.age_flags) ? v.age_flags : rec && Array.isArray(rec.age_flags) ? rec.age_flags : []; return f.filter(Boolean); };
function staleBadge(entry, node, rec) {
  const stale = (entry && entry.stale) || (node && node.stale) || recStale(rec);
  if (!stale) return null;
  const why = firstReason((entry && entry.stale_reasons) || recStaleReasons(rec));
  const s = mk('span', null, null, null, { 'data-m': 'stale' });
  add(s, mk('span', 'hub-stale', 'Stale', 'Obsoleta', { title: why || '' }), why ? dv('span', 'hub-muted', ' ' + why) : null);
  return s;
}
/** A table in a scrolling wrapper (the shared .hub-table-wrap), so a wide one never widens the panel. */
const wrapTable = (t) => add(mk('div', 'hub-table-wrap'), t);

/** Idea D: a figure in tabular Barlow Condensed with its unit in small caps after it. */
export const figure = (value, unit) => {
  const f = mk('span', 'hub-figure');
  add(f, dv('span', 'hub-num', typeof value === 'number' ? num(value) : value));
  if (unit) add(f, document.createTextNode(' '), dv('span', 'hub-unit', unit));
  return f;
};
/** The label for an output or assumption key: the dictionary, else the key in words with its unit suffix dropped. */
export function keyLabel(k, unit) {
  const d = OUTPUT_LABEL[k];
  if (d) return { en: d[0], es: d[1] };
  let s = String(k).replace(/_/g, ' ');
  if (unit) { const u = String(unit).toLowerCase(); if (s.toLowerCase().endsWith(' ' + u)) s = s.slice(0, -(u.length + 1)); }
  s = cap(s.replace(/\bnpv(\d+)\b/i, 'NPV$1').replace(/\birr\b/i, 'IRR').replace(/\bbhp\b/i, 'BHP'));
  return { en: s, es: s };
}
const unitOf = (k, o) => (o && o.unit) || IMPLIED_UNIT[String(k).split('_').pop()] || '';

const DRAFT_KIND = { email: ['Email draft', 'Borrador de correo'], letter: ['Letter draft', 'Borrador de carta'], 'report-section': ['Report section draft', 'Borrador de sección de informe'], 'calc-note': ['Calc note draft', 'Borrador de nota de cálculo'] };
const DECISION_WORD = { keep: ['kept', 'mantenido'], 'keep-note': ['kept with a note', 'mantenido con nota'], drop: ['dropped', 'quitado'] };
const QUESTION_RE = /^\[QUESTION FOR YOU: ?(.*)\]$/s;
const CITE_RE = /\[((?:run|doc|lesson|ref|wm):[^\]]+)\]/g;

/* ── the meta line, the actions row, the Technical disclosure ─────────── */

/** One line under the title: parts joined by " · ", each a span with data-m. */
function metaLine(parts) {
  const p = mk('p', 'hub-rp-meta', null, null, { 'data-part': 'meta', 'data-meta': '' });
  let first = true;
  for (const part of parts) {
    if (!part) continue;
    if (!first) add(p, mk('span', 'hub-rp-meta-sep', ' · ', ' · ', { 'aria-hidden': 'true' }));
    add(p, part); first = false;
  }
  return p;
}

/** Cite: copies [doc:<id>] or [run:<id>] to the clipboard and says so on the button for a moment. */
function citeButton(ref) {
  const b = mk('button', 'btn btn-outline btn-sm', 'Cite', 'Citar', { type: 'button', 'data-action': 'cite', title: '[' + ref + ']' });
  b.addEventListener('click', async () => {
    const text = '[' + ref + ']';
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { ok = false; }
    if (!ok) {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e) { ok = false; }
    }
    b.textContent = ''; b.removeAttribute('data-en'); b.removeAttribute('data-es');
    add(b, ok ? mk('span', null, 'Copied ' + text, 'Copiado ' + text) : mk('span', null, 'Could not copy: ' + text, 'No se pudo copiar: ' + text));
    b.setAttribute('data-copied', ok ? '1' : '0');
    setTimeout(() => { b.textContent = ''; add(b, mk('span', null, 'Cite', 'Citar')); b.removeAttribute('data-copied'); }, 2500);
  });
  return b;
}

/** The closed Technical disclosure: the file facts, the index state and the raw record. */
function technical(rec, rows) {
  const det = mk('details', 'hub-rp-details hub-rp-technical', null, null, { 'data-part': 'technical', 'data-technical': '' });
  add(det, mk('summary', null, 'Technical', 'Técnico'));
  const dl = mk('dl', 'hub-kv hub-rp-orig');
  for (const [en, es, node] of rows) if (node) add(dl, mk('dt', null, en, es), add(mk('dd'), node));
  add(det, dl);
  add(det, dv('pre', 'hub-json', JSON.stringify(rec, null, 2).replace(/</g, '\\u003c'), { 'data-json': '' }));
  return det;
}

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

/* ── field dossiers and papers (wave 7, S20, S26) ────────────────────── */

const DOSSIER_SKIP = new Set(['kind', 'asset_id', 'source', 'source_url', 'summary', 'manifest', 'ingest', 'attribution', 'chunks', 'text_chars', 'pages', 'format', 'text', 'text_anchors']);
const FACT_LABEL = {
  asset_name: ['Field', 'Campo'], owners: ['Owners', 'Titulares'], operator: ['Operator', 'Operador'], status: ['Status', 'Estado'], lat: ['Latitude', 'Latitud'], lon: ['Longitude', 'Longitud'],
  country: ['Country', 'País'], basin: ['Basin', 'Cuenca'], label: ['Name', 'Nombre'], admin1: ['Region', 'Región'], feature_code: ['Feature', 'Tipo'], id: ['Record id', 'Id del registro'],
  discovered: ['Discovered', 'Descubierto'], production_start: ['Production start', 'Inicio de producción'], fuel: ['Fuel', 'Hidrocarburo'],
};
const SOURCE_NAME = { gem: 'Global Energy Monitor', wikidata: 'Wikidata', geonames: 'GeoNames', vault: 'Vault' };
const factText = (v) => (Array.isArray(v) ? v.map(factText).join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => k + ' ' + factText(x)).join(' · ') : String(v));

/** The GEM, Wikidata or GeoNames facts that justified attaching the field, as a key-value card with the source and its attribution. */
function dossierView(rec) {
  const ex = rec.extracted || {};
  const host = mk('div', 'hub-rp-dossier', null, null, { 'data-dossier': ex.asset_id || '' });
  if (ex.summary) add(host, dv('p', null, ex.summary));
  const dl = mk('dl', 'hub-kv');
  const keys = ['asset_name', ...Object.keys(ex).filter((k) => k !== 'asset_name' && !DOSSIER_SKIP.has(k) && ex[k] !== null && ex[k] !== undefined && ex[k] !== '')];
  for (const k of keys) {
    if (ex[k] === null || ex[k] === undefined || ex[k] === '') continue;
    const lab = FACT_LABEL[k] || [k.replace(/_/g, ' '), k.replace(/_/g, ' ')];
    add(dl, mk('dt', null, lab[0], lab[1]), dv('dd', null, factText(ex[k]), { 'data-fact': k }));
  }
  add(host, dl);
  const src = mk('p', 'hub-muted hub-note-s', null, null, { 'data-dossier-source': ex.source || '' });
  add(src, mk('span', null, 'Source: ', 'Fuente: '), ex.source_url ? dv('a', 'hub-inline-link', SOURCE_NAME[ex.source] || ex.source || 'source', { href: ex.source_url, target: '_blank', rel: 'noopener noreferrer' }) : dv('span', null, SOURCE_NAME[ex.source] || ex.source || '—'));
  if (ex.attribution) add(src, dv('span', null, ' · ' + ex.attribution));
  add(host, src);
  return host;
}

/** Authors, year, DOI and the abstract: from extracted (the ingest now carries abstract, doi and authors on the item) or, for an older
 *  paper, from the stored bibliographic record (metadata and abstract only, never full text). No Download: the original is the metadata. */
async function paperView(rec) {
  const host = mk('div', 'hub-rp-paper', null, null, { 'data-paper': rec.id });
  const ex0 = rec.extracted || {};
  let meta = typeof ex0.abstract === 'string' && ex0.abstract.trim() ? { abstract: ex0.abstract, doi: ex0.doi, authors: ex0.authors, authored_at: ex0.authored_at || ex0.year } : null;
  if (!meta && rec.storage_key) {
    try {
      const res = await fetch('/api/items/' + encodeURIComponent(rec.id) + '/original', { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (res.ok && /json/.test(res.headers.get('content-type') || '')) meta = await res.json();
    } catch (e) { meta = null; }
  }
  const authors = (meta && Array.isArray(meta.authors) && meta.authors.length ? meta.authors : rec.authors) || [];
  const when = (meta && meta.authored_at) || rec.authored_at;
  const year = when ? String(when).slice(0, 4) : '';
  const doi = (rec.extracted && rec.extracted.doi) || (meta && meta.doi) || '';
  const line = mk('p', 'hub-note-s', null, null, { 'data-paper-meta': '' });
  if (authors.length) add(line, dv('span', null, authors.join(', ')));
  if (year) add(line, document.createTextNode(authors.length ? ' · ' : ''), dv('span', null, year));
  if (doi) add(line, document.createTextNode(' · '), dv('a', 'hub-inline-link mono', 'doi:' + doi, { href: 'https://doi.org/' + doi, target: '_blank', rel: 'noopener noreferrer' }));
  else if (rec.origin && rec.origin.url) add(line, document.createTextNode(' · '), dv('a', 'hub-inline-link', rec.origin.source || 'source', { href: rec.origin.url, target: '_blank', rel: 'noopener noreferrer' }));
  add(host, line);
  const abstract = meta && typeof meta.abstract === 'string' && meta.abstract.trim() ? meta.abstract.trim() : (meta && typeof meta.text === 'string' && meta.text.trim() ? meta.text.trim() : '');
  if (abstract) add(host, dv('p', 'hub-rp-abstract', abstract, { 'data-paper-abstract': '' }));
  else add(host, mk('p', 'hub-muted', 'No abstract was stored for this paper.', 'No se guardó resumen de este artículo.', { 'data-paper-abstract': '' }));
  return host;
}

/* ── the extracted text (wave 7, R5, W7-AC8) ─────────────────────────── */

const TEXT_TYPES = new Set(['email', 'letter', 'note', 'text', 'contract', 'nda', 'proposal', 'report', 'invoice']);
const TEXT_FORMATS = new Set(['txt', 'eml', 'csv', 'md', 'docx', 'doc', 'html', 'rtf', 'odt']);
/** Whether the record is shown as its extracted text: mail, letters, text, DOCX and CSV, and anything indexed that is not a PDF, an image or a workbook. */
function isTextRecord(rec, type) {
  const ex = rec.extracted || {};
  const vk = viewerKind(rec);
  if (vk === 'pdf' || vk === 'image') return false;
  const fmt = MIME_SHORT[rec.mime] || ex.format || '';
  if (vk === 'sheet' && fmt !== 'csv') return false;
  if (TEXT_FORMATS.has(fmt)) return true;
  if (TEXT_TYPES.has(type)) return true;
  return Number(ex.chunks || 0) > 0;
}
const indexed = (rec) => { const ex = rec.extracted || {}; return Number(ex.chunks || 0) > 0 || (ex.ingest && (ex.ingest.status === 'ok' || ex.ingest.status === 'skipped')); };

/** The term from Find (every word of two letters or more) or the cited passage, as one regular expression, or null. */
function highlightRegex(ctx) {
  const q = (ctx.highlight || '').trim();
  if (q) {
    const phrase = esc(q).replace(/\s+/g, '\\s+');
    const words = q.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => w.length >= 2).map(esc);
    return new RegExp('(' + [phrase, ...words].join('|') + ')', 'giu');
  }
  const p = (ctx.passage || '').trim();
  if (p) return new RegExp('(' + esc(p.length > 80 ? p.slice(0, 80) : p).replace(/\s+/g, '\\s+') + ')', 'iu');
  return null;
}

/** Paragraphs from the text, matches wrapped in <mark>; the first mark is the anchor the panel scrolls to. */
function textView(rec, text, ctx) {
  const host = mk('div', 'hub-rp-text', null, null, { 'data-text': '', 'data-chars': String(text.length) });
  const re = highlightRegex(ctx);
  let anchored = false;
  const paras = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/).map((s) => s.trim()).filter(Boolean);
  for (const para of paras) {
    const p = mk('p');
    const lines = para.split('\n');
    lines.forEach((line, i) => {
      if (i) add(p, document.createElement('br'));
      if (!re) { add(p, document.createTextNode(line)); return; }
      let last = 0;
      for (const m of line.matchAll(re)) {
        if (!m[0]) continue;
        if (m.index > last) add(p, document.createTextNode(line.slice(last, m.index)));
        const mark = dv('mark', 'hub-hl', m[0]);
        if (!anchored) { mark.setAttribute('data-anchor', ''); anchored = true; }
        add(p, mark);
        last = m.index + m[0].length;
      }
      if (last < line.length) add(p, document.createTextNode(line.slice(last)));
    });
    add(host, p);
  }
  if (!paras.length) add(host, mk('p', 'hub-muted', 'No text was extracted from this record.', 'No se extrajo texto de este registro.'));
  return host;
}

/* ── documents ───────────────────────────────────────────────────────── */

async function renderDoc({ ref, rec, node, entry, ctx }) {
  const frag = document.createDocumentFragment();
  const src = rec || {};
  const type = src.type || (node && node.type) || (entry && entry.type) || '';
  const ex = src.extracted || {};
  const dk = ex.kind === 'draft' ? (DRAFT_KIND[ex.draft_kind] || DRAFT_KIND.email) : null;
  const tl = dk || (ex.kind === 'dossier' ? ['Field dossier', 'Dosier del campo'] : null) || TYPE_LABEL[type];

  // One meta line: type · vN · date · legal tag (· stale).
  const version = src.version || (entry && entry.version) || 1;
  const when = src.created_at || (entry && entry.at);
  const d = when ? fmtShortDate(when) : null;
  const typeNode = tl ? mk('span', 'hub-rp-type', tl[0], tl[1], { 'data-m': 'type', 'data-h': 'type' }) : dv('span', 'hub-rp-type', cap(type) || 'Document', { 'data-m': 'type', 'data-h': 'type' });
  const parts = [typeNode, dv('span', null, 'v' + version, { 'data-m': 'version' }), d ? mk('span', null, d.en, d.es, { 'data-m': 'date' }) : null,
    dv('span', 'hub-lt', src.legal_tag || (entry && entry.legal_tag), { 'data-m': 'tag' }), staleBadge(entry, node, rec)];
  if (src.reference_no) parts.push(dv('span', 'mono', src.reference_no, { 'data-m': 'reference_no' }));
  add(frag, metaLine(parts));

  if (!rec) return frag;   // nothing more is known without the record

  // The content. A draft written in the Hub is its paragraphs with the review as saved; a field dossier its facts; a paper its
  // abstract; a PDF, an image or a workbook opens in the viewer; mail, letters, text, DOCX and CSV show their extracted text.
  const view = mk('div', 'hub-rp-view', null, null, { 'data-part': 'view', 'data-view': '' });
  const isPaper = type === 'paper' || type === 'research' || ex.kind === 'paper' || ex.kind === 'research';
  const noOriginal = ex.ingest && ex.ingest.status === 'no_original';
  const hasOriginal = !!rec.storage_key && !noOriginal;
  let mode = 'none';
  if (ex.kind === 'draft' && Array.isArray(ex.paragraphs)) { mode = 'draft'; add(view, draftView(rec, ctx)); }
  else if (ex.kind === 'dossier') { mode = 'dossier'; add(view, dossierView(rec)); }
  else if (isPaper) { mode = 'paper'; add(view, await paperView(rec)); }
  else if (hasOriginal && !isTextRecord(rec, type)) { mode = 'viewer'; add(view, buildViewer(rec, { download: false })); }
  else if (indexed(rec) && isTextRecord(rec, type)) {
    mode = 'text';
    const r = await api('/api/items/' + encodeURIComponent(rec.id) + '?text=1');
    const text = r.ok && r.body && r.body.extracted && typeof r.body.extracted.text === 'string' ? r.body.extracted.text : null;
    if (text === null) add(view, mk('p', 'hub-muted', 'The text could not be loaded' + (r.status ? ' (HTTP ' + r.status + ')' : '') + '.', 'No se pudo cargar el texto' + (r.status ? ' (HTTP ' + r.status + ')' : '') + '.', { 'data-text-error': '' }));
    else add(view, textView(rec, text, ctx));
  } else if (hasOriginal) { mode = 'download'; add(view, mk('p', 'hub-muted', 'Not indexed yet, so there is no text to show: open or download the original.', 'Aún no está indexado, así que no hay texto que mostrar: abra o descargue el original.')); }
  else add(view, mk('p', 'hub-muted', rec.storage_key ? 'Original missing: upload it again.' : 'Filed without an original.', rec.storage_key ? 'Falta el original: súbalo de nuevo.' : 'Registrado sin original.'));
  view.setAttribute('data-mode', mode);
  add(frag, view);

  // Actions: Open original, Download, Write a reply, Cite.
  const actions = mk('div', 'hub-rp-actions hub-actions-row', null, null, { 'data-part': 'actions', 'data-actions': '' });
  if (hasOriginal && mode !== 'paper') {
    add(actions, mk('a', 'btn btn-outline btn-sm', 'Open original', 'Abrir el original', { href: originalUrl(rec.id), target: '_blank', rel: 'noopener', 'data-action': 'open' }));
    add(actions, mk('a', 'btn btn-outline btn-sm', 'Download', 'Descargar', { href: originalUrl(rec.id, { download: true }), download: '', 'data-action': 'download' }));
  }
  if ((type === 'email' || type === 'letter') && typeof ctx.openReply === 'function' && mode !== 'draft') {
    const b = mk('button', 'btn btn-outline btn-sm', 'Write a reply', 'Escribir una respuesta', { type: 'button', 'data-action': 'reply' });
    b.addEventListener('click', () => ctx.openReply(rec, b));
    add(actions, b);
  }
  add(actions, citeButton('doc:' + rec.id));
  add(frag, actions);

  // Related: versions, cites, used by.
  const rel = mk('div', 'hub-rp-related', null, null, { 'data-part': 'related' });
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
  const by = citedBy(ref, ctx, rec);
  if (by.length) add(rel, listCard('cited-by', 'Used by', 'Usado por', by, ctx, citedTitles(rec)));
  add(frag, rel);

  // Technical, last: format, hash, storage key, the index state (with Index now when the cron has not reached it), ingested, the JSON.
  const fmt = MIME_SHORT[rec.mime] || (rec.storage_key && /\.([a-z0-9]{2,5})$/i.exec(rec.storage_key) || [])[1] || (ex.format || '');
  let idx;
  if (ex.ingest && (ex.ingest.status === 'ok' || ex.ingest.status === 'skipped')) {
    const bits = [plural(Number(ex.chunks || 0), 'chunk', 'chunks')], bitsEs = [plural(Number(ex.chunks || 0), 'fragmento', 'fragmentos')];
    if (ex.pages) { bits.push(plural(ex.pages, 'page', 'pages')); bitsEs.push(plural(ex.pages, 'página', 'páginas')); }
    if (ex.text_chars) { bits.push(num(ex.text_chars) + ' characters'); bitsEs.push(num(ex.text_chars) + ' caracteres'); }
    idx = mk('span', null, bits.join(' · '), bitsEs.join(' · '), { 'data-h': 'indexed' });
  } else if (ex.ingest && INGEST_WORD[ex.ingest.status]) idx = mk('span', null, INGEST_WORD[ex.ingest.status][0], INGEST_WORD[ex.ingest.status][1], { 'data-h': 'indexed' });
  else {
    idx = mk('span', null, null, null, { 'data-h': 'indexed' });
    add(idx, mk('span', 'hub-muted', 'not indexed yet', 'aún no indexado'));
    // Wave 7 (S27): a record filed by a tool or the API waits for the ingest cron; offer to index it now.
    const b = mk('button', 'btn btn-outline btn-sm hub-index-now', 'Index now', 'Indexar ahora', { type: 'button', 'data-index-now': rec.id });
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await api('/api/ingest/reindex/' + encodeURIComponent(rec.id), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
      idx.textContent = '';
      if (r.ok) add(idx, mk('span', null, 'indexing now; Find reaches it in a minute', 'indexando ahora; Buscar lo alcanza en un minuto'));
      else { add(idx, mk('span', 'hub-muted', 'could not index', 'no se pudo indexar'), document.createTextNode(' '), dv('span', 'hub-muted', (r.body && r.body.error && r.body.error.message) || (r.status ? 'HTTP ' + r.status : ''))); }
    });
    add(idx, document.createTextNode(' '), b);
  }
  const source = rec.origin && rec.origin.source;
  add(frag, technical(rec, [
    ['Format', 'Formato', fmt ? dv('span', null, fmt) : null],
    ['Hash', 'Hash', rec.content_hash ? dv('span', 'mono', hashShort(rec.content_hash), { title: rec.content_hash }) : null],
    ['Stored at', 'Guardado en', rec.storage_key ? dv('span', 'mono', rec.storage_key) : null],
    ['Indexed', 'Indexado', idx],
    ['Ingested', 'Ingresado', d ? add(mk('span'), mk('span', null, d.en, d.es), source ? dv('span', 'hub-muted', ' · ' + source) : null) : null],
    ['Reference no.', 'N.º de referencia', rec.reference_no ? dv('span', 'mono', rec.reference_no) : null],
  ]));
  return frag;
}

/* ── runs ────────────────────────────────────────────────────────────── */

/** Output keys in the manifest's produces[] order first, then the rest as the run lists them. */
function orderedKeys(outputs, tool) {
  const keys = Object.keys(outputs || {}).filter((k) => k !== 'method');
  const order = (tool && Array.isArray(tool.produces) ? tool.produces : []).map((p) => (typeof p === 'string' ? p : p && p.key));
  return [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
}
const labelFor = (k, unit, tool) => {
  const p = tool && Array.isArray(tool.produces) ? tool.produces.find((x) => x && typeof x === 'object' && x.key === k) : null;
  if (p && p.label) return { en: p.label, es: p.label_es || p.label };
  return keyLabel(k, unit);
};
const fmtDelta = (delta, pct) => {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const n = num(Math.abs(delta));
  return sign + n + (typeof pct === 'number' && isFinite(pct) ? ' (' + (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.round(Math.abs(pct)) + '%)' : '');
};

function renderRun({ ref, rec, node, entry, ctx }) {
  const frag = document.createDocumentFragment();
  const src = rec || {};
  const job = src.job || (node && node.job) || (entry && entry.job);
  const ver = src.tool_version || (entry && entry.tool_version);
  const tools = (ctx.catalog && ctx.catalog.tools) || [];
  const tool = tools.find((t) => t.id === job) || null;
  let status = src.status || (node && node.status) || (entry && entry.status);
  const st = RUN_STATUS[status] || [status, status, 'muted'];
  const when = src.created_at || (entry && entry.at);
  const d = when ? fmtShortDate(when) : null;
  const statusPill = status ? mk('span', 'hub-pill ' + st[2], st[0], st[1], { 'data-status': status, 'data-m': 'status' }) : null;
  add(frag, metaLine([
    statusPill,
    job ? dv('a', 'hub-inline-link', (tool ? tool.name : job) + (ver ? ' ' + ver : ''), { href: '/hub/tool.html?id=' + encodeURIComponent(job), 'data-m': 'tool' }) : null,
    d ? mk('span', null, d.en, d.es, { 'data-m': 'date' }) : null,
    dv('span', 'hub-lt', src.legal_tag || (entry && entry.legal_tag), { 'data-m': 'tag' }),
    staleBadge(entry, node, rec),
  ]));
  if (!rec) return frag;

  // The content: outputs, assumptions, inputs.
  const view = mk('div', 'hub-rp-view', null, null, { 'data-part': 'view', 'data-view': '', 'data-mode': 'run' });
  const outputs = rec.outputs || {};
  const keys = orderedKeys(outputs, tool);
  const numeric = keys.filter((k) => outputs[k] && typeof outputs[k].value === 'number');
  const words = keys.filter((k) => outputs[k] && typeof outputs[k].value !== 'number' && outputs[k].value != null);
  add(view, mk('h4', null, 'Outputs', 'Resultados'));
  // Wave 7 PR3 (H4): every number carries unit · as-of · source: the as-of column holds the run's date and the status pill the figure wears elsewhere.
  const asOfCell = () => { const td = mk('td', 'hub-rp-asof', null, null, { 'data-asof': when ? String(when).slice(0, 10) : '' }); if (d) add(td, mk('span', null, d.en, d.es)); if (status) add(td, document.createTextNode(' '), mk('span', 'hub-pill ' + st[2] + ' hub-src-chip', st[0], st[1], { 'data-status': status })); return td; };
  if (numeric.length) {
    const t = mk('table', 'hub-table hub-rp-table', null, null, { 'data-outputs': '' });
    add(t, add(mk('thead'), add(mk('tr'), mk('th', null, 'Output', 'Resultado'), mk('th', 'num', 'Value', 'Valor'), mk('th', null, 'As of · source', 'Fecha · fuente'))));
    const tb = mk('tbody');
    for (const k of numeric) {
      const o = outputs[k], unit = unitOf(k, o), lab = labelFor(k, unit, tool);
      add(tb, add(mk('tr', null, null, null, { 'data-output': k }), mk('th', null, lab.en, lab.es, { scope: 'row' }), add(mk('td', 'num'), figure(o.value, unit)), asOfCell()));
    }
    add(t, tb); add(view, wrapTable(t));
  } else add(view, mk('p', 'hub-muted', 'No numeric outputs on this run.', 'Sin resultados numéricos en esta ejecución.'));
  // Wave 7 PR3 (G1 to G7): advisory age flags from facets.vault, a quiet line each, never the stale badge.
  const flags = recAgeFlags(rec);
  if (flags.length) {
    const ul = mk('ul', 'hub-age-flags hub-note-s', null, null, { 'data-age-flags': String(flags.length) });
    for (const fl of flags) {
      const text = typeof fl === 'string' ? fl : fl.detail || fl.text || fl.rule || JSON.stringify(fl);
      const li = mk('li', null, null, null, { 'data-age-rule': typeof fl === 'object' && fl.rule ? fl.rule : '' });
      add(li, mk('span', 'hub-muted', 'Age: ', 'Antigüedad: '), dv('span', null, text));
      if (typeof fl === 'object' && fl.ref && /^(run|doc):/.test(String(fl.ref))) { const b = dv('button', 'hub-linkbtn hub-rp-pivot', labelOf(fl.ref, ctx), { type: 'button', 'data-pivot': fl.ref }); b.addEventListener('click', () => ctx.open(fl.ref, labelOf(fl.ref, ctx), b)); add(li, document.createTextNode(' '), b); }
      add(ul, li);
    }
    add(view, ul);
  }
  if (outputs.method && outputs.method.value != null) add(view, add(mk('p', 'hub-note-s', null, null, { 'data-outputs-method': '' }), mk('span', null, 'Method: ', 'Método: '), dv('span', null, String(outputs.method.value))));
  for (const k of words) { const lab = labelFor(k, '', tool); add(view, add(mk('p', 'hub-note-s', null, null, { 'data-output': k }), mk('span', null, lab.en + ': ', lab.es + ': '), dv('span', null, String(outputs[k].value)))); }
  const cmpHost = mk('div', null, null, null, { 'data-compare-host': '' });
  add(view, cmpHost);

  const assumptions = Object.entries(rec.assumptions || {}).filter(([, a]) => a && typeof a === 'object');
  if (assumptions.length) {
    add(view, mk('h4', null, 'Assumptions', 'Supuestos'));
    const t = mk('table', 'hub-table hub-rp-table', null, null, { 'data-assumptions': '' });
    add(t, add(mk('thead'), add(mk('tr'), mk('th', null, 'Assumption', 'Supuesto'), mk('th', 'num', 'Value', 'Valor'), mk('th', null, 'Source', 'Fuente'))));
    const tb = mk('tbody');
    const seen = new Set();
    for (const [k, a] of assumptions) {
      const prov = a.provenance || (a.source ? 'document' : 'assumed');
      seen.add(prov);
      const unit = a.unit || '', lab = labelFor(k, unit, null);
      const th = mk('th', null, null, null, { scope: 'row' });
      add(th, mk('span', 'hub-prov', null, null, { 'data-provenance': prov, role: 'img', title: (PROVENANCE[prov] || [prov])[0], 'aria-label': (PROVENANCE[prov] || [prov])[0] }), mk('span', null, lab.en, lab.es));
      const val = typeof a.value === 'number' ? figure(a.value, unit) : dv('span', null, a.value == null ? '—' : String(a.value));
      const srcCell = mk('td', 'hub-rp-src');
      if (a.source && /^(run|doc):/.test(String(a.source))) { const b = dv('button', 'hub-linkbtn hub-rp-pivot', labelOf(a.source, ctx), { type: 'button', 'data-pivot': a.source }); b.addEventListener('click', () => ctx.open(a.source, labelOf(a.source, ctx), b)); add(srcCell, b); }
      else if (a.source) add(srcCell, dv('span', 'mono', String(a.source).replace(/^ref:/, '')));
      else add(srcCell, mk('span', 'hub-muted', 'unsourced', 'sin fuente'));
      add(tb, add(mk('tr', null, null, null, { 'data-assumption': k }), th, add(mk('td', 'num'), val), srcCell));
    }
    add(t, tb); add(view, wrapTable(t));
    const legend = mk('p', 'hub-note-s hub-prov-legend', null, null, { 'data-legend': '' });
    for (const p of seen) { const w = PROVENANCE[p] || [p, p]; add(legend, add(mk('span', 'hub-prov-key'), mk('span', 'hub-prov', null, null, { 'data-provenance': p, 'aria-hidden': 'true' }), mk('span', null, w[0], w[1]))); }
    add(view, legend);
  }

  const inputs = Array.isArray(rec.inputs) ? rec.inputs : [];
  add(view, mk('h4', null, 'Inputs', 'Entradas'));
  const iul = mk('ul', 'hub-rp-list', null, null, { 'data-inputs': '' });
  if (inputs.length) for (const i of inputs) add(iul, refItem(i.ref, ctx, i.role ? dv('span', 'hub-muted', '· ' + i.role) : null));
  else add(iul, mk('li', 'hub-muted', 'None declared', 'Ninguna declarada'));
  add(view, iul);
  add(frag, view);

  // Actions: Open in tool, Re-run (POST /api/runs/:id/rerun), Compare with previous, Cite.
  const actions = mk('div', 'hub-rp-actions hub-actions-row', null, null, { 'data-part': 'actions', 'data-actions': '' });
  const pid = rec.project_id || (ctx.project && ctx.project.id);
  if (tool && tool.entry && tool.hub && ctx.siteRoot) {
    const byId = new Map(tools.map((t) => [t.id, t]));
    const target = openTarget(tool, byId, ctx.siteRoot);
    const u = new URL(target.href);
    if (!target.external) { u.searchParams.set(tool.hub.param || 'project', pid); u.searchParams.set('run', rec.id); }
    const a = mk('a', 'btn btn-outline btn-sm', 'Open in tool', 'Abrir en herramienta', { href: u.href, 'data-action': 'open-tool' });
    if (target.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    add(actions, armOnOpen(a));
  }
  const rerun = mk('button', 'btn btn-outline btn-sm', 'Re-run', 'Volver a ejecutar', { type: 'button', 'data-action': 'rerun' });
  const rstate = mk('span', 'hub-rerun-state', null, null, { 'data-rerun-state': '', role: 'status' });
  rerun.addEventListener('click', async () => {
    rerun.disabled = true; rstate.textContent = ''; add(rstate, mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, 'Running…', 'Ejecutando…'));
    const r = await api('/api/runs/' + encodeURIComponent(rec.id) + '/rerun', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(120000) });
    rstate.textContent = '';
    if (r.ok && r.body && r.body.id) {
      const changes = typeof r.body.changes === 'number' ? r.body.changes : (Array.isArray(r.body.changes) ? r.body.changes.length : 0);
      add(rstate, mk('a', 'btn btn-primary btn-sm', changes ? 'Open the new run (' + changes + ' changed)' : 'Open the new run', changes ? 'Abrir la nueva ejecución (' + changes + ' cambios)' : 'Abrir la nueva ejecución', { href: '/hub/project.html?id=' + encodeURIComponent(pid) + '&run=' + encodeURIComponent(r.body.id), 'data-rerun-done': r.body.id }));
      return;
    }
    rerun.disabled = false;
    const msg = (r.body && r.body.error && r.body.error.message) || '';
    if (r.status === 503) add(rstate, mk('span', 'hub-bad', 'Re-run is not available on this server yet' + (msg ? ': ' + msg : '.'), 'La re-ejecución aún no está disponible en este servidor' + (msg ? ': ' + msg : '.'), { 'data-rerun-reason': '' }));
    else add(rstate, mk('span', 'hub-bad', 'Not re-run' + (msg ? ': ' + msg : r.status ? ' (HTTP ' + r.status + ')' : ' (the Vault is unreachable)') + '.', 'No se volvió a ejecutar' + (msg ? ': ' + msg : r.status ? ' (HTTP ' + r.status + ')' : ' (el Vault no es accesible)') + '.', { 'data-rerun-reason': '' }));
  });
  add(actions, rerun);
  const sup = rec.supersedes || (entry && entry.supersedes);
  if (sup) {
    const cmp = mk('button', 'btn btn-outline btn-sm', 'Compare with previous', 'Comparar con la anterior', { type: 'button', 'data-action': 'compare', 'aria-expanded': 'false' });
    cmp.addEventListener('click', async () => {
      if (cmpHost.firstChild) { cmpHost.textContent = ''; cmp.setAttribute('aria-expanded', 'false'); return; }
      cmp.disabled = true;
      const r = await api('/api/runs/' + encodeURIComponent(sup));
      cmp.disabled = false;
      if (!r.ok || !r.body) { add(cmpHost, mk('p', 'hub-bad', 'The previous run could not be loaded.', 'No se pudo cargar la ejecución anterior.', { 'data-compare-error': '' })); return; }
      const prev = r.body, po = prev.outputs || {};
      const t = mk('table', 'hub-table hub-rp-table hub-rp-compare', null, null, { 'data-compare': prev.id });
      const pd = prev.created_at ? fmtShortDate(prev.created_at) : null;
      add(t, add(mk('thead'), add(mk('tr'), mk('th', null, 'Output', 'Resultado'), mk('th', 'num', 'Previous' + (pd ? ' · ' + pd.en : ''), 'Anterior' + (pd ? ' · ' + pd.es : '')), mk('th', 'num', 'This run', 'Esta ejecución'), mk('th', 'num', 'Change', 'Cambio'))));
      const tb = mk('tbody');
      const all = orderedKeys({ ...po, ...outputs }, tool).filter((k) => (outputs[k] && typeof outputs[k].value === 'number') || (po[k] && typeof po[k].value === 'number'));
      for (const k of all) {
        const a = po[k], b = outputs[k], unit = unitOf(k, b || a), lab = labelFor(k, unit, tool);
        const tr = mk('tr', null, null, null, { 'data-output': k });
        add(tr, mk('th', null, lab.en, lab.es, { scope: 'row' }));
        add(tr, add(mk('td', 'num'), a && typeof a.value === 'number' ? figure(a.value, unit) : dv('span', 'hub-muted', '—')));
        add(tr, add(mk('td', 'num'), b && typeof b.value === 'number' ? figure(b.value, unit) : dv('span', 'hub-muted', '—')));
        const dc = mk('td', 'num');
        if (a && b && typeof a.value === 'number' && typeof b.value === 'number') {
          const delta = Math.round((b.value - a.value) * 1e6) / 1e6, pct = a.value !== 0 ? (delta / Math.abs(a.value)) * 100 : null;
          add(dc, dv('span', 'hub-num ' + (delta > 0 ? 'up' : delta < 0 ? 'dn' : 'flat'), fmtDelta(delta, pct), { 'data-delta': delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' }));
        } else add(dc, dv('span', 'hub-muted', '—', { 'data-delta': 'none' }));
        add(tr, dc); add(tb, tr);
      }
      add(t, tb);
      cmpHost.textContent = '';
      add(cmpHost, mk('h4', null, 'Against the run it supersedes', 'Frente a la ejecución que reemplaza'), wrapTable(t));
      cmp.setAttribute('aria-expanded', 'true');
    });
    add(actions, cmp);
  }
  add(actions, citeButton('run:' + rec.id), rstate);
  // Wave 7 PR3 (H6, W7-AC11): Mark reviewed (members and partners) and Mark final (partners) through POST /api/runs/:id/status.
  // The record JSON is untouched; the row's status moves, the pill follows, and the page re-fetches its headline numbers.
  const role = ctx.person && ctx.person.role;
  const mayReview = !!role && (role === 'partner' || ctx.canWrite) && (status === 'draft' || status === 'reviewed' || !status);
  if (mayReview && status !== 'final' && status !== 'superseded') {
    const sstate = mk('span', 'hub-rerun-state', null, null, { 'data-status-state': '', role: 'status' });
    const mark = (next, btn) => async () => {
      btn.disabled = true; sstate.textContent = '';
      const r = await api('/api/runs/' + encodeURIComponent(rec.id) + '/status', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ status: next }) });
      if (r.ok) {
        status = (r.body && r.body.status) || next;
        const ns = RUN_STATUS[status] || [status, status, 'muted'];
        if (statusPill) { statusPill.className = 'hub-pill ' + ns[2]; statusPill.setAttribute('data-status', status); statusPill.setAttribute('data-en', ns[0]); statusPill.setAttribute('data-es', ns[1]); statusPill.textContent = document.documentElement.getAttribute('lang') === 'es' ? ns[1] : ns[0]; }
        for (const c of view.querySelectorAll('.hub-rp-asof .hub-pill')) { c.className = 'hub-pill ' + ns[2] + ' hub-src-chip'; c.setAttribute('data-status', status); c.setAttribute('data-en', ns[0]); c.setAttribute('data-es', ns[1]); c.textContent = document.documentElement.getAttribute('lang') === 'es' ? ns[1] : ns[0]; }
        add(sstate, mk('span', 'hub-ok', next === 'final' ? 'Marked final: it now counts in the headline numbers.' : 'Marked reviewed.', next === 'final' ? 'Marcada final: ya cuenta en las cifras principales.' : 'Marcada revisada.', { 'data-status-done': status }));
        if (next === 'reviewed' && reviewBtn) reviewBtn.setAttribute('hidden', '');
        if (next === 'final') { if (reviewBtn) reviewBtn.setAttribute('hidden', ''); if (finalBtn) finalBtn.setAttribute('hidden', ''); }
        if (typeof ctx.onRunStatus === 'function') ctx.onRunStatus(rec.id, status);
        return;
      }
      btn.disabled = false;
      const msg = (r.body && r.body.error && r.body.error.message) || '';
      const code = (r.body && r.body.error && r.body.error.code) || '';
      const en = r.status === 403 ? 'Not allowed: ' + (next === 'final' ? 'only a partner marks a run final.' : 'only a member of the project or a partner reviews a run.')
        : r.status === 409 && code === 'superseded' ? 'This run is superseded: the newer run is the one to review.'
        : r.status === 409 ? 'Not changed: ' + (msg || 'the run moved on; reopen it to see its status.')
        : r.status === 404 || r.status === 501 ? 'This Vault does not record run status yet.'
        : 'Not changed' + (msg ? ': ' + msg : r.status ? ' (HTTP ' + r.status + ')' : ' (the Vault is unreachable)') + '.';
      const es = r.status === 403 ? 'No permitido: ' + (next === 'final' ? 'solo un socio marca una ejecución como final.' : 'solo un miembro del proyecto o un socio revisa una ejecución.')
        : r.status === 409 && code === 'superseded' ? 'Esta ejecución está reemplazada: la más nueva es la que se revisa.'
        : r.status === 409 ? 'Sin cambios: ' + (msg || 'la ejecución cambió; vuelva a abrirla para ver su estado.')
        : r.status === 404 || r.status === 501 ? 'Este Vault aún no registra el estado de las ejecuciones.'
        : 'Sin cambios' + (msg ? ': ' + msg : r.status ? ' (HTTP ' + r.status + ')' : ' (el Vault no es accesible)') + '.';
      add(sstate, mk('span', 'hub-bad', en, es, { 'data-status-reason': String(r.status), 'data-status-code': code }));
    };
    let reviewBtn = null, finalBtn = null;
    if (status !== 'reviewed') { reviewBtn = mk('button', 'btn btn-outline btn-sm', 'Mark reviewed', 'Marcar revisada', { type: 'button', 'data-action': 'mark-reviewed' }); reviewBtn.addEventListener('click', mark('reviewed', reviewBtn)); add(actions, reviewBtn); }
    if (role === 'partner') { finalBtn = mk('button', 'btn btn-primary btn-sm', 'Mark final', 'Marcar final', { type: 'button', 'data-action': 'mark-final' }); finalBtn.addEventListener('click', mark('final', finalBtn)); add(actions, finalBtn); }
    add(actions, sstate);
  }
  add(frag, actions);

  // Related: supersession and who quotes it.
  const rel = mk('div', 'hub-rp-related', null, null, { 'data-part': 'related' });
  const by = entry && entry.superseded_by;
  if (sup || by) {
    const sul = mk('ul', 'hub-rp-list');
    if (sup) add(sul, refItem('run:' + sup, ctx, mk('span', 'hub-muted', '· superseded by this run', '· reemplazada por esta ejecución')));
    if (by) add(sul, refItem('run:' + by, ctx, mk('span', 'hub-muted', '· supersedes this run', '· reemplaza esta ejecución')));
    add(rel, card('supersedes', 'Supersession', 'Reemplazo', sul));
  }
  const cb = citedBy(ref, ctx, rec);
  if (cb.length) add(rel, listCard('cited-by', 'Cited by', 'Citada por', cb, ctx, citedTitles(rec)));
  const pname = ctx.project && ctx.project.id === pid ? ctx.project.name : pid;
  if (!ctx.project || ctx.project.id !== pid) add(rel, card('project', 'Project', 'Proyecto', dv('a', 'hub-inline-link', pname, { href: '/hub/project.html?id=' + encodeURIComponent(pid) })));
  if (rel.childNodes.length) add(frag, rel);

  add(frag, technical(rec, [
    ['Tool', 'Herramienta', job ? dv('span', 'mono', job + (ver ? '@' + ver : '')) : null],
    ['Commit', 'Commit', rec.tool_commit ? dv('span', 'mono', rec.tool_commit) : null],
    ['Input hash', 'Hash de entradas', rec.input_hash ? dv('span', 'mono', hashShort(rec.input_hash), { title: rec.input_hash }) : null],
    ['Author', 'Autor', rec.author ? dv('span', null, rec.author) : null],
  ]));
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

/** Builds the panel body for a record. Returns a fragment: the meta line, the content, the actions, the related cards and the Technical disclosure. */
export async function renderRecord(args) {
  if (args.kind === 'doc') return renderDoc(args);
  if (args.kind === 'run') return renderRun(args);
  return renderRef(args);
}

/** The closed Details disclosure holding a raw record (escaped so it is safe as a data value); used when no record could be loaded. */
export function detailsNode(summary) {
  const det = mk('details', 'hub-rp-details');
  add(det, mk('summary', null, 'Technical', 'Técnico'));
  add(det, dv('pre', 'hub-json', JSON.stringify(summary, null, 2).replace(/</g, '\\u003c'), { 'data-json': '' }));
  return det;
}

export { short };
