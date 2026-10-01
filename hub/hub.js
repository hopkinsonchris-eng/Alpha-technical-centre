/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB SCRIPT (M06)
   Fetch helpers, session display, error and empty states, and the
   section rendering for the Today page. Loaded as a module:
     <script type="module" src="hub.js"></script>
   Every string a person reads carries data-en and data-es so the
   shared main.js language toggle keeps working on rendered content.
   No secrets, no provider calls: this file only talks to /api/* on
   the same origin (behind Cloudflare Access) and to hub/catalog.json.
   ============================================================ */
import { createGlobe } from './globe.js';
import { vault } from '../js/vault-client.js';

/* ── language and DOM helpers ────────────────────────────────────────── */

export const lang = () => (document.documentElement.getAttribute('lang') === 'es' ? 'es' : 'en');

/**
 * Set an element's text in the current language and record both languages
 * on it. main.js renders data-en/data-es values containing "<" as HTML, so
 * anything with a "<" (only possible for data values) keeps its text but
 * gets no data attributes and can never be injected as markup.
 */
export function setText(el, en, es) {
  const e = String(en == null ? '' : en);
  const s = String(es == null ? e : es);
  if (e.indexOf('<') === -1 && s.indexOf('<') === -1) {
    el.setAttribute('data-en', e);
    el.setAttribute('data-es', s);
  } else {
    el.removeAttribute('data-en');
    el.removeAttribute('data-es');
  }
  el.textContent = lang() === 'es' ? s : e;
  return el;
}

/** Create an element with bilingual text. */
export function mk(tag, cls, en, es, attrs) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (en !== undefined && en !== null) setText(el, en, es);
  if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] !== undefined && attrs[k] !== null) el.setAttribute(k, attrs[k]);
  return el;
}

/** Create an element holding a data value (same text in both languages). */
export const dv = (tag, cls, value, attrs) => mk(tag, cls, value === undefined || value === null || value === '' ? '—' : value, undefined, attrs);

export function add(parent, ...kids) {
  for (const k of kids) if (k) parent.appendChild(k);
  return parent;
}
const $ = (sel, root) => (root || document).querySelector(sel);

/* ── fetch helpers ───────────────────────────────────────────────────── */

/** Never throws: {ok, status, body}. status 0 means the network failed. */
export async function api(path, init) {
  try {
    const opts = Object.assign({ headers: { accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' }, init || {});
    if (!opts.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) opts.signal = AbortSignal.timeout(10000);
    const res = await fetch(path, opts);
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
}

/** A list from an API body: the body itself, or the first of `keys` that is an array. */
export function listOf(body, ...keys) {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') for (const k of keys) if (Array.isArray(body[k])) return body[k];
  return [];
}

/* ── formatting ──────────────────────────────────────────────────────── */

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function fmtDateLong(d) {
  return {
    en: cap(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
    es: cap(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })),
  };
}
export function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { en: '—', es: '—' };
  const o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  return { en: d.toLocaleString('en-GB', o), es: d.toLocaleString('es-ES', o) };
}
export function fmtShortDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { en: '—', es: '—' };
  return { en: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), es: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) };
}
export function ago(iso, now) {
  const d = new Date(iso);
  if (isNaN(d)) return { en: '—', es: '—' };
  const days = Math.floor((now - d) / 864e5);
  if (days <= 0) return { en: 'Today', es: 'Hoy' };
  if (days === 1) return { en: 'Yesterday', es: 'Ayer' };
  if (days < 60) return { en: days + ' days ago', es: 'hace ' + days + ' días' };
  const w = Math.floor(days / 30);
  return { en: w + ' months ago', es: 'hace ' + w + ' meses' };
}
export const num = (v) => (typeof v === 'number' ? v.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : v);

export const LIFECYCLE = {
  production: ['Production', 'Producción', 'ok'],
  experimental: ['Experimental', 'Experimental', 'warn'],
  deprecated: ['Deprecated', 'Obsoleta', 'bad'],
  retired: ['Retired', 'Retirada', 'muted'],
};
export const KIND = {
  'browser-tool': ['Browser tool', 'Herramienta web'],
  'external-app': ['External app', 'App externa'],
  pipeline: ['Pipeline', 'Pipeline'],
  skill: ['Skill', 'Skill'],
};
export const RUN_STATUS = { draft: ['Draft', 'Borrador', 'muted'], reviewed: ['Reviewed', 'Revisada', 'info'], final: ['Final', 'Final', 'ok'], superseded: ['Superseded', 'Reemplazada', 'muted'] };
export const SECTION = { Added: 'Añadido', Changed: 'Cambiado', Fixed: 'Corregido', Removed: 'Eliminado', Deprecated: 'Obsoleto', Security: 'Seguridad' };

/* ── session display ─────────────────────────────────────────────────── */

const initials = (name) => String(name || '?').split(/[\s.@-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';

/** Fills the sidebar with the signed-in person, or "Signed out · local catalog". Returns the person or null. */
export async function showSession() {
  let person = null;
  try { person = await vault.me(); } catch (e) { person = null; }
  const av = $('#me-av'), name = $('#me-name'), role = $('#me-role');
  if (!av || !name || !role) return person;
  if (person && typeof person === 'object') {
    const n = person.name || person.email || person.id || '?';
    av.classList.remove('off');
    av.textContent = initials(n);
    setText(name, n);
    setText(role, String(person.role || '').toUpperCase() || '');
  } else {
    av.classList.add('off');
    av.textContent = '?';
    setText(name, 'Signed out · local catalog', 'Sin sesión · catálogo local');
    role.textContent = '';
  }
  return person;
}

export function showVault(reachable) {
  const dot = $('#vault-dot'), st = $('#vault-state');
  if (!dot || !st) return;
  dot.classList.toggle('off', !reachable);
  if (reachable) setText(st, 'Vault reachable', 'Vault accesible');
  else setText(st, 'Vault unreachable', 'Vault no accesible');
}

/* ── catalog logic ───────────────────────────────────────────────────── */

const STATIC_CATALOG = '../hub/catalog.json';

export async function loadCatalog() {
  const live = await api('/api/catalog');
  if (live.ok && live.body && Array.isArray(live.body.tools)) return { catalog: live.body, source: 'api' };
  try {
    const res = await fetch(STATIC_CATALOG, { cache: 'no-store' });
    if (res.ok) {
      const cat = await res.json();
      if (cat && Array.isArray(cat.tools)) return { catalog: cat, source: 'static' };
    }
  } catch (e) { /* fall through */ }
  return { catalog: null, source: 'none' };
}

/** Newest dated release in the tool's changelog, as 'YYYY-MM-DD', or ''. */
export function newestRelease(tool) {
  const dates = (tool.releases || []).map((r) => r && r.date).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dates.length ? dates[dates.length - 1] : '';
}
export function isNew(tool, now) {
  const d = newestRelease(tool);
  if (!d) return false;
  return (now - Date.parse(d + 'T00:00:00Z')) / 864e5 < 14;
}
/** The tool that replaces a deprecated one (aliases.current naming another tool id), or null. */
export function replacement(tool, byId) {
  const c = tool.aliases && tool.aliases.current;
  return tool.lifecycle === 'deprecated' && c && c !== tool.id && byId.has(c) ? byId.get(c) : null;
}
/** The manifest entry "Open current" goes to, following deprecated -> replacement. Relative paths resolve against the site root. */
export function openTarget(tool, byId, siteRoot) {
  let cur = tool;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const next = replacement(cur, byId);
    if (!next) break;
    cur = next;
  }
  return { href: new URL(cur.entry, siteRoot).href, external: cur.kind === 'external-app', tool: cur };
}

function toolCard(tool, byId, siteRoot, now) {
  const dep = replacement(tool, byId);
  const life = LIFECYCLE[tool.lifecycle] || [tool.lifecycle, tool.lifecycle, 'muted'];
  const card = mk('article', 'card hub-tool' + (tool.lifecycle === 'deprecated' || tool.lifecycle === 'retired' ? ' dep' : ''), null, null, { 'data-tool-id': tool.id });

  if (isNew(tool, now)) add(card, mk('span', 'hub-pill new hub-new', "What's new", 'Novedades'));

  const top = add(mk('div', 'hub-tool-top'),
    dv('h3', null, tool.name, { id: 'tn-' + tool.id }),
    mk('span', 'hub-pill ' + life[2], life[0], life[1], { 'data-lifecycle': tool.lifecycle }));
  add(card, top);

  const kind = KIND[tool.kind] || [tool.kind, tool.kind];
  add(card, add(mk('div', 'hub-tool-meta'),
    mk('span', 'hub-kind', kind[0], kind[1]),
    mk('span', null, 'Owner', 'Responsable'),
    dv('b', null, tool.owner)));

  if (tool.description) add(card, dv('p', 'hub-desc', tool.description));

  const version = dep ? ((tool.versions && tool.versions[0] && tool.versions[0].version) || (tool.aliases && tool.aliases.current)) : (tool.aliases && tool.aliases.current);
  // Wave 2: an external app's real version comes from the version.json it publishes (sidecar version_url, read by the Vault);
  // until it publishes one, the manifest version is a placeholder and the card says so.
  const live = tool.hub && tool.hub.live_version && tool.hub.live_version.version ? tool.hub.live_version : null;
  const unverified = !live && tool.hub && tool.hub.version_url;
  const ver = mk('div', 'hub-ver', null, null, { 'data-version-source': live ? 'live' : unverified ? 'unverified' : 'manifest' });
  add(ver, dv('b', null, live ? live.version : version, { 'data-version': '' }));
  if (live) {
    const rd = live.released_at ? fmtShortDate(live.released_at) : null;
    add(ver, add(mk('span'), mk('span', null, 'published by the app', 'publicada por la app'), rd ? mk('span', null, ' · ' + rd.en, ' · ' + rd.es) : null));
  } else if (dep) add(ver, mk('span', null, 'last version', 'última versión'));
  else add(ver, mk('span', null, 'current', 'actual'));
  add(card, ver);
  if (unverified) {
    add(card, add(mk('div', 'hub-tool-meta'),
      mk('span', 'hub-pill warn', 'Version unverified', 'Versión sin verificar'),
      mk('span', null, 'the app publishes no version.json yet', 'la app aún no publica version.json')));
  }

  if (dep) {
    add(card, add(mk('div', 'hub-replaced', null, null, { 'data-replaced-by': dep.id }),
      mk('span', null, 'Replaced by', 'Reemplazada por'), document.createTextNode(' '), dv('b', null, dep.name)));
  }

  const foot = mk('div', 'hub-tool-foot');
  if (tool.lifecycle !== 'retired') {
    const t = openTarget(tool, byId, siteRoot);
    const open = mk('a', 'btn btn-primary btn-sm', 'Open current', 'Abrir versión actual', { href: t.href, 'aria-describedby': 'tn-' + tool.id, 'data-open': tool.id });
    if (t.external) { open.setAttribute('target', '_blank'); open.setAttribute('rel', 'noopener noreferrer'); }
    add(foot, open);
  }
  const cl = mk('button', 'btn btn-outline btn-sm', 'Changelog', 'Registro de cambios', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'cl-' + tool.id, 'aria-describedby': 'tn-' + tool.id });
  add(foot, cl);
  add(card, foot);

  const panel = mk('div', 'hub-changelog', null, null, { id: 'cl-' + tool.id, hidden: '' });
  fillChangelog(panel, tool);
  add(card, panel);
  cl.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
    cl.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  return card;
}

