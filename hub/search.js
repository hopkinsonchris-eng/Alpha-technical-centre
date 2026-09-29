/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB FIND PAGE (M12)
   hub/search.html[?q=<query>][&scope=<scope>]

   Scope-aware search over the Vault. The scope is mandatory: with none chosen
   the page says so and sends nothing. Reads only:

     GET /api/projects                 scope choices: project:<id>
     GET /api/clients                  scope choices: client:<id>
     GET /api/search?q=&scope=&k=50    hits {ref, title, snippet, type, date, authors, legal_tag, project_id, stale}
     GET /api/search/people?q=&scope=  colleagues who worked the topic, most recent first

   Type and date filters apply to the hits already returned. The chosen scope is
   remembered in localStorage; ?q= and ?scope= in the address take precedence and
   are kept in step with the page. Every string a person reads carries data-en and
   data-es; text that comes from the Vault is set through dv()/setText(), which
   never lets a "<" in a title or snippet become markup.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, fmtShortDate } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const SCOPE_KEY = 'atc-hub-find-scope';
const DAY = 864e5;
const K = 50;

const bi = (en, es) => ({ en, es: es === undefined ? en : es });

/* ── remembered scope ────────────────────────────────────────────────── */

const remembered = () => { try { return localStorage.getItem(SCOPE_KEY) || ''; } catch (e) { return ''; } };
const remember = (v) => { try { if (v) localStorage.setItem(SCOPE_KEY, v); } catch (e) { /* private window */ } };

/* ── types ───────────────────────────────────────────────────────────── */

const TYPES = [
  ['all', 'All types', 'Todos los tipos'], ['run', 'Runs', 'Ejecuciones'], ['letter', 'Letters', 'Cartas'], ['email', 'Emails', 'Correos'],
  ['report', 'Reports', 'Informes'], ['spreadsheet', 'Spreadsheets & data', 'Hojas de cálculo y datos'], ['paper', 'Papers', 'Artículos'],
  ['feed', 'Feeds & regulator', 'Fuentes y reguladores'], ['lesson', 'Lessons', 'Lecciones'], ['note', 'Notes', 'Notas'], ['other', 'Other', 'Otros'],
];
const TYPE_LABEL = new Map(TYPES.map(([k, en, es]) => [k, bi(en, es)]));
const SINGULAR = { run: bi('Run', 'Ejecución'), letter: bi('Letter', 'Carta'), email: bi('Email', 'Correo'), report: bi('Report', 'Informe'), spreadsheet: bi('Spreadsheet', 'Hoja de cálculo'), paper: bi('Paper', 'Artículo'), feed: bi('Feed', 'Fuente'), lesson: bi('Lesson', 'Lección'), note: bi('Note', 'Nota'), other: bi('Other', 'Otro') };

/** The filter group of a hit's type. */
export function typeGroup(t) {
  const s = String(t || '').toLowerCase();
  if (['run', 'letter', 'email', 'report', 'paper', 'lesson', 'note'].includes(s)) return s;
  if (['spreadsheet', 'sheet', 'csv', 'xlsx', 'data'].includes(s)) return 'spreadsheet';
  if (['feed', 'feed-snapshot', 'reference-set', 'regulation', 'regulator'].includes(s)) return 'feed';
  return 'other';
}

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const ICONS = {
  run: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  letter: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>'),
  email: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  report: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h3v5H9z"/>'),
  spreadsheet: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  paper: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
  feed: svg('<path d="M5 19a1 1 0 1 0 0 .01M5 12a7 7 0 0 1 7 7M5 5a14 14 0 0 1 14 14"/>'),
  lesson: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>'),
  note: svg('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>'),
  other: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
};
const LOCK = svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');

/* ── state ───────────────────────────────────────────────────────────── */

const state = { q: '', scope: '', hits: null, people: [], type: 'all', date: 'any', projectNames: new Map(), personNames: new Map(), seq: 0 };

/* ── notices and states ──────────────────────────────────────────────── */

