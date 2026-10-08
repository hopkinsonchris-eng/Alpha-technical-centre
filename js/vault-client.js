/* ============================================================================
 *  ATC Vault client (M04)
 *
 *  The one file every browser tool imports to save and reload runs, resolve the
 *  current tool version, hash inputs, queue offline and offer an in-tool Find.
 *
 *    import { vault } from './js/vault-client.js';
 *
 *  Dual mode, same pattern as ela-studio/api.js: if GET /api/me answers 200 the
 *  Vault is reachable ("server" mode); otherwise everything falls back to a
 *  localStorage queue ("local" mode) and syncs when the API comes back. From
 *  file:// no request is ever made. No dependencies, no reliance on style.css.
 * ========================================================================== */

import { buildTree, kindOf, matches, KINDS, GROUPS, fmtSize } from './vault-files.js';

const QUEUE_KEY = 'vault_queue_v1';
const ORIGINAL_TIMEOUT_MS = 120000;
const PROJECT_KEY = 'vault_project_v1';
const REQUEST_TIMEOUT_MS = 8000;

const REQUIRED = ['id', 'job', 'tool_version', 'tool_commit', 'author', 'created_at',
  'project_id', 'legal_tag', 'inputs', 'params', 'outputs', 'input_hash', 'status'];
// Filled by the client from me()/resolve()/clock; everything else is the caller's.
const FILLED = ['id', 'tool_version', 'tool_commit', 'author', 'created_at', 'input_hash'];
const STATUSES = ['draft', 'reviewed', 'final', 'superseded'];
const INPUT_KINDS = ['run', 'document', 'reference', 'asset', 'manual'];
const RE = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  semver: /^\d+\.\d+\.\d+$/,
  commit: /^[0-9a-f]{7,40}$/,
  legalTag: /^lt-[a-z0-9-]{3,64}$/,
  hash: /^sha256:[0-9a-f]{64}$/,
};

/* ── module state ────────────────────────────────────────────────────── */

let apiBase = '';
let MODE = 'local';                 // 'local' | 'server'
let PERSON = null;                  // cached while in server mode
let meInflight = null;
let flushInflight = null;
const resolveCache = new Map();     // toolId -> Promise<{entry, modules, version, commit}>
let hookedDocument = null;
let memoryStore = {};               // fallback when localStorage is unavailable

/* ── small helpers ───────────────────────────────────────────────────── */

function storage() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}
function lsGet(key) {
  try { const s = storage(); if (s) return s.getItem(key); } catch (e) { /* fall through */ }
  return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : null;
}
function lsSet(key, value) {
  try { const s = storage(); if (s) { s.setItem(key, value); return; } } catch (e) { /* fall through */ }
  memoryStore[key] = value;
}

function noNetwork() {
  return apiBase === '' && typeof location !== 'undefined' && location && location.protocol === 'file:';
}

function fail(message, extra) {
  return Object.assign(new Error(message), extra || {});
}

async function request(path, { method = 'GET', body, timeout = REQUEST_TIMEOUT_MS } = {}) {
  if (noNetwork()) throw fail('Vault API is not reachable from file://', { code: 'offline' });
  if (typeof globalThis.fetch !== 'function') throw fail('fetch is not available', { code: 'offline' });
  const headers = { accept: 'application/json' };
  const init = { method, headers, cache: 'no-store', credentials: 'same-origin' };
  if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  let timer = null;
  if (typeof AbortController !== 'undefined') {
    const ac = new AbortController();
    init.signal = ac.signal;
    timer = setTimeout(() => ac.abort(), timeout);
  }
  try { return await globalThis.fetch(apiBase + path, init); }
  finally { if (timer) clearTimeout(timer); }
}

async function readJson(res) {
  try { return await res.json(); } catch (e) { return null; }
}

async function httpError(res, what) {
  const payload = await readJson(res);
  const e = payload && payload.error;
  const message = (e && typeof e === 'object' ? e.message : typeof e === 'string' ? e : null) || ('HTTP ' + res.status);
  const path = e && typeof e === 'object' ? e.path : undefined;
  return fail(what + ' failed: ' + message + (path ? ' (at ' + path + ')' : ''),
    { status: res.status, code: e && e.code, path });
}

/* ── canonical hash ──────────────────────────────────────────────────── */

function canonicalise(value, path) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw fail('canonicalHash: ' + String(value) + ' at ' + path + ' cannot be hashed', { path });
      return JSON.stringify(Object.is(value, -0) ? 0 : value);   // 1.0 === 1; -0 === 0
    case 'object': {
      if (typeof value.toJSON === 'function') return canonicalise(value.toJSON(), path);
      if (Array.isArray(value)) {
        return '[' + value.map((v, i) => (v === undefined || typeof v === 'function' || typeof v === 'symbol')
          ? 'null' : canonicalise(v, path + '[' + i + ']')).join(',') + ']';
      }
      const parts = [];
      for (const k of Object.keys(value).sort()) {
        const v = value[k];
        if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;   // as JSON.stringify
        parts.push(JSON.stringify(k) + ':' + canonicalise(v, path + '.' + k));
      }
      return '{' + parts.join(',') + '}';
    }
    default:
      throw fail('canonicalHash: unsupported ' + typeof value + ' at ' + path, { path });
  }
}

