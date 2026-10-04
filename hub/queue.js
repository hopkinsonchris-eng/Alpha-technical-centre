/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB QUEUES (M10, Tier C)
   hub/queue.html[?kind=lesson|rerun-delta|…]

   Three sections, each hidden when its endpoint answers 404 or 501:
     Filing queue   GET  /api/queue/filing
                    POST /api/queue/filing/:id/assign   {project_id}   (files it, adds the sender to the project's contacts)
                    POST /api/queue/filing/:id/dismiss                 ("not a project email": stays in the firm inbox)
     Lessons        GET  /api/lessons?status=proposed
                    POST /api/lessons/:id/confirm | /reject
     Review queue   GET  /api/queue/review           (NDA expiries, organisation proposals and fields named in documents; ?kind= adds one more kind)
                    POST /api/organisations          (accepting an organisation proposal adds it to the registry first)
                    POST /api/queue/review/:id/accept | /reject
   Projects for the assign list: GET /api/projects. Every string a person reads carries data-en and data-es.
   No secrets, no provider calls: this file only talks to /api/* on the same origin (behind Cloudflare Access).
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, fmtStamp } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' };
const post = (path, body) => api(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body || {}) });
const unbuilt = (r) => r.status === 404 || r.status === 501;
const errText = (r) => (r && r.body && r.body.error && r.body.error.message) || '';
const pct = (c) => (typeof c === 'number' ? Math.round(c * 100) + ' %' : '');
const kindParam = new URLSearchParams(location.search).get('kind') || '';

let projects = [];           // [{id, name}]
const projectName = (id) => { const p = projects.find((x) => x.id === id); return p ? p.name : id; };

/* ── shared bits ─────────────────────────────────────────────────────── */

const MAIL_ICON = '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>';
const BULB_ICON = '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>';
const DOC_ICON = '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
function icon(svg, tone) {
  const s = document.createElement('span');
  s.className = 'hub-item-ico' + (tone ? ' ' + tone : '');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = svg; // static, trusted markup defined above
  return s;
}

function announce(en, es) { setText($('#live'), en, es); }
function setCount(id, n) { const el = $(id); if (el) el.textContent = String(n); }
function empty(list) { list.textContent = ''; add(list, mk('div', 'hub-empty', 'Nothing waiting.', 'Nada pendiente.')); }
function unavailable(list, res) {
  list.textContent = '';
  const why = errText(res);
  add(list, add(mk('div', 'hub-notice bad'), add(mk('span'), mk('b', null, 'Could not load this queue.', 'No se pudo cargar esta cola.'), document.createTextNode(' '), why ? dv('span', null, why) : mk('span', null, 'Try again in a moment.', 'Inténtelo de nuevo en un momento.'))));
}

/** Run an action on a row: disable it, show the failure inline, call onDone(result) and drop the row on success. */
async function act(row, list, countId, call, onDone) {
  row.setAttribute('data-busy', '1');
  row.querySelectorAll('button, select, input').forEach((el) => { el.disabled = true; });
  const old = row.querySelector('.q-msg'); if (old) old.remove();
  const res = await call();
  const gone = res.ok || res.status === 409 || res.status === 404;   // resolved elsewhere: nothing left to do here
  if (!gone) {
    row.removeAttribute('data-busy');
    row.querySelectorAll('button, select, input').forEach((el) => { el.disabled = false; });
    const why = res.status === 403 ? [' Only partners can decide this.', ' Solo los socios pueden decidir esto.'] : [errText(res) ? ' ' + errText(res) : ' Try again.', errText(res) ? ' ' + errText(res) : ' Inténtelo de nuevo.'];
    const msg = mk('p', 'q-msg bad', null, null, { role: 'alert' });
    add(msg, mk('b', null, 'Not done.', 'No realizado.'), mk('span', null, why[0], why[1]));
    add(row, msg);
    return;
  }
  if (res.ok && onDone) onDone(res.body || {});
  else if (res.status === 409) announce('That one was already dealt with by someone else.', 'Alguien más ya resolvió ese elemento.');
  row.remove();
  const left = list.querySelectorAll('.q-row').length;
  setCount(countId, left);
  if (!left) empty(list);
}

/* ── filing queue ────────────────────────────────────────────────────── */

function filingRow(it, list) {
  const row = mk('div', 'hub-item q-row', null, null, { 'data-queue-id': it.id, 'data-item-id': it.item_id || '' });
  add(row, icon(MAIL_ICON));
  const body = mk('div', 'hub-item-body');
  const tid = 'qt-' + it.id;
  add(body, dv('span', 't', it.subject || '(no subject)', { id: tid }));
  const meta = mk('span', 'm');
  const parts = [];
  const from = it.from || it.sender || it.from_address;
  if (from) parts.push(dv('span', null, from));
  if (it.date) { const d = fmtStamp(it.date); parts.push(mk('span', null, d.en, d.es)); }
  const n = Number(it.attachments || 0);
  if (n) parts.push(mk('span', null, n + (n === 1 ? ' attachment' : ' attachments'), n + (n === 1 ? ' adjunto' : ' adjuntos')));
  parts.forEach((p, i) => { if (i) meta.appendChild(document.createTextNode(' · ')); meta.appendChild(p); });
  add(body, meta);
  const flags = mk('div', 'q-flags');
  if (it.direction === 'out') add(flags, mk('span', 'hub-pill info', 'Sent by us', 'Enviado por nosotros'));
  else if (it.direction === 'in') add(flags, mk('span', 'hub-pill muted', 'Received', 'Recibido'));
  if (flags.children.length) add(body, flags);

  const assign = (projectId) => act(row, list, '#n-filing',
    () => post('/api/queue/filing/' + encodeURIComponent(it.id) + '/assign', { project_id: projectId }),
    (b) => {
      const pn = projectName(b.project_id || projectId);
      const added = (b.contacts || []).length;
      announce('Filed to ' + pn + (added ? '; the sender is now one of its contacts.' : '.'), 'Archivado en ' + pn + (added ? '; el remitente ya es uno de sus contactos.' : '.'));
    });

  const sugg = (it.suggestions || []).filter((s) => s && s.project_id);
  if (sugg.length) {
    const box = mk('div', 'q-sugg', null, null, { role: 'group', 'aria-labelledby': tid });
    for (const s of sugg.slice(0, 3)) {
      const name = s.project_name || projectName(s.project_id);
      const b = mk('button', 'btn btn-outline btn-sm', null, null, { type: 'button', 'data-assign': s.project_id });
      add(b, mk('span', null, 'File to ', 'Archivar en '), dv('span', null, name + (s.confidence != null ? ' · ' + pct(s.confidence) : '')));
      b.addEventListener('click', () => assign(s.project_id));
      add(box, b);
    }
    add(body, box);
  }

  const controls = mk('div', 'q-controls');
  if (projects.length) {
    const sid = 'qs-' + it.id;
    add(controls, mk('label', 'sr-only', 'Project for this message', 'Proyecto para este mensaje', { for: sid }));
    const sel = mk('select', null, null, null, { id: sid, 'data-project-select': '' });
    add(sel, mk('option', null, 'Choose a project…', 'Elija un proyecto…', { value: '' }));
    for (const p of projects) add(sel, dv('option', null, p.name, { value: p.id }));
    const go = mk('button', 'btn btn-primary btn-sm', 'Assign', 'Asignar', { type: 'button', 'data-action': 'assign', 'aria-describedby': tid });
    go.addEventListener('click', () => { if (sel.value) assign(sel.value); else sel.focus(); });
    add(controls, sel, go);
  }
  const no = mk('button', 'btn btn-outline btn-sm', 'Not a project email', 'No es un correo de proyecto', { type: 'button', 'data-action': 'dismiss', 'aria-describedby': tid });
  no.addEventListener('click', () => act(row, list, '#n-filing',
    () => post('/api/queue/filing/' + encodeURIComponent(it.id) + '/dismiss'),
    () => announce('Kept in the firm inbox, not filed to a project.', 'Conservado en la bandeja de la firma, sin archivar en un proyecto.')));
  add(controls, no);
  add(body, controls);
  add(row, body);
  return row;
}

async function renderFiling() {
  const sec = $('#sec-filing'), list = $('#filing-list');
  const r = await api('/api/queue/filing');
  if (unbuilt(r)) { sec.setAttribute('hidden', ''); return; }
  if (!r.ok) { unavailable(list, r); return; }
  const items = listOf(r.body, 'items', 'queue', 'entries');
  setCount('#n-filing', items.length);
  list.textContent = '';
  if (!items.length) { empty(list); return; }
  // Wave 6 (P52): rows the capture marked ready (one candidate above the bar, a known counterparty) file in one tap; the rest need a decision.
  const ready = items.filter((it) => it.group === 'ready'), review = items.filter((it) => it.group !== 'ready');
  if (ready.length) {
    const head = mk('div', 'q-group-head', null, null, { 'data-group': 'ready' });
    add(head, mk('span', 'label', 'Ready', 'Listos'), mk('span', 'hub-muted', ready.length + (ready.length === 1 ? ' message with one clear project' : ' messages with one clear project'), ready.length + (ready.length === 1 ? ' mensaje con un proyecto claro' : ' mensajes con un proyecto claro')));
    const all = mk('button', 'btn btn-primary btn-sm', 'Accept all', 'Aceptar todos', { type: 'button', id: 'filing-accept-ready' });
    all.addEventListener('click', async () => {
      all.disabled = true;
      const res = await post('/api/queue/filing/accept-ready', { ids: ready.map((it) => it.id) });
      if (!res.ok) { all.disabled = false; announce('Could not file them.' + (errText(res) ? ' ' + errText(res) : ''), 'No se pudieron archivar.'); return; }
      const filed = (res.body && res.body.filed) || [];
      for (const f of filed) { const row = list.querySelector('[data-queue-id="' + CSS.escape(f.id) + '"]'); if (row) row.remove(); }
      const left = list.querySelectorAll('.q-row').length;
      setCount('#n-filing', left);
      if (!list.querySelector('[data-group="ready"] ~ .q-row[data-group="ready"]')) head.remove();
      if (!left) empty(list);
      announce(filed.length + (filed.length === 1 ? ' message filed.' : ' messages filed.') + ((res.body.skipped || []).length ? ' ' + res.body.skipped.length + ' could not be.' : ''), filed.length + (filed.length === 1 ? ' mensaje archivado.' : ' mensajes archivados.'));
    });
    add(head, all); add(list, head);
    for (const it of ready) { const row = filingRow(it, list); row.setAttribute('data-group', 'ready'); add(list, row); }
  }
  if (review.length) {
    if (ready.length) { const head = mk('div', 'q-group-head', null, null, { 'data-group': 'review' }); add(head, mk('span', 'label', 'Needs a decision', 'Requiere decisión')); add(list, head); }
    for (const it of review) { const row = filingRow(it, list); row.setAttribute('data-group', 'review'); add(list, row); }
  }
}

/* ── lesson proposals ────────────────────────────────────────────────── */

function lessonRow(l, list) {
  const row = mk('div', 'hub-item q-row', null, null, { 'data-lesson-id': l.id });
  add(row, icon(BULB_ICON, 'gold'));
  const body = mk('div', 'hub-item-body');
  const tid = 'lt-' + l.id;
  add(body, dv('span', 't', l.statement || l.claim || l.text || l.title || l.id, { id: tid }));
  const bits = [l.discipline, l.scope && l.scope !== 'firm' ? l.scope + (l.scope_id ? ':' + l.scope_id : '') : '', l.confidence != null ? 'confidence ' + l.confidence : ''].filter(Boolean);
  if (bits.length) add(body, dv('span', 'm', bits.join(' · ')));
  const controls = mk('div', 'q-controls');
  const ok = mk('button', 'btn btn-primary btn-sm', 'Accept', 'Aceptar', { type: 'button', 'data-action': 'accept', 'aria-describedby': tid });
  const no = mk('button', 'btn btn-outline btn-sm', 'Reject', 'Rechazar', { type: 'button', 'data-action': 'reject', 'aria-describedby': tid });
  ok.addEventListener('click', () => act(row, list, '#n-lessons', () => post('/api/lessons/' + encodeURIComponent(l.id) + '/confirm'), () => announce('Lesson accepted.', 'Lección aceptada.')));
  no.addEventListener('click', () => act(row, list, '#n-lessons', () => post('/api/lessons/' + encodeURIComponent(l.id) + '/reject'), () => announce('Lesson rejected.', 'Lección rechazada.')));
  add(controls, ok, no);
  add(body, controls);
  add(row, body);
  return row;
}

async function renderLessons() {
  const sec = $('#sec-lessons'), list = $('#lessons-list');
  const r = await api('/api/lessons?status=proposed');
  if (!r.ok) return;                       // 404 / 501: not built; anything else: leave it out rather than show a broken card
  const items = listOf(r.body, 'lessons', 'items');
  sec.removeAttribute('hidden');
  setCount('#n-lessons', items.length);
  list.textContent = '';
  if (!items.length) { empty(list); return; }
  for (const l of items) add(list, lessonRow(l, list));
}

/* ── review queue: NDA expiries, organisation proposals ──────────────── */

const ORG_KINDS = [['client', 'Client', 'Cliente'], ['partner', 'Partner', 'Socio'], ['operator', 'Operator', 'Operador'], ['regulator', 'Regulator', 'Regulador'], ['vendor', 'Vendor', 'Proveedor'], ['counsel', 'Counsel', 'Asesor legal'], ['other', 'Other', 'Otro']];

function reviewRow(q, list) {
  const p = q.payload || {};
  const row = mk('div', 'hub-item q-row', null, null, { 'data-review-id': q.id, 'data-kind': q.kind });
  const tid = 'rt-' + q.id;
  const body = mk('div', 'hub-item-body');
  const controls = mk('div', 'q-controls');
  let accept;

  if (q.kind === 'organisation') {
    add(row, icon(MAIL_ICON, 'gold'));
    add(body, add(mk('span', 't', null, null, { id: tid }), mk('span', null, 'New organisation: ', 'Nueva organización: '), dv('b', null, p.name), document.createTextNode(' '), dv('span', 'hub-muted', '(' + (p.domain || '—') + ')')));
    const who = [p.sender_name, p.sender_email].filter(Boolean).join(' · ');
    add(body, dv('span', 'm', [who, p.subject].filter(Boolean).join(' — ')));
    const nid = 'rn-' + q.id, kid = 'rk-' + q.id;
    add(controls, mk('label', 'sr-only', 'Organisation name', 'Nombre de la organización', { for: nid }));
    const name = mk('input', null, null, null, { id: nid, type: 'text', value: p.name || '', 'data-org-name': '' });
    add(controls, name, mk('label', 'sr-only', 'Kind of organisation', 'Tipo de organización', { for: kid }));
    const kind = mk('select', null, null, null, { id: kid, 'data-org-kind': '' });
    for (const k of ORG_KINDS) { const o = mk('option', null, k[1], k[2], { value: k[0] }); if (k[0] === 'other') o.setAttribute('selected', ''); add(kind, o); }
    add(controls, kind);
    accept = async () => {
      const nm = name.value.trim();
      if (!nm) { name.focus(); return { ok: false, status: 0, body: { error: { message: 'A name is required.' } } }; }
      const created = await post('/api/organisations', { name: nm, kind: kind.value, identifiers: { domains: p.domain ? [p.domain] : [] } });
      if (!created.ok && created.status !== 409) return created;          // 409: already in the registry, which is what accepting asks for
      return post('/api/queue/review/' + encodeURIComponent(q.id) + '/accept');
    };
  } else if (q.kind === 'asset') {
    // Wave 3: a field named in a document. Accept attaches the first gazetteer candidate, or the name alone when there is none;
    // the Fields card on the project file offers the full choice.
    add(row, icon(DOC_ICON, 'gold'));
    add(body, add(mk('span', 't', null, null, { id: tid }), mk('span', null, 'Field named in a document: ', 'Campo nombrado en un documento: '), dv('b', null, p.name), document.createTextNode(' '), dv('span', 'hub-muted', '(' + (p.kind || 'field') + ')')));
    const proj = projects.find((x) => x.id === p.project_id);
    add(body, add(mk('span', 'm'), dv('a', 'hub-inline-link', (proj && proj.name) || p.project_id || '—', { href: '/hub/project.html?id=' + encodeURIComponent(p.project_id || '') + '#p-fields', 'data-proposal-project': p.project_id || '' }), dv('span', null, [p.item_title, p.anchor].filter(Boolean).map((x) => ' · ' + x).join(''))));
    if (p.quote) add(body, dv('span', 'm q-quote', '“' + p.quote + '”'));
    const first = Array.isArray(p.candidates) && p.candidates[0];
    if (first) add(body, add(mk('span', 'm', null, null, { 'data-first-candidate': first.source + ':' + first.source_id }), mk('span', null, 'Accept attaches ', 'Aceptar adjunta '), dv('b', null, first.name), dv('span', null, ' (' + first.source + (Number.isFinite(first.lat) && Number.isFinite(first.lon) ? ', ' + first.lat + ', ' + first.lon : '') + ')')));
    else add(body, mk('span', 'm', 'No gazetteer match: Accept attaches the name without a location.', 'Sin coincidencia en gaceteros: Aceptar adjunta el nombre sin ubicación.'));
    accept = () => post('/api/queue/review/' + encodeURIComponent(q.id) + '/accept', first ? (first.asset_id ? { asset_id: first.asset_id } : { create: { name: first.name, kind: first.kind || p.kind || 'field', ...(Number.isFinite(first.lat) && Number.isFinite(first.lon) ? { lat: first.lat, lon: first.lon, location_source: first.source } : {}), source_id: first.source_id, source_url: first.source_url, detail: first.detail || undefined, country: first.country || undefined } }) : {});
  } else if (q.kind === 'research') {
    // Wave 4: an operator, licence or production figure a research finding states, with its verbatim quote.
    // Accept records it (the operator on the field, a production figure on the register's current); Not a fact closes it.
    add(row, icon(DOC_ICON, 'gold'));
    add(body, add(mk('span', 't', null, null, { id: tid }), p.fact_kind === 'location' ? mk('span', null, 'Field location from the gazetteers: ', 'Ubicación de campo desde los gaceteros: ') : mk('span', null, 'Fact from research: ', 'Hecho desde la investigación: '), dv('b', null, p.proposal || p.value), document.createTextNode(' '), dv('span', 'hub-muted', p.asset_name && p.fact_kind !== 'location' ? '(' + p.asset_name + ')' : '')));
    const proj = projects.find((x) => x.id === p.project_id);
    add(body, add(mk('span', 'm'), dv('a', 'hub-inline-link', (proj && proj.name) || p.project_id || '—', { href: '/hub/project.html?id=' + encodeURIComponent(p.project_id || '') + '#p-fields', 'data-proposal-project': p.project_id || '' }), dv('span', null, p.item_title ? ' · ' + p.item_title : '')));
    if (p.quote) add(body, dv('span', 'm q-quote', '“' + p.quote + '”'));
    accept = () => post('/api/queue/review/' + encodeURIComponent(q.id) + '/accept', { apply: true });
  } else if (q.kind === 'nda-expiry') {
    add(row, icon(DOC_ICON, 'gold'));
    add(body, dv('span', 't', p.proposal || ('Set the expiry of ' + (p.legal_tag || 'the legal tag') + ' to ' + (p.proposed_expires_at || '—')), { id: tid }));
    const m = mk('span', 'm');
    add(m, dv('span', null, [p.item_title, p.current_expires_at ? 'now ' + p.current_expires_at : 'no expiry set'].filter(Boolean).join(' · ')));
    add(body, m);
    if (p.evidence) add(body, dv('span', 'm q-quote', '“' + p.evidence + '”'));
    accept = () => post('/api/queue/review/' + encodeURIComponent(q.id) + '/accept');
  } else {
    add(row, icon(DOC_ICON, 'gold'));
    add(body, dv('span', 't', p.summary || p.title || p.proposal || q.kind, { id: tid }));
    add(body, dv('span', 'm', [q.kind, p.project_id].filter(Boolean).join(' · ')));
    accept = () => post('/api/queue/review/' + encodeURIComponent(q.id) + '/accept');
  }

  const okLabel = q.kind === 'organisation' ? ['Add to registry', 'Añadir al registro'] : q.kind === 'asset' ? ['Attach', 'Adjuntar'] : q.kind === 'research' ? (p.fact_kind === 'operator' ? ['Set as operator', 'Fijar como operador'] : p.fact_kind === 'location' ? ['Set location', 'Fijar ubicación'] : ['File as fact', 'Archivar como hecho']) : ['Accept', 'Aceptar'];
  const ok = mk('button', 'btn btn-primary btn-sm', okLabel[0], okLabel[1], { type: 'button', 'data-action': 'accept', 'aria-describedby': tid });
  const no = mk('button', 'btn btn-outline btn-sm', q.kind === 'asset' ? 'Not a field' : q.kind === 'research' ? (p.fact_kind === 'location' ? 'Not it' : 'Not a fact') : 'Reject', q.kind === 'asset' ? 'No es un campo' : q.kind === 'research' ? (p.fact_kind === 'location' ? 'No es ese' : 'No es un hecho') : 'Rechazar', { type: 'button', 'data-action': 'reject', 'aria-describedby': tid });
  ok.addEventListener('click', () => act(row, list, '#n-review', accept, () => announce(q.kind === 'organisation' ? 'Organisation added to the registry.' : q.kind === 'asset' ? 'Field attached to the project; its dossier is filed.' : q.kind === 'research' ? 'Fact recorded with its quote.' : 'Accepted.', q.kind === 'organisation' ? 'Organización añadida al registro.' : q.kind === 'asset' ? 'Campo adjuntado al proyecto; su dosier queda archivado.' : q.kind === 'research' ? 'Hecho registrado con su cita.' : 'Aceptado.')));
  no.addEventListener('click', () => act(row, list, '#n-review', () => post('/api/queue/review/' + encodeURIComponent(q.id) + '/reject'), () => announce('Rejected.', 'Rechazado.')));
  add(controls, ok, no);
  add(body, controls);
  add(row, body);
  return row;
}

async function renderReview() {
  const sec = $('#sec-review'), list = $('#review-list');
  const r = await api('/api/queue/review');
  if (!r.ok) return;
  const want = new Set(['nda-expiry', 'organisation', 'asset', 'research']);
  if (kindParam && kindParam !== 'lesson' && kindParam !== 'filing') want.add(kindParam);
  const items = listOf(r.body, 'items', 'queue').filter((q) => q && want.has(q.kind));
  sec.removeAttribute('hidden');
  setCount('#n-review', items.length);
  list.textContent = '';
  if (!items.length) { empty(list); return; }
  for (const q of items) add(list, reviewRow(q, list));
}

/* ── page ────────────────────────────────────────────────────────────── */

async function init() {
  await showSession();
  const pr = await api('/api/projects');
  showVault(pr.ok || pr.status > 0);
  projects = listOf(pr.body, 'projects', 'items').filter((p) => p && p.id && p.id !== 'firm').map((p) => ({ id: p.id, name: p.name || p.title || p.id }));
  projects.sort((a, b) => a.name.localeCompare(b.name));
  await Promise.all([renderFiling(), renderLessons(), renderReview()]);
  document.body.setAttribute('data-ready', '1');
}
init();
