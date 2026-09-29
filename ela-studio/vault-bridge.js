/* ============================================================================
 *  ELA Scenario Studio: Vault bridge (M05)
 *
 *  Keeps app.js, api.js, engine.js and econ.js untouched. It
 *    - exposes window.ATC_TOOL so the studio can be driven headlessly,
 *    - captures a Vault Run whenever ELAStore.saveScenario succeeds,
 *    - runs the Runs drawer (load, supersede), the project picker and the
 *      tool-version badge.
 *
 *  ELAStore stays the scenario store, local or server exactly as before. If the
 *  Vault client cannot be imported the studio carries on as it always did.
 * ========================================================================== */

const TOOL_ID = 'ela-studio';
/* The fiscal terms the engine has baked in (royalty, income tax, govt decline). The
   reference set itself is added by a later module; runs cite it by this id. */
const FISCAL_TERMS_REF = 'ref:fiscal_terms/ve/ela-2026';
const NPV_RATE = 0.10;                       // npv10 is always at 10%, whatever the scenario's own rate
const LEGAL_TAG_RE = /^lt-[a-z0-9-]{3,64}$/;
const FISCAL_KEYS = ['royalty', 'tax', 'govtDecline'];
const ECON_UNITS = {
  brent: 'USD/bbl', capexMult: 'x', opexMult: 'x', discount: 'fraction', gasPrice: 'USD/mscf',
  royalty: 'fraction', govtDecline: 'fraction/yr', tax: 'fraction', drawdownYear: 'year',
};

const $ = (s, r = document) => r.querySelector(s);
const clone = (o) => (o === undefined ? undefined : structuredClone(o));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the studio's live state, read and written through the page globals ---- */
function liveState() { return typeof STATE !== 'undefined' ? STATE : null; }
function defaults() { return window.ELAEngine.defaultState(); }
/* Fills anything a hand-built or older scenario leaves out, the way the engine's own defaults would. */
function complete(p) {
  const d = defaults();
  const out = Object.assign(d, clone(p));
  out.econ = Object.assign(defaults().econ, (p && p.econ) || {});
  return out;
}

/* ---- headless computation: engine + economics, no DOM ---- */
function runFor(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  if (!window.ELAEngine || !window.ELAEcon) throw new Error('The ELA engine has not loaded.');
  const s = complete(p);
  s.econ.discount = NPV_RATE;
  const r = window.ELAEngine.solve(s);
  const e = r.econOut;
  if (!e) return out;
  if (Number.isFinite(e.npv)) out.npv10 = { value: e.npv, unit: 'MMUSD' };
  const profile = e.years.map((year, i) => ({ year, bopd: e.prodTot[i] }));
  if (profile.length && profile.every((row) => Number.isFinite(row.bopd))) out.production_profile = { value: profile, unit: 'bopd' };
  return out;
}

/* ---- inputs and assumptions ---- */
function inputsFor(p) {
  const d = defaults().econ, e = complete(p).econ;
  const inputs = [];
  if (FISCAL_KEYS.every((k) => e[k] === d[k])) inputs.push({ ref: FISCAL_TERMS_REF, kind: 'reference', role: 'fiscal_terms' });
  inputs.push({ ref: 'tool:' + TOOL_ID, kind: 'manual' });
  return inputs;
}
function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
/* Every engine default the scenario did not override, so a reader of the run can see what
   was taken as given rather than chosen for this scenario. */
