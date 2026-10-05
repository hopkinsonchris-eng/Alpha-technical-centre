/* ============================================================
   Open the original (wave 5, docs/vault-hub/wave5/05-markup.md §1.2).
   buildViewer(rec) → an element for the record panel's View card:
     pdf    PDF.js on canvas, pages rendered lazily (iPad Safari cannot embed a PDF beyond page one)
     image  an <img> from the scope-checked route
     sheet  SheetJS → one table per sheet, 2,000 rows a sheet, sheet tabs
     other  a Download button; the extracted text stays in the panel
   The bytes come from /api/items/<id>/original with the Access cookie; nothing is cached.
   ============================================================ */
import { mk, dv, add, setText } from './hub.js';

const MAX_SHEET_ROWS = 2000;
const MAX_CANVAS_PIXELS = 4 * 1024 * 1024;        // iOS caps a canvas well below desktop sizes; stay far under it
const INLINE_LIMIT = 25 * 1024 * 1024;            // above this the viewer offers download only (the whole file is fetched at once)

const SHEET_MIMES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'];

/** 'pdf' | 'image' | 'sheet' | 'other', from the mime first and the extracted format second. */
export function viewerKind(rec) {
  const mime = (rec && rec.mime) || '';
  const fmt = (rec && rec.extracted && rec.extracted.format) || '';
  if (mime === 'application/pdf' || fmt === 'pdf') return 'pdf';
  if (/^image\//.test(mime)) return 'image';
  if (SHEET_MIMES.includes(mime) || ['xlsx', 'xls', 'csv'].includes(fmt)) return 'sheet';
  return 'other';
}

export const originalUrl = (id, opts = {}) => '/api/items/' + encodeURIComponent(id) + '/original' + (opts.download ? '?download=1' : '');

function downloadButton(rec) {
  const a = mk('a', 'btn btn-outline btn-sm hub-viewer-download', 'Download', 'Descargar', { href: originalUrl(rec.id, { download: true }), download: '' });
  return a;
}

/**
 * The viewer element. `opts.download` (default true) puts a Download button in the viewer's own bar; the record panel
 * (wave 7, R5) passes false because Download sits in its actions row under the content.
 */
export function buildViewer(rec, opts = {}) {
  const withDownload = opts.download !== false;
  const kind = viewerKind(rec);
  const host = mk('div', 'hub-viewer', null, null, { 'data-viewer': kind, 'data-state': 'loading' });
  const bar = mk('div', 'hub-viewer-bar');
  add(host, bar);
  const tooBig = Number(rec.extracted && rec.extracted.bytes) > INLINE_LIMIT;
  if (kind === 'other' || tooBig) {
    host.setAttribute('data-state', 'download');
    add(bar, mk('span', 'hub-muted', tooBig ? 'Too large to show here.' : 'Opens in its own app.', tooBig ? 'Demasiado grande para mostrar aquí.' : 'Se abre en su propia aplicación.'), withDownload ? downloadButton(rec) : null);
    return host;
  }
  if (kind === 'image') {
    if (withDownload) add(bar, downloadButton(rec));
    const img = mk('img', 'hub-viewer-img', null, null, { src: originalUrl(rec.id), alt: rec.title || '' });
    img.addEventListener('load', () => host.setAttribute('data-state', 'ready'));
    img.addEventListener('error', () => fail(host, bar));
    add(host, img);
    return host;
  }
  if (kind === 'sheet') { if (withDownload) add(bar, downloadButton(rec)); renderSheet(rec, host, bar).catch((e) => { console.error('viewer: sheet', e); fail(host, bar); }); return host; }
  renderPdf(rec, host, bar, withDownload).catch((e) => { console.error('viewer: pdf', e); fail(host, bar); });
  return host;
}

function fail(host, bar) {
  host.setAttribute('data-state', 'error');
  bar.textContent = '';
  add(bar, mk('span', 'hub-bad', 'The original could not be opened here.', 'El original no se pudo abrir aquí.'), downloadButton({ id: host.dataset.id || '' }));
}

async function fetchBytes(rec) {
  const res = await fetch(originalUrl(rec.id), { credentials: 'same-origin', headers: { accept: '*/*' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.arrayBuffer();
}

/* ── PDF ──────────────────────────────────────────────────────────── */
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('/hub/vendor/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = '/hub/vendor/pdf.worker.min.mjs'; return m; });
  return pdfjsPromise;
}

async function renderPdf(rec, host, bar, withDownload = true) {
  host.dataset.id = rec.id;
  const counter = mk('span', 'hub-viewer-pages', null, null, { 'data-page-counter': '' });
  const zoomOut = mk('button', 'btn btn-outline btn-sm', '−', '−', { type: 'button', 'aria-label': 'Zoom out', 'data-zoom': 'out' });
  const zoomIn = mk('button', 'btn btn-outline btn-sm', '+', '+', { type: 'button', 'aria-label': 'Zoom in', 'data-zoom': 'in' });
  add(bar, counter, zoomOut, zoomIn, withDownload ? downloadButton(rec) : null);
  const scroller = mk('div', 'hub-viewer-scroll', null, null, { tabindex: '0' });
  add(host, scroller);
  const [pdfjs, data] = await Promise.all([loadPdfjs(), fetchBytes(rec)]);
  const doc = await pdfjs.getDocument({ data }).promise;
  const n = doc.numPages;
  host.setAttribute('data-pages', String(n));
  setText(counter, 'Page 1 of ' + n, 'Página 1 de ' + n);
  let zoom = 1;
  const pages = [];
  const widthOf = () => Math.max(240, scroller.clientWidth - 2);
  for (let i = 1; i <= n; i++) {
    const holder = mk('div', 'hub-viewer-page', null, null, { 'data-page': String(i) });
    add(scroller, holder);
    pages.push({ holder, rendered: false, page: null });
  }
  async function draw(i) {
    const p = pages[i - 1];
    if (p.rendering) return;
    p.rendering = true;
    try {
      if (!p.page) p.page = await doc.getPage(i);
      const base = p.page.getViewport({ scale: 1 });
      const scale = (widthOf() / base.width) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let vp = p.page.getViewport({ scale: scale * dpr });
      if (vp.width * vp.height > MAX_CANVAS_PIXELS) { const k = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height)); vp = p.page.getViewport({ scale: scale * dpr * k }); }
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / dpr) + 'px'; canvas.style.height = Math.floor(vp.height / dpr) + 'px';
      await p.page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      p.holder.textContent = ''; add(p.holder, canvas); p.rendered = true;
    } finally { p.rendering = false; }
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { const i = Number(e.target.dataset.page); if (!pages[i - 1].rendered) draw(i); setText(counter, 'Page ' + i + ' of ' + n, 'Página ' + i + ' de ' + n); }
  }, { root: scroller, threshold: 0.3 });
  for (const p of pages) io.observe(p.holder);
  await draw(1);
  host.setAttribute('data-state', 'ready');
  const rezoom = async (z) => { zoom = Math.min(3, Math.max(0.5, z)); for (const p of pages) p.rendered = false; await draw(1); for (const p of pages.slice(1)) if (p.holder.getBoundingClientRect().top < scroller.getBoundingClientRect().bottom) draw(Number(p.holder.dataset.page)); };
  zoomOut.addEventListener('click', () => rezoom(zoom / 1.25));
  zoomIn.addEventListener('click', () => rezoom(zoom * 1.25));
}