async function canonicalHash(obj) {
  if (obj === undefined) throw fail('canonicalHash: undefined at $', { path: '$' });
  const text = canonicalise(obj, '$');
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw fail('canonicalHash: crypto.subtle is unavailable (needs https or localhost)');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return 'sha256:' + hex;
}

/* ── run validation (client side, mirrors run-record.schema.json) ────── */

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** Returns the first problem as {path, problem} or null. `skip` lists top-level fields not yet known. */
function findProblem(rec, skip) {
  if (!isObj(rec)) return { path: '$', problem: 'must be an object' };
  for (const k of REQUIRED) {
    if (skip.includes(k)) continue;
    if (rec[k] === undefined || rec[k] === null) return { path: '$.' + k, problem: 'is required' };
  }
  const str = (k, re, what) => {
    if (skip.includes(k) || rec[k] === undefined) return null;
    if (typeof rec[k] !== 'string' || !rec[k]) return { path: '$.' + k, problem: 'must be a non-empty string' };
    if (re && !re.test(rec[k])) return { path: '$.' + k, problem: 'must be ' + what };
    return null;
  };
  const checks = [
    str('id', RE.uuid, 'a uuid'), str('job'), str('tool_version', RE.semver, 'a semantic version like 1.2.3'),
    str('tool_commit', RE.commit, '7 to 40 hex characters'), str('author'), str('project_id'),
    str('legal_tag', RE.legalTag, 'like lt-firm-internal'), str('input_hash', RE.hash, 'sha256:<64 hex>'),
  ];
  for (const c of checks) if (c) return c;
  if (!skip.includes('created_at') && (typeof rec.created_at !== 'string' || Number.isNaN(Date.parse(rec.created_at)))) {
    return { path: '$.created_at', problem: 'must be an ISO date-time string' };
  }
  if (!STATUSES.includes(rec.status)) return { path: '$.status', problem: 'must be one of ' + STATUSES.join(', ') };
  if (!Array.isArray(rec.inputs)) return { path: '$.inputs', problem: 'must be an array' };
  for (let i = 0; i < rec.inputs.length; i++) {
    const it = rec.inputs[i];
    if (!isObj(it)) return { path: '$.inputs[' + i + ']', problem: 'must be an object' };
    if (typeof it.ref !== 'string' || !it.ref) return { path: '$.inputs[' + i + '].ref', problem: 'is required' };
    if (!INPUT_KINDS.includes(it.kind)) return { path: '$.inputs[' + i + '].kind', problem: 'must be one of ' + INPUT_KINDS.join(', ') };
  }
  if (!isObj(rec.params)) return { path: '$.params', problem: 'must be an object' };
  if (!isObj(rec.outputs)) return { path: '$.outputs', problem: 'must be an object' };
  for (const k of Object.keys(rec.outputs)) {
    if (!isObj(rec.outputs[k]) || !('value' in rec.outputs[k])) return { path: '$.outputs.' + k + '.value', problem: 'is required' };
    // Wave 7 (03-data-hierarchy.md §7.4): a number travels with its unit or it does not travel at all.
    const o = rec.outputs[k];
    if (typeof o.value === 'number' && (typeof o.unit !== 'string' || !o.unit)) return { path: '$.outputs.' + k + '.unit', problem: 'is required for a numeric output' };
  }
  if (rec.assumptions !== undefined) {
    if (!isObj(rec.assumptions)) return { path: '$.assumptions', problem: 'must be an object' };
    for (const k of Object.keys(rec.assumptions)) {
      const a = rec.assumptions[k];
      if (!isObj(a) || !('value' in a)) return { path: '$.assumptions.' + k + '.value', problem: 'is required' };
      if (typeof a.source !== 'string' || !a.source) return { path: '$.assumptions.' + k + '.source', problem: 'is required' };
    }
  }
  return null;
}

function validateRun(rec, skip = []) {
  const p = findProblem(rec, skip);
  if (p) throw fail('Invalid run record: ' + p.path + ' ' + p.problem, { code: 'invalid_run', path: p.path });
}

/* ── mode, me ────────────────────────────────────────────────────────── */

function mode() { return MODE; }

function setMode(next) {
  const was = MODE;
  MODE = next;
  if (was !== 'server' && next === 'server' && readQueue().length) flushQueue().catch(() => {});
}

/** Probe GET /api/me. 200 -> server mode and the Person; anything else -> local mode and null. */
async function probe(force) {
  if (!force && MODE === 'server' && PERSON) return PERSON;
  if (meInflight) return meInflight;
  meInflight = (async () => {
    try {
      const res = await request('/api/me');
      if (res.status === 200) {
        const person = await readJson(res);
        PERSON = person && typeof person === 'object' ? (person.user || person) : null;
        setMode('server');
        return PERSON;
      }
    } catch (e) { /* no backend */ }
    PERSON = null;
    MODE = 'local';
    return null;
  })();
  try { return await meInflight; } finally { meInflight = null; }
}

function me() { return probe(false); }

/* ── resolve ─────────────────────────────────────────────────────────── */

