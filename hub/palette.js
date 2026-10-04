/* ============================================================
   The command menu (wave 2, docs/vault-hub/wave2/05-markup.md §1.5, P20).
   Cmd/Ctrl+K or the header button on every Hub page. Groups, in order:
   this project's tools and actions (on a project page), projects,
   countries, tools, pages. Fuzzy match on the typed text; arrows and
   Enter; Escape closes. No model behind it: with under a few hundred
   projects a local match is faster, offline and exact.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, loadCatalog, loadGeo, openTarget, lang } from './hub.js';

const PAGES = [
  ['/hub/index.html', 'Today', 'Hoy'], ['/hub/search.html', 'Find across the Vault', 'Buscar en el Vault'], ['/hub/queue.html', 'Filing queue', 'Cola de archivo'],
  ['/hub/analogues.html', 'Analogues', 'Análogos'], ['/hub/cost.html', 'Cost and usage', 'Costes y uso'], ['/hub/settings.html', 'Settings', 'Ajustes'],
];
const GROUP = { context: ['In this project', 'En este proyecto'], projects: ['Projects', 'Proyectos'], countries: ['Countries', 'Países'], tools: ['Tools', 'Herramientas'], pages: ['Pages', 'Páginas'] };

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
let open = false, selected = 0, loaded = null;
let root, input, list, empty, btn;

function pageContext() {
  const page = document.body.getAttribute('data-page');
  const id = page === 'project' ? new URLSearchParams(location.search).get('id') : null;
  return { page, projectId: id };
}

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
        out.push({ group: 'context', label: { en: 'Open ' + t.name + ' in this project', es: 'Abrir ' + t.name + ' en este proyecto' }, href: u.href, blank: target.external });
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
    for (const t of tools) { const target = openTarget(t, byId, siteRoot); out.push({ group: 'tools', label: { en: t.name, es: t.name }, sub: { en: t.aliases.current, es: t.aliases.current }, keys: [t.id], href: target.href, blank: target.external }); }
    for (const [href, en, es] of PAGES) out.push({ group: 'pages', label: { en, es }, href });
    out.forEach((it, i) => { it.order = i; });          // insertion order wins among equal matches (toolbar order, name order)
    return out;
  })();
  return loaded;
}

function build() {
  root = mk('div', 'hub-palette', null, null, { id: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command menu', hidden: '' });
  const box = mk('div', 'hub-palette-box');
  input = mk('input', null, null, null, { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Jump to', 'data-en-ph': 'Type a project, country, tool or page…', 'data-es-ph': 'Escriba un proyecto, país, herramienta o página…', placeholder: 'Type a project, country, tool or page…' });
  list = mk('div', 'hub-palette-list', null, null, { role: 'listbox', id: 'palette-list' });
  empty = mk('p', 'hub-muted hub-palette-empty', 'Nothing matches.', 'Nada coincide.', { id: 'palette-empty', hidden: '' });
  add(box, input, list, empty, mk('p', 'hub-palette-foot', '↑↓ to move · Enter to open · Esc to close', '↑↓ para moverse · Intro para abrir · Esc para cerrar'));
  add(root, box);
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  input.addEventListener('input', () => render());
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
    btn = mk('button', 'hub-palette-btn', null, null, { type: 'button', id: 'palette-btn', 'aria-haspopup': 'dialog', title: 'Command menu (Ctrl or ⌘ K)' });
    add(btn, mk('span', null, 'Jump', 'Ir a'), dv('kbd', null, '⌘K'));
    btn.addEventListener('click', () => (open ? close() : show()));
    top.appendChild(btn);
  }
  if (lang() === 'es') input.setAttribute('placeholder', input.getAttribute('data-es-ph'));
}

let current = [];
function visible() { return current; }
function render() {
  const q = input.value.trim();
  const scored = [];
  for (const it of items) {
    if (!q && it.quiet) continue;
    let best = -1;
    for (const t of [it.label.en, it.label.es]) { const s = fuzzy(q, String(t)); if (s >= 0 && (best < 0 || s < best)) best = s; }
    for (const t of it.keys || []) { const s = fuzzy(q, String(t)); if (s >= 0) { const k = s + 1; if (best < 0 || k < best) best = k; } }   // a match on the name beats one on its keys
    if (best < 0) continue;
    scored.push({ it, s: best });
  }
  const order = ['context', 'projects', 'countries', 'tools', 'pages'];
  scored.sort((a, b) => order.indexOf(a.it.group) - order.indexOf(b.it.group) || a.s - b.s || a.it.order - b.it.order);
  if (q) scored.sort((a, b) => a.s - b.s || order.indexOf(a.it.group) - order.indexOf(b.it.group) || a.it.order - b.it.order);
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
  if (it.blank) window.open(it.href, '_blank', 'noopener'); else location.href = it.href;
}
async function show() {
  open = true;
  root.removeAttribute('hidden');
  input.value = '';
  input.focus();
  items = await loadItems();
  if (open) render();
}
function close() { open = false; root.setAttribute('hidden', ''); if (btn) btn.focus({ preventScroll: true }); }

if (typeof document !== 'undefined' && document.body) {
  build();
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && String(ev.key).toLowerCase() === 'k') { ev.preventDefault(); if (open) close(); else show(); }
  });
  new MutationObserver(() => { if (input) input.setAttribute('placeholder', input.getAttribute(lang() === 'es' ? 'data-es-ph' : 'data-en-ph')); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}
