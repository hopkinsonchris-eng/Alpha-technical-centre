/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB PROJECT PAGE (M07)
   hub/project.html?id=<project>[&run=<run id>]

   Header (client, legal tag and expiry, contacts, assets, status), then the
   tabs Timeline, Headline numbers, Lineage, Basis notes, Lessons in scope and
   Scorecard. Reads the Vault API only; nothing here writes.

     GET /api/projects/:id               the project
     GET /api/projects/:id/timeline      runs and documents, newest first, stale flags
     GET /api/projects/:id/vintages      final runs with headline outputs and deltas
     GET /api/projects/:id/lineage       nodes and edges
     GET /api/items?project=&type=note   basis notes (extracted.kind)
     GET /api/runs?project=              assumptions for scorecard rule 2
     GET /api/organisations/:id[/file]   client name, contacts, NDA expiry, dispatches
     GET /api/lessons?scope=project:<id> hidden on 404 / 501
     GET /api/projects/:id/assets        wave 3: the fields attached, with their dossiers
     GET /api/assets/locate              wave 3: candidates for a field name (Vault, GEM, GeoNames, Wikidata)
     POST/DELETE /api/projects/:id/assets  wave 3: attach (filing the dossier) and detach
     GET /api/queue/review?kind=asset    wave 3: fields named in documents, proposed for this project
     POST /api/queue/review/:id/accept|reject  wave 3: attach the proposal (with a chosen candidate or by name) or dismiss it
   Every string a person reads carries data-en and data-es.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, loadCatalog, fmtShortDate, num, RUN_STATUS, STAGES, STAGE_ES, RISK_LABEL, loadGeo, openTarget, sourceWord } from './hub.js';
import './components/stale-badge.js';
import { firstReason } from './components/stale-badge.js';
import { iconKind } from './components/timeline-list.js';
import { renderRecord, detailsNode } from './record.js';
import './components/timeline-list.js';
import { annotate, fmtPct } from './components/vintage-table.js';
import './components/vintage-table.js';
import './components/lineage-graph.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const DAY = 864e5;
const params = new URLSearchParams(location.search);
const projectId = params.get('id');

const svgIcon = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const LOCK = svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const CHECK = svgIcon('<path d="M5 12l5 5 9-10"/>');
const CROSS = svgIcon('<path d="M6 6l12 12M18 6L6 18"/>');
const DASH = svgIcon('<path d="M6 12h12"/>');

const bi = (en, es) => ({ en, es: es === undefined ? en : es });
const errMessage = (res) => (res && res.body && res.body.error && res.body.error.message) || '';

/* ── notices and failure states ──────────────────────────────────────── */

