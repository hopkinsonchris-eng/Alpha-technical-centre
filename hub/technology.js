/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB TECHNOLOGY REGISTER (M19, Tier C)
   hub/technology.html[?application=<id>][&project=<id>][&tab=register|match|proposals]

   The firm's curated technology register. Three views:
     Register       current confirmed entries by application, ranked; weights re-rank live; a row opens its detail
     Project match  a project's conditions (stored, else derived from its figures) screened against every entry
     Proposals      new entries and revisions waiting for a partner (associates see their own)

     GET  /api/technology/applications
     GET  /api/technology?application=&status=&w=&full=1
     GET  /api/technology/:id
     POST /api/technology/:id/confirm|reject                 partners
     GET  /api/projects                                      the projects this person may see
     GET  /api/projects/:id/technology/conditions
     POST /api/projects/:id/technology/conditions
     GET  /api/projects/:id/technology/match?application=&w=
     POST /api/projects/:id/technology/suggestions

   Weights live in localStorage['atc-hub-tech-weights']; the last project in ['atc-hub-tech-project'].
   Every string a person reads carries data-en and data-es.
   ============================================================ */
import { api, mk, dv, add, setText, showSession, showVault, listOf } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const W_KEY = 'atc-hub-tech-weights', P_KEY = 'atc-hub-tech-project';
const DEFAULT_W = { citation: 20, cost_benefit: 35, evidence: 20, fit: 25 };
const COMPONENTS = ['citation', 'cost_benefit', 'evidence', 'fit'];

const NUMERIC = [
  ['depth_m', 'Depth (m TVD)', 'Profundidad (m TVD)'], ['rate_bpd', 'Rate (bbl/d per well)', 'Caudal (bbl/d por pozo)'],
  ['temperature_c', 'Temperature (°C)', 'Temperatura (°C)'], ['api', 'Oil gravity (°API)', 'Gravedad (°API)'],
  ['viscosity_cp', 'Oil viscosity (cP)', 'Viscosidad (cP)'], ['water_cut', 'Water cut (0–1)', 'Corte de agua (0–1)'],
  ['gor_scf_bbl', 'GOR (scf/bbl)', 'GOR (scf/bbl)'], ['permeability_md', 'Permeability (mD)', 'Permeabilidad (mD)'],
  ['net_pay_m', 'Net pay (m)', 'Espesor neto (m)'], ['deviation_deg', 'Deviation (°)', 'Desviación (°)'], ['salinity_ppm', 'Salinity (ppm)', 'Salinidad (ppm)'],
];
const ENV = [['', '—', '—'], ['onshore', 'Onshore', 'En tierra'], ['shallow-water', 'Shallow water', 'Aguas someras'], ['offshore', 'Offshore', 'Costa afuera'], ['subsea', 'Subsea', 'Submarino']];
const SAND = [['', '—', '—'], ['low', 'Low', 'Baja'], ['moderate', 'Moderate', 'Moderada'], ['high', 'High', 'Alta']];
const YESNO = [['', '—', '—'], ['true', 'Yes', 'Sí'], ['false', 'No', 'No']];
const VERDICT = { pass: ['Pass', 'Apta', 'ok'], marginal: ['Marginal', 'Marginal', 'warn'], fail: ['Fail', 'No apta', 'bad'], unscreened: ['Unscreened', 'Sin cribar', 'muted'] };
const SUGGEST = [['', 'No decision', 'Sin decisión'], ['suggested', 'Suggested', 'Sugerida'], ['shortlisted', 'Shortlisted', 'Preseleccionada'], ['dismissed', 'Dismissed', 'Descartada']];
const READY = { 1: ['Lab', 'Laboratorio'], 2: ['Pilot', 'Piloto'], 3: ['Field-proven', 'Probada en campo'], 4: ['Commercial', 'Comercial'] };

const state = {
  person: null, apps: [], app: '', tab: 'register', weights: loadWeights(),
  entries: [], proposals: [], open: null, sort: { key: 'rank', dir: 'asc' },
  projects: [], project: null, match: null, showFailed: false,
};

/* ── small helpers ───────────────────────────────────────────────────── */