async function fetchResolve(toolId) {
  const res = await request('/api/tools/' + encodeURIComponent(toolId) + '/resolve');
  if (!res.ok) throw await httpError(res, 'resolve(' + toolId + ')');
  const body = await readJson(res);
  if (!isObj(body) || typeof body.version !== 'string' || typeof body.commit !== 'string') {
    throw fail('resolve(' + toolId + ') returned an unexpected payload');
  }
  return body;
}

function ensureVisibilityHook() {
  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== 'function' || hookedDocument === doc) return;
  hookedDocument = doc;
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') return;
    // Back in the foreground: refetch every cached tool. Callers that resolve
    // meanwhile wait for the fresh answer; if the refetch fails they get the old one.
    for (const [id, old] of Array.from(resolveCache)) {
      const fresh = fetchResolve(id).catch(() => old);
      resolveCache.set(id, fresh);
      fresh.catch(() => { if (resolveCache.get(id) === fresh) resolveCache.delete(id); });
    }
  });
}

function resolve(toolId) {
  if (typeof toolId !== 'string' || !toolId) return Promise.reject(fail('resolve: toolId is required'));
  ensureVisibilityHook();
  let p = resolveCache.get(toolId);
  if (!p) {
    p = fetchResolve(toolId);
    resolveCache.set(toolId, p);
    p.catch(() => { if (resolveCache.get(toolId) === p) resolveCache.delete(toolId); });   // never cache a failure
  }
  return p;
}

/* ── local queue ─────────────────────────────────────────────────────── */

function readQueue() {
  try {
    const q = JSON.parse(lsGet(QUEUE_KEY) || '[]');
    return Array.isArray(q) ? q : [];
  } catch (e) { return []; }
}
function writeQueue(q) { lsSet(QUEUE_KEY, JSON.stringify(q)); }
function enqueue(entry) { const q = readQueue(); q.push(entry); writeQueue(q); }
function dequeue(id) { writeQueue(readQueue().filter((e) => e.record.id !== id)); }
function updateQueued(id, patch) {
  writeQueue(readQueue().map((e) => (e.record.id === id ? Object.assign({}, e, patch) : e)));
}

function queuedRun(entry) { return Object.assign({}, entry.record, { queued: true }); }

/* ── the asset the page was opened with (wave 7, W7-AC14) ────────────── */

const ASSET_ID_RE = /^[a-z]+:[a-z0-9][a-z0-9:._-]{0,118}$/;

/**
 * The Hub opens a tool on a field or well with ?asset=<id> beside ?project=<id>. The id is read here, never by the
 * page, so a public tool page stays byte-identical; it lands in asset_ids on every run the page saves.
 */
function pageAsset() {
  try {
    const v = new URLSearchParams(globalThis.location.search || '').get('asset');
    return v && ASSET_ID_RE.test(v) ? v : null;
  } catch (e) { return null; }
}

/* ── saving ──────────────────────────────────────────────────────────── */

/** Build a complete record. Validation of caller fields and hashing happen before any network call. */
async function buildRecord(partial, opts, supersedes) {
  if (!isObj(partial)) throw fail('Invalid run record: $ must be an object', { code: 'invalid_run', path: '$' });
  validateRun(partial, FILLED);
  const toolId = (opts && opts.toolId) || partial.job;
  const input_hash = await canonicalHash({ inputs: partial.inputs, params: partial.params, assumptions: partial.assumptions || {} });

  const person = await me();
  let version = null;
  try { version = await resolve(toolId); } catch (e) { /* local mode, or registry down */ }

  const record = Object.assign({}, partial, {
    id: globalThis.crypto.randomUUID(),
    created_at: new Date().toISOString(),
    input_hash,
  });
  const asset = pageAsset();
  if (asset) {
    const given = Array.isArray(partial.asset_ids) ? partial.asset_ids.slice() : [];
    record.asset_ids = given.indexOf(asset) >= 0 ? given : given.concat([asset]);
  }
  if (person && person.id) record.author = person.id;
  if (version) { record.tool_version = version.version; record.tool_commit = version.commit; }
  if (supersedes) record.supersedes = supersedes;

  // Server mode needs the record whole. In local mode author / tool_version /
  // tool_commit may still be unknown; they are filled when the queue flushes.
  const missing = FILLED.filter((k) => record[k] === undefined || record[k] === null);
  if (MODE === 'server') validateRun(record);
  else validateRun(record, missing);
  return { record, toolId, supersedes: supersedes || null };
}

function permanent(status) { return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429; }

/** POST one built record. Returns the parsed body, or null when it should be queued instead. */
async function post(built) {
  const path = built.supersedes ? '/api/runs/' + encodeURIComponent(built.supersedes) + '/supersede' : '/api/runs';
  let res;
  try { res = await request(path, { method: 'POST', body: built.record }); }
  catch (e) { return null; }                        // offline: queue
  if (res.ok) {
    const body = await readJson(res);
    return { id: (body && body.id) || built.record.id, deduplicated: !!(body && body.deduplicated) };
  }
  if (permanent(res.status)) throw await httpError(res, 'Saving the run');
  return null;                                      // 401, 5xx: queue
}