function notice(kind, boldEn, boldEs, en, es) {
  const n = mk('div', 'hub-notice ' + kind);
  add(n, add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
  return n;
}

function failPage(res) {
  const st = res ? res.status : 0;
  let t, s, en, es;
  if (!projectId) { t = bi('No project selected', 'Ningún proyecto seleccionado'); en = 'Open a project from Today, or add ?id=<project> to the address.'; es = 'Abra un proyecto desde Hoy, o añada ?id=<proyecto> a la dirección.'; }
  else if (st === 404) { t = bi('Project not found', 'Proyecto no encontrado'); en = 'There is no project "' + projectId + '" in the Vault.'; es = 'No existe el proyecto "' + projectId + '" en el Vault.'; }
  else if (st === 403) { t = bi('No access to this project', 'Sin acceso a este proyecto'); en = 'You are not a member of this project or its legal tag is outside your scope.'; es = 'No es miembro de este proyecto o su etiqueta legal está fuera de su alcance.'; }
  else { t = bi('The Vault is unreachable', 'El Vault no es accesible'); en = 'The project could not be loaded' + (errMessage(res) ? ': ' + errMessage(res) : '.'); es = 'No se pudo cargar el proyecto' + (errMessage(res) ? ': ' + errMessage(res) : '.'); showVault(false); }
  setText($('#p-title'), t.en, t.es);
  add($('#notices'), notice('bad', t.en + '.', t.es + '.', en, es));
  document.body.setAttribute('data-ready', '1');
}

/* ── header ──────────────────────────────────────────────────────────── */

const STATUS_PILL = { active: ['Active', 'Activo', 'ok'], prospect: ['Prospect', 'Prospecto', 'info'], closed: ['Closed', 'Cerrado', 'muted'], archived: ['Archived', 'Archivado', 'muted'] };

/** The legal tag's expiry: from a tag object on the project if the API ever adds one, else the NDA in force on the client's file. */
export function tagExpiry(project, orgFile) {
  const t = project.legal_tag && typeof project.legal_tag === 'object' ? project.legal_tag : null;
  if (t && t.expires_at) return { date: String(t.expires_at).slice(0, 10), ref: t.contract_id || '' };
  const cs = ((orgFile && orgFile.contracts_in_force) || []).filter((c) => c && c.expiry);
  const exact = cs.filter((c) => c.legal_tag === project.default_legal_tag);
  const pool = exact.length ? exact : cs.filter((c) => c.type === 'nda');
  pool.sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  return pool.length ? { date: String(pool[0].expiry).slice(0, 10), ref: pool[0].reference_no || pool[0].title || '' } : null;
}
const daysLeft = (date, now) => Math.floor((Date.parse(date + 'T23:59:59Z') - now) / DAY);

function renderHeader(ctx) {
  const { project: p, org, orgFile, now } = ctx;
  setText($('#p-title'), p.name);
  document.title = p.name + ' — Project file — Alpha Technical Centre';
  const sub = $('#p-sub');
  sub.textContent = '';
  const clientName = (org && org.name) || p.client_id;
  add(sub, mk('span', null, 'Client', 'Cliente'), document.createTextNode(' '),
    clientName ? dv('b', null, clientName, { 'data-client': p.client_id || '' }) : mk('b', null, 'Internal (no client)', 'Interno (sin cliente)'));
  const opened = p.created_at ? fmtShortDate(p.created_at) : null;
  if (opened) add(sub, document.createTextNode(' · '), mk('span', null, 'opened', 'abierto'), document.createTextNode(' '), mk('span', null, opened.en, opened.es));
  const sp = STATUS_PILL[p.status] || [p.status, p.status, 'muted'];
  add(sub, document.createTextNode(' · '), mk('span', null, 'status', 'estado'), document.createTextNode(' '), mk('span', 'hub-pill ' + sp[2], sp[0], sp[1], { 'data-status': p.status }));
  // Wave 2: where it is and what stage it is at; the stage changes in place (PATCH /api/projects/:id).
  const cn = p.country && ctx.names && ctx.names.get(p.country);
  if (p.country) add(sub, document.createTextNode(' · '), cn ? mk('b', null, cn.en, cn.es, { 'data-country': p.country }) : dv('b', null, p.country, { 'data-country': p.country }));
  const stageCtl = mk('span', 'hub-stage-ctl');
  const sel = mk('select', null, null, null, { id: 'p-stage', 'aria-label': 'Stage' });
  for (const st of STAGES) add(sel, mk('option', null, st, STAGE_ES[st] || st, { value: st }));
  sel.value = p.stage || 'Initial screen';
  add(stageCtl, mk('label', null, 'stage', 'etapa', { for: 'p-stage' }), sel);
  add(sub, document.createTextNode(' · '), stageCtl);
  sel.addEventListener('change', () => changeStage(ctx, sel));

  const card = $('#p-file');
  card.textContent = '';

  // Legal tag, expiry, assets.
  const dl = mk('dl', 'hub-kv');
  const tagDd = mk('dd');
  const lt = mk('span', 'hub-lt', null, null, { 'data-legal-tag': p.default_legal_tag });
  lt.insertAdjacentHTML('afterbegin', LOCK);
  add(lt, dv('span', null, p.default_legal_tag));
  add(tagDd, lt);
  const exp = tagExpiry(p, orgFile);
  const note = mk('div', 'hub-note-s', null, null, { 'data-expiry': exp ? exp.date : '' });
  if (exp) {
    const d = daysLeft(exp.date, now);
    add(note, mk('span', null, 'expires', 'vence'), document.createTextNode(' '), dv('b', null, exp.date),
      document.createTextNode(' ('), mk('span', null, d + ' days', d + ' días'), document.createTextNode(')'));
    if (exp.ref) add(note, document.createTextNode(' · '), dv('span', null, exp.ref));
  } else add(note, mk('span', null, 'expiry not available from the API', 'vencimiento no disponible en la API'));
  add(tagDd, note);
  add(dl, mk('dt', null, 'Legal tag', 'Etiqueta legal'), tagDd);
  const assets = mk('dd', 'chips');
  const fieldName = (id) => { const f = (ctx.fields || []).find((x) => x.id === id); return f ? f.name : id; };
  if ((p.asset_ids || []).length) for (const a of p.asset_ids) add(assets, dv('span', 'hub-asset', fieldName(a), { 'data-asset': a }));
  else add(assets, mk('span', 'hub-muted', 'None recorded', 'Ninguno registrado'));
  add(dl, mk('dt', null, 'Assets', 'Activos'), assets);
  add(dl, mk('dt', null, 'Default tag', 'Etiqueta por defecto'), mk('dd', null, 'inherited by every run and document', 'heredada por cada ejecución y documento'));
  add(card, dl);

  // Client contacts.
  const cwrap = mk('div', 'hub-people');
  add(cwrap, mk('span', 'label', 'Client contacts', 'Contactos del cliente'));
  const ids = new Set(p.contacts || []);
  const contacts = ((org && org.contacts) || []).filter((c) => ids.has(c.id));
  if (contacts.length) {
    for (const c of contacts) {
      const d = mk('div', null, null, null, { 'data-contact': c.id });
      add(d, dv('b', null, c.name), document.createTextNode(' '), c.role ? dv('span', 'hub-muted', '· ' + c.role) : null);
      const bits = [(c.emails || [])[0], c.language ? String(c.language).toUpperCase() : ''].filter(Boolean).join(' · ');
      if (bits) add(d, dv('div', 'hub-note-s', bits));
      add(cwrap, d);
    }
  } else if (ids.size) {
    for (const id of ids) add(cwrap, dv('span', 'hub-asset', id));
  } else add(cwrap, mk('span', 'hub-muted', 'None recorded', 'Ninguno registrado'));
  add(card, cwrap);

  // ATC team.
  const twrap = mk('div', 'hub-people');
  add(twrap, mk('span', 'label', 'ATC team', 'Equipo ATC'));
  if ((p.members || []).length) for (const m of p.members) add(twrap, dv('div', null, m, { 'data-member': m }));
  else add(twrap, mk('span', 'hub-muted', 'Open to every partner and associate with access', 'Abierto a todos los socios y asociados con acceso'));
  add(card, twrap);
}

/* ── wave 2: stage, toolbar, opportunity card ────────────────────────── */

const pnotices = () => $('#p-notices');
const stageEntries = (p) => {
  const hist = Array.isArray(p.stage_history) ? p.stage_history : [];
  return hist.map((h, i) => ({ kind: 'stage', id: 'stage-' + i, ref: 'stage:' + i, at: h.at, title: h.stage, from: i ? hist[i - 1].stage : null, by: h.by, stale: false }));
};
function refreshTimeline(ctx) {
  const tl = $('#tl');
  if (tl && ctx.entries) tl.entries = [...ctx.entries, ...stageEntries(ctx.project)];
}

async function changeStage(ctx, sel) {
  const p = ctx.project, was = p.stage;
  const notices = pnotices(); notices.textContent = '';
  sel.disabled = true;
  const res = await api('/api/projects/' + encodeURIComponent(p.id), { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ stage: sel.value }) });
  sel.disabled = false;
  if (res.ok && res.body) {
    Object.assign(p, res.body);
    sel.value = p.stage;
    add(notices, notice('ok', 'Stage is now ' + p.stage + '.', 'La etapa ahora es ' + (STAGE_ES[p.stage] || p.stage) + '.', 'Recorded on the timeline.', 'Registrado en la cronología.'));
    refreshTimeline(ctx);
  } else {
    sel.value = was;
    const msg = errMessage(res);
    if (res.status === 0) add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The stage was not changed.', 'No se cambió la etapa.'));
    else add(notices, notice('bad', 'The stage was not changed.', 'No se cambió la etapa.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
  }
}

/** The production tools whose sidecar accepts a project, in toolbar order, each opening inside this project. */
function renderToolbar(ctx, cat) {
  const host = $('#p-toolbar');
  host.textContent = '';
  add(host, mk('span', 'label', 'Tools', 'Herramientas'));
  if (!cat || !cat.catalog) { add(host, mk('span', 'hub-muted', 'The tool catalog is not available.', 'El catálogo de herramientas no está disponible.')); return; }
  const tools = cat.catalog.tools || [];
  const byId = new Map(tools.map((t) => [t.id, t]));
  const siteRoot = new URL('../', location.href);
  const list = tools.filter((t) => t.lifecycle === 'production' && t.hub && (t.hub.context || []).includes('project')).sort((a, b) => (a.hub.toolbar ?? 999) - (b.hub.toolbar ?? 999));
  for (const t of list) {
    const target = openTarget(t, byId, siteRoot);
    const u = new URL(target.href);
    u.searchParams.set(t.hub.param || 'project', ctx.project.id);
    const a = mk('a', null, null, null, { href: u.href, 'data-toolbar-tool': t.id });
    a.insertAdjacentHTML('afterbegin', svgIcon('<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'));
    add(a, dv('span', null, t.name));
    if (target.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    add(host, a);
  }
  add(host, list.length ? mk('span', 'hub-muted', 'open in this project', 'se abren en este proyecto') : mk('span', 'hub-muted', 'No tool declares a project context yet.', 'Ninguna herramienta declara aún un contexto de proyecto.'));
}

const RISK_OPTS = [['', 'Not assessed', 'Sin evaluar'], ['green', 'Managed', 'Gestionado'], ['amber', 'Elevated', 'Elevado'], ['red', 'High', 'Alto']];
const numOrNull = (el) => (el && el.value.trim() !== '' ? Number(el.value) : null);

/** The opportunity card: the register fields and where it is, editable in place. */
function renderOpportunity(ctx) {
  const host = $('#p-opportunity');
  host.textContent = '';
  const p = ctx.project, reg = p.register || {};
  const head = mk('div', 'hub-card-head');
  add(head, add(mk('div'), mk('h3', null, 'Opportunity', 'Oportunidad', { id: 'h-opp' }), mk('span', 'hub-muted', 'The register fields: who brought it, what it produces, what Alpha thinks and what comes next.', 'Los campos del registro: quién la trajo, qué produce, qué piensa Alpha y qué sigue.')));
  const edit = mk('button', 'btn btn-outline btn-sm', 'Edit', 'Editar', { type: 'button', 'aria-expanded': 'false' });
  add(head, edit);
  add(host, head);
  const grid = mk('div', 'hub-opp-grid');
  const field = (key, en, es, node, cls) => add(grid, add(mk('div', cls || ''), mk('span', 'k', en, es), add(mk('span', 'v' + (cls === 'big' ? ' big' : ''), null, null, { 'data-opp': key }), node)));
  const cn = p.country && ctx.names && ctx.names.get(p.country);
  const where = p.country ? (cn ? cn.en : p.country) + (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? ' · ' + p.lat + ', ' + p.lon : '') : null;
  const whereEs = p.country ? (cn ? cn.es : p.country) + (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? ' · ' + p.lat + ', ' + p.lon : '') : null;
  field('where', 'Where', 'Dónde', where ? mk('span', null, where, whereEs) : mk('span', 'hub-muted', 'not placed yet', 'sin ubicar todavía'));
  field('source', 'Source', 'Origen', reg.source ? dv('span', null, reg.source) : mk('span', 'hub-muted', '—', '—'));
  const hasProd = typeof reg.current === 'number' || typeof reg.plan === 'number';
  field('plan', 'Fact → plan', 'Hecho → plan', hasProd ? dv('span', null, (reg.current ?? '—') + ' → ' + (reg.plan ?? '—') + ' kboe/d') : mk('span', 'hub-muted', '—', '—'), 'big');
  const risk = mk('span');
  if (reg.risk) { const rl = RISK_LABEL[reg.risk] || [reg.risk, reg.risk]; add(risk, mk('span', 'hub-rag', null, null, { 'data-risk': reg.risk, 'aria-hidden': 'true' }), mk('span', null, rl[0] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''), rl[1] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''))); }
  else add(risk, mk('span', 'hub-muted', 'not assessed', 'sin evaluar'));
  field('risk', 'Execution risk', 'Riesgo de ejecución', risk);
  field('owner', 'Owner', 'Responsable', reg.owner ? dv('span', null, reg.owner) : mk('span', 'hub-muted', '—', '—'));
  field('thesis', 'Thesis', 'Tesis', reg.thesis ? dv('span', null, reg.thesis) : mk('span', 'hub-muted', 'none yet', 'ninguna todavía'), 'hub-opp-text');
  field('next', 'Next step', 'Siguiente paso', reg.next ? dv('span', null, reg.next) : mk('span', 'hub-muted', 'none yet', 'ninguno todavía'), 'hub-opp-text');
  add(host, grid);

  // The edit form, hidden until asked for; posts country, coordinates and the merged register.
  const form = mk('form', null, null, null, { novalidate: '', hidden: '' });
  const fg = mk('div', 'hub-form-grid');
  const fld = (id, en, es, input) => add(fg, add(mk('div', 'hub-field'), mk('label', null, en, es, { for: id }), input));
  const country = mk('select', null, null, null, { id: 'op-country' });
  add(country, mk('option', null, 'Not placed yet', 'Sin ubicar todavía', { value: '' }));
  if (ctx.names) for (const [code, n] of [...ctx.names.entries()].sort((a, b) => a[1].en.localeCompare(b[1].en))) add(country, mk('option', null, n.en, n.es, { value: code }));
  country.value = p.country || '';
  fld('op-country', 'Country', 'País', country);
  const inp = (id, type, value, extra) => mk('input', null, null, null, { id, type, autocomplete: 'off', value: value == null ? '' : String(value), ...(extra || {}) });
  fld('op-lat', 'Latitude', 'Latitud', inp('op-lat', 'number', p.lat, { min: '-90', max: '90', step: '0.01', inputmode: 'decimal' }));
  fld('op-lon', 'Longitude', 'Longitud', inp('op-lon', 'number', p.lon, { min: '-180', max: '180', step: '0.01', inputmode: 'decimal' }));
  fld('op-source', 'Source', 'Origen', inp('op-source', 'text', reg.source));
  fld('op-owner', 'Owner', 'Responsable', inp('op-owner', 'text', reg.owner));
  fld('op-current', 'Fact today, kboe/d', 'Hecho hoy, kboe/d', inp('op-current', 'number', reg.current, { min: '0', step: '0.1', inputmode: 'decimal' }));
  fld('op-plan', "Operator's plan, kboe/d", 'Plan del operador, kboe/d', inp('op-plan', 'number', reg.plan, { min: '0', step: '0.1', inputmode: 'decimal' }));
  const riskSel = mk('select', null, null, null, { id: 'op-risk' });
  for (const [v, en, es] of RISK_OPTS) add(riskSel, mk('option', null, en, es, { value: v }));
  riskSel.value = reg.risk || '';
  fld('op-risk', 'Execution risk', 'Riesgo de ejecución', riskSel);
  fld('op-risk-score', 'Risk score (0–100)', 'Puntuación de riesgo (0–100)', inp('op-risk-score', 'number', reg.risk_score, { min: '0', max: '100', step: '1' }));
  const thesis = mk('textarea', null, null, null, { id: 'op-thesis' }); thesis.value = reg.thesis || '';
  const next = mk('textarea', null, null, null, { id: 'op-next' }); next.value = reg.next || '';
  const wide = (id, en, es, ta) => add(fg, add(mk('div', 'hub-field hub-opp-text'), mk('label', null, en, es, { for: id }), ta));
  wide('op-thesis', 'Thesis', 'Tesis', thesis);
  wide('op-next', 'Next step', 'Siguiente paso', next);
  add(form, fg);
  const fn = mk('div', null, null, null, { id: 'op-notices', role: 'status' });
  const actions = mk('div', 'hub-actions');
  const save = mk('button', 'btn btn-primary btn-sm', 'Save', 'Guardar', { type: 'submit' });
  const cancel = mk('button', 'btn btn-outline btn-sm', 'Cancel', 'Cancelar', { type: 'button' });
  add(actions, save, cancel);
  add(form, fn, actions);
  add(host, form);
  const close = () => { form.setAttribute('hidden', ''); edit.setAttribute('aria-expanded', 'false'); edit.focus(); };
  edit.addEventListener('click', () => { if (form.hasAttribute('hidden')) { form.removeAttribute('hidden'); edit.setAttribute('aria-expanded', 'true'); country.focus(); } else close(); });
  cancel.addEventListener('click', close);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fn.textContent = '';
    const register = { ...reg };
    const setOrDrop = (k, v) => { if (v === null || v === '' || v === undefined) delete register[k]; else register[k] = v; };
    setOrDrop('source', $('#op-source').value.trim());
    setOrDrop('owner', $('#op-owner').value.trim());
    setOrDrop('current', numOrNull($('#op-current')));
    setOrDrop('plan', numOrNull($('#op-plan')));
    setOrDrop('risk', riskSel.value);
    setOrDrop('risk_score', numOrNull($('#op-risk-score')));
    setOrDrop('thesis', thesis.value.trim());
    setOrDrop('next', next.value.trim());
    const body = { country: country.value || null, lat: numOrNull($('#op-lat')), lon: numOrNull($('#op-lon')), register };
    save.disabled = true;
    const res = await api('/api/projects/' + encodeURIComponent(p.id), { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    save.disabled = false;
    if (res.ok && res.body) {
      // The API answers with the merged register; a cleared field stays until a reload, so keep the client's view authoritative for what it just sent.
      Object.assign(p, res.body, { register });
      renderHeader(ctx); renderOpportunity(ctx);
      return;
    }
    const msg = errMessage(res);
    add(fn, notice('bad', 'Not saved.', 'No se guardó.', msg || (res.status ? 'HTTP ' + res.status : 'The Vault is unreachable.'), msg || (res.status ? 'HTTP ' + res.status : 'El Vault no es accesible.')));
  });
}

