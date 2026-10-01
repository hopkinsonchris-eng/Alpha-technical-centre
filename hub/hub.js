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
  const list = listOf(res.body, 'projects', 'items');
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

/* ── Today: new project (partners) ───────────────────────────────────── */

/** A project id from a name: ascii, lowercase, hyphens; the API's slug rule. */
export const slugify = (name) => String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * The New project form: shown to partners only (POST /api/projects requires one). The id follows
 * the name until edited; a client project also asks for the client's legal tag. On success the
 * new project file opens; a refusal from the API is shown in the form with its message.
 */
function setupNewProject(person) {
  const btn = $('#btn-new-project'), form = $('#new-project');
  if (!btn || !form || !person || person.role !== 'partner') return;
  btn.removeAttribute('hidden');
  const name = $('#np-name'), id = $('#np-id'), client = $('#np-client'), tagField = $('#np-tag-field'), tag = $('#np-tag'), notices = $('#np-notices');
  let idTouched = false, orgsLoaded = false;
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
  btn.addEventListener('click', () => (form.hasAttribute('hidden') ? open() : close()));
  $('#np-cancel').addEventListener('click', close);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    notices.textContent = '';
    const body = { id: id.value.trim(), name: name.value.trim(), client_id: client.value || null };
    if (client.value) body.default_legal_tag = tag.value.trim();
    if (!body.name || !SLUG.test(body.id)) {
      add(notices, notice('bad', 'Check the form.', 'Revise el formulario.', 'A name and a project id of lowercase letters, digits and hyphens are required.', 'Se requieren un nombre y un id del proyecto en minúsculas, dígitos y guiones.'));
      return;
    }
    if (client.value && !body.default_legal_tag) {
      add(notices, notice('bad', 'Check the form.', 'Revise el formulario.', 'A client project needs the id of its legal tag.', 'Un proyecto de cliente necesita el id de su etiqueta legal.'));
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const res = await api('/api/projects', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    submit.disabled = false;
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