/* ── spreadsheets ─────────────────────────────────────────────────── */
let xlsxPromise = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = '/hub/vendor/xlsx.full.min.js'; s.async = true;
    s.onload = () => resolve(window.XLSX); s.onerror = () => reject(new Error('xlsx failed to load'));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

async function renderSheet(rec, host, bar) {
  host.dataset.id = rec.id;
  const [XLSX, data] = await Promise.all([loadXlsx(), fetchBytes(rec)]);
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const tabs = mk('div', 'hub-viewer-tabs', null, null, { role: 'tablist' });
  const body = mk('div', 'hub-viewer-sheet');
  add(host, tabs, body);
  const show = (name) => {
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.sheet === name ? 'true' : 'false');
    body.textContent = '';
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    const shown = rows.slice(0, MAX_SHEET_ROWS + 1);
    const table = mk('table', 'hub-table hub-viewer-table', null, null, { 'data-sheet': name });
    const [head, ...rest] = shown;
    if (head) add(table, add(mk('thead'), add(mk('tr'), ...head.map((c) => dv('th', null, String(c))))));
    const tb = mk('tbody');
    for (const r of rest) add(tb, add(mk('tr'), ...(head || r).map((_, i) => dv('td', null, String(r[i] === undefined ? '' : r[i])))));
    add(table, tb);
    add(body, table);
    if (rows.length > MAX_SHEET_ROWS + 1) add(body, mk('p', 'hub-muted', 'First ' + MAX_SHEET_ROWS.toLocaleString() + ' of ' + (rows.length - 1).toLocaleString() + ' rows. Download for the rest.', 'Primeras ' + MAX_SHEET_ROWS.toLocaleString() + ' de ' + (rows.length - 1).toLocaleString() + ' filas. Descargue para el resto.'));
  };
  for (const name of wb.SheetNames) {
    const b = dv('button', 'hub-viewer-tab', name, { type: 'button', role: 'tab', 'data-sheet': name, 'aria-selected': 'false' });
    b.addEventListener('click', () => show(name));
    add(tabs, b);
  }
  show(wb.SheetNames[0]);
  host.setAttribute('data-state', 'ready');
}