function fillChangelog(panel, tool) {
  const rels = (tool.releases || []).filter((r) => r && (Object.keys(r.sections || {}).length || r.date));
  if (!rels.length) { add(panel, mk('p', 'hub-muted', 'No changelog entries.', 'Sin entradas en el registro de cambios.')); return; }
  for (const r of rels) {
    add(panel, add(mk('h4'), dv('b', null, r.version), r.date ? dv('span', null, r.date) : null));
    for (const sec of Object.keys(r.sections || {})) {
      add(panel, mk('span', 'sec', sec, SECTION[sec] || sec));
      const ul = mk('ul');
      for (const line of r.sections[sec]) add(ul, dv('li', null, line));
      add(panel, ul);
    }
  }
}

/* ── Today: catalog filter (wave 2, P17) ─────────────────────────────── */

const FILTER_KEY = 'hub.tools.filter';
const FILTER_DEFAULT = { production: true, experimental: false, deprecated: false };
const CHIP_LABEL = { production: ['Production', 'Producción'], experimental: ['Experimental', 'Experimental'], deprecated: ['Older', 'Antiguas'] };

function readFilter() {
  try { const v = JSON.parse(localStorage.getItem(FILTER_KEY) || ''); if (v && typeof v === 'object') return { ...FILTER_DEFAULT, ...v }; } catch (e) { /* no storage */ }
  return { ...FILTER_DEFAULT };
}

/**
 * Production tools show by default; experimental ones sit behind their chip; deprecated
 * ("older") tools live in a collapsed group under the grid. The choice is remembered per browser.
 */
function setupLifecycleFilter(tools) {
  const host = $('#tools-filter');
  if (!host) return;
  host.textContent = '';
  const state = readFilter();
  const counts = { production: 0, experimental: 0, deprecated: 0 };
  for (const t of tools) if (counts[t.lifecycle] !== undefined) counts[t.lifecycle]++;
  const apply = () => {
    let shown = 0;
    for (const t of tools) {
      const card = document.querySelector('[data-tool-id="' + CSS.escape(t.id) + '"]');
      if (!card) continue;
      const on = !!state[t.lifecycle];
      if (on) card.removeAttribute('hidden'); else card.setAttribute('hidden', '');
      if (on) shown++;
    }
    const older = $('#tools-older');
    if (older) { if (state.deprecated && counts.deprecated) older.removeAttribute('hidden'); else older.setAttribute('hidden', ''); }
    const empty = $('#tools-empty');
    if (empty) { if (shown) empty.setAttribute('hidden', ''); else empty.removeAttribute('hidden'); }
    for (const b of host.querySelectorAll('[data-lifecycle-chip]')) b.setAttribute('aria-pressed', String(!!state[b.getAttribute('data-lifecycle-chip')]));
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(state)); } catch (e) { /* no storage */ }
  };
  for (const key of ['production', 'experimental', 'deprecated']) {
    const b = mk('button', 'hub-chip', null, null, { type: 'button', 'data-lifecycle-chip': key, 'aria-pressed': String(!!state[key]) });
    add(b, mk('span', null, CHIP_LABEL[key][0], CHIP_LABEL[key][1]), document.createTextNode(' '), dv('span', 'n', String(counts[key])));
    b.addEventListener('click', () => { state[key] = !state[key]; apply(); });
    add(host, b);
  }
  const sum = $('#tools-older-sum');
  if (sum) setText(sum, 'Older tools (' + counts.deprecated + '): replaced or deprecated, kept for the runs that used them', 'Herramientas antiguas (' + counts.deprecated + '): reemplazadas u obsoletas, conservadas por las ejecuciones que las usaron');
  apply();
}

/* ── Today: sections ─────────────────────────────────────────────────── */