/* ── wave 3: the Fields card ─────────────────────────────────────────── */

const KIND_WORD = { field: ['field', 'campo'], block: ['block', 'bloque'], basin: ['basin', 'cuenca'], well: ['well', 'pozo'] };
const kindWord = (k) => { const w = KIND_WORD[k] || [k, k]; return mk('span', 'hub-kind', w[0], w[1], { 'data-kind': k }); };
const coordText = (o) => (Number.isFinite(o.lat) && Number.isFinite(o.lon) ? o.lat + ', ' + o.lon : null);
const srcPill = (src) => { const w = sourceWord(src); return mk('span', 'hub-pill ghost hub-src', w.en, w.es, { 'data-source': src || '' }); };

/** What a field row says after its name: kind, basin, coordinates, source and release, status and operator. */
function fieldFacts(f) {
  const facts = mk('div', 'hub-note-s');
  add(facts, kindWord(f.kind));
  const gem = f.props && f.props.gem;
  const c = coordText(f);
  if (c) add(facts, document.createTextNode(' · '), dv('span', 'mono', c, { 'data-coords': c }));
  else add(facts, document.createTextNode(' · '), mk('span', null, 'no location yet', 'sin ubicación todavía'));
  add(facts, document.createTextNode(' · '), srcPill(f.location_source));
  if (gem && gem.release) add(facts, dv('span', 'hub-muted', ' ' + gem.release));
  const bits = [];
  if (f.status) bits.push(f.status);
  if (f.operator) bits.push(f.operator);
  if (bits.length) add(facts, document.createTextNode(' · '), dv('span', null, bits.join(', ')));
  return facts;
}

/** A candidate from GET /api/assets/locate as a row with an Attach button. */
function candidateRow(ctx, c, onAttach) {
  const li = mk('li', 'hub-candidate', null, null, { 'data-candidate': c.source + ':' + c.source_id });
  const main = mk('div');
  add(main, dv('b', null, c.name), document.createTextNode(' '), kindWord(c.kind));
  if (c.country) add(main, document.createTextNode(' · '), dv('span', null, c.country));
  const meta = mk('div', 'hub-note-s');
  const cc = coordText(c);
  if (cc) add(meta, dv('span', 'mono', cc)); else add(meta, mk('span', null, 'no coordinates on this record', 'sin coordenadas en este registro'));
  add(meta, document.createTextNode(' · '), srcPill(c.source));
  if (c.asset_id) add(meta, document.createTextNode(' · '), mk('span', null, 'already in the Vault', 'ya en el Vault'));
  if (c.detail && c.detail.operator) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.operator));
  if (c.detail && c.detail.status) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.status));
  if (c.source_url) add(meta, document.createTextNode(' · '), dv('a', 'hub-inline-link', 'record', { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }));
  add(main, meta);
  const btn = mk('button', 'btn btn-primary btn-sm', 'Attach', 'Adjuntar', { type: 'button', 'data-attach': c.source + ':' + c.source_id });
  btn.addEventListener('click', () => onAttach(c, btn));
  add(li, main, btn);
  return li;
}

/** The body posted to attach a candidate: the existing asset by id, or a new one carrying its source. */
export function attachBody(c, projectCountry) {
  if (c.asset_id) return { asset_id: c.asset_id };
  const create = { name: c.name, kind: c.kind || 'field' };
  if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) { create.lat = c.lat; create.lon = c.lon; create.location_source = c.source; }
  if (c.source_id) create.source_id = c.source_id;
  if (c.source_url) create.source_url = c.source_url;
  if (c.detail) create.detail = c.detail;
  if (c.country || projectCountry) create.country = c.country || projectCountry;
  return create.name ? { create } : null;
}

/**
 * The Fields card: the fields attached to the project with their source and coordinates,
 * a dossier button per gazetteer record, detach, and Add field (search → candidates → attach).
 * Writes go to POST/DELETE /api/projects/:id/assets; a refusal is shown in the card.
 */