function loadWeights() {
  try { const w = JSON.parse(localStorage.getItem(W_KEY) || 'null'); if (w && COMPONENTS.every((k) => typeof w[k] === 'number')) return w; } catch (e) { /* private mode */ }
  return { ...DEFAULT_W };
}
const wParam = () => COMPONENTS.map((k) => (state.weights[k] / 100).toFixed(2)).join(',');
const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '—');
const errMessage = (r) => (r && r.body && r.body.error && r.body.error.message) || '';
function notice(kind, en, es) {
  const host = $('#notices'); host.textContent = '';
  add(host, mk('div', 'hub-notice ' + kind, en, es));
}
function failure(r, what) {
  const why = errMessage(r) || (r.status ? 'HTTP ' + r.status : 'the Vault is unreachable');
  notice(r.status === 403 ? 'warn' : 'bad', 'Could not load ' + what + ': ' + why, 'No se pudo cargar ' + what + ': ' + why);
}
function meter(v) {
  const m = mk('span', 'tr-meter'); const i = document.createElement('i'); i.style.width = (typeof v === 'number' ? Math.max(0, Math.min(1, (v - 1) / 4)) * 100 : 0) + '%'; m.appendChild(i); return m;
}
function pill(cls, en, es) { return mk('span', 'hub-pill ' + cls, en, es); }
const tierPill = (t) => pill(t === 'E1' ? 'ok' : t === 'E2' ? 'info' : t === 'E3' ? 'warn' : 'muted', t || '—');
function th(label, key, cls) {
  const cell = mk('th', cls);
  const b = mk('button', 'tr-sort', label[0], label[1], { type: 'button', 'data-sort': key });
  if (state.sort.key === key) b.setAttribute('data-dir', state.sort.dir);
  b.addEventListener('click', () => { state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : key === 'rank' || key === 'name' ? 'asc' : 'desc' }; renderRegister(); });
  return add(cell, b);
}
function sortVal(e, key) {
  if (key === 'name') return e.name.toLowerCase();
  if (key === 'rank') return e.rank;
  if (key === 'papers') return e.citations ? e.citations.since_2016 : -1;
  if (key === 'readiness') return e.readiness;
  return e.scores[key] ?? -1;
}
function sorted(list) {
  const { key, dir } = state.sort, f = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => { const x = sortVal(a, key), y = sortVal(b, key); return x < y ? -f : x > y ? f : a.rank - b.rank; });
}

/* ── application chips and weights ───────────────────────────────────── */

function renderChips() {
  const host = $('#app-chips'); host.textContent = '';
  const total = state.apps.reduce((n, a) => n + a.entries, 0);
  const chip = (id, en, es, n) => {
    const b = mk('button', 'tr-chip', null, null, { type: 'button', 'aria-pressed': state.app === id ? 'true' : 'false', 'data-app': id });
    add(b, mk('span', null, en, es), dv('span', 'n', String(n)));
    b.addEventListener('click', async () => { state.app = id; state.open = null; renderChips(); await refresh(); });
    return b;
  };
  add(host, chip('', 'All', 'Todas', total));
  for (const a of state.apps) add(host, chip(a.id, a.label, a.label, a.entries));
}
function renderWeights() {
  for (const k of COMPONENTS) { $('#w-' + k).value = String(state.weights[k]); $('#o-' + k).textContent = state.weights[k] + '%'; }
}
let wTimer = null;
function onWeight(k, v) {
  state.weights[k] = Number(v); $('#o-' + k).textContent = v + '%';
  try { localStorage.setItem(W_KEY, JSON.stringify(state.weights)); } catch (e) { /* private mode */ }
  clearTimeout(wTimer); wTimer = setTimeout(refresh, 250);
}

/* ── register ────────────────────────────────────────────────────────── */