async function submit(partial, opts, supersedes) {
  const built = await buildRecord(partial, opts, supersedes);
  if (MODE === 'server') {
    const sent = await post(built);
    if (sent) return { id: sent.id, deduplicated: sent.deduplicated, queued: false };
    MODE = 'local';                                 // the API stopped answering; the next me() re-probes
    PERSON = null;
  }
  enqueue({ record: built.record, toolId: built.toolId, supersedes: built.supersedes, queued_at: new Date().toISOString() });
  return { id: built.record.id, deduplicated: false, queued: true };
}

function saveRun(partial, opts) { return submit(partial, opts, null); }

function supersede(oldId, partial, opts) {
  if (typeof oldId !== 'string' || !oldId) return Promise.reject(fail('supersede: oldId is required'));
  return submit(partial, opts, oldId).then((r) => ({ id: r.id, deduplicated: r.deduplicated, queued: r.queued }));
}

async function fillPending(entry) {
  const rec = Object.assign({}, entry.record);
  if (!rec.author) { const p = await me(); if (p && p.id) rec.author = p.id; }
  if (!rec.tool_version || !rec.tool_commit) {
    const v = await resolve(entry.toolId || rec.job);
    rec.tool_version = v.version; rec.tool_commit = v.commit;
  }
  return rec;
}

function flushQueue() {
  if (flushInflight) return flushInflight;
  flushInflight = (async () => {
    await probe(true);
    if (MODE !== 'server') return 0;
    let sent = 0;
    for (const entry of readQueue()) {
      if (entry.error && entry.error.permanent) continue;          // needs a person to look at it
      let record;
      try { record = await fillPending(entry); validateRun(record); }
      catch (e) {
        if (e.code === 'invalid_run') { updateQueued(entry.record.id, { error: { permanent: true, message: e.message } }); continue; }
        break;                                                     // registry unreachable: try later
      }
      let res;
      try {
        const path = entry.supersedes ? '/api/runs/' + encodeURIComponent(entry.supersedes) + '/supersede' : '/api/runs';
        res = await request(path, { method: 'POST', body: record });
      } catch (e) { break; }                                       // offline again
      if (res.ok) { dequeue(entry.record.id); sent++; continue; }
      if (permanent(res.status)) {
        const err = await httpError(res, 'Saving the run');
        updateQueued(entry.record.id, { error: { permanent: true, status: res.status, message: err.message } });
        continue;
      }
      break;                                                       // 401 / 5xx: keep the rest queued
    }
    return sent;
  })();
  const p = flushInflight;
  const clear = () => { if (flushInflight === p) flushInflight = null; };
  p.then(clear, clear);
  return p;
}

/* ── reading ─────────────────────────────────────────────────────────── */

async function loadRun(id) {
  if (typeof id !== 'string' || !id) throw fail('loadRun: id is required');
  const queued = readQueue().find((e) => e.record.id === id);
  if (queued) return queuedRun(queued);
  await me();
  if (MODE !== 'server') throw fail('Run ' + id + ' is not on this device and the Vault is not reachable', { code: 'not_found' });
  const res = await request('/api/runs/' + encodeURIComponent(id));
  if (!res.ok) throw await httpError(res, 'loadRun(' + id + ')');
  return readJson(res);
}

function matchesQuery(rec, q) {
  return (!q.project || rec.project_id === q.project) && (!q.job || rec.job === q.job) && (!q.status || rec.status === q.status);
}

async function listRuns(q = {}) {
  const queued = readQueue().filter((e) => matchesQuery(e.record, q)).map(queuedRun);
  await me();
  if (MODE !== 'server') return queued;
  const params = new URLSearchParams();
  for (const k of ['project', 'job', 'status']) if (q[k]) params.set(k, q[k]);
  const qs = params.toString();
  const res = await request('/api/runs' + (qs ? '?' + qs : ''));
  if (!res.ok) throw await httpError(res, 'listRuns');
  const body = await readJson(res);
  const runs = Array.isArray(body) ? body : (body && (body.runs || body.items)) || [];
  const seen = new Set(runs.map((r) => r.id));
  return runs.concat(queued.filter((r) => !seen.has(r.id)));
}

async function find(q, scope) {
  if (typeof q !== 'string' || !q.trim()) return [];
  await me();
  if (MODE !== 'server') return [];
  const params = new URLSearchParams({ q });
  if (scope) params.set('scope', scope);
  const res = await request('/api/search?' + params.toString());
  if (res.status === 501) return [];                // search arrives with M12
  if (!res.ok) throw await httpError(res, 'find');
  const body = await readJson(res);
  return Array.isArray(body) ? body : (body && (body.hits || body.results)) || [];
}

/* ── UI: minimal, inline-styled, brand tokens with fallbacks ─────────── */

const T = {
  navy: 'var(--navy, #0B1F3A)', navyMid: 'var(--navy-mid, #132845)', gold: 'var(--gold, #C9A84C)',
  cream: 'var(--cream, #F8F5EE)', white: 'var(--white, #FFFFFF)', steel: 'var(--steel, #6B7A8D)', rule: 'var(--rule, #D8DCE2)',
  body: "var(--font-body, 'Barlow', system-ui, sans-serif)", label: "var(--font-label, 'Barlow Condensed', system-ui, sans-serif)",
};

