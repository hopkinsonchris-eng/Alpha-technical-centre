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
import { mountStatusStrip } from './components/status-strip.js';
import { stateline } from './components/stateline.js';
import { packController, packLine, orderedSections, shortWord, fmtDayMonth } from './components/country-pack.js';
import { loadRounds, deadlinesCard, roundLine, movedLines, projectCountries } from './components/rounds.js';

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

/** Wave 7 PR2 (idea C): the Vault's state lives in the status strip; the sidebar footer is gone. */
export function showVault(reachable) {
  const strip = mountStatusStrip();
  if (strip) strip.vault(reachable ? 'on' : 'off');
}

/* ── the chrome every page shares (wave 7 PR2 E) ─────────────────────── */

const SCOPE_KEY = 'atc-hub-find-scope';
/**
 * The header Find form carries the scope the page is in (§1.4): the project on a project page, else the
 * scope remembered by the Find page or firm. Below 900 px the sidebar is a bottom bar and More opens the
 * user card, Settings and the language switch (R3). The status strip is mounted under the top bar and,
 * on every page but Today (which feeds it from its own fetches), loads its own figures.
 */
export function setupChrome() {
  const page = document.body.getAttribute('data-page');
  const projectId = page === 'project' ? new URLSearchParams(location.search).get('id') : null;
  let remembered = '';
  try { remembered = localStorage.getItem(SCOPE_KEY) || ''; } catch (e) { /* private window */ }
  for (const form of document.querySelectorAll('form.hub-find')) {
    let input = form.querySelector('input[name="scope"]');
    if (!input) { input = mk('input', null, null, null, { type: 'hidden', name: 'scope' }); form.appendChild(input); }
    input.value = projectId ? 'project:' + projectId : (remembered || 'firm');
  }
  const side = document.querySelector('aside.hub-side'), more = $('#hub-more');
  if (side && more) {
    const setOpen = (open) => { more.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) side.setAttribute('data-more', 'open'); else side.removeAttribute('data-more'); };
    more.addEventListener('click', () => setOpen(more.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && more.getAttribute('aria-expanded') === 'true') setOpen(false); });
    document.addEventListener('click', (ev) => { if (more.getAttribute('aria-expanded') === 'true' && !side.contains(ev.target)) setOpen(false); });
  }
  const strip = mountStatusStrip();
  if (strip && page !== 'today') strip.load(['health', 'mailbox', 'activity', 'filing', 'lessons', 'stale']);
  return strip;
}

/* ── the one sidebar (wave 7, S3) ────────────────────────────────────── */

