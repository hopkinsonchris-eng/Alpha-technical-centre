/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB: the project's folders (wave 9)
   docs/vault-hub/wave9/01-project-folders.md, W9-AC11.

   renderFolderTree(host, data, opts)
     host  the card (#files-folders); emptied and filled with a find box, a status
           line and the numbered skeleton
     data  GET /api/projects/:id/folders: {folders, files, runs, unsorted, partner}
     opts  { onOpen(file, trigger), onOpenRun(run, trigger),
             move(fileId, folder) → Promise<boolean>, accept(queueId) → Promise<boolean>,
             waive(folder, expect, waived) → Promise<boolean> }

   Every project has the same twelve folders; Subsurface carries a folder per
   attached field, reservoir and well, APEX apps one per app with its runs.
   A row says how the record got there: a rule, the AI with its confidence, or
   the person who filed it. Unsorted rows carry the AI's suggestion and its
   quote. Each folder heading lists what it expects (PSC, JOA, well logs…) with
   a tick or a gap; a partner may mark a gap not applicable. Every string
   carries data-en and data-es.
   ============================================================ */
import { mk, add, setText, fmtShortDate } from '../hub.js';
import { kindOf, fmtSize } from '../../js/vault-files.js';

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const ICON = {
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>'),
  run: svg('<path d="M4 19h16"/><path d="M6 16l4-5 3 3 5-7"/>'),
};
const PAGE = 50;
const RUN_WORD = { draft: ['Draft', 'Borrador'], reviewed: ['Reviewed', 'Revisada'], final: ['Final', 'Final'], superseded: ['Superseded', 'Reemplazada'] };

/** Every folder a record may be moved to, with its label path ("05 Subsurface › Wells › A-1"); not Unsorted, not the app folders. */
export function moveTargets(folders) {
  const out = [];
  const walk = (ns, en, es) => {
    for (const f of ns) {
      const le = en + (f.n ? f.n + ' ' : '') + f.en, ls = es + (f.n ? f.n + ' ' : '') + f.es;
      if (f.key !== 'unsorted' && f.key !== 'apex' && !f.key.startsWith('apex/')) out.push({ key: f.key, en: le, es: ls });
      walk(f.children || [], le + ' › ', ls + ' › ');
    }
  };
  walk(folders || [], '', '');
  return out;
}

/** The badge on a row: "Rule", "AI 92%", "Filed by Ana". */
export function filingBadge(filing) {
  if (!filing) return null;
  if (filing.method === 'manual') {
    const who = filing.filed_by || '';
    return mk('span', 'hub-pill info hub-fd-badge', 'Filed by ' + who, 'Archivado por ' + who, { 'data-filing': 'manual', title: filing.reason || '' });
  }
  if (filing.method === 'model') {
    const pc = filing.confidence == null ? '' : ' ' + Math.round(filing.confidence * 100) + '%';
    return mk('span', 'hub-pill hub-fd-badge', 'AI' + pc, 'IA' + pc, { 'data-filing': 'model', title: [filing.reason, filing.quote ? '“' + filing.quote + '”' : ''].filter(Boolean).join(' — ') });
  }
  return mk('span', 'hub-pill muted hub-fd-badge', 'Rule', 'Regla', { 'data-filing': 'rule', title: filing.reason || '' });
}

export function renderFolderTree(host, data, opts = {}) {
  const files = Array.isArray(data && data.files) ? data.files : [];
  const runs = Array.isArray(data && data.runs) ? data.runs : [];
  const folders = Array.isArray(data && data.folders) ? data.folders : [];
  const targets = moveTargets(folders);
  const labelOf = new Map(targets.map((t) => [t.key, t]));
  const state = { term: '', opened: new Set() };
  host.textContent = '';
  host.classList.add('hub-files', 'hub-folders');

  const head = mk('div', 'hub-ft-head');
  const find = mk('label', 'hub-find hub-ft-find');
  const input = mk('input', null, null, null, { type: 'search', id: 'folders-find', autocomplete: 'off', 'data-en-ph': 'Find a file', 'data-es-ph': 'Buscar un archivo', placeholder: document.documentElement.lang === 'es' ? 'Buscar un archivo' : 'Find a file', 'aria-label': 'Find a file' });
  add(find, input);
  const status = mk('span', 'hub-muted hub-ft-status', null, null, { id: 'folders-status', role: 'status' });
  add(head, find, status);
  const treeHost = mk('div', 'hub-ft-tree');
  add(host, head);
  // Records the sorter has not looked at yet are not a to-do list: say so, and how long it takes.
  const pending = files.filter((f) => !f.filing).length;
  if (pending) {
    const n = pending.toLocaleString('en-GB'), ne = pending.toLocaleString('es-ES');
    add(host, mk('p', 'hub-fd-pending', 'Sorting in progress: ' + n + (pending === 1 ? ' file has' : ' files have') + ' not been looked at yet. They file themselves every 15 minutes; there is nothing for you to do. Your WorkDrive folders are unchanged under Source folders.',
      'Clasificación en curso: ' + ne + (pending === 1 ? ' archivo aún no se ha revisado' : ' archivos aún no se han revisado') + '. Se archivan solos cada 15 minutos; no tiene que hacer nada. Sus carpetas de WorkDrive siguen intactas en Carpetas de origen.', { 'data-pending': String(pending), role: 'status' }));
  }
  add(host, treeHost);

  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.term = input.value; paint(); }, 120); });

  const byFolder = new Map();
  for (const f of files) { if (!byFolder.has(f.folder)) byFolder.set(f.folder, []); byFolder.get(f.folder).push(f); }
  const runsBy = new Map();
  for (const r of runs) { if (!r.current) continue; if (!runsBy.has(r.folder)) runsBy.set(r.folder, []); runsBy.get(r.folder).push(r); }
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  for (const list of byFolder.values()) list.sort((a, b) => collator.compare(a.name || '', b.name || ''));

  function paint() {
    const t = state.term.trim().toLowerCase();
    const hit = (f) => !t || String(f.name || '').toLowerCase().includes(t) || String(f.title || '').toLowerCase().includes(t);
    const shown = files.filter(hit).length;
    const waiting = files.filter((f) => f.suggestion).length;
    const en = [t ? shown + ' of ' + files.length + ' files' : files.length + (files.length === 1 ? ' file' : ' files')];
    const es = [t ? shown + ' de ' + files.length + ' archivos' : files.length + (files.length === 1 ? ' archivo' : ' archivos')];
    if (data.unsorted) { en.push(data.unsorted + ' unsorted'); es.push(data.unsorted + ' sin clasificar'); }
    if (waiting) { en.push(waiting + ' with a suggestion for you'); es.push(waiting + ' con una sugerencia para usted'); }
    setText(status, en.join(' · '), es.join(' · '));
    treeHost.textContent = '';
    for (const f of folders) { const n = folderNode(f, 0, hit, !!t); if (n) add(treeHost, n); }
  }

  function folderNode(f, depth, hit, narrowed) {
    const own = (byFolder.get(f.key) || []).filter(hit);
    const ownRuns = narrowed ? [] : runsBy.get(f.key) || [];
    const kids = (f.children || []).map((c) => folderNode(c, depth + 1, hit, narrowed)).filter(Boolean);
    if (narrowed && !own.length && !kids.length) return null;
    const det = mk('details', 'hub-ft-folder hub-fd-folder', null, null, { 'data-folder-key': f.key, 'data-count': String(f.count || 0), 'data-depth': String(depth) });
    if (f.partners_only) det.setAttribute('data-partners-only', '');
    if (narrowed || state.opened.has(f.key)) det.open = true;
    det.addEventListener('toggle', () => { if (det.open) state.opened.add(f.key); else state.opened.delete(f.key); });
    const sum = mk('summary');
    sum.insertAdjacentHTML('afterbegin', ICON.folder);
    add(sum, mk('span', 'hub-ft-name', (f.n ? f.n + ' ' : '') + f.en, (f.n ? f.n + ' ' : '') + f.es));
    if (f.partners_only) { const l = mk('span', 'hub-fd-lock', null, null, { title: 'Partners only' }); l.insertAdjacentHTML('afterbegin', ICON.lock); add(l, mk('span', 'sr-only', 'Partners only', 'Solo socios')); add(sum, l); }
    const gaps = (f.expects || []).filter((e) => !e.met && !e.waived).length;
    if (gaps) add(sum, mk('span', 'hub-pill warn hub-fd-gaps', gaps + (gaps === 1 ? ' missing' : ' missing'), gaps + (gaps === 1 ? ' falta' : ' faltan'), { 'data-gaps': String(gaps) }));
    add(sum, mk('span', 'n', String(f.count || 0), String(f.count || 0)));
    add(det, sum);
    const body = mk('div', 'hub-ft-body');
    // 13 Oct 2026: a folder's rows are built the first time it opens, and a page at a time, so a project of thousands
    // of files never puts thousands of rows (and their controls) into the page at once.
    let built = false;
    const build = () => {
      if (built) return; built = true;
      if ((f.expects || []).length) add(body, checklist(f));
      for (const k of kids) add(body, k);
      for (const r of ownRuns) add(body, runRow(r));
      let shown = 0;
      const more = mk('button', 'hub-linkbtn hub-fd-more', null, null, { type: 'button', 'data-more': f.key });
      const page = () => {
        const next = own.slice(shown, shown + PAGE);
        for (const x of next) body.insertBefore(fileRow(x), more);
        shown += next.length;
        const left = own.length - shown;
        if (left > 0) setText(more, 'Show ' + Math.min(PAGE, left) + ' more (' + left.toLocaleString('en-GB') + ' left)', 'Mostrar ' + Math.min(PAGE, left) + ' más (quedan ' + left.toLocaleString('es-ES') + ')');
        else more.remove();
      };
      more.addEventListener('click', page);
      add(body, more);
      page();
      if (!kids.length && !ownRuns.length && !own.length && !(f.expects || []).length) add(body, mk('div', 'hub-muted hub-fd-empty', 'Nothing here yet.', 'Nada aquí todavía.'));
    };
    if (det.open) build();
    det.addEventListener('toggle', () => { if (det.open) build(); });
    add(det, body);
    return det;
  }

  function checklist(f) {
    const box = mk('div', 'hub-fd-check', null, null, { 'data-checklist': f.key });
    add(box, mk('span', 'hub-muted', 'Expected: ', 'Esperado: '));
    for (const e of f.expects) {
      const state = e.met ? 'met' : e.waived ? 'waived' : 'missing';
      const chip = mk('span', 'hub-fd-expect ' + state, null, null, { 'data-expect': e.kind, 'data-state': state });
      add(chip, mk('span', null, e.en, e.es), mk('span', 'hub-fd-mark', e.met ? ' ✓' : e.waived ? ' — not applicable' : ' ✗', e.met ? ' ✓' : e.waived ? ' — no aplica' : ' ✗'));
      if (data.partner && !e.met && opts.waive) {
        const b = mk('button', 'hub-linkbtn', e.waived ? 'Needed after all' : 'Not applicable', e.waived ? 'Sí hace falta' : 'No aplica', { type: 'button', 'data-waive': e.kind });
        b.addEventListener('click', async () => { b.disabled = true; await opts.waive(f.key, e.kind, !e.waived); });
        add(chip, document.createTextNode(' '), b);
      }
      add(box, chip);
    }
    return box;
  }

  function runRow(r) {
    const btn = mk('button', 'hub-ft-file hub-fd-run', null, null, { type: 'button', 'data-run-id': r.id });
    btn.insertAdjacentHTML('afterbegin', ICON.run);
    const main = mk('span', 'hub-ft-main');
    add(main, mk('span', 'hub-ft-name', r.title || r.job, r.title || r.job));
    const meta = mk('span', 'hub-ft-meta');
    const w = RUN_WORD[r.status]; if (w) add(meta, mk('span', 'hub-pill muted', w[0], w[1]));
    if (r.created_at) { const d = fmtShortDate(r.created_at); add(meta, mk('span', null, d.en, d.es)); }
    add(main, meta); add(btn, main);
    btn.addEventListener('click', () => opts.onOpenRun && opts.onOpenRun(r, btn));
    return btn;
  }

  function fileRow(f) {
    const row = mk('div', 'hub-fd-row', null, null, { 'data-file-id': f.id, 'data-folder': f.folder });
    const btn = mk('button', 'hub-ft-file', null, null, { type: 'button', 'data-kind': kindOf(f) });
    btn.insertAdjacentHTML('afterbegin', ICON.doc);
    const main = mk('span', 'hub-ft-main');
    add(main, mk('span', 'hub-ft-name', f.name || f.title || f.id, f.name || f.title || f.id));
    const meta = mk('span', 'hub-ft-meta');
    const badge = filingBadge(f.filing); if (badge) add(meta, badge);
    // The record's kind as the Vault names it ("Joint operating agreement"), else the raw kind in words.
    const k = f.filing && f.filing.doc_kind && f.filing.doc_kind !== 'other' ? f.filing : null;
    if (k) { const raw = k.doc_kind.replace(/-/g, ' '); add(meta, mk('span', 'hub-fd-kind', k.kind_en || raw, k.kind_es || raw)); }
    const when = f.authored_at || f.created_at;
    if (when) { const d = fmtShortDate(when); add(meta, mk('span', null, d.en, d.es)); }
    const size = fmtSize(f.size); if (size) add(meta, mk('span', null, size, size));
    add(main, meta); add(btn, main);
    btn.addEventListener('click', () => opts.onOpen && opts.onOpen(f, btn));
    add(row, btn);

    const tools = mk('div', 'hub-fd-tools');
    if (f.suggestion && opts.accept) {
      const t = labelOf.get(f.suggestion.folder);
      const pc = f.suggestion.confidence == null ? '' : ' (' + Math.round(f.suggestion.confidence * 100) + '%)';
      const sug = mk('span', 'hub-fd-suggest', null, null, { 'data-suggestion': f.suggestion.folder });
      add(sug, mk('span', null, 'AI suggests ', 'La IA sugiere '), mk('b', null, (t ? t.en : f.suggestion.folder) + pc, (t ? t.es : f.suggestion.folder) + pc));
      if (f.filing && f.filing.quote) add(sug, mk('span', 'hub-muted', ' — “' + f.filing.quote + '”', ' — “' + f.filing.quote + '”'));
      const ok = mk('button', 'btn btn-primary btn-sm', 'Accept', 'Aceptar', { type: 'button', 'data-accept': f.suggestion.queue_id });
      ok.addEventListener('click', async () => { ok.disabled = true; if (!(await opts.accept(f.suggestion.queue_id))) ok.disabled = false; });
      add(tools, sug, ok);
    }
    if (opts.move) {
      // The folder list is built only when asked for: one button per row, one dropdown on the row being moved.
      const btn = mk('button', 'hub-linkbtn', f.folder === 'unsorted' ? 'File in…' : 'Move to…', f.folder === 'unsorted' ? 'Archivar en…' : 'Mover a…', { type: 'button', 'data-move-open': f.id });
      btn.addEventListener('click', () => {
        const sel = mk('select', 'hub-fd-move', null, null, { 'data-move': f.id, 'aria-label': 'Move to' });
        add(sel, mk('option', null, 'Choose a folder…', 'Elegir carpeta…', { value: '' }));
        for (const t of targets) if (t.key !== f.folder) add(sel, mk('option', null, t.en, t.es, { value: t.key }));
        sel.addEventListener('change', async () => { if (!sel.value) return; sel.disabled = true; if (!(await opts.move(f.id, sel.value))) { sel.disabled = false; sel.value = ''; } });
        btn.replaceWith(sel);
        sel.focus();
      });
      add(tools, btn);
    }
    if (tools.childNodes.length) add(row, tools);
    return row;
  }

  paint();
  return { paint, state };
}