function notice(kind, boldEn, boldEs, en, es) {
  return add(mk('div', 'hub-notice ' + kind),
    add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
}

async function renderTools(person) {
  const grid = $('#tools-grid');
  const strip = $('#status-strip');
  const notices = $('#notices');
  const { catalog, source } = await loadCatalog();
  const now = Date.now();
  if (!catalog) {
    showVault(false);
    add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The catalog could not be loaded from the API or from hub/catalog.json.', 'No se pudo cargar el catálogo desde la API ni desde hub/catalog.json.'));
    setText($('#today-sub'), 'The catalog is not available.', 'El catálogo no está disponible.');
    return { tools: [], source };
  }
  const tools = catalog.tools.filter((t) => t.lifecycle !== 'retired');     // retired tools never appear
  const byId = new Map(catalog.tools.map((t) => [t.id, t]));
  const siteRoot = new URL('../', location.href);
  grid.textContent = '';
  const older = $('#tools-older-grid');
  if (older) older.textContent = '';
  for (const t of tools) add(t.lifecycle === 'deprecated' && older ? older : grid, toolCard(t, byId, siteRoot, now));
  setupLifecycleFilter(tools);

  const prod = tools.filter((t) => t.lifecycle === 'production').length;
  setText($('#today-sub'),
    tools.length + ' tools in the catalog, ' + prod + ' in production.',
    tools.length + ' herramientas en el catálogo, ' + prod + ' en producción.');

  if (source === 'api') {
    add(strip, mk('span', 'hub-pill ok', 'Catalog from the Vault', 'Catálogo del Vault'));
  } else {
    showVault(false);
    add(strip, mk('span', 'hub-pill warn', 'Catalog from hub/catalog.json', 'Catálogo de hub/catalog.json'));
    add(notices, notice('warn', 'The Vault is unreachable.', 'El Vault no es accesible.',
      'Showing the catalog from hub/catalog.json; versions and links may be out of date.',
      'Se muestra el catálogo de hub/catalog.json; las versiones y los enlaces pueden estar desactualizados.'));
  }
  if (catalog.built_at) {
    const d = fmtShortDate(catalog.built_at);
    add(strip, add(mk('span'), mk('span', null, 'Built', 'Generado'), document.createTextNode(' '), mk('span', null, d.en, d.es)));
  }
  if (source === 'api') showVault(true);

  // Signed in: let the Vault resolve @current so links follow the alias on the server. Best effort.
  if (person && source === 'api') {
    for (const t of tools) {
      if (t.lifecycle === 'retired') continue;
      const a = grid.querySelector('[data-open="' + t.id + '"]');
      if (!a) continue;
      vault.resolve(t.id).then((r) => { if (r && r.entry) a.setAttribute('href', new URL(r.entry, siteRoot).href); }).catch(() => {});
    }
  }
  return { tools, source };
}

const projectHref = (id) => 'project.html?id=' + encodeURIComponent(id);

function projectName(p) { return p.name || p.title || p.id; }
function clientName(p) { return p.client_name || (p.client && (p.client.name || p.client)) || p.client_id || ''; }
function pick(p, ...keys) { for (const k of keys) { const v = k.split('.').reduce((o, x) => (o == null ? o : o[x]), p); if (v !== undefined && v !== null) return v; } return undefined; }

async function renderProjects(person) {
  const res = await api('/api/projects?mine=1');
  if (!res.ok) return [];
  const list = listOf(res.body, 'projects', 'items').filter((p) => p && p.status !== 'archived');
  const sec = $('#sec-projects'), grid = $('#projects-grid');
  sec.removeAttribute('hidden');
  const now = Date.now();
  if (!list.length) {
    if (person && person.role === 'partner') add(grid, mk('div', 'hub-empty', 'No project activity in the last 90 days. Use New project to open one.', 'Sin actividad en proyectos en los últimos 90 días. Use Nuevo proyecto para abrir uno.'));
    else add(grid, mk('div', 'hub-empty', 'No project activity in the last 90 days.', 'Sin actividad en proyectos en los últimos 90 días.'));
    return [];
  }
  for (const p of list) {
    const card = mk('a', 'card hub-proj', null, null, { href: projectHref(p.id), 'data-project-id': p.id });
    add(card, dv('h3', null, projectName(p)));
    const cl = clientName(p);
    if (cl) add(card, dv('span', 'hub-muted', cl));
    const last = pick(p, 'last_activity_at', 'last_activity', 'updated_at');
    const a = last ? ago(last, now) : null;
    add(card, add(mk('div', 'hub-row'), mk('span', null, 'Last activity', 'Última actividad'), a ? mk('b', null, a.en, a.es) : dv('b', null, '—')));
    const runs = pick(p, 'run_count', 'runs_count', 'counts.runs', 'runs');
    const items = pick(p, 'item_count', 'items_count', 'counts.items', 'items');
    add(card, add(mk('div', 'hub-row'), mk('span', null, 'Runs · items', 'Ejecuciones · elementos'),
      dv('b', null, (typeof runs === 'number' ? runs : '—') + ' · ' + (typeof items === 'number' ? items : '—'))));
    const stale = pick(p, 'stale_count', 'counts.stale', 'stale');
    const n = typeof stale === 'number' ? stale : (Array.isArray(stale) ? stale.length : 0);
    add(card, add(mk('div', 'hub-row'), mk('span', null, 'Stale', 'Obsoletos'),
      mk('span', 'hub-stale' + (n ? '' : ' zero'), n + ' stale', n + ' obsoletos')));
    add(grid, card);
  }
  return list;
}

/* ── Today: the globe and the register (wave 2) ──────────────────────── */


export const STAGES = ['Initial screen', 'Qualified', 'Technical review', 'Commercial review', 'Negotiation', 'Won', 'Lost', 'Closed'];
export const STAGE_ES = { 'Initial screen': 'Cribado inicial', Qualified: 'Calificada', 'Technical review': 'Revisión técnica', 'Commercial review': 'Revisión comercial', Negotiation: 'Negociación', Won: 'Ganada', Lost: 'Perdida', Closed: 'Cerrada' };
export const RISK_LABEL = { green: ['Managed', 'Gestionado'], amber: ['Elevated', 'Elevado'], red: ['High', 'Alto'] };
const GEO_URL = '/hub/geo/countries-110m.json';
let geoPromise = null;
/** The country polygons (hub/geo), fetched once per page. */
export function loadGeo() {
  if (!geoPromise) geoPromise = fetch(GEO_URL, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return geoPromise;
}
const countryHref = (code) => 'index.html' + (code ? '?country=' + encodeURIComponent(code) : '');

function flags(att) {
  const out = [];
  if (att && att.stale) out.push(mk('span', 'hub-flag stale', att.stale + ' stale', att.stale + ' obsoletos'));
  if (att && att.filing) out.push(mk('span', 'hub-flag filing', att.filing + ' to file', att.filing + ' por archivar'));
  if (att && att.expiring_days !== null && att.expiring_days !== undefined) out.push(mk('span', 'hub-flag expiring', 'NDA ' + att.expiring_days + ' d', 'NDA ' + att.expiring_days + ' d'));
  return out;
}
const stagePill = (stage) => mk('span', 'hub-pill muted hub-stage', stage, STAGE_ES[stage] || stage, { 'data-stage': stage });
/** "risk 71 · advisory: reconsider travel (World Monitor, 09:00)" from the countries summary (wave 3); null without a reading. */
function riskLine(risk) {
  if (!risk || (risk.score === null && !risk.level)) return null;
  const el = mk('span', 'hub-risk-line', null, null, { 'data-risk-score': risk.score === null ? '' : String(risk.score) });
  const tone = risk.score === null ? '' : risk.score >= 70 ? 'red' : risk.score >= 40 ? 'amber' : 'green';
  if (tone) add(el, mk('span', 'hub-rag', null, null, { 'data-risk': tone, 'aria-hidden': 'true' }));
  if (risk.score !== null) add(el, mk('span', null, 'risk ' + Math.round(risk.score), 'riesgo ' + Math.round(risk.score)));
  if (risk.level) add(el, document.createTextNode(risk.score !== null ? ' · ' : ''), mk('span', null, 'advisory: ', 'aviso: '), dv('span', null, risk.level));
  const t = risk.fetched_at ? new Date(risk.fetched_at) : null;
  const hm = t && !isNaN(t) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  add(el, mk('span', 'hub-muted', ' (World Monitor' + (hm ? ', ' + hm : '') + ')', ' (World Monitor' + (hm ? ', ' + hm : '') + ')'));
  return el;
}
/** Where a field's location came from, for pills and tooltips (wave 3). */
export const SOURCE_WORD = {
  gem: ['GEM', 'GEM'], geonames: ['GeoNames', 'GeoNames'], wikidata: ['Wikidata', 'Wikidata'], vault: ['Vault', 'Vault'],
  document: ['from a document', 'de un documento'], manual: ['entered by hand', 'introducido a mano'],
};
export const sourceWord = (src) => { const w = SOURCE_WORD[src] || (src ? [src, src] : ['no location', 'sin ubicación']); return { en: w[0], es: w[1] }; };

/**
 * The globe and the country list. Countries come from GET /api/countries (only what the
 * caller may see); the polygons from hub/geo. The list is the keyboard and screen-reader path;
 * ?country=XX in the URL selects a country, and selecting one writes it back so the state is linkable.
 */
async function renderGlobe(person) {
  const sec = $('#sec-globe'), canvas = $('#globe');
  if (!sec || !canvas) return null;
  const [geo, res] = await Promise.all([loadGeo(), api('/api/countries')]);
  const data = res.ok && res.body && Array.isArray(res.body.countries) ? res.body : null;
  const count = $('#globe-count');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let globe = null;
  const tip = $('#globe-tip');
  if (geo) {
    try {
      globe = createGlobe(canvas, {
        geo, lang: lang(), reducedMotion: reduced,
        onSelect: (code, f, point) => select(code, true, point),
        onHover: (h) => {
          if (!h) { tip.setAttribute('hidden', ''); return; }
          tip.textContent = h.name; tip.style.left = h.x + 'px'; tip.style.top = h.y + 'px'; tip.removeAttribute('hidden');
        },
      });
    } catch (e) { globe = null; }
  }
  const names = new Map();
  if (geo) for (const f of geo.features) if (!names.has(f.properties.iso2)) names.set(f.properties.iso2, { en: f.properties.en, es: f.properties.es });
  const list = $('#country-list'), panel = $('#country-panel'), unplaced = $('#country-unplaced');
  list.textContent = '';

  if (!data) {
    setText(count, 'Vault data not available: the globe shows no projects.', 'Datos del Vault no disponibles: el globo no muestra proyectos.');
  } else {
    for (const c of data.countries) if (!names.has(c.code)) names.set(c.code, c.name);
    const nProj = data.countries.reduce((n, c) => n + c.projects.length, 0);
    setText(count, data.countries.length + (data.countries.length === 1 ? ' country' : ' countries') + ' · ' + nProj + (nProj === 1 ? ' project' : ' projects'),
      data.countries.length + (data.countries.length === 1 ? ' país' : ' países') + ' · ' + nProj + (nProj === 1 ? ' proyecto' : ' proyectos'));
    const held = new Map(), points = [];
    for (const c of data.countries) {
      held.set(c.code, { projects: c.projects.length, stale: c.counts.stale, expiring: c.counts.expiring });
      for (const p of c.projects) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) points.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon });
        // Wave 3: the project's fields with a located record, drawn smaller beside it.
        for (const a of p.assets || []) if (Number.isFinite(a.lat) && Number.isFinite(a.lon)) points.push({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, kind: 'field' });
      }
      const name = names.get(c.code) || c.name;
      const b = mk('button', 'hub-country', null, null, { type: 'button', 'data-country': c.code, role: 'listitem' });
      // The count and the risk are sibling spans so a language switch re-renders each without wiping the other.
      const nSpan = add(mk('span', 'n'), mk('span', null, c.projects.length + (c.projects.length === 1 ? ' project' : ' projects'), c.projects.length + (c.projects.length === 1 ? ' proyecto' : ' proyectos')));
      if (c.risk && c.risk.score !== null) add(nSpan, document.createTextNode(' · '), mk('span', 'hub-risk-n', 'risk ' + Math.round(c.risk.score), 'riesgo ' + Math.round(c.risk.score), { 'data-risk-score': String(c.risk.score) }));
      add(b, mk('span', 'name', name.en, name.es), nSpan,
        add(mk('span', 'flags'), ...flags({ stale: c.counts.stale, filing: c.counts.filing, expiring_days: c.counts.expiring ? Math.min(...c.projects.filter((p) => p.attention.expiring_days !== null).map((p) => p.attention.expiring_days)) : null })));
      b.addEventListener('click', () => select(c.code, true));
      add(list, b);
    }
    if (globe) globe.setData({ held, points });
    if (data.unplaced && data.unplaced.length) {
      unplaced.removeAttribute('hidden');
      const n = data.unplaced.length;
      add(unplaced, mk('span', null, n + (n === 1 ? ' project without a country: ' : ' projects without a country: '), n + (n === 1 ? ' proyecto sin país: ' : ' proyectos sin país: ')));
      data.unplaced.forEach((p, i) => { if (i) add(unplaced, document.createTextNode(', ')); add(unplaced, dv('a', 'hub-inline-link', p.name, { href: projectHref(p.id), 'data-country-project': p.id })); });
    }
  }

  // Wave 3: the point under the last tap (or the country's centre when chosen from the list) feeds "Create a project here".
  let tapped = null;
  function select(code, write, point) {
    const c = data && data.countries.find((x) => x.code === code);
    sec.setAttribute('data-country', code || '');
    tapped = point || (globe && code ? globe.centroidOf(code) : null);
    const brief = $('#country-brief'); if (brief) { brief.setAttribute('hidden', ''); brief.textContent = ''; }
    if (write) history.replaceState(null, '', countryHref(code));
    if (!code) {
      panel.setAttribute('hidden', ''); list.removeAttribute('hidden'); unplaced.style.display = '';
      const intel = $('#country-intel'); if (intel) { intel.setAttribute('hidden', ''); intel.textContent = ''; intelFor = null; }
      if (globe) globe.select(null);
      return;
    }
    const name = names.get(code) || (c && c.name) || { en: code, es: code };
    setText($('#country-name'), name.en, name.es);
    const ul = $('#country-projects'); ul.textContent = '';
    const projects = c ? c.projects : [];
    setText($('#country-sub'), projects.length ? projects.length + (projects.length === 1 ? ' project' : ' projects') : 'No projects here yet', projects.length ? projects.length + (projects.length === 1 ? ' proyecto' : ' proyectos') : 'Aún no hay proyectos aquí');
    // Wave 3: the live risk line, only when World Monitor answered (nothing is simulated).
    const riskEl = $('#country-risk');
    if (riskEl) { riskEl.textContent = ''; const line = riskLine(c && c.risk); if (line) { add(riskEl, line); riskEl.removeAttribute('hidden'); } else riskEl.setAttribute('hidden', ''); }
    for (const p of projects) {
      const a = mk('a', 'hub-country-project', null, null, { href: projectHref(p.id), 'data-country-project': p.id });
      add(a, dv('b', null, p.name), stagePill(p.stage));
      const meta = mk('div', 'hub-note-s');
      if (p.client_name) add(meta, dv('span', null, p.client_name), document.createTextNode(' · '));
      if (p.last_run_at) { const d = fmtShortDate(p.last_run_at); add(meta, mk('span', null, 'last run ' + d.en, 'última ejecución ' + d.es)); }
      else add(meta, mk('span', null, 'no runs yet', 'aún sin ejecuciones'));
      add(a, meta, add(mk('div', 'flags'), ...flags(p.attention)));
      // Wave 3: the fields attached to the project, each with its source.
      const fields = (p.assets || []).filter((x) => x && x.name);
      if (fields.length) {
        const fl = mk('div', 'hub-country-fields', null, null, { 'data-project-fields': p.id });
        for (const f of fields) {
          const pill = mk('span', 'hub-field-pt' + (f.outside ? ' outside' : ''), null, null, { 'data-field': f.id, title: sourceWord(f.location_source).en, ...(f.outside ? { 'data-outside': f.outside } : {}) });
          add(pill, mk('span', 'dot', null, null, { 'aria-hidden': 'true' }), dv('span', null, f.name));
          if (Number.isFinite(f.lat) && Number.isFinite(f.lon)) add(pill, dv('span', 'hub-muted coord', f.lat + ', ' + f.lon));
          if (f.outside) { const on = (names && names.get(f.outside)) || { en: f.outside, es: f.outside }; add(pill, mk('span', 'hub-outside', 'outside: in ' + on.en, 'fuera: en ' + on.es)); }
          add(fl, pill);
        }
        add(a, fl);
      }
      add(ul, a);
    }
    const createRow = $('#country-create-row');
    if (createRow) { if (person && person.role === 'partner') createRow.removeAttribute('hidden'); else createRow.setAttribute('hidden', ''); }
    list.setAttribute('hidden', ''); unplaced.style.display = 'none'; panel.removeAttribute('hidden');
    renderIntel(code, names);
    if (globe) globe.select(code, { fly: true });
  }
  $('#country-back').addEventListener('click', () => select(null, true));
  const createBtn = $('#country-create');
  if (createBtn) createBtn.addEventListener('click', () => {
    const code = sec.getAttribute('data-country');
    if (code && openProjectForm) openProjectForm('opportunity', { country: code, lat: tapped ? tapped.lat : null, lon: tapped ? tapped.lon : null });
  });
  setupBrief(() => sec.getAttribute('data-country'), names);
  const want = new URLSearchParams(location.search).get('country');
  if (want && /^[A-Z]{2}$/.test(want)) select(want, false);
  // The tooltip and the canvas label follow the language.
  new MutationObserver(() => { if (globe) globe.setLang(lang()); const l = lang(); canvas.setAttribute('aria-label', canvas.getAttribute('data-' + l + '-aria') || canvas.getAttribute('aria-label')); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  sec.setAttribute('data-globe', globe ? 'ready' : 'no-geo');
  return { data, names };
}

/* ── Today: country intelligence from World Monitor (wave 3 PR 4) ───── */

const fmtWhen = (iso) => { if (!iso) return null; const d = new Date(iso); if (isNaN(d)) return null; const s = fmtShortDate(iso); const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); return { en: s.en + ' ' + hm, es: s.es + ' ' + hm }; };
const fmtDay = (iso) => (iso ? fmtShortDate(iso) : null);
const pct = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 10 + '%' : '—');
const kbd = (v) => (typeof v === 'number' ? num(v) + ' kb/d' : '—');
let intelFor = null;