function scoreCell(v) { return add(mk('td', 'r'), dv('span', 'tr-score', fmt(v, 1))); }
function renderRegister() {
  const wrap = $('#reg-wrap'); wrap.textContent = '';
  setText($('#n-register'), String(state.entries.length));
  setText($('#reg-count'), state.entries.length + ' technologies', state.entries.length + ' tecnologías');
  if (!state.entries.length) { add(wrap, mk('p', 'hub-muted', 'Nothing confirmed in this area yet. Proposals wait on the Proposals tab.', 'Nada confirmado en esta área todavía. Las propuestas esperan en la pestaña Propuestas.', { style: 'padding:16px 20px' })); return; }
  const t = mk('table', 'hub-table', null, null, { id: 'tr-table' });
  const hr = add(mk('tr'),
    th(['#', '#'], 'rank', 'r'), th(['Technology', 'Tecnología'], 'name'), th(['Overall', 'Global'], 'overall'),
    th(['Citations', 'Citas'], 'citation', 'r'), th(['Cost-benefit', 'Costo-beneficio'], 'cost_benefit', 'r'), th(['Evidence', 'Evidencia'], 'evidence', 'r'), th(['Fit', 'Ajuste'], 'fit', 'r'),
    th(['Papers since 2016', 'Artículos desde 2016'], 'papers', 'r'), th(['Readiness', 'Madurez'], 'readiness'), mk('th', null, 'Providers', 'Proveedores'));
  add(t, add(mk('thead'), hr));
  const tb = mk('tbody');
  for (const e of sorted(state.entries)) {
    const tr = mk('tr', 'tr-row' + (state.open === e.id ? ' is-open' : ''), null, null, { tabindex: '0', 'data-key': e.key });
    const name = add(mk('td'), dv('b', null, e.name), dv('span', 'sub mono', e.key + (state.app ? '' : ' · ' + e.application)));
    const ov = add(mk('td'), meter(e.scores.overall), dv('span', 'tr-score', fmt(e.scores.overall)));
    const papers = e.citations ? add(mk('td', 'r'), dv('span', null, e.citations.since_2016 != null ? e.citations.since_2016.toLocaleString('en-GB') : '—'), e.citations.since_2016 ? dv('span', 'sub', Math.round(100 * (e.citations.since_2023 || 0) / e.citations.since_2016) + '% since 2023') : null) : dv('td', 'r', '—');
    const rd = READY[e.readiness] || ['—', '—'];
    const prov = add(mk('td'), dv('span', null, String(e.providers)), e.adipec_2026 ? mk('span', 'sub', e.adipec_2026 + ' at ADIPEC 2026', e.adipec_2026 + ' en ADIPEC 2026') : null);
    add(tr, dv('td', 'r', String(e.rank)), name, ov, scoreCell(e.scores.citation), scoreCell(e.scores.cost_benefit), scoreCell(e.scores.evidence), scoreCell(e.scores.fit), papers, add(mk('td'), mk('span', null, rd[0], rd[1]), tierPill(e.best_tier)), prov);
    const open = () => openDetail(e.id, '#reg-detail');
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
    add(tb, tr);
  }
  add(t, tb); add(wrap, t);
}

