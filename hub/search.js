/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB FIND PAGE
   hub/search.html[?q=<query>][&scope=<scope>]

   Scope-aware search over the Vault. Every search runs inside a scope; the header
   form on every page carries one (the project being read, else the remembered
   scope, else the firm), and when none arrives the page searches the firm and
   says so in one muted line (wave 7, R2): a missing scope is a neutral state,
   never an error. Reads only:

     GET /api/projects                 scope choices: project:<id>, and the stateline facts per project
     GET /api/clients                  scope choices: client:<id>
     GET /api/search?q=&scope=&k=50    hits {ref, item_id, run_id, title, snippet, type, date, authors, legal_tag, project_id, stale}
     GET /api/search/people?q=&scope=  colleagues who worked the topic, most recent first
     GET /api/items/:id, /api/runs/:id the record behind a hit, for the panel

   Runs are indexed by the Vault, so they arrive in the same list as documents, typed "run". Hits are grouped under
   the project they belong to, each group headed by the stateline card (hub/components/stateline.js, W7-AC6), and
   every hit has Open record, which opens the record panel in place (hub/record.js builds the body), beside the
   project link that carries ?doc=<item_id> or ?run=<run_id>. Type and date filters apply to the hits already
   returned. The chosen scope is remembered in localStorage; ?q= and ?scope= in the address take precedence and
   are kept in step with the page. Every string a person reads carries data-en and data-es; text that comes from
   the Vault is set through dv()/setText(), which never lets a "<" in a title or snippet become markup.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, fmtShortDate } from './hub.js';
import { stateline } from './components/stateline.js';
import { renderRecord, detailsNode } from './record.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const SCOPE_KEY = 'atc-hub-find-scope';
const DAY = 864e5;
const K = 50;
const DEFAULT_SCOPE = 'firm';

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

const state = {
  q: '', scope: '', defaulted: false, hits: null, people: [], type: 'all', date: 'any', seq: 0,
  projects: new Map(), projectNames: new Map(), clientNames: new Map(), personNames: new Map(),
};

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
  for (const p of projects) { state.projects.set(p.id, p); state.projectNames.set(p.id, p.name || p.id); }
  for (const c of clients) state.clientNames.set(c.id, c.name || c.id);
  const have = new Set();
  const push = (v, en, es) => { if (have.has(v)) return; have.add(v); add(sel, option(v, en, es)); };
  for (const p of projects) push('project:' + p.id, 'Project: ' + (p.name || p.id), 'Proyecto: ' + (p.name || p.id));
  for (const c of clients) push('client:' + c.id, 'Client: ' + (c.name || c.id) + ' (all projects)', 'Cliente: ' + (c.name || c.id) + ' (todos los proyectos)');
  push('firm', 'Firm: lessons, templates, firm-tagged', 'Firma: lecciones, plantillas, etiquetadas como firma');
  push('public', 'Public: regulators, papers, feeds', 'Público: reguladores, artículos, fuentes');
  if (wanted && !have.has(wanted)) push(wanted, wanted, wanted);   // an address may name a scope the lists did not (the server decides)
  if (!pr.ok && !cl.ok && (pr.status === 0 || cl.status === 0)) showVault(false); else showVault(pr.ok || cl.ok);
}

/** What a scope is called when a person reads it: the project's or client's name, the firm, public records. */
export function scopeLabel(scope) {
  const s = String(scope || '');
  const kind = s.split(':')[0], id = s.slice(kind.length + 1);
  if (kind === 'project') { const n = state.projectNames.get(id) || id; return bi(n, n); }
  if (kind === 'client') { const n = state.clientNames.get(id) || id; return bi(n, n); }
  if (kind === 'firm') return bi('the firm', 'la firma');
  if (kind === 'public') return bi('public records', 'los registros públicos');
  return bi(s, s);
}

/** The plain-English sentence for a chosen scope (R2): what the search covers, never a predicate. */
export function scopeNote(scope) {
  const kind = String(scope || '').split(':')[0];
  const name = scopeLabel(scope);
  const note = {
    project: bi('Inside ' + name.en + ', plus firm and public records.', 'Dentro de ' + name.es + ', más los registros de la firma y públicos.'),
    client: bi('Across every ' + name.en + ' project you may see, plus firm and public records.', 'En todos los proyectos de ' + name.es + ' que usted puede ver, más los registros de la firma y públicos.'),
    firm: bi('Firm records and public records. No client records.', 'Registros de la firma y públicos. Ningún registro de cliente.'),
    public: bi('Public records only: regulators, papers, feeds.', 'Solo registros públicos: reguladores, artículos, fuentes.'),
  }[kind];
  return note || null;
}