/** One section of the card: a heading and either its rows or why it did not answer (Pro-gated, failed), never silence. */
function intelSection(id, en, es, r, body) {
  const sec = mk('section', 'hub-intel-sec', null, null, { 'data-intel': id, 'data-state': r && r.ok ? 'live' : r && r.pro ? 'pro' : 'off' });
  add(sec, mk('h4', null, en, es));
  if (r && r.ok) { const inner = body(r.data); if (inner) add(sec, inner); else add(sec, mk('p', 'hub-muted', 'Nothing reported for this country.', 'Nada registrado para este país.')); }
  else if (r && r.pro) add(sec, mk('p', 'hub-muted hub-intel-pro', 'Needs World Monitor Pro: this endpoint is gated on the current plan.', 'Requiere World Monitor Pro: este punto está limitado en el plan actual.'));
  else add(sec, add(mk('p', 'hub-muted'), mk('span', null, 'Not available: ', 'No disponible: '), dv('span', null, (r && r.reason) || 'no answer')));
  return sec;
}
const bar = (label, value, max) => { const row = mk('div', 'hub-ibar'); add(row, dv('span', 'k', label), add(mk('span', 'track', null, null, { 'aria-hidden': 'true' }), mk('span', 'fill', null, null, { style: 'width:' + Math.max(0, Math.min(100, (value / max) * 100)) + '%' })), dv('span', 'v', typeof value === 'number' ? String(Math.round(value * 10) / 10) : '—')); return row; };
const li = (...kids) => add(mk('li'), ...kids);
const link = (title, url) => (url ? dv('a', 'hub-inline-link', title, { href: url, target: '_blank', rel: 'noopener noreferrer' }) : dv('span', null, title));

/**
 * The World Monitor card for the selected country: instability index, World Monitor's own brief,
 * energy, ports, events, headlines, advisories, sanctions, resilience, outages, timeline, facts.
 * Read once per selection from GET /api/countries/:code/intel: the Vault holds the key and
 * nothing is fetched from the browser.
 */