async function renderFields(ctx) {
  const host = $('#p-fields');
  if (!host) return;
  const p = ctx.project;
  host.textContent = '';
  const head = mk('div', 'hub-card-head');
  add(head, add(mk('div'), mk('h3', null, 'Fields', 'Campos', { id: 'h-fields' }),
    mk('span', 'hub-muted', 'The fields, blocks and basins this project is about, each located from a named source. Attaching one files its public dossier into the project.', 'Los campos, bloques y cuencas de este proyecto, cada uno ubicado desde una fuente nombrada. Adjuntar uno archiva su dosier público en el proyecto.')));
  const addBtn = mk('button', 'btn btn-outline btn-sm', 'Add field', 'Añadir campo', { type: 'button', id: 'fld-add-btn', 'aria-expanded': 'false', 'aria-controls': 'fld-add' });
  add(head, addBtn);
  add(host, head);
  const notices = mk('div', null, null, null, { id: 'fld-notices', role: 'status' });
  add(host, notices);
  const list = mk('ul', 'hub-fields-list', null, null, { id: 'fld-list' });
  add(host, list);

  const res = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets');
  ctx.fields = res.ok ? listOf(res.body, 'assets') : [];
  if (!res.ok) add(notices, notice('warn', 'The fields could not be loaded.', 'No se pudieron cargar los campos.', res.status ? 'HTTP ' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') : 'The Vault is unreachable.', res.status ? 'HTTP ' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') : 'El Vault no es accesible.'));

  const paint = () => {
    list.textContent = '';
    if (!ctx.fields.length) { add(list, mk('li', 'hub-empty', 'No fields attached yet. Add field searches the Vault, Global Energy Monitor, GeoNames and Wikidata.', 'Aún no hay campos adjuntos. Añadir campo busca en el Vault, Global Energy Monitor, GeoNames y Wikidata.')); return; }
    for (const f of ctx.fields) {
      const li = mk('li', 'hub-field-row', null, null, { 'data-field': f.id });
      const main = mk('div');
      add(main, mk('span', 'dot', null, null, { 'aria-hidden': 'true' }), dv('b', null, f.name), fieldFacts(f));
      const actions = mk('div', 'hub-actions-row');
      const dossier = Array.isArray(f.dossier) ? f.dossier : [];
      if (dossier.length) {
        const b = mk('button', 'btn btn-outline btn-sm', dossier.length === 1 ? 'Dossier' : 'Dossier (' + dossier.length + ')', dossier.length === 1 ? 'Dosier' : 'Dosier (' + dossier.length + ')', { type: 'button', 'data-dossier': f.id });
        b.addEventListener('click', () => openRecord({ ref: 'doc:' + dossier[0], title: 'Field dossier: ' + f.name, trigger: b }));
        add(actions, b);
      } else add(actions, mk('span', 'hub-muted', 'no dossier', 'sin dosier'));
      const det = mk('button', 'btn btn-outline btn-sm', 'Detach', 'Desvincular', { type: 'button', 'data-detach': f.id });
      det.addEventListener('click', async () => {
        notices.textContent = ''; det.disabled = true;
        const r = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets/' + encodeURIComponent(f.id), { method: 'DELETE', headers: { accept: 'application/json' } });
        det.disabled = false;
        if (r.ok) {
          ctx.fields = ctx.fields.filter((x) => x.id !== f.id);
          p.asset_ids = (p.asset_ids || []).filter((x) => x !== f.id);
          add(notices, notice('ok', f.name + ' detached.', f.name + ' desvinculado.', 'Its dossier records stay in the project.', 'Sus registros de dosier permanecen en el proyecto.'));
          paint(); renderHeader(ctx);
        } else add(notices, notice('bad', 'Not detached.', 'No se desvinculó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
      });
      add(actions, det);
      add(li, main, actions);
      add(list, li);
    }
  };
  paint();

  // Proposed from documents: the fields that ingest found named in this project's documents (review queue, kind asset).
  const proposed = mk('div', 'hub-proposed', null, null, { id: 'fld-proposed', hidden: '' });
  add(host, proposed);
  const paintProposals = async () => {
    const r = await api('/api/queue/review?kind=asset');
    const rows = r.ok ? listOf(r.body, 'items').filter((q) => q && q.kind === 'asset' && q.payload && q.payload.project_id === p.id) : [];
    proposed.textContent = '';
    if (!rows.length) { proposed.setAttribute('hidden', ''); return; }
    proposed.removeAttribute('hidden');
    add(proposed, mk('span', 'label', 'Proposed from documents', 'Propuestos desde documentos'),
      mk('span', 'hub-muted', ' · ' + rows.length + (rows.length === 1 ? ' field named in a document, waiting for a decision' : ' fields named in documents, waiting for a decision'), ' · ' + rows.length + (rows.length === 1 ? ' campo nombrado en un documento, a la espera de una decisión' : ' campos nombrados en documentos, a la espera de una decisión')));
    const ul = mk('ul', 'hub-proposals');
    for (const q of rows) add(ul, proposalRow(q));
    add(proposed, ul);
  };
  const decide = async (q, body, btn, row) => {
    notices.textContent = '';
    if (btn) btn.disabled = true;
    const verb = body === null ? 'reject' : 'accept';
    const r = await api('/api/queue/review/' + encodeURIComponent(q.id) + '/' + verb, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (btn) btn.disabled = false;
    if (!r.ok) {
      if (r.status === 409) { row.remove(); add(notices, notice('warn', 'Already decided.', 'Ya decidido.', 'Someone else resolved this proposal.', 'Otra persona resolvió esta propuesta.')); return; }
      add(notices, notice('bad', verb === 'accept' ? 'Not attached.' : 'Not dismissed.', verb === 'accept' ? 'No se adjuntó.' : 'No se descartó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
      return;
    }
    row.remove();
    if (!proposed.querySelector('li[data-proposal]')) proposed.setAttribute('hidden', '');
    if (verb === 'reject') { add(notices, notice('ok', q.payload.name + ' is not a field of this project.', q.payload.name + ' no es un campo de este proyecto.', 'The proposal is closed.', 'La propuesta queda cerrada.')); return; }
    const a = r.body && r.body.asset;
    const filed = Array.isArray(r.body && r.body.dossier) ? r.body.dossier : [];
    if (a) {
      const i = ctx.fields.findIndex((x) => x.id === a.id);
      const rowData = { ...a, dossier: i >= 0 ? [...(ctx.fields[i].dossier || []), ...filed] : filed };
      if (i >= 0) ctx.fields[i] = rowData; else ctx.fields.push(rowData);
      if (!(p.asset_ids || []).includes(a.id)) p.asset_ids = [...(p.asset_ids || []), a.id];
      paint(); renderHeader(ctx);
      add(notices, notice('ok', a.name + ' attached.', a.name + ' adjuntado.',
        filed.length ? filed.length + (filed.length === 1 ? ' dossier record filed from ' : ' dossier records filed from ') + sourceWord(a.location_source).en + '.' : (a.lat == null ? 'Attached by name, without a location.' : 'No gazetteer record to file: no dossier.'),
        filed.length ? filed.length + (filed.length === 1 ? ' registro de dosier archivado desde ' : ' registros de dosier archivados desde ') + sourceWord(a.location_source).es + '.' : (a.lat == null ? 'Adjuntado por nombre, sin ubicación.' : 'Sin registro de gacetero que archivar: sin dosier.')));
    }
  };
  const proposalRow = (q) => {
    const pl = q.payload || {};
    const li = mk('li', 'hub-proposal', null, null, { 'data-proposal': q.id });
    const head = mk('div', 'hub-proposal-head');
    add(head, dv('b', null, pl.name), document.createTextNode(' '), kindWord(pl.kind || 'field'));
    if (pl.source === 'model') add(head, document.createTextNode(' · '), mk('span', 'hub-muted', 'found by the assistant', 'hallado por el asistente'));
    const where = [pl.item_title, pl.anchor].filter(Boolean).join(', ');
    if (pl.quote) add(head, dv('blockquote', 'hub-proposal-quote', '“' + pl.quote + '”' + (where ? ' (' + where + ')' : ''), { 'data-quote': '' }));
    add(li, head);
    const cands = Array.isArray(pl.candidates) ? pl.candidates : [];
    const ul = mk('ul', 'hub-candidates');
    for (const c of cands) {
      const row = mk('li', 'hub-candidate', null, null, { 'data-candidate': c.source + ':' + c.source_id });
      const main = mk('div');
      add(main, mk('span', null, pl.name + ' → ', pl.name + ' → '), dv('b', null, c.name));
      const meta = mk('div', 'hub-note-s');
      const cc = coordText(c);
      if (cc) add(meta, dv('span', 'mono', cc)); else add(meta, mk('span', null, 'no coordinates on this record', 'sin coordenadas en este registro'));
      add(meta, document.createTextNode(' · '), srcPill(c.source));
      if (c.detail && c.detail.status) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.status));
      if (c.detail && c.detail.operator) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.operator));
      add(main, meta);
      const b = mk('button', 'btn btn-primary btn-sm', 'Attach', 'Adjuntar', { type: 'button', 'data-attach': c.source + ':' + c.source_id });
      b.addEventListener('click', () => decide(q, attachBody(c, p.country || null), b, li));
      add(row, main, b);
      add(ul, row);
    }
    if (!cands.length) add(ul, add(mk('li', 'hub-candidate'), mk('span', 'hub-muted', 'No gazetteer match: the Vault, Global Energy Monitor, GeoNames and Wikidata know no record by this name here.', 'Sin coincidencia en gaceteros: el Vault, Global Energy Monitor, GeoNames y Wikidata no conocen ningún registro con este nombre aquí.')));
    add(li, ul);
    const actions = mk('div', 'hub-actions-row');
    const bare = mk('button', 'btn btn-outline btn-sm', 'Attach without a location', 'Adjuntar sin ubicación', { type: 'button', 'data-attach-bare': '' });
    bare.addEventListener('click', () => decide(q, {}, bare, li));
    const no = mk('button', 'btn btn-outline btn-sm', 'Not a field', 'No es un campo', { type: 'button', 'data-reject': '' });
    no.addEventListener('click', () => decide(q, null, no, li));
    add(actions, bare, no);
    add(li, actions);
    return li;
  };
  await paintProposals();
  host.refreshProposals = paintProposals;

  // Add field: a search box over the gazetteers, candidates with a source pill each, Attach.
  const form = mk('form', 'hub-fld-add', null, null, { id: 'fld-add', novalidate: '', hidden: '' });
  const row = mk('div', 'hub-fld-search');
  const q = mk('input', null, null, null, { id: 'fld-q', type: 'search', autocomplete: 'off', placeholder: 'Field, block or basin name', 'data-en-ph': 'Field, block or basin name', 'data-es-ph': 'Nombre del campo, bloque o cuenca', 'aria-label': 'Field name' });
  const go = mk('button', 'btn btn-primary btn-sm', 'Search', 'Buscar', { type: 'submit' });
  add(row, mk('label', 'sr-only', 'Field name', 'Nombre del campo', { for: 'fld-q' }), q, go);
  add(form, row);
  const where = mk('p', 'hub-note-s');
  if (p.country) add(where, mk('span', null, 'Searching in ' + ((ctx.names && ctx.names.get(p.country)) || { en: p.country }).en + ': the Vault and Global Energy Monitor first, then GeoNames and Wikidata.', 'Buscando en ' + ((ctx.names && ctx.names.get(p.country)) || { es: p.country }).es + ': primero el Vault y Global Energy Monitor, luego GeoNames y Wikidata.'));
  else add(where, mk('span', null, 'The project has no country yet, so the search is worldwide.', 'El proyecto aún no tiene país, así que la búsqueda es mundial.'));
  add(form, where);
  const out = mk('div', null, null, null, { id: 'fld-results', 'aria-live': 'polite' });
  add(form, out);
  add(host, form);
  const toggle = (open) => { if (open) { form.removeAttribute('hidden'); addBtn.setAttribute('aria-expanded', 'true'); q.focus(); } else { form.setAttribute('hidden', ''); addBtn.setAttribute('aria-expanded', 'false'); } };
  addBtn.addEventListener('click', () => toggle(form.hasAttribute('hidden')));

  const attach = async (c, btn) => {
    notices.textContent = '';
    const body = attachBody(c, p.country || null);
    if (!body) return;
    if (btn) btn.disabled = true;
    const r = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (btn) btn.disabled = false;
    if (r.ok && r.body && r.body.asset) {
      const a = r.body.asset;
      const filed = Array.isArray(r.body.dossier) ? r.body.dossier : [];
      const i = ctx.fields.findIndex((x) => x.id === a.id);
      const rowData = { ...a, dossier: i >= 0 ? [...(ctx.fields[i].dossier || []), ...filed] : filed };
      if (i >= 0) ctx.fields[i] = rowData; else ctx.fields.push(rowData);
      if (!(p.asset_ids || []).includes(a.id)) p.asset_ids = [...(p.asset_ids || []), a.id];
      const n = filed.length;
      add(notices, notice('ok', (r.body.already ? a.name + ' was already attached.' : a.name + ' attached.'), (r.body.already ? a.name + ' ya estaba adjunto.' : a.name + ' adjuntado.'),
        n ? n + (n === 1 ? ' dossier record filed from ' : ' dossier records filed from ') + sourceWord(a.location_source).en + '.' : 'No gazetteer record to file: no dossier.',
        n ? n + (n === 1 ? ' registro de dosier archivado desde ' : ' registros de dosier archivados desde ') + sourceWord(a.location_source).es + '.' : 'Sin registro de gacetero que archivar: sin dosier.'));
      paint(); renderHeader(ctx); toggle(false); out.textContent = ''; q.value = '';
      return;
    }
    add(notices, notice('bad', 'Not attached.', 'No se adjuntó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = q.value.trim();
    out.textContent = '';
    if (name.length < 2) { add(out, mk('p', 'hub-muted', 'Type at least two characters.', 'Escriba al menos dos caracteres.')); return; }
    go.disabled = true;
    add(out, mk('p', 'hub-muted', 'Searching…', 'Buscando…'));
    const r = await api('/api/assets/locate?name=' + encodeURIComponent(name) + (p.country ? '&country=' + encodeURIComponent(p.country) : ''));
    go.disabled = false;
    out.textContent = '';
    if (!r.ok) { add(out, notice('bad', 'The search failed.', 'La búsqueda falló.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.'))); return; }
    const cands = listOf(r.body, 'candidates');
    const unavailable = (r.body && Array.isArray(r.body.unavailable)) ? r.body.unavailable : [];
    const ul = mk('ul', 'hub-candidates', null, null, { id: 'fld-candidates' });
    for (const c of cands) add(ul, candidateRow(ctx, c, attach));
    if (!cands.length) add(out, mk('p', 'hub-muted', 'No record named "' + name + '" in the sources that answered.', 'Ningún registro llamado "' + name + '" en las fuentes que respondieron.'));
    add(out, ul);
    if (unavailable.length) {
      const un = mk('ul', 'hub-unavailable', null, null, { id: 'fld-unavailable' });
      for (const u of unavailable) add(un, add(mk('li', null, null, null, { 'data-unavailable': u.source }), mk('span', null, sourceWord(u.source).en + ' not available: ', sourceWord(u.source).es + ' no disponible: '), dv('span', null, u.reason)));
      add(out, un);
    }
    // The name alone, without a location, is always possible: a field from a document or a client's own naming.
    const manual = mk('div', 'hub-candidate hub-candidate-manual');
    add(manual, add(mk('div'), dv('b', null, name), document.createTextNode(' '), mk('span', 'hub-note-s', 'Attach by name only; its location can come later from a document or a gazetteer.', 'Adjuntar solo por nombre; su ubicación puede llegar después desde un documento o un gacetero.')));
    const mb = mk('button', 'btn btn-outline btn-sm', 'Attach without a location', 'Adjuntar sin ubicación', { type: 'button', id: 'fld-manual' });
    mb.addEventListener('click', () => attach({ name, kind: 'field', source: 'manual', country: p.country || null }, mb));
    add(manual, mb);
    add(out, manual);
  });
}