function assumptionsFor(p) {
  const out = {};
  if (!p || typeof p !== 'object' || !window.ELAEngine) return out;
  const d = defaults(), s = complete(p);
  const add = (name, value, unit) => {
    const a = { value, source: 'assumed', provenance: 'assumed' };
    if (unit) a.unit = unit;
    out[name] = a;
  };
  Object.keys(d.econ).forEach((k) => { if (s.econ[k] === d.econ[k]) add('econ.' + k, d.econ[k], ECON_UNITS[k]); });
  if (s.crews === d.crews) add('crews', d.crews, 'crews');
  if (s.phaseCap === d.phaseCap) add('phaseCap', d.phaseCap);
  d.classes.forEach((dc) => {
    const c = (s.classes || []).find((x) => x.name === dc.name);
    if (!c || !(c.N > 0)) return;                       // a class with no wells assumes nothing
    const key = 'class.' + slug(dc.name) + '.';
    [['ps', 'fraction'], ['cost', 'USD 000/well'], ['dur', 'crew-days/well']].forEach(([f, unit]) => {
      if (c[f] === dc[f]) add(key + f, dc[f], unit);
    });
    if (same(c.fit, dc.fit) && same([c.mu, c.cov], [dc.mu, dc.cov])) {
      if (dc.fit && dc.fit.use) ['p10', 'p50', 'p90'].forEach((q) => add(key + 'fit.' + q, dc.fit[q], 'bopd'));
      else { add(key + 'mu', dc.mu, 'bopd'); add(key + 'cov', dc.cov, 'fraction'); }
    }
  });
  return out;
}

function getParams() {
  const s = liveState();
  return s ? clone(s) : null;
}
function setParams(p) {
  if (!p || typeof p !== 'object') throw new Error('setParams needs the scenario state.');
  if (!window.ELAEngine) throw new Error('The ELA engine has not loaded.');
  STATE = complete(p);
  recompute();
  return getParams();
}

window.ATC_TOOL = {
  id: TOOL_ID,
  getParams,
  setParams,
  run: (p) => runFor(p == null ? getParams() : p),
  getInputs: (p) => inputsFor(p == null ? getParams() : p),
  getAssumptions: (p) => assumptionsFor(p == null ? getParams() : p),
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
  ['production_profile', 'Peak production', 'Producción máxima'],
];