/** Which nav entry a page belongs to; the markup is identical on every page, the script marks the current one. */
const NAV_OF = { today: 'today', project: 'projects', queue: 'queue', find: 'find', settings: 'settings', cost: 'settings' };
export function markNav() {
  const page = document.body && document.body.getAttribute('data-page');
  const key = NAV_OF[page];
  for (const a of document.querySelectorAll('.hub-nav a[data-nav]')) {
    if (key && a.getAttribute('data-nav') === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

/* ── opening a tool from the Hub (wave 7, S13) ───────────────────────── */

/**
 * The public reservoir-simulator page keeps a legacy Staff Portal check on sessionStorage
 * ("atc_auth"), and that page must stay byte-identical. The Hub sits behind Cloudflare Access,
 * so it sets the flag before any tool target opens; the page then opens straight to the tool
 * with its ?project= intact. Called on every Hub page load and again on each tool link click.
 */
export function armLegacyGate() {
  try { sessionStorage.setItem('atc_auth', '1'); } catch (e) { /* no storage: the tool page falls back to its own gate */ }
}
/** Arms the gate when a tool link is followed (click, Enter, middle click). */
export function armOnOpen(el) {
  if (!el) return el;
  for (const ev of ['click', 'auxclick', 'keydown']) el.addEventListener(ev, armLegacyGate);
  return el;
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
  // Wave 2: an external app's real version comes from the version.json it publishes (sidecar version_url, read by the Vault).
  // Wave 7 (S6, D65): until it publishes one, the manifest version is a stated placeholder, so the card carries no version line.
  const live = tool.hub && tool.hub.live_version && tool.hub.live_version.version ? tool.hub.live_version : null;
  const external = tool.kind === 'external-app';
  if (live || !external) {
    const ver = mk('div', 'hub-ver', null, null, { 'data-version-source': live ? 'live' : 'manifest' });
    add(ver, dv('b', null, live ? live.version : version, { 'data-version': '' }));
    if (live) {
      const rd = live.released_at ? fmtShortDate(live.released_at) : null;
      add(ver, add(mk('span'), mk('span', null, 'published by the app', 'publicada por la app'), rd ? mk('span', null, ' · ' + rd.en, ' · ' + rd.es) : null));
    } else if (dep) add(ver, mk('span', null, 'last version', 'última versión'));
    else add(ver, mk('span', null, 'current', 'actual'));
    add(card, ver);
  }

  if (dep) {
    add(card, add(mk('div', 'hub-replaced', null, null, { 'data-replaced-by': dep.id }),
      mk('span', null, 'Replaced by', 'Reemplazada por'), document.createTextNode(' '), dv('b', null, dep.name)));
  }

  const foot = mk('div', 'hub-tool-foot');
  if (tool.kind === 'skill') {
    // Wave 7 (S7): a skill runs in Claude Code, not in a browser; its output is on the Insights page.
    add(foot, mk('a', 'btn btn-outline btn-sm', 'Published insights', 'Insights publicados', { href: new URL('insights.html', siteRoot).href, 'aria-describedby': 'tn-' + tool.id, 'data-insights': tool.id }));
  } else if (tool.lifecycle !== 'retired') {
    const t = openTarget(tool, byId, siteRoot);
    const open = mk('a', 'btn btn-primary btn-sm', 'Open current', 'Abrir versión actual', { href: t.href, 'aria-describedby': 'tn-' + tool.id, 'data-open': tool.id });
    if (t.external) { open.setAttribute('target', '_blank'); open.setAttribute('rel', 'noopener noreferrer'); }
    add(foot, armOnOpen(open));
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

/**
 * The catalog (wave 7 PR2, R4): no longer on Today, it is the Tools index at hub/tool.html without a
 * tool id. The host page holds #tools-grid, #tools-filter, #tools-older-grid, #tools-sub and #tools-source.
 */
export async function renderCatalog(person) {
  const grid = $('#tools-grid');
  if (!grid) return { tools: [], source: 'none' };
  const src = $('#tools-source');
  const notices = $('#notices');
  const { catalog, source } = await loadCatalog();
  const now = Date.now();
  if (!catalog) {
    showVault(false);
    add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The catalog could not be loaded from the Vault or from the copy kept with the Hub.', 'No se pudo cargar el catálogo desde el Vault ni desde la copia guardada con el Hub.'));
    setText($('#tools-sub'), 'The catalog is not available.', 'El catálogo no está disponible.');
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
  setText($('#tools-sub'),
    tools.length + ' tools in the catalog, ' + prod + ' in production.',
    tools.length + ' herramientas en el catálogo, ' + prod + ' en producción.');

  if (src) src.textContent = '';
  if (source === 'api') {
    if (src) add(src, mk('span', 'hub-pill ok', 'Catalog from the Vault', 'Catálogo del Vault'));
    showVault(true);
  } else {
    showVault(false);
    // R11: the copy says where the catalog came from in plain words, never as a file name.
    if (src) add(src, mk('span', 'hub-pill warn', 'Catalog kept with the Hub', 'Catálogo guardado con el Hub'));
    add(notices, notice('warn', 'The Vault is unreachable.', 'El Vault no es accesible.',
      'Showing the catalog kept with the Hub; versions and links may be out of date.',
      'Se muestra el catálogo guardado con el Hub; las versiones y los enlaces pueden estar desactualizados.'));
  }
  if (src && catalog.built_at) {
    const d = fmtShortDate(catalog.built_at);
    add(src, add(mk('span'), mk('span', null, 'Built', 'Generado'), document.createTextNode(' '), mk('span', null, d.en, d.es)));
  }

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

const projectHref = (id) => '/hub/project.html?id=' + encodeURIComponent(id);

function projectName(p) { return p.name || p.title || p.id; }
function clientName(p) { return p.client_name || (p.client && (p.client.name || p.client)) || p.client_id || ''; }
/** Wave 7 (S4): the internal holding project is not an opportunity; it never appears in the register, on the globe or on a card. */
const isOpportunity = (p) => p && p.status !== 'archived' && p.id !== 'firm';
// Wave 7 (S2, D65): the "My projects" cards are gone; the register above them lists the same projects with counts.

/* ── Today: the globe and the live register (wave 2, reshaped in wave 7 PR2: idea A, R4) ── */

export const STAGES = ['Initial screen', 'Qualified', 'Technical review', 'Commercial review', 'Negotiation', 'Won', 'Lost', 'Closed'];
export const STAGE_ES = { 'Initial screen': 'Cribado inicial', Qualified: 'Calificada', 'Technical review': 'Revisión técnica', 'Commercial review': 'Revisión comercial', Negotiation: 'Negociación', Won: 'Ganada', Lost: 'Perdida', Closed: 'Cerrada' };
export const RISK_LABEL = { green: ['Managed', 'Gestionado'], amber: ['Elevated', 'Elevado'], red: ['High', 'Alto'] };
/** R11: the register names the two risks apart: "World Monitor 71" for the country, "our execution risk Amber 54" for the project. */
export const RISK_WORD = { green: ['Green', 'Verde'], amber: ['Amber', 'Ámbar'], red: ['Red', 'Rojo'] };
const GEO_URL = '/hub/geo/countries-110m.json';
let geoPromise = null;
/** The country polygons (hub/geo), fetched once per page. */
export function loadGeo() {
  if (!geoPromise) geoPromise = fetch(GEO_URL, { cache: 'force-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return geoPromise;
}
const countryHref = (code) => '/hub/index.html' + (code ? '?country=' + encodeURIComponent(code) : '');

function flags(att) {
  const out = [];
  if (att && att.stale) out.push(mk('span', 'hub-flag stale', att.stale + ' stale', att.stale + ' obsoletos'));
  if (att && att.filing) out.push(mk('span', 'hub-flag filing', att.filing + ' to file', att.filing + ' por archivar'));
  if (att && att.expiring_days !== null && att.expiring_days !== undefined) out.push(mk('span', 'hub-flag expiring', 'NDA ' + att.expiring_days + ' d', 'NDA ' + att.expiring_days + ' d'));
  return out;
}
/** "World Monitor 71 · advisory: reconsider travel (09:00)" from the countries summary (wave 3); null without a reading. */
function riskLine(risk) {
  if (!risk || (risk.score === null && !risk.level)) return null;
  const el = mk('span', 'hub-risk-line', null, null, { 'data-risk-score': risk.score === null ? '' : String(risk.score) });
  const tone = risk.score === null ? '' : risk.score >= 70 ? 'red' : risk.score >= 40 ? 'amber' : 'green';
  if (tone) add(el, mk('span', 'hub-rag', null, null, { 'data-risk': tone, 'aria-hidden': 'true' }));
  add(el, mk('span', null, 'World Monitor' + (risk.score !== null ? ' ' + Math.round(risk.score) : ''), 'World Monitor' + (risk.score !== null ? ' ' + Math.round(risk.score) : '')));
  if (risk.level) add(el, document.createTextNode(' · '), mk('span', null, 'advisory: ', 'aviso: '), dv('span', null, risk.level));
  const t = risk.fetched_at ? new Date(risk.fetched_at) : null;
  const hm = t && !isNaN(t) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  if (hm) add(el, mk('span', 'hub-muted', ' (' + hm + ')', ' (' + hm + ')'));
  return el;
}
/** The project's own execution risk beside its register row: "our execution risk Amber 54". */
function riskTag(reg) {
  if (!reg || !reg.risk) return null;
  const w = RISK_WORD[reg.risk] || [reg.risk, reg.risk];
  const score = typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : '';
  const el = mk('span', 'hub-risk-tag', null, null, { 'data-risk-tag': reg.risk });
  add(el, mk('span', 'hub-rag', null, null, { 'data-risk': reg.risk, 'aria-hidden': 'true' }), mk('span', 'hub-sl-label', 'our execution risk', 'nuestro riesgo de ejecución'), document.createTextNode(' '), mk('span', null, w[0] + score, w[1] + score));
  return el;
}
/** Where a field's location came from, for pills and tooltips (wave 3). */
export const SOURCE_WORD = {
  gem: ['GEM', 'GEM'], geonames: ['GeoNames', 'GeoNames'], wikidata: ['Wikidata', 'Wikidata'], vault: ['Vault', 'Vault'],
  document: ['from a document', 'de un documento'], manual: ['entered by hand', 'introducido a mano'],
};
export const sourceWord = (src) => { const w = SOURCE_WORD[src] || (src ? [src, src] : ['no location', 'sin ubicación']); return { en: w[0], es: w[1] }; };

let projectsById = new Map();      // the register's projects, so the country panel renders the same stateline from the same fields
let suppressScrollUntil = 0;       // a programmatic scroll of the register is not the person turning the globe

/** A dot was tapped (idea A): the project's register row lights up and glides into view; the country panel's row too when it is open. */
function hotRow(id) {
  for (const r of document.querySelectorAll('[data-hot]')) r.removeAttribute('data-hot');
  const sel = '[data-register-row="' + CSS.escape(id) + '"], #country-panel [data-country-project="' + CSS.escape(id) + '"]';
  const rows = document.querySelectorAll(sel);
  if (!rows.length) return false;
  suppressScrollUntil = performance.now() + 800;
  for (const row of rows) {
    row.setAttribute('data-hot', '1');
    if (!row.closest('[hidden]')) row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return true;
}

/** One project of the countries summary as the stateline row (W7-AC6), with its client, flags and fields beneath. */
function panelRow(p, names) {
  const li = mk('li', 'hub-country-project', null, null, { 'data-country-project': p.id });
  const full = projectsById.get(p.id) || {};
  const proj = Object.assign({ id: p.id, name: p.name, stage: p.stage, status: p.status, register: {}, last_activity_at: p.last_run_at || null, stale_count: p.attention ? p.attention.stale : 0 }, full);
  add(li, stateline(proj, { size: 'row' }));
  if (p.client_name) add(li, dv('div', 'hub-note-s', p.client_name));
  // Wave 7 PR3 (H5): the project's own execution risk is labelled as such here too, apart from the country's World Monitor reading above.
  const rt = riskTag(proj.register || (full && full.register));
  add(li, add(mk('div', 'flags'), ...flags(p.attention), rt));
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
    add(li, fl);
  }
  return li;
}

/**
 * The globe and the country panel. Countries come from GET /api/countries (only what the caller may
 * see); the polygons from hub/geo. The live register beside the globe (renderRegister) is the keyboard
 * and screen-reader path and turns the globe as it scrolls; a tap on a dot lights its row; a tap on a
 * country opens the panel; ?country=XX in the URL selects a country and selecting one writes it back.
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
        onPoint: (p) => hotRow(p.id),
        onHover: (h) => {
          if (!h) { tip.setAttribute('hidden', ''); return; }
          // Wave 7 PR6 (O, W7-AC22): a country wearing the ring is named with its open round.
          tip.textContent = h.name + (h.open ? (lang() === 'es' ? ' · Ronda de licencias abierta' : ' · Open licence round') : '');
          tip.style.left = h.x + 'px'; tip.style.top = h.y + 'px'; tip.removeAttribute('hidden');
        },
      });
    } catch (e) { globe = null; }
  }
  const names = new Map();
  if (geo) for (const f of geo.features) if (!names.has(f.properties.iso2)) names.set(f.properties.iso2, { en: f.properties.en, es: f.properties.es });
  const panel = $('#country-panel'), unplaced = $('#country-unplaced'), reg = $('#register'), filters = $('#reg-filters');

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
    }
    if (globe) globe.setData({ held, points });
    if (data.unplaced && data.unplaced.length) {
      unplaced.removeAttribute('hidden');
      const n = data.unplaced.length;
      add(unplaced, mk('span', null, n + (n === 1 ? ' project without a country: ' : ' projects without a country: '), n + (n === 1 ? ' proyecto sin país: ' : ' proyectos sin país: ')));
      data.unplaced.forEach((p, i) => { if (i) add(unplaced, document.createTextNode(', ')); add(unplaced, dv('a', 'hub-inline-link', p.name, { href: projectHref(p.id), 'data-country-project': p.id })); });
    }
  }

  // Wave 3: the point under the last tap (or the country's centre when chosen from the register) feeds "Create a project here".
  let tapped = null;
  let briefUi = null;                                                        // wave 7 PR3 (H5): reads the cached brief on selection
  // Wave 7 PR5 (M, W7-AC19): the pack line under the risk line ("Pack: assembled 5 Oct · 9 of 10 · 1 stale") and the button when none exists.
  let packCtl = null;
  const packEl = (() => {
    let el = $('#country-pack');
    if (!el) { el = mk('p', 'hub-note-s hub-pack-line', null, null, { id: 'country-pack', hidden: '', 'data-pack-state': 'loading', 'aria-live': 'polite' }); const after = $('#country-risk') || $('#country-sub'); if (after) after.insertAdjacentElement('afterend', el); else if (panel) panel.prepend(el); }
    return el;
  })();
  const packNote = (() => {
    let el = $('#country-pack-note');
    if (!el) { el = mk('span', 'hub-muted', 'Creating a project here also assembles its country pack.', 'Crear un proyecto aquí también arma su paquete del país.', { id: 'country-pack-note', hidden: '' }); const row = $('#country-create-row'); if (row) add(row, el); }
    return el;
  })();
  // Wave 7 PR6 (O, W7-AC22): the round line under the pack line ("Round: … · bid deadline 7 Oct 2026 (in 2 days)" or
  // "No open round"), one fetch per selected country; nothing when the Vault has no rounds route.
  const roundEl = (() => {
    let el = $('#country-round');
    if (!el) { el = mk('p', 'hub-note-s hub-round-line', null, null, { id: 'country-round', hidden: '', 'data-round-state': 'off', 'aria-live': 'polite' }); packEl.insertAdjacentElement('afterend', el); }
    return el;
  })();
  async function showRound(code) {
    roundEl.setAttribute('hidden', ''); roundEl.textContent = ''; roundEl.setAttribute('data-round-state', code ? 'loading' : 'off');
    if (!code) return;
    const r = await loadRounds('country=' + encodeURIComponent(code) + '&status=confirmed');
    if (sec.getAttribute('data-country') !== code) return;                  // another country was chosen meanwhile
    if (r.state !== 'ready') { roundEl.setAttribute('data-round-state', r.state); return; }
    roundLine(roundEl, r.view, code);
  }
  function showPack(code) {
    if (packCtl) { packCtl.stop(); packCtl = null; }
    packEl.setAttribute('hidden', ''); packEl.textContent = ''; packEl.setAttribute('data-pack-state', code ? 'loading' : 'off');
    packNote.setAttribute('hidden', '');
    if (!code) return;
    const ctl = packController(code, (pack, state, info) => {
      if (sec.getAttribute('data-country') !== code) return;                 // another country was chosen meanwhile
      if (state === 'unavailable') { packEl.setAttribute('hidden', ''); packEl.textContent = ''; packEl.setAttribute('data-pack-state', 'unavailable'); packNote.setAttribute('hidden', ''); return; }
      packNote.removeAttribute('hidden');
      packLine(packEl, pack, { state, failed: !!(info && info.failed), onAssemble: person ? async (b) => { b.disabled = true; await ctl.assemble(); } : null });
    });
    packCtl = ctl;
    ctl.load();
  }
  function select(code, write, point) {
    const c = data && data.countries.find((x) => x.code === code);
    sec.setAttribute('data-country', code || '');
    tapped = point || (globe && code ? globe.centroidOf(code) : null);
    const brief = $('#country-brief'); if (brief) { brief.setAttribute('hidden', ''); brief.textContent = ''; }
    if (write) history.replaceState(null, '', countryHref(code));
    if (!code) {
      panel.setAttribute('hidden', ''); reg.removeAttribute('hidden'); if (filters) filters.removeAttribute('hidden'); unplaced.style.display = '';
      const intel = $('#country-intel'); if (intel) { intel.setAttribute('hidden', ''); intel.textContent = ''; intelFor = null; }
      showPack(null); showRound(null);
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
    for (const p of projects) add(ul, panelRow(p, names));                 // W7-AC6: the same stateline as the register
    const createRow = $('#country-create-row');
    if (createRow) { if (person && person.role === 'partner') createRow.removeAttribute('hidden'); else createRow.setAttribute('hidden', ''); }
    reg.setAttribute('hidden', ''); if (filters) filters.setAttribute('hidden', ''); unplaced.style.display = 'none'; panel.removeAttribute('hidden');
    renderIntel(code, names);
    showPack(code);
    showRound(code);
    if (briefUi) briefUi.loadCached(code);
    if (globe) globe.select(code, { fly: true });
  }
  $('#country-back').addEventListener('click', () => select(null, true));
  const createBtn = $('#country-create');
  if (createBtn) createBtn.addEventListener('click', () => {
    const code = sec.getAttribute('data-country');
    if (code && openProjectForm) openProjectForm('opportunity', { country: code, lat: tapped ? tapped.lat : null, lon: tapped ? tapped.lon : null });
  });
  briefUi = setupBrief(() => sec.getAttribute('data-country'), names);
  // The tooltip and the canvas label follow the language.
  new MutationObserver(() => { if (globe) globe.setLang(lang()); const l = lang(); canvas.setAttribute('aria-label', canvas.getAttribute('data-' + l + '-aria') || canvas.getAttribute('aria-label')); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  sec.setAttribute('data-globe', globe ? 'ready' : 'no-geo');
  return { data, names, select, globe };
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
  // World Monitor answers each section within ten seconds; the request must outlive that, or the browser gives up first.
  const res = await api('/api/countries/' + encodeURIComponent(code) + '/intel', { signal: AbortSignal.timeout(30000) });
  if (intelFor !== code) return;
  host.textContent = '';
  const n = (names && names.get(code)) || { en: code, es: code };
  if (!res.ok || !res.body || !res.body.sections) {
    host.setAttribute('data-state', 'failed');
    const msg = (res.body && res.body.error && res.body.error.message) || '';
    add(host, notice('warn', 'Country intelligence not available.', 'Inteligencia del país no disponible.', msg || (res.status ? 'HTTP ' + res.status : 'World Monitor did not answer in time. Try again in a moment.'), msg || (res.status ? 'HTTP ' + res.status : 'World Monitor no respondió a tiempo. Vuelva a intentarlo en un momento.')));
    return;
  }
  const S = res.body.sections, wm = res.body.world_monitor || {};
  host.setAttribute('data-state', wm.status === 'live' ? 'live' : 'not_connected');
  // Wave 7 (S9, D65): without World Monitor there is nothing to show, so the card stays hidden rather than announcing it on every country.
  if (wm.status !== 'live') { host.setAttribute('hidden', ''); return; }
  add(host, add(mk('div', 'hub-card-head'), add(mk('div'), mk('span', 'label', 'World Monitor', 'World Monitor'), mk('h3', null, 'Country intelligence: ' + n.en, 'Inteligencia del país: ' + n.es))));
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
    const href = src && src.project_id ? '/hub/project.html?id=' + encodeURIComponent(src.project_id) + (m[1] === 'run' ? '&run=' + encodeURIComponent(m[2]) : '') : (src && src.url ? src.url : null);
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
  // Wave 7 PR3 (H5, W7-AC15): `refresh` asks for a new brief when the cached one is past its max_age_days (the Regenerate button).
  const write = async (refresh) => {
    const code = currentCode();
    if (!code) return;
    host.textContent = '';
    host.removeAttribute('hidden');
    add(host, add(mk('p', 'hub-muted hub-brief-wait'), mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' Reading the Vault and writing the brief…', ' Leyendo el Vault y escribiendo el resumen…')));
    btn.disabled = true;
    const res = await api('/api/countries/' + encodeURIComponent(code) + '/brief', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ language: lang(), ...(refresh ? { refresh: true } : {}) }) });
    btn.disabled = false;
    if (currentCode() !== code) return;
    host.textContent = '';
    if (!res.ok || !res.body || !Array.isArray(res.body.paragraphs)) {
      const msg = (res.body && res.body.error && res.body.error.message) || '';
      if (res.status === 501 || (res.status === 503 && res.body && res.body.error && res.body.error.code === 'not_configured')) add(host, notice('warn', 'The drafting assistant is not connected.', 'El asistente de redacción no está conectado.', 'The brief cannot be written until it is. Ask Chris.', 'El resumen no se puede escribir hasta entonces. Pregunte a Chris.'));
      else if (res.status === 0) add(host, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The brief was not written.', 'No se escribió el resumen.'));
      else add(host, notice('bad', 'The brief was not written.', 'No se escribió el resumen.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
      return;
    }
    paint(res.body, code);
  };
  /** Wave 7 PR3 (H5): the cached brief, read with GET when a country is chosen, so its date and Regenerate show without a click (404: none yet). */
  const loadCached = async (code) => {
    const res = await api('/api/countries/' + encodeURIComponent(code) + '/brief?language=' + encodeURIComponent(lang()));
    if (currentCode() !== code) return;
    if (!res.ok || !res.body || !Array.isArray(res.body.paragraphs)) return;
    host.textContent = ''; host.removeAttribute('hidden');
    paint({ cached: true, ...res.body }, code);
  };
  const paint = (b, code) => {
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
      const href = sct.project_id ? '/hub/project.html?id=' + encodeURIComponent(sct.project_id) + (sct.kind === 'run' ? '&run=' + encodeURIComponent(sct.ref.slice(4)) : '') : (sct.url || null);
      if (sct.kind === 'wm') li.setAttribute('data-source-kind', 'wm');
      add(li, href ? dv('a', 'hub-inline-link', sct.title, { href, ...(sct.project_id ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }) : dv('span', null, sct.title), sct.date ? dv('span', 'hub-muted', ' · ' + sct.date) : null, sct.detail ? dv('span', 'hub-muted', ' · ' + sct.detail) : null);
      add(sl, li);
    }
    add(srcBlock, sl); add(host, srcBlock);
    const meta = mk('p', 'hub-muted hub-note-s', null, null, { id: 'brief-meta', 'data-generated-at': b.generated_at ? String(b.generated_at).slice(0, 10) : '', 'data-due': b.due ? '1' : '0' });
    const d = b.generated_at ? fmtShortDate(b.generated_at) : null;
    add(meta, b.cached ? mk('span', null, 'Served from the cache: nothing in this country changed since it was written', 'Servido desde la caché: nada cambió en este país desde que se escribió') : mk('span', null, 'Written now from the Vault', 'Escrito ahora a partir del Vault'),
      d ? mk('span', 'hub-brief-date', ' · brief of ' + d.en, ' · resumen del ' + d.es) : null, b.model ? dv('span', null, ' · ' + b.model) : null);
    for (const w of b.warnings || []) if (!/turned into questions/.test(w)) add(meta, document.createTextNode(' · '), dv('span', null, w));
    add(host, meta);
    // Wave 7 PR3 (H5, W7-AC15): a brief older than its max_age_days says so and offers Regenerate.
    if (b.due) {
      const age = typeof b.max_age_days === 'number' ? b.max_age_days : 90;
      const n = notice('warn', 'This brief is older than ' + age + ' days.', 'Este resumen tiene más de ' + age + ' días.', d ? 'Written ' + d.en + '; the country may have moved on.' : 'The country may have moved on.', d ? 'Escrito el ' + d.es + '; el país puede haber cambiado.' : 'El país puede haber cambiado.');
      n.setAttribute('data-brief-due', '1');
      const rb = mk('button', 'btn btn-primary btn-sm', 'Regenerate', 'Regenerar', { type: 'button', id: 'country-brief-regenerate' });
      rb.addEventListener('click', () => write(true));
      add(n, add(mk('div', 'hub-actions-row'), rb));
      add(host, n);
    }
    // Wave 3: whether the live risk feed was in the context.
    const wm = b.world_monitor || { status: 'not_connected' };
    const wmLine = mk('span', null, null, null, { id: 'brief-wm', 'data-status': wm.status });
    if (wm.status === 'live') {
      const t = wm.fetched_at ? new Date(wm.fetched_at) : null;
      const hm = t && !isNaN(t) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
      add(wmLine, mk('span', null, 'World Monitor: live' + (hm ? ', fetched ' + hm : ''), 'World Monitor: en vivo' + (hm ? ', obtenido a las ' + hm : '')));
      for (const n of wm.notes || []) add(wmLine, document.createTextNode(' · '), dv('span', null, n));
    } else add(wmLine, mk('span', null, 'World Monitor: not connected', 'World Monitor: no conectado'));
    add(meta, document.createTextNode(' · '), wmLine);
  };
  btn.addEventListener('click', () => write(false));
  return { loadCached, write };
}

/**
 * The live register (wave 7 PR2, idea A, R4): beside the globe, one stateline row per project the
 * caller may see, grouped by country with the country's counts, flags and World Monitor reading in
 * the heading; "Create a project here" as an outline action at the end of each group (partners).
 * Scrolling the column turns the globe to the country in view; a row's tokens open the project file.
 * Filters narrow it; Add opportunity and New project (partners) open the form above.
 */
async function renderRegister(person, info) {
  const reg = $('#register');
  if (!reg) return [];
  const names = info && info.names, data = info && info.data, globe = info && info.globe;
  const filters = $('#reg-filters');
  const [res, orgR] = await Promise.all([api('/api/projects'), api('/api/organisations')]);
  if (!res.ok) {
    reg.textContent = '';
    if (filters) filters.setAttribute('hidden', '');
    if (res.status === 0 || res.status >= 500) add($('#notices'), notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The register and the counters stay empty until it answers.', 'El registro y los contadores quedan vacíos hasta que responda.'));
    return [];
  }
  const list = listOf(res.body, 'projects', 'items').filter(isOpportunity);   // archived: hidden, never deleted; the internal project: not an opportunity
  const orgName = new Map(orgR.ok ? listOf(orgR.body, 'organisations').map((o) => [o.id, o.name || o.id]) : []);
  for (const p of list) if (!p.client_name && p.client_id) p.client_name = orgName.get(p.client_id) || p.client_id;
  projectsById = new Map(list.map((p) => [p.id, p]));
  reg.textContent = '';
  const stageSel = $('#reg-stage'), riskSel = $('#reg-risk'), countrySel = $('#reg-country');
  for (const st of STAGES) add(stageSel, mk('option', null, st, STAGE_ES[st] || st, { value: st }));

  const cinfo = new Map((data ? data.countries : []).map((c) => [c.code, c]));
  const nameOf = (code) => (code ? (names && names.get(code)) || (cinfo.get(code) && cinfo.get(code).name) || { en: code, es: code } : { en: 'No country yet', es: 'Aún sin país' });
  const byCountry = new Map();
  for (const p of list) { const k = p.country || ''; if (!byCountry.has(k)) byCountry.set(k, []); byCountry.get(k).push(p); }
  const codes = [...byCountry.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : nameOf(a).en.localeCompare(nameOf(b).en)));
  for (const code of codes) if (code) { const n = nameOf(code); add(countrySel, mk('option', null, n.en, n.es, { value: code })); }
  // Wave 7 (S5): a row moves when work happens: the project's last activity (a run, a document, a stage change).
  const updated = (p) => p.last_activity_at || (p.stage_history && p.stage_history.length ? p.stage_history[p.stage_history.length - 1].at : p.created_at) || '';
  const now = new Date();

  for (const code of codes) {
    const c = cinfo.get(code);
    const rows = byCountry.get(code).slice().sort((a, b) => (updated(a) < updated(b) ? 1 : -1));
    const nm = nameOf(code);
    const g = mk('section', 'hub-reg-group', null, null, { 'data-country-group': code });
    const head = code ? mk('button', 'hub-country', null, null, { type: 'button', 'data-country': code }) : mk('div', 'hub-country', null, null, { 'data-country-group-head': '' });
    const n = rows.length;
    const nSpan = add(mk('span', 'n'), mk('span', null, n + (n === 1 ? ' project' : ' projects'), n + (n === 1 ? ' proyecto' : ' proyectos')));
    if (c && c.risk && c.risk.score !== null && c.risk.score !== undefined) add(nSpan, document.createTextNode(' · '), mk('span', 'hub-risk-n', 'World Monitor ' + Math.round(c.risk.score), 'World Monitor ' + Math.round(c.risk.score), { 'data-risk-score': String(c.risk.score) }));
    const att = c ? { stale: c.counts.stale, filing: c.counts.filing, expiring_days: c.counts.expiring ? Math.min(...c.projects.filter((p) => p.attention.expiring_days !== null).map((p) => p.attention.expiring_days)) : null } : null;
    add(head, mk('span', 'name', nm.en, nm.es), nSpan, add(mk('span', 'flags'), ...flags(att)));
    if (code && info && info.select) head.addEventListener('click', () => info.select(code, true));
    add(g, head);
    const host = mk('div', 'hub-reg-rows');
    for (const p of rows) {
      const r = p.register || {};
      const row = mk('div', 'hub-reg-row', null, null, { 'data-register-row': p.id, 'data-stage': p.stage || '', 'data-risk': r.risk || '', 'data-row-country': code });
      add(row, stateline(p, { size: 'row', now }), riskTag(r));
      // R4: tapping a row (not one of its tokens) recentres the globe on its country and lights the row.
      row.addEventListener('click', (ev) => { if (ev.target.closest('a')) return; hotRow(p.id); if (code && globe) { suppressScrollUntil = performance.now() + 800; globe.select(code, { fly: true }); $('#sec-globe').setAttribute('data-target', code); } });
      add(host, row);
    }
    add(g, host);
    if (code && person && person.role === 'partner') {
      const b = mk('button', 'btn btn-outline btn-sm hub-create-here-btn', 'Create a project here', 'Crear un proyecto aquí', { type: 'button', 'data-create-here': code });
      b.addEventListener('click', () => { const pt = globe ? globe.centroidOf(code) : null; if (openProjectForm) openProjectForm('opportunity', { country: code, lat: pt ? pt.lat : null, lon: pt ? pt.lon : null }); });
      add(g, b);
    }
    add(reg, g);
  }

  const apply = () => {
    let shown = 0;
    for (const g of reg.querySelectorAll('[data-country-group]')) {
      let any = 0;
      for (const row of g.querySelectorAll('[data-register-row]')) {
        const on = (!stageSel.value || row.getAttribute('data-stage') === stageSel.value) && (!riskSel.value || row.getAttribute('data-risk') === riskSel.value) && (!countrySel.value || row.getAttribute('data-row-country') === countrySel.value);
        if (on) { row.removeAttribute('hidden'); any++; } else row.setAttribute('hidden', '');
      }
      if (any) g.removeAttribute('hidden'); else g.setAttribute('hidden', '');
      shown += any;
    }
    setText($('#register-count'), shown + ' of ' + list.length, shown + ' de ' + list.length);
    const empty = $('#register-empty'); if (empty) { if (shown || !list.length) empty.setAttribute('hidden', ''); else empty.removeAttribute('hidden'); }
  };
  for (const sel of [stageSel, riskSel, countrySel]) sel.addEventListener('change', apply);
  apply();
  if (filters) filters.removeAttribute('hidden');
  setupScrollLink(reg, globe);
  const btn = $('#btn-new-opportunity');
  if (btn && person && person.role === 'partner') {
    btn.removeAttribute('hidden');
    btn.addEventListener('click', () => { if (openProjectForm) openProjectForm('opportunity'); });
  }
  return list;
}

/** Idea A: the globe turns to the country whose group fills most of the register's viewport; ties go to the group nearest the top. */
function setupScrollLink(reg, globe) {
  const sec = $('#sec-globe');
  let last = null, raf = 0;
  reg.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (performance.now() < suppressScrollUntil) return;
      const box = reg.getBoundingClientRect();
      let best = null, bestH = 0;
      for (const g of reg.querySelectorAll('[data-country-group]')) {
        const code = g.getAttribute('data-country-group');
        if (!code || g.hasAttribute('hidden')) continue;
        const r = g.getBoundingClientRect();
        const h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
        if (h > bestH) { bestH = h; best = code; }
      }
      if (!best || best === last) return;
      last = best;
      sec.setAttribute('data-target', best);
      if (globe) globe.select(best, { fly: true });
    });
  }, { passive: true });
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
  // Wave 7 (S1, W7-AC1): a client project is created under the client's NDA tag. The picker lists the client's
  // existing tags from GET /api/legal-tags?client= and offers to create a new one; the tag is posted first, then
  // the project under it, so confidentiality is structural from the first record.
  const tagPick = $('#np-tag-pick'), tagNew = $('#np-tag-new'), tagName = $('#np-tag-name'), tagExpires = $('#np-tag-expires');
  const showTagNew = () => { if (!tagNew) return; if (!tagPick || tagPick.value === 'new') tagNew.removeAttribute('hidden'); else tagNew.setAttribute('hidden', ''); };
  const loadTags = async (clientId) => {
    if (!tagPick) return;
    for (const o of Array.from(tagPick.options)) if (o.value !== 'new') o.remove();
    const r = await api('/api/legal-tags?client=' + encodeURIComponent(clientId));
    const tags = r.ok ? listOf(r.body, 'tags').filter((t) => t && t.id && t.client_id === clientId) : [];
    for (const t of tags) tagPick.insertBefore(dv('option', null, (t.name || t.id) + (t.expires_at ? ' · ' + t.expires_at : ''), { value: t.id }), tagPick.firstChild);
    tagPick.value = tags.length ? tags[0].id : 'new';
    if (tag && !tag.value) tag.value = 'lt-' + slugify(clientId) + '-nda-' + new Date().getFullYear();
    showTagNew();
  };
  if (tagPick) tagPick.addEventListener('change', showTagNew);
  if (tagName && tag) tagName.addEventListener('input', () => { const v = slugify(tagName.value); if (v) tag.value = 'lt-' + v; });
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
  client.addEventListener('change', () => {
    if (client.value) { tagField.removeAttribute('hidden'); loadTags(client.value); }
    else { tagField.setAttribute('hidden', ''); if (tagNew) tagNew.setAttribute('hidden', ''); }
  });
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
    const creatingTag = !!client.value && (!tagPick || tagPick.value === 'new');
    if (client.value) body.default_legal_tag = creatingTag ? tag.value.trim() : tagPick.value;
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
    if (creatingTag && (!/^lt-[a-z0-9-]{3,64}$/.test(body.default_legal_tag) || !(tagName && tagName.value.trim()) || !(tagExpires && tagExpires.value))) {
      add(notices, notice('bad', 'Check the form.', 'Revise el formulario.', 'A new NDA tag needs a name, an id starting lt- and the date the NDA expires.', 'Una etiqueta de NDA nueva necesita un nombre, un id que empiece por lt- y la fecha en que vence el NDA.'));
      return;
    }
    const sb = form.querySelector('button[type="submit"]');
    sb.disabled = true;
    if (creatingTag) {
      const tagBody = { id: body.default_legal_tag, name: tagName.value.trim(), client_id: client.value, expires_at: tagExpires.value };
      const tr = await api('/api/legal-tags', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(tagBody) });
      if (!tr.ok && tr.status !== 409) {
        sb.disabled = false;
        const msg = (tr.body && tr.body.error && tr.body.error.message) || '';
        add(notices, notice('bad', 'The NDA tag was not created.', 'La etiqueta del NDA no se creó.', msg || 'The Vault refused it.', msg || 'El Vault la rechazó.'));
        return;
      }
    }
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
/**
 * One of the four counters (wave 7 PR2, R4, R12): filing, lessons, re-run, stale. A count of zero is one
 * line, the title and the figure; a non-zero count expands into its first items with an action each.
 */
function renderCounter(card, cfg) {
  card.textContent = '';
  card.removeAttribute('hidden');
  const n = cfg.items.length;
  const head = mk('div', 'hub-card-head hub-counter-head');
  add(head, add(mk('div', 'hub-counter-title'), icon(cfg.icon, cfg.tone), mk('h3', null, cfg.titleEn, cfg.titleEs)),
    add(mk('span', 'hub-fig'), dv('b', 'hub-num', String(n), { 'aria-label': n + (n === 1 ? ' item' : ' items') })));
  add(card, head);
  if (!n) { card.setAttribute('data-empty', '1'); return; }
  card.removeAttribute('data-empty');
  for (const it of cfg.items.slice(0, MAX_ITEMS)) {
    const row = mk('div', 'hub-item');
    add(row, add(mk('div', 'hub-item-body'), dv('span', 't', it.title), dv('span', 'm', it.meta)));
    add(row, mk('a', 'btn btn-outline btn-sm', cfg.actionEn, cfg.actionEs, { href: cfg.href(it) }));
    add(card, row);
  }
  if (n > MAX_ITEMS) {
    const more = n - MAX_ITEMS;
    add(card, add(mk('div', 'hub-more'), mk('a', 'hub-link', more + ' more', more + ' más', { href: cfg.moreHref })));
  }
}

export const reasonText = (r) => (r == null ? '' : typeof r === 'string' ? r : (r.detail || r.rule || ''));

/* Wave 6 (Option A, W6-AC7): what came in since the person last looked, and one cited sentence per opportunity.
   Wave 7 PR2 (R4): a full-width band under the globe; the counts as a grid of figures, the record chips as links. */
const ACTIVITY_CITE_RE = /\[((?:run|doc|lesson):[^\]\s]+)\]/g;
function citedSentence(host, text, records, projectId) {
  const byRef = new Map((records || []).map((r) => [r.ref, r]));
  let last = 0;
  for (const m of text.matchAll(ACTIVITY_CITE_RE)) {
    if (m.index > last) add(host, dv('span', null, text.slice(last, m.index)));
    const ref = m[1], rec = byRef.get(ref);
    const id = ref.slice(ref.indexOf(':') + 1);
    const href = ref.startsWith('run:') ? '/hub/project.html?id=' + encodeURIComponent(projectId) + '&run=' + encodeURIComponent(id) : '/hub/project.html?id=' + encodeURIComponent(projectId) + '&doc=' + encodeURIComponent(id);
    add(host, dv('a', 'hub-cite', rec ? rec.title : ref, { href, 'data-ref': ref, title: ref }));
    last = m.index + m[0].length;
  }
  if (last < text.length) add(host, dv('span', null, text.slice(last)));
}
let activitySince = null;         // the stored last-seen stamp the activity card reads, so the pack lines measure from the same moment
async function renderActivity(person, strip) {
  const card = $('#card-activity');
  if (!card || !person) return false;
  const r = await api('/api/me/activity');
  if (!r.ok || !r.body || !r.body.counts) { if (strip) { strip.set('need', null); strip.set('came', null); } return false; }
  const b = r.body, c = b.counts;
  activitySince = b.since || null;
  if (strip) { strip.set('need', Number(c.review || 0)); strip.set('came', Number(c.records || 0)); }
  const sec = $('#sec-activity'); if (sec) sec.removeAttribute('hidden');
  card.removeAttribute('hidden');
  const d = fmtStamp(b.since);
  setText($('#activity-since'), 'since you looked on ' + d.en, 'desde que miró el ' + d.es);
  $('#activity-count').textContent = String(c.records || 0);
  const bits = [[c.messages_filed, 'messages filed', 'mensajes archivados'], [c.ready, 'ready', 'listos'], [c.review, 'need a decision', 'requieren decisión'], [c.invoices, 'invoices', 'facturas'], [c.files, 'files', 'archivos'], [c.organisations_proposed, 'new organisations proposed', 'organizaciones propuestas'], [c.bulk_hidden, 'bulk hidden', 'masivos ocultos']].filter((x) => x[0] > 0);
  const counts = $('#activity-counts'); counts.textContent = '';
  if (!bits.length) { add(counts, mk('span', 'hub-muted', 'Nothing new since then.', 'Nada nuevo desde entonces.')); card.setAttribute('data-empty', '1'); }
  else card.removeAttribute('data-empty');
  // The counts as figures (idea D: .hub-num and .hub-unit), each a cell of the grid; the separator keeps the line readable as text.
  bits.forEach((x, i) => {
    if (i) add(counts, mk('span', 'hub-fig-sep', ' · ', ' · ', { 'aria-hidden': 'true' }));
    add(counts, add(mk('span', 'hub-fig', null, null, { 'data-count': x[1].split(' ')[0] }), dv('b', 'hub-num', String(x[0])), document.createTextNode(' '), mk('span', 'hub-unit', x[1], x[2])));
  });
  const host = $('#activity-projects'); host.textContent = '';
  const projects = b.projects || [];
  const blocks = new Map();
  // Wave 7 (S12): the first four record links always show, so the card leads to the records with or without a brief.
  const recordLinks = (host, records, projectId) => {
    for (const rec of (records || []).slice(0, 4)) {
      const id = rec.ref.slice(rec.ref.indexOf(':') + 1);
      const href = '/hub/project.html?id=' + encodeURIComponent(projectId) + (rec.ref.startsWith('run:') ? '&run=' : '&doc=') + encodeURIComponent(id);
      add(host, dv('a', 'hub-cite', rec.title, { href, 'data-ref': rec.ref }), document.createTextNode(' '));
    }
  };
  for (const p of projects) {
    const block = mk('div', 'hub-activity-project', null, null, { 'data-activity-project': p.id });
    add(block, dv('a', 'hub-activity-name', p.name, { href: projectHref(p.id) }));
    const line = mk('p', 'hub-activity-line', null, null, { 'data-activity-line': '' });
    add(line, mk('span', 'hub-muted', (p.records || []).length + ' new ' + ((p.records || []).length === 1 ? 'record' : 'records'), (p.records || []).length + ((p.records || []).length === 1 ? ' registro nuevo' : ' registros nuevos')));
    const links = mk('p', 'hub-activity-records', null, null, { 'data-activity-records': '' });
    recordLinks(links, p.records, p.id);
    add(block, line, links); add(host, block); blocks.set(p.id, { block, line, links, records: p.records || [] });
  }
  if (projects.length && b.brief_available) {
    const br = await api('/api/me/activity/brief', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ since: b.since, language: document.documentElement.lang === 'es' ? 'es' : 'en' }), signal: AbortSignal.timeout(60000) });
    if (br.ok && br.body && Array.isArray(br.body.projects)) {
      for (const p of br.body.projects) {
        const blk = blocks.get(p.project_id); if (!blk) continue;
        // A cited sentence carries its own chips to the records, so the plain links step aside for it.
        if (p.sentence) { blk.line.textContent = ''; blk.line.setAttribute('data-cited', String((p.citations || []).length)); citedSentence(blk.line, p.sentence, p.records || blk.records, p.project_id); blk.links.remove(); }
      }
      card.setAttribute('data-brief', br.body.provider || 'none');
    }
  }
  const seen = $('#activity-seen');
  seen.onclick = async () => {
    seen.disabled = true;
    const s = await api('/api/me/activity/seen', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
    if (s.ok) { setText($('#activity-status'), 'Seen. The next visit starts from now.', 'Visto. La próxima visita empieza desde ahora.'); card.setAttribute('data-seen', '1'); }
    else { seen.disabled = false; setText($('#activity-status'), 'Could not save.', 'No se pudo guardar.'); }
  };
  return true;
}

/* Wave 7 PR5 (M, W7-AC19): one line in What came in per country whose pack landed or whose section changed since the person last
   looked ("Brazil: licensing changed; bids 7 Oct 2026", from the section's headline), read from GET /api/countries/:code/pack once
   per country with an active project and compared with the activity card's last-seen stamp; the activity feed does not know packs. */
const isBuiltSection = (s) => !!s.built_at && Number(s.version || 0) > 0 && s.status !== 'empty';
async function renderPackLines(person, projects, info, since) {
  const card = $('#card-activity'), host = $('#activity-projects');
  if (!card || !host || !person || !since) return 0;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return 0;
  const byCode = new Map();
  for (const p of projects || []) if (p && p.country && p.id !== 'firm' && p.status !== 'archived' && p.status !== 'closed' && !byCode.has(p.country)) byCode.set(p.country, p);
  const results = await Promise.all([...byCode.keys()].map(async (code) => [code, await api('/api/countries/' + encodeURIComponent(code) + '/pack')]));
  let shown = 0;
  for (const [code, r] of results) {
    if (!r.ok || !r.body || !Array.isArray(r.body.sections)) continue;
    const pack = r.body, p = byCode.get(code);
    const name = (info && info.names && info.names.get(code)) || { en: code, es: code };
    const built = orderedSections(pack).filter(isBuiltSection);
    const changed = built.filter((s) => Date.parse(s.built_at) > sinceMs && (Number(s.version || 0) > 1 || (Array.isArray(s.body && s.body.changed_since) && s.body.changed_since.length)));
    const landed = !changed.length && pack.assembled_at && Date.parse(pack.assembled_at) > sinceMs;
    if (!changed.length && !landed) continue;
    const line = mk('p', 'hub-activity-line hub-pack-line', null, null, { 'data-activity-pack': code, 'data-pack-change': landed ? 'landed' : changed[0].section });
    const a = mk('a', 'hub-cite hub-pack-cite', null, null, { href: projectHref(p.id) + '#pack' + (landed ? '' : '-' + changed[0].section) });
    if (landed) {
      const d = fmtDayMonth(pack.assembled_at), total = orderedSections(pack).length;
      add(a, mk('span', null, name.en + ': country pack assembled ' + d.en + ' · ', name.es + ': paquete del país armado el ' + d.es + ' · '), dv('span', 'hub-num', String(built.length)), mk('span', null, ' of ', ' de '), dv('span', 'hub-num', String(total)));
    } else {
      const s = changed[0], w = shortWord(s.section), h = (s.body && s.body.headline) || {};
      add(a, mk('span', null, name.en + ': ' + w.en + ' changed' + (h.en ? '; ' + h.en : ''), name.es + ': ' + w.es + ' cambió' + (h.es || h.en ? '; ' + (h.es || h.en) : '')));
      if (changed.length > 1) add(a, mk('span', 'hub-muted', ' · +' + (changed.length - 1) + ' more', ' · +' + (changed.length - 1) + ' más'));
    }
    add(line, a); add(host, line); shown++;
  }
  if (shown && card.getAttribute('data-empty') === '1') {
    card.removeAttribute('data-empty');
    const counts = $('#activity-counts'); if (counts) { counts.textContent = ''; add(counts, mk('span', 'hub-muted', 'Nothing new in the files, but a country pack changed.', 'Nada nuevo en los expedientes, pero un paquete del país cambió.')); }
  }
  return shown;
}

/* Wave 7 PR6 (O, W7-AC22): the round watch on Today, from one fetch of GET /api/rounds?within=90&status=confirmed: the
   Deadlines card among the counters for the countries of the person's live projects, the ring on the globe for every
   country with an open round, and one What came in line per confirmed deadline that moved since the person last looked.
   The card stays out of sight when the Vault has no rounds route (404 or 501), like the pack. */
async function renderRounds(person, projects, info, since) {
  const card = $('#card-deadlines');
  if (!card) return null;
  const r = await loadRounds('within=90&status=confirmed');
  if (r.state !== 'ready') { card.setAttribute('hidden', ''); card.textContent = ''; card.removeAttribute('data-empty'); card.setAttribute('data-rounds', r.state); return null; }
  const names = info && info.names, codes = projectCountries(projects);
  deadlinesCard(card, r.view, { names, codes, onCountry: info && info.select ? (code) => { info.select(code, true); $('#sec-globe').scrollIntoView({ block: 'start', behavior: 'smooth' }); } : null });
  // The ring: every country the view says has an open round.
  const rings = r.view.countries.filter((c) => c && c.open).map((c) => c.country).sort();
  const sec = $('#sec-globe');
  if (sec) { if (rings.length) sec.setAttribute('data-rings', rings.join(',')); else sec.removeAttribute('data-rings'); }
  if (info && info.globe && info.globe.setRings) info.globe.setRings(rings);
  // What came in: a confirmed deadline that moved (or was first confirmed) since the person last looked.
  const act = $('#card-activity'), host = $('#activity-projects');
  if (act && host && person && since) {
    const lines = movedLines(r.view, Date.parse(since), names, codes);
    for (const l of lines) {
      const line = mk('p', 'hub-activity-line hub-round-line', null, null, { 'data-activity-round': l.code, 'data-round-event': l.id, 'data-round-change': l.moved ? 'moved' : 'confirmed' });
      add(line, mk('a', 'hub-cite hub-pack-cite', l.en, l.es, { href: '/hub/index.html#card-deadlines' }));
      add(host, line);
    }
    if (lines.length && act.getAttribute('data-empty') === '1') {
      act.removeAttribute('data-empty');
      const counts = $('#activity-counts'); if (counts) { counts.textContent = ''; add(counts, mk('span', 'hub-muted', 'Nothing new in the files, but a round date moved.', 'Nada nuevo en los expedientes, pero una fecha de ronda cambió.')); }
    }
  }
  return r.view;
}

/** The four counters: each starts at zero in one line (R12) and expands when its source answers with items; the strip reads the same figures. */
async function renderAttention(projects, strip) {
  const pname = new Map(projects.map((p) => [p.id, projectName(p)]));
  const CFG = {
    filing: { titleEn: 'Filing queue', titleEs: 'Cola de archivo', icon: 'mail', actionEn: 'Assign', actionEs: 'Asignar', href: () => '/hub/queue.html', moreHref: '/hub/queue.html' },
    lessons: { titleEn: 'Lesson proposals', titleEs: 'Propuestas de lecciones', icon: 'bulb', tone: 'gold', actionEn: 'Review', actionEs: 'Revisar', href: () => '/hub/queue.html?kind=lesson', moreHref: '/hub/queue.html?kind=lesson' },
    rerun: { titleEn: 'Re-run deltas', titleEs: 'Diferencias de re-ejecución', icon: 'redo', tone: 'gold', actionEn: 'Review', actionEs: 'Revisar', href: () => '/hub/queue.html?kind=rerun-delta', moreHref: '/hub/queue.html?kind=rerun-delta' },
    stale: { titleEn: 'Stale runs and documents', titleEs: 'Ejecuciones y documentos obsoletos', icon: 'doc', tone: 'bad', actionEn: 'Open', actionEs: 'Abrir', href: (it) => projectHref(it.project), moreHref: '/hub/index.html#card-stale' },
  };
  const show = (key, items) => { const card = $('#card-' + key); if (card) renderCounter(card, Object.assign({ items }, CFG[key])); };
  for (const key of Object.keys(CFG)) show(key, []);

  // Stale runs and documents (M08), one call per project of mine.
  const stale = async () => {
    if (!projects.length) { if (strip) strip.set('stale', 0); return; }
    const results = await Promise.all(projects.slice(0, 12).map(async (p) => ({ p, r: await api('/api/projects/' + encodeURIComponent(p.id) + '/stale') })));
    const okOnes = results.filter((x) => x.r.ok);
    if (!okOnes.length) { if (strip) strip.set('stale', null); return; }
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
    show('stale', items);
    if (strip) strip.set('stale', items.length);
  };
  const filing = async () => {
    const r = await api('/api/queue/filing');
    if (!r.ok) { if (strip) strip.set('file', null); return; }
    const items = listOf(r.body, 'items', 'queue', 'entries').map((x) => ({
      title: x.subject || x.title || x.name || x.id,
      meta: [x.from || x.sender, (x.suggested_project_name || x.suggested_project || x.project_id) ? '→ ' + (x.suggested_project_name || x.suggested_project || x.project_id) + (x.confidence != null ? ' ' + x.confidence : '') : ''].filter(Boolean).join(' · '),
    }));
    show('filing', items);
    if (strip) strip.set('file', items.length);
  };
  const lessons = async () => {
    const r = await api('/api/lessons?status=proposed');
    if (!r.ok) { if (strip) strip.set('lessons', null); return; }
    const items = listOf(r.body, 'lessons', 'items').map((x) => ({
      title: x.statement || x.text || x.title || x.id,
      meta: [x.discipline, x.confidence != null ? 'confidence ' + x.confidence : ''].filter(Boolean).join(' · '),
    }));
    show('lessons', items);
    if (strip) strip.set('lessons', items.length);
  };
  const rerun = async () => {
    const r = await api('/api/queue/review?kind=rerun-delta');
    if (!r.ok) return;
    const items = listOf(r.body, 'items', 'queue', 'deltas').map((x) => ({
      title: x.title || x.summary || x.headline || x.id,
      meta: [x.project_name || x.project_id, x.detail].filter(Boolean).join(' · '),
    }));
    show('rerun', items);
  };
  await Promise.all([stale(), filing(), lessons(), rerun()]);
  return true;
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

/* Wave 6 (D60): the Connect card, shown until the person connects or says Not now; the return from Zoho's consent page. */
async function renderMailboxPrompt(person, mailbox) {
  const sec = $('#sec-mailbox');
  if (!sec || !person) return;
  const back = new URLSearchParams(location.search).get('mailbox');
  if (back) {
    const host = $('#notices');
    if (host) {
      const kind = back === 'connected' ? 'ok' : 'warn';
      const n = mk('div', 'hub-notice ' + kind, null, null, { role: 'status', 'data-mailbox-notice': back });
      if (back === 'connected') add(n, mk('span', null, 'Mailbox connected. Mail from today onwards files as it arrives; the last 180 days arrive quietly over the next day. See Settings for what it holds.', 'Buzón conectado. El correo desde hoy se archiva al llegar; los últimos 180 días llegan poco a poco durante el próximo día. Vea en Ajustes lo que guarda.'));
      else add(n, mk('span', null, 'The mailbox was not connected. You can connect it later from Settings.', 'El buzón no se conectó. Puede conectarlo más tarde desde Ajustes.'));
      add(host, n);
    }
    const u = new URL(location.href); u.searchParams.delete('mailbox'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }
  if (!mailbox || !mailbox.prompt) return;
  $('#mailbox-address').textContent = person.email || '';
  sec.removeAttribute('hidden');
  const status = $('#mailbox-status'), connect = $('#mailbox-connect'), later = $('#mailbox-later');
  connect.addEventListener('click', async () => {
    connect.disabled = true; setText(status, 'Opening Zoho…', 'Abriendo Zoho…');
    const c = await api('/api/me/mailbox/connect', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
    if (c.ok && c.body && c.body.url) { location.href = c.body.url; return; }
    connect.disabled = false;
    setText(status, c.status === 503 ? 'Mail capture is not switched on for this Vault yet. Ask Chris.' : 'Could not start the connection.', c.status === 503 ? 'La captura de correo aún no está activada en este Vault. Pregunte a Chris.' : 'No se pudo iniciar la conexión.');
  });
  later.addEventListener('click', async () => {
    later.disabled = true;
    await api('/api/me/mailbox', { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ prompt_hidden_days: 30 }) });
    sec.setAttribute('hidden', '');
  });
}

async function initToday() {
  const d = fmtDateLong(new Date());
  setText($('#today-date'), d.en, d.es);
  // Wave 7 PR2 (idea C): the strip reads the Vault's health itself; the rest of its figures come from the fetches below.
  const strip = mountStatusStrip();
  if (strip) strip.load(['health']);
  const person = await showSession();
  let mailbox = null;
  if (person) { const r = await api('/api/me/mailbox'); mailbox = r.ok ? r.body : null; }
  if (strip) strip.mail(mailbox);
  try { await renderMailboxPrompt(person, mailbox); } catch (e) { /* the card is optional */ }
  setupNewProject(person);
  let info = null;
  try { info = await renderGlobe(person); } catch (e) { const sec = $('#sec-globe'); if (sec) sec.setAttribute('data-globe', 'failed'); }
  let projects = [];
  try { projects = await renderRegister(person, info); } catch (e) { /* the register is optional; the rest of Today still renders */ }
  // ?country=XX in the address selects a country once the register knows its projects.
  const want = new URLSearchParams(location.search).get('country');
  if (info && info.select && want && /^[A-Z]{2}$/.test(want)) info.select(want, false);
  await Promise.all([renderActivity(person, strip).catch(() => false), renderAttention(projects, strip), renderRuns(projects)]);
  try { await renderPackLines(person, projects, info, activitySince); } catch (e) { /* the pack lines are optional */ }   // wave 7 PR5 (M)
  try { await renderRounds(person, projects, info, activitySince); } catch (e) { const c = $('#card-deadlines'); if (c) { c.setAttribute('hidden', ''); c.setAttribute('data-rounds', 'failed'); } }   // wave 7 PR6 (O)
  for (const sk of document.querySelectorAll('.hub-skel')) sk.remove();   // R12: the skeleton leaves with data-ready
  document.body.setAttribute('data-ready', '1');
}

async function initSettingsShell() {
  await showSession();
  const cat = await api('/api/catalog');
  showVault(cat.ok);
}

const page = document.body && document.body.getAttribute('data-page');
if (document.body) { markNav(); armLegacyGate(); setupChrome(); }
if (page === 'today') initToday();
else if (page === 'settings') initSettingsShell();