async function renderIntel(code, names) {
  const host = $('#country-intel');
  if (!host) return;
  intelFor = code;
  host.textContent = '';
  host.removeAttribute('hidden');
  host.setAttribute('data-state', 'loading');
  add(host, add(mk('p', 'hub-muted hub-brief-wait'), mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' Reading World Monitor…', ' Leyendo World Monitor…')));
  const res = await api('/api/countries/' + encodeURIComponent(code) + '/intel');
  if (intelFor !== code) return;
  host.textContent = '';
  const n = (names && names.get(code)) || { en: code, es: code };
  if (!res.ok || !res.body || !res.body.sections) {
    host.setAttribute('data-state', 'failed');
    const msg = (res.body && res.body.error && res.body.error.message) || '';
    add(host, notice('warn', 'Country intelligence not available.', 'Inteligencia del país no disponible.', msg || (res.status ? 'HTTP ' + res.status : 'The Vault is unreachable.'), msg || (res.status ? 'HTTP ' + res.status : 'El Vault no es accesible.')));
    return;
  }
  const S = res.body.sections, wm = res.body.world_monitor || {};
  host.setAttribute('data-state', wm.status === 'live' ? 'live' : 'not_connected');
  add(host, add(mk('div', 'hub-card-head'), add(mk('div'), mk('span', 'label', 'World Monitor', 'World Monitor'), mk('h3', null, 'Country intelligence: ' + n.en, 'Inteligencia del país: ' + n.es))));
  if (wm.status !== 'live') {
    add(host, notice('warn', 'World Monitor is not connected.', 'World Monitor no está conectado.', wm.reason || 'Set WORLD_MONITOR_API_KEY on the Vault service.', wm.reason || 'Configure WORLD_MONITOR_API_KEY en el servicio del Vault.'));
    return;
  }
  const meta = mk('p', 'hub-muted hub-note-s', null, null, { id: 'intel-meta' });
  const w = fmtWhen(wm.fetched_at);
  add(meta, mk('span', null, 'Live' + (w ? ', fetched ' + w.en : ''), 'En vivo' + (w ? ', obtenido ' + w.es : '')));
  if (wm.pro_gated && wm.pro_gated.length) add(meta, document.createTextNode(' · '), mk('span', null, wm.pro_gated.length + ' sections need Pro', wm.pro_gated.length + ' secciones requieren Pro'));
  if (wm.failed && wm.failed.length) add(meta, document.createTextNode(' · '), mk('span', null, wm.failed.length + ' did not answer', wm.failed.length + ' no respondieron'));
  add(host, meta);
  const grid = mk('div', 'hub-intel-grid');

  add(grid, intelSection('risk', 'Instability index', 'Índice de inestabilidad', S.risk, (d) => {
    const box = mk('div');
    const line = riskLine({ score: d.score, level: d.level, fetched_at: null });
    if (line) add(box, line);
    const facts = mk('div', 'hub-note-s');
    if (d.trend) add(facts, mk('span', null, 'trend ' + d.trend, 'tendencia ' + d.trend));
    if (typeof d.static_baseline === 'number') add(facts, document.createTextNode(' · '), mk('span', null, 'baseline ' + Math.round(d.static_baseline) + ', dynamic ' + Math.round(d.dynamic_score || 0), 'base ' + Math.round(d.static_baseline) + ', dinámico ' + Math.round(d.dynamic_score || 0)));
    if (d.sanctions_active) add(facts, document.createTextNode(' · '), mk('b', 'hub-outside', 'sanctions active' + (d.sanctions_count ? ' (' + d.sanctions_count + ' designations)' : ''), 'sanciones activas' + (d.sanctions_count ? ' (' + d.sanctions_count + ' designaciones)' : '')));
    const cd = fmtWhen(d.computed_at); if (cd) add(facts, document.createTextNode(' · '), mk('span', null, 'computed ' + cd.en, 'calculado ' + cd.es));
    add(box, facts);
    if (d.components) { const bars = mk('div', 'hub-bars'); const max = Math.max(1, ...Object.values(d.components)); for (const [k, v] of Object.entries(d.components)) add(bars, bar(k.replace(/([A-Z])/g, ' $1').toLowerCase(), v, max)); add(box, bars); }
    return box;
  }));

  add(grid, intelSection('brief', 'World Monitor brief', 'Resumen de World Monitor', S.brief, (d) => {
    if (!d.brief) return null;
    const box = mk('div', 'hub-intel-brief');
    for (const para of String(d.brief).split(/\n\s*\n/).filter(Boolean)) add(box, dv('p', null, para));
    if (d.evidence && d.evidence.length) { const ul = mk('ul', 'hub-intel-list'); for (const e of d.evidence.slice(0, 12)) add(ul, li(dv('b', null, e.label), e.value ? dv('span', null, ' ' + e.value) : null, e.fact ? dv('span', 'hub-muted', ' · ' + e.fact) : null, e.url ? dv('a', 'hub-inline-link', ' source', { href: e.url, target: '_blank', rel: 'noopener noreferrer' }) : null)); add(box, ul); }
    const g = fmtWhen(d.generated_at); if (g || d.model) add(box, add(mk('p', 'hub-muted hub-note-s'), g ? mk('span', null, 'generated ' + g.en, 'generado ' + g.es) : null, d.model ? dv('span', null, (g ? ' · ' : '') + d.model) : null));
    return box;
  }));

  add(grid, intelSection('energy', 'Energy profile', 'Perfil energético', S.energy, (d) => {
    const dl = mk('dl', 'hub-kv');
    const row = (en, es, v) => add(dl, mk('dt', null, en, es), dv('dd', null, v));
    if (d.oil) { row('JODI oil month', 'Mes JODI petróleo', d.oil.data_month || '—'); row('Crude imports', 'Importaciones de crudo', kbd(d.oil.crude_imports_kbd)); row('Gasoline demand', 'Demanda de gasolina', kbd(d.oil.gasoline_demand_kbd) + (typeof d.oil.gasoline_imports_kbd === 'number' ? ' (imports ' + kbd(d.oil.gasoline_imports_kbd) + ')' : '')); row('Diesel demand', 'Demanda de diésel', kbd(d.oil.diesel_demand_kbd) + (typeof d.oil.diesel_imports_kbd === 'number' ? ' (imports ' + kbd(d.oil.diesel_imports_kbd) + ')' : '')); row('Jet demand', 'Demanda de jet', kbd(d.oil.jet_demand_kbd)); row('LPG demand', 'Demanda de GLP', kbd(d.oil.lpg_demand_kbd)); }
    if (d.gas) { row('JODI gas month', 'Mes JODI gas', d.gas.data_month || '—'); row('Gas demand', 'Demanda de gas', typeof d.gas.total_demand_tj === 'number' ? num(d.gas.total_demand_tj) + ' TJ' : '—'); row('LNG imports', 'Importaciones de GNL', typeof d.gas.lng_imports_tj === 'number' ? num(d.gas.lng_imports_tj) + ' TJ' : '—'); row('Pipeline imports', 'Importaciones por gasoducto', typeof d.gas.pipe_imports_tj === 'number' ? num(d.gas.pipe_imports_tj) + ' TJ' : '—'); if (typeof d.gas.storage_fill_pct === 'number') row('Gas storage', 'Almacenamiento de gas', d.gas.storage_fill_pct + '%' + (d.gas.storage_trend ? ' ' + d.gas.storage_trend : '')); }
    if (d.mix) { const parts = Object.entries(d.mix).filter(([k, v]) => v > 0 && k !== 'renewables').sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + pct(v)); row('Electricity mix' + (d.mix_year ? ' ' + d.mix_year : ''), 'Mezcla eléctrica' + (d.mix_year ? ' ' + d.mix_year : ''), parts.join(', ') || '—'); }
    if (typeof d.import_share === 'number') row('Import share', 'Cuota de importación', pct(d.import_share));
    return dl.childNodes.length ? dl : null;
  }));

  add(grid, intelSection('ports', 'Tanker traffic by port', 'Tráfico de buques tanque por puerto', S.ports, (d) => {
    if (!d.length) return null;
    const ul = mk('ul', 'hub-intel-list');
    for (const p of d.slice(0, 10)) add(ul, add(mk('li', null, null, null, { 'data-port': p.id }), dv('b', null, p.name), mk('span', null, ' · ' + (p.tanker_calls_30d == null ? '—' : p.tanker_calls_30d) + ' tanker calls in 30 days', ' · ' + (p.tanker_calls_30d == null ? '—' : p.tanker_calls_30d) + ' escalas de tanques en 30 días'), typeof p.trend_pct === 'number' ? dv('span', 'hub-muted', ' · ' + (p.trend_pct > 0 ? '+' : '') + Math.round(p.trend_pct) + '%') : null, p.anomaly ? mk('span', 'hub-outside', ' anomaly', ' anomalía') : null));
    return ul;
  }));

  add(grid, intelSection('events', 'Conflict events, last 30 days', 'Eventos de conflicto, últimos 30 días', S.events, (d) => {
    const box = mk('div');
    if (S.humanitarian && S.humanitarian.ok && S.humanitarian.data && S.humanitarian.data.events_total != null) { const h = S.humanitarian.data; add(box, add(mk('p', 'hub-note-s'), mk('span', null, 'HAPI ' + (h.period || '') + ': ' + num(h.events_total) + ' events, ' + num(h.fatalities || 0) + ' fatalities, ' + num(h.demonstrations || 0) + ' demonstrations', 'HAPI ' + (h.period || '') + ': ' + num(h.events_total) + ' eventos, ' + num(h.fatalities || 0) + ' muertes, ' + num(h.demonstrations || 0) + ' manifestaciones'))); }
    if (!d.length) { add(box, mk('p', 'hub-muted', 'No ACLED events reported in the window.', 'Sin eventos ACLED en el periodo.')); return box; }
    const ul = mk('ul', 'hub-intel-list');
    for (const e of d.slice(0, 15)) { const dd = fmtDay(e.date); add(ul, add(mk('li', null, null, null, { 'data-event': e.id }), dd ? mk('span', 'hub-muted', dd.en + ' · ', dd.es + ' · ') : null, dv('b', null, e.type || 'event'), e.admin1 ? dv('span', null, ' in ' + e.admin1) : null, e.actors ? dv('span', 'hub-muted', ' · ' + e.actors) : null, typeof e.fatalities === 'number' && e.fatalities > 0 ? mk('span', 'hub-outside', ' · ' + e.fatalities + ' fatalities', ' · ' + e.fatalities + ' muertes') : null)); }
    add(box, ul);
    return box;
  }));

  add(grid, intelSection('headlines', 'Headlines', 'Titulares', S.headlines, (d) => {
    const cov = S.coverage && S.coverage.ok ? S.coverage.data : null;
    const rows = d.length ? d : (cov ? cov.headlines : []);
    if (!rows.length && !(cov && cov.events.length)) return null;
    const box = mk('div');
    if (rows.length) { const ul = mk('ul', 'hub-intel-list'); for (const h of rows.slice(0, 12)) { const dd = fmtDay(h.published_at); add(ul, li(link(h.title, h.url), h.source ? dv('span', 'hub-muted', ' · ' + h.source) : null, dd ? mk('span', 'hub-muted', ' · ' + dd.en, ' · ' + dd.es) : null)); } add(box, ul); }
    if (cov && cov.events.length) { add(box, mk('h5', null, 'Coverage timeline, ' + (cov.window_hours || 72) + ' h', 'Cronología de cobertura, ' + (cov.window_hours || 72) + ' h')); const ul = mk('ul', 'hub-intel-list'); for (const e of cov.events.slice(0, 12)) { const dd = fmtWhen(e.at); add(ul, li(dd ? mk('span', 'hub-muted', dd.en + ' · ', dd.es + ' · ') : null, dv('b', null, e.label), e.lane ? dv('span', 'hub-muted', ' · ' + e.lane) : null, e.severity ? dv('span', null, ' · ' + e.severity) : null)); } add(box, ul); }
    return box;
  }));

  add(grid, intelSection('advisories', 'Travel and security advisories', 'Avisos de viaje y seguridad', S.advisories, (d) => {
    if (!d.length) return null;
    const ul = mk('ul', 'hub-intel-list');
    for (const a of d) { const dd = fmtDay(a.date); add(ul, li(link(a.title, a.url), a.level ? dv('span', null, ' · level ' + a.level) : null, a.source ? dv('span', 'hub-muted', ' · ' + a.source) : null, dd ? mk('span', 'hub-muted', ' · ' + dd.en, ' · ' + dd.es) : null)); }
    return ul;
  }));

  add(grid, intelSection('sanctions', 'Sanctions pressure', 'Presión de sanciones', S.sanctions, (d) => {
    if (d.entries == null && !d.recent.length) return null;
    const box = mk('div');
    add(box, add(mk('p', 'hub-note-s'), mk('span', null, num(d.entries || 0) + ' designations' + (d.new_entries ? ', ' + d.new_entries + ' new' : '') + (d.vessels ? ', ' + d.vessels + ' vessels' : '') + (d.dataset_date ? ' · dataset ' + d.dataset_date : ''), num(d.entries || 0) + ' designaciones' + (d.new_entries ? ', ' + d.new_entries + ' nuevas' : '') + (d.vessels ? ', ' + d.vessels + ' buques' : '') + (d.dataset_date ? ' · datos ' + d.dataset_date : ''))));
    if (d.recent.length) { const ul = mk('ul', 'hub-intel-list'); for (const e of d.recent) add(ul, li(dv('b', null, e.name), e.type ? dv('span', 'hub-muted', ' · ' + e.type) : null, e.programs.length ? dv('span', 'hub-muted', ' · ' + e.programs.join(', ')) : null, e.is_new ? mk('span', 'hub-outside', ' new', ' nueva') : null)); add(box, ul); }
    return box;
  }));

  add(grid, intelSection('resilience', 'Resilience index', 'Índice de resiliencia', S.resilience, (d) => {
    if (d.score == null) return null;
    const box = mk('div');
    add(box, add(mk('p'), dv('b', null, Math.round(d.score) + ' / 100'), d.level ? dv('span', null, ' · ' + d.level) : null, d.trend ? dv('span', 'hub-muted', ' · ' + d.trend) : null, typeof d.change_30d === 'number' ? dv('span', 'hub-muted', ' · 30 d ' + (d.change_30d > 0 ? '+' : '') + Math.round(d.change_30d * 10) / 10) : null));
    if (d.domains.length) { const bars = mk('div', 'hub-bars'); for (const x of d.domains) add(bars, bar(x.id, x.score || 0, 100)); add(box, bars); }
    return box;
  }));

  add(grid, intelSection('outages', 'Internet outages, last 30 days', 'Cortes de internet, últimos 30 días', S.outages, (d) => {
    if (!d.length) return null;
    const ul = mk('ul', 'hub-intel-list');
    for (const o of d) { const dd = fmtDay(o.detected_at); add(ul, li(dd ? mk('span', 'hub-muted', dd.en + ' · ', dd.es + ' · ') : null, dv('b', null, o.title || o.region || o.id), o.severity ? dv('span', null, ' · ' + o.severity) : null, o.cause ? dv('span', 'hub-muted', ' · ' + o.cause) : null)); }
    return ul;
  }));

  add(grid, intelSection('timeline', 'Intelligence timeline', 'Cronología de inteligencia', S.timeline, (d) => {
    if (!d.length) return null;
    const ul = mk('ul', 'hub-intel-list');
    for (const r of d.slice(0, 15)) { const dd = fmtDay(r.occurred_at); add(ul, li(dd ? mk('span', 'hub-muted', dd.en + ' · ', dd.es + ' · ') : null, link(r.title, r.url), r.domain ? dv('span', 'hub-muted', ' · ' + r.domain) : null, r.summary ? dv('span', 'hub-muted', ' · ' + r.summary) : null)); }
    return ul;
  }));

  add(grid, intelSection('facts', 'Country facts', 'Datos del país', S.facts, (d) => {
    const dl = mk('dl', 'hub-kv');
    const row = (en, es, v) => { if (v) add(dl, mk('dt', null, en, es), dv('dd', null, v)); };
    row('Capital', 'Capital', d.capital); row('Population', 'Población', typeof d.population === 'number' ? num(d.population) : null); row('Area', 'Superficie', typeof d.area_km2 === 'number' ? num(d.area_km2) + ' km²' : null);
    row('Head of state', 'Jefe de Estado', d.head_of_state ? d.head_of_state + (d.head_of_state_title ? ' (' + d.head_of_state_title + ')' : '') : null); row('Languages', 'Idiomas', d.languages.join(', ')); row('Currency', 'Moneda', d.currencies.join(', '));
    if (!dl.childNodes.length) return null;
    const box = mk('div'); add(box, dl); if (d.summary) add(box, dv('p', 'hub-muted hub-note-s', d.summary.slice(0, 400))); return box;
  }));
  add(host, grid);
}

