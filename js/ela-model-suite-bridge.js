/* ============================================================================
 *  ELA New Law Model Suite: Vault bridge (M05)
 *
 *  ela-model-suite.html keeps its formulas, element ids and localStorage
 *  behaviour. It exposes one small surface, window.AlphaELA (state in and out,
 *  a DOM-free compute, the page's own saveOv). This module
 *    - exposes window.ATC_TOOL so the suite can be driven headlessly,
 *    - wraps AlphaELA.saveOv at runtime, so the page saves exactly as before and
 *      then a Vault Run is captured,
 *    - runs the Runs drawer (load, supersede), the project picker and the
 *      tool-version badge.
 *
 *  If the Vault client cannot be imported the suite carries on as it always did.
 *
 *  params = { ov, src, case }
 *    ov    the override set, { <field>: { prod|capex|opex: { <year>: value } } }
 *    src   where each override came from, same shape, strings
 *    case  the selected case: { brent, capex, opex, disc, gas, prefin,
 *                               ph1b, ph2, ph3, on: { <field>: boolean } }
 *          Phase 1a only = ph2 false, ph1b false; Phase 1a + 1b = ph2 false, ph1b true.
 * ========================================================================== */

const TOOL_ID = 'ela-model-suite';
/* The statutory terms the model has baked in (30% royalty, 0% income tax, 5%/yr baseline
   decline). The reference set itself is added by a later module; runs cite it by this id. */
const FISCAL_TERMS_REF = 'ref:fiscal_terms/ve/ela-2026';
const NPV_RATE = 0.10;                       // npv10 is always at 10%, whatever the case's own discount rate
const LEGAL_TAG_RE = /^lt-[a-z0-9-]{3,64}$/;
const CATS = ['prod', 'capex', 'opex'];

const $ = (s, r = document) => r.querySelector(s);
const clone = (o) => (o === undefined ? undefined : structuredClone(o));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the suite's live state, read and written through window.AlphaELA ---- */
function page() {
  const a = window.AlphaELA;
  if (!a) throw new Error('The ELA model suite has not loaded.');
  return a;
}

/* ---- headless computation: the page's own model, no DOM ---- */
function runFor(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  const state = { ov: p.ov, src: p.src, case: Object.assign({}, p.case, { disc: NPV_RATE }) };
  const M = page().compute(state);
  if (!M.act.length) return out;             // no active field: nothing was computed
  const port = M.port;
  if (Number.isFinite(port.npv)) out.npv10 = { value: port.npv, unit: 'MMUSD' };
  if (Number.isFinite(port.irr)) out.irr = { value: port.irr, unit: 'fraction' };   // null when no sign change: omitted, never zero
  const govt = port.roy + port.baselVal;
  if (Number.isFinite(govt)) out.government_take = { value: govt, unit: 'MMUSD' };
  return out;
}

/* ---- inputs and assumptions ---- */
function inputsFor() {
  return [
    { ref: FISCAL_TERMS_REF, kind: 'reference', role: 'fiscal_terms' },
    { ref: 'tool:' + TOOL_ID, kind: 'manual' },
  ];
}

/* Every model default the override set did not change, so a reader of the run can see what was
   taken as given rather than entered for this case. Only what feeds the run is listed: fields
   that are switched off assume nothing, and a year with an override is not a default. */
