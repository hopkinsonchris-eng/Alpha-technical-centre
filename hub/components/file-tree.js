/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB: the project's files as a tree (wave 8 PR 2)
   docs/vault-hub/wave8/02-files-and-picker.md, W8-AC10.

   renderFileTree(host, files, { onOpen })
     host   the card (#files); emptied and filled with a find box, the kind
            chips, a status line and the tree
     files  the rows of GET /api/projects/:id/files
     onOpen (file, trigger) => void, on a row tap

   The tree itself comes from js/vault-files.js, the module the client
   library's picker uses too, so both show the same folders from the same
   list. Top-level folders start open, deeper ones closed; a find term or a
   kind chip narrows the list before the tree is built and opens every
   folder on the way. Every string carries data-en and data-es.
   ============================================================ */
import { mk, add, setText, fmtShortDate, fmtStamp } from '../hub.js';
import { buildTree, kindOf, matches, KINDS, GROUPS, fmtSize } from '../../js/vault-files.js';

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  pdf: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/>'),
  sheet: svg('<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 10h16M4 15h16M10 4v16"/>'),
  image: svg('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 16l5-5 4 4 3-3 4 4"/><circle cx="16" cy="9" r="1.5"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>'),
  other: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
};
const KIND_ORDER = ['pdf', 'sheet', 'image', 'mail', 'doc', 'other'];

export function renderFileTree(host, files, opts = {}) {
  const onOpen = opts.onOpen || (() => {});
  const all = Array.isArray(files) ? files : [];
  const state = { term: '', kinds: new Set(), opened: new Set() };
  host.textContent = '';
  host.classList.add('hub-files');

  // Head: the find box, the kind chips and the status line.
  const head = mk('div', 'hub-ft-head');
  const find = mk('label', 'hub-find hub-ft-find');
  const input = mk('input', null, null, null, { type: 'search', id: 'files-find', autocomplete: 'off', 'data-en-ph': 'Find a file', 'data-es-ph': 'Buscar un archivo', placeholder: document.documentElement.lang === 'es' ? 'Buscar un archivo' : 'Find a file', 'aria-label': 'Find a file' });
  add(find, input);
  const chips = mk('div', 'hub-chips hub-ft-kinds', null, null, { id: 'files-kinds', role: 'group', 'aria-label': 'Kind' });
  const present = new Set(all.map(kindOf));
  for (const k of KIND_ORDER) {
    if (!present.has(k)) continue;
    const b = mk('button', 'hub-chip', KINDS[k].en, KINDS[k].es, { type: 'button', 'data-kind': k, 'aria-pressed': 'false' });
    b.addEventListener('click', () => {
      if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k);
      b.setAttribute('aria-pressed', String(state.kinds.has(k)));
      paint();
    });
    add(chips, b);
  }
  const status = mk('span', 'hub-muted hub-ft-status', null, null, { id: 'files-status', role: 'status' });
  add(head, find, chips, status);
  const treeHost = mk('div', 'hub-ft-tree');
  add(host, head);
  if (opts.index) add(host, indexLine(opts.index, all));
  add(host, treeHost);

  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.term = input.value; paint(); }, 120); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(timer); state.term = input.value; paint(); } });

  function paint() {
    const narrowed = !!(state.term.trim() || state.kinds.size);
    const shown = narrowed ? all.filter((f) => matches(f, state.term, state.kinds)) : all;
    const tree = buildTree(shown);
    treeHost.textContent = '';
    if (narrowed) setText(status, shown.length + ' of ' + all.length + ' files', shown.length + ' de ' + all.length + ' archivos');
    else setText(status, all.length + (all.length === 1 ? ' file' : ' files'), all.length + (all.length === 1 ? ' archivo' : ' archivos'));
    if (!all.length) { add(treeHost, mk('div', 'hub-empty', 'No files on this project yet. Add documents, or map its WorkDrive folder.', 'Aún no hay archivos en este proyecto. Añada documentos o asigne su carpeta de WorkDrive.')); return; }
    if (!shown.length) { add(treeHost, mk('div', 'hub-empty', 'No file matches.', 'Ningún archivo coincide.')); return; }
    for (const d of tree.folders) add(treeHost, folderNode(d, 0, narrowed));
  }

  function folderNode(d, depth, narrowed) {
    const key = d.group ? 'group:' + d.group : d.path;
    const det = mk('details', 'hub-ft-folder', null, null, { 'data-folder-name': d.name, 'data-count': String(d.count), 'data-path': d.path, 'data-depth': String(depth) });
    if (d.group) det.setAttribute('data-group', d.group);
    if (narrowed || depth === 0 || state.opened.has(key)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.opened.add(key); else state.opened.delete(key); });
    const sum = mk('summary');
    sum.insertAdjacentHTML('afterbegin', ICON.folder);
    const name = d.group ? mk('span', 'hub-ft-name', GROUPS[d.group].en, GROUPS[d.group].es) : mk('span', 'hub-ft-name', d.name, d.name);
    add(sum, name, mk('span', 'n', String(d.count), String(d.count)));
    add(det, sum);
    const body = mk('div', 'hub-ft-body');
    for (const sub of d.folders) add(body, folderNode(sub, depth + 1, narrowed));
    for (const f of d.files) add(body, fileRow(f));
    add(det, body);
    return det;
  }

  function fileRow(f) {
    const kind = kindOf(f);
    const btn = mk('button', 'hub-ft-file', null, null, { type: 'button', 'data-file-id': f.id, 'data-kind': kind, 'data-version': String(f.version || 1) });
    btn.insertAdjacentHTML('afterbegin', ICON[kind] || ICON.other);
    const main = mk('span', 'hub-ft-main');
    add(main, mk('span', 'hub-ft-name', f.name || f.title || f.id, f.name || f.title || f.id));
    const meta = mk('span', 'hub-ft-meta');
    if (Number(f.version) > 1) add(meta, mk('span', 'hub-pill muted hub-ft-version', 'v' + f.version, 'v' + f.version));
    const when = f.authored_at || f.created_at;
    if (when) { const d = fmtShortDate(when); add(meta, mk('span', null, d.en, d.es)); }
    const size = fmtSize(f.size);
    if (size) add(meta, mk('span', null, size, size));
    // Wave 8 PR 3 (W8-AC16): where the file stands with the indexer; an indexed file says nothing more.
    const ix = f.index && typeof f.index === 'object' ? f.index : null;
    if (ix && ix.state) {
      btn.setAttribute('data-index-state', ix.state);
      const m = indexMark(ix);
      if (m) add(meta, m);
    }
    add(main, meta);
    add(btn, main);
    btn.addEventListener('click', () => onOpen(f, btn));
    return btn;
  }

  paint();
  return { paint, state };
}