function notice(kind, boldEn, boldEs, en, es) {
  const n = mk('div', 'hub-notice ' + kind, null, null, kind === 'bad' ? { role: 'alert' } : null);
  add(n, add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
  return n;
}
function setNotice(n) { const box = $('#notices'); box.textContent = ''; if (n) add(box, n); }

function stateBlock(titleEn, titleEs, en, es) {
  const d = mk('div', 'find-state');
  add(d, add(mk('b'), mk('span', null, titleEn, titleEs)), mk('span', null, en, es));
  return d;
}

function showState(block, countEn, countEs) {
  const c = $('#find-count'); c.textContent = '';
  if (countEn) setText(c, countEn, countEs);
  const r = $('#find-results'); r.textContent = ''; add(r, block);
  $('#find-who').hidden = true; $('#find-types').hidden = true; $('#find-date-wrap').hidden = true;
}

/* ── scope selector ──────────────────────────────────────────────────── */

function option(value, en, es) { const o = mk('option', null, en, es, { value }); return o; }

async function loadScopes(wanted) {
  const sel = $('#find-scope');
  const [pr, cl] = await Promise.all([api('/api/projects'), api('/api/clients')]);
  const projects = listOf(pr.body, 'projects'), clients = listOf(cl.body, 'clients');
  for (const p of projects) state.projectNames.set(p.id, p.name || p.id);
  const have = new Set(['']);
  const push = (v, en, es) => { if (have.has(v)) return; have.add(v); add(sel, option(v, en, es)); };
  for (const p of projects) push('project:' + p.id, 'Project: ' + (p.name || p.id), 'Proyecto: ' + (p.name || p.id));
  for (const c of clients) push('client:' + c.id, 'Client: ' + (c.name || c.id) + ' (all projects)', 'Cliente: ' + (c.name || c.id) + ' (todos los proyectos)');
  push('firm', 'Firm: lessons, templates, firm-tagged', 'Firma: lecciones, plantillas, etiquetadas como firma');
  push('public', 'Public: regulators, papers, feeds', 'Público: reguladores, artículos, fuentes');
  if (wanted && !have.has(wanted)) push(wanted, wanted, wanted);   // an address may name a scope the lists did not (the server decides)
  if (!pr.ok && !cl.ok && (pr.status === 0 || cl.status === 0)) showVault(false); else showVault(pr.ok || cl.ok);
}

export function scopeNote(scope) {
  const kind = String(scope || '').split(':')[0];
  const note = {
    project: bi('This project and the same client\'s records you may see, plus firm and public records.', 'Este proyecto y los registros del mismo cliente que usted puede ver, más los registros de la firma y públicos.'),
    client: bi('Every project of this client you may see, plus firm and public records.', 'Todos los proyectos de este cliente que usted puede ver, más los registros de la firma y públicos.'),
    firm: bi('Firm records (lessons, templates) and public records. No client records.', 'Registros de la firma (lecciones, plantillas) y públicos. Ningún registro de cliente.'),
    public: bi('Public records only: regulators, papers, feeds.', 'Solo registros públicos: reguladores, artículos, fuentes.'),
  }[kind];
  return note || null;
}

function renderPred() {
  const el = $('#scope-pred');
  el.textContent = '';
  const n = scopeNote(state.scope);
  if (!n) { setText(el, 'Choose a scope: search never runs without one.', 'Elija un alcance: la búsqueda nunca se ejecuta sin uno.'); return; }
  const code = dv('code', null, 'scope = ' + state.scope);
  add(el, code, document.createTextNode('  AND  legal_tag.expires_at > now()  → '), mk('span', null, n.en, n.es));
}

/* ── highlighting ────────────────────────────────────────────────────── */

export function termsOf(q) {
  return [...new Set(String(q || '').toLowerCase().split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
}

/** Appends `text` to `parent` with each query term wrapped in <mark>. Each piece carries data-en and data-es. */
export function highlight(parent, text, terms) {
  const s = String(text == null ? '' : text);
  if (!terms.length) { add(parent, dv('span', null, s)); return parent; }
  const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'giu');
  s.split(re).forEach((part, i) => { if (part) add(parent, dv(i % 2 ? 'mark' : 'span', null, part)); });
  return parent;
}

/* ── results ─────────────────────────────────────────────────────────── */

const initials = (name) => String(name || '?').split(/[\s.@-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
const personName = (id) => state.personNames.get(id) || id;

function avatar(id) {
  return dv('span', 'find-av', initials(personName(id)), { title: personName(id), 'data-person': id });
}

function hitHref(h) {
  const p = new URLSearchParams({ id: h.project_id });
  if (h.run_id) p.set('run', h.run_id);
  return 'project.html?' + p.toString();
}

function resultItem(h, terms) {
  const group = typeGroup(h.type);
  const li = mk('li', 'result', null, null, { 'data-ref': h.ref, 'data-type': group });
  add(li, mk('div', 'r-ico', null, null, { title: (SINGULAR[group] || SINGULAR.other).en, 'aria-hidden': 'true' }));
  li.firstChild.innerHTML = ICONS[group] || ICONS.other;

  const body = mk('div');
  const title = mk('div', 'r-title');
  const link = mk('a', null, null, null, { href: hitHref(h) });
  highlight(link, h.title || h.ref, terms);
  add(body, add(title, link));
  if (h.snippet) add(body, highlight(mk('div', 'snip'), h.snippet, terms));

  const pname = state.projectNames.get(h.project_id) || h.project_id;
  const t = SINGULAR[group] || SINGULAR.other;
  const when = h.date ? fmtShortDate(h.date) : null;
  const path = mk('div', 'path');
  add(path, dv('span', null, pname), document.createTextNode(' · '), mk('span', null, t.en, t.es));
  if (when) add(path, document.createTextNode(' · '), mk('span', null, when.en, when.es));
  add(body, path);

  const meta = mk('div', 'r-meta');
  const lt = mk('span', 'hub-lt', null, null, { 'data-legal-tag': h.legal_tag });
  lt.insertAdjacentHTML('afterbegin', LOCK);
  add(lt, dv('span', null, h.legal_tag));
  add(meta, lt, mk('span', 'hub-pill ghost', t.en, t.es));
  if (h.stale) add(meta, mk('span', 'hub-stale', 'Stale', 'Obsoleta'));
  add(body, meta);
  add(li, body);

  const side = mk('div', 'r-side');
  if (when) add(side, mk('span', null, when.en, when.es));
  const authors = (h.authors || []).filter(Boolean);
  if (authors.length) {
    const who = mk('div');
    add(who, mk('div', 'label', 'Who worked this', 'Quién trabajó esto'), add(mk('span', 'find-av-stack'), ...authors.slice(0, 4).map(avatar)));
    add(side, who);
  }
  add(li, side);
  return li;
}

const inDate = (h, now) => state.date === 'any' || (h.date && (now - Date.parse(h.date)) / DAY <= Number(state.date));

function renderChips(dated) {
  const box = $('#find-types');
  box.textContent = '';
  const counts = new Map();
  for (const h of dated) { const g = typeGroup(h.type); counts.set(g, (counts.get(g) || 0) + 1); }
  for (const [k, en, es] of TYPES) {
    const n = k === 'all' ? dated.length : counts.get(k) || 0;
    if (k !== 'all' && !n) continue;
    const b = mk('button', 'find-chip', null, null, { type: 'button', 'data-type': k, 'aria-pressed': String(state.type === k) });
    add(b, mk('span', null, en, es), document.createTextNode(' '), dv('span', 'n', '(' + n + ')'));
    b.addEventListener('click', () => { state.type = k; renderResults(); });
    add(box, b);
  }
  box.hidden = false;
}

function renderWho() {
  const box = $('#find-who');
  box.textContent = '';
  if (!state.people.length) { box.hidden = true; return; }
  add(box, mk('span', 'label', 'Who worked this', 'Quién trabajó esto'));
  for (const p of state.people) {
    const d = fmtShortDate(p.last_at);
    const chip = mk('span', 'find-who-chip', null, null, { 'data-person': p.person_id });
    add(chip, avatar(p.person_id), dv('span', null, p.name || p.person_id), add(mk('small'), mk('span', null, 'last ' + d.en, 'último ' + d.es)));
    add(box, chip);
  }
  box.hidden = false;
}

function renderResults() {
  if (state.hits === null) return;
  const now = Date.now();
  const dated = state.hits.filter((h) => inDate(h, now));
  if (state.type !== 'all' && !dated.some((h) => typeGroup(h.type) === state.type)) state.type = 'all';
  const shown = state.type === 'all' ? dated : dated.filter((h) => typeGroup(h.type) === state.type);
  const terms = termsOf(state.q);
  $('#find-date-wrap').hidden = false;
  const label = state.scope;
  const n = shown.length;
  const c = $('#find-count'); c.textContent = '';
  add(c, dv('b', null, String(n), { 'data-count': String(n) }), document.createTextNode(' '), mk('span', null, n === 1 ? 'result for' : 'results for', n === 1 ? 'resultado para' : 'resultados para'),
    document.createTextNode(' “'), dv('span', null, state.q), document.createTextNode('” '), mk('span', null, 'in', 'en'), document.createTextNode(' '), dv('b', null, label));
  renderChips(dated);
  renderWho();
  const out = $('#find-results'); out.textContent = '';
  if (!n) {
    const filtered = state.hits.length > 0;
    add(out, stateBlock('No results' + (filtered ? ' with these filters' : ''), 'Sin resultados' + (filtered ? ' con estos filtros' : ''),
      filtered ? 'Clear the type or date filter, or widen the scope.' : (state.scope === 'public' ? 'Try other terms.' : 'Try other terms, or widen the scope.'),
      filtered ? 'Quite el filtro de tipo o de fecha, o amplíe el alcance.' : (state.scope === 'public' ? 'Pruebe otros términos.' : 'Pruebe otros términos, o amplíe el alcance.')));
    return;
  }
  const ol = mk('ol', 'find-list');
  for (const h of shown) add(ol, resultItem(h, terms));
  add(out, ol);
}

/* ── search ──────────────────────────────────────────────────────────── */

function errorFor(res) {
  const st = res.status, msg = (res.body && res.body.error && res.body.error.message) || '';
  if (st === 403) return { t: bi('Outside your scope', 'Fuera de su alcance'), b: bi('You may not search this scope' + (msg ? ': ' + msg : '.'), 'No puede buscar en este alcance' + (msg ? ': ' + msg : '.')) };
  if (st === 400) return { t: bi('The search was refused', 'Se rechazó la búsqueda'), b: bi(msg || 'The query or the scope is not valid.', msg || 'La consulta o el alcance no son válidos.') };
  return { t: bi('The Vault is unreachable', 'El Vault no es accesible'), b: bi('The search could not be run' + (msg ? ': ' + msg : '. Try again in a moment.'), 'No se pudo ejecutar la búsqueda' + (msg ? ': ' + msg : '. Inténtelo de nuevo en un momento.')) };
}

function syncUrl() {
  try {
    const u = new URL(location.href);
    if (state.q) u.searchParams.set('q', state.q); else u.searchParams.delete('q');
    if (state.scope) u.searchParams.set('scope', state.scope); else u.searchParams.delete('scope');
    history.replaceState(null, '', u.pathname + u.search);
  } catch (e) { /* no history */ }
}

async function run() {
  const sel = $('#find-scope');
  state.q = $('#find-q').value.trim();
  state.scope = sel.value;
  syncUrl();
  renderPred();
  setNotice(null);
  sel.removeAttribute('aria-invalid');
  if (!state.scope) {
    sel.setAttribute('aria-invalid', 'true');
    setNotice(notice('bad', 'Scope required.', 'Alcance obligatorio.', 'Choose a scope before searching. Nothing is sent without one.', 'Elija un alcance antes de buscar. No se envía nada sin uno.'));
    state.hits = null;
    showState(stateBlock('Choose a scope', 'Elija un alcance', 'Search only runs inside a project, a client, the firm or public records.', 'La búsqueda solo se ejecuta dentro de un proyecto, un cliente, la firma o los registros públicos.'));
    sel.focus();
    return;
  }
  remember(state.scope);
  if (!state.q) {
    state.hits = null;
    showState(stateBlock('Enter a query', 'Escriba una consulta', 'Scope is set. Search never runs without a query.', 'El alcance está fijado. La búsqueda nunca se ejecuta sin una consulta.'));
    $('#find-q').focus();
    return;
  }
  const mine = ++state.seq;
  showState(stateBlock('Searching…', 'Buscando…', '', ''));
  const qs = new URLSearchParams({ q: state.q, scope: state.scope });
  const [res, ppl] = await Promise.all([api('/api/search?' + qs + '&k=' + K), api('/api/search/people?' + qs)]);
  if (mine !== state.seq) return;
  if (!res.ok) {
    const e = errorFor(res);
    state.hits = null;
    setNotice(notice('bad', e.t.en + '.', e.t.es + '.', e.b.en, e.b.es));
    showState(stateBlock(e.t.en, e.t.es, 'No results were returned.', 'No se devolvió ningún resultado.'));
    if (res.status === 0) showVault(false);
    return;
  }
  showVault(true);
  state.hits = listOf(res.body, 'hits', 'results');
  state.people = ppl.ok ? listOf(ppl.body, 'people') : [];
  state.personNames = new Map(state.people.map((p) => [p.person_id, p.name || p.person_id]));
  state.type = 'all';
  renderResults();
}

/* ── init ────────────────────────────────────────────────────────────── */

async function init() {
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').trim();
  const fromUrl = (params.get('scope') || '').trim();
  const wanted = fromUrl || remembered();
  $('#find-q').value = q;
  showSession();
  await loadScopes(wanted);
  const sel = $('#find-scope');
  sel.value = wanted && [...sel.options].some((o) => o.value === wanted) ? wanted : '';
  state.scope = sel.value; state.q = q;
  renderPred();
  $('#find-form').addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
  sel.addEventListener('change', () => { state.scope = sel.value; renderPred(); sel.removeAttribute('aria-invalid'); if (sel.value) remember(sel.value); if ($('#find-q').value.trim()) run(); });
  $('#find-date').addEventListener('change', (ev) => { state.date = ev.target.value; renderResults(); });
  if (q) await run();
  else showState(stateBlock('Enter a query', 'Escriba una consulta', state.scope ? 'Scope is set. Search never runs without a query.' : 'Choose a scope and type a query. Search never runs without both.', state.scope ? 'El alcance está fijado. La búsqueda nunca se ejecuta sin una consulta.' : 'Elija un alcance y escriba una consulta. La búsqueda nunca se ejecuta sin ambos.'));
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'find') init();