/* ── add documents (M09 upload) ──────────────────────────────────────── */

const UP_STATUS = {
  ingested: ['Indexed', 'Indexado', 'ok'], queued: ['Queued for indexing', 'En cola para indexar', 'info'],
  unchanged: ['Already in the Vault', 'Ya está en el Vault', 'muted'], stored: ['Stored, not indexed', 'Guardado, no indexado', 'warn'],
  failed: ['Failed', 'Falló', 'bad'],
};

/**
 * Files chosen or dropped go to POST /api/ingest/upload as one multipart request with the
 * project id; the API files each one under the project's legal tag and indexes it (or queues
 * it). One row per file shows the outcome. The page is not reloaded automatically: the
 * timeline already on screen stays valid, and a button offers the refresh.
 */
function setupUpload(project) {
  const input = $('#up-files'), drop = $('#up-drop'), list = $('#up-results'), notices = $('#up-notices');
  if (!input || !drop || !list) return;
  const send = async (files) => {
    if (!files || !files.length) return;
    notices.textContent = '';
    const fd = new FormData();
    fd.append('project_id', project.id);
    for (const f of files) fd.append('files', f, f.name);
    const progress = $('#up-progress'), ptext = $('#up-progress-text');
    const n = files.length;
    setText(ptext, 'Uploading ' + n + (n === 1 ? ' file' : ' files') + '… reading and indexing can take up to a minute for a long PDF or a scan.',
      'Subiendo ' + n + (n === 1 ? ' archivo' : ' archivos') + '… leer e indexar puede tardar hasta un minuto con un PDF largo o un escaneo.');
    progress.removeAttribute('hidden');
    drop.classList.add('busy');
    const res = await api('/api/ingest/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(180000) });
    drop.classList.remove('busy');
    progress.setAttribute('hidden', '');
    input.value = '';
    if (!res.ok) {
      const msg = errMessage(res);
      if (res.status === 0) add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The files were not uploaded.', 'Los archivos no se subieron.'));
      else add(notices, notice('bad', 'The files were not uploaded.', 'Los archivos no se subieron.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
      return;
    }
    const results = listOf(res.body, 'results');
    let anyFields = false;
    for (const r of results) {
      const li = mk('li', 'hub-upload-row', null, null, { 'data-upload-file': r.filename || '' });
      const st = UP_STATUS[r.status] || [r.status || '?', r.status || '?', 'muted'];
      add(li, dv('b', null, r.filename), mk('span', 'hub-pill ' + st[2], st[0], st[1], { 'data-status': r.status || '' }));
      const meta = mk('span', 'hub-muted');
      const bits = [];
      if (r.type) bits.push(dv('span', null, r.type));
      if (r.version) bits.push(mk('span', null, 'version ' + r.version, 'versión ' + r.version));
      if (typeof r.chunks === 'number') bits.push(mk('span', null, r.chunks + ' chunks', r.chunks + ' fragmentos'));
      if (r.error) bits.push(dv('span', null, r.error));
      bits.forEach((b, i) => { if (i) add(meta, document.createTextNode(' · ')); add(meta, b); });
      add(li, meta);
      // Wave 3: fields the document names wait in the Fields card.
      if (typeof r.asset_proposals === 'number' && r.asset_proposals > 0) {
        const n = r.asset_proposals;
        add(li, add(mk('span', 'hub-upload-fields', null, null, { 'data-fields-named': String(n) }), mk('a', 'hub-inline-link', n + (n === 1 ? ' field named: review it in the Fields card' : ' fields named: review them in the Fields card'), n + (n === 1 ? ' campo nombrado: revíselo en la tarjeta Campos' : ' campos nombrados: revíselos en la tarjeta Campos'), { href: '#p-fields' })));
        anyFields = true;
      }
      add(list, li);
    }
    if (anyFields) { const host = $('#p-fields'); if (host && host.refreshProposals) host.refreshProposals(); }
    if (results.length && !$('#up-reload')) {
      const b = mk('button', 'btn btn-outline btn-sm', 'Reload the project file', 'Recargar la ficha del proyecto', { type: 'button', id: 'up-reload' });
      b.addEventListener('click', () => location.reload());
      add(list.parentElement, b);
    }
  };
  input.addEventListener('change', () => send(input.files));
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); drop.classList.remove('over'); send(ev.dataTransfer && ev.dataTransfer.files); });
}

/* ── scorecard ───────────────────────────────────────────────────────── */

