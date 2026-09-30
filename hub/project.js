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
   Every string a person reads carries data-en and data-es.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, loadCatalog, fmtShortDate, num, RUN_STATUS } from './hub.js';
import './components/stale-badge.js';
import { firstReason } from './components/stale-badge.js';
import { iconKind } from './components/timeline-list.js';
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
  if ((p.asset_ids || []).length) for (const a of p.asset_ids) add(assets, dv('span', 'hub-asset', a));
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
const jsonText = (o) => JSON.stringify(o, null, 2).replace(/</g, '\\u003c');   // "<" escaped so the text is safe as a data value

function closePanel() {
  const p = $('#record-panel');
  p.setAttribute('hidden', '');
  document.body.classList.remove('has-panel');
  for (const g of document.querySelectorAll('.ln-node.sel')) g.classList.remove('sel');
  if (panelTrigger && panelTrigger.isConnected) panelTrigger.focus();
  panelTrigger = null;
}

function kv(dl, en, es, value) {
  if (value === undefined || value === null || value === '') return;
  add(dl, mk('dt', null, en, es), dv('dd', null, value));
}

/** Opens the side panel for a record ref (run:<uuid>, doc:<uuid>, ref:...) with its JSON summary. */
async function openRecord({ ref, title, node, entry, trigger }) {
  const panel = $('#record-panel'), body = $('#rp-body');
  panelTrigger = trigger || document.activeElement;
  const kind = ref.startsWith('run:') ? 'run' : ref.startsWith('doc:') ? 'doc' : 'ref';
  const kindLabel = { run: ['Run', 'Ejecución'], doc: ['Document', 'Documento'], ref: ['Reference set', 'Conjunto de referencia'] }[kind];
  setText($('#rp-kind'), kindLabel[0], kindLabel[1]);
  setText($('#rp-title'), title || (node && node.label) || ref);
  panel.setAttribute('data-ref', ref);
  panel.removeAttribute('hidden');
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

  body.textContent = '';
  const src = rec || {};
  const dl = mk('dl', 'hub-kv');
  kv(dl, 'Ref', 'Ref', ref);
  kv(dl, 'Job', 'Trabajo', src.job || (node && node.job) || (entry && entry.job));
  kv(dl, 'Tool version', 'Versión', src.tool_version || (entry && entry.tool_version));
  kv(dl, 'Type', 'Tipo', src.type || (node && node.type) || (entry && entry.type));
  kv(dl, 'Status', 'Estado', src.status || (node && node.status) || (entry && entry.status));
  kv(dl, 'Legal tag', 'Etiqueta legal', src.legal_tag || (entry && entry.legal_tag));
  kv(dl, 'Reference no.', 'N.º de referencia', src.reference_no || (entry && entry.reference_no));
  const stale = (entry && entry.stale) || (node && node.stale) || src.stale;
  add(dl, mk('dt', null, 'Stale', 'Obsoleto'), stale ? add(mk('dd'), mk('span', 'hub-stale', 'Stale', 'Obsoleta'), document.createTextNode(' '), dv('span', null, firstReason(entry && entry.stale_reasons))) : mk('dd', null, 'No', 'No'));
  add(body, dl);
  if (node && node.restricted) add(body, notice('warn', 'Restricted.', 'Restringido.', 'This record is outside your scope; only its id is shown.', 'Este registro está fuera de su alcance; solo se muestra su id.'));
  if (!rec && kind !== 'ref' && !(node && node.restricted)) add(body, notice('warn', 'Full record unavailable.', 'Registro completo no disponible.', 'Showing what the graph knows' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.', 'Se muestra lo que conoce el grafo' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.'));
  add(body, mk('h3', null, 'JSON summary', 'Resumen JSON'));
  const summary = rec || { node: node || null, entry: entry || null };
  add(body, dv('pre', 'hub-json', jsonText(summary), { 'data-json': '' }));
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

  const [tlR, vR, lnR, noteR, lessonR, runsR, orgR, fileR, cat] = await Promise.all([
    api('/api/projects/' + enc + '/timeline'),
    api('/api/projects/' + enc + '/vintages'),
    api('/api/projects/' + enc + '/lineage'),
    api('/api/items?project=' + enc + '&type=note&limit=1000'),
    api('/api/lessons?scope=' + encodeURIComponent('project:' + projectId)),
    api('/api/runs?project=' + enc + '&limit=1000'),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id)) : Promise.resolve(null),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id) + '/file') : Promise.resolve(null),
    loadCatalog(),
  ]);

  const entries = tlR.ok ? listOf(tlR.body, 'entries') : [];
  const vintages = vR.ok ? listOf(vR.body, 'vintages') : [];
  const lineage = lnR.ok && lnR.body ? { nodes: listOf(lnR.body, 'nodes'), edges: Array.isArray(lnR.body.edges) ? lnR.body.edges : [] } : null;
  const org = orgR && orgR.ok ? orgR.body : null;
  const orgFile = fileR && fileR.ok ? fileR.body : null;
  const runs = runsR.ok ? listOf(runsR.body, 'runs', 'items') : null;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  let basis;
  if (noteR.ok) basis = listOf(noteR.body, 'items').filter(isBasisItem);
  else basis = entries.filter((e) => e.kind === 'item' && e.type === 'note' && /^basis/i.test(e.title || ''));
  const lessonsOk = lessonR.ok && lessonR.status !== 404 && lessonR.status !== 501;
  const lessons = lessonsOk ? listOf(lessonR.body, 'lessons', 'items') : [];
  const now = Date.now();
  const ctx = { project, org, orgFile, entries, vintages, lineage, runs, basis, now };

  renderHeader(ctx);

  const rules = computeScorecard(ctx);
  const card = renderScorecard(rules);
  renderKpis(ctx, card);

  // Timeline.
  const tl = $('#tl');
  if (!tlR.ok) tabError($('#panel-timeline'), tlR, 'The timeline could not be loaded.', 'No se pudo cargar la cronología.');
  else {
    tl.entries = entries;
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