/* ── Today: the country brief (wave 2, Option A) ─────────────────────── */

const CITE_RE = /\[(run|doc|lesson|wm):([^\]]+)\]/g;   // wm: World Monitor live risk, events and headlines (wave 3)

/** A paragraph with its [run:…] / [doc:…] citations turned into chips that open the record in its project. */
function briefParagraph(text, sources) {
  const byRef = new Map((sources || []).map((s) => [s.ref, s]));
  const question = /^\[QUESTION FOR YOU:/.test(text);
  const p = mk('p', 'hub-brief-p' + (question ? ' question' : ''), null, null, { 'data-brief-paragraph': '' });
  if (question) { add(p, mk('b', null, 'Question for you: ', 'Pregunta para usted: '), dv('span', null, text.replace(/^\[QUESTION FOR YOU:\s*/, '').replace(/\]$/, ''))); return p; }
  let last = 0;
  for (const m of text.matchAll(CITE_RE)) {
    if (m.index > last) add(p, document.createTextNode(text.slice(last, m.index).replace(/\s+$/, ' ')));
    const ref = m[1] + ':' + m[2], src = byRef.get(ref);
    const label = src ? src.title : ref;
    const href = src && src.project_id ? 'project.html?id=' + encodeURIComponent(src.project_id) + (m[1] === 'run' ? '&run=' + encodeURIComponent(m[2]) : '') : (src && src.url ? src.url : null);
    const ext = !!(src && !src.project_id && src.url);
    add(p, href ? dv('a', 'hub-cite' + (m[1] === 'wm' ? ' wm' : ''), label, { href, 'data-cite': ref, title: ref, ...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }) : dv('span', 'hub-cite' + (m[1] === 'wm' ? ' wm' : ''), label, { 'data-cite': ref, title: ref }));
    last = m.index + m[0].length;
  }
  if (last < text.length) add(p, document.createTextNode(text.slice(last)));
  return p;
}

function setupBrief(currentCode, names) {
  const btn = $('#country-brief-btn'), host = $('#country-brief');
  if (!btn || !host) return;
  btn.addEventListener('click', async () => {
    const code = currentCode();
    if (!code) return;
    host.textContent = '';
    host.removeAttribute('hidden');
    add(host, add(mk('p', 'hub-muted hub-brief-wait'), mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' Reading the Vault and writing the brief…', ' Leyendo el Vault y escribiendo el resumen…')));
    btn.disabled = true;
    const res = await api('/api/countries/' + encodeURIComponent(code) + '/brief', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ language: lang() }) });
    btn.disabled = false;
    if (currentCode() !== code) return;
    host.textContent = '';
    if (!res.ok || !res.body || !Array.isArray(res.body.paragraphs)) {
      const msg = (res.body && res.body.error && res.body.error.message) || '';
      if (res.status === 501) add(host, notice('warn', 'The brief needs the drafting provider.', 'El resumen necesita el proveedor de redacción.', (msg ? msg + '. ' : '') + 'Set ANTHROPIC_API_KEY on the Vault service (SETUP.md §3).', (msg ? msg + '. ' : '') + 'Configure ANTHROPIC_API_KEY en el servicio del Vault (SETUP.md §3).'));
      else if (res.status === 0) add(host, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The brief was not written.', 'No se escribió el resumen.'));
      else add(host, notice('bad', 'The brief was not written.', 'No se escribió el resumen.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
      return;
    }
    const b = res.body;
    const n = (names && names.get(code)) || b.name || { en: code, es: code };
    add(host, add(mk('div', 'hub-card-head'), add(mk('div'), mk('h3', null, 'Country brief: ' + n.en, 'Resumen del país: ' + n.es))));
    const body = mk('div', 'hub-brief-body');
    for (const p of b.paragraphs) add(body, briefParagraph(p, b.sources));
    add(host, body);
    if (b.questions && b.questions.length) {
      const q = mk('div', 'hub-brief-block');
      add(q, mk('h4', null, 'Questions the brief could not answer from the record', 'Preguntas que el resumen no pudo responder con el registro'));
      const ul = mk('ul', null, null, null, { id: 'brief-questions' });
      for (const x of b.questions) add(ul, dv('li', null, x));
      add(q, ul); add(host, q);
    }
    const srcBlock = mk('div', 'hub-brief-block');
    add(srcBlock, mk('h4', null, 'Sources in scope', 'Fuentes en alcance'));
    const sl = mk('ul', 'hub-brief-sources', null, null, { id: 'brief-sources' });
    for (const sct of b.sources || []) {
      const li = mk('li');
      const href = sct.project_id ? 'project.html?id=' + encodeURIComponent(sct.project_id) + (sct.kind === 'run' ? '&run=' + encodeURIComponent(sct.ref.slice(4)) : '') : (sct.url || null);
      if (sct.kind === 'wm') li.setAttribute('data-source-kind', 'wm');
      add(li, href ? dv('a', 'hub-inline-link', sct.title, { href, ...(sct.project_id ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }) : dv('span', null, sct.title), sct.date ? dv('span', 'hub-muted', ' · ' + sct.date) : null, sct.detail ? dv('span', 'hub-muted', ' · ' + sct.detail) : null);
      add(sl, li);
    }
    add(srcBlock, sl); add(host, srcBlock);
    const meta = mk('p', 'hub-muted hub-note-s', null, null, { id: 'brief-meta' });
    const d = b.generated_at ? fmtShortDate(b.generated_at) : null;
    add(meta, b.cached ? mk('span', null, 'Served from the cache: nothing in this country changed since it was written', 'Servido desde la caché: nada cambió en este país desde que se escribió') : mk('span', null, 'Written now from the Vault', 'Escrito ahora a partir del Vault'),
      d ? mk('span', null, ' · ' + d.en, ' · ' + d.es) : null, b.model ? dv('span', null, ' · ' + b.model) : null);
    for (const w of b.warnings || []) if (!/turned into questions/.test(w)) add(meta, document.createTextNode(' · '), dv('span', null, w));
    add(host, meta);
    // Wave 3: whether the live risk feed was in the context.
    const wm = b.world_monitor || { status: 'not_connected' };
    const wmLine = mk('span', null, null, null, { id: 'brief-wm', 'data-status': wm.status });
    if (wm.status === 'live') {
      const t = wm.fetched_at ? new Date(wm.fetched_at) : null;
      const hm = t && !isNaN(t) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      add(wmLine, mk('span', null, 'World Monitor: live' + (hm ? ', fetched ' + hm : ''), 'World Monitor: en vivo' + (hm ? ', obtenido a las ' + hm : '')));
      for (const n of wm.notes || []) add(wmLine, document.createTextNode(' · '), dv('span', null, n));
    } else add(wmLine, mk('span', null, 'World Monitor: not connected (set WORLD_MONITOR_API_KEY on the Vault service)', 'World Monitor: no conectado (configure WORLD_MONITOR_API_KEY en el servicio del Vault)'), wm.reason && !/WORLD_MONITOR_API_KEY/.test(wm.reason) ? dv('span', null, ' · ' + wm.reason) : null);
    add(meta, document.createTextNode(' · '), wmLine);
  });
}

/** The register table: every project the caller may see, with the opportunity fields, filters and Add opportunity (partners). */
async function renderRegister(person, names) {
  const sec = $('#sec-register');
  if (!sec) return [];
  const [res, orgR] = await Promise.all([api('/api/projects'), api('/api/organisations')]);
  if (!res.ok) return [];
  const list = listOf(res.body, 'projects', 'items').filter((p) => p && p.status !== 'archived');   // archived: hidden, never deleted
  const orgName = new Map(orgR.ok ? listOf(orgR.body, 'organisations').map((o) => [o.id, o.name || o.id]) : []);
  for (const p of list) if (!p.client_name && p.client_id) p.client_name = orgName.get(p.client_id) || p.client_id;
  sec.removeAttribute('hidden');
  const body = $('#register-body'); body.textContent = '';
  const stageSel = $('#reg-stage'), riskSel = $('#reg-risk'), countrySel = $('#reg-country');
  for (const st of STAGES) add(stageSel, mk('option', null, st, STAGE_ES[st] || st, { value: st }));
  const codes = [...new Set(list.map((p) => p.country).filter(Boolean))].sort();
  for (const code of codes) { const n = (names && names.get(code)) || { en: code, es: code }; add(countrySel, mk('option', null, n.en, n.es, { value: code })); }
  const updated = (p) => (p.stage_history && p.stage_history.length ? p.stage_history[p.stage_history.length - 1].at : p.created_at);
  for (const p of list.slice().sort((a, b) => (updated(a) < updated(b) ? 1 : -1))) {
    const reg = p.register || {};
    const tr = mk('tr', null, null, null, { 'data-register-row': p.id, 'data-stage': p.stage || '', 'data-risk': reg.risk || '', 'data-country': p.country || '' });
    add(tr, add(mk('td', null, null, null, { 'data-col': 'name' }), dv('a', 'hub-inline-link', p.name, { href: projectHref(p.id) })));
    const cn = p.country ? (names && names.get(p.country)) || { en: p.country, es: p.country } : null;
    add(tr, cn ? mk('td', null, cn.en, cn.es, { 'data-col': 'country' }) : mk('td', 'hub-muted', '—', '—', { 'data-col': 'country' }));
    add(tr, dv('td', null, clientName(p) || '—', { 'data-col': 'client' }));
    add(tr, add(mk('td', null, null, null, { 'data-col': 'stage' }), stagePill(p.stage || 'Initial screen')));
    const plan = typeof reg.current === 'number' || typeof reg.plan === 'number' ? (reg.current ?? '—') + ' → ' + (reg.plan ?? '—') : '—';
    add(tr, dv('td', 'right num', plan, { 'data-col': 'plan' }));
    const risk = mk('td', null, null, null, { 'data-col': 'risk' });
    if (reg.risk) { const rl = RISK_LABEL[reg.risk] || [reg.risk, reg.risk]; add(risk, mk('span', 'hub-rag', null, null, { 'data-risk': reg.risk, 'aria-hidden': 'true' }), mk('span', null, rl[0] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''), rl[1] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''))); }
    else add(risk, mk('span', 'hub-muted', '—', '—'));
    add(tr, risk);
    add(tr, dv('td', null, reg.owner || '—', { 'data-col': 'owner' }));
    const u = updated(p); const ud = u ? fmtShortDate(u) : null;
    add(tr, ud ? mk('td', 'nowrap', ud.en, ud.es, { 'data-col': 'updated' }) : dv('td', null, '—', { 'data-col': 'updated' }));
    add(body, tr);
  }
  const apply = () => {
    let shown = 0;
    for (const tr of body.querySelectorAll('tr[data-register-row]')) {
      const on = (!stageSel.value || tr.getAttribute('data-stage') === stageSel.value) && (!riskSel.value || tr.getAttribute('data-risk') === riskSel.value) && (!countrySel.value || tr.getAttribute('data-country') === countrySel.value);
      if (on) { tr.removeAttribute('hidden'); shown++; } else tr.setAttribute('hidden', '');
    }
    setText($('#register-count'), shown + ' of ' + list.length, shown + ' de ' + list.length);
    const empty = $('#register-empty'); if (shown) empty.setAttribute('hidden', ''); else empty.removeAttribute('hidden');
  };
  for (const sel of [stageSel, riskSel, countrySel]) sel.addEventListener('change', apply);
  apply();
  const btn = $('#btn-new-opportunity');
  if (btn && person && person.role === 'partner') {
    btn.removeAttribute('hidden');
    btn.addEventListener('click', () => { if (openProjectForm) openProjectForm('opportunity'); });
  }
  return list;
}

