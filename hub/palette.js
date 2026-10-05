/* ============================================================
   The command menu (wave 2, docs/vault-hub/wave2/05-markup.md §1.5, P20;
   wave 7 PR2 R7). Cmd/Ctrl+K or the header button on every Hub page.
   Groups, in order: this project's tools and actions (on a project page),
   projects, records, contacts, organisations, countries, tools, pages.
   Projects, countries, tools and pages match locally on the typed text;
   records come from GET /api/search?q=&scope=firm&limit=5 and contacts and
   organisations from GET /api/organisations?q=, both debounced 150 ms after
   the third character. A country matches on a word start only, and a
   country the Vault does not hold never outranks a record. On touch the
   trigger is a search icon and "Jump".
   ============================================================ */
import { api, listOf, mk, dv, add, setText, loadCatalog, loadGeo, openTarget, lang, armLegacyGate } from './hub.js';

/** Wave 7 (S10): a row shows only on a word-start or contiguous match (label 1 or 2, key 2 or 3); a bare subsequence ("nodal" in "French Southern and Antarctic Lands") no longer qualifies. */
const SHOW_BELOW = 4;
const WORD_START = 1;                 // the fuzzy score of a match at the start of a word
const QUIET_PENALTY = 2;              // a country the Vault does not hold ranks after any Vault hit
const REMOTE_MIN = 3;                 // characters typed before the Vault is asked
const REMOTE_DEBOUNCE_MS = 150;
const RECORD_LIMIT = 5;

const PAGES = [
  ['/hub/index.html', 'Today', 'Hoy'], ['/hub/search.html', 'Find across the Vault', 'Buscar en el Vault'], ['/hub/queue.html', 'Filing queue', 'Cola de archivo'],
  ['/hub/tool.html', 'Tools', 'Herramientas'],
  ['/hub/analogues.html', 'Analogues', 'Análogos'], ['/hub/cost.html', 'Cost and usage', 'Costes y uso'], ['/hub/settings.html', 'Settings', 'Ajustes'],
];
const GROUP = { context: ['In this project', 'En este proyecto'], projects: ['Projects', 'Proyectos'], records: ['Records', 'Registros'], contacts: ['Contacts', 'Contactos'], organisations: ['Organisations', 'Organizaciones'], countries: ['Countries', 'Países'], tools: ['Tools', 'Herramientas'], pages: ['Pages', 'Páginas'] };
const ORDER = ['context', 'projects', 'records', 'contacts', 'organisations', 'countries', 'tools', 'pages'];
const TYPE_WORD = { run: ['run', 'ejecución'], email: ['email', 'correo'], letter: ['letter', 'carta'], report: ['report', 'informe'], note: ['note', 'nota'], paper: ['paper', 'artículo'], document: ['document', 'documento'], invoice: ['invoice', 'factura'], contract: ['contract', 'contrato'], dossier: ['dossier', 'dossier'], csv: ['CSV', 'CSV'], image: ['image', 'imagen'] };

/** Subsequence score: lower is better; -1 when the query is not a subsequence of the text. Word starts and runs score better. */
export function fuzzy(query, text) {
  const q = query.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!q) return 0;
  if (t.includes(q)) return t.indexOf(q) === 0 || /[\s\-/(]/.test(t[t.indexOf(q) - 1] || ' ') ? 1 : 2;
  let ti = 0, score = 10, last = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    score += i === last + 1 ? 0 : 3;
    last = i; ti = i + 1;
  }
  return score;
}

let items = [];          // {group, label:{en,es}, sub?:{en,es}, href?, action?, blank?}
let remote = [];         // records, contacts and organisations for the current query, from the Vault
let remoteFor = '';      // the query the remote items answer
let remoteTimer = 0, remoteSeq = 0;
let open = false, selected = 0, loaded = null;
let root, input, list, empty, btn;

function pageContext() {
  const page = document.body.getAttribute('data-page');
  const id = page === 'project' ? new URLSearchParams(location.search).get('id') : null;
  return { page, projectId: id };
}
/** A touch device shows no keyboard shortcut: the trigger is a search icon and "Jump". */
const isTouch = () => { try { return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } };

