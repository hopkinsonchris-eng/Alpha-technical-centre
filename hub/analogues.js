/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB ANALOGUES PAGE (M16, Tier C)
   hub/analogues.html[?asset=<id>]

   The analogue table: one row per evaluation, paper or regulator record, with
   provenance on every row and on every number. Filters, sort, a "similar to
   this" panel and CSV export. Reads the Vault API only; nothing here writes.

     GET /api/analogues?scope=                          the rows this person may see in the scope
     GET /api/analogues/similar?scope=&asset=<id>&k=    the k nearest, with distance and driving properties
     GET /api/analogues/similar?scope=&row=<json>&k=    same, for a row that has no field id (run:/paper:)

   Scope (firm, public, client:<id>, project:<id>) is kept in
   localStorage['atc-hub-find-scope'], shared with the Find page. Every request
   carries it; the Vault applies the legal-tag predicate. Every string a person
   reads carries data-en and data-es.
   ============================================================ */
import { api, mk, dv, add, setText, showSession, showVault } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const bi = (en, es) => ({ en, es: es === undefined ? en : es });
const SCOPE_KEY = 'atc-hub-find-scope';

/* ── vocabulary ──────────────────────────────────────────────────────── */

const PROVENANCE = ['own-evaluation', 'paper', 'regulator', 'vendor-database', 'client-stated'];
const PROV_PILL = { 'own-evaluation': 'own', paper: 'gold', regulator: 'info', 'vendor-database': 'ghost', 'client-stated': 'warn' };
const PROV_LABEL = {
  'own-evaluation': bi('own-evaluation', 'evaluación propia'), paper: bi('paper', 'artículo'), regulator: bi('regulator', 'regulador'),
  'vendor-database': bi('vendor-database', 'base de proveedor'), 'client-stated': bi('client-stated', 'declarado por el cliente'),
};
const NUM_PROV = {
  measured: bi('measured', 'medido'), reported: bi('reported', 'reportado'), 'client-stated': bi('client-stated', 'declarado por el cliente'),
  analogue: bi('analogue', 'análogo'), assumed: bi('assumed', 'supuesto'), calculated: bi('calculated', 'calculado'),
};
const PROP = {
  depth_m: bi('Depth', 'Profundidad'), net_pay_m: bi('Net pay', 'Espesor neto'), porosity_frac: bi('Porosity', 'Porosidad'), permeability_md: bi('Permeability', 'Permeabilidad'),
  water_saturation_frac: bi('Water saturation', 'Saturación de agua'), api_gravity: bi('API gravity', 'Gravedad API'), oil_viscosity_cp: bi('Oil viscosity', 'Viscosidad del petróleo'),
  gor_scf_stb: bi('GOR', 'GOR'), initial_pressure_psi: bi('Initial pressure', 'Presión inicial'), temperature_c: bi('Temperature', 'Temperatura'), area_km2: bi('Area', 'Área'),
  well_spacing_acres: bi('Well spacing', 'Espaciamiento de pozos'), lithology: bi('Lithology', 'Litología'), drive_mechanism: bi('Drive', 'Empuje'),
  fluid_type: bi('Fluid', 'Fluido'), environment: bi('Environment', 'Ambiente'),
};
const label = (p) => PROP[p] || bi(p, p);

/* ── scope ───────────────────────────────────────────────────────────── */

function loadScope() {
  const q = new URLSearchParams(location.search).get('scope');
  if (q && /^(firm|public|client:.+|project:.+)$/.test(q)) return q;
  try { const s = localStorage.getItem(SCOPE_KEY); if (s && /^(firm|public|client:.+|project:.+)$/.test(s)) return s; } catch (e) { /* private mode */ }
  return 'firm';
}
function saveScope(s) { try { localStorage.setItem(SCOPE_KEY, s); } catch (e) { /* private mode */ } }
function scopeFromForm() {
  const kind = $('#scope-kind').value, id = $('#scope-id').value.trim();
  if (kind === 'client' || kind === 'project') return id ? kind + ':' + id : null;
  return kind;
}
function scopeToForm(scope) {
  const [kind, ...rest] = scope.split(':');
  $('#scope-kind').value = kind;
  $('#scope-id').value = rest.join(':');
  $('#scope-id-wrap').hidden = !(kind === 'client' || kind === 'project');
}

/* ── state ───────────────────────────────────────────────────────────── */

const state = {
  scope: loadScope(), rows: [], prov: '', country: '', lith: '', drive: '',
  sort: { key: 'as_of', dir: 'desc' }, target: null, hits: new Map(), k: 10,
};