const RULES = [
  ['Every headline number traces to a run', 'Cada cifra principal se remonta a una ejecución'],
  ['Every assumption carries a source and provenance', 'Cada supuesto lleva fuente y procedencia'],
  ['No stale record in a delivered set', 'Ningún registro obsoleto en un conjunto entregado'],
  ['Basis note current for the latest vintage', 'Nota de bases vigente para la última añada'],
  ['Legal tag valid with more than 90 days left', 'Etiqueta legal vigente con más de 90 días'],
  ['Every outbound letter has a dispatch and an acknowledgement', 'Toda carta saliente tiene envío y acuse de recibo'],
];
const isBasisItem = (it) => it && it.type === 'note' && (/^basis/i.test(it.title || '') || (it.extracted && it.extracted.kind === 'basis'));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** Six rules computed from what the page already loaded. A rule with no data behind it is 'na' (not yet measurable). */
export function computeScorecard(ctx) {
  const { entries, vintages, runs, orgFile, basis, lineage, project, now } = ctx;
  const out = [];
  const rule = (i, status, en, es) => out.push({ n: i + 1, en: RULES[i][0], es: RULES[i][1], status, detail: bi(en, es) });
  const runsById = new Map((runs || []).map((r) => [r.id, r]));
  const newest = vintages.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  // 1. Headline numbers trace to a run (and, when run records are loaded, a tool commit).
  if (!vintages.length) rule(0, 'na', 'No final evaluation run yet, so there is no headline number to trace.', 'Aún no hay ejecución de evaluación final, así que no hay cifra principal que rastrear.');
  else {
    const withCommit = runs && runs.length;
    const ok = vintages.filter((v) => v.run_id && v.tool_version && (!withCommit || (runsById.get(v.run_id) || {}).tool_commit)).length;
    const what = withCommit ? ['a run id and a tool commit', 'un id de ejecución y un commit de la herramienta'] : ['a run id and a tool version', 'un id de ejecución y una versión de la herramienta'];
    rule(0, ok === vintages.length ? 'pass' : 'fail', ok + ' of ' + vintages.length + ' vintages link to ' + what[0] + '.', ok + ' de ' + vintages.length + ' añadas enlazan ' + what[1] + '.');
  }

  // 2. Assumptions carry a source and provenance (needs the run records).
  if (!runs) rule(1, 'na', 'Run records could not be loaded.', 'No se pudieron cargar los registros de ejecución.');
  else {
    const all = [];
    for (const r of runs) if (r.status !== 'superseded') for (const [k, a] of Object.entries(r.assumptions || {})) all.push({ k, a });
    if (!all.length) rule(1, 'na', 'No assumptions are recorded on the active runs.', 'No hay supuestos registrados en las ejecuciones activas.');
    else {
      const ok = all.filter((x) => x.a && x.a.source && x.a.provenance).length;
      const by = {};
      for (const x of all) { const p = (x.a && x.a.provenance) || 'unsourced'; by[p] = (by[p] || 0) + 1; }
      const list = Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ');
      rule(1, ok === all.length ? 'pass' : 'fail', ok + ' of ' + all.length + ' assumptions sourced. ' + list + '.', ok + ' de ' + all.length + ' supuestos con fuente. ' + list + '.');
    }
  }

  // 3. No stale record in a delivered set: letters, basis notes and runs that were finalised or reviewed.
  const basisIds = new Set((basis || []).map((b) => b.id));
  const delivered = entries.filter((e) => e.kind === 'run' ? (e.status === 'final' || e.status === 'reviewed') : (e.type === 'letter' || e.type === 'report' || e.type === 'proposal' || basisIds.has(e.id) || (e.type === 'note' && /^basis/i.test(e.title || ''))));
  const staleDelivered = delivered.filter((e) => e.stale);
  if (!staleDelivered.length) rule(2, 'pass', 'None of the ' + delivered.length + ' delivered records is stale.', 'Ninguno de los ' + delivered.length + ' registros entregados está obsoleto.');
  else {
    const names = staleDelivered.map((e) => (e.title || e.job || e.id)).slice(0, 3).join('; ');
    rule(2, 'fail', plural(staleDelivered.length, 'delivered record is', 'delivered records are') + ' stale: ' + names + '.', plural(staleDelivered.length, 'registro entregado está', 'registros entregados están') + ' obsoleto(s): ' + names + '.');
  }

  // 4. A current basis note covers the latest vintage.
  if (!newest) rule(3, 'na', 'No final evaluation run yet.', 'Aún no hay ejecución de evaluación final.');
  else {
    const edges = (lineage && lineage.edges) || [];
    const covers = (b) => {
      const note = entries.find((e) => e.id === b.id) || b;
      if (note.stale) return false;
      const cited = edges.some((e) => e.from === 'run:' + newest.run_id && e.to === 'doc:' + b.id) || (b.cites || []).includes('run:' + newest.run_id);
      const at = b.authored_at || b.created_at || note.at || '';
      return cited || (at && at >= newest.created_at);
    };
    const notes = basis || entries.filter((e) => e.kind === 'item' && e.type === 'note' && /^basis/i.test(e.title || ''));
    const ok = notes.some(covers);
    rule(3, ok ? 'pass' : 'fail',
      ok ? 'A current basis note covers the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').' : (notes.length ? plural(notes.length, 'basis note exists', 'basis notes exist') + ', none current for the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').' : 'No basis note exists for the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').'),
      ok ? 'Una nota de bases vigente cubre la última añada (' + (newest.created_at || '').slice(0, 10) + ').' : (notes.length ? plural(notes.length, 'nota de bases existe', 'notas de bases existen') + ', ninguna vigente para la última añada (' + (newest.created_at || '').slice(0, 10) + ').' : 'No existe nota de bases para la última añada (' + (newest.created_at || '').slice(0, 10) + ').'));
  }

  // 5. Legal tag has more than 90 days left.
  const exp = tagExpiry(project, orgFile);
  if (!exp) rule(4, 'na', 'The API does not expose an expiry for ' + project.default_legal_tag + ' yet.', 'La API aún no expone un vencimiento para ' + project.default_legal_tag + '.');
  else {
    const d = daysLeft(exp.date, now);
    rule(4, d > 90 ? 'pass' : 'fail', project.default_legal_tag + ' expires ' + exp.date + ', ' + d + ' days remain.', project.default_legal_tag + ' vence el ' + exp.date + ', quedan ' + d + ' días.');
  }

  // 6. Every outbound letter has a dispatch and an acknowledgement (needs the client's file).
  if (!orgFile) rule(5, 'na', 'The client file (dispatches) is not available.', 'La ficha del cliente (envíos) no está disponible.');
  else {
    const disp = orgFile.dispatches || [];
    const inbound = new Set(disp.filter((d) => d.direction === 'in').map((d) => d.item_id));
    const letters = entries.filter((e) => e.kind === 'item' && e.type === 'letter' && !inbound.has(e.id));
    const withD = letters.filter((l) => disp.some((d) => d.item_id === l.id && d.direction === 'out'));
    const acked = letters.filter((l) => disp.some((d) => d.item_id === l.id && d.direction === 'out' && d.acknowledged_at));
    const latest = acked.map((l) => disp.filter((d) => d.item_id === l.id && d.acknowledged_at).map((d) => String(d.acknowledged_at).slice(0, 10)).sort().pop()).sort().pop();
    const ok = withD.length === letters.length && acked.length === letters.length;
    rule(5, ok ? 'pass' : 'fail',
      letters.length + ' letters, ' + withD.length + ' dispatches, ' + acked.length + ' acknowledged' + (latest ? ' (latest ' + latest + ')' : '') + '.',
      letters.length + ' cartas, ' + withD.length + ' envíos, ' + acked.length + ' con acuse' + (latest ? ' (último ' + latest + ')' : '') + '.');
  }
  return out;
}

function renderScorecard(rules) {
  const host = $('#score');
  host.textContent = '';
  const pass = rules.filter((r) => r.status === 'pass').length;
  const fail = rules.filter((r) => r.status === 'fail').length;
  const na = rules.filter((r) => r.status === 'na').length;
  const list = mk('div', 'card', null, null, { 'data-scorecard': '' });
  for (const r of rules) {
    const row = mk('div', 'hub-rule ' + r.status, null, null, { 'data-rule': String(r.n), 'data-status': r.status });
    const tick = mk('span', 'tick'); tick.setAttribute('aria-hidden', 'true');
    tick.innerHTML = r.status === 'pass' ? CHECK : r.status === 'fail' ? CROSS : DASH;
    add(row, tick, add(mk('div'), mk('h3', null, r.n + '. ' + r.en, r.n + '. ' + r.es), mk('p', null, r.detail.en, r.detail.es)));
    const pill = r.status === 'pass' ? mk('span', 'hub-pill ok', 'Pass', 'Cumple') : r.status === 'fail' ? mk('span', 'hub-pill bad', 'Fail', 'No cumple') : mk('span', 'hub-pill muted', 'Not yet measurable', 'Aún no medible');
    add(row, pill);
    add(list, row);
  }
  const sum = mk('div', 'card hub-summary');
  const rag = pass === rules.length ? 'g' : pass >= 4 ? 'a' : 'r';
  add(sum, mk('span', 'label', 'Summary', 'Resumen'));
  const big = mk('span', 'big', null, null, { 'data-pass': String(pass) });
  add(big, mk('span', 'hub-rag ' + (rag === 'a' ? '' : rag), null, null, { 'aria-hidden': 'true' }), mk('span', null, pass + '/' + rules.length + ' rules pass', pass + '/' + rules.length + ' reglas cumplen'));
  add(sum, big);
  add(sum, mk('p', 'hub-muted', 'Green: all 6. Amber: 4 or 5 of 6. Red at 3 or fewer.', 'Verde: las 6. Ámbar: 4 o 5 de 6. Rojo con 3 o menos.'));
  if (na) add(sum, mk('p', 'hub-muted', plural(na, 'rule is', 'rules are') + ' not yet measurable and counts as not passing.', plural(na, 'regla no es', 'reglas no son') + ' medible(s) todavía y no cuenta(n) como cumplida(s).'));
  add(host, list, sum);
  return { pass, fail, na, rag };
}

/* ── tabs ────────────────────────────────────────────────────────────── */

const TABS = [
  ['timeline', 'Timeline', 'Cronología'], ['vintages', 'Headline numbers', 'Cifras principales'], ['lineage', 'Lineage', 'Linaje'],
  ['basis', 'Basis notes', 'Notas de bases'], ['lessons', 'Lessons in scope', 'Lecciones en alcance'], ['scorecard', 'Scorecard', 'Ficha de evaluación'],
];
let activeTabs = [];