async function loadItems() {
  if (loaded) return loaded;
  loaded = (async () => {
    const { projectId } = pageContext();
    const [pr, cat, geo, cr] = await Promise.all([api('/api/projects'), loadCatalog(), loadGeo(), api('/api/countries')]);
    const out = [];
    const siteRoot = new URL('../', location.href);
    const tools = cat.catalog ? cat.catalog.tools.filter((t) => t.lifecycle === 'production') : [];
    const byId = new Map(tools.map((t) => [t.id, t]));
    if (projectId) {
      for (const t of tools.filter((t) => t.hub && (t.hub.context || []).includes('project')).sort((a, b) => (a.hub.toolbar ?? 999) - (b.hub.toolbar ?? 999))) {
        const target = openTarget(t, byId, siteRoot);
        const u = new URL(target.href); u.searchParams.set(t.hub.param || 'project', projectId);
        out.push({ group: 'context', label: { en: 'Open ' + t.name + ' in this project', es: 'Abrir ' + t.name + ' en este proyecto' }, href: u.href, blank: target.external, tool: true });
      }
      out.push({ group: 'context', label: { en: 'Add documents', es: 'Añadir documentos' }, action: () => { const el = document.querySelector('#up-files'); if (el) { el.closest('section').scrollIntoView({ block: 'start' }); el.focus(); } } });
      out.push({ group: 'context', label: { en: 'Change stage', es: 'Cambiar etapa' }, action: () => { const el = document.querySelector('#p-stage'); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } } });
    }
    const names = new Map();
    if (geo) for (const f of geo.features) if (!names.has(f.properties.iso2)) names.set(f.properties.iso2, { en: f.properties.en, es: f.properties.es });
    for (const p of pr.ok ? listOf(pr.body, 'projects', 'items').filter((p) => p && p.status !== 'archived') : []) {
      const cn = p.country && names.get(p.country);
      const sub = [cn ? cn.en : p.country, p.client_name || p.client_id, p.stage].filter(Boolean).join(' · ');
      const subEs = [cn ? cn.es : p.country, p.client_name || p.client_id, p.stage].filter(Boolean).join(' · ');
      out.push({ group: 'projects', label: { en: p.name, es: p.name }, sub: { en: sub, es: subEs }, keys: [p.id, p.client_name || '', cn ? cn.en + ' ' + cn.es : ''], href: '/hub/project.html?id=' + encodeURIComponent(p.id) });
    }
    const held = cr.ok && cr.body && Array.isArray(cr.body.countries) ? cr.body.countries : [];
    const heldCodes = new Set(held.map((c) => c.code));
    for (const c of held) { const n = names.get(c.code) || c.name; out.push({ group: 'countries', label: n, sub: { en: c.counts.projects + (c.counts.projects === 1 ? ' project' : ' projects'), es: c.counts.projects + (c.counts.projects === 1 ? ' proyecto' : ' proyectos') }, keys: [c.code], href: '/hub/index.html?country=' + c.code }); }
    for (const [code, n] of [...names.entries()].sort((a, b) => a[1].en.localeCompare(b[1].en))) if (!heldCodes.has(code)) out.push({ group: 'countries', label: n, keys: [code], href: '/hub/index.html?country=' + code, quiet: true });
    for (const t of tools) { const target = openTarget(t, byId, siteRoot); out.push({ group: 'tools', label: { en: t.name, es: t.name }, sub: { en: t.aliases.current, es: t.aliases.current }, keys: [t.id], href: target.href, blank: target.external, tool: true }); }
    for (const [href, en, es] of PAGES) out.push({ group: 'pages', label: { en, es }, href });
    out.forEach((it, i) => { it.order = i; });          // insertion order wins among equal matches (toolbar order, name order)
    return out;
  })();
  return loaded;
}

/* ── the Vault's own answers: records, contacts, organisations (R7) ─── */

const recordHref = (h) => {
  const id = h.run_id || h.item_id || (h.ref ? h.ref.slice(h.ref.indexOf(':') + 1) : '');
  const run = !!h.run_id || (h.ref && h.ref.startsWith('run:'));
  return '/hub/project.html?id=' + encodeURIComponent(h.project_id || '') + (run ? '&run=' : '&doc=') + encodeURIComponent(id);
};
/** A record opens in the record panel on the current page when it has one (the page answers the event), else on the project page with ?doc= or &run=. */
function openRecord(h) {
  const id = h.run_id || h.item_id || (h.ref ? h.ref.slice(h.ref.indexOf(':') + 1) : '');
  const ev = new CustomEvent('hub:open-record', { cancelable: true, bubbles: true, detail: { ref: h.ref, id, kind: h.run_id ? 'run' : 'doc', projectId: h.project_id, title: h.title } });
  const panel = document.querySelector('#record-panel');
  if (panel && !document.dispatchEvent(ev)) return;
  location.href = recordHref(h);
}

