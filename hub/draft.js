/* ============================================================
   Write to… (wave 5, docs/vault-hub/wave5/05-markup.md §1.3, W5-D3).
   mountDraft(ctx, { openRecord }) → fills #p-draft and wires the toolbar button.
   The set-up strip picks the kind, the language and the recipient from the
   project's contacts and counterparties; the brief goes to POST /api/draft; the
   result shows what the draft does not know first, then the paragraphs with a
   chip per citation (opens the record with the passage), the uncited sentences
   amber, Keep / Keep with a note / Drop per paragraph, tone buttons, Save (the
   review), Render (DOCX on letterhead, PDF when the server can), Mark as sent.
   ============================================================ */
import { mk, dv, add, api, setText, fmtShortDate } from './hub.js';

const KINDS = [['email', 'Email', 'Correo'], ['letter', 'Letter', 'Carta'], ['report-section', 'Report section', 'Sección de informe'], ['calc-note', 'Calc note', 'Nota de cálculo']];
const TONES = [['shorter', 'Shorter', 'Más corto'], ['longer', 'Longer', 'Más largo'], ['formal', 'More formal', 'Más formal'], ['plain', 'Plainer', 'Más llano']];
const CP_WORD = { client: ['client', 'cliente'], holder: ['current owner', 'titular actual'], government: ['government', 'gobierno'], partner: ['JV partner', 'socio'] };
const QUESTION_RE = /^\[QUESTION FOR YOU: ?(.*)\]$/s;
const CITE_RE = /\[((?:run|doc|lesson|ref|wm):[^\]]+)\]/g;

function notice(kind, en, es) { return add(mk('div', 'hub-notice ' + kind, null, null, { role: 'status' }), mk('span', null, en, es)); }