function lang() {
  try { return (globalThis.document.documentElement.lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en'; }
  catch (e) { return 'en'; }
}
function bilingual(node, en, es) {
  node.setAttribute('data-en', en); node.setAttribute('data-es', es);
  node.textContent = lang() === 'es' ? es : en;
  return node;
}
function safeHref(u) { return typeof u === 'string' && /^(https?:\/\/|\/|\.\/|\.\.\/|[\w-]+\.html)/i.test(u) ? u : null; }

function mountFind(el, scope) {
  const doc = globalThis.document;
  if (!el || !doc) return;
  el.textContent = '';
  const wrap = doc.createElement('div');
  wrap.style.cssText = 'font-family:' + T.body + ';color:' + T.navy + ';background:' + T.cream + ';border:1px solid ' + T.rule + ';padding:12px;max-width:640px';
  const label = bilingual(doc.createElement('label'), 'Search the Vault', 'Buscar en el Vault');
  label.style.cssText = 'display:block;font-family:' + T.label + ';font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:' + T.gold + ';margin-bottom:6px';
  const input = doc.createElement('input');
  input.type = 'search';
  input.setAttribute('autocomplete', 'off');
  input.style.cssText = 'box-sizing:border-box;width:100%;padding:8px 10px;font:inherit;color:' + T.navy + ';background:' + T.white + ';border:1px solid ' + T.rule + ';border-radius:0';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  status.style.cssText = 'font-size:13px;color:' + T.steel + ';margin-top:8px;min-height:1em';
  const list = doc.createElement('ul');
  list.style.cssText = 'list-style:none;margin:8px 0 0;padding:0';
  wrap.append(label, input, status, list);
  el.appendChild(wrap);

  let timer = null, seq = 0;
  function say(en, es) { if (en) bilingual(status, en, es); else { status.textContent = ''; status.removeAttribute('data-en'); status.removeAttribute('data-es'); } }
  async function run() {
    const term = input.value.trim();
    const mine = ++seq;
    list.textContent = '';
    if (!term) { say(''); return; }
    say('Searching…', 'Buscando…');
    let hits;
    try { hits = await find(term, scope); }
    catch (e) { if (mine === seq) say('Search failed. Try again.', 'La búsqueda falló. Inténtelo de nuevo.'); return; }
    if (mine !== seq) return;
    if (MODE !== 'server') { say('Search needs the Vault server.', 'La búsqueda requiere el servidor del Vault.'); return; }
    if (!hits.length) { say('No results.', 'Sin resultados.'); return; }
    say('');
    for (const h of hits.slice(0, 20)) {
      const li = doc.createElement('li');
      li.style.cssText = 'padding:8px 0;border-top:1px solid ' + T.rule;
      const href = safeHref(h && h.url);
      const title = doc.createElement(href ? 'a' : 'span');
      if (href) title.href = href;
      title.textContent = String((h && (h.title || h.ref || h.id)) || '');
      title.style.cssText = 'font-weight:600;color:' + T.navy + ';text-decoration:none';
      li.appendChild(title);
      const snippet = h && (h.snippet || h.text);
      if (snippet) {
        const s = doc.createElement('div');
        s.textContent = String(snippet);
        s.style.cssText = 'font-size:13px;color:' + T.navyMid + ';margin-top:2px';
        li.appendChild(s);
      }
      list.appendChild(li);
    }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { clearTimeout(timer); run(); } });
}

/** Remembered project for this page (localStorage), keyed by pathname. */
function projectKey() {
  let path = '';
  try { path = globalThis.location.pathname || ''; } catch (e) { /* no location */ }
  return PROJECT_KEY + ':' + path;
}

/**
 * Small project picker. With an element: lists GET /api/projects in a <select>, restores the
 * remembered choice, saves changes, and fires a 'vault:project' CustomEvent on the element.
 * Resolves to the chosen project id (or null). Without an element it just returns the remembered id.
 */
async function pickProject(el) {
  // Wave 2: the Hub opens a tool inside a project with ?project=<id>; that context beats the remembered one and is remembered.
  let fromUrl = null;
  try { const v = new URLSearchParams(globalThis.location.search || '').get('project'); if (v && /^[a-z0-9][a-z0-9-]{1,63}$/.test(v)) fromUrl = v; } catch (e) { /* no location */ }
  if (fromUrl) lsSet(projectKey(), fromUrl);
  const remembered = fromUrl || lsGet(projectKey());
  const doc = globalThis.document;
  if (!el || !doc) return remembered;
  el.textContent = '';
  const select = doc.createElement('select');
  select.setAttribute('aria-label', 'Project');
  select.style.cssText = 'font-family:' + T.body + ';font-size:14px;color:' + T.navy + ';background:' + T.white + ';border:1px solid ' + T.rule + ';padding:6px 8px;border-radius:0';
  el.appendChild(select);
  const option = (value, en, es) => {
    const o = doc.createElement('option'); o.value = value;
    if (es) bilingual(o, en, es); else o.textContent = en;
    select.appendChild(o);
  };
  await me();
  let projects = [];
  if (MODE === 'server') {
    try {
      const res = await request('/api/projects');
      if (res.ok) { const b = await readJson(res); projects = Array.isArray(b) ? b : (b && b.projects) || []; }
    } catch (e) { /* leave empty */ }
  }
  if (!projects.length) {
    option('', MODE === 'server' ? 'No projects' : 'Vault offline', MODE === 'server' ? 'Sin proyectos' : 'Vault sin conexión');
    select.disabled = true;
    return remembered;
  }
  option('', 'Choose a project', 'Elija un proyecto');
  for (const p of projects) option(String(p.id), String(p.name || p.title || p.id));
  const known = projects.some((p) => String(p.id) === remembered);
  select.value = known ? remembered : '';
  if (!known && fromUrl) lsSet(projectKey(), '');          // an id the caller cannot see is not kept
  select.addEventListener('change', () => {
    lsSet(projectKey(), select.value);
    if (typeof globalThis.CustomEvent === 'function') el.dispatchEvent(new globalThis.CustomEvent('vault:project', { detail: { projectId: select.value || null }, bubbles: true }));
  });
  return known ? remembered : null;
}

/* ── wave 8 PR 2: the project's files, an original's bytes, and the picker ── */
/* docs/vault-hub/wave8/02-files-and-picker.md, W8-AC12. The structure lives in the Vault (folder paths on the
   records), never in the storage bucket; the bytes come through the originals route with the session cookie. */

/** The files of a project, as GET /api/projects/:id/files lists them (W8-AC9). Local mode: []. */
async function files(projectId) {
  if (typeof projectId !== 'string' || !projectId) throw fail('files: projectId is required');
  await me();
  if (MODE !== 'server') return [];
  const res = await request('/api/projects/' + encodeURIComponent(projectId) + '/files');
  if (!res.ok) throw await httpError(res, 'files(' + projectId + ')');
  const body = await readJson(res);
  return Array.isArray(body) ? body : (body && Array.isArray(body.files) ? body.files : []);
}

/** RFC 6266: filename*=UTF-8''… first, then filename="…". */
function dispositionFilename(header) {
  if (typeof header !== 'string') return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim()); } catch (e) { return star[1].trim(); } }
  const plain = /filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)/.exec(header);
  return plain ? (plain[1] || plain[2] || '').trim() || null : null;
}