function assumptionsFor(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  const a = page();
  const d = a.defaults();
  const c = Object.assign({}, d.base, p.case || {});
  c.on = Object.assign({}, d.base.on, (p.case && p.case.on) || {});
  const ov = p.ov || {};
  const add = (name, value, unit) => {
    const r = { value, source: 'assumed', provenance: 'assumed' };
    if (unit) r.unit = unit;
    out[name] = r;
  };
  const kept = (fid, cat) => (ov[fid] && ov[fid][cat]) || {};

  const CASE = [
    ['brent', 'econ.brent', 'USD/bbl'], ['capex', 'econ.capex_multiplier', 'x'], ['opex', 'econ.opex_multiplier', 'x'],
    ['disc', 'econ.discount_rate', 'fraction'], ['gas', 'econ.gas_price_trevi', 'USD/mscf'], ['prefin', 'financing.prefin_cost', 'fraction/yr'],
  ];
  CASE.forEach(([k, name, unit]) => { if (c[k] === d.base[k]) add(name, d.base[k], unit); });
  [['ph1b', 'phase.1b'], ['ph2', 'phase.2'], ['ph3', 'phase.3']].forEach(([k, name]) => { if (c[k] === d.base[k]) add(name, d.base[k]); });
  Object.keys(d.base.on).forEach((id) => { if (c.on[id] === d.base.on[id]) add('field.' + id + '.active', d.base.on[id]); });

  add('fiscal.royalty', d.royalty, 'fraction');
  add('fiscal.income_tax', 0, 'fraction');
  add('fiscal.govt_baseline_decline', d.decline, 'fraction/yr');
  add('opex.govt_baseline_maintenance', d.govtOpex, 'USD/bbl');

  const p1aOnly = !c.ph2 && !c.ph1b, ph3e = c.ph2 && c.ph3;
  const series = (arr, skip, key) => {
    const rows = [];
    arr.forEach((v, i) => {
      const year = a.years[i];
      if (skip[year] !== undefined || !(v > 0)) return;
      rows.push({ year, [key]: v });
    });
    return rows;
  };
  d.fields.forEach((f) => {
    if (!c.on[f.id]) return;
    const k = 'field.' + f.id + '.';
    add(k + 'baseline_2025', f.base, 'bopd');
    add(k + 'quality_discount', f.qd, 'USD/bbl');
    add(k + 'opex', f.opex, 'USD/bbl');
    add(k + 'facility_cap', f.fac, 'MMUSD');
    add(k + 'plateau', ph3e ? f.plat[2] : (c.ph2 ? f.plat[1] : (c.ph1b ? f.p1b : f.plat[0])), 'bopd');
    const ramp = series(f.ramp, kept(f.id, 'prod'), 'bopd');
    if (ramp.length) add(k + 'prod_ramp', ramp, 'bopd');
    const phases = p1aOnly ? [['ph1a', f.ph1a]] : [['ph1', f.ph1]].concat(c.ph2 ? [['ph2', f.ph2]] : [], ph3e ? [['ph3', f.ph3]] : []);
    phases.forEach(([name, arr]) => {
      const rows = series(arr, kept(f.id, 'capex'), 'mmusd');
      if (rows.length) add(k + 'capex.' + name, rows, 'MMUSD');
    });
    if (f.gas && c.ph2) add(k + 'gas_volume', series(f.gas, {}, 'mmscfd'), 'MMscf/d');
  });
  return out;
}

function getParams() {
  return window.AlphaELA ? clone(window.AlphaELA.getState()) : null;
}
function setParams(p) {
  if (!p || typeof p !== 'object') throw new Error('setParams needs the model state {ov, src, case}.');
  page().setState(p);
  return getParams();
}

let settle = null;
const ready = new Promise((resolve) => { settle = resolve; });

window.ATC_TOOL = {
  id: TOOL_ID,
  getParams,
  setParams,
  run: (p) => runFor(p == null ? getParams() : p),
  getInputs: (p) => inputsFor(p == null ? getParams() : p),
  getAssumptions: (p) => assumptionsFor(p == null ? getParams() : p),
  ready: () => ready,                        // resolves once the Vault client import has settled
};

/* ---- Vault ---- */
let vault = null;
let vProject = 'firm';
let projectMeta = {};
let metaReady = Promise.resolve();
let runsCache = {};
let runsSeq = 0;
let toolVer = { version: new URL(import.meta.url).searchParams.get('v') || '', commit: '', source: 'page' };

const TOOL_OUTPUTS = [
  ['npv10', 'NPV at 10%', 'VAN al 10 %'],
  ['irr', 'IRR', 'TIR'],
  ['government_take', 'Govt take, 20 yr', 'Participación del Estado, 20 años'],
];