function renderPred() {
  const el = $('#scope-pred');
  el.textContent = '';
  if (state.defaulted) {
    // No scope arrived and none is remembered: the firm is searched, and one muted line says so.
    el.setAttribute('data-scope-state', 'default');
    add(el, mk('span', null, 'Searching the firm. ', 'Buscando en la firma. '));
    const b = mk('button', 'hub-linkbtn find-change-scope', 'Change scope ▾', 'Cambiar alcance ▾', { type: 'button' });
    b.addEventListener('click', () => { const sel = $('#find-scope'); sel.focus(); if (typeof sel.showPicker === 'function') { try { sel.showPicker(); } catch (e) { /* needs a gesture */ } } });
    add(el, b);
    return;
  }
  el.setAttribute('data-scope-state', 'chosen');
  const n = scopeNote(state.scope);
  if (n) add(el, mk('span', null, n.en, n.es));
  else add(el, mk('span', null, 'Inside this scope, plus firm and public records.', 'Dentro de este alcance, más los registros de la firma y públicos.'));
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

/** A snippet as a person should read it: the chunker's markdown heading markers go, line breaks become spaces (R11). */
export function cleanSnippet(s) {
  return String(s == null ? '' : s)
    .replace(/(^|[\s…])#{1,6}[ \t]+(Page|Página)[ \t]+\d+[ \t]*(?=$|[\r\n])/gi, '$1')   // the chunker's page heading is noise
    .replace(/(^|[\s…])#{1,6}[ \t]+/g, '$1')                                             // any other heading keeps its words
    .replace(/\s*[\r\n]+\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * The language toggle (main.js) writes data-en/data-es as the element's whole text, which would wipe the children
 * of a composed element such as a stateline token. Wrap the element's own text in a span that carries the pair and
 * drop the pair from the parent, so the toggle translates the words and leaves the dot, the label and the date alone.
 */
function bilingualSafe(root) {
  for (const el of root.querySelectorAll('[data-en]')) {
    if (!el.children.length) continue;
    const en = el.getAttribute('data-en'), es = el.getAttribute('data-es');
    el.removeAttribute('data-en'); el.removeAttribute('data-es');
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!texts.length || !en) continue;
    const span = mk('span', null, en, es == null ? en : es);
    el.insertBefore(span, texts[0]);
    for (const t of texts) t.remove();
  }
  return root;
}

/* ── results ─────────────────────────────────────────────────────────── */

const initials = (name) => String(name || '?').split(/[\s.@-]+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join('') || '?';
const personName = (id) => state.personNames.get(id) || id;

function avatar(id) {
  return dv('span', 'find-av', initials(personName(id)), { title: personName(id), 'data-person': id });
}

/** The project page opens the record the hit names: ?run= for a run, ?doc= for a document. */
function hitHref(h) {
  const p = new URLSearchParams({ id: h.project_id });
  if (h.run_id) p.set('run', h.run_id);
  else if (h.item_id) p.set('doc', h.item_id);
  return '/hub/project.html?' + p.toString();
}

function resultItem(h, terms) {
  const group = typeGroup(h.type);
  const li = mk('li', 'result', null, null, { 'data-ref': h.ref, 'data-type': group });
  add(li, mk('div', 'r-ico', null, null, { title: (SINGULAR[group] || SINGULAR.other).en, 'aria-hidden': 'true' }));
  li.firstChild.innerHTML = ICONS[group] || ICONS.other;

  const body = mk('div');
  const title = mk('div', 'r-title');
  const link = mk('a', null, null, null, { href: hitHref(h) });
  add(link, highlight(mk('span'), h.title || h.ref, terms));
  add(body, add(title, link));
  const snippet = cleanSnippet(h.snippet);
  if (snippet) add(body, highlight(mk('div', 'snip'), snippet, terms));

  const t = SINGULAR[group] || SINGULAR.other;
  const when = h.date ? fmtShortDate(h.date) : null;
  const meta = mk('div', 'r-meta');
  add(meta, mk('span', 'hub-pill ghost', t.en, t.es));
  if (when) add(meta, mk('span', 'r-when', when.en, when.es));
  const lt = mk('span', 'hub-lt', null, null, { 'data-legal-tag': h.legal_tag });
  lt.insertAdjacentHTML('afterbegin', LOCK);
  add(lt, dv('span', null, h.legal_tag));
  add(meta, lt);
  if (h.stale) add(meta, mk('span', 'hub-stale', 'Stale', 'Obsoleta'));
  add(body, meta);

  // Actions: Open record (the panel, in place) and the project page on that record.
  const act = mk('div', 'r-actions');
  const open = mk('button', 'hub-linkbtn find-open', 'Open record', 'Abrir registro', { type: 'button', 'data-open-record': h.ref });
  open.addEventListener('click', () => openRecord({ ref: h.ref, title: h.title, trigger: open, hit: h }));
  add(act, open, mk('a', 'find-in-project', 'In the project file', 'En el expediente', { href: hitHref(h) }));
  add(body, act);
  add(li, body);

  const side = mk('div', 'r-side');
  const authors = (h.authors || []).filter(Boolean);
  if (authors.length) {
    const who = mk('div');
    add(who, mk('div', 'label', 'Who worked this', 'Quién trabajó esto'), add(mk('span', 'find-av-stack'), ...authors.slice(0, 4).map(avatar)));
    add(side, who);
  }
  add(li, side);
  return li;
}

/** The group head for a project: its name, then the stateline card from the same component as the project header and Today (W7-AC6). */
function groupHead(pid) {
  const p = state.projects.get(pid);
  const head = mk('div', 'find-group-head');
  if (p) {
    add(head, mk('a', 'find-group-name', p.name || p.id, p.name || p.id, { href: '/hub/project.html?id=' + encodeURIComponent(p.id) }));
    add(head, bilingualSafe(stateline(p, { size: 'card' })));
  } else if (pid) {
    add(head, mk('a', 'find-group-name', pid, pid, { href: '/hub/project.html?id=' + encodeURIComponent(pid) }));
  } else {
    add(head, mk('span', 'find-group-name', 'Firm and public records', 'Registros de la firma y públicos'));
  }
  return head;
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
    add(b, mk('span', null, en, es), document.createTextNode(' '), dv('span', 'n hub-num', '(' + n + ')'));
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
  const label = scopeLabel(state.scope);
  const n = shown.length;
  const c = $('#find-count'); c.textContent = '';
  add(c, dv('b', 'hub-num', String(n), { 'data-count': String(n) }), document.createTextNode(' '), mk('span', null, n === 1 ? 'result for' : 'results for', n === 1 ? 'resultado para' : 'resultados para'),
    document.createTextNode(' “'), dv('span', null, state.q), document.createTextNode('” '), mk('span', null, 'in', 'en'), document.createTextNode(' '), mk('b', null, label.en, label.es));
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
  // One group per project, in order of first appearance; the hits keep the server's ranking inside each group.
  const groups = new Map();
  for (const h of shown) {
    const key = h.project_id || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  const ul = mk('ul', 'find-groups');
  for (const [pid, hits] of groups) {
    const li = mk('li', 'find-group', null, null, { 'data-project': pid });
    add(li, groupHead(pid));
    const ol = mk('ol', 'find-list');
    for (const h of hits) add(ol, resultItem(h, terms));
    add(li, ol);
    add(ul, li);
  }
  add(out, ul);
}

/* ── the record panel, in place ──────────────────────────────────────── */

let panelTrigger = null;
const versionsCache = new Map();

function closePanel() {
  const p = $('#record-panel');
  if (!p || p.hasAttribute('hidden')) return;
  p.setAttribute('hidden', '');
  const scrim = $('#record-scrim'); if (scrim) scrim.setAttribute('hidden', '');
  document.body.classList.remove('has-panel');
  if (panelTrigger && panelTrigger.isConnected) panelTrigger.focus();
  panelTrigger = null;
}

/**
 * Opens the side panel (a bottom sheet below 1200 px) for a hit's record (run:<uuid> or doc:<uuid>): the same
 * highlights, related cards and closed Full record disclosure the project page shows, built by hub/record.js.
 */
async function openRecord({ ref, title, trigger, hit }) {
  const panel = $('#record-panel'), body = $('#rp-body');
  if (!panel) return;
  const first = panel.hasAttribute('hidden');
  if (first || hit) panelTrigger = trigger || document.activeElement;   // a pivot inside the panel keeps the hit that opened it
  const kind = ref.startsWith('run:') ? 'run' : ref.startsWith('doc:') ? 'doc' : 'ref';
  const kindLabel = { run: ['Run', 'Ejecución'], doc: ['Document', 'Documento'], ref: ['Reference set', 'Conjunto de referencia'] }[kind];
  setText($('#rp-kind'), kindLabel[0], kindLabel[1]);
  setText($('#rp-title'), title || ref);
  panel.setAttribute('data-ref', ref);
  panel.removeAttribute('hidden');
  const scrim = $('#record-scrim'); if (scrim) scrim.removeAttribute('hidden');
  document.body.classList.add('has-panel');
  body.textContent = '';
  add(body, mk('p', 'hub-muted', 'Loading the record…', 'Cargando el registro…'));
  $('#rp-title').focus();

  let rec = null, res = null;
  const uuid = ref.slice(ref.indexOf(':') + 1);
  if (kind === 'run') res = await api('/api/runs/' + encodeURIComponent(uuid));
  else if (kind === 'doc') res = await api('/api/items/' + encodeURIComponent(uuid));
  if (panel.getAttribute('data-ref') !== ref) return;          // another record was opened meanwhile
  if (res && res.ok && res.body) rec = res.body;
  if (rec && rec.title) setText($('#rp-title'), rec.title);
  const pid = (rec && rec.project_id) || (hit && hit.project_id);
  // What the hit knows stands in for the timeline entry the project page would have.
  const entry = hit ? { kind: kind === 'run' ? 'run' : 'item', ref, id: uuid, at: hit.date, title: hit.title, type: hit.type, legal_tag: hit.legal_tag, stale: !!hit.stale, stale_reasons: [] } : null;
  const ctx = {
    project: pid ? state.projects.get(pid) || { id: pid, name: state.projectNames.get(pid) || pid } : null,
    entryById: new Map(), lineage: null,
    versionsOf: async (id) => {
      if (!versionsCache.has(id)) {
        const r = await api('/api/items/' + encodeURIComponent(id) + '/versions');
        versionsCache.set(id, r.ok ? listOf(r.body, 'versions') : null);
      }
      return versionsCache.get(id);
    },
    open: (r, t, b) => openRecord({ ref: r, title: t, trigger: b }),
    openDraft: null,
  };
  const content = await renderRecord({ kind, ref, rec, node: null, entry, ctx });
  if (panel.getAttribute('data-ref') !== ref) return;
  body.textContent = '';
  add(body, content);
  if (!rec && kind !== 'ref') {
    const msg = res && res.body && res.body.error && res.body.error.message;
    add(body, notice('warn', 'Full record unavailable.', 'Registro completo no disponible.', 'Showing what the search knows' + (msg ? ' (' + msg + ')' : '') + '.', 'Se muestra lo que conoce la búsqueda' + (msg ? ' (' + msg + ')' : '') + '.'));
  }
  add(body, detailsNode(rec || { hit: hit || null }));
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
    if (state.scope && !state.defaulted) u.searchParams.set('scope', state.scope); else u.searchParams.delete('scope');
    history.replaceState(null, '', u.pathname + u.search);
  } catch (e) { /* no history */ }
}

async function run() {
  const sel = $('#find-scope');
  state.q = $('#find-q').value.trim();
  state.scope = sel.value || DEFAULT_SCOPE;
  syncUrl();
  renderPred();
  setNotice(null);
  closePanel();
  if (!state.defaulted) remember(state.scope);
  if (!state.q) {
    state.hits = null;
    showState(stateBlock('Enter a query', 'Escriba una consulta', 'Search never runs without a query.', 'La búsqueda nunca se ejecuta sin una consulta.'));
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
  const kept = remembered();
  const wanted = fromUrl || kept || DEFAULT_SCOPE;
  state.defaulted = !fromUrl && !kept;
  $('#find-q').value = q;
  showSession();
  await loadScopes(wanted);
  const sel = $('#find-scope');
  sel.value = [...sel.options].some((o) => o.value === wanted) ? wanted : DEFAULT_SCOPE;
  state.scope = sel.value; state.q = q;
  renderPred();
  $('#find-form').addEventListener('submit', (ev) => { ev.preventDefault(); run(); });
  sel.addEventListener('change', () => { state.defaulted = false; state.scope = sel.value; remember(sel.value); renderPred(); syncUrl(); if ($('#find-q').value.trim()) run(); });
  $('#find-date').addEventListener('change', (ev) => { state.date = ev.target.value; renderResults(); });
  const close = $('#rp-close'); if (close) close.addEventListener('click', closePanel);
  const scrim = $('#record-scrim'); if (scrim) scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePanel(); });
  if (q) await run();
  else showState(stateBlock('Enter a query', 'Escriba una consulta', 'Type what you are looking for; the scope above says where it is searched.', 'Escriba lo que busca; el alcance de arriba indica dónde se busca.'));
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'find') init();