/**
 * The bytes of a record's original: GET /api/items/:id/original[?version=N], scope-checked by the Vault, with the
 * session cookie. Resolves { id, version, bytes: Uint8Array, mime, filename }.
 */
async function readOriginal(id, opts = {}) {
  if (typeof id !== 'string' || !RE.uuid.test(id)) throw fail('readOriginal: a record id is required');
  if (noNetwork()) throw fail('Vault API is not reachable from file://', { code: 'offline' });
  if (typeof globalThis.fetch !== 'function') throw fail('fetch is not available', { code: 'offline' });
  const version = opts.version != null ? Number(opts.version) : null;
  const q = version ? '?version=' + encodeURIComponent(String(version)) : '';
  const init = { method: 'GET', headers: { accept: '*/*' }, cache: 'no-store', credentials: 'same-origin' };
  let timer = null;
  if (typeof AbortController !== 'undefined') { const ac = new AbortController(); init.signal = ac.signal; timer = setTimeout(() => ac.abort(), ORIGINAL_TIMEOUT_MS); }
  let res;
  try { res = await globalThis.fetch(apiBase + '/api/items/' + encodeURIComponent(id) + '/original' + q, init); }
  finally { if (timer) clearTimeout(timer); }
  if (!res.ok) throw await httpError(res, 'readOriginal(' + id + ')');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
  const filename = (typeof opts.filename === 'string' && opts.filename) || dispositionFilename(res.headers.get('content-disposition')) || id;
  return { id, version: version || null, bytes, mime, filename };
}

const ACCEPTS = (accept) => (Array.isArray(accept) ? accept : typeof accept === 'string' ? accept.split(',') : [])
  .map((a) => String(a).trim().toLowerCase().replace(/^\*?\./, '.')).filter(Boolean);
function acceptsFile(file, accept, kinds) {
  if (kinds && kinds.length && !kinds.includes(kindOf(file))) return false;
  if (!accept.length) return true;
  const name = String(file.name || '').toLowerCase();
  const mime = String(file.mime || '').toLowerCase();
  return accept.some((a) => (a.startsWith('.') ? name.endsWith(a) : a.endsWith('/*') ? mime.startsWith(a.slice(0, -1)) : mime === a));
}

/**
 * A dialog over the page listing the project's files in their folders (the same tree the Hub's Files tab draws),
 * with a find box and the kind chips. Resolves the chosen record ({id, name, path, type, mime, version, …}) or
 * null when closed. opts: { project, accept: ['.xlsx', '.csv'] | 'text/csv', kinds: ['sheet'], title: {en, es} }.
 * Local mode resolves null without a request. Inline styles, brand tokens, no style.css (M04, AC5).
 */