/* ── Today: new project (partners) ───────────────────────────────────── */

/** A project id from a name: ascii, lowercase, hyphens; the API's slug rule. */
export const slugify = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * The New project form: shown to partners only (POST /api/projects requires one). The id follows
 * the name until edited; a client project also asks for the client's legal tag. On success the
 * new project file opens; a refusal from the API is shown in the form with its message.
 */
let openProjectForm = null;
const numOrNull = (el) => (el && el.value.trim() !== '' ? Number(el.value) : null);

function setupNewProject(person) {
  const btn = $('#btn-new-project'), form = $('#new-project');
  if (!btn || !form || !person || person.role !== 'partner') return;
  btn.removeAttribute('hidden');
  const name = $('#np-name'), id = $('#np-id'), client = $('#np-client'), tagField = $('#np-tag-field'), tag = $('#np-tag'), notices = $('#np-notices');
  let idTouched = false, orgsLoaded = false, mode = 'project';
  // Wave 2: the opportunity fields (country, stage, production, risk). Countries come from the globe's polygons.
  const opp = $('#np-opp'), country = $('#np-country'), stage = $('#np-stage'), submit = $('#np-submit');
  if (stage) for (const st of STAGES.slice(1)) add(stage, mk('option', null, st, STAGE_ES[st] || st, { value: st }));
  if (country) loadGeo().then((geo) => {
    if (!geo) return;
    const seen = new Set();
    for (const f of geo.features.slice().sort((a, b) => a.properties.en.localeCompare(b.properties.en))) {
      if (seen.has(f.properties.iso2)) continue; seen.add(f.properties.iso2);
      add(country, mk('option', null, f.properties.en, f.properties.es, { value: f.properties.iso2 }));
    }
  });
  const setMode = (m) => {
    mode = m;
    if (opp) opp.open = m === 'opportunity';
    if (submit) setText(submit, m === 'opportunity' ? 'Create opportunity' : 'Create project', m === 'opportunity' ? 'Crear oportunidad' : 'Crear proyecto');
  };
  openProjectForm = (m, prefill) => {
    setMode(m); open();
    // Wave 3: "Create a project here" arrives with the country and the tapped coordinates.
    if (prefill) {
      if (country && prefill.country) country.value = prefill.country;
      const la = $('#np-lat'), lo = $('#np-lon');
      if (la) la.value = Number.isFinite(prefill.lat) ? String(prefill.lat) : '';
      if (lo) lo.value = Number.isFinite(prefill.lon) ? String(prefill.lon) : '';
      form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };
  name.addEventListener('input', () => { if (!idTouched) id.value = slugify(name.value); });
  id.addEventListener('input', () => { idTouched = id.value.trim() !== ''; });
  client.addEventListener('change', () => { if (client.value) tagField.removeAttribute('hidden'); else tagField.setAttribute('hidden', ''); });
  const open = async () => {
    form.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); name.focus();
    if (orgsLoaded) return;
    orgsLoaded = true;
    const r = await api('/api/organisations');
    for (const o of listOf(r.body, 'organisations')) if (o && o.id) add(client, dv('option', null, o.name || o.id, { value: o.id }));
  };
  const close = () => { form.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); btn.focus(); };
  btn.addEventListener('click', () => (form.hasAttribute('hidden') ? (setMode('project'), open()) : close()));
  $('#np-cancel').addEventListener('click', close);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    notices.textContent = '';
    const body = { id: id.value.trim(), name: name.value.trim(), client_id: client.value || null };
    if (client.value) body.default_legal_tag = tag.value.trim();
    // Opportunity fields ride along only when given, so a plain project posts exactly what it did before.
    if (mode === 'opportunity') body.status = 'prospect';
    if (country && country.value) body.country = country.value;
    const lat = numOrNull($('#np-lat')), lon = numOrNull($('#np-lon'));
    if (lat !== null) body.lat = lat;
    if (lon !== null) body.lon = lon;
    if (stage && stage.value) body.stage = stage.value;
    const reg = {};
    const src = $('#np-source'), owner = $('#np-owner'), risk = $('#np-risk');
    if (src && src.value.trim()) reg.source = src.value.trim();
    const cur = numOrNull($('#np-current')), plan = numOrNull($('#np-plan'));
    if (cur !== null) reg.current = cur;
    if (plan !== null) reg.plan = plan;
    if (risk && risk.value) reg.risk = risk.value;
    if (owner && owner.value.trim()) reg.owner = owner.value.trim();
    if (Object.keys(reg).length) body.register = reg;
    if (!body.name || !SLUG.test(body.id)) {
      add(notices, notice('bad', 'Check the form.', 'Revise el formulario.', 'A name and a project id of lowercase letters, digits and hyphens are required.', 'Se requieren un nombre y un id del proyecto en minúsculas, dígitos y guiones.'));
      return;
    }
    if (client.value && !body.default_legal_tag) {
      add(notices, notice('bad', 'Check the form.', 'Revise el formulario.', 'A client project needs the id of its legal tag.', 'Un proyecto de cliente necesita el id de su etiqueta legal.'));
      return;
    }
    const sb = form.querySelector('button[type="submit"]');
    sb.disabled = true;
    const res = await api('/api/projects', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    sb.disabled = false;
    if (res.ok && res.body && res.body.id) { location.href = projectHref(res.body.id); return; }
    const msg = (res.body && res.body.error && res.body.error.message) || '';
    if (res.status === 0) add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The project was not created.', 'No se creó el proyecto.'));
    else add(notices, notice('bad', 'The project was not created.', 'No se creó el proyecto.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
  });
}