/** Asks the Vault for the query, 150 ms after the last keystroke, and re-renders when the answer is for the query still typed. */
function askVault(q) {
  clearTimeout(remoteTimer);
  if (q.length < REMOTE_MIN) { remote = []; remoteFor = ''; return; }
  if (q === remoteFor) return;
  remoteTimer = setTimeout(async () => {
    const seq = ++remoteSeq;
    const [sr, orr] = await Promise.all([
      api('/api/search?q=' + encodeURIComponent(q) + '&scope=firm&limit=' + RECORD_LIMIT),
      api('/api/organisations?q=' + encodeURIComponent(q)),
    ]);
    if (seq !== remoteSeq || !open) return;
    const out = [];
    const seen = new Set();
    for (const h of (sr.ok ? listOf(sr.body, 'hits') : []).slice(0, RECORD_LIMIT)) {
      const key = h.ref || h.run_id || h.item_id; if (!key || seen.has(key)) continue; seen.add(key);
      const tw = TYPE_WORD[h.type] || [h.type || 'record', h.type || 'registro'];
      const d = h.date ? new Date(h.date) : null;
      const day = d && !isNaN(d) ? ' · ' + d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      const dayEs = d && !isNaN(d) ? ' · ' + d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      out.push({ group: 'records', label: { en: h.title || key, es: h.title || key }, sub: { en: tw[0] + day, es: tw[1] + dayEs }, href: recordHref(h), action: () => openRecord(h), remote: true });
    }
    const orgs = orr.ok ? listOf(orr.body, 'organisations').filter((o) => o && o.id).slice(0, 5) : [];
    for (const o of orgs) out.push({ group: 'organisations', label: { en: o.name || o.id, es: o.name || o.id }, sub: o.kind ? { en: o.kind, es: o.kind } : null, href: '/hub/search.html?q=' + encodeURIComponent(o.name || o.id) + '&scope=firm', remote: true });
    // Contacts live under their organisations; the first three matching organisations are read for theirs.
    const reads = await Promise.all(orgs.slice(0, 3).map((o) => api('/api/organisations/' + encodeURIComponent(o.id))));
    if (seq !== remoteSeq || !open) return;
    reads.forEach((r, i) => {
      if (!r.ok || !r.body) return;
      for (const c of listOf(r.body, 'contacts').slice(0, 5)) {
        if (!c || !c.name) continue;
        out.push({ group: 'contacts', label: { en: c.name, es: c.name }, sub: { en: [c.role, orgs[i].name].filter(Boolean).join(' · '), es: [c.role, orgs[i].name].filter(Boolean).join(' · ') }, href: '/hub/search.html?q=' + encodeURIComponent(c.name) + '&scope=firm', remote: true });
      }
    });
    remote = out; remoteFor = q;
    render(false);
  }, REMOTE_DEBOUNCE_MS);
}