const lang = () => (String(document.documentElement.lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en');
const bi = (en, es) => '<span data-en="' + esc(en) + '" data-es="' + esc(es) + '">' + esc(lang() === 'es' ? es : en) + '</span>';
function localizeStatic() {
  if (lang() !== 'es') return;
  document.querySelectorAll('[data-en][data-es]').forEach((el) => { el.textContent = el.getAttribute('data-es'); });
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

/* Writes a Run for the scenario ELAStore has just saved. The save has already succeeded, so a
   Vault problem is reported and never blocks it. */
function captureRun(name, state) {
  if (!vault) return Promise.resolve(null);
  const p = clone(state);
  let outputs;
  try { outputs = runFor(p); } catch (e) { outputs = {}; }
  if (!Object.keys(outputs).length) { toast('Saved. No run captured: the economics could not be computed.'); return Promise.resolve(null); }
  return metaReady.then(() => vault.saveRun(partialFor(name, p, outputs), { toolId: TOOL_ID }))
    .then((res) => {
      if (res && res.queued) toast('Saved. The run is queued locally until the Vault is reachable.');
      if (runsOpen()) refreshRuns();
      return res;
    })
    .catch((e) => { toast('Saved. The run could not be captured: ' + ((e && e.message) || e)); return null; });
}

/* ELAStore keeps its own local/server behaviour. This only adds the Run once it has succeeded. */
function hookStore() {
  const store = window.ELAStore;
  if (!store || store.__vaultHooked) return;
  const orig = store.saveScenario.bind(store);
  store.saveScenario = async function (name, state, shared) {
    const res = await orig(name, state, shared);
    captureRun(name, state);
    return res;
  };
  store.__vaultHooked = true;
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
  setTimeout(() => { const b = $('#runsDrawer .xbtn'); if (b) b.focus({ preventScroll: true }); }, 60);
}
function closeRuns() { const d = $('#runsDrawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
const fmtInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('en-GB', { maximumFractionDigits: 0 }) : String(v); };
function outputCell(key, out) {
  if (!out || out.value == null) return null;
  if (key === 'production_profile') {
    const rows = Array.isArray(out.value) ? out.value : [];
    const peak = Math.max(...rows.map((r) => Number(r.bopd)).filter(Number.isFinite));
    return Number.isFinite(peak) ? fmtInt(peak) + ' ' + (out.unit || 'bopd') : null;
  }
  return fmtInt(out.value) + (out.unit ? ' ' + out.unit : '');
}
function runRow(r) {
  const when = r.created_at ? new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
  const st = r.status || 'draft', cls = st === 'final' || st === 'reviewed' ? 'green' : st === 'superseded' ? 'steel' : 'amber';
  const outs = r.outputs || {};
  const cells = TOOL_OUTPUTS.map((k) => [k, outputCell(k[0], outs[k[0]])]).filter((x) => x[1]).map(([k, v]) =>
    '<div><span>' + bi(k[1], k[2]) + '</span><b>' + esc(v) + '</b></div>').join('');
  return '<li class="run" data-run="' + esc(r.id) + '">'
    + '<div class="run-top"><strong>' + esc(r.title || r.job || 'Run') + '</strong><span>'
    + (r.queued ? '<span class="badge amber">' + bi('queued locally', 'en cola local') + '</span> ' : '')
    + '<span class="badge ' + cls + '">' + esc(st) + '</span></span></div>'
    + '<div class="run-meta">' + esc(when) + ' · ' + esc(r.author || '–') + ' · ' + (r.tool_version ? 'v' + esc(r.tool_version) : 'v–') + '</div>'
    + (cells ? '<div class="run-out">' + cells + '</div>' : '')
    + '<div class="run-actions">'
    + '<button class="btn solid" type="button" data-vact="run-load" data-id="' + esc(r.id) + '">' + bi('Load', 'Cargar') + '</button>'
    + (st === 'superseded' ? '' : '<button class="btn ghost" type="button" data-vact="run-supersede" data-id="' + esc(r.id) + '">' + bi('Supersede with current scenario', 'Reemplazar con el escenario actual') + '</button>')
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
    list.innerHTML = '<li class="run">' + esc('The runs could not be listed: ' + ((e && e.message) || e)) + '</li>';
    empty.hidden = true; note.hidden = vault.mode() === 'server';
    return [];
  });
}
function currentName() { return typeof CUR_NAME !== 'undefined' ? CUR_NAME : 'Scenario'; }
function loadRunAction(id) {
  if (!vault) return;
  vault.loadRun(id).then((rec) => {
    if (rec.title) CUR_NAME = rec.title;
    setParams(rec.params);
    const now = runFor(getParams());
    const ok = Object.keys(rec.outputs || {}).every((k) => same(rec.outputs[k] && rec.outputs[k].value, now[k] && now[k].value));
    closeRuns();
    toast(ok ? 'Run loaded. The outputs reproduce exactly.' : 'Run loaded. The outputs differ from the saved run, so the engine has changed since.');
  }).catch((e) => toast('The run could not be loaded: ' + ((e && e.message) || e)));
}
function supersedeAction(id) {
  if (!vault) return;
  const p = getParams();
  let outputs;
  try { outputs = runFor(p); } catch (e) { outputs = {}; }
  if (!p || !Object.keys(outputs).length) { toast('No run saved: the economics could not be computed.'); return; }
  metaReady.then(() => vault.supersede(id, partialFor(currentName(), p, outputs), { toolId: TOOL_ID }))
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
function wireDrawer() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-vact]'); if (!b) return;
    const a = b.getAttribute('data-vact');
    if (a === 'open-runs') openRuns();
    else if (a === 'close-runs') closeRuns();
    else if (a === 'run-load') loadRunAction(b.getAttribute('data-id'));
    else if (a === 'run-supersede') supersedeAction(b.getAttribute('data-id'));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && runsOpen()) closeRuns(); });
}

function init() {
  localizeStatic();
  paintToolVer();
  wireDrawer();
  hookStore();
  import('../js/vault-client.js').then((m) => {
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
  }).catch(() => { /* the studio works exactly as before without the Vault client */ });
}
init();