const ICON = {
  doc: '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  mail: '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  bulb: '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  redo: '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
};
function icon(kind, tone) {
  const s = document.createElement('span');
  s.className = 'hub-item-ico' + (tone ? ' ' + tone : '');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[kind]; // static, trusted markup defined above
  return s;
}

const MAX_ITEMS = 5;
function renderAttnCard(card, cfg) {
  card.textContent = '';
  card.removeAttribute('hidden');
  add(card, add(mk('div', 'hub-card-head'),
    mk('h3', null, cfg.titleEn, cfg.titleEs),
    dv('span', 'hub-count', String(cfg.items.length), { 'aria-label': cfg.items.length + ' items' })));
  if (!cfg.items.length) { add(card, mk('div', 'hub-empty', 'Nothing waiting.', 'Nada pendiente.')); return; }
  for (const it of cfg.items.slice(0, MAX_ITEMS)) {
    const row = mk('div', 'hub-item');
    add(row, icon(cfg.icon, cfg.tone));
    add(row, add(mk('div', 'hub-item-body'), dv('span', 't', it.title), dv('span', 'm', it.meta)));
    add(row, mk('a', 'btn btn-outline btn-sm', cfg.actionEn, cfg.actionEs, { href: cfg.href(it) }));
    add(card, row);
  }
  if (cfg.items.length > MAX_ITEMS) {
    const n = cfg.items.length - MAX_ITEMS;
    add(card, add(mk('div', 'hub-more'), mk('a', 'hub-link', n + ' more', n + ' más', { href: cfg.moreHref })));
  }
}

export const reasonText = (r) => (r == null ? '' : typeof r === 'string' ? r : (r.detail || r.rule || ''));

async function renderAttention(projects) {
  const sec = $('#sec-attention');
  let any = false;
  const show = (card, cfg) => { renderAttnCard(card, cfg); any = true; sec.removeAttribute('hidden'); };
  const pname = new Map(projects.map((p) => [p.id, projectName(p)]));

  // Stale runs and documents (M08), one call per project of mine.
  const stale = async () => {
    if (!projects.length) return;
    const results = await Promise.all(projects.slice(0, 12).map(async (p) => ({ p, r: await api('/api/projects/' + encodeURIComponent(p.id) + '/stale') })));
    const okOnes = results.filter((x) => x.r.ok);
    if (!okOnes.length) return;
    const items = [];
    for (const { p, r } of okOnes) {
      const b = r.body;
      const rows = Array.isArray(b) ? b : [].concat(
        listOf(b, 'runs').map((x) => Object.assign({ kind: 'run' }, x)),
        listOf(b, 'items', 'documents').map((x) => Object.assign({ kind: 'item' }, x)),
        listOf(b, 'stale'));
      for (const x of rows) {
        const title = x.title || x.name || x.label || (x.job ? x.job + (x.tool_version ? '@' + x.tool_version : '') : '') || x.id;
        const why = reasonText((x.stale_reasons || x.reasons || [])[0]);
        items.push({ title, meta: [pname.get(p.id) || p.id, why].filter(Boolean).join(' · '), project: p.id, kind: x.kind });
      }
    }
    show($('#card-stale'), { titleEn: 'Stale runs and documents', titleEs: 'Ejecuciones y documentos obsoletos', items, icon: 'doc', tone: 'bad', actionEn: 'Open', actionEs: 'Abrir', href: (it) => projectHref(it.project), moreHref: 'search.html?q=stale' });
  };
  const filing = async () => {
    const r = await api('/api/queue/filing');
    if (!r.ok) return;
    const items = listOf(r.body, 'items', 'queue', 'entries').map((x) => ({
      title: x.subject || x.title || x.name || x.id,
      meta: [x.from || x.sender, (x.suggested_project_name || x.suggested_project || x.project_id) ? '→ ' + (x.suggested_project_name || x.suggested_project || x.project_id) + (x.confidence != null ? ' ' + x.confidence : '') : ''].filter(Boolean).join(' · '),
    }));
    show($('#card-filing'), { titleEn: 'Filing queue', titleEs: 'Cola de archivo', items, icon: 'mail', actionEn: 'Assign', actionEs: 'Asignar', href: () => 'queue.html', moreHref: 'queue.html' });
  };
  const lessons = async () => {
    const r = await api('/api/lessons?status=proposed');
    if (!r.ok) return;
    const items = listOf(r.body, 'lessons', 'items').map((x) => ({
      title: x.statement || x.text || x.title || x.id,
      meta: [x.discipline, x.confidence != null ? 'confidence ' + x.confidence : ''].filter(Boolean).join(' · '),
    }));
    show($('#card-lessons'), { titleEn: 'Lesson proposals', titleEs: 'Propuestas de lecciones', items, icon: 'bulb', tone: 'gold', actionEn: 'Review', actionEs: 'Revisar', href: () => 'queue.html?kind=lesson', moreHref: 'queue.html?kind=lesson' });
  };
  const rerun = async () => {
    const r = await api('/api/queue/review?kind=rerun-delta');
    if (!r.ok) return;
    const items = listOf(r.body, 'items', 'queue', 'deltas').map((x) => ({
      title: x.title || x.summary || x.headline || x.id,
      meta: [x.project_name || x.project_id, x.detail].filter(Boolean).join(' · '),
    }));
    show($('#card-rerun'), { titleEn: 'Re-run deltas', titleEs: 'Diferencias de re-ejecución', items, icon: 'redo', tone: 'gold', actionEn: 'Review', actionEs: 'Revisar', href: () => 'queue.html?kind=rerun-delta', moreHref: 'queue.html?kind=rerun-delta' });
  };
  await Promise.all([stale(), filing(), lessons(), rerun()]);
  return any;
}

function headline(run) {
  const o = run.outputs && typeof run.outputs === 'object' ? run.outputs : null;
  if (!o) return '';
  const k = Object.keys(o)[0];
  if (!k) return '';
  const v = o[k] && typeof o[k] === 'object' ? o[k] : { value: o[k] };
  return k + ' ' + num(v.value) + (v.unit ? ' ' + v.unit : '');
}

async function renderRuns(projects) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const r = await api('/api/runs?since=' + encodeURIComponent(since) + '&limit=20');
  if (!r.ok) return;
  const runs = listOf(r.body, 'runs', 'items').slice(0, 20);
  $('#sec-runs').removeAttribute('hidden');
  const wrap = $('#runs-wrap');
  if (!runs.length) { add(wrap, mk('div', 'hub-empty', 'No runs in the last 30 days.', 'Sin ejecuciones en los últimos 30 días.')); return; }
  const pname = new Map(projects.map((p) => [p.id, projectName(p)]));
  const table = mk('table', 'hub-table');
  add(table, add(mk('caption', 'sr-only', 'Recent runs across the firm', 'Ejecuciones recientes de la firma')));
  const cols = [['Time', 'Hora'], ['Who', 'Quién'], ['Tool @ version', 'Herramienta @ versión'], ['Project', 'Proyecto'], ['Headline output', 'Resultado principal'], ['Status', 'Estado'], ['Stale', 'Obsoleta']];
  add(table, add(mk('thead'), add(mk('tr'), ...cols.map((c) => mk('th', null, c[0], c[1], { scope: 'col' })))));
  const tb = mk('tbody');
  for (const run of runs) {
    const stale = !!run.stale;
    const tr = mk('tr', stale ? 'is-stale' : '');
    const t = fmtStamp(run.created_at);
    const st = RUN_STATUS[run.status] || [run.status, run.status, 'muted'];
    const why = reasonText((run.stale_reasons || [])[0]);
    add(tr,
      add(mk('td', 'nowrap'), mk('span', null, t.en, t.es)),
      dv('td', null, run.author_name || run.author),
      dv('td', 'mono', (run.job || '—') + (run.tool_version ? '@' + run.tool_version : '')),
      dv('td', null, pname.get(run.project_id) || run.project_name || run.project_id),
      dv('td', null, headline(run)),
      add(mk('td'), mk('span', 'hub-pill ' + st[2], st[0], st[1])),
      add(mk('td'), stale
        ? mk('span', 'hub-stale', 'Stale', 'Obsoleta', why ? { title: why } : null)
        : dv('span', 'hub-muted', '—')));
    add(tb, tr);
  }
  add(table, tb);
  add(wrap, table);
}

async function initToday() {
  const d = fmtDateLong(new Date());
  setText($('#today-date'), d.en, d.es);
  const person = await showSession();
  await renderTools(person);
  setupNewProject(person);
  let globe = null;
  try { globe = await renderGlobe(person); } catch (e) { const sec = $('#sec-globe'); if (sec) sec.setAttribute('data-globe', 'failed'); }
  try { await renderRegister(person, globe && globe.names); } catch (e) { /* the register is optional; the rest of Today still renders */ }
  const projects = await renderProjects(person);
  await Promise.all([renderAttention(projects), renderRuns(projects)]);
  document.body.setAttribute('data-ready', '1');
}

async function initSettingsShell() {
  await showSession();
  const cat = await api('/api/catalog');
  showVault(cat.ok);
}

const page = document.body && document.body.getAttribute('data-page');
if (page === 'today') initToday();
else if (page === 'settings') initSettingsShell();