function build() {
  root = mk('div', 'hub-palette', null, null, { id: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command menu', hidden: '' });
  const box = mk('div', 'hub-palette-box');
  input = mk('input', null, null, null, { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Jump to', 'data-en-ph': 'Type a project, record, country, tool or page…', 'data-es-ph': 'Escriba un proyecto, registro, país, herramienta o página…', placeholder: 'Type a project, record, country, tool or page…' });
  list = mk('div', 'hub-palette-list', null, null, { role: 'listbox', id: 'palette-list' });
  empty = mk('p', 'hub-muted hub-palette-empty', 'Nothing matches.', 'Nada coincide.', { id: 'palette-empty', hidden: '' });
  add(box, input, list, empty, mk('p', 'hub-palette-foot', '↑↓ to move · Enter to open · Esc to close', '↑↓ para moverse · Intro para abrir · Esc para cerrar'));
  add(root, box);
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  input.addEventListener('input', () => render(true));
  input.addEventListener('keydown', (ev) => {
    const vis = visible();
    if (ev.key === 'ArrowDown') { ev.preventDefault(); selected = Math.min(vis.length - 1, selected + 1); paint(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); selected = Math.max(0, selected - 1); paint(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); const it = vis[selected]; if (it) go(it); }
    else if (ev.key === 'Escape') { ev.preventDefault(); close(); }
  });
  document.body.appendChild(root);
  const top = document.querySelector('.hub-top');
  if (top) {
    const touch = isTouch();
    btn = mk('button', 'hub-palette-btn', null, null, { type: 'button', id: 'palette-btn', 'aria-haspopup': 'dialog', title: touch ? 'Jump to a project, record, country, tool or page' : 'Command menu (Ctrl or ⌘ K)', ...(touch ? { 'data-touch': '1' } : {}) });
    if (touch) {
      const ic = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ic.setAttribute('class', 'hub-ic'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true');
      ic.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>';   // static, trusted markup
      add(btn, ic, mk('span', null, 'Jump', 'Ir a'));
    } else add(btn, mk('span', null, 'Jump', 'Ir a'), dv('kbd', null, '⌘K'));
    btn.addEventListener('click', () => (open ? close() : show()));
    top.appendChild(btn);
  }
  if (lang() === 'es') input.setAttribute('placeholder', input.getAttribute('data-es-ph'));
}

let current = [];
function visible() { return current; }
/** Scores the local items for the typed text, folds in the Vault's answers, and paints the list. `typed` asks the Vault again. */
function render(typed) {
  const q = input.value.trim();
  if (typed) askVault(q);
  const scored = [];
  for (const it of items) {
    if (!q && it.quiet) continue;
    let best = -1, labelBest = -1, keyBest = -1;
    for (const t of [it.label.en, it.label.es]) { const s = fuzzy(q, String(t)); if (s >= 0 && (labelBest < 0 || s < labelBest)) labelBest = s; }
    for (const t of it.keys || []) { const s = fuzzy(q, String(t)); if (s >= 0 && (keyBest < 0 || s < keyBest)) keyBest = s; }
    if (labelBest >= 0) best = labelBest;
    if (keyBest >= 0 && (best < 0 || keyBest + 1 < best)) best = keyBest + 1;   // a match on the name beats one on its keys
    if (best < 0 || (q && best >= SHOW_BELOW)) continue;
    // R7: a country matches on a word start only (its name or its code), and one the Vault does not hold ranks after any Vault hit.
    if (q && it.group === 'countries') { if (labelBest !== WORD_START && keyBest !== WORD_START) continue; if (it.quiet) best += QUIET_PENALTY; }
    scored.push({ it, s: best });
  }
  if (q.length >= REMOTE_MIN && remoteFor === q) remote.forEach((it, i) => scored.push({ it: Object.assign({ order: -1000 + i }, it), s: WORD_START }));
  scored.sort((a, b) => ORDER.indexOf(a.it.group) - ORDER.indexOf(b.it.group) || a.s - b.s || a.it.order - b.it.order);
  if (q) scored.sort((a, b) => a.s - b.s || ORDER.indexOf(a.it.group) - ORDER.indexOf(b.it.group) || a.it.order - b.it.order);
  current = scored.slice(0, 40).map((x) => x.it);
  selected = 0;
  list.textContent = '';
  let lastGroup = null, i = 0;
  for (const it of current) {
    if (it.group !== lastGroup) { lastGroup = it.group; const g = mk('div', 'hub-palette-group', null, null, { 'data-group': it.group }); add(g, mk('h4', null, GROUP[it.group][0], GROUP[it.group][1])); add(list, g); }
    const row = mk('div', 'hub-palette-item', null, null, { role: 'option', 'data-item': String(i), 'data-href': it.href || '', 'aria-selected': 'false', id: 'palette-item-' + i, tabindex: '-1' });
    add(row, mk('span', 'l', it.label.en, it.label.es), it.sub ? mk('span', 's', it.sub.en, it.sub.es) : null);
    const idx = i;
    row.addEventListener('click', () => go(it));
    row.addEventListener('mousemove', () => { if (selected !== idx) { selected = idx; paint(); } });
    list.lastChild.appendChild(row);
    i++;
  }
  if (current.length) empty.setAttribute('hidden', ''); else empty.removeAttribute('hidden');
  paint();
}
function paint() {
  const rows = list.querySelectorAll('[data-item]');
  rows.forEach((r, i) => { r.setAttribute('aria-selected', String(i === selected)); if (i === selected) { r.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', r.id); } });
}
function go(it) {
  close();
  if (it.action) { it.action(); return; }
  if (it.tool) armLegacyGate();                                   // wave 7 (S13): a tool target opens past the legacy portal check
  if (it.blank) window.open(it.href, '_blank', 'noopener'); else location.href = it.href;
}
async function show() {
  open = true;
  root.removeAttribute('hidden');
  input.value = '';
  remote = []; remoteFor = '';
  input.focus();
  items = await loadItems();
  if (open) render(false);
}
function close() { open = false; clearTimeout(remoteTimer); root.setAttribute('hidden', ''); if (btn) btn.focus({ preventScroll: true }); }

if (typeof document !== 'undefined' && document.body) {
  build();
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && String(ev.key).toLowerCase() === 'k') { ev.preventDefault(); if (open) close(); else show(); }
  });
  new MutationObserver(() => { if (input) input.setAttribute('placeholder', input.getAttribute(lang() === 'es' ? 'data-es-ph' : 'data-en-ph')); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