/* ── notices ─────────────────────────────────────────────────────────── */

function notice(kind, boldEn, boldEs, en, es) {
  return add(mk('div', 'hub-notice ' + kind),
    add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
}
const errText = (res) => (res && res.body && res.body.error && res.body.error.message) || '';
function failure(res, what) {
  const n = $('#notices');
  n.textContent = '';
  const m = errText(res);
  if (res.status === 0) add(n, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The ' + what + ' could not be loaded. Try again in a moment.', 'No se pudo cargar: ' + what + '. Inténtelo de nuevo en un momento.'));
  else if (res.status === 403) add(n, notice('warn', 'Outside your scope.', 'Fuera de su alcance.', m || 'You may not hold this scope. Choose another.', m || 'No puede usar este alcance. Elija otro.'));
  else if (res.status === 400) add(n, notice('warn', 'Check the scope.', 'Revise el alcance.', m || 'The scope is missing or not valid.', m || 'El alcance falta o no es válido.'));
  else if (res.status === 404 || res.status === 501) add(n, notice('warn', 'Analogue memory is not available here.', 'La memoria de análogos no está disponible aquí.', 'This Vault does not serve analogue rows yet.', 'Este Vault aún no sirve filas de análogos.'));
  else add(n, notice('bad', 'Something went wrong.', 'Algo salió mal.', m || 'The request failed (' + res.status + ').', m || 'La solicitud falló (' + res.status + ').'));
}

/* ── row helpers ─────────────────────────────────────────────────────── */

const val = (row, p) => { const v = row[p]; return v && typeof v === 'object' && typeof v.value === 'number' ? v.value : (typeof v === 'number' ? v : null); };
const provOf = (row, p) => (row[p] && row[p].provenance) || '';
const tail = (id) => { const t = String(id || '').split(':').pop() || ''; return t.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()); };
const assetName = (r) => (/^(run|paper|doc):/.test(r.asset_id || '') ? (r.play_type || r.asset_id) : tail(r.asset_id));
const short = (ref) => { const m = /^(run|doc):([0-9a-f]{4})[0-9a-f-]*([0-9a-f]{4})$/i.exec(ref || ''); return m ? m[1] + ':' + m[2] + '…' + m[3] : (ref || ''); };
const fmtNum = (v, digits) => (v === null ? '—' : v !== 0 && Math.abs(v) < 0.001 ? v.toExponential(1) : Number(v.toFixed(digits === undefined ? 2 : digits)).toLocaleString('en-GB', { maximumFractionDigits: 4 }));
const setting = (r) => [r.environment, r.lithology].filter(Boolean).join(' ') || '—';
const fluidDrive = (r) => [r.fluid_type, r.drive_mechanism].filter(Boolean).join(' · ');

function pvDot(row, p) {
  const pv = provOf(row, p);
  if (!pv) return null;
  const d = NUM_PROV[pv] || bi(pv, pv);
  const el = mk('span', 'pv-dot pv-' + pv, null, null, { role: 'img' });
  el.setAttribute('data-en-title', d.en);
  el.title = document.documentElement.getAttribute('lang') === 'es' ? d.es : d.en;
  el.setAttribute('aria-label', d.en);
  return el;
}
function numCell(row, p, digits, scale, suffix) {
  const v = val(row, p);
  const td = mk('td', v === null ? 'r' : 'r hub-num');
  td.appendChild(document.createTextNode(v === null ? '—' : fmtNum(scale ? v * scale : v, digits) + (suffix || '')));
  if (v !== null) { const d = pvDot(row, p); if (d) td.appendChild(d); td.setAttribute('data-value', String(v)); }
  return td;
}

/* ── filtering, sorting ──────────────────────────────────────────────── */

function visible() {
  return state.rows.filter((r) =>
    (!state.prov || r.provenance === state.prov) && (!state.country || r.country === state.country) &&
    (!state.lith || r.lithology === state.lith) && (!state.drive || r.drive_mechanism === state.drive));
}
const SORTERS = {
  asset: (r) => assetName(r).toLowerCase(), depth: (r) => val(r, 'depth_m'), phi: (r) => val(r, 'porosity_frac'), k: (r) => val(r, 'permeability_md'),
  rf: (r) => val(r, 'recovery_factor_frac'), eur: (r) => val(r, 'eur_per_well_mbbl'), as_of: (r) => r.as_of || '',
  dist: (r) => (state.hits.has(r.id) ? state.hits.get(r.id).distance : null),
};
function sorted(rows) {
  const f = SORTERS[state.sort.key] || SORTERS.as_of, sign = state.sort.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = f(a), y = f(b);
    if (x === null || x === undefined) return (y === null || y === undefined) ? 0 : 1;   // missing values last, whichever way
    if (y === null || y === undefined) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

/* ── rendering ───────────────────────────────────────────────────────── */

function provPill(p) {
  const l = PROV_LABEL[p] || bi(p, p);
  return mk('span', 'hub-pill ' + (PROV_PILL[p] || 'muted'), l.en, l.es, { 'data-provenance': p });
}

function renderStatus() {
  const strip = $('#status-strip');
  strip.textContent = '';
  const counts = {};
  for (const r of state.rows) counts[r.provenance] = (counts[r.provenance] || 0) + 1;
  add(strip, mk('span', 'hub-pill ghost', state.scope, state.scope));
  add(strip, mk('span', null, state.rows.length + ' rows', state.rows.length + ' filas'));
  for (const p of PROVENANCE) if (counts[p]) add(strip, mk('span', null, '· ' + counts[p] + ' ' + PROV_LABEL[p].en, '· ' + counts[p] + ' ' + PROV_LABEL[p].es));
}

function renderChips() {
  const host = $('#prov-chips');
  host.textContent = '';
  const chip = (value, en, es) => {
    const b = mk('button', 'an-chip', en, es, { type: 'button', 'aria-pressed': String(state.prov === value), 'data-prov': value });
    b.addEventListener('click', () => { state.prov = value; renderChips(); renderTable(); });
    return b;
  };
  add(host, chip('', 'All provenance', 'Toda procedencia'));
  for (const p of PROVENANCE) add(host, chip(p, PROV_LABEL[p].en, PROV_LABEL[p].es));
}

function fillSelect(sel, values, allEn, allEs, current, key) {
  sel.textContent = '';
  const o = mk('option', null, allEn, allEs, { value: '' });
  add(sel, o);
  for (const v of values) add(sel, dv('option', null, v, { value: v }));
  sel.value = values.includes(current) ? current : '';
  state[key] = sel.value;
}
function renderFilters() {
  const uniq = (k) => [...new Set(state.rows.map((r) => r[k]).filter(Boolean))].sort();
  fillSelect($('#f-country'), uniq('country'), 'All countries', 'Todos los países', state.country, 'country');
  fillSelect($('#f-lith'), uniq('lithology'), 'All lithologies', 'Todas las litologías', state.lith, 'lith');
  fillSelect($('#f-drive'), uniq('drive_mechanism'), 'All drives', 'Todos los empujes', state.drive, 'drive');
}

const COLS = [
  ['asset', 'Asset', 'Activo'], [null, 'Provenance', 'Procedencia'], [null, 'Setting, fluid, drive', 'Ambiente, fluido, empuje'],
  ['depth', 'Depth m', 'Prof. m', 'r'], ['phi', 'φ', 'φ', 'r'], ['k', 'k mD', 'k mD', 'r'], ['rf', 'RF', 'FR', 'r'], ['eur', 'EUR/well Mbbl', 'EUR/pozo Mbbl', 'r'],
  ['dist', 'Distance', 'Distancia', 'r'], ['as_of', 'Source', 'Fuente'],
];

function renderTable() {
  const wrap = $('#table-wrap');
  wrap.textContent = '';
  const rows = sorted(visible());
  setText($('#row-count'), rows.length + ' of ' + state.rows.length + ' rows shown', rows.length + ' de ' + state.rows.length + ' filas');
  if (!rows.length) {
    add(wrap, mk('div', 'hub-empty', state.rows.length ? 'No rows match these filters.' : 'No analogue rows in this scope yet.', state.rows.length ? 'Ninguna fila coincide con estos filtros.' : 'Aún no hay filas de análogos en este alcance.'));
    return;
  }
  const table = mk('table', 'hub-table', null, null, { id: 'an-table' });
  add(table, mk('caption', 'sr-only', 'Analogue rows', 'Filas de análogos'));
  const tr = mk('tr');
  for (const [key, en, es, cls] of COLS) {
    const th = mk('th', cls || '', null, null, { scope: 'col' });
    if (key) {
      const b = mk('button', 'an-sort', en, es, { type: 'button', 'data-sort': key });
      if (state.sort.key === key) { b.setAttribute('data-dir', state.sort.dir); th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending'); }
      b.addEventListener('click', () => {
        state.sort = { key, dir: state.sort.key === key ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : (key === 'asset' || key === 'dist' ? 'asc' : 'desc') };
        renderTable();
      });
      add(th, b);
    } else setText(th, en, es);
    add(tr, th);
  }
  add(table, add(mk('thead'), tr));
  const tb = mk('tbody');
  for (const r of rows) {
    const row = mk('tr', state.target && state.target.id === r.id ? 'is-target' : '', null, null, { 'data-row-id': r.id, 'data-asset': r.asset_id });
    const name = mk('td');
    add(name, dv('b', null, assetName(r)), add(mk('span', 'sub'), dv('span', 'an-id', r.asset_id + (r.country ? ' · ' + r.country : ''))));
    const src = mk('td', 'src');
    add(src, dv('span', 'mono', short(r.source_ref)), add(mk('span', 'sub'), mk('span', null, 'as of ' + r.as_of, 'a ' + r.as_of)));
    const btn = mk('button', 'btn btn-outline btn-sm', 'Similar', 'Similar', { type: 'button', 'data-similar': r.id, title: 'Similar to this', 'aria-label': 'Similar to ' + r.asset_id });
    btn.addEventListener('click', () => openSimilar(r));
    add(name, add(mk('div', 'an-act'), btn));
    const dist = state.hits.get(r.id);
    add(row, name, add(mk('td'), provPill(r.provenance)),
      add(mk('td'), dv('span', null, setting(r)), add(mk('span', 'sub'), dv('span', null, fluidDrive(r)))),
      numCell(r, 'depth_m', 0), numCell(r, 'porosity_frac', 2), numCell(r, 'permeability_md', 0),
      numCell(r, 'recovery_factor_frac', 0, 100, '%'), numCell(r, 'eur_per_well_mbbl', 0),
      dist ? add(mk('td', 'r'), dv('b', 'hub-num', dist.distance.toFixed(2))) : add(mk('td', 'r'), dv('span', 'hub-muted', '—')),
      src);
    add(tb, row);
  }
  add(table, tb);
  add(wrap, table);
}

function renderLegend() {
  const host = $('#legend');
  host.textContent = '';
  add(host, mk('span', null, 'Dot beside a number:', 'Punto junto a un número:'));
  for (const k of Object.keys(NUM_PROV)) {
    const s = mk('span');
    add(s, mk('span', 'pv-dot pv-' + k), mk('span', null, NUM_PROV[k].en, NUM_PROV[k].es));
    add(host, s);
  }
}

/* ── similar to this ─────────────────────────────────────────────────── */

const describe = (r) => [
  [r.environment, r.lithology].filter(Boolean).join(' '), r.fluid_type,
  val(r, 'depth_m') !== null ? fmtNum(val(r, 'depth_m'), 0) + ' m' : '', val(r, 'porosity_frac') !== null ? 'φ ' + fmtNum(val(r, 'porosity_frac'), 2) : '',
  val(r, 'permeability_md') !== null ? 'k ' + fmtNum(val(r, 'permeability_md'), 0) + ' mD' : '',
].filter(Boolean).join(' · ');

function whyText(h) {
  if (!h.drivers.length) return bi('No differences in the shared fields.', 'Sin diferencias en los campos compartidos.');
  const parts = h.drivers.map((d) => {
    const l = label(d.property);
    return { en: l.en + ' (' + d.a + ' vs ' + d.b + ')', es: l.es + ' (' + d.a + ' vs ' + d.b + ')' };
  });
  return { en: 'Differs mainly in ' + parts.map((p) => p.en).join(', ') + '.', es: 'Difiere sobre todo en ' + parts.map((p) => p.es).join(', ') + '.' };
}

async function openSimilar(row) {
  state.target = row;
  const useAsset = row.asset_id && !/^(run|paper|doc):/.test(row.asset_id);
  const q = 'scope=' + encodeURIComponent(state.scope) + '&k=' + state.k + '&' + (useAsset ? 'asset=' + encodeURIComponent(row.asset_id) : 'row=' + encodeURIComponent(JSON.stringify(row)));
  const res = await api('/api/analogues/similar?' + q);
  const sec = $('#sec-similar');
  if (!res.ok) { failure(res, 'similar rows'); return; }
  $('#notices').textContent = '';
  sec.removeAttribute('hidden');
  $('#sim-target').textContent = row.asset_id;
  const n = res.body.hits.length;
  setText($('#sim-title'), '· ' + n + ' nearest analogues', '· ' + n + ' análogos más cercanos');
  $('#sim-note').textContent = '';
  setText($('#sim-note'), assetName(row) + ': ' + describe(row) + '.', assetName(row) + ': ' + describe(row) + '.');
  state.hits = new Map(res.body.hits.map((h) => [h.row.id, h]));
  const host = $('#sim-tiles');
  host.textContent = '';
  if (!n) add(host, mk('div', 'hub-empty', 'Nothing comparable in this scope.', 'Nada comparable en este alcance.'));
  const max = Math.max(0.0001, ...res.body.hits.map((h) => h.distance));
  res.body.hits.forEach((h, i) => {
    const t = mk('article', 'an-tile', null, null, { 'data-hit': h.row.id });
    const why = whyText(h);
    const meter = mk('span', 'an-meter', null, null, { 'aria-hidden': 'true' });
    const fill = document.createElement('i'); fill.style.width = Math.max(4, Math.round((1 - h.distance / (max * 1.15)) * 100)) + '%';
    add(meter, fill);
    add(t,
      add(mk('div', 'an-tile-top'), dv('span', 'an-rank', String(i + 1)), provPill(h.row.provenance)),
      dv('h4', null, assetName(h.row)), dv('span', 'an-id', h.row.asset_id),
      dv('span', 'an-desc', describe(h.row)),
      mk('span', 'an-why', why.en, why.es),
      add(mk('div', 'an-dist'), meter, dv('b', null, h.distance.toFixed(2), { 'data-distance': h.distance.toFixed(4) })));
    add(host, t);
  });
  state.sort = { key: 'dist', dir: 'asc' };
  renderTable();
  sec.scrollIntoView({ block: 'nearest' });
}

function closeSimilar() {
  state.target = null; state.hits = new Map();
  $('#sec-similar').setAttribute('hidden', '');
  if (state.sort.key === 'dist') state.sort = { key: 'as_of', dir: 'desc' };
  renderTable();
}

/* ── CSV export ──────────────────────────────────────────────────────── */

const CSV_TEXT = ['id', 'source_ref', 'asset_id', 'basin_id', 'country', 'as_of', 'legal_tag', 'provenance', 'play_type', 'environment', 'lithology', 'depositional_setting', 'trap_type', 'drive_mechanism', 'fluid_type', 'operator', 'extracted_by'];
function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;      // a spreadsheet must not read text as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows) {
  const numeric = [];
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && !numeric.includes(k)) numeric.push(k);
  numeric.sort();
  const head = CSV_TEXT.concat(...numeric.map((k) => [k, k + '_low', k + '_high', k + '_provenance']), ['method']);
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    const cells = CSV_TEXT.map((k) => r[k]);
    for (const k of numeric) { const v = r[k]; cells.push(v ? v.value : '', v ? v.low : '', v ? v.high : '', v ? v.provenance : ''); }
    cells.push(Array.isArray(r.method) ? r.method.join(';') : '');
    lines.push(cells.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
function exportCsv() {
  const rows = sorted(visible());
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'analogues-' + state.scope.replace(/[^a-z0-9]+/gi, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── load ────────────────────────────────────────────────────────────── */

async function load() {
  $('#notices').textContent = '';
  const res = await api('/api/analogues?scope=' + encodeURIComponent(state.scope));
  if (!res.ok) {
    state.rows = [];
    showVault(res.status !== 0);
    failure(res, 'analogue rows');
    renderStatus(); renderFilters(); renderTable();
    return false;
  }
  showVault(true);
  state.rows = Array.isArray(res.body && res.body.rows) ? res.body.rows : [];
  renderStatus(); renderFilters(); renderTable();
  return true;
}

async function init() {
  await showSession();
  scopeToForm(state.scope);
  renderChips(); renderLegend();
  $('#scope-kind').addEventListener('change', () => {
    const k = $('#scope-kind').value;
    $('#scope-id-wrap').hidden = !(k === 'client' || k === 'project');
    if (!$('#scope-id-wrap').hidden) $('#scope-id').focus();
  });
  $('#scope-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const s = scopeFromForm();
    if (!s) { failure({ status: 400, body: null }, 'analogue rows'); return; }
    state.scope = s; saveScope(s); closeSimilar();
    await load();
  });
  for (const [id, key] of [['#f-country', 'country'], ['#f-lith', 'lith'], ['#f-drive', 'drive']]) $(id).addEventListener('change', (ev) => { state[key] = ev.target.value; renderTable(); });
  $('#export-csv').addEventListener('click', exportCsv);
  $('#sim-close').addEventListener('click', closeSimilar);
  $('#sim-k').addEventListener('change', (ev) => { state.k = Number(ev.target.value) || 10; if (state.target) openSimilar(state.target); });
  const ok = await load();
  const want = new URLSearchParams(location.search).get('asset');
  if (ok && want) { const r = state.rows.find((x) => x.asset_id === want); if (r) await openSimilar(r); }
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'analogues') init();