function buildTabs(counts, hide) {
  const bar = $('#p-tabs');
  bar.textContent = '';
  activeTabs = TABS.filter((t) => !hide.has(t[0]));
  for (const t of TABS) { const p = $('#panel-' + t[0]); if (hide.has(t[0]) && p) p.setAttribute('hidden', ''); }
  for (const [key, en, es] of activeTabs) {
    const b = mk('button', null, null, null, { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-controls': 'panel-' + key, 'aria-selected': 'false', tabindex: '-1', 'data-tab': key });
    add(b, mk('span', null, en, es));
    const c = counts[key];
    if (c !== undefined && c !== null) {
      if (typeof c === 'object') add(b, mk('span', 'n bad', c.en, c.es));
      else add(b, dv('span', 'n', String(c)));
    }
    b.addEventListener('click', () => { location.hash = key; });
    b.addEventListener('keydown', (ev) => {
      const i = activeTabs.findIndex((t) => t[0] === key);
      let j = -1;
      if (ev.key === 'ArrowRight') j = (i + 1) % activeTabs.length; else if (ev.key === 'ArrowLeft') j = (i - 1 + activeTabs.length) % activeTabs.length; else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = activeTabs.length - 1;
      if (j >= 0) { ev.preventDefault(); location.hash = activeTabs[j][0]; $('#tab-' + activeTabs[j][0]).focus(); }
    });
    add(bar, b);
  }
}

function showTab(key) {
  if (!activeTabs.some((t) => t[0] === key)) key = 'timeline';
  for (const [k, en, es] of activeTabs) {
    const on = k === key, b = $('#tab-' + k), p = $('#panel-' + k);
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
    if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    if (on) setText($('#crumb-tab'), en, es);
  }
}
const routeTab = () => {
  showTab((location.hash || '#timeline').slice(1));
  const p = $('#record-panel');
  if (p && !p.hasAttribute('hidden')) { p.setAttribute('hidden', ''); document.body.classList.remove('has-panel'); panelTrigger = null; }   // the panel belongs to the tab it was opened from
};

/* ── record panel ────────────────────────────────────────────────────── */

let panelTrigger = null;
let panelCtx = { project: null, entryById: new Map(), lineage: null };
const versionsCache = new Map();

function closePanel() {
  const p = $('#record-panel');
  p.setAttribute('hidden', '');
  const scrim = $('#record-scrim'); if (scrim) scrim.setAttribute('hidden', '');
  document.body.classList.remove('has-panel');
  for (const g of document.querySelectorAll('.ln-node.sel')) g.classList.remove('sel');
  if (panelTrigger && panelTrigger.isConnected) panelTrigger.focus();
  panelTrigger = null;
}

/**
 * Opens the side panel (a bottom sheet below 1200 px) for a record ref
 * (run:<uuid>, doc:<uuid>, ref:...): a highlights strip, related cards you can
 * pivot through, and the raw record behind a closed disclosure (hub/record.js).
 */
async function openRecord({ ref, title, node, entry, trigger }) {
  const panel = $('#record-panel'), body = $('#rp-body');
  const first = panel.hasAttribute('hidden');
  if (first) panelTrigger = trigger || document.activeElement;        // a pivot keeps the trigger that opened the panel
  const kind = ref.startsWith('run:') ? 'run' : ref.startsWith('doc:') ? 'doc' : 'ref';
  const kindLabel = { run: ['Run', 'Ejecución'], doc: ['Document', 'Documento'], ref: ['Reference set', 'Conjunto de referencia'] }[kind];
  setText($('#rp-kind'), kindLabel[0], kindLabel[1]);
  setText($('#rp-title'), title || (node && node.label) || ref);
  panel.setAttribute('data-ref', ref);
  panel.removeAttribute('hidden');
  const scrim = $('#record-scrim'); if (scrim) scrim.removeAttribute('hidden');
  document.body.classList.add('has-panel');
  body.textContent = '';
  add(body, mk('p', 'hub-muted', 'Loading the record…', 'Cargando el registro…'));
  $('#rp-title').focus();

  let rec = null, res = null;
  const uuid = ref.slice(ref.indexOf(':') + 1);
  if (kind === 'run') res = await api('/api/runs/' + encodeURIComponent(uuid));
  else if (kind === 'doc') res = await api('/api/items/' + encodeURIComponent(uuid));
  if (panel.getAttribute('data-ref') !== ref) return;         // another record was opened meanwhile
  if (res && res.ok && res.body) rec = res.body;
  if (rec && rec.title) setText($('#rp-title'), rec.title);        // the full record title beats the graph's short label
  if (!entry && panelCtx.entryById.has(uuid)) entry = panelCtx.entryById.get(uuid);

  const ctx = {
    ...panelCtx,
    versionsOf: async (id) => {
      if (!versionsCache.has(id)) {
        const r = await api('/api/items/' + encodeURIComponent(id) + '/versions');
        versionsCache.set(id, r.ok ? listOf(r.body, 'versions') : null);
      }
      return versionsCache.get(id);
    },
    open: (r, t, b) => openRecord({ ref: r, title: t, entry: panelCtx.entryById.get(r.slice(r.indexOf(':') + 1)), node: panelCtx.lineage && (panelCtx.lineage.nodes || []).find((n) => n.id === r), trigger: b }),
  };
  const content = await renderRecord({ kind, ref, rec, node, entry, ctx });
  if (panel.getAttribute('data-ref') !== ref) return;
  body.textContent = '';
  add(body, content);
  if (node && node.restricted) add(body, notice('warn', 'Restricted.', 'Restringido.', 'This record is outside your scope; only its id is shown.', 'Este registro está fuera de su alcance; solo se muestra su id.'));
  if (!rec && kind !== 'ref' && !(node && node.restricted)) add(body, notice('warn', 'Full record unavailable.', 'Registro completo no disponible.', 'Showing what the graph knows' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.', 'Se muestra lo que conoce el grafo' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.'));
  add(body, detailsNode(rec || { node: node || null, entry: entry || null }));
}

/* ── tab contents ────────────────────────────────────────────────────── */

function tabError(host, res, en, es) {
  host.textContent = '';
  add(host, notice('warn', en, es, res && res.status ? '(' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') + ')' : '(network)', res && res.status ? '(' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') + ')' : '(red)'));
}

function renderBasis(basis, entryById, lineageEdges) {
  const host = $('#basis');
  host.textContent = '';
  if (!basis.length) { add(host, add(mk('div', 'card'), mk('div', 'hub-empty', 'No basis notes on this project yet.', 'Aún no hay notas de bases en este proyecto.'))); return; }
  const grid = mk('div', 'hub-cards');
  for (const b of basis) {
    const e = entryById.get(b.id) || {};
    const stale = !!(e.stale || b.stale);
    const card = mk('article', 'card hub-basis', null, null, { 'data-basis-id': b.id, 'data-stale': String(stale) });
    const top = mk('div', 'hub-row');
    const t = mk('h3'); const btn = dv('button', 'hub-tl-title', b.title, { type: 'button' }); add(t, btn);
    btn.addEventListener('click', () => openRecord({ ref: 'doc:' + b.id, title: b.title, entry: e.id ? e : b, trigger: btn }));
    add(top, t);
    const pills = mk('div', 'hub-actions-row');
    if (stale) { const sb = document.createElement('stale-badge'); sb.reasons = e.stale_reasons; add(pills, sb); }
    add(top, pills);
    add(card, top);
    const when = (b.authored_at || b.created_at || '').slice(0, 10);
    add(card, add(mk('div', 'hub-note-s'), when ? dv('span', null, when) : null, b.reference_no ? document.createTextNode(' · ') : null, b.reference_no ? dv('span', 'mono', b.reference_no) : null, b.version > 1 ? dv('span', null, ' · v' + b.version) : null));
    const cites = (b.cites && b.cites.length ? b.cites : lineageEdges.filter((x) => x.to === 'doc:' + b.id).map((x) => x.from));
    if (cites.length) {
      const c = mk('div', 'chips hub-actions-row');
      add(c, mk('span', 'hub-note-s', 'Cites', 'Cita'));
      for (const r of cites.slice(0, 6)) add(c, dv('span', 'hub-asset', r.length > 30 ? r.slice(0, 30) + '…' : r));
      add(card, c);
    }
    if (stale) add(card, notice('bad', 'Why stale.', 'Por qué obsoleta.', firstReason(e.stale_reasons) || 'no reason recorded', firstReason(e.stale_reasons) || 'sin motivo registrado'));
    add(grid, card);
  }
  add(host, grid);
}

function renderLessons(list) {
  const host = $('#lessons');
  host.textContent = '';
  if (!list.length) { add(host, mk('div', 'hub-empty', 'No lessons in scope for this project.', 'No hay lecciones en alcance para este proyecto.')); return; }
  const SCOPE = { firm: ['Firm', 'Firma'], discipline: ['Discipline', 'Disciplina'], client: ['Client', 'Cliente'], project: ['Project', 'Proyecto'], tool: ['Tool', 'Herramienta'] };
  for (const l of list) {
    const row = mk('div', 'hub-lesson', null, null, { 'data-lesson-id': l.id || '' });
    add(row, dv('div', 't', l.claim || l.statement || l.text || l.id));
    const m = mk('div', 'm');
    const sc = SCOPE[l.scope] || [l.scope, l.scope];
    if (l.scope) add(m, mk('span', 'hub-pill info', sc[0], sc[1]));
    if (l.status) add(m, l.status === 'proposed' ? mk('span', 'hub-pill warn', 'Proposed', 'Propuesta') : l.status === 'confirmed' ? mk('span', 'hub-pill ok', 'Confirmed', 'Confirmada') : dv('span', 'hub-pill muted', l.status));
    if (l.confidence != null) add(m, mk('span', null, 'confidence ' + l.confidence, 'confianza ' + l.confidence));
    for (const ev of (l.evidence || []).slice(0, 4)) add(m, dv('span', 'hub-asset', ev.length > 26 ? ev.slice(0, 26) + '…' : ev));
    add(row, m);
    add(host, row);
  }
}

/* ── KPI strip ───────────────────────────────────────────────────────── */

function kpi(labelEn, labelEs, valueNode, detailNode, cls) {
  const k = mk('div', 'hub-kpi');
  add(k, mk('span', 'k', labelEn, labelEs), add(mk('span', 'v' + (cls ? ' ' + cls : '')), valueNode), add(mk('span', 'd'), detailNode));
  return k;
}

function renderKpis(ctx, card) {
  const host = $('#p-kpis');
  host.textContent = '';
  const { vintages, entries } = ctx;
  const newest = vintages.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (newest) {
    const meta = annotate(vintages).get(newest.run_id);
    const keys = Object.keys(newest.outputs || {}).filter((k) => k !== 'method' && typeof (newest.outputs[k] || {}).value === 'number');
    const pick = [];
    for (const re of [/^2p/i, /npv/i]) { const k = keys.find((x) => re.test(x) && !pick.includes(x)); if (k) pick.push(k); }
    for (const k of keys) if (pick.length < 2 && !pick.includes(k)) pick.push(k);
    for (const k of pick) {
      const o = newest.outputs[k], d = meta.deltas[k];
      const val = add(mk('span'), dv('span', null, num(o.value)), o.unit ? dv('small', null, ' ' + o.unit) : null);
      const det = d && typeof d.delta_pct === 'number'
        ? add(mk('span'), dv('span', d.delta_pct < 0 ? 'dn' : 'up', fmtPct(d.delta_pct)), mk('span', null, ' vs vintage ' + (meta.number - 1), ' vs añada ' + (meta.number - 1)))
        : mk('span', null, 'vintage ' + meta.number, 'añada ' + meta.number);
      const kk = kpi('Latest ' + k.replace(/_/g, ' '), 'Última ' + k.replace(/_/g, ' '), val, det);
      kk.setAttribute('data-kpi', k);
      add(host, kk);
    }
  } else add(host, kpi('Latest headline', 'Última cifra', mk('span', null, '—', '—'), mk('span', null, 'no final run yet', 'aún sin ejecución final')));

  const runs = entries.filter((e) => e.kind === 'run');
  const sup = runs.filter((r) => r.status === 'superseded').length;
  add(host, kpi('Active runs', 'Ejecuciones activas', dv('span', null, String(runs.length - sup)), mk('span', null, sup + ' superseded', sup + ' reemplazadas')));

  const stale = entries.filter((e) => e.stale);
  const byKind = {};
  for (const e of stale) { const k = iconKind(e); byKind[k] = (byKind[k] || 0) + 1; }
  const KL = { run: ['run', 'ejecución'], letter: ['letter', 'carta'], email: ['email', 'correo'], spreadsheet: ['spreadsheet', 'hoja'], paper: ['paper', 'artículo'], invoice: ['invoice', 'factura'], note: ['note', 'nota'], reference: ['reference set', 'conjunto'], other: ['other', 'otro'] };
  const en = Object.entries(byKind).map(([k, n]) => n + ' ' + KL[k][0]).join(' · '), es = Object.entries(byKind).map(([k, n]) => n + ' ' + KL[k][1]).join(' · ');
  add(host, kpi('Stale records', 'Registros obsoletos', dv('span', null, String(stale.length)), stale.length ? mk('span', null, en, es) : mk('span', null, 'nothing stale', 'nada obsoleto'), stale.length ? 'bad' : ''));

  const rag = card.rag === 'g' ? 'g' : card.rag === 'r' ? 'r' : '';
  const v = add(mk('span'), mk('span', 'hub-rag ' + rag, null, null, { 'aria-hidden': 'true' }), dv('span', null, card.pass + '/6'));
  add(host, kpi('Scorecard', 'Ficha', v, mk('span', null, card.fail + card.na + ' rules failing or unmeasured', card.fail + card.na + ' reglas fallan o no son medibles')));
}

/* ── load ────────────────────────────────────────────────────────────── */

async function init() {
  await showSession();
  if (!projectId) return failPage(null);
  const enc = encodeURIComponent(projectId);
  const pr = await api('/api/projects/' + enc);
  if (!pr.ok || !pr.body) return failPage(pr);
  showVault(true);
  const project = pr.body;

  const [tlR, vR, lnR, noteR, lessonR, runsR, orgR, fileR, cat, geo] = await Promise.all([
    api('/api/projects/' + enc + '/timeline'),
    api('/api/projects/' + enc + '/vintages'),
    api('/api/projects/' + enc + '/lineage'),
    api('/api/items?project=' + enc + '&type=note&limit=1000'),
    api('/api/lessons?scope=' + encodeURIComponent('project:' + projectId)),
    api('/api/runs?project=' + enc + '&limit=1000'),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id)) : Promise.resolve(null),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id) + '/file') : Promise.resolve(null),
    loadCatalog(),
    loadGeo(),
  ]);
  const names = new Map();
  if (geo) for (const f of geo.features) if (!names.has(f.properties.iso2)) names.set(f.properties.iso2, { en: f.properties.en, es: f.properties.es });

  const entries = tlR.ok ? listOf(tlR.body, 'entries') : [];
  const vintages = vR.ok ? listOf(vR.body, 'vintages') : [];
  const lineage = lnR.ok && lnR.body ? { nodes: listOf(lnR.body, 'nodes'), edges: Array.isArray(lnR.body.edges) ? lnR.body.edges : [] } : null;
  const org = orgR && orgR.ok ? orgR.body : null;
  const orgFile = fileR && fileR.ok ? fileR.body : null;
  const runs = runsR.ok ? listOf(runsR.body, 'runs', 'items') : null;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  panelCtx = { project, entryById, lineage };
  let basis;
  if (noteR.ok) basis = listOf(noteR.body, 'items').filter(isBasisItem);
  else basis = entries.filter((e) => e.kind === 'item' && e.type === 'note' && /^basis/i.test(e.title || ''));
  const lessonsOk = lessonR.ok && lessonR.status !== 404 && lessonR.status !== 501;
  const lessons = lessonsOk ? listOf(lessonR.body, 'lessons', 'items') : [];
  const now = Date.now();
  const ctx = { project, org, orgFile, entries, vintages, lineage, runs, basis, now, names };

  renderHeader(ctx);
  renderToolbar(ctx, cat);
  renderOpportunity(ctx);
  await renderFields(ctx);
  renderHeader(ctx);                                       // the asset chips now carry names
  setupUpload(project);

  const rules = computeScorecard(ctx);
  const card = renderScorecard(rules);
  renderKpis(ctx, card);

  // Timeline.
  const tl = $('#tl');
  if (!tlR.ok) tabError($('#panel-timeline'), tlR, 'The timeline could not be loaded.', 'No se pudo cargar la cronología.');
  else {
    tl.entries = [...entries, ...stageEntries(project)];
    tl.addEventListener('record-select', (ev) => openRecord({ ref: ev.detail.ref, title: ev.detail.entry.title, entry: ev.detail.entry, trigger: ev.detail.trigger }));
  }

  // Headline numbers.
  const vt = $('#vint');
  if (!vR.ok) tabError($('#panel-vintages'), vR, 'The headline numbers could not be loaded.', 'No se pudieron cargar las cifras principales.');
  else {
    const breaking = new Set();
    for (const t of (cat.catalog && cat.catalog.tools) || []) for (const v of t.versions || []) if (v.breaking) breaking.add(t.id + '@' + v.version);
    vt.breaking = breaking;
    vt.staleReasons = new Map(entries.filter((e) => e.kind === 'run' && e.stale).map((e) => [e.id, firstReason(e.stale_reasons)]));
    vt.titles = new Map(entries.filter((e) => e.kind === 'run').map((e) => [e.id, e.title]));
    vt.vintages = vintages;
  }

  // Lineage.
  const lg = $('#lineage');
  if (!lineage) tabError($('#panel-lineage'), lnR, 'The lineage could not be loaded.', 'No se pudo cargar el linaje.');
  else {
    lg.graph = lineage;
    lg.addEventListener('node-select', (ev) => {
      const nd = ev.detail.node;
      openRecord({ ref: nd.id, title: nd.restricted ? 'Restricted record' : nd.label, node: nd, entry: entryById.get(nd.id.slice(nd.id.indexOf(':') + 1)), trigger: ev.detail.trigger });
    });
  }

  renderBasis(basis, entryById, (lineage && lineage.edges) || []);
  if (lessonsOk) renderLessons(lessons);

  buildTabs({
    timeline: entries.length, vintages: vintages.length, basis: basis.length,
    lessons: lessonsOk ? lessons.length : null,
    scorecard: card.fail + card.na ? bi(card.fail + card.na + ' fail', card.fail + card.na + ' fallan') : null,
  }, new Set(lessonsOk ? [] : ['lessons']));
  routeTab();
  window.addEventListener('hashchange', routeTab);

  $('#p-body').removeAttribute('hidden');
  $('#rp-close').addEventListener('click', closePanel);
  const scrim = $('#record-scrim'); if (scrim) scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#record-panel').hasAttribute('hidden')) closePanel(); });

  // ?run=<id>: highlight the run in the timeline and open its record (linked from the tool page).
  const runParam = params.get('run');
  if (runParam) {
    const row = document.querySelector('.hub-tl-item[data-id="' + CSS.escape(runParam) + '"]');
    if (row) { row.classList.add('hilite'); row.scrollIntoView({ block: 'center' }); }
    const e = entryById.get(runParam);
    await openRecord({ ref: 'run:' + runParam, title: e && e.title, entry: e, trigger: row && row.querySelector('button') });
  }
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'project') init();