/* ── Wave 8 PR 3 (W8-AC16): the indexing line and the per-row marks ───── */

export const ORDINAL = {
  en: (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); },
  es: (n) => n + '.º',
};
const WHEN = (iso) => { const d = fmtStamp(iso); return typeof d === 'object' && d ? d : { en: String(d || ''), es: String(d || '') }; };

/** The mark on a row: "waiting · 143rd", "no text", "needs OCR", "empty", "original missing"; nothing when indexed. */
export function indexMark(ix) {
  const words = {
    unsupported: ['no text', 'sin texto'], needs_ocr: ['needs OCR', 'necesita OCR'], empty: ['empty', 'vacío'], no_original: ['original missing', 'falta el original'],
  };
  if (ix.state === 'waiting') {
    const pos = Number(ix.queue_position);
    const en = 'waiting' + (pos ? ' · ' + ORDINAL.en(pos) : ''), es = 'en espera' + (pos ? ' · ' + ORDINAL.es(pos) : '');
    const el = mk('span', 'hub-ft-mark hub-ft-mark-waiting', en, es, { 'data-index-mark': 'waiting' });
    if (ix.expected_at) { const w = WHEN(ix.expected_at); el.title = 'Expected about ' + w.en; }
    return el;
  }
  if (words[ix.state]) return mk('span', 'hub-ft-mark', words[ix.state][0], words[ix.state][1], { 'data-index-mark': ix.state });
  return null;
}

/** "1,480 of 2,316 indexed · 610 waiting · 226 unsupported (TIFF, zip) · 3 need OCR · next run 14:30". */
export function indexLine(sum, files) {
  const total = (sum.indexed || 0) + (sum.waiting || 0) + (sum.unsupported || 0) + (sum.needs_ocr || 0) + (sum.empty || 0) + (sum.no_original || 0);
  const n = (v) => Number(v || 0).toLocaleString('en-GB');
  const line = mk('div', 'hub-ft-index hub-muted', null, null, { id: 'files-index', role: 'status', 'data-waiting': String(sum.waiting || 0), 'data-indexed': String(sum.indexed || 0) });
  const en = [n(sum.indexed) + ' of ' + n(total) + ' indexed'], es = [n(sum.indexed) + ' de ' + n(total) + ' indexados'];
  if (sum.waiting) { en.push(n(sum.waiting) + ' waiting'); es.push(n(sum.waiting) + ' en espera'); }
  if (sum.unsupported) {
    const exts = [...new Set((files || []).filter((f) => f.index && f.index.state === 'unsupported').map((f) => (/\.([A-Za-z0-9]+)$/.exec(f.name || '') || [])[1]).filter(Boolean).map((e) => e.toUpperCase()))].slice(0, 4);
    const kinds = exts.length ? ' (' + exts.join(', ') + ')' : '';
    en.push(n(sum.unsupported) + ' unsupported' + kinds); es.push(n(sum.unsupported) + ' sin soporte' + kinds);
  }
  if (sum.needs_ocr) { en.push(n(sum.needs_ocr) + (sum.needs_ocr === 1 ? ' needs OCR' : ' need OCR')); es.push(n(sum.needs_ocr) + (sum.needs_ocr === 1 ? ' necesita OCR' : ' necesitan OCR')); }
  if (sum.empty) { en.push(n(sum.empty) + ' empty'); es.push(n(sum.empty) + ' vacíos'); }
  if (sum.no_original) { en.push(n(sum.no_original) + ' without an original'); es.push(n(sum.no_original) + ' sin original'); }
  if (sum.waiting && sum.next_run_at) {
    const t = new Date(sum.next_run_at);
    const hm = isNaN(t) ? '' : t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    en.push('next run ' + hm + ' (' + n(sum.per_run) + ' per run)'); es.push('próxima pasada ' + hm + ' (' + n(sum.per_run) + ' por pasada)');
  }
  setText(line, en.join(' · '), es.join(' · '));
  return line;
}