async function pickItem(opts = {}) {
  const project = typeof opts.project === 'string' ? opts.project : '';
  if (!project) throw fail('pickItem: project is required');
  await me();
  const doc = globalThis.document;
  if (MODE !== 'server' || !doc || typeof doc.createElement !== 'function') return null;
  let all;
  try { all = await files(project); } catch (e) { all = e; }
  const accept = ACCEPTS(opts.accept);
  const kinds = Array.isArray(opts.kinds) ? opts.kinds : null;
  const listed = Array.isArray(all) ? all.filter((f) => acceptsFile(f, accept, kinds)) : [];
  const title = opts.title && typeof opts.title === 'object' ? opts.title : { en: 'Open from the Vault', es: 'Abrir desde el Vault' };

  return new Promise((resolve) => {
    const state = { term: '', kinds: new Set() };
    const hasDialog = typeof globalThis.HTMLDialogElement === 'function';
    const root = doc.createElement(hasDialog ? 'dialog' : 'div');
    root.setAttribute('data-vault-picker', project);
    root.setAttribute('aria-label', lang() === 'es' ? title.es : title.en);
    root.style.cssText = (hasDialog ? '' : 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(11,31,58,.55);')
      + 'padding:0;border:none;background:transparent;max-width:none;max-height:none;';
    const box = doc.createElement('div');
    box.style.cssText = 'box-sizing:border-box;width:min(720px,94vw);max-height:min(80vh,760px);display:flex;flex-direction:column;background:' + T.white + ';color:' + T.navy
      + ';border:1px solid ' + T.rule + ';border-radius:12px;box-shadow:0 20px 60px rgba(11,31,58,.28);font-family:' + T.body + ';font-size:14px;overflow:hidden';
    root.appendChild(box);

    const head = doc.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid ' + T.rule + ';background:' + T.cream;
    const h = bilingual(doc.createElement('div'), title.en, title.es);
    h.style.cssText = 'font-family:' + T.label + ';font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:' + T.gold + ';flex:1';
    const proj = doc.createElement('span'); proj.textContent = project; proj.style.cssText = 'font-size:12.5px;color:' + T.steel;
    const close = bilingual(doc.createElement('button'), 'Cancel', 'Cancelar');
    close.type = 'button'; close.setAttribute('data-vault-picker-cancel', '');
    close.style.cssText = 'font:inherit;font-size:13px;color:' + T.navy + ';background:' + T.white + ';border:1px solid ' + T.rule + ';border-radius:999px;padding:5px 14px;cursor:pointer';
    head.append(h, proj, close);

    const bar = doc.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:8px 12px;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid ' + T.rule;
    const input = doc.createElement('input');
    input.type = 'search'; input.setAttribute('autocomplete', 'off'); input.setAttribute('data-vault-picker-find', '');
    input.placeholder = lang() === 'es' ? 'Buscar un archivo' : 'Find a file';
    input.style.cssText = 'box-sizing:border-box;flex:1 1 220px;min-width:160px;padding:7px 12px;font:inherit;color:' + T.navy + ';background:' + T.cream + ';border:1px solid ' + T.rule + ';border-radius:999px';
    bar.appendChild(input);
    const present = new Set(listed.map(kindOf));
    for (const k of ['pdf', 'sheet', 'image', 'mail', 'doc', 'other']) {
      if (!present.has(k)) continue;
      const chip = bilingual(doc.createElement('button'), KINDS[k].en, KINDS[k].es);
      chip.type = 'button'; chip.setAttribute('data-kind', k); chip.setAttribute('aria-pressed', 'false');
      const off = 'font:inherit;font-size:12.5px;border:1px solid ' + T.rule + ';background:' + T.white + ';color:' + T.navyMid + ';border-radius:999px;padding:2px 11px;cursor:pointer';
      chip.style.cssText = off;
      chip.addEventListener('click', () => {
        if (state.kinds.has(k)) state.kinds.delete(k); else state.kinds.add(k);
        const on = state.kinds.has(k);
        chip.setAttribute('aria-pressed', String(on));
        chip.style.cssText = on ? off + ';background:' + T.navy + ';color:' + T.white + ';border-color:' + T.navy : off;
        paint();
      });
      bar.appendChild(chip);
    }
    const status = doc.createElement('span'); status.setAttribute('role', 'status'); status.setAttribute('data-vault-picker-status', '');
    status.style.cssText = 'margin-left:auto;font-size:12.5px;color:' + T.steel;
    bar.appendChild(status);

    const body = doc.createElement('div');
    body.style.cssText = 'overflow:auto;padding:6px 10px 12px;flex:1 1 auto;min-height:120px';
    box.append(head, bar, body);

    let timer = null;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.term = input.value; paint(); }, 120); });

    const finish = (value) => {
      if (root.__done) return; root.__done = true;
      try { if (hasDialog && root.open) root.close(); } catch (e) { /* already closed */ }
      if (root.parentNode) root.parentNode.removeChild(root);
      resolve(value);
    };
    close.addEventListener('click', () => finish(null));
    root.addEventListener('cancel', (ev) => { ev.preventDefault(); finish(null); });
    root.addEventListener('click', (ev) => { if (ev.target === root) finish(null); });
    root.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(null); } });

    function row(f) {
      const b = doc.createElement('button');
      b.type = 'button'; b.setAttribute('data-file-id', f.id); b.setAttribute('data-kind', kindOf(f));
      b.style.cssText = 'display:flex;align-items:baseline;gap:10px;width:100%;box-sizing:border-box;padding:8px 10px;border:none;background:none;text-align:left;font:inherit;color:' + T.navy + ';cursor:pointer;border-radius:8px';
      const name = doc.createElement('span'); name.textContent = f.name || f.title || f.id; name.style.cssText = 'font-weight:500;overflow-wrap:anywhere';
      const meta = doc.createElement('span'); meta.style.cssText = 'font-size:12px;color:' + T.steel + ';white-space:nowrap';
      meta.textContent = [Number(f.version) > 1 ? 'v' + f.version : '', (f.authored_at || f.created_at || '').slice(0, 10), fmtSize(f.size)].filter(Boolean).join(' · ');
      b.append(name, meta);
      b.addEventListener('mouseenter', () => { b.style.background = T.cream; });
      b.addEventListener('mouseleave', () => { b.style.background = 'none'; });
      b.addEventListener('click', () => finish(f));
      return b;
    }
    function folderNode(d, depth, open) {
      const det = doc.createElement('details');
      det.setAttribute('data-folder-name', d.name); det.setAttribute('data-count', String(d.count));
      det.open = open || depth === 0;
      det.style.cssText = 'margin-left:' + (depth ? 14 : 0) + 'px';
      const sum = doc.createElement('summary');
      sum.style.cssText = 'cursor:pointer;padding:7px 8px;font-weight:500;color:' + T.navy + ';border-radius:8px;list-style:none;display:flex;align-items:center;gap:8px';
      const label = d.group ? bilingual(doc.createElement('span'), GROUPS[d.group].en, GROUPS[d.group].es) : doc.createElement('span');
      if (!d.group) label.textContent = d.name;
      const n = doc.createElement('span'); n.textContent = String(d.count);
      n.style.cssText = 'font-size:11px;background:' + T.cream + ';border:1px solid ' + T.rule + ';border-radius:999px;padding:0 7px;line-height:17px;color:' + T.steel;
      sum.append(label, n); det.appendChild(sum);
      for (const sub of d.folders) det.appendChild(folderNode(sub, depth + 1, open));
      for (const f of d.files) det.appendChild(row(f));
      return det;
    }
    function paint() {
      body.textContent = '';
      if (!Array.isArray(all)) { bilingual(body.appendChild(doc.createElement('p')), 'The files could not be listed: ' + (all && all.message || 'error'), 'No se pudieron listar los archivos: ' + (all && all.message || 'error')); return; }
      const narrowed = !!(state.term.trim() || state.kinds.size);
      const shown = narrowed ? listed.filter((f) => matches(f, state.term, state.kinds)) : listed;
      bilingual(status, narrowed ? shown.length + ' of ' + listed.length + ' files' : listed.length + (listed.length === 1 ? ' file' : ' files'), narrowed ? shown.length + ' de ' + listed.length + ' archivos' : listed.length + (listed.length === 1 ? ' archivo' : ' archivos'));
      if (!shown.length) {
        const p = doc.createElement('p'); p.style.cssText = 'padding:24px 10px;text-align:center;color:' + T.steel;
        bilingual(p, listed.length ? 'No file matches.' : 'No file of that kind on this project yet.', listed.length ? 'Ningún archivo coincide.' : 'Aún no hay archivos de ese tipo en este proyecto.');
        body.appendChild(p); return;
      }
      const tree = buildTree(shown);
      // A short list opens every folder down to its files; a long one opens the top level and lets the find box narrow it.
      for (const d of tree.folders) body.appendChild(folderNode(d, 0, narrowed || shown.length <= 60));
    }
    paint();
    (doc.body || doc.documentElement).appendChild(root);
    if (hasDialog) { try { root.showModal(); } catch (e) { root.setAttribute('open', ''); } }
    try { input.focus(); } catch (e) { /* no focus */ }
  });
}