async function openDetail(id, hostSel) {
  state.open = id;
  if (state.tab === 'register') renderRegister();
  const host = $(hostSel); host.textContent = '';
  add(host, mk('p', 'hub-muted', 'Loading…', 'Cargando…', { style: 'padding:14px 20px' }));
  const r = await api('/api/technology/' + encodeURIComponent(id));
  host.textContent = '';
  if (!r.ok) { failure(r, 'the entry'); return; }
  const e = r.body, rec = e.record || {};
  const box = mk('div', 'tr-detail', null, null, { 'data-detail': e.key });
  const left = mk('div'), right = mk('div');
  add(left, add(mk('h4'), dv('span', null, e.name + ' '), dv('span', 'hub-chip-tag', e.key + ' v' + e.version)), dv('p', null, rec.summary));
  if (rec.reference_fit) add(left, mk('p', 'hub-muted', 'Reference fit ' + rec.reference_fit.score + '/5: ' + rec.reference_fit.reason, 'Ajuste de referencia ' + rec.reference_fit.score + '/5: ' + rec.reference_fit.reason));
  add(left, mk('h4', null, 'Evidence', 'Evidencia'));
  const ev = mk('ol', 'tr-ev');
  for (const x of rec.evidence || []) {
    const li = add(mk('li'), tierPill(x.tier), dv('span', null, ' ' + x.claim + (x.who ? ' (' + x.who + ')' : '') + ' '));
    if (/^https?:/.test(x.source)) add(li, mk('a', null, 'source', 'fuente', { href: x.source, target: '_blank', rel: 'noopener noreferrer' }));
    else add(li, dv('span', 'mono', x.source));
    if (x.abstract_only) add(li, mk('span', 'hub-pill muted', 'abstract only: check before quoting', 'solo resumen: verificar antes de citar'));
    add(ev, li);
  }
  add(left, ev);
  if (rec.caveats) add(left, mk('h4', null, 'Caveats', 'Advertencias'), dv('p', 'hub-muted', rec.caveats));

  const dl = mk('dl');
  const row = (en, es, v) => { if (v !== undefined && v !== null && v !== '') add(dl, mk('dt', null, en, es), dv('dd', null, v)); };
  row('Capex', 'Capex', rec.capex || 'not published');
  row('Opex / run life', 'Opex / vida útil', rec.opex || 'not published');
  for (const [k, v] of Object.entries(rec.operating_window || {})) if (v) row(k.replace(/_/g, ' '), k.replace(/_/g, ' '), v);
  const s = rec.screening || {};
  const lim = Object.entries(s).map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? [v.min != null ? '≥ ' + v.min : null, v.max != null ? '≤ ' + v.max : null].filter(Boolean).join(' ') : String(v))).join('; ');
  row('Screening limits', 'Límites de cribado', lim || 'none published');
  if (rec.rationale) row('Score rationale', 'Justificación', rec.rationale);
  add(right, mk('h4', null, 'Costs and limits', 'Costos y límites'), dl);
  add(right, mk('h4', null, 'Providers', 'Proveedores'));
  const pv = mk('div', 'tr-prov');
  for (const p of rec.providers || []) add(pv, dv('span', p.adipec_2026 ? 'adipec' : null, p.name + (p.adipec_2026 ? ' · ADIPEC ' + [p.adipec_2026.hall, p.adipec_2026.stand ? 'stand ' + p.adipec_2026.stand : null].filter(Boolean).join(', ') : '')));
  add(right, pv);
  add(right, mk('h4', null, 'History', 'Historial'));
  const hist = mk('ul', 'tr-ev');
  for (const h of e.history || []) add(hist, dv('li', null, 'v' + h.version + ' · ' + h.status + (h.superseded_by ? ' (superseded)' : '') + ' · ' + (h.note || '') + ' · ' + h.author + ' · ' + String(h.created_at).slice(0, 10)));
  add(right, hist);
  if (e.status === 'proposed' && state.person && state.person.role === 'partner') {
    const act = mk('div', 'tr-actions');
    const go = (verb, en, es, cls) => { const b = mk('button', 'btn btn-sm ' + cls, en, es, { type: 'button', 'data-action': verb }); b.addEventListener('click', () => decide(e.id, verb)); return b; };
    add(act, go('confirm', 'Confirm', 'Confirmar', 'btn-primary'), go('reject', 'Reject', 'Rechazar', 'btn-outline'));
    add(right, act);
  }
  add(box, left, right); add(host, box);
}

async function decide(id, verb) {
  const r = await api('/api/technology/' + encodeURIComponent(id) + '/' + verb, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' });
  if (!r.ok) { failure(r, 'the decision'); return; }
  notice('', verb === 'confirm' ? 'Confirmed: it is in the register now.' : 'Rejected.', verb === 'confirm' ? 'Confirmada: ya está en el registro.' : 'Rechazada.');
  $('#prop-detail').textContent = ''; state.open = null;
  await loadApps(); await refresh();
}

/* ── proposals ───────────────────────────────────────────────────────── */

function renderProposals() {
  const wrap = $('#prop-wrap'); wrap.textContent = '';
  setText($('#n-proposals'), String(state.proposals.length));
  if (!state.proposals.length) { add(wrap, mk('p', 'hub-muted', 'No proposals waiting.', 'No hay propuestas pendientes.', { style: 'padding:16px 20px' })); return; }
  const t = mk('table', 'hub-table');
  add(t, add(mk('thead'), add(mk('tr'), mk('th', null, 'Technology', 'Tecnología'), mk('th', null, 'Version', 'Versión'), mk('th', null, 'Proposed by', 'Propuesta por'), mk('th', 'r', 'Overall', 'Global'), mk('th', null, 'Best evidence', 'Mejor evidencia'))));
  const tb = mk('tbody');
  for (const e of state.proposals) {
    const tr = mk('tr', 'tr-row', null, null, { tabindex: '0', 'data-key': e.key });
    add(tr, add(mk('td'), dv('b', null, e.name), dv('span', 'sub mono', e.key + ' · ' + e.application)), dv('td', null, 'v' + e.version), dv('td', null, e.author + ' · ' + String(e.created_at).slice(0, 10)), add(mk('td', 'r'), dv('span', 'tr-score', fmt(e.scores.overall))), add(mk('td'), tierPill(e.best_tier)));
    tr.addEventListener('click', () => openDetail(e.id, '#prop-detail'));
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openDetail(e.id, '#prop-detail'); });
    add(tb, tr);
  }
  add(t, tb); add(wrap, t);
}