export function mountDraft(ctx, { openRecord }) {
  const host = document.getElementById('p-draft'), toolbar = document.getElementById('p-toolbar');
  if (!host || !toolbar) return null;
  const state = { contacts: null, draft: null, decisions: [], notes: {}, citationsOpened: 0, startedAt: 0, sent: null, rendered: null };

  const btn = mk('button', 'btn btn-outline btn-sm hub-draft-btn', null, null, { type: 'button', id: 'p-draft-btn', 'aria-expanded': 'false', 'aria-controls': 'p-draft' });
  btn.insertAdjacentHTML('afterbegin', '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M12 6l4 4"/></svg>');
  add(btn, mk('span', null, 'Write to…', 'Escribir a…'));
  add(toolbar, btn);
  const toggle = (open) => { if (open) { host.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); if (!state.contacts) loadContacts(); brief.focus(); } else { host.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); } };
  btn.addEventListener('click', () => toggle(host.hasAttribute('hidden')));

  // ── the set-up strip ──
  host.textContent = '';
  const head = mk('div', 'hub-card-head');
  add(head, add(mk('div'), mk('h3', null, 'Write to…', 'Escribir a…'), mk('span', 'hub-muted', 'A draft from this project\'s file: every figure cites a record, what it does not know comes first.', 'Un borrador del expediente de este proyecto: cada cifra cita un registro; lo que no sabe va primero.')));
  const close = mk('button', 'btn btn-outline btn-sm', 'Close', 'Cerrar', { type: 'button' }); close.addEventListener('click', () => toggle(false)); add(head, close);
  add(host, head);
  const setup = mk('form', 'hub-draft-setup', null, null, { id: 'draft-setup', novalidate: '' });
  const grid = mk('div', 'hub-form-grid');
  const fld = (id, en, es, input, cls) => add(grid, add(mk('div', 'hub-field' + (cls ? ' ' + cls : '')), mk('label', null, en, es, { for: id }), input));
  const kind = mk('select', null, null, null, { id: 'dr-kind' }); for (const [v, en, es] of KINDS) add(kind, mk('option', null, en, es, { value: v }));
  const language = mk('select', null, null, null, { id: 'dr-lang' }); add(language, mk('option', null, 'English', 'Inglés', { value: 'en' }), mk('option', null, 'Spanish', 'Español', { value: 'es' }));
  const to = mk('select', null, null, null, { id: 'dr-to' }); add(to, mk('option', null, 'Loading contacts…', 'Cargando contactos…', { value: '' }));
  const brief = mk('textarea', null, null, null, { id: 'dr-brief', rows: '3', placeholder: 'What to say, in a sentence or two' });
  fld('dr-kind', 'Kind', 'Tipo', kind); fld('dr-lang', 'Language', 'Idioma', language); fld('dr-to', 'To', 'Para', to);
  fld('dr-brief', 'Brief', 'Encargo', brief, 'hub-opp-text');
  add(setup, grid);
  const scope = mk('div', null, null, null, { id: 'dr-scope' });
  const noContact = mk('div', null, null, null, { id: 'dr-nocontact' });
  const actions = mk('div', 'hub-actions');
  const go = mk('button', 'btn btn-primary btn-sm', 'Draft', 'Redactar', { type: 'submit', id: 'dr-go' });
  add(actions, go);
  add(setup, scope, noContact, actions);
  add(host, setup);
  const notices = mk('div', null, null, null, { id: 'dr-notices', role: 'status' });
  const result = mk('div', 'hub-draft-result', null, null, { id: 'dr-result', hidden: '' });
  add(host, notices, result);

  const contactOf = () => (state.contacts && state.contacts.contacts.find((c) => c.id === to.value)) || null;
  function scopeCheck() {
    scope.textContent = '';
    const c = contactOf();
    if (!c) return;
    const cp = c.organisation.counterparty;
    if (!cp) add(scope, notice('warn', c.organisation.name + ' is not the client, the current owner, a partner or the government of this project. Check before sending.', c.organisation.name + ' no es el cliente, el titular actual, un socio ni el gobierno de este proyecto. Compruébelo antes de enviar.'));
  }
  async function loadContacts() {
    const r = await api('/api/projects/' + encodeURIComponent(ctx.project.id) + '/contacts');
    to.textContent = '';
    if (!r.ok) { add(to, mk('option', null, 'Contacts could not be loaded', 'No se pudieron cargar los contactos', { value: '' })); return; }
    state.contacts = r.body;
    add(to, mk('option', null, 'Choose a recipient', 'Elija un destinatario', { value: '' }));
    const groups = new Map();
    for (const c of r.body.contacts) { const k = c.organisation.id; if (!groups.has(k)) groups.set(k, { org: c.organisation, list: [] }); groups.get(k).list.push(c); }
    for (const { org, list } of groups.values()) {
      const cp = org.counterparty ? CP_WORD[org.counterparty] : null;
      const og = mk('optgroup', null, null, null, { label: org.name + (cp ? ' · ' + cp[0] : '') });
      for (const c of list) {
        const last = c.last_contact ? fmtShortDate(c.last_contact) : null;
        // Wave 6 (P57): who at the firm last spoke to them, from the captured mail.
        const rel = c.relationship && c.relationship.last_contact_by ? ' · last spoke: ' + c.relationship.last_contact_by + (c.relationship.strongest_connection && c.relationship.strongest_connection !== c.relationship.last_contact_by ? ' · knows them best: ' + c.relationship.strongest_connection : '') : '';
        const relEs = c.relationship && c.relationship.last_contact_by ? ' · último en hablar: ' + c.relationship.last_contact_by + (c.relationship.strongest_connection && c.relationship.strongest_connection !== c.relationship.last_contact_by ? ' · quien mejor le conoce: ' + c.relationship.strongest_connection : '') : '';
        add(og, mk('option', null, c.name + (c.role ? ', ' + c.role : '') + (last ? ' · last contact ' + last.en : ' · no contact yet') + rel, c.name + (c.role ? ', ' + c.role : '') + (last ? ' · último contacto ' + last.es : ' · sin contacto aún') + relEs, { value: c.id, 'data-org': org.id, ...(c.relationship && c.relationship.last_contact_by ? { 'data-last-spoke': c.relationship.last_contact_by } : {}) }));
      }
      add(to, og);
    }
    // Counterparties with no contact in the Vault: named, with a one-line form to add the first contact.
    noContact.textContent = '';
    const missing = r.body.counterparties.filter((cp) => !r.body.contacts.some((c) => c.organisation.id === cp.organisation_id));
    for (const cp of missing) {
      const row = mk('div', 'hub-draft-missing', null, null, { 'data-counterparty': cp.kind });
      add(row, mk('span', null, cp.name + ' (' + CP_WORD[cp.kind][0] + '): no contact yet.', cp.name + ' (' + CP_WORD[cp.kind][1] + '): sin contacto aún.'));
      const addBtn = mk('button', 'btn btn-outline btn-sm', 'Add contact', 'Añadir contacto', { type: 'button' });
      addBtn.addEventListener('click', () => addContactForm(row, cp));
      add(row, addBtn);
      add(noContact, row);
    }
    scopeCheck();
  }
  function addContactForm(row, cp) {
    row.textContent = '';
    const name = mk('input', null, null, null, { type: 'text', placeholder: 'Name', 'aria-label': 'Name', 'data-f': 'name' });
    const role = mk('input', null, null, null, { type: 'text', placeholder: 'Role', 'aria-label': 'Role', 'data-f': 'role' });
    const email = mk('input', null, null, null, { type: 'email', placeholder: 'Email', 'aria-label': 'Email', 'data-f': 'email' });
    const save = mk('button', 'btn btn-primary btn-sm', 'Save contact', 'Guardar contacto', { type: 'button' });
    add(row, mk('b', null, cp.name), name, role, email, save);
    save.addEventListener('click', async () => {
      save.disabled = true;
      let orgId = cp.organisation_id;
      if (!orgId) {
        const kindOf = { holder: 'operator', government: 'regulator', partner: 'partner' }[cp.kind] || 'other';
        const slug = cp.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const o = await api('/api/organisations', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ id: slug, name: cp.name, kind: kindOf, country: ctx.project.country || null }) });
        if (!o.ok && !(o.status === 409 && o.body && o.body.error && o.body.error.matches)) { save.disabled = false; add(row, notice('bad', 'The organisation could not be created.', 'No se pudo crear la organización.')); return; }
        orgId = o.ok ? o.body.id : o.body.error.matches[0].id;
      }
      const c = await api('/api/contacts', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ organisation_id: orgId, name: name.value.trim(), role: role.value.trim() || null, emails: email.value.trim() ? [email.value.trim()] : [] }) });
      if (!c.ok) { save.disabled = false; add(row, notice('bad', 'The contact could not be saved.', 'No se pudo guardar el contacto.')); return; }
      await loadContacts();
      to.value = c.body.id; scopeCheck();
    });
  }
  to.addEventListener('change', scopeCheck);

  // ── drafting ──
  // A draft takes the model up to a minute or two; the default ten-second request ceiling would cut it off.
  const post = (path, body, timeoutMs) => api(path, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 15000) });
  async function runDraft(tone) {
    notices.textContent = '';
    const c = contactOf();
    if (!brief.value.trim() || brief.value.trim().length < 8) { add(notices, notice('bad', 'Say what the draft should do.', 'Diga qué debe hacer el borrador.')); return; }
    go.disabled = true; setText(go.querySelector('span') || go, 'Drafting…', 'Redactando…');
    const body = { kind: kind.value, project_id: ctx.project.id, brief: brief.value.trim(), language: language.value };
    if (c) body.organisation_id = c.organisation.id;
    if (tone && state.draft) { body.tone = tone; body.previous = state.draft.paragraphs.join('\n\n'); }
    const r = await post('/api/draft', body, 180000);
    go.disabled = false; setText(go.querySelector('span') || go, 'Draft', 'Redactar');
    if (!r.ok) { add(notices, notice('bad', r.status === 501 ? 'Drafting needs the assistant provider on the server.' : r.status === 0 ? 'The draft took too long or the connection dropped. Try again.' : 'The draft could not be made.' + (r.body && r.body.error ? ' ' + r.body.error.message : ''), r.status === 501 ? 'La redacción necesita el proveedor del asistente en el servidor.' : r.status === 0 ? 'El borrador tardó demasiado o se perdió la conexión. Inténtelo de nuevo.' : 'No se pudo hacer el borrador.')); return; }
    // A tone re-draft continues the same review: the citations opened and the clock carry over; a fresh draft starts both.
    state.draft = r.body; state.decisions = r.body.paragraphs.map((p) => (QUESTION_RE.test(p) ? null : 'keep')); state.notes = {}; state.sent = null; state.rendered = null; state.loadedReview = null;
    if (!tone) { state.citationsOpened = 0; state.startedAt = Date.now(); }
    renderResult();
  }
  setup.addEventListener('submit', (ev) => { ev.preventDefault(); runDraft(null); });

  const sourceOf = (ref) => (state.draft.sources || []).find((s) => s.ref === ref) || null;
  const titleOf = (ref) => { const s = sourceOf(ref); if (s) return s.title; const d = (state.draft.context && state.draft.context.dispatches || []).find((x) => 'doc:' + x.item_id === ref); if (d) return d.title; const run = (state.draft.context && state.draft.context.runs || []).find((x) => 'run:' + x.id === ref); if (run) return run.title; const e = (ctx.entries || []).find((x) => x.ref === ref); if (e && e.title) return e.title; return ref; };
  const isCorrespondence = (ref) => (state.draft.context && state.draft.context.dispatches || []).some((x) => 'doc:' + x.item_id === ref);

  function paragraphNode(text, i) {
    const p = mk('div', 'hub-dr-para', null, null, { 'data-i': String(i) });
    const q = QUESTION_RE.exec(text);
    const body = mk('p', q ? 'hub-dr-text hub-uncited' : 'hub-dr-text');
    if (q) {
      // The API wraps the sentence in its reason; show the sentence itself.
      const quoted = /"([\s\S]*)"\s*$/.exec(q[1]);
      body.setAttribute('data-uncited', ''); add(body, mk('span', 'hub-dr-flag', 'No record to cite: ', 'Sin registro que citar: '), dv('span', null, quoted ? quoted[1] : q[1]));
    }
    else {
      let last = 0; const t = text;
      for (const m of t.matchAll(CITE_RE)) {
        if (m.index > last) add(body, dv('span', null, t.slice(last, m.index)));
        const ref = m[1];
        const chip = dv('button', 'hub-cite', titleOf(ref), { type: 'button', 'data-ref': ref, title: ref });
        chip.addEventListener('click', () => { state.citationsOpened++; const s = sourceOf(ref); openRecord({ ref, title: titleOf(ref), trigger: chip, passage: s && s.snippet ? s.snippet : null }); });
        add(body, chip);
        last = m.index + m[0].length;
      }
      if (last < t.length) add(body, dv('span', null, t.slice(last)));
    }
    add(p, body);
    const ctl = mk('div', 'hub-dr-decide', null, null, { role: 'group' });
    const opts = q ? [['keep-note', 'Keep as my own words', 'Mantener como mis palabras'], ['drop', 'Drop', 'Quitar']] : [['keep', 'Keep', 'Mantener'], ['keep-note', 'Keep with a note', 'Mantener con nota'], ['drop', 'Drop', 'Quitar']];
    for (const [v, en, es] of opts) {
      const b = mk('button', 'btn btn-outline btn-sm', en, es, { type: 'button', 'data-decide': v, 'aria-pressed': state.decisions[i] === v ? 'true' : 'false' });
      b.addEventListener('click', () => { state.decisions[i] = v; for (const x of ctl.querySelectorAll('[data-decide]')) x.setAttribute('aria-pressed', x.dataset.decide === v ? 'true' : 'false'); p.setAttribute('data-decision', v); note.toggleAttribute('hidden', v !== 'keep-note'); gate(); autosave(); });
      add(ctl, b);
    }
    const note = mk('input', null, null, null, { type: 'text', placeholder: 'Note', 'aria-label': 'Note', 'data-note': String(i), hidden: '' });
    if (state.notes[i]) note.value = state.notes[i];
    if (state.decisions[i] === 'keep-note') note.removeAttribute('hidden');
    note.addEventListener('input', () => { state.notes[i] = note.value; autosave(); });
    add(p, ctl, note);
    if (state.decisions[i]) p.setAttribute('data-decision', state.decisions[i]);
    return p;
  }

  let approve, renderDocx, renderPdf, markSent, saveBtn;
  function gate() {
    const undecided = state.decisions.some((d) => d === null);
    const blocked = undecided || !!state.sent;
    for (const b of [approve, renderDocx, renderPdf]) if (b) b.disabled = blocked;
    const uncited = state.draft.paragraphs.filter((p, i) => QUESTION_RE.test(p) && state.decisions[i] === null).length;
    result.setAttribute('data-uncited', String(uncited));
    if (markSent) markSent.disabled = !state.rendered || !!state.sent;
    if (saveBtn) saveBtn.disabled = !!state.sent;
    for (const b of result.querySelectorAll('[data-tone]')) b.disabled = !!state.sent;
  }

  // Every decision and note is saved on its own a moment after it is made, so leaving the page loses nothing.
  let autosaveTimer = null;
  function autosave() {
    if (!state.draft || state.sent) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { const st = document.getElementById('dr-status'); if (st) saveReview(st, true); }, 1200);
  }

  function renderResult() {
    result.textContent = ''; result.removeAttribute('hidden');
    const d = state.draft;
    // What this draft does not know, first.
    const unknown = mk('section', 'hub-dr-unknown', null, null, { 'data-questions': String(d.questions.length) });
    add(unknown, mk('h4', null, 'What this draft does not know', 'Lo que este borrador no sabe'));
    if (!d.questions.length) add(unknown, mk('p', 'hub-muted', 'Nothing: every figure found its record.', 'Nada: cada cifra encontró su registro.'));
    else {
      const ul = mk('ul', 'hub-dr-questions');
      d.questions.forEach((qt, i) => {
        const li = mk('li');
        add(li, dv('span', null, qt));
        const who = d.who_to_ask && d.who_to_ask[i % Math.max(1, d.who_to_ask.length)];
        if (who) { const a = dv('a', 'btn btn-outline btn-sm', 'Ask ' + who.person, { href: 'mailto:?subject=' + encodeURIComponent(ctx.project.name + ': a question for the draft') + '&body=' + encodeURIComponent(qt) }); add(li, mk('span', 'hub-muted', ' · ' + who.person + ' worked this on ' + who.last + ' (' + who.on + ')', ' · ' + who.person + ' trabajó en esto el ' + who.last + ' (' + who.on + ')'), a); }
        add(ul, li);
      });
      add(unknown, ul);
    }
    add(result, unknown);
    // The draft, paragraph by paragraph.
    const paras = mk('section', 'hub-dr-paras', null, null, { id: 'dr-paras' });
    add(paras, mk('h4', null, 'The draft', 'El borrador'));
    d.paragraphs.forEach((p, i) => add(paras, paragraphNode(p, i)));
    const tones = mk('div', 'hub-dr-tones', null, null, { role: 'group', 'aria-label': 'Tone' });
    for (const [v, en, es] of TONES) { const b = mk('button', 'btn btn-outline btn-sm', en, es, { type: 'button', 'data-tone': v }); b.addEventListener('click', () => runDraft(v)); add(tones, b); }
    add(paras, tones);
    add(result, paras);
    // Sources used.
    const src = mk('section', 'hub-dr-sources');
    add(src, mk('h4', null, 'Sources used', 'Fuentes usadas'));
    const sl = mk('ul', 'hub-dr-source-list');
    for (const s of d.sources || []) { const li = mk('li', null, null, null, { 'data-ref': s.ref }); add(li, dv('b', null, s.title), s.why ? dv('span', 'hub-muted', ' · ' + s.why) : null, isCorrespondence(s.ref) ? mk('span', 'hub-pill muted', 'prior correspondence', 'correspondencia anterior') : null); add(sl, li); }
    for (const x of (d.context && d.context.dispatches) || []) if (!(d.sources || []).some((s) => s.ref === 'doc:' + x.item_id)) { const li = mk('li', null, null, null, { 'data-ref': 'doc:' + x.item_id }); add(li, dv('b', null, x.title), mk('span', 'hub-pill muted', 'prior correspondence', 'correspondencia anterior')); add(sl, li); }
    if (!sl.children.length) add(sl, mk('li', 'hub-muted', 'None.', 'Ninguna.'));
    add(src, sl);
    add(result, src);
    // Actions.
    const act = mk('div', 'hub-actions hub-dr-actions');
    saveBtn = mk('button', 'btn btn-outline btn-sm', 'Save review', 'Guardar revisión', { type: 'button', id: 'dr-save' });
    approve = mk('span', null, null, null, { hidden: '' });
    renderDocx = mk('button', 'btn btn-primary btn-sm', 'Render to letterhead (DOCX)', 'Generar en membrete (DOCX)', { type: 'button', id: 'dr-render' });
    renderPdf = mk('button', 'btn btn-outline btn-sm', 'PDF', 'PDF', { type: 'button', id: 'dr-pdf' });
    markSent = mk('button', 'btn btn-outline btn-sm', 'Mark as sent', 'Marcar como enviado', { type: 'button', id: 'dr-sent' });
    const status = mk('span', 'hub-muted', null, null, { id: 'dr-status', role: 'status' });
    add(act, saveBtn, renderDocx, renderPdf, markSent, status);
    add(result, act);
    if (state.sent && state.sent.occurred_at) { const when = fmtShortDate(state.sent.occurred_at); setText(status, 'Sent' + (state.sent.organisation ? ' to ' + state.sent.organisation : '') + ' on ' + when.en + '. The draft is frozen.', 'Enviado' + (state.sent.organisation ? ' a ' + state.sent.organisation : '') + ' el ' + when.es + '. El borrador está congelado.'); result.setAttribute('data-sent', state.sent.id || 'yes'); }
    else if (state.loadedReview) setText(status, 'Review as saved' + (state.loadedReview.at ? ' ' + fmtShortDate(state.loadedReview.at).en : '') + '.', 'Revisión tal como se guardó' + (state.loadedReview.at ? ' el ' + fmtShortDate(state.loadedReview.at).es : '') + '.');
    saveBtn.addEventListener('click', () => saveReview(status));
    renderDocx.addEventListener('click', () => render('docx', status));
    renderPdf.addEventListener('click', () => render('pdf', status));
    markSent.addEventListener('click', () => sent(status));
    gate();
  }

  async function saveReview(status, quiet) {
    clearTimeout(autosaveTimer);
    const r = await api('/api/items/' + encodeURIComponent(state.draft.id) + '/review', { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ decisions: state.decisions.map((d) => d || 'keep'), notes: state.notes, citations_opened: state.citationsOpened, review_seconds: Math.round((Date.now() - state.startedAt) / 1000) }) });
    if (!r.ok) { setText(status, 'The review could not be saved.', 'No se pudo guardar la revisión.'); result.setAttribute('data-saved', 'failed'); return false; }
    setText(status, quiet ? 'Saved.' : 'Review saved.', quiet ? 'Guardado.' : 'Revisión guardada.');
    result.setAttribute('data-saved', new Date().toISOString());
    return true;
  }
  async function render(format, status) {
    if (state.decisions.some((d) => d === null)) return;
    if (!(await saveReview(status))) return;
    if (state.citationsOpened === 0) add(notices, notice('warn', 'You have not opened a citation. Rendering anyway.', 'No ha abierto ninguna cita. Se genera de todos modos.'));
    setText(status, 'Rendering…', 'Generando…');
    const res = await fetch('/api/render?format=' + format, { method: 'POST', credentials: 'same-origin', headers: { accept: '*/*', 'content-type': 'application/json' }, body: JSON.stringify({ draft_id: state.draft.id }) });
    if (!res.ok) {
      setText(status, format === 'pdf' ? 'PDF needs Chromium on the server; use the DOCX.' : 'The document could not be rendered.', format === 'pdf' ? 'El PDF necesita Chromium en el servidor; use el DOCX.' : 'No se pudo generar el documento.');
      return;
    }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') || '';
    const name = (/filename="([^"]+)"/.exec(cd) || [])[1] || ('draft.' + format);
    const url = URL.createObjectURL(blob);
    const a = mk('a', null, null, null, { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    state.rendered = name.replace(/\.(docx|pdf)$/, '');
    setText(status, 'Rendered ' + name + '.', 'Generado ' + name + '.');
    result.setAttribute('data-rendered', state.rendered);
    gate();
  }
  async function sent(status) {
    const c = contactOf();
    if (!c) { add(notices, notice('bad', 'Choose the recipient first.', 'Elija primero el destinatario.')); return; }
    const r = await post('/api/items/' + encodeURIComponent(state.draft.id) + '/sent', { organisation_id: c.organisation.id, contact_ids: [c.id], channel: kind.value === 'letter' ? 'post' : 'email' });
    if (!r.ok) { setText(status, 'Could not mark as sent.' + (r.body && r.body.error ? ' ' + r.body.error.message : ''), 'No se pudo marcar como enviado.'); return; }
    state.sent = r.body;
    const when = fmtShortDate(r.body.occurred_at);
    setText(status, 'Sent to ' + c.name + ', ' + c.organisation.name + ' on ' + when.en + '. The draft is now frozen.', 'Enviado a ' + c.name + ', ' + c.organisation.name + ' el ' + when.es + '. El borrador queda congelado.');
    result.setAttribute('data-sent', r.body.id);
    gate();
    if (typeof ctx.refreshTimeline === 'function') ctx.refreshTimeline();
  }
  /** Reopen a draft note the Vault holds (GET /api/items/:id): the paragraphs, sources and questions as drafted,
   *  the decisions and notes as last saved, frozen if it was sent. The set-up strip shows what was asked. */
  async function load(rec) {
    const ex = rec && rec.extracted;
    if (!ex || ex.kind !== 'draft' || !Array.isArray(ex.paragraphs)) return false;
    notices.textContent = '';
    if (ex.draft_kind && KINDS.some((k) => k[0] === ex.draft_kind)) kind.value = ex.draft_kind;
    if (ex.language === 'es' || ex.language === 'en') language.value = ex.language;
    brief.value = ex.brief || '';
    state.draft = { id: rec.id, draft: ex.draft || '', paragraphs: ex.paragraphs, citations: ex.citations || [], questions: ex.questions || [], warnings: ex.warnings || [], who_to_ask: ex.who_to_ask || [], sources: ex.sources || [], context: null };
    const review = ex.review && Array.isArray(ex.review.decisions) && ex.review.decisions.length === ex.paragraphs.length ? ex.review : null;
    // A question paragraph offers no plain Keep: a saved 'keep' there means it was never decided.
    state.decisions = ex.paragraphs.map((p, i) => { const d = review ? review.decisions[i] : null; return QUESTION_RE.test(p) ? (d === 'keep-note' || d === 'drop' ? d : null) : (d || 'keep'); });
    state.notes = review && review.notes ? { ...review.notes } : {};
    state.citationsOpened = review ? Number(review.citations_opened) || 0 : 0;
    state.startedAt = Date.now();
    state.loadedReview = review;
    state.sent = ex.sent && ex.sent.at ? { id: ex.sent.dispatch_id || null, occurred_at: ex.sent.at, organisation: ex.sent.organisation || null } : null;
    state.rendered = ex.reference_no || rec.reference_no || null;
    if (!state.contacts) await loadContacts();
    toggle(true);
    if (ex.organisation_id && state.contacts) { const c = state.contacts.contacts.find((x) => x.organisation.id === ex.organisation_id); if (c) { to.value = c.id; scopeCheck(); } }
    renderResult();
    result.setAttribute('data-loaded', rec.id);
    host.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return true;
  }
  return { open: () => toggle(true), load };
}