/** pickItem, then readOriginal, as a File the tool's own loader can take: { item, file } or null. */
async function pickFile(opts = {}) {
  const item = await pickItem(opts);
  if (!item) return null;
  const o = await readOriginal(item.id, { filename: item.name });
  const file = typeof globalThis.File === 'function' ? new globalThis.File([o.bytes], o.filename, { type: o.mime }) : { name: o.filename, type: o.mime, bytes: o.bytes };
  return { item, file, bytes: o.bytes, mime: o.mime };
}

/* ── configuration ───────────────────────────────────────────────────── */

/** Point the client at another origin (default same-origin ''). Resets mode and caches; keeps the queue. */
function configure(opts = {}) {
  if (typeof opts.apiBase === 'string') apiBase = opts.apiBase.replace(/\/+$/, '');
  MODE = 'local'; PERSON = null; meInflight = null; flushInflight = null;
  resolveCache.clear();
}

export const vault = {
  mode, me, resolve, canonicalHash, saveRun, loadRun, listRuns, supersede, find, mountFind, flushQueue,
  pickProject, pageAsset, configure,
  files, readOriginal, pickItem, pickFile,                   // wave 8 PR 2: the project's files and the picker
};
export { pickProject, pageAsset, configure, files, readOriginal, pickItem, pickFile };

// In a served page, learn the mode early so mode() is meaningful and a waiting queue drains.
if (typeof location !== 'undefined' && location && /^https?:$/.test(location.protocol)) {
  probe(false).catch(() => {});
}
