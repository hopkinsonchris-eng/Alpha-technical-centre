/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB: Ask this project (wave 8 PR 4)
   docs/vault-hub/wave8/03-indexing-and-ask.md, W8-AC18.

   mountAsk(ctx, { openRecord, openSheet })
     Adds the button to the project toolbar and a sheet with a question
     field. The question goes to POST /api/projects/:id/ask; the answer's
     citations become numbered chips that open the record panel; what the
     files do not answer is listed as questions; the sources the answer drew
     on are listed with how often each is cited. Every string carries
     data-en and data-es. The browser never calls the model provider.
   ============================================================ */
import { mk, add, setText, api, fmtShortDate } from '../hub.js';

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const CITE_RE = /\[((?:doc|run|lesson|ref):[^\]\s]+)\]/g;
const lang = () => (document.documentElement.getAttribute('lang') === 'es' ? 'es' : 'en');

export function mountAsk(ctx, opts = {}) {
  // The button sits on the tab strip beside Add documents (both act on the project's documents), so the actions
  // row above keeps Write to…, Research, Open in tool and … on one line (W7 R1).
  const host = document.getElementById('p-tabs-wrap');
  if (!host || !ctx || !ctx.project) return null;
  const openRecord = opts.openRecord || (() => {});
  const openSheet = opts.openSheet;

  const btn = mk('button', 'btn btn-outline btn-sm hub-ask-btn', null, null, { type: 'button', id: 'p-ask-btn', 'aria-haspopup': 'dialog', 'aria-controls': 'p-ask', 'aria-expanded': 'false' });
  btn.insertAdjacentHTML('afterbegin', svg('<path d="M4 5h16v11H9l-5 4z"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.8.6-.8 1.1v.3"/><circle cx="12" cy="14.6" r=".5"/>'));
  add(btn, mk('span', null, 'Ask this project', 'Preguntar al proyecto'));
  const addDocs = document.getElementById('p-add-docs');
  if (addDocs && addDocs.parentNode === host) host.insertBefore(btn, addDocs); else host.appendChild(btn);

  // The sheet.
  const scrim = mk('div', 'hub-scrim', null, null, { id: 'ask-scrim', hidden: '' });
  const sheet = mk('section', 'hub-sheet hub-ask', null, null, { id: 'p-ask', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'h-ask', hidden: '' });
  const head = mk('div', 'hub-sheet-head');
  add(head, add(mk('div'), mk('h3', null, 'Ask this project', 'Preguntar al proyecto', { id: 'h-ask' }),
    mk('span', 'hub-muted', 'Answered from this project\'s indexed files only. Every figure cites its file; what the files do not say becomes a question for you.', 'Respondido solo desde los archivos indexados de este proyecto. Cada cifra cita su archivo; lo que los archivos no dicen se convierte en una pregunta para usted.')));
  const closeBtn = mk('button', 'btn btn-outline btn-sm', 'Close', 'Cerrar', { type: 'button', id: 'ask-close' });
  add(head, closeBtn);
  const body = mk('div', 'hub-sheet-body');
  const form = mk('form', 'hub-ask-form', null, null, { id: 'ask-form' });
  const q = mk('textarea', 'hub-ask-q', null, null, { id: 'ask-q', rows: '3', 'data-en-ph': 'e.g. How successful have re-perforations been historically?', 'data-es-ph': 'p. ej. ¿Qué éxito han tenido las reperforaciones históricamente?', 'aria-label': 'Question' });
  q.placeholder = lang() === 'es' ? 'p. ej. ¿Qué éxito han tenido las reperforaciones históricamente?' : 'e.g. How successful have re-perforations been historically?';
  const row = mk('div', 'hub-ask-row');
  const go = mk('button', 'btn btn-primary btn-sm', null, null, { type: 'submit', id: 'ask-go' });
  add(go, mk('span', null, 'Ask', 'Preguntar'));
  const hint = mk('span', 'hub-muted hub-ask-hint', 'Ctrl+Enter asks', 'Ctrl+Intro pregunta');
  const status = mk('span', 'hub-ask-status', null, null, { id: 'ask-status', role: 'status', 'aria-live': 'polite' });
  add(row, go, hint, status);
  add(form, q, row);
  const result = mk('div', 'hub-ask-result', null, null, { id: 'ask-result', hidden: '' });
  const answer = mk('div', 'hub-ask-answer', null, null, { id: 'ask-answer' });
  const questions = mk('section', 'hub-ask-questions', null, null, { id: 'ask-questions', hidden: '' });
  add(questions, mk('h4', null, 'What the files do not answer', 'Lo que los archivos no responden'), mk('ul'));
  const sourcesWrap = mk('section', 'hub-ask-sources', null, null, { id: 'ask-sources-wrap', hidden: '' });
  add(sourcesWrap, mk('h4', null, 'Sources', 'Fuentes', { id: 'ask-sources-h' }), mk('ol', null, null, null, { id: 'ask-sources' }));
  const meta = mk('p', 'hub-muted hub-ask-meta', null, null, { id: 'ask-meta' });
  add(result, answer, questions, sourcesWrap, meta);
  add(body, form, result);
  add(sheet, head, body);
  add(document.body, scrim, sheet);

  let closeSheet = null;
  const open = () => {
    if (!sheet.hasAttribute('hidden')) return;
    if (typeof openSheet === 'function') closeSheet = openSheet(sheet, scrim, btn, () => { closeSheet = null; });
    else { sheet.removeAttribute('hidden'); scrim.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); closeSheet = () => { sheet.setAttribute('hidden', ''); scrim.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); closeSheet = null; }; }
    setTimeout(() => q.focus(), 30);
  };
  const close = () => { if (closeSheet) closeSheet(); };
  btn.addEventListener('click', () => (sheet.hasAttribute('hidden') ? open() : close()));
  closeBtn.addEventListener('click', close);
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); form.requestSubmit ? form.requestSubmit() : ask(); } });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); ask(); });

  let busy = false;
  async function ask() {
    const question = q.value.trim();
    if (!question || busy) return;
    busy = true; go.disabled = true;
    status.textContent = ''; status.removeAttribute('data-state');
    add(status, mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, 'Reading the files…', 'Leyendo los archivos…'));
    let r;
    try {
      r = await api('/api/projects/' + encodeURIComponent(ctx.project.id) + '/ask', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ question, language: lang() }), signal: AbortSignal.timeout(180000) });
    } catch (e) { r = { ok: false, status: 0, body: null }; }
    busy = false; go.disabled = false;
    status.textContent = '';
    if (!r.ok) {
      const code = r.body && r.body.error && r.body.error.code;
      const msg = r.body && r.body.error && r.body.error.message;
      status.setAttribute('data-state', 'error');
      if (r.status === 503 || code === 'not_configured') setText(status, 'The assistant is not connected. Ask Chris.', 'El asistente no está conectado. Pregunte a Chris.');
      else if (r.status === 0) setText(status, 'The Vault did not answer in time. Try again.', 'El Vault no respondió a tiempo. Inténtelo de nuevo.');
      else setText(status, msg || ('HTTP ' + r.status), msg || ('HTTP ' + r.status));
      return;
    }
    render(r.body);
  }

  function render(b) {
    result.removeAttribute('hidden');
    answer.textContent = '';
    const order = new Map();
    (b.sources || []).forEach((s, i) => order.set(s.ref, { n: i + 1, source: s }));
    const paragraphs = Array.isArray(b.answer) ? b.answer : [];
    if (!paragraphs.length) {
      add(answer, mk('p', 'hub-muted', 'No indexed passage in this project matches the question. The files may still be waiting for the indexer: the Files tab says how far it has got.', 'Ningún pasaje indexado de este proyecto coincide con la pregunta. Puede que los archivos aún esperen al indexador: la pestaña Archivos dice hasta dónde ha llegado.'));
    }
    for (const text of paragraphs) {
      const p = mk('p');
      let last = 0; const s = String(text);
      for (const m of s.matchAll(CITE_RE)) {
        if (m.index > last) p.appendChild(document.createTextNode(s.slice(last, m.index).replace(/\s+$/, '')));
        const ref = m[1]; const o = order.get(ref);
        const chip = mk('button', 'hub-cite', null, null, { type: 'button', 'data-cite': ref, title: o ? o.source.name : ref });
        chip.textContent = o ? String(o.n) : '•';
        chip.addEventListener('click', () => openRecord({ ref, title: o ? o.source.name : ref, trigger: chip }));
        p.appendChild(chip);
        last = m.index + m[0].length;
      }
      if (last < s.length) p.appendChild(document.createTextNode(s.slice(last)));
      add(answer, p);
    }
    const ql = questions.querySelector('ul'); ql.textContent = '';
    const qs = Array.isArray(b.questions) ? b.questions : [];
    if (qs.length) { questions.removeAttribute('hidden'); for (const t of qs) add(ql, mk('li', null, t, t)); } else questions.setAttribute('hidden', '');
    const ol = sourcesWrap.querySelector('#ask-sources'); ol.textContent = '';
    const srcs = Array.isArray(b.sources) ? b.sources : [];
    if (srcs.length) {
      sourcesWrap.removeAttribute('hidden');
      for (const sct of srcs) {
        const li = mk('li', null, null, null, { 'data-source-id': sct.id });
        const b2 = mk('button', 'hub-linkbtn hub-ask-source', null, null, { type: 'button', 'data-source': sct.ref });
        b2.textContent = sct.name || sct.id;
        b2.addEventListener('click', () => openRecord({ ref: sct.ref, title: sct.name, trigger: b2 }));
        const n = Number(sct.cited || 0);
        const en = n === 1 ? 'cited once' : n === 2 ? 'cited twice' : 'cited ' + n + ' times';
        const es = n === 1 ? 'citado 1 vez' : 'citado ' + n + ' veces';
        const d = sct.date ? fmtShortDate(sct.date) : null;
        add(li, b2, document.createTextNode(' '), mk('span', 'hub-muted', [sct.type, d ? d.en : null, en].filter(Boolean).join(' · '), [sct.type, d ? d.es : null, es].filter(Boolean).join(' · ')));
        add(ol, li);
      }
    } else sourcesWrap.setAttribute('hidden', '');
    const n = Number(b.passages || 0);
    setText(meta, n + (n === 1 ? ' passage' : ' passages') + ' read' + (b.model ? ' · ' + b.model : ''), n + (n === 1 ? ' pasaje leído' : ' pasajes leídos') + (b.model ? ' · ' + b.model : ''));
    sheet.scrollTop = 0;
  }

  return { open, close, ask };
}