/* ── project match ───────────────────────────────────────────────────── */

function renderProjects() {
  const sel = $('#m-project'); sel.textContent = '';
  add(sel, mk('option', null, 'Choose a project…', 'Elija un proyecto…', { value: '' }));
  for (const p of state.projects) add(sel, dv('option', null, p.name + ' (' + p.id + ')', { value: p.id }));
  sel.value = state.project || '';
}
function field(key, en, es, kind, options, value, src) {
  const wrap = mk('div');
  const id = 'c-' + key;
  add(wrap, mk('label', null, en, es, { for: id }));
  let input;
  if (kind === 'select') {
    input = mk('select', null, null, null, { id, 'data-cond': key });
    for (const [v, oen, oes] of options) add(input, mk('option', null, oen, oes, { value: v }));
    input.value = value === undefined || value === null ? '' : String(value);
  } else {
    input = mk('input', 'tr-in', null, null, { id, type: 'number', step: 'any', inputmode: 'decimal', 'data-cond': key, style: 'width:100%' });
    if (value !== undefined && value !== null) input.value = String(value);
  }
  add(wrap, input);
  const s = src && src.from === 'figure' ? mk('span', 'src', 'from figure "' + src.figure + '" (' + src.value + ')', 'de la cifra "' + src.figure + '" (' + src.value + ')') : src && src.from === 'stored' ? mk('span', 'src', 'saved for the project', 'guardado para el proyecto') : mk('span', 'src');
  add(wrap, s);
  return wrap;
}
function renderConditions(cond) {
  const form = $('#m-form'); form.textContent = '';
  if (!state.project) { add(form, mk('p', 'hub-muted', 'Choose a project to screen the register against its conditions.', 'Elija un proyecto para cribar el registro según sus condiciones.')); return; }
  const stored = (cond && cond.stored && cond.stored.conditions) || {}, sources = (cond && cond.sources) || {};
  for (const [k, en, es] of NUMERIC) add(form, field(k, en, es, 'number', null, stored[k] ?? (sources[k] && sources[k].from === 'figure' ? '' : undefined), sources[k]));
  add(form, field('environment', 'Setting', 'Entorno', 'select', ENV, stored.environment, sources.environment));
  add(form, field('sand', 'Sand production', 'Producción de arena', 'select', SAND, stored.sand, sources.sand));
  add(form, field('power_reliable', 'Reliable power', 'Energía fiable', 'select', YESNO, stored.power_reliable, sources.power_reliable));
  add(form, field('rigs_available', 'Rigs available', 'Equipos disponibles', 'select', YESNO, stored.rigs_available, sources.rigs_available));
  const set = cond && cond.stored ? 'Saved by ' + cond.stored.set_by + ' on ' + String(cond.stored.set_at).slice(0, 10) + '. Blank fields fall back to the project\'s figures.' : 'Nothing saved yet: using the project\'s figures where they exist.';
  setText($('#m-note'), set, cond && cond.stored ? 'Guardado por ' + cond.stored.set_by + ' el ' + String(cond.stored.set_at).slice(0, 10) + '. Los campos vacíos usan las cifras del proyecto.' : 'Nada guardado todavía: se usan las cifras del proyecto donde existen.');
}
function readConditions() {
  const out = {};
  for (const el of document.querySelectorAll('[data-cond]')) {
    const k = el.getAttribute('data-cond'), v = el.value;
    if (v === '') continue;
    if (k === 'power_reliable' || k === 'rigs_available') out[k] = v === 'true';
    else if (k === 'environment' || k === 'sand') out[k] = v;
    else { const n = Number(v); if (Number.isFinite(n)) out[k] = n; }
  }
  return out;
}
function checksText(e) {
  const s = e.screen; const p = mk('span', 'tr-checks');
  const bad = s.checks.filter((c) => c.result === 'fail'), marg = s.checks.filter((c) => c.result === 'marginal'), unk = s.checks.filter((c) => c.result === 'unknown');
  for (const c of bad) add(p, dv('b', null, c.key + ': '), dv('span', null, c.why + '. '));
  for (const c of marg) add(p, dv('i', null, c.key + ': '), dv('span', null, c.why + '. '));
  if (unk.length) add(p, mk('span', null, 'Unknown: ' + unk.map((c) => c.key).join(', ') + '.', 'Desconocido: ' + unk.map((c) => c.key).join(', ') + '.'));
  if (!s.checks.length) add(p, mk('span', null, 'No published limits to screen.', 'Sin límites publicados para cribar.'));
  return p;
}
async function suggest(e, status, note) {
  const r = await api('/api/projects/' + encodeURIComponent(state.project) + '/technology/suggestions', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ key: e.key, status, note: note || undefined }) });
  if (!r.ok) { failure(r, 'the decision'); return false; }
  return true;
}
function renderMatch() {
  const wrap = $('#match-wrap'); wrap.textContent = '';
  if (!state.project || !state.match) { setText($('#match-count'), ''); return; }
  const all = state.match.entries;
  const shown = all.filter((e) => state.showFailed || e.screen.verdict !== 'fail');
  const failed = all.filter((e) => e.screen.verdict === 'fail').length;
  setText($('#match-count'), shown.length + ' shown · ' + failed + ' failed screening' + (state.showFailed ? '' : ' (hidden)'), shown.length + ' mostradas · ' + failed + ' no superaron el cribado' + (state.showFailed ? '' : ' (ocultas)'));
  const t = mk('table', 'hub-table', null, null, { id: 'tm-table' });
  add(t, add(mk('thead'), add(mk('tr'), mk('th', 'r', '#', '#'), mk('th', null, 'Technology', 'Tecnología'), mk('th', null, 'Screening', 'Cribado'), mk('th', 'r', 'Fit', 'Ajuste'), mk('th', null, 'Overall', 'Global'), mk('th', null, 'Project decision', 'Decisión del proyecto'))));
  const tb = mk('tbody');
  for (const e of shown) {
    const v = VERDICT[e.screen.verdict] || VERDICT.unscreened;
    const tr = mk('tr', null, null, null, { 'data-key': e.key, 'data-verdict': e.screen.verdict });
    const sel = mk('select', null, null, null, { 'aria-label': 'Decision for ' + e.name });
    for (const [val, en, es] of SUGGEST) add(sel, mk('option', null, en, es, { value: val }));
    sel.value = e.suggestion ? e.suggestion.status : '';
    const note = mk('input', 'tr-in', null, null, { type: 'text', maxlength: '600', placeholder: 'why', 'aria-label': 'Note for ' + e.name, style: 'width:160px;margin-left:6px' });
    if (e.suggestion && e.suggestion.note) note.value = e.suggestion.note;
    const save = async () => { if (!sel.value) return; if (await suggest(e, sel.value, note.value.trim())) { e.suggestion = { status: sel.value, note: note.value.trim() }; notice('', 'Saved for ' + e.name + '.', 'Guardado para ' + e.name + '.'); } };
    sel.addEventListener('change', save); note.addEventListener('change', save);
    add(tr, dv('td', 'r', String(e.rank)), add(mk('td'), dv('b', null, e.name), dv('span', 'sub mono', e.key)),
      add(mk('td'), pill(v[2], v[0], v[1]), mk('br'), checksText(e)), add(mk('td', 'r'), dv('span', 'tr-score', fmt(e.scores.fit, 1))),
      add(mk('td'), meter(e.scores.overall), dv('span', 'tr-score', fmt(e.scores.overall))), add(mk('td'), sel, note));
    add(tb, tr);
  }
  add(t, tb); add(wrap, t);
}
async function loadProject() {
  const form = $('#m-form'); state.match = null;
  if (!state.project) { renderConditions(null); renderMatch(); return; }
  const [c, m] = await Promise.all([
    api('/api/projects/' + encodeURIComponent(state.project) + '/technology/conditions'),
    api('/api/projects/' + encodeURIComponent(state.project) + '/technology/match?' + new URLSearchParams({ ...(state.app ? { application: state.app } : {}), w: wParam() })),
  ]);
  if (!c.ok) { failure(c, 'the project conditions'); form.textContent = ''; renderMatch(); return; }
  renderConditions(c.body);
  if (!m.ok) { failure(m, 'the shortlist'); renderMatch(); return; }
  state.match = m.body; renderMatch();
}
async function saveConditions() {
  if (!state.project) return;
  const r = await api('/api/projects/' + encodeURIComponent(state.project) + '/technology/conditions', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ conditions: readConditions() }) });
  if (!r.ok) { failure(r, 'the conditions'); return; }
  notice('', 'Conditions saved. The shortlist below is re-screened.', 'Condiciones guardadas. La lista se ha vuelto a cribar.');
  await loadProject();
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