const lang = () => (String(document.documentElement.lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en');
const bi = (en, es) => '<span data-en="' + esc(en) + '" data-es="' + esc(es) + '">' + esc(lang() === 'es' ? es : en) + '</span>';
function localizeStatic() {
  if (lang() !== 'es') return;
  document.querySelectorAll('#alpha-ela [data-en][data-es]').forEach((el) => { el.textContent = el.getAttribute('data-es'); });
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

function legalTag() {
  const m = projectMeta[vProject], t = m && m.default_legal_tag;
  return (typeof t === 'string' && LEGAL_TAG_RE.test(t)) ? t : 'lt-firm';
}
function partialFor(title, p, outputs) {
  return {
    job: TOOL_ID, project_id: vProject || 'firm', legal_tag: legalTag(), asset_ids: [],
    inputs: inputsFor(p), assumptions: assumptionsFor(p), params: p, outputs,
    status: 'draft', title,
  };
}
function titleFor(p) {
  try { return page().caseName(p.case); } catch (e) { return 'ELA model suite case'; }
}

/* Writes a Run for the state the page has just saved. The save has already happened, so a
   Vault problem is reported and never blocks it. */
function captureRun() {
  if (!vault) { toast('Saved on this device.'); return Promise.resolve(null); }
  const p = getParams();
  let outputs;
  try { outputs = runFor(p); } catch (e) { outputs = {}; }
  if (!p || !Object.keys(outputs).length) { toast('Saved. No run captured: the model could not be computed for this case.'); return Promise.resolve(null); }
  return metaReady.then(() => vault.saveRun(partialFor(titleFor(p), p, outputs), { toolId: TOOL_ID }))
    .then((res) => {
      toast(res && res.queued ? 'Saved. The run is queued locally until the Vault is reachable.' : 'Saved. Run recorded.');
      if (runsOpen()) refreshRuns();
      return res;
    })
    .catch((e) => { toast('Saved. The run could not be captured: ' + ((e && e.message) || e)); return null; });
}

/* The page's own saveOv keeps its localStorage behaviour. This only adds the Run once it has run. */
function hookSave() {
  const a = window.AlphaELA;
  if (!a || a.__vaultHooked) return;
  const orig = a.saveOv;
  a.saveOv = function () {
    const res = orig.apply(this, arguments);
    captureRun();
    return res;
  };
  a.__vaultHooked = true;
}

/* ---- version badge ---- */
function paintToolVer() {
  const el = $('#toolVer'); if (!el) return;
  if (!toolVer.version) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = 'v' + toolVer.version;
  el.setAttribute('data-source', toolVer.source);
  el.title = 'Tool version ' + toolVer.version + (toolVer.commit ? ' (' + toolVer.commit + ')' : '')
    + (toolVer.source === 'vault' ? ', as resolved by the Vault' : ', from the page (Vault not reachable)');
}

/* ---- Runs drawer ---- */
const runsOpen = () => $('#runsDrawer').classList.contains('open');
function openRuns() {
  const d = $('#runsDrawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  refreshRuns();
  setTimeout(() => { const b = $('#runsDrawer .ae-xbtn'); if (b) b.focus({ preventScroll: true }); }, 60);
}
function closeRuns() { const d = $('#runsDrawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
const fmtInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : String(v); };
function outputCell(key, out) {
  if (!out || out.value == null) return null;
  const n = Number(out.value);
  if (!Number.isFinite(n)) return null;
  if (key === 'irr') return (n * 100).toFixed(1) + '%';
  return fmtInt(n) + (out.unit ? ' ' + out.unit : '');
}
function runRow(r) {
  const when = r.created_at ? new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  const st = r.status || 'draft', cls = st === 'final' || st === 'reviewed' ? 'green' : st === 'superseded' ? 'steel' : 'amber';
  const outs = r.outputs || {};
  const cells = TOOL_OUTPUTS.map((k) => [k, outputCell(k[0], outs[k[0]])]).filter((x) => x[1]).map(([k, v]) =>
    '<div><span>' + bi(k[1], k[2]) + '</span><b>' + esc(v) + '</b></div>').join('');
  return '<li class="ae-run" data-run="' + esc(r.id) + '">'
    + '<div class="ae-run-top"><strong>' + esc(r.title || r.job || 'Run') + '</strong><span>'
    + (r.queued ? '<span class="ae-rbadge amber">' + bi('queued locally', 'en cola local') + '</span> ' : '')
    + '<span class="ae-rbadge ' + cls + '">' + esc(st) + '</span></span></div>'
    + '<div class="ae-run-meta">' + esc(when) + ' · ' + esc(r.author || '–') + ' · ' + (r.tool_version ? 'v' + esc(r.tool_version) : 'v–') + '</div>'
    + (cells ? '<div class="ae-run-out">' + cells + '</div>' : '')
    + '<div class="ae-run-actions">'
    + '<button class="ae-btn solid" type="button" data-vact="run-load" data-id="' + esc(r.id) + '">' + bi('Load', 'Cargar') + '</button>'
    + (st === 'superseded' ? '' : '<button class="ae-btn" type="button" data-vact="run-supersede" data-id="' + esc(r.id) + '">' + bi('Supersede with current case', 'Reemplazar con el caso actual') + '</button>')
    + '</div></li>';
}
function refreshRuns() {
  const list = $('#runsList'), note = $('#runsQueuedNote'), empty = $('#runsEmpty'), mine = ++runsSeq;
  if (!vault) { list.innerHTML = ''; empty.hidden = true; note.hidden = false; return Promise.resolve([]); }
  return vault.listRuns({ project: vProject || 'firm', job: TOOL_ID }).then((runs) => {
    if (mine !== runsSeq) return runs;
    runs = (runs || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    runsCache = {}; runs.forEach((r) => { runsCache[r.id] = r; });
    list.innerHTML = runs.map(runRow).join('');
    empty.hidden = runs.length > 0;
    note.hidden = !(vault.mode() !== 'server' || runs.some((r) => r.queued));
    return runs;
  }).catch((e) => {
    if (mine !== runsSeq) return [];
    list.innerHTML = '<li class="ae-run">' + esc('The runs could not be listed: ' + ((e && e.message) || e)) + '</li>';
    empty.hidden = true; note.hidden = vault.mode() === 'server';
    return [];
  });
}
function loadRunAction(id) {
  if (!vault) return;
  vault.loadRun(id).then((rec) => {
    setParams(rec.params);
    const now = runFor(getParams());
    const ok = Object.keys(rec.outputs || {}).every((k) => same(rec.outputs[k] && rec.outputs[k].value, now[k] && now[k].value));
    closeRuns();
    toast(ok ? 'Run loaded. The outputs reproduce exactly.' : 'Run loaded. The outputs differ from the saved run, so the model has changed since.');
  }).catch((e) => toast('The run could not be loaded: ' + ((e && e.message) || e)));
}
function supersedeAction(id) {
  if (!vault) return;
  const p = getParams();
  let outputs;
  try { outputs = runFor(p); } catch (e) { outputs = {}; }
  if (!p || !Object.keys(outputs).length) { toast('No run saved: the model could not be computed for this case.'); return; }
  metaReady.then(() => vault.supersede(id, partialFor(titleFor(p), p, outputs), { toolId: TOOL_ID }))
    .then((res) => { toast(res.queued ? 'Superseding run queued locally.' : 'Run superseded.'); return refreshRuns(); })
    .catch((e) => toast('The run could not be superseded: ' + ((e && e.message) || e)));
}
function loadProjectMeta() {
  if (!vault || vault.mode() !== 'server') return Promise.resolve();
  return fetch('/api/projects', { cache: 'no-store', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((b) => { (Array.isArray(b) ? b : (b && b.projects) || []).forEach((pr) => { if (pr && pr.id != null) projectMeta[String(pr.id)] = pr; }); })
    .catch(() => {});
}
function wireToolbar() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-vact]'); if (!b) return;
    const a = b.getAttribute('data-vact');
    if (a === 'save-run') { if (window.AlphaELA) window.AlphaELA.saveOv(); }
    else if (a === 'open-runs') openRuns();
    else if (a === 'close-runs') closeRuns();
    else if (a === 'run-load') loadRunAction(b.getAttribute('data-id'));
    else if (a === 'run-supersede') supersedeAction(b.getAttribute('data-id'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && runsOpen()) closeRuns(); });
}

function init() {
  const tools = $('#ae-tools'); if (tools) tools.hidden = false;   // Save and Runs show in both modes
  localizeStatic();
  paintToolVer();
  wireToolbar();
  hookSave();
  import('./vault-client.js').then((m) => {
    vault = m.vault;
    window.ATC_VAULT = vault;
    window.dispatchEvent(new Event('atc-vault-ready'));
    const el = $('#projectPicker');
    metaReady = vault.pickProject(el).then((id) => { vProject = id || 'firm'; return loadProjectMeta(); }).catch(() => {});
    el.addEventListener('vault:project', (e) => {
      vProject = (e.detail && e.detail.projectId) || 'firm';
      if (runsOpen()) refreshRuns();
    });
    vault.resolve(TOOL_ID).then((r) => {
      toolVer = { version: r.version, commit: r.commit || '', source: 'vault' };
      paintToolVer();
    }).catch(() => {});
    return metaReady;
  }).catch(() => { /* the suite works exactly as before without the Vault client */ })
    .then(() => settle());
}
init();