function exportCsv() {
  const rows = state.tab === 'match' && state.match ? state.match.entries : state.entries;
  const head = ['rank', 'key', 'application', 'name', 'overall', 'citation', 'cost_benefit', 'evidence', 'fit', 'papers_since_2016', 'papers_since_2023', 'readiness', 'best_tier', 'providers', 'adipec_2026', ...(state.tab === 'match' ? ['verdict', 'decision'] : [])];
  const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head.join(',')].concat(rows.map((e) => [e.rank, e.key, e.application, e.name, e.scores.overall, e.scores.citation, e.scores.cost_benefit, e.scores.evidence, e.scores.fit, e.citations && e.citations.since_2016, e.citations && e.citations.since_2023, e.readiness, e.best_tier, e.providers, e.adipec_2026, ...(state.tab === 'match' ? [e.screen.verdict, e.suggestion ? e.suggestion.status : ''] : [])].map(q).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'technology-' + (state.tab === 'match' && state.project ? state.project + '-' : '') + (state.app || 'all') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── load ────────────────────────────────────────────────────────────── */

async function loadApps() {
  const r = await api('/api/technology/applications');
  if (!r.ok) { showVault(r.status !== 0); failure(r, 'the register'); return false; }
  showVault(true);
  state.apps = listOf(r.body, 'applications');
  renderChips();
  return true;
}
async function refresh() {
  const qs = new URLSearchParams({ ...(state.app ? { application: state.app } : {}), w: wParam() });
  const [cur, prop] = await Promise.all([api('/api/technology?' + qs), api('/api/technology?status=proposed&' + qs)]);
  if (!cur.ok) failure(cur, 'the register');
  state.entries = cur.ok ? listOf(cur.body, 'entries') : [];
  state.proposals = prop.ok ? listOf(prop.body, 'entries') : [];
  renderRegister(); renderProposals();
  if (state.tab === 'match') await loadProject();
}
function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', b.getAttribute('data-tab') === tab ? 'true' : 'false');
  for (const t of ['register', 'match', 'proposals']) $('#pane-' + t).hidden = t !== tab;
  if (tab === 'match') loadProject();
}

async function init() {
  state.person = await showSession();
  const q = new URLSearchParams(location.search);
  state.app = q.get('application') || '';
  try { state.project = q.get('project') || localStorage.getItem(P_KEY) || null; } catch (e) { state.project = q.get('project') || null; }
  renderWeights();
  for (const k of COMPONENTS) $('#w-' + k).addEventListener('input', (ev) => onWeight(k, ev.target.value));
  $('#w-reset').addEventListener('click', () => { state.weights = { ...DEFAULT_W }; try { localStorage.removeItem(W_KEY); } catch (e) { /* private mode */ } renderWeights(); refresh(); });
  for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.getAttribute('data-tab')));
  $('#export-csv').addEventListener('click', exportCsv);
  $('#m-save').addEventListener('click', saveConditions);
  $('#m-failed').addEventListener('change', (ev) => { state.showFailed = ev.target.checked; renderMatch(); });
  $('#m-project').addEventListener('change', (ev) => { state.project = ev.target.value || null; try { if (state.project) localStorage.setItem(P_KEY, state.project); } catch (e) { /* private mode */ } loadProject(); });
  const pr = await api('/api/projects');
  state.projects = pr.ok ? listOf(pr.body, 'projects').filter((p) => p.id !== 'firm') : [];
  if (state.project && !state.projects.some((p) => p.id === state.project)) state.project = null;
  renderProjects();
  if (await loadApps()) await refresh();
  const want = q.get('tab') || (q.get('project') ? 'match' : 'register');
  showTab(['register', 'match', 'proposals'].includes(want) ? want : 'register');
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'technology') init();
