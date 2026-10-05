/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB PROJECT PAGE (M07)
   hub/project.html?id=<project>[&run=<run id>]

   Header (client, legal tag and expiry, contacts, assets, status), then the
   tabs Timeline, Headline numbers, Lineage, Basis notes, Lessons in scope and
   Scorecard. Reads the Vault API only; nothing here writes.

     GET /api/projects/:id               the project
     GET /api/projects/:id/timeline      runs and documents, newest first, stale flags
     GET /api/projects/:id/vintages      final runs with headline outputs and deltas
     GET /api/projects/:id/lineage       nodes and edges
     GET /api/items?project=&type=note   basis notes (extracted.kind)
     GET /api/runs?project=              assumptions for scorecard rule 2
     GET /api/organisations/:id[/file]   client name, contacts, NDA expiry, dispatches
     GET /api/lessons?scope=project:<id> hidden on 404 / 501
     GET /api/projects/:id/assets        wave 3: the fields attached, with their dossiers
     GET /api/assets/locate              wave 3: candidates for a field name (Vault, GEM, GeoNames, Wikidata)
     POST/DELETE /api/projects/:id/assets  wave 3: attach (filing the dossier) and detach
     GET /api/queue/review?kind=asset    wave 3: fields named in documents, proposed for this project
     POST /api/queue/review/:id/accept|reject  wave 3: attach the proposal (with a chosen candidate or by name) or dismiss it
   Every string a person reads carries data-en and data-es.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, loadCatalog, fmtShortDate, fmtStamp, num, RUN_STATUS, STAGES, STAGE_ES, RISK_LABEL, loadGeo, openTarget, sourceWord, armOnOpen } from './hub.js';
import './components/stale-badge.js';
import { firstReason } from './components/stale-badge.js';
import { iconKind } from './components/timeline-list.js';
import { renderRecord, detailsNode } from './record.js';
import './components/timeline-list.js';
import { mountDraft } from './draft.js';
import { annotate, fmtPct } from './components/vintage-table.js';
import './components/vintage-table.js';
import './components/lineage-graph.js';
import { stateline } from './components/stateline.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const DAY = 864e5;
const params = new URLSearchParams(location.search);
const projectId = params.get('id');

const svgIcon = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
const LOCK = svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>');
const CHECK = svgIcon('<path d="M5 12l5 5 9-10"/>');
const CROSS = svgIcon('<path d="M6 6l12 12M18 6L6 18"/>');
const DASH = svgIcon('<path d="M6 12h12"/>');

const bi = (en, es) => ({ en, es: es === undefined ? en : es });
const errMessage = (res) => (res && res.body && res.body.error && res.body.error.message) || '';

/* ── notices and failure states ──────────────────────────────────────── */

function notice(kind, boldEn, boldEs, en, es) {
  const n = mk('div', 'hub-notice ' + kind);
  add(n, add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
  return n;
}

function failPage(res) {
  const st = res ? res.status : 0;
  let t, s, en, es;
  if (!projectId) { t = bi('No project selected', 'Ningún proyecto seleccionado'); en = 'Open a project from Today, or add ?id=<project> to the address.'; es = 'Abra un proyecto desde Hoy, o añada ?id=<proyecto> a la dirección.'; }
  else if (st === 404) { t = bi('Project not found', 'Proyecto no encontrado'); en = 'There is no project "' + projectId + '" in the Vault.'; es = 'No existe el proyecto "' + projectId + '" en el Vault.'; }
  else if (st === 403) { t = bi('No access to this project', 'Sin acceso a este proyecto'); en = 'You are not a member of this project or its legal tag is outside your scope.'; es = 'No es miembro de este proyecto o su etiqueta legal está fuera de su alcance.'; }
  else { t = bi('The Vault is unreachable', 'El Vault no es accesible'); en = 'The project could not be loaded' + (errMessage(res) ? ': ' + errMessage(res) : '.'); es = 'No se pudo cargar el proyecto' + (errMessage(res) ? ': ' + errMessage(res) : '.'); showVault(false); }
  setText($('#p-title'), t.en, t.es);
  const n = notice('bad', t.en + '.', t.es + '.', en, es);
  // Wave 7 (R12): a way back, never a dead end.
  const ways = mk('div', 'hub-actions-row hub-fail-ways');
  add(ways, mk('a', 'btn btn-primary btn-sm', 'Back to Today', 'Volver a Hoy', { href: '/hub/index.html' }), mk('a', 'btn btn-outline btn-sm', 'Find a project', 'Buscar un proyecto', { href: '/hub/search.html' }));
  add(n, ways);
  add($('#notices'), n);
  const sk = $('#p-skeleton'); if (sk) sk.setAttribute('hidden', '');
  document.body.setAttribute('data-ready', '1');
}

/* ── header ──────────────────────────────────────────────────────────── */

/** Wave 7 (S4, S25): the internal holding project carries records but is not an opportunity. */
const isHoldingProject = (p) => !!p && p.id === 'firm';

const STATUS_PILL = { active: ['Active', 'Activo', 'ok'], prospect: ['Prospect', 'Prospecto', 'info'], closed: ['Closed', 'Cerrado', 'muted'], archived: ['Archived', 'Archivado', 'muted'] };

/** The legal tag's expiry: from a tag object on the project if the API ever adds one, else the NDA in force on the client's file. */
export function tagExpiry(project, orgFile) {
  const t = project.legal_tag && typeof project.legal_tag === 'object' ? project.legal_tag : null;
  if (t && t.expires_at) return { date: String(t.expires_at).slice(0, 10), ref: t.contract_id || '' };
  const cs = ((orgFile && orgFile.contracts_in_force) || []).filter((c) => c && c.expiry);
  const exact = cs.filter((c) => c.legal_tag === project.default_legal_tag);
  const pool = exact.length ? exact : cs.filter((c) => c.type === 'nda');
  pool.sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  return pool.length ? { date: String(pool[0].expiry).slice(0, 10), ref: pool[0].reference_no || pool[0].title || '' } : null;
}
const daysLeft = (date, now) => Math.floor((Date.parse(date + 'T23:59:59Z') - now) / DAY);

function renderHeader(ctx) {
  const { project: p, org, orgFile, now } = ctx;
  setText($('#p-title'), p.name);
  document.title = p.name + ' — Project file — Alpha Technical Centre';
  const sub = $('#p-sub');
  sub.textContent = '';
  const clientName = (org && org.name) || p.client_id;
  add(sub, mk('span', null, 'Client', 'Cliente'), document.createTextNode(' '),
    clientName ? dv('b', null, clientName, { 'data-client': p.client_id || '' }) : mk('b', null, 'Internal (no client)', 'Interno (sin cliente)'));
  const opened = p.created_at ? fmtShortDate(p.created_at) : null;
  if (opened) add(sub, document.createTextNode(' · '), mk('span', null, 'opened', 'abierto'), document.createTextNode(' '), mk('span', null, opened.en, opened.es));
  const sp = STATUS_PILL[p.status] || [p.status, p.status, 'muted'];
  add(sub, document.createTextNode(' · '), mk('span', null, 'status', 'estado'), document.createTextNode(' '), mk('span', 'hub-pill ' + sp[2], sp[0], sp[1], { 'data-status': p.status }));
  // Wave 2: where it is; the stage now changes in place from the stateline (PATCH /api/projects/:id).
  const cn = p.country && ctx.names && ctx.names.get(p.country);
  if (p.country) add(sub, document.createTextNode(' · '), cn ? mk('b', null, cn.en, cn.es, { 'data-country': p.country }) : dv('b', null, p.country, { 'data-country': p.country }));
  // The crumb names the project (the chrome is shared; this only fills the slot when it is there).
  const crumbSlot = document.querySelector('.hub-crumb > span[data-en="Project file"]');
  if (crumbSlot) setText(crumbSlot, p.name, p.name);
  renderStateline(ctx);
  renderActions(ctx);
  const banner = $('#p-archived');
  if (banner) { if (p.status === 'archived') banner.removeAttribute('hidden'); else banner.setAttribute('hidden', ''); }

  const card = $('#p-file');
  card.textContent = '';

  // Legal tag, expiry, assets.
  const dl = mk('dl', 'hub-kv');
  const tagDd = mk('dd');
  const lt = mk('span', 'hub-lt', null, null, { 'data-legal-tag': p.default_legal_tag });
  lt.insertAdjacentHTML('afterbegin', LOCK);
  add(lt, dv('span', null, p.default_legal_tag));
  add(tagDd, lt);
  const exp = tagExpiry(p, orgFile);
  const note = mk('div', 'hub-note-s', null, null, { 'data-expiry': exp ? exp.date : '' });
  if (exp) {
    const d = daysLeft(exp.date, now);
    add(note, mk('span', null, 'expires', 'vence'), document.createTextNode(' '), dv('b', null, exp.date),
      document.createTextNode(' ('), mk('span', null, d + ' days', d + ' días'), document.createTextNode(')'));
    if (exp.ref) add(note, document.createTextNode(' · '), dv('span', null, exp.ref));
  } else if (/^lt-(firm|public)$/.test(p.default_legal_tag || '')) add(note, mk('span', null, 'no expiry (firm tag)', 'sin vencimiento (etiqueta de la firma)'));   // wave 7 (S24)
  else add(note, mk('span', null, 'no expiry recorded on the client file', 'sin vencimiento registrado en la ficha del cliente'));
  add(tagDd, note);
  add(dl, mk('dt', null, 'Legal tag', 'Etiqueta legal'), tagDd);
  const assets = mk('dd', 'chips');
  const fieldName = (id) => { const f = (ctx.fields || []).find((x) => x.id === id); return f ? f.name : id; };
  if ((p.asset_ids || []).length) for (const a of p.asset_ids) add(assets, dv('span', 'hub-asset', fieldName(a), { 'data-asset': a }));
  else add(assets, mk('span', 'hub-muted', 'None recorded', 'Ninguno registrado'));
  add(dl, mk('dt', null, 'Assets', 'Activos'), assets);
  add(dl, mk('dt', null, 'Default tag', 'Etiqueta por defecto'), mk('dd', null, 'inherited by every run and document', 'heredada por cada ejecución y documento'));
  add(card, dl);

  // Contacts. Wave 7 (S15): the same list Write to… uses (GET /api/projects/:id/contacts: the project's own contacts plus the
  // client's and each counterparty's); the organisation file is the fallback when that route is not for this caller.
  const cwrap = mk('div', 'hub-people');
  add(cwrap, mk('span', 'label', 'Contacts', 'Contactos'));
  const ids = new Set(p.contacts || []);
  const shared = Array.isArray(ctx.contactsList) ? ctx.contactsList : null;
  const contacts = shared || ((org && org.contacts) || []).filter((c) => ids.has(c.id));
  if (contacts.length) {
    for (const c of contacts) {
      const d = mk('div', null, null, null, { 'data-contact': c.id });
      add(d, dv('b', null, c.name), document.createTextNode(' '), c.role ? dv('span', 'hub-muted', '· ' + c.role) : null);
      const orgName = c.organisation && c.organisation.name ? c.organisation.name : '';
      const bits = [orgName, (c.emails || [])[0], c.language ? String(c.language).toUpperCase() : ''].filter(Boolean).join(' · ');
      if (bits) add(d, dv('div', 'hub-note-s', bits));
      add(cwrap, d);
    }
  } else if (ids.size && !shared) {
    for (const id of ids) add(cwrap, dv('span', 'hub-asset', id));
  } else add(cwrap, mk('span', 'hub-muted', 'None recorded', 'Ninguno registrado'));
  add(card, cwrap);

  // ATC team.
  const twrap = mk('div', 'hub-people');
  add(twrap, mk('span', 'label', 'ATC team', 'Equipo ATC'));
  if ((p.members || []).length) for (const m of p.members) add(twrap, dv('div', null, m, { 'data-member': m }));
  else add(twrap, mk('span', 'hub-muted', 'Open to every partner and associate with access', 'Abierto a todos los socios y asociados con acceso'));
  add(card, twrap);

  // Wave 7 (R6): the File disclosure's one-line brief: the tag, how many contacts, the fields.
  const brief = $('#p-file-brief');
  if (brief) {
    brief.textContent = '';
    add(brief, dv('span', 'hub-lt', p.default_legal_tag));
    const nc = contacts.length || ids.size;
    add(brief, mk('span', null, ' · ' + nc + (nc === 1 ? ' contact' : ' contacts'), ' · ' + nc + (nc === 1 ? ' contacto' : ' contactos')));
    const fnames = (ctx.fields || []).map((f) => f.name);
    if (fnames.length) add(brief, dv('span', null, ' · ' + fnames.join(' · ')));
    else if (!isHoldingProject(p)) add(brief, mk('span', 'hub-muted', ' · no fields yet', ' · sin campos todavía'));
  }
}

/* ── wave 7 PR2 (R1, W7-AC6): the stateline and the actions ──────────── */

/** The row the stateline component reads: the project plus the counts and the newest record from the timeline, and the NDA expiry. */
function statelineRow(ctx) {
  const { project: p, entries, orgFile } = ctx;
  const list = entries || [];
  const runs = list.filter((e) => e.kind === 'run' && e.status !== 'superseded').length;
  const docs = list.filter((e) => e.kind === 'item').length;
  const stale = list.filter((e) => e.stale).length;
  const newest = list.filter((e) => e.kind === 'run' || e.kind === 'item').slice().sort((a, b) => (a.at < b.at ? 1 : -1))[0] || null;
  const exp = tagExpiry(p, orgFile);
  return {
    ...p,
    run_count: typeof p.run_count === 'number' ? p.run_count : runs,
    item_count: typeof p.item_count === 'number' ? p.item_count : docs,
    stale_count: typeof p.stale_count === 'number' ? p.stale_count : stale,
    last_activity: newest ? { title: newest.title || newest.job || newest.id, at: newest.at, ref: newest.ref || (newest.kind === 'run' ? 'run:' : 'doc:') + newest.id } : null,
    last_activity_at: newest ? newest.at : p.last_activity_at || null,
    legal_tag_expiry: exp ? exp.date : p.legal_tag_expiry || null,
  };
}

/** Directly under the H1: the stateline in full size, its stage token the live select. Re-rendered after a stage change or a register edit. */
function renderStateline(ctx) {
  const host = $('#p-stateline');
  if (!host) return;
  host.textContent = '';
  const p = ctx.project;
  if (isHoldingProject(p)) return;              // wave 7 (S25): the holding project is not an opportunity
  const sel = mk('select', 'hub-sl-select', null, null, { id: 'p-stage', 'aria-label': 'Stage' });
  for (const st of STAGES) add(sel, mk('option', null, st, STAGE_ES[st] || st, { value: st }));
  sel.value = p.stage || 'Initial screen';
  sel.addEventListener('change', () => changeStage(ctx, sel));
  const el = stateline(statelineRow(ctx), { size: 'full', now: new Date(ctx.now || Date.now()), stageControl: sel });
  // Each token lands on the thing it names on this page: the hash drives it, so a reload or a palette jump lands the same way.
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('a.hub-sl-token');
    if (!a) return;
    const hash = (a.getAttribute('href') || '').replace(/^[^#]*/, '');
    if (!hash) return;
    ev.preventDefault();
    if (location.hash === hash) routeHash(); else location.hash = hash;
  });
  add(host, el);
}

/** The tools whose jobs appear on this project's timeline, in toolbar order first, then the rest. */
function orderedTools(ctx, cat) {
  const tools = ((cat && cat.catalog && cat.catalog.tools) || []).filter((t) => t.lifecycle === 'production' && t.hub && (t.hub.context || []).includes('project'));
  const jobs = new Set((ctx.entries || []).filter((e) => e.kind === 'run' && e.job).map((e) => e.job));
  const byToolbar = (a, b) => (a.hub.toolbar ?? 999) - (b.hub.toolbar ?? 999);
  return [...tools.filter((t) => jobs.has(t.id)).sort(byToolbar), ...tools.filter((t) => !jobs.has(t.id)).sort(byToolbar)].map((t) => ({ tool: t, produced: jobs.has(t.id) }));
}

/** A small menu under a button: opens on click, closes on Escape, outside click or a choice; focus returns to the button. */
function attachMenu(btn, menu) {
  const close = (refocus) => { if (menu.hasAttribute('hidden')) return; menu.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); if (refocus) btn.focus(); };
  const open = () => { menu.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); const first = menu.querySelector('a, button'); if (first) first.focus(); };
  btn.addEventListener('click', () => (menu.hasAttribute('hidden') ? open() : close(true)));
  menu.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } });
  document.addEventListener('click', (ev) => { if (!menu.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) close(false); });
  menu.addEventListener('click', (ev) => { if (ev.target.closest('a, button')) close(false); });
  return { open, close };
}

/**
 * Right of the H1: Write to… (primary; mounted by draft.js), Research (renderResearch), "Open in tool ▾" with the tools that
 * produced this project's runs first, and a "…" overflow holding Archive behind a confirm sheet. Restore stays a plain action.
 */
function renderActions(ctx) {
  const host = $('#p-toolbar');
  if (!host) return;
  for (const old of host.querySelectorAll('[data-actions-built]')) old.remove();
  const p = ctx.project, cat = ctx.catalog;
  const siteRoot = new URL('../', location.href);
  // Open in tool ▾
  const wrap = mk('span', 'hub-menu-wrap', null, null, { 'data-actions-built': '' });
  const btn = mk('button', 'btn btn-outline btn-sm hub-openin', null, null, { type: 'button', id: 'p-openin', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'p-openin-menu' });
  add(btn, mk('span', null, 'Open in tool', 'Abrir en herramienta'), mk('span', 'hub-caret', '▾', '▾', { 'aria-hidden': 'true' }));
  const menu = mk('div', 'hub-menu', null, null, { id: 'p-openin-menu', role: 'menu', hidden: '' });
  if (!cat || !cat.catalog) add(menu, mk('span', 'hub-muted hub-menu-note', 'The tool catalog is not available.', 'El catálogo de herramientas no está disponible.'));
  else {
    const byId = new Map(((cat.catalog && cat.catalog.tools) || []).map((t) => [t.id, t]));
    const list = orderedTools(ctx, cat);
    let external = 0;
    for (const { tool: t, produced } of list) {
      const target = openTarget(t, byId, siteRoot);
      const u = new URL(target.href);
      // Wave 7 (S28): only a browser tool reads ?project=; an external app opens as itself.
      if (!target.external) u.searchParams.set(t.hub.param || 'project', p.id); else external++;
      const a = mk('a', 'hub-menu-item', null, null, { href: u.href, role: 'menuitem', 'data-toolbar-tool': t.id, 'data-external': target.external ? '1' : '0', 'data-produced': produced ? '1' : '0' });
      a.insertAdjacentHTML('afterbegin', svgIcon('<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/>'));
      add(a, dv('span', null, t.name));
      if (produced) add(a, mk('span', 'hub-menu-hint', 'has runs here', 'con ejecuciones aquí'));
      if (target.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); add(a, mk('span', 'hub-menu-hint', 'opens as itself', 'se abre por sí misma')); }
      add(menu, armOnOpen(a));                                  // wave 7 (S13): the legacy portal check is satisfied before the tool opens
    }
    if (!list.length) add(menu, mk('span', 'hub-muted hub-menu-note', 'No tool declares a project context yet.', 'Ninguna herramienta declara aún un contexto de proyecto.'));
    else add(menu, mk('span', 'hub-muted hub-menu-note', external ? 'Browser tools open in this project; the external apps open as themselves.' : 'Each opens in this project.', external ? 'Las herramientas del navegador se abren en este proyecto; las apps externas se abren por sí mismas.' : 'Cada una se abre en este proyecto.'));
  }
  add(wrap, btn, menu);
  attachMenu(btn, menu);
  add(host, wrap);
  // … overflow (partners): Archive behind a confirm sheet; Restore stays a plain action.
  if (ctx.person && ctx.person.role === 'partner' && !isHoldingProject(p)) {
    if (p.status === 'archived') {
      const restore = mk('button', 'btn btn-outline btn-sm hub-archive-btn', 'Restore project', 'Restaurar proyecto', { type: 'button', id: 'p-archive', 'data-archived': '1', 'data-actions-built': '' });
      restore.addEventListener('click', () => archiveProject(ctx, restore));
      add(host, restore);
    } else {
      const mwrap = mk('span', 'hub-menu-wrap', null, null, { 'data-actions-built': '' });
      const more = mk('button', 'btn btn-outline btn-sm hub-more', '…', '…', { type: 'button', id: 'p-more', 'aria-label': 'More actions', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'p-more-menu' });
      const mmenu = mk('div', 'hub-menu', null, null, { id: 'p-more-menu', role: 'menu', hidden: '' });
      const archive = mk('button', 'hub-menu-item', 'Archive project', 'Archivar proyecto', { type: 'button', role: 'menuitem', id: 'p-archive', 'data-archived': '0' });
      archive.addEventListener('click', () => archiveProject(ctx, archive));
      add(mmenu, archive);
      add(mwrap, more, mmenu);
      attachMenu(more, mmenu);
      add(host, mwrap);
    }
  }
  host.removeAttribute('hidden');
}

/* ── wave 2: stage, toolbar, opportunity card ────────────────────────── */

const pnotices = () => $('#p-notices');
const stageEntries = (p) => {
  const hist = Array.isArray(p.stage_history) ? p.stage_history : [];
  return hist.map((h, i) => ({ kind: 'stage', id: 'stage-' + i, ref: 'stage:' + i, at: h.at, title: h.stage, from: i ? hist[i - 1].stage : null, by: h.by, stale: false }));
};
function refreshTimeline(ctx) {
  const tl = $('#tl');
  if (tl && ctx.entries) tl.entries = [...ctx.entries, ...stageEntries(ctx.project)];
}

/** A bottom sheet (Add documents, the archive confirm): shown over a scrim, closed by its Close, the scrim or Escape; focus returns to the opener. */
function openSheet(sheet, scrim, opener, onClose) {
  if (!sheet) return;
  sheet.removeAttribute('hidden'); if (scrim) scrim.removeAttribute('hidden');
  document.body.classList.add('has-sheet');
  if (opener) opener.setAttribute('aria-expanded', 'true');
  const close = () => {
    sheet.setAttribute('hidden', ''); if (scrim) scrim.setAttribute('hidden', '');
    document.body.classList.remove('has-sheet');
    if (opener) { opener.setAttribute('aria-expanded', 'false'); if (opener.isConnected) opener.focus(); }
    document.removeEventListener('keydown', onKey, true);
    if (scrim) scrim.removeEventListener('click', close);
    if (onClose) onClose();
  };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  if (scrim) scrim.addEventListener('click', close);
  const first = sheet.querySelector('input:not([type="file"]), button, [href]');
  if (first) first.focus();
  return close;
}

/** Archive hides the project from Today, the globe, the register and Cmd+K; its records stay and the file still opens by id. Restore puts it back.
 *  Wave 7 (R1): Archive asks in a confirm sheet (#p-archive-sheet); Restore is one tap. */
async function archiveProject(ctx, btn) {
  const p = ctx.project;
  const notices = pnotices(); notices.textContent = '';
  const archiving = p.status !== 'archived';
  if (archiving && !btn.hasAttribute('data-confirmed')) {
    const sheet = $('#p-archive-sheet'), yes = $('#p-archive-confirm'), no = $('#p-archive-cancel');
    if (!sheet || !yes) return;
    const close = openSheet(sheet, $('#archive-scrim'), btn);
    const onYes = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); close(); btn.setAttribute('data-confirmed', '1'); archiveProject(ctx, btn); };
    const onNo = () => { yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo); close(); };
    yes.addEventListener('click', onYes); no.addEventListener('click', onNo);
    yes.focus();
    return;
  }
  btn.removeAttribute('data-confirmed');
  btn.disabled = true;
  // Wave 7 (S14): the Vault noted the status at archive time; Restore puts it back (an old archive without the note falls back as before).
  const before = p.register && typeof p.register.status_before_archive === 'string' ? p.register.status_before_archive : null;
  const next = archiving ? 'archived' : (before && before !== 'archived' ? before : (p.closed_at ? 'closed' : 'prospect'));
  const res = await api('/api/projects/' + encodeURIComponent(p.id), { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ status: next }) });
  btn.disabled = false;
  if (res.ok && res.body) {
    Object.assign(p, res.body);
    renderHeader(ctx);
    add(notices, archiving ? notice('ok', 'Archived.', 'Archivado.', 'Hidden from Today, the globe and the register; nothing was deleted.', 'Oculto de Hoy, del globo y del registro; no se borró nada.') : notice('ok', 'Restored.', 'Restaurado.', 'Back on Today, the globe and the register.', 'De vuelta en Hoy, el globo y el registro.'));
    return;
  }
  const msg = errMessage(res);
  add(notices, notice('bad', archiving ? 'Not archived.' : 'Not restored.', archiving ? 'No se archivó.' : 'No se restauró.', msg || (res.status ? 'HTTP ' + res.status : 'The Vault is unreachable.'), msg || (res.status ? 'HTTP ' + res.status : 'El Vault no es accesible.')));
}

async function changeStage(ctx, sel) {
  const p = ctx.project, was = p.stage;
  const notices = pnotices(); notices.textContent = '';
  sel.disabled = true;
  const res = await api('/api/projects/' + encodeURIComponent(p.id), { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify({ stage: sel.value }) });
  sel.disabled = false;
  if (res.ok && res.body) {
    Object.assign(p, res.body);
    sel.value = p.stage;
    add(notices, notice('ok', 'Stage is now ' + p.stage + '.', 'La etapa ahora es ' + (STAGE_ES[p.stage] || p.stage) + '.', 'Recorded on the timeline.', 'Registrado en la cronología.'));
    refreshTimeline(ctx);
    renderStateline(ctx);                                     // wave 7 (R1): the stateline states the new stage and since when
  } else {
    sel.value = was;
    const msg = errMessage(res);
    if (res.status === 0) add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The stage was not changed.', 'No se cambió la etapa.'));
    else add(notices, notice('bad', 'The stage was not changed.', 'No se cambió la etapa.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
  }
}

/** Wave 4: licence types on the register, bilingual (value, English, Spanish). */
const LICENCE_OPTS = [
  ['concession', 'Concession', 'Concesión'],
  ['psc', 'Production sharing', 'Producción compartida'],
  ['service', 'Service contract', 'Contrato de servicios'],
  ['jv', 'Joint venture / empresa mixta', 'Empresa mixta'],
  ['licence', 'Licence', 'Licencia'],
  ['other', 'Other', 'Otro'],
];
const LICENCE_LABEL = Object.fromEntries(LICENCE_OPTS.map(([v, en, es]) => [v, [en, es]]));
const RISK_OPTS = [['', 'Not assessed', 'Sin evaluar'], ['green', 'Managed', 'Gestionado'], ['amber', 'Elevated', 'Elevado'], ['red', 'High', 'Alto']];
const numOrNull = (el) => (el && el.value.trim() !== '' ? Number(el.value) : null);

/** The opportunity card: the register fields and where it is, editable in place. */
function renderOpportunity(ctx) {
  const host = $('#p-opportunity');
  host.textContent = '';
  const p = ctx.project, reg = p.register || {};
  const head = mk('div', 'hub-card-head');
  add(head, add(mk('div'), mk('h3', null, 'Opportunity', 'Oportunidad', { id: 'h-opp' }), mk('span', 'hub-muted', 'The register fields: who brought it, what it produces, what Alpha thinks and what comes next.', 'Los campos del registro: quién la trajo, qué produce, qué piensa Alpha y qué sigue.')));
  const edit = mk('button', 'btn btn-outline btn-sm', 'Edit', 'Editar', { type: 'button', 'aria-expanded': 'false' });
  add(head, edit);
  add(host, head);
  const grid = mk('div', 'hub-opp-grid');
  const field = (key, en, es, node, cls) => add(grid, add(mk('div', cls || ''), mk('span', 'k', en, es), add(mk('span', 'v' + (cls === 'big' ? ' big' : ''), null, null, { 'data-opp': key }), node)));
  const cn = p.country && ctx.names && ctx.names.get(p.country);
  const where = p.country ? (cn ? cn.en : p.country) + (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? ' · ' + p.lat + ', ' + p.lon : '') : null;
  const whereEs = p.country ? (cn ? cn.es : p.country) + (Number.isFinite(p.lat) && Number.isFinite(p.lon) ? ' · ' + p.lat + ', ' + p.lon : '') : null;
  field('where', 'Where', 'Dónde', where ? mk('span', null, where, whereEs) : mk('span', 'hub-muted', 'not placed yet', 'sin ubicar todavía'));
  field('source', 'Source', 'Origen', reg.source ? dv('span', null, reg.source) : mk('span', 'hub-muted', '—', '—'));
  const hasProd = typeof reg.current === 'number' || typeof reg.plan === 'number';
  field('plan', 'Fact → plan', 'Hecho → plan', hasProd ? dv('span', null, (reg.current ?? '—') + ' → ' + (reg.plan ?? '—') + ' kboe/d') : mk('span', 'hub-muted', '—', '—'), 'big');
  const risk = mk('span');
  if (reg.risk) { const rl = RISK_LABEL[reg.risk] || [reg.risk, reg.risk]; add(risk, mk('span', 'hub-rag', null, null, { 'data-risk': reg.risk, 'aria-hidden': 'true' }), mk('span', null, rl[0] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''), rl[1] + (typeof reg.risk_score === 'number' ? ' ' + reg.risk_score : ''))); }
  else add(risk, mk('span', 'hub-muted', 'not assessed', 'sin evaluar'));
  field('risk', 'Execution risk', 'Riesgo de ejecución', risk);
  // Wave 4: the counterparties, so research has names to look up; the firm's lead is labelled as such.
  const partners = Array.isArray(reg.partners) ? reg.partners.filter(Boolean) : [];
  field('holder', 'Current owner', 'Titular actual', reg.holder ? dv('span', null, reg.holder) : mk('span', 'hub-muted', '—', '—'));
  field('government', 'Government', 'Gobierno', reg.government ? dv('span', null, reg.government) : mk('span', 'hub-muted', '—', '—'));
  const lic = LICENCE_LABEL[reg.licence_type];
  const licNode = lic ? add(mk('span'), mk('span', null, lic[0], lic[1]), ...(reg.licence_note ? [dv('span', null, ' · ' + reg.licence_note)] : [])) : reg.licence_note ? dv('span', null, reg.licence_note) : mk('span', 'hub-muted', '—', '—');
  field('licence', 'Licence type', 'Tipo de licencia', licNode);
  field('partners', 'JV partners', 'Socios', partners.length ? dv('span', null, partners.join(', ')) : mk('span', 'hub-muted', '—', '—'));
  field('owner', 'Lead at the firm', 'Responsable en la firma', reg.owner ? dv('span', null, reg.owner) : mk('span', 'hub-muted', '—', '—'));
  field('thesis', 'Thesis', 'Tesis', reg.thesis ? dv('span', null, reg.thesis) : mk('span', 'hub-muted', 'none yet', 'ninguna todavía'), 'hub-opp-text');
  field('next', 'Next step', 'Siguiente paso', reg.next ? dv('span', null, reg.next) : mk('span', 'hub-muted', 'none yet', 'ninguno todavía'), 'hub-opp-text');
  add(host, grid);

  // The edit form, hidden until asked for; posts country, coordinates and the merged register.
  const form = mk('form', null, null, null, { novalidate: '', hidden: '' });
  const fg = mk('div', 'hub-form-grid');
  const fld = (id, en, es, input) => add(fg, add(mk('div', 'hub-field'), mk('label', null, en, es, { for: id }), input));
  const country = mk('select', null, null, null, { id: 'op-country' });
  add(country, mk('option', null, 'Not placed yet', 'Sin ubicar todavía', { value: '' }));
  if (ctx.names) for (const [code, n] of [...ctx.names.entries()].sort((a, b) => a[1].en.localeCompare(b[1].en))) add(country, mk('option', null, n.en, n.es, { value: code }));
  country.value = p.country || '';
  fld('op-country', 'Country', 'País', country);
  const inp = (id, type, value, extra) => mk('input', null, null, null, { id, type, autocomplete: 'off', value: value == null ? '' : String(value), ...(extra || {}) });
  fld('op-lat', 'Latitude', 'Latitud', inp('op-lat', 'number', p.lat, { min: '-90', max: '90', step: '0.01', inputmode: 'decimal' }));
  fld('op-lon', 'Longitude', 'Longitud', inp('op-lon', 'number', p.lon, { min: '-180', max: '180', step: '0.01', inputmode: 'decimal' }));
  fld('op-source', 'Source', 'Origen', inp('op-source', 'text', reg.source));
  fld('op-holder', 'Current owner', 'Titular actual', inp('op-holder', 'text', reg.holder));
  fld('op-government', 'Government', 'Gobierno', inp('op-government', 'text', reg.government));
  const licSel = mk('select', null, null, null, { id: 'op-licence' });
  add(licSel, mk('option', null, '—', '—', { value: '' }));
  for (const [v, en, es] of LICENCE_OPTS) add(licSel, mk('option', null, en, es, { value: v }));
  licSel.value = reg.licence_type || '';
  fld('op-licence', 'Licence type', 'Tipo de licencia', licSel);
  fld('op-licence-note', 'Licence note', 'Nota de la licencia', inp('op-licence-note', 'text', reg.licence_note));
  fld('op-partners', 'JV partners, comma separated', 'Socios, separados por comas', inp('op-partners', 'text', partners.join(', ')));
  fld('op-owner', 'Lead at the firm', 'Responsable en la firma', inp('op-owner', 'text', reg.owner));
  fld('op-current', 'Fact today, kboe/d', 'Hecho hoy, kboe/d', inp('op-current', 'number', reg.current, { min: '0', step: '0.1', inputmode: 'decimal' }));
  fld('op-plan', "Operator's plan, kboe/d", 'Plan del operador, kboe/d', inp('op-plan', 'number', reg.plan, { min: '0', step: '0.1', inputmode: 'decimal' }));
  const riskSel = mk('select', null, null, null, { id: 'op-risk' });
  for (const [v, en, es] of RISK_OPTS) add(riskSel, mk('option', null, en, es, { value: v }));
  riskSel.value = reg.risk || '';
  fld('op-risk', 'Execution risk', 'Riesgo de ejecución', riskSel);
  fld('op-risk-score', 'Risk score (0–100)', 'Puntuación de riesgo (0–100)', inp('op-risk-score', 'number', reg.risk_score, { min: '0', max: '100', step: '1' }));
  const thesis = mk('textarea', null, null, null, { id: 'op-thesis' }); thesis.value = reg.thesis || '';
  const next = mk('textarea', null, null, null, { id: 'op-next' }); next.value = reg.next || '';
  const wide = (id, en, es, ta) => add(fg, add(mk('div', 'hub-field hub-opp-text'), mk('label', null, en, es, { for: id }), ta));
  wide('op-thesis', 'Thesis', 'Tesis', thesis);
  wide('op-next', 'Next step', 'Siguiente paso', next);
  add(form, fg);
  const fn = mk('div', null, null, null, { id: 'op-notices', role: 'status' });
  const actions = mk('div', 'hub-actions');
  const save = mk('button', 'btn btn-primary btn-sm', 'Save', 'Guardar', { type: 'submit' });
  const cancel = mk('button', 'btn btn-outline btn-sm', 'Cancel', 'Cancelar', { type: 'button' });
  add(actions, save, cancel);
  add(form, fn, actions);
  add(host, form);
  const close = () => { form.setAttribute('hidden', ''); edit.setAttribute('aria-expanded', 'false'); edit.focus(); };
  const openEditor = (focusId) => { form.removeAttribute('hidden'); edit.setAttribute('aria-expanded', 'true'); const f = focusId ? $('#' + focusId) : null; (f || country).focus(); if (f) f.scrollIntoView({ block: 'center' }); };
  edit.addEventListener('click', () => { if (form.hasAttribute('hidden')) openEditor(); else close(); });
  cancel.addEventListener('click', close);
  // Wave 7 (R1): the stateline's Next token opens this editor on the Next step field.
  ctx.openRegisterEditor = (focusId) => { openFileDisclosure(); openEditor(focusId); };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    fn.textContent = '';
    const register = { ...reg };
    // A blank box is sent as null so the Vault clears the key (the register merges field by field).
    const setOrDrop = (k, v) => { register[k] = v === null || v === '' || v === undefined ? null : v; };
    setOrDrop('source', $('#op-source').value.trim());
    setOrDrop('owner', $('#op-owner').value.trim());
    setOrDrop('holder', $('#op-holder').value.trim());
    setOrDrop('government', $('#op-government').value.trim());
    setOrDrop('licence_type', licSel.value);
    setOrDrop('licence_note', $('#op-licence-note').value.trim());
    const pl = $('#op-partners').value.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
    setOrDrop('partners', pl.length ? pl : null);
    setOrDrop('current', numOrNull($('#op-current')));
    setOrDrop('plan', numOrNull($('#op-plan')));
    setOrDrop('risk', riskSel.value);
    setOrDrop('risk_score', numOrNull($('#op-risk-score')));
    setOrDrop('thesis', thesis.value.trim());
    setOrDrop('next', next.value.trim());
    const body = { country: country.value || null, lat: numOrNull($('#op-lat')), lon: numOrNull($('#op-lon')), register };
    save.disabled = true;
    const res = await api('/api/projects/' + encodeURIComponent(p.id), { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    save.disabled = false;
    if (res.ok && res.body) {
      // The API answers with the merged register; a cleared field stays until a reload, so keep the client's view authoritative for what it just sent.
      Object.assign(p, res.body, { register });
      renderHeader(ctx); renderOpportunity(ctx);              // the stateline's Next token follows the register
      return;
    }
    const msg = errMessage(res);
    add(fn, notice('bad', 'Not saved.', 'No se guardó.', msg || (res.status ? 'HTTP ' + res.status : 'The Vault is unreachable.'), msg || (res.status ? 'HTTP ' + res.status : 'El Vault no es accesible.')));
  });
}

/* ── wave 3: the Fields card ─────────────────────────────────────────── */

const KIND_WORD = { field: ['field', 'campo'], block: ['block', 'bloque'], basin: ['basin', 'cuenca'], well: ['well', 'pozo'] };
const kindWord = (k) => { const w = KIND_WORD[k] || [k, k]; return mk('span', 'hub-kind', w[0], w[1], { 'data-kind': k }); };
const coordText = (o) => (Number.isFinite(o.lat) && Number.isFinite(o.lon) ? o.lat + ', ' + o.lon : null);
const srcPill = (src) => { const w = sourceWord(src); return mk('span', 'hub-pill ghost hub-src', w.en, w.es, { 'data-source': src || '' }); };

/** What a field row says after its name: kind, basin, coordinates, source and release, status and operator. */
function fieldFacts(f, names) {
  const facts = mk('div', 'hub-note-s');
  add(facts, kindWord(f.kind));
  const chk = f.location_check;
  if (chk && chk.outside) { const on = (names && names.get(chk.found)) || { en: chk.found, es: chk.found }, ex = (names && names.get(chk.expected)) || { en: chk.expected, es: chk.expected }; add(facts, document.createTextNode(' · '), mk('span', 'hub-outside', 'outside ' + ex.en + ': this location is in ' + on.en, 'fuera de ' + ex.es + ': esta ubicación está en ' + on.es, { 'data-outside': chk.found })); }
  const gem = f.props && f.props.gem;
  const c = coordText(f);
  if (c) add(facts, document.createTextNode(' · '), dv('span', 'mono', c, { 'data-coords': c }));
  else add(facts, document.createTextNode(' · '), mk('span', null, 'no location yet', 'sin ubicación todavía'));
  add(facts, document.createTextNode(' · '), srcPill(f.location_source));
  if (gem && gem.release) add(facts, dv('span', 'hub-muted', ' ' + gem.release));
  const bits = [];
  if (f.status) bits.push(f.status);
  if (f.operator) bits.push(f.operator);
  if (bits.length) add(facts, document.createTextNode(' · '), dv('span', null, bits.join(', ')));
  return facts;
}

/** A candidate from GET /api/assets/locate as a row with an Attach button. */
function candidateRow(ctx, c, onAttach) {
  const li = mk('li', 'hub-candidate', null, null, { 'data-candidate': c.source + ':' + c.source_id });
  const main = mk('div');
  add(main, dv('b', null, c.name), document.createTextNode(' '), kindWord(c.kind));
  if (c.country) add(main, document.createTextNode(' · '), dv('span', null, c.country));
  const meta = mk('div', 'hub-note-s');
  const cc = coordText(c);
  if (cc) add(meta, dv('span', 'mono', cc)); else add(meta, mk('span', null, 'no coordinates on this record', 'sin coordenadas en este registro'));
  add(meta, document.createTextNode(' · '), srcPill(c.source));
  if (c.country && ctx.project.country && c.country !== ctx.project.country) { const on = (ctx.names && ctx.names.get(c.country)) || { en: c.country, es: c.country }; add(meta, document.createTextNode(' · '), mk('span', 'hub-outside', 'in ' + on.en + ', not this project\'s country', 'en ' + on.es + ', no el país de este proyecto', { 'data-outside': c.country })); }
  if (c.asset_id) add(meta, document.createTextNode(' · '), mk('span', null, 'already in the Vault', 'ya en el Vault'));
  if (c.detail && c.detail.operator) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.operator));
  if (c.detail && c.detail.status) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.status));
  if (c.source_url) add(meta, document.createTextNode(' · '), dv('a', 'hub-inline-link', 'record', { href: c.source_url, target: '_blank', rel: 'noopener noreferrer' }));
  add(main, meta);
  const btn = mk('button', 'btn btn-primary btn-sm', 'Attach', 'Adjuntar', { type: 'button', 'data-attach': c.source + ':' + c.source_id });
  btn.addEventListener('click', () => onAttach(c, btn));
  add(li, main, btn);
  return li;
}

/** The body posted to attach a candidate: the existing asset by id, or a new one carrying its source. */
export function attachBody(c, projectCountry) {
  if (c.asset_id) return { asset_id: c.asset_id };
  const create = { name: c.name, kind: c.kind || 'field' };
  if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) { create.lat = c.lat; create.lon = c.lon; create.location_source = c.source; }
  if (c.source_id) create.source_id = c.source_id;
  if (c.source_url) create.source_url = c.source_url;
  if (c.detail) create.detail = c.detail;
  if (c.country || projectCountry) create.country = c.country || projectCountry;
  return create.name ? { create } : null;
}

/**
 * The Fields card: the fields attached to the project with their source and coordinates,
 * a dossier button per gazetteer record, detach, and Add field (search → candidates → attach).
 * Writes go to POST/DELETE /api/projects/:id/assets; a refusal is shown in the card.
 */
async function renderFields(ctx) {
  const host = $('#p-fields');
  if (!host) return;
  const p = ctx.project;
  host.textContent = '';
  const head = mk('div', 'hub-card-head');
  add(head, add(mk('div'), mk('h3', null, 'Fields', 'Campos', { id: 'h-fields' }),
    mk('span', 'hub-muted', 'The fields, blocks and basins this project is about, each located from a named source. Attaching one files its public dossier into the project.', 'Los campos, bloques y cuencas de este proyecto, cada uno ubicado desde una fuente nombrada. Adjuntar uno archiva su dosier público en el proyecto.')));
  const addBtn = mk('button', 'btn btn-outline btn-sm', 'Add field', 'Añadir campo', { type: 'button', id: 'fld-add-btn', 'aria-expanded': 'false', 'aria-controls': 'fld-add' });
  add(head, addBtn);
  add(host, head);
  const notices = mk('div', null, null, null, { id: 'fld-notices', role: 'status' });
  add(host, notices);
  const list = mk('ul', 'hub-fields-list', null, null, { id: 'fld-list' });
  add(host, list);

  const res = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets');
  ctx.fields = res.ok ? listOf(res.body, 'assets') : [];
  if (!res.ok) add(notices, notice('warn', 'The fields could not be loaded.', 'No se pudieron cargar los campos.', res.status ? 'HTTP ' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') : 'The Vault is unreachable.', res.status ? 'HTTP ' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') : 'El Vault no es accesible.'));

  const paint = () => {
    list.textContent = '';
    if (!ctx.fields.length) { add(list, mk('li', 'hub-empty', 'No fields attached yet. Add field searches the Vault, Global Energy Monitor, GeoNames and Wikidata.', 'Aún no hay campos adjuntos. Añadir campo busca en el Vault, Global Energy Monitor, GeoNames y Wikidata.')); return; }
    for (const f of ctx.fields) {
      const li = mk('li', 'hub-field-row' + (f.location_check && f.location_check.outside ? ' outside' : ''), null, null, { 'data-field': f.id });
      const main = mk('div');
      add(main, mk('span', 'dot', null, null, { 'aria-hidden': 'true' }), dv('b', null, f.name), fieldFacts(f, ctx.names));
      const actions = mk('div', 'hub-actions-row');
      const dossier = Array.isArray(f.dossier) ? f.dossier : [];
      if (dossier.length) {
        const b = mk('button', 'btn btn-outline btn-sm', dossier.length === 1 ? 'Dossier' : 'Dossier (' + dossier.length + ')', dossier.length === 1 ? 'Dosier' : 'Dosier (' + dossier.length + ')', { type: 'button', 'data-dossier': f.id });
        b.addEventListener('click', () => openRecord({ ref: 'doc:' + dossier[0], title: 'Field dossier: ' + f.name, trigger: b }));
        add(actions, b);
      } else add(actions, mk('span', 'hub-muted', 'no dossier', 'sin dosier'));
      const det = mk('button', 'btn btn-outline btn-sm', 'Detach', 'Desvincular', { type: 'button', 'data-detach': f.id });
      det.addEventListener('click', async () => {
        notices.textContent = ''; det.disabled = true;
        const r = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets/' + encodeURIComponent(f.id), { method: 'DELETE', headers: { accept: 'application/json' } });
        det.disabled = false;
        if (r.ok) {
          ctx.fields = ctx.fields.filter((x) => x.id !== f.id);
          p.asset_ids = (p.asset_ids || []).filter((x) => x !== f.id);
          add(notices, notice('ok', f.name + ' detached.', f.name + ' desvinculado.', 'Its dossier records stay in the project.', 'Sus registros de dosier permanecen en el proyecto.'));
          paint(); renderHeader(ctx);
        } else add(notices, notice('bad', 'Not detached.', 'No se desvinculó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
      });
      add(actions, det);
      add(li, main, actions);
      add(list, li);
    }
  };
  paint();

  /** The Vault refused because the record sits in another country: say where, and offer to attach anyway. */
  const askOutsideImpl = (r, resend) => {
    const chk = (r.body && r.body.error && r.body.error.location_check) || {};
    const on = (ctx.names && ctx.names.get(chk.found)) || { en: chk.found || '?', es: chk.found || '?' }, ex = (ctx.names && ctx.names.get(chk.expected)) || { en: chk.expected || p.country, es: chk.expected || p.country };
    const n = notice('warn', 'This location is in ' + on.en + ', not ' + ex.en + '.', 'Esta ubicación está en ' + on.es + ', no en ' + ex.es + '.', 'The field was not attached. If the project really spans it, attach it anyway; otherwise pick another candidate or attach by name without a location.', 'El campo no se adjuntó. Si el proyecto realmente lo abarca, adjúntelo igualmente; si no, elija otro candidato o adjunte por nombre sin ubicación.');
    n.setAttribute('data-outside-ask', chk.found || '');
    const row = mk('div', 'hub-actions-row');
    const yes = mk('button', 'btn btn-outline btn-sm', 'Attach anyway', 'Adjuntar igualmente', { type: 'button', 'data-attach-anyway': '' });
    yes.addEventListener('click', () => { n.remove(); resend(); });
    const noBtn = mk('button', 'btn btn-outline btn-sm', 'Cancel', 'Cancelar', { type: 'button' });
    noBtn.addEventListener('click', () => n.remove());
    add(row, yes, noBtn); add(n, row); add(notices, n);
  };
  const askOutside = (r, resend) => askOutsideImpl(r, resend);

  // Proposed from documents: the fields that ingest found named in this project's documents (review queue, kind asset).
  const proposed = mk('div', 'hub-proposed', null, null, { id: 'fld-proposed', hidden: '' });
  add(host, proposed);
  const paintProposals = async () => {
    // Wave 3: fields named in documents (kind asset). Wave 4: the same for research findings, plus the
    // operator, licence and production facts a finding states (kind research), each decided here.
    const [ra, rr] = await Promise.all([api('/api/queue/review?kind=asset'), api('/api/queue/review?kind=research')]);
    const mine = (r, kind) => (r.ok ? listOf(r.body, 'items').filter((q) => q && q.kind === kind && q.status !== 'accepted' && q.status !== 'rejected' && q.payload && q.payload.project_id === p.id) : []);
    const rows = mine(ra, 'asset'), facts = mine(rr, 'research');
    proposed.textContent = '';
    if (!rows.length && !facts.length) { proposed.setAttribute('hidden', ''); return; }
    proposed.removeAttribute('hidden');
    if (rows.length) {
      add(proposed, mk('span', 'label', 'Proposed from documents and research', 'Propuestos desde documentos e investigación'),
        mk('span', 'hub-muted', ' · ' + rows.length + (rows.length === 1 ? ' field named in documents, waiting for a decision' : ' fields named in documents, waiting for a decision'), ' · ' + rows.length + (rows.length === 1 ? ' campo nombrado en documentos, a la espera de una decisión' : ' campos nombrados en documentos, a la espera de una decisión')));
      const ul = mk('ul', 'hub-proposals');
      for (const q of rows) add(ul, proposalRow(q));
      add(proposed, ul);
    }
    if (facts.length) {
      const wrap = mk('div', 'hub-facts', null, null, { id: 'fld-facts' });
      add(wrap, mk('span', 'label', 'Facts proposed from research', 'Hechos propuestos desde la investigación'),
        mk('span', 'hub-muted', ' · ' + facts.length + (facts.length === 1 ? ' fact with a verbatim quote, waiting for a decision' : ' facts with verbatim quotes, waiting for a decision'), ' · ' + facts.length + (facts.length === 1 ? ' hecho con cita textual, a la espera de una decisión' : ' hechos con citas textuales, a la espera de una decisión')));
      const ul = mk('ul', 'hub-proposals');
      for (const q of facts) add(ul, factRow(q));
      add(wrap, ul);
      add(proposed, wrap);
    }
  };
  ctx.repaintProposals = paintProposals;
  /** Wave 4: an operator, licence or production figure from a research finding. Accept records it (operator on the field, production on the register); Not a fact closes it. */
  const factRow = (q) => {
    const pl = q.payload || {};
    const li = mk('li', 'hub-proposal hub-fact', null, null, { 'data-proposal': q.id, 'data-fact-kind': pl.fact_kind || '' });
    const head = mk('div', 'hub-proposal-head');
    add(head, dv('b', null, pl.proposal || pl.value));
    if (pl.fact_kind === 'location' && pl.candidate) { add(head, document.createTextNode(' '), srcPill(pl.candidate.source)); if (Number.isFinite(pl.candidate.lat)) add(head, document.createTextNode(' '), dv('span', 'mono', pl.candidate.lat + ', ' + pl.candidate.lon, { 'data-coords': '' })); }
    else if (pl.asset_name) add(head, document.createTextNode(' · '), mk('span', 'hub-muted', 'about ' + pl.asset_name, 'sobre ' + pl.asset_name));
    const quote = pl.quote ? dv('blockquote', 'hub-proposal-quote', '“' + pl.quote + '”' + (pl.item_title ? ' (' + pl.item_title + ')' : ''), { 'data-quote': '' }) : null;
    if (quote) add(head, quote);
    add(li, head);
    const actions = mk('div', 'hub-actions-row');
    const yesEn = pl.fact_kind === 'operator' ? 'Set as operator' : pl.fact_kind === 'location' ? 'Set location' : 'File as fact', yesEs = pl.fact_kind === 'operator' ? 'Fijar como operador' : pl.fact_kind === 'location' ? 'Fijar ubicación' : 'Archivar como hecho';
    const yes = mk('button', 'btn btn-primary btn-sm', yesEn, yesEs, { type: 'button', 'data-accept-fact': '' });
    const no = mk('button', 'btn btn-outline btn-sm', pl.fact_kind === 'location' ? 'Not it' : 'Not a fact', pl.fact_kind === 'location' ? 'No es ese' : 'No es un hecho', { type: 'button', 'data-reject': '' });
    const decideFact = async (verb) => {
      notices.textContent = ''; yes.disabled = no.disabled = true;
      const r = await api('/api/queue/review/' + encodeURIComponent(q.id) + '/' + verb, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(verb === 'accept' ? { apply: true } : {}) });
      yes.disabled = no.disabled = false;
      if (!r.ok) {
        if (r.status === 409) { li.remove(); add(notices, notice('warn', 'Already decided.', 'Ya decidido.', 'Someone else resolved this proposal.', 'Otra persona resolvió esta propuesta.')); return; }
        add(notices, notice('bad', verb === 'accept' ? 'Not recorded.' : 'Not dismissed.', verb === 'accept' ? 'No se registró.' : 'No se descartó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
        return;
      }
      li.remove();
      const fw = proposed.querySelector('#fld-facts'); if (fw && !fw.querySelector('li[data-proposal]')) fw.remove();
      if (!proposed.querySelector('li[data-proposal]')) proposed.setAttribute('hidden', '');
      if (verb === 'reject') { add(notices, notice('ok', 'Not a fact: the proposal is closed.', 'No es un hecho: la propuesta queda cerrada.', 'Nothing was written.', 'No se escribió nada.')); return; }
      if (pl.fact_kind === 'operator' && pl.asset_id) {
        const f = ctx.fields.find((x) => x.id === pl.asset_id);
        if (f) { f.operator = pl.value; paint(); }
        add(notices, notice('ok', 'Operator set: ' + pl.value + '.', 'Operador fijado: ' + pl.value + '.', 'Recorded on the field with its quote.', 'Registrado en el campo con su cita.'));
      } else if (pl.fact_kind === 'location' && pl.asset_id) {
        const a = r.body && r.body.asset, filed = Array.isArray(r.body && r.body.dossier) ? r.body.dossier : [];
        const i = ctx.fields.findIndex((x) => x.id === pl.asset_id);
        if (i >= 0 && a) ctx.fields[i] = { ...ctx.fields[i], ...a, dossier: [...(ctx.fields[i].dossier || []), ...filed] };
        else if (i >= 0 && pl.candidate) ctx.fields[i] = { ...ctx.fields[i], lat: pl.candidate.lat, lon: pl.candidate.lon, location_source: pl.candidate.source };
        paint(); renderHeader(ctx);
        add(notices, notice('ok', 'Location set for ' + (pl.asset_name || 'the field') + '.', 'Ubicación fijada para ' + (pl.asset_name || 'el campo') + '.', filed.length ? filed.length + ' dossier record' + (filed.length === 1 ? '' : 's') + ' filed.' : 'From ' + (pl.candidate ? sourceWord(pl.candidate.source).en : 'the gazetteer') + '.', filed.length ? filed.length + ' registro' + (filed.length === 1 ? '' : 's') + ' de dosier archivado' + (filed.length === 1 ? '' : 's') + '.' : 'Desde ' + (pl.candidate ? sourceWord(pl.candidate.source).es : 'el gacetero') + '.'));
      } else if (pl.fact_kind === 'production') {
        p.register = { ...(p.register || {}), current: (pl.value || '') + (pl.unit ? ' ' + pl.unit : '') + (pl.year ? ' (' + pl.year + ')' : '') };
        renderOpportunity(ctx);
        add(notices, notice('ok', 'Filed as fact.', 'Archivado como hecho.', 'The figure is on the register as current production, with its source.', 'La cifra está en el registro como producción actual, con su fuente.'));
      } else add(notices, notice('ok', 'Filed as fact.', 'Archivado como hecho.', 'Recorded on the finding with its quote.', 'Registrado en el hallazgo con su cita.'));
    };
    yes.addEventListener('click', () => decideFact('accept'));
    no.addEventListener('click', () => decideFact('reject'));
    add(actions, yes, no);
    add(li, actions);
    return li;
  };
  const decide = async (q, body, btn, row) => {
    notices.textContent = '';
    if (btn) btn.disabled = true;
    const verb = body === null ? 'reject' : 'accept';
    const r = await api('/api/queue/review/' + encodeURIComponent(q.id) + '/' + verb, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (btn) btn.disabled = false;
    if (r.status === 409 && r.body && r.body.error && r.body.error.code === 'outside_country') { askOutside(r, () => decide(q, { ...(body || {}), confirm_outside: true }, btn, row)); return; }
    if (!r.ok) {
      if (r.status === 409) { row.remove(); add(notices, notice('warn', 'Already decided.', 'Ya decidido.', 'Someone else resolved this proposal.', 'Otra persona resolvió esta propuesta.')); return; }
      add(notices, notice('bad', verb === 'accept' ? 'Not attached.' : 'Not dismissed.', verb === 'accept' ? 'No se adjuntó.' : 'No se descartó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
      return;
    }
    row.remove();
    if (!proposed.querySelector('li[data-proposal]')) proposed.setAttribute('hidden', '');
    if (verb === 'reject') { add(notices, notice('ok', q.payload.name + ' is not a field of this project.', q.payload.name + ' no es un campo de este proyecto.', 'The proposal is closed.', 'La propuesta queda cerrada.')); return; }
    const a = r.body && r.body.asset;
    const filed = Array.isArray(r.body && r.body.dossier) ? r.body.dossier : [];
    if (a) {
      const i = ctx.fields.findIndex((x) => x.id === a.id);
      const rowData = { ...a, dossier: i >= 0 ? [...(ctx.fields[i].dossier || []), ...filed] : filed };
      if (i >= 0) ctx.fields[i] = rowData; else ctx.fields.push(rowData);
      if (!(p.asset_ids || []).includes(a.id)) p.asset_ids = [...(p.asset_ids || []), a.id];
      paint(); renderHeader(ctx);
      add(notices, notice('ok', a.name + ' attached.', a.name + ' adjuntado.',
        filed.length ? filed.length + (filed.length === 1 ? ' dossier record filed from ' : ' dossier records filed from ') + sourceWord(a.location_source).en + '.' : (a.lat == null ? 'Attached by name, without a location.' : 'No gazetteer record to file: no dossier.'),
        filed.length ? filed.length + (filed.length === 1 ? ' registro de dosier archivado desde ' : ' registros de dosier archivados desde ') + sourceWord(a.location_source).es + '.' : (a.lat == null ? 'Adjuntado por nombre, sin ubicación.' : 'Sin registro de gacetero que archivar: sin dosier.')));
    }
  };
  const proposalRow = (q) => {
    const pl = q.payload || {};
    const li = mk('li', 'hub-proposal', null, null, { 'data-proposal': q.id });
    const head = mk('div', 'hub-proposal-head');
    add(head, dv('b', null, pl.name), document.createTextNode(' '), kindWord(pl.kind || 'field'));
    if (pl.source === 'model') add(head, document.createTextNode(' · '), mk('span', 'hub-muted', 'found by the assistant', 'hallado por el asistente'));
    const where = [pl.item_title, pl.anchor].filter(Boolean).join(', ');
    if (pl.quote) add(head, dv('blockquote', 'hub-proposal-quote', '“' + pl.quote + '”' + (where ? ' (' + where + ')' : ''), { 'data-quote': '' }));
    add(li, head);
    const cands = Array.isArray(pl.candidates) ? pl.candidates : [];
    const ul = mk('ul', 'hub-candidates');
    for (const c of cands) {
      const row = mk('li', 'hub-candidate', null, null, { 'data-candidate': c.source + ':' + c.source_id });
      const main = mk('div');
      add(main, mk('span', null, pl.name + ' → ', pl.name + ' → '), dv('b', null, c.name));
      const meta = mk('div', 'hub-note-s');
      const cc = coordText(c);
      if (cc) add(meta, dv('span', 'mono', cc)); else add(meta, mk('span', null, 'no coordinates on this record', 'sin coordenadas en este registro'));
      add(meta, document.createTextNode(' · '), srcPill(c.source));
      if (c.detail && c.detail.status) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.status));
      if (c.detail && c.detail.operator) add(meta, document.createTextNode(' · '), dv('span', null, c.detail.operator));
      add(main, meta);
      const b = mk('button', 'btn btn-primary btn-sm', 'Attach', 'Adjuntar', { type: 'button', 'data-attach': c.source + ':' + c.source_id });
      b.addEventListener('click', () => decide(q, attachBody(c, p.country || null), b, li));
      add(row, main, b);
      add(ul, row);
    }
    if (!cands.length) add(ul, add(mk('li', 'hub-candidate'), mk('span', 'hub-muted', 'No gazetteer match: the Vault, Global Energy Monitor, GeoNames and Wikidata know no record by this name here.', 'Sin coincidencia en gaceteros: el Vault, Global Energy Monitor, GeoNames y Wikidata no conocen ningún registro con este nombre aquí.')));
    add(li, ul);
    const actions = mk('div', 'hub-actions-row');
    const bare = mk('button', 'btn btn-outline btn-sm', 'Attach without a location', 'Adjuntar sin ubicación', { type: 'button', 'data-attach-bare': '' });
    bare.addEventListener('click', () => decide(q, {}, bare, li));
    const no = mk('button', 'btn btn-outline btn-sm', 'Not a field', 'No es un campo', { type: 'button', 'data-reject': '' });
    no.addEventListener('click', () => decide(q, null, no, li));
    add(actions, bare, no);
    add(li, actions);
    return li;
  };
  await paintProposals();
  host.refreshProposals = paintProposals;

  // Add field: a search box over the gazetteers, candidates with a source pill each, Attach.
  const form = mk('form', 'hub-fld-add', null, null, { id: 'fld-add', novalidate: '', hidden: '' });
  const row = mk('div', 'hub-fld-search');
  const q = mk('input', null, null, null, { id: 'fld-q', type: 'search', autocomplete: 'off', placeholder: 'Field, block or basin name', 'data-en-ph': 'Field, block or basin name', 'data-es-ph': 'Nombre del campo, bloque o cuenca', 'aria-label': 'Field name' });
  const go = mk('button', 'btn btn-primary btn-sm', 'Search', 'Buscar', { type: 'submit' });
  add(row, mk('label', 'sr-only', 'Field name', 'Nombre del campo', { for: 'fld-q' }), q, go);
  add(form, row);
  const where = mk('p', 'hub-note-s');
  if (p.country) add(where, mk('span', null, 'Searching in ' + ((ctx.names && ctx.names.get(p.country)) || { en: p.country }).en + ': the Vault and Global Energy Monitor first, then GeoNames and Wikidata.', 'Buscando en ' + ((ctx.names && ctx.names.get(p.country)) || { es: p.country }).es + ': primero el Vault y Global Energy Monitor, luego GeoNames y Wikidata.'));
  else add(where, mk('span', null, 'The project has no country yet, so the search is worldwide.', 'El proyecto aún no tiene país, así que la búsqueda es mundial.'));
  add(form, where);
  const out = mk('div', null, null, null, { id: 'fld-results', 'aria-live': 'polite' });
  add(form, out);
  add(host, form);
  const toggle = (open) => { if (open) { form.removeAttribute('hidden'); addBtn.setAttribute('aria-expanded', 'true'); q.focus(); } else { form.setAttribute('hidden', ''); addBtn.setAttribute('aria-expanded', 'false'); } };
  addBtn.addEventListener('click', () => toggle(form.hasAttribute('hidden')));

  const attach = async (c, btn, confirmOutside) => {
    notices.textContent = '';
    const body = attachBody(c, p.country || null);
    if (!body) return;
    if (confirmOutside) body.confirm_outside = true;
    if (btn) btn.disabled = true;
    const r = await api('/api/projects/' + encodeURIComponent(p.id) + '/assets', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (btn) btn.disabled = false;
    if (r.status === 409 && r.body && r.body.error && r.body.error.code === 'outside_country') { askOutside(r, () => attach(c, btn, true)); return; }
    if (r.ok && r.body && r.body.asset) {
      const a = r.body.asset;
      const filed = Array.isArray(r.body.dossier) ? r.body.dossier : [];
      const i = ctx.fields.findIndex((x) => x.id === a.id);
      const rowData = { ...a, dossier: i >= 0 ? [...(ctx.fields[i].dossier || []), ...filed] : filed };
      if (i >= 0) ctx.fields[i] = rowData; else ctx.fields.push(rowData);
      if (!(p.asset_ids || []).includes(a.id)) p.asset_ids = [...(p.asset_ids || []), a.id];
      const n = filed.length;
      add(notices, notice('ok', (r.body.already ? a.name + ' was already attached.' : a.name + ' attached.'), (r.body.already ? a.name + ' ya estaba adjunto.' : a.name + ' adjuntado.'),
        n ? n + (n === 1 ? ' dossier record filed from ' : ' dossier records filed from ') + sourceWord(a.location_source).en + '.' : 'No gazetteer record to file: no dossier.',
        n ? n + (n === 1 ? ' registro de dosier archivado desde ' : ' registros de dosier archivados desde ') + sourceWord(a.location_source).es + '.' : 'Sin registro de gacetero que archivar: sin dosier.'));
      paint(); renderHeader(ctx); toggle(false); out.textContent = ''; q.value = '';
      return;
    }
    add(notices, notice('bad', 'Not attached.', 'No se adjuntó.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = q.value.trim();
    out.textContent = '';
    if (name.length < 2) { add(out, mk('p', 'hub-muted', 'Type at least two characters.', 'Escriba al menos dos caracteres.')); return; }
    go.disabled = true;
    add(out, mk('p', 'hub-muted', 'Searching…', 'Buscando…'));
    const r = await api('/api/assets/locate?name=' + encodeURIComponent(name) + (p.country ? '&country=' + encodeURIComponent(p.country) : ''));
    go.disabled = false;
    out.textContent = '';
    if (!r.ok) { add(out, notice('bad', 'The search failed.', 'La búsqueda falló.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.'))); return; }
    const cands = listOf(r.body, 'candidates');
    const unavailable = (r.body && Array.isArray(r.body.unavailable)) ? r.body.unavailable : [];
    const ul = mk('ul', 'hub-candidates', null, null, { id: 'fld-candidates' });
    for (const c of cands) add(ul, candidateRow(ctx, c, attach));
    if (!cands.length) add(out, mk('p', 'hub-muted', 'No record named "' + name + '" in the sources that answered.', 'Ningún registro llamado "' + name + '" en las fuentes que respondieron.'));
    add(out, ul);
    if (unavailable.length) {
      const un = mk('ul', 'hub-unavailable', null, null, { id: 'fld-unavailable' });
      for (const u of unavailable) add(un, add(mk('li', null, null, null, { 'data-unavailable': u.source }), mk('span', null, sourceWord(u.source).en + ' not available: ', sourceWord(u.source).es + ' no disponible: '), dv('span', null, u.reason)));
      add(out, un);
    }
    // The name alone, without a location, is always possible: a field from a document or a client's own naming.
    const manual = mk('div', 'hub-candidate hub-candidate-manual');
    add(manual, add(mk('div'), dv('b', null, name), document.createTextNode(' '), mk('span', 'hub-note-s', 'Attach by name only; its location can come later from a document or a gazetteer.', 'Adjuntar solo por nombre; su ubicación puede llegar después desde un documento o un gacetero.')));
    const mb = mk('button', 'btn btn-outline btn-sm', 'Attach without a location', 'Adjuntar sin ubicación', { type: 'button', id: 'fld-manual' });
    mb.addEventListener('click', () => attach({ name, kind: 'field', source: 'manual', country: p.country || null }, mb));
    add(manual, mb);
    add(out, manual);
  });
}

/* ── add documents (M09 upload) ──────────────────────────────────────── */

const UP_STATUS = {
  ingested: ['Indexed', 'Indexado', 'ok'], queued: ['Queued for indexing', 'En cola para indexar', 'info'],
  unchanged: ['Already in the Vault', 'Ya está en el Vault', 'muted'], stored: ['Stored, not indexed', 'Guardado, no indexado', 'warn'],
  failed: ['Failed', 'Falló', 'bad'],
};

/**
 * Files chosen or dropped go to POST /api/ingest/upload as one multipart request with the
 * project id; the API files each one under the project's legal tag and indexes it (or queues
 * it). One row per file shows the outcome. The page is not reloaded automatically: the
 * timeline already on screen stays valid, and a button offers the refresh.
 */
function setupUpload(project) {
  const input = $('#up-files'), drop = $('#up-drop'), list = $('#up-results'), notices = $('#up-notices');
  if (!input || !drop || !list) return;
  // Wave 7 (R6): the drop zone is a sheet opened from the tab strip; the whole page stays a drop target.
  const sheet = $('#p-upload'), opener = $('#p-add-docs'), scrim = $('#upload-scrim'), closeBtn = $('#up-close');
  let closeSheet = null;
  const openUpload = () => { if (!sheet || !sheet.hasAttribute('hidden')) return; closeSheet = openSheet(sheet, scrim, opener, () => { closeSheet = null; }); };
  if (opener) opener.addEventListener('click', () => (sheet.hasAttribute('hidden') ? openUpload() : closeSheet && closeSheet()));
  if (closeBtn) closeBtn.addEventListener('click', () => closeSheet && closeSheet());
  let dragDepth = 0;
  const hasFiles = (ev) => !!(ev.dataTransfer && (Array.from(ev.dataTransfer.types || []).includes('Files') || ev.dataTransfer.files));
  document.addEventListener('dragenter', (ev) => { if (!hasFiles(ev)) return; dragDepth++; document.body.classList.add('is-dragover'); });
  document.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); document.body.classList.add('is-dragover'); });
  document.addEventListener('dragleave', (ev) => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0 || ev.relatedTarget === null) { dragDepth = 0; document.body.classList.remove('is-dragover'); } });
  document.addEventListener('drop', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth = 0; document.body.classList.remove('is-dragover'); openUpload(); send(ev.dataTransfer && ev.dataTransfer.files); });
  const send = async (files) => {
    if (!files || !files.length) return;
    openUpload();
    notices.textContent = '';
    const fd = new FormData();
    fd.append('project_id', project.id);
    for (const f of files) fd.append('files', f, f.name);
    const progress = $('#up-progress'), ptext = $('#up-progress-text');
    const n = files.length;
    setText(ptext, 'Uploading ' + n + (n === 1 ? ' file' : ' files') + '… reading and indexing can take up to a minute for a long PDF or a scan.',
      'Subiendo ' + n + (n === 1 ? ' archivo' : ' archivos') + '… leer e indexar puede tardar hasta un minuto con un PDF largo o un escaneo.');
    progress.removeAttribute('hidden');
    drop.classList.add('busy');
    const res = await api('/api/ingest/upload', { method: 'POST', body: fd, signal: AbortSignal.timeout(180000) });
    drop.classList.remove('busy');
    progress.setAttribute('hidden', '');
    input.value = '';
    if (!res.ok) {
      const msg = errMessage(res);
      if (res.status === 0) add(notices, notice('bad', 'The Vault is unreachable.', 'El Vault no es accesible.', 'The files were not uploaded.', 'Los archivos no se subieron.'));
      else add(notices, notice('bad', 'The files were not uploaded.', 'Los archivos no se subieron.', msg || 'HTTP ' + res.status, msg || 'HTTP ' + res.status));
      return;
    }
    const results = listOf(res.body, 'results');
    let anyFields = false;
    for (const r of results) {
      const li = mk('li', 'hub-upload-row', null, null, { 'data-upload-file': r.filename || '' });
      const st = UP_STATUS[r.status] || [r.status || '?', r.status || '?', 'muted'];
      add(li, dv('b', null, r.filename), mk('span', 'hub-pill ' + st[2], st[0], st[1], { 'data-status': r.status || '' }));
      const meta = mk('span', 'hub-muted');
      const bits = [];
      if (r.type) bits.push(dv('span', null, r.type));
      if (r.version) bits.push(mk('span', null, 'version ' + r.version, 'versión ' + r.version));
      if (typeof r.chunks === 'number') bits.push(mk('span', null, r.chunks + ' chunks', r.chunks + ' fragmentos'));
      if (r.error) bits.push(dv('span', null, r.error));
      bits.forEach((b, i) => { if (i) add(meta, document.createTextNode(' · ')); add(meta, b); });
      add(li, meta);
      // Wave 3: fields the document names wait in the Fields card.
      if (typeof r.asset_proposals === 'number' && r.asset_proposals > 0) {
        const n = r.asset_proposals;
        add(li, add(mk('span', 'hub-upload-fields', null, null, { 'data-fields-named': String(n) }), mk('a', 'hub-inline-link', n + (n === 1 ? ' field named: review it in the Fields card' : ' fields named: review them in the Fields card'), n + (n === 1 ? ' campo nombrado: revíselo en la tarjeta Campos' : ' campos nombrados: revíselos en la tarjeta Campos'), { href: '#p-fields' })));
        anyFields = true;
      }
      add(list, li);
    }
    if (anyFields) { const host = $('#p-fields'); if (host && host.refreshProposals) host.refreshProposals(); }
    if (results.length && !$('#up-reload')) {
      const b = mk('button', 'btn btn-outline btn-sm', 'Reload the project file', 'Recargar la ficha del proyecto', { type: 'button', id: 'up-reload' });
      b.addEventListener('click', () => location.reload());
      add(list.parentElement, b);
    }
  };
  input.addEventListener('change', () => send(input.files));
  drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (ev) => { ev.preventDefault(); ev.stopPropagation(); drop.classList.remove('over'); document.body.classList.remove('is-dragover'); send(ev.dataTransfer && ev.dataTransfer.files); });
}

/* ── scorecard ───────────────────────────────────────────────────────── */

const RULES = [
  ['Every headline number traces to a run', 'Cada cifra principal se remonta a una ejecución'],
  ['Every assumption carries a source and provenance', 'Cada supuesto lleva fuente y procedencia'],
  ['No stale record in a delivered set', 'Ningún registro obsoleto en un conjunto entregado'],
  ['Basis note current for the latest vintage', 'Nota de bases vigente para la última añada'],
  ['Legal tag valid with more than 90 days left', 'Etiqueta legal vigente con más de 90 días'],
  ['Every outbound letter has a dispatch and an acknowledgement', 'Toda carta saliente tiene envío y acuse de recibo'],
];
const isBasisItem = (it) => it && it.type === 'note' && (/^basis/i.test(it.title || '') || (it.extracted && it.extracted.kind === 'basis'));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** Six rules computed from what the page already loaded. A rule with no data behind it is 'na' (not yet measurable). */
export function computeScorecard(ctx) {
  const { entries, vintages, runs, orgFile, basis, lineage, project, now } = ctx;
  const out = [];
  const rule = (i, status, en, es) => out.push({ n: i + 1, en: RULES[i][0], es: RULES[i][1], status, detail: bi(en, es) });
  const runsById = new Map((runs || []).map((r) => [r.id, r]));
  const newest = vintages.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  // 1. Headline numbers trace to a run (and, when run records are loaded, a tool commit).
  if (!vintages.length) rule(0, 'na', 'No final evaluation run yet, so there is no headline number to trace.', 'Aún no hay ejecución de evaluación final, así que no hay cifra principal que rastrear.');
  else {
    const withCommit = runs && runs.length;
    const ok = vintages.filter((v) => v.run_id && v.tool_version && (!withCommit || (runsById.get(v.run_id) || {}).tool_commit)).length;
    const what = withCommit ? ['a run id and a tool commit', 'un id de ejecución y un commit de la herramienta'] : ['a run id and a tool version', 'un id de ejecución y una versión de la herramienta'];
    rule(0, ok === vintages.length ? 'pass' : 'fail', ok + ' of ' + vintages.length + ' vintages link to ' + what[0] + '.', ok + ' de ' + vintages.length + ' añadas enlazan ' + what[1] + '.');
  }

  // 2. Assumptions carry a source and provenance (needs the run records).
  if (!runs) rule(1, 'na', 'Run records could not be loaded.', 'No se pudieron cargar los registros de ejecución.');
  else {
    const all = [];
    for (const r of runs) if (r.status !== 'superseded') for (const [k, a] of Object.entries(r.assumptions || {})) all.push({ k, a });
    if (!all.length) rule(1, 'na', 'No assumptions are recorded on the active runs.', 'No hay supuestos registrados en las ejecuciones activas.');
    else {
      const ok = all.filter((x) => x.a && x.a.source && x.a.provenance).length;
      const by = {};
      for (const x of all) { const p = (x.a && x.a.provenance) || 'unsourced'; by[p] = (by[p] || 0) + 1; }
      const list = Object.entries(by).map(([k, v]) => v + ' ' + k).join(', ');
      rule(1, ok === all.length ? 'pass' : 'fail', ok + ' of ' + all.length + ' assumptions sourced. ' + list + '.', ok + ' de ' + all.length + ' supuestos con fuente. ' + list + '.');
    }
  }

  // 3. No stale record in a delivered set: letters, basis notes and runs that were finalised or reviewed.
  const basisIds = new Set((basis || []).map((b) => b.id));
  const delivered = entries.filter((e) => e.kind === 'run' ? (e.status === 'final' || e.status === 'reviewed') : (e.type === 'letter' || e.type === 'report' || e.type === 'proposal' || basisIds.has(e.id) || (e.type === 'note' && /^basis/i.test(e.title || ''))));
  const staleDelivered = delivered.filter((e) => e.stale);
  if (!staleDelivered.length) rule(2, 'pass', 'None of the ' + delivered.length + ' delivered records is stale.', 'Ninguno de los ' + delivered.length + ' registros entregados está obsoleto.');
  else {
    const names = staleDelivered.map((e) => (e.title || e.job || e.id)).slice(0, 3).join('; ');
    rule(2, 'fail', plural(staleDelivered.length, 'delivered record is', 'delivered records are') + ' stale: ' + names + '.', plural(staleDelivered.length, 'registro entregado está', 'registros entregados están') + ' obsoleto(s): ' + names + '.');
  }

  // 4. A current basis note covers the latest vintage.
  if (!newest) rule(3, 'na', 'No final evaluation run yet.', 'Aún no hay ejecución de evaluación final.');
  else {
    const edges = (lineage && lineage.edges) || [];
    const covers = (b) => {
      const note = entries.find((e) => e.id === b.id) || b;
      if (note.stale) return false;
      const cited = edges.some((e) => e.from === 'run:' + newest.run_id && e.to === 'doc:' + b.id) || (b.cites || []).includes('run:' + newest.run_id);
      const at = b.authored_at || b.created_at || note.at || '';
      return cited || (at && at >= newest.created_at);
    };
    const notes = basis || entries.filter((e) => e.kind === 'item' && e.type === 'note' && /^basis/i.test(e.title || ''));
    const ok = notes.some(covers);
    rule(3, ok ? 'pass' : 'fail',
      ok ? 'A current basis note covers the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').' : (notes.length ? plural(notes.length, 'basis note exists', 'basis notes exist') + ', none current for the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').' : 'No basis note exists for the latest vintage (' + (newest.created_at || '').slice(0, 10) + ').'),
      ok ? 'Una nota de bases vigente cubre la última añada (' + (newest.created_at || '').slice(0, 10) + ').' : (notes.length ? plural(notes.length, 'nota de bases existe', 'notas de bases existen') + ', ninguna vigente para la última añada (' + (newest.created_at || '').slice(0, 10) + ').' : 'No existe nota de bases para la última añada (' + (newest.created_at || '').slice(0, 10) + ').'));
  }

  // 5. Legal tag has more than 90 days left.
  const exp = tagExpiry(project, orgFile);
  if (!exp) rule(4, 'na', 'The API does not expose an expiry for ' + project.default_legal_tag + ' yet.', 'La API aún no expone un vencimiento para ' + project.default_legal_tag + '.');
  else {
    const d = daysLeft(exp.date, now);
    rule(4, d > 90 ? 'pass' : 'fail', project.default_legal_tag + ' expires ' + exp.date + ', ' + d + ' days remain.', project.default_legal_tag + ' vence el ' + exp.date + ', quedan ' + d + ' días.');
  }

  // 6. Every outbound letter has a dispatch and an acknowledgement (needs the client's file).
  if (!orgFile) rule(5, 'na', 'The client file (dispatches) is not available.', 'La ficha del cliente (envíos) no está disponible.');
  else {
    const disp = orgFile.dispatches || [];
    const inbound = new Set(disp.filter((d) => d.direction === 'in').map((d) => d.item_id));
    const letters = entries.filter((e) => e.kind === 'item' && e.type === 'letter' && !inbound.has(e.id));
    const withD = letters.filter((l) => disp.some((d) => d.item_id === l.id && d.direction === 'out'));
    const acked = letters.filter((l) => disp.some((d) => d.item_id === l.id && d.direction === 'out' && d.acknowledged_at));
    const latest = acked.map((l) => disp.filter((d) => d.item_id === l.id && d.acknowledged_at).map((d) => String(d.acknowledged_at).slice(0, 10)).sort().pop()).sort().pop();
    const ok = withD.length === letters.length && acked.length === letters.length;
    rule(5, ok ? 'pass' : 'fail',
      letters.length + ' letters, ' + withD.length + ' dispatches, ' + acked.length + ' acknowledged' + (latest ? ' (latest ' + latest + ')' : '') + '.',
      letters.length + ' cartas, ' + withD.length + ' envíos, ' + acked.length + ' con acuse' + (latest ? ' (último ' + latest + ')' : '') + '.');
  }
  return out;
}

function renderScorecard(rules) {
  const host = $('#score');
  host.textContent = '';
  const pass = rules.filter((r) => r.status === 'pass').length;
  const fail = rules.filter((r) => r.status === 'fail').length;
  const na = rules.filter((r) => r.status === 'na').length;
  const list = mk('div', 'card', null, null, { 'data-scorecard': '' });
  for (const r of rules) {
    const row = mk('div', 'hub-rule ' + r.status, null, null, { 'data-rule': String(r.n), 'data-status': r.status });
    const tick = mk('span', 'tick'); tick.setAttribute('aria-hidden', 'true');
    tick.innerHTML = r.status === 'pass' ? CHECK : r.status === 'fail' ? CROSS : DASH;
    add(row, tick, add(mk('div'), mk('h3', null, r.n + '. ' + r.en, r.n + '. ' + r.es), mk('p', null, r.detail.en, r.detail.es)));
    const pill = r.status === 'pass' ? mk('span', 'hub-pill ok', 'Pass', 'Cumple') : r.status === 'fail' ? mk('span', 'hub-pill bad', 'Fail', 'No cumple') : mk('span', 'hub-pill muted', 'Not yet measurable', 'Aún no medible');
    add(row, pill);
    add(list, row);
  }
  const sum = mk('div', 'card hub-summary');
  const rag = pass === rules.length ? 'g' : pass >= 4 ? 'a' : 'r';
  add(sum, mk('span', 'label', 'Summary', 'Resumen'));
  const big = mk('span', 'big', null, null, { 'data-pass': String(pass) });
  add(big, mk('span', 'hub-rag ' + (rag === 'a' ? '' : rag), null, null, { 'aria-hidden': 'true' }), mk('span', null, pass + '/' + rules.length + ' rules pass', pass + '/' + rules.length + ' reglas cumplen'));
  add(sum, big);
  add(sum, mk('p', 'hub-muted', 'Green: all 6. Amber: 4 or 5 of 6. Red at 3 or fewer.', 'Verde: las 6. Ámbar: 4 o 5 de 6. Rojo con 3 o menos.'));
  if (na) add(sum, mk('p', 'hub-muted', plural(na, 'rule is', 'rules are') + ' not yet measurable and counts as not passing.', plural(na, 'regla no es', 'reglas no son') + ' medible(s) todavía y no cuenta(n) como cumplida(s).'));
  add(host, list, sum);
  return { pass, fail, na, rag };
}

/* ── tabs ────────────────────────────────────────────────────────────── */

/* ── wave 4: research runs (docs/vault-hub/wave4/05-markup.md §1.1) ──── */

const RS_SOURCE = {
  locate: ['Field locations (gazetteers)', 'Ubicaciones de campos (gaceteros)'], 'gem-wiki': ['Global Energy Monitor wiki', 'Wiki de Global Energy Monitor'], 'gem-wiki-ref': ['Sources cited by Global Energy Monitor', 'Fuentes citadas por Global Energy Monitor'], web: ['Web search', 'Búsqueda web'],
  gdelt: ['World Monitor · GDELT news', 'World Monitor · noticias GDELT'], 'company-enrichment': ['World Monitor · company profiles', 'World Monitor · perfiles de empresa'],
  'company-signals': ['World Monitor · company signals', 'World Monitor · señales de empresa'], 'sec-filings': ['World Monitor · SEC filings', 'World Monitor · presentaciones SEC'],
  'intel-timeline': ['World Monitor · intelligence timeline', 'World Monitor · cronología de inteligencia'], literature: ['Literature', 'Literatura'],
};
const RS_ORDER = ['locate', 'gem-wiki', 'gem-wiki-ref', 'web', 'gdelt', 'company-enrichment', 'company-signals', 'sec-filings', 'intel-timeline', 'literature'];
const rsGroupOf = (src) => (RS_SOURCE[src] ? src : 'literature');
const canWriteProject = (ctx) => !!ctx.person && (ctx.person.role === 'partner' || !ctx.project.client_id || (ctx.project.members || []).includes(ctx.person.id));
const pollMs = () => Number(window.HUB_RESEARCH_POLL_MS) || 10000;
const gbp = (n) => '£' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);

/** The toolbar button and status line, and the Research tab; polls every 10 s while a run is queued or running. */
function renderResearch(ctx, first) {
  const host = $('#p-toolbar'), panel = $('#research'), tab = () => $('#tab-research');
  const state = { view: first && first.ok ? first.body : null, available: !!(first && first.ok), timer: null, lastStatus: null };
  ctx.research = state;
  const latest = () => (state.view && state.view.runs && state.view.runs[0]) || null;
  const active = () => { const r = latest(); return !!r && (r.status === 'queued' || r.status === 'running'); };
  const wrap = mk('span', 'hub-research-ctl', null, null, { id: 'p-research' });
  add(host, wrap);
  const status = mk('span', 'hub-research-status', null, null, { id: 'p-research-status', role: 'status' });
  let btn = null;
  if (state.available && state.view.enabled !== false && canWriteProject(ctx)) {
    btn = mk('button', 'btn btn-outline btn-sm hub-research-btn', null, null, { type: 'button', id: 'p-research-btn' });
    btn.insertAdjacentHTML('afterbegin', svgIcon('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'));
    add(btn, mk('span', null, 'Research this project', 'Investigar este proyecto'));
    btn.addEventListener('click', start);
    add(wrap, btn);
  }
  add(wrap, status);

  function paintStatus() {
    status.textContent = '';
    const r = latest();
    if (!state.available) { setText(status, 'research is not available on this Vault', 'la investigación no está disponible en este Vault'); return; }
    if (state.view.enabled === false) { setText(status, 'research runs are switched off', 'las ejecuciones de investigación están desactivadas'); return; }
    if (!r) { setText(status, 'no research yet', 'aún sin investigación'); return; }
    const sm = r.summary || {};
    const busy = (en, es) => { add(status, mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, en, es, { 'data-run-status': r.status })); if (btn) { btn.disabled = true; setText(btn.querySelector('span'), 'Researching…', 'Investigando…'); } };
    if (r.status === 'queued') { busy('queued · waiting to start', 'en cola · a la espera de empezar'); return; }
    if (r.status === 'running') {
      const mins = Math.max(0, Math.round((Date.now() - Date.parse(r.started_at)) / 60000));
      const ph = sm.phase === 'literature' ? [' · searching the literature', ' · buscando en la literatura'] : sm.phase === 'world-monitor' ? [' · asking World Monitor', ' · consultando World Monitor'] : sm.phase === 'locate' ? [' · locating the fields', ' · ubicando los campos'] : sm.phase === 'gem-wiki' ? [' · reading Global Energy Monitor', ' · leyendo Global Energy Monitor'] : sm.phase === 'web' ? [' · searching the web', ' · buscando en la web'] : ['', ''];
      busy('running · ' + mins + ' min · ' + (sm.findings || 0) + ' findings' + ph[0], 'en curso · ' + mins + ' min · ' + (sm.findings || 0) + ' hallazgos' + ph[1]);
      return;
    }
    const when = fmtStamp(r.finished_at || r.started_at);
    const pr = sm.proposals ? (sm.proposals.asset || 0) + (sm.proposals.research || 0) : 0;
    if (btn) { btn.disabled = false; setText(btn.querySelector('span'), 'Research this project', 'Investigar este proyecto'); }
    if (r.status === 'failed') { add(status, mk('span', 'hub-pill bad', 'failed', 'falló'), mk('span', null, ' last run ' + when.en + (sm.warnings && sm.warnings[0] ? ': ' + sm.warnings[0] : ''), ' última ejecución ' + when.es + (sm.warnings && sm.warnings[0] ? ': ' + sm.warnings[0] : ''), { 'data-run-status': 'failed' })); return; }
    const stopped = sm.stopped_by === 'time' ? { en: ' · stopped at ' + Math.round((sm.budget && sm.budget.ms || 0) / 60000) + ' min', es: ' · detenida a los ' + Math.round((sm.budget && sm.budget.ms || 0) / 60000) + ' min' } : sm.stopped_by === 'spend' ? { en: ' · stopped at the ' + gbp(sm.budget && sm.budget.gbp) + ' cap', es: ' · detenida en el tope de ' + gbp(sm.budget && sm.budget.gbp) } : { en: '', es: '' };
    add(status, mk('span', null, 'last run ' + when.en + ' · ' + (sm.findings || 0) + ' findings · ' + pr + ' proposals' + stopped.en, 'última ejecución ' + when.es + ' · ' + (sm.findings || 0) + ' hallazgos · ' + pr + ' propuestas' + stopped.es, { 'data-run-status': r.status }));
  }

  function paintPanel() {
    if (!panel) return;
    panel.textContent = '';
    const head = mk('div', 'hub-card-head');
    const hd = mk('div');
    add(hd, mk('h3', null, 'Research', 'Investigación'));
    const r = latest(), sm = (r && r.summary) || {};
    if (r && (r.status === 'ok' || r.status === 'stopped' || r.status === 'failed')) {
      const when = fmtStamp(r.finished_at || r.started_at);
      const parts = [];
      for (const [src, c] of Object.entries(sm.sources || {})) parts.push((RS_SOURCE[src] ? RS_SOURCE[src][0].replace('World Monitor · ', '') : src) + ' ' + (c.findings || 0));
      add(hd, mk('span', 'hub-muted', 'run of ' + when.en + ', ' + Math.round((sm.duration_ms || 0) / 60000) + ' min, ' + gbp(sm.spend_gbp) + (parts.length ? ' · ' + parts.join(' · ') : ''), 'ejecución del ' + when.es + ', ' + Math.round((sm.duration_ms || 0) / 60000) + ' min, ' + gbp(sm.spend_gbp) + (parts.length ? ' · ' + parts.join(' · ') : ''), { id: 'rs-summary' }));
    } else add(hd, mk('span', 'hub-muted', 'What the Vault found by itself about this project: World Monitor news, company profiles and filings, and the literature, each filed as a cited note.', 'Lo que el Vault encontró por sí mismo sobre este proyecto: noticias de World Monitor, perfiles y presentaciones de empresas, y la literatura, cada uno archivado como nota citada.', { id: 'rs-summary' }));
    add(head, hd);
    add(panel, head);
    const findings = (state.view && state.view.findings) || [];
    const finished = !!r && (r.status === 'ok' || r.status === 'stopped' || r.status === 'failed');
    if (!findings.length) {
      add(panel, mk('p', 'hub-empty', active() ? 'The run is in progress; findings appear here as they land.' : finished ? 'Nothing found this run. The sources below say what was asked and what each answered.' : 'No findings yet. Research this project asks World Monitor and the literature about its fields and operators.',
        active() ? 'La ejecución está en curso; los hallazgos aparecen aquí a medida que llegan.' : finished ? 'Nada encontrado en esta ejecución. Las fuentes de abajo dicen qué se preguntó y qué respondió cada una.' : 'Aún sin hallazgos. Investigar este proyecto pregunta a World Monitor y a la literatura por sus campos y operadores.', { id: 'rs-empty' }));
    }
    // What each source was asked and what it answered: the only way a "0 findings" is an answer rather than a mystery.
    if (finished && sm.sources && Object.keys(sm.sources).length) {
      const ul = mk('ul', 'hub-research-sources', null, null, { id: 'rs-sources' });
      for (const [src, c] of Object.entries(sm.sources)) {
        const li = mk('li', null, null, null, { 'data-source': src });
        const lab = RS_SOURCE[src] || (src === 'company' ? ['World Monitor · company lookups', 'World Monitor · búsquedas de empresa'] : [src, src]);
        add(li, mk('b', null, lab[0], lab[1]), document.createTextNode(': '), mk('span', null, (c.queries || 0) + (c.queries === 1 ? ' query · ' : ' queries · ') + (c.findings || 0) + (c.findings === 1 ? ' finding' : ' findings'), (c.queries || 0) + (c.queries === 1 ? ' consulta · ' : ' consultas · ') + (c.findings || 0) + (c.findings === 1 ? ' hallazgo' : ' hallazgos')));
        if (c.error) add(li, document.createTextNode(' · '), dv('span', 'hub-pill bad', c.error, { 'data-error': '' }));
        if (c.skipped) add(li, document.createTextNode(' · '), dv('span', 'hub-pill muted', c.skipped, { 'data-skipped': '' }));
        if (c.detail) add(li, document.createTextNode(' · '), dv('span', 'hub-pill muted', c.detail, { 'data-detail': '' }));
        add(ul, li);
      }
      add(panel, ul);
    }
    const groups = new Map();
    for (const f of findings) { const g = rsGroupOf(f.source); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); }
    for (const g of [...RS_ORDER, ...[...groups.keys()].filter((k) => !RS_ORDER.includes(k))]) {
      const list = groups.get(g);
      if (!list || !list.length) continue;
      list.sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0));
      const sec = mk('section', 'hub-research-group', null, null, { 'data-source': g });
      const h = mk('h4');
      const lab = RS_SOURCE[g] || [g, g];
      add(h, mk('span', null, lab[0], lab[1]), dv('span', 'n', String(list.length)));
      add(sec, h);
      const ul = mk('ul', 'hub-findings');
      for (const f of list) {
        const li = mk('li', 'hub-finding', null, null, { 'data-finding': f.id, 'data-source': f.source || '' });
        const line = mk('div', 'hub-finding-head');
        const d = f.date ? fmtShortDate(f.date) : null;
        if (d) add(line, mk('span', 'd', d.en, d.es));
        add(line, dv('b', null, f.title));
        if (f.url) { const a = dv('a', 'hub-inline-link', (() => { try { return new URL(f.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })(), { href: f.url, target: '_blank', rel: 'noopener noreferrer', 'data-url': '' }); add(line, document.createTextNode(' — '), a); }
        if (f.query) add(line, document.createTextNode(' · '), mk('span', 'hub-muted', 'query ', 'consulta '), dv('span', 'hub-query mono', f.query, { 'data-query': '' }));
        const open = mk('button', 'btn btn-outline btn-sm', 'open', 'abrir', { type: 'button', 'data-open': f.id });
        open.addEventListener('click', () => openRecord({ ref: 'doc:' + f.id, title: f.title, trigger: open }));
        add(line, open);
        add(li, line);
        if (f.quote) add(li, dv('blockquote', 'hub-proposal-quote', '“' + f.quote + '”', { 'data-quote': '' }));
        add(ul, li);
      }
      add(sec, ul);
      add(panel, sec);
    }
    const nr = sm.not_reached || [];
    if (nr.length) {
      const q = nr.slice(0, 6).map((n) => (RS_SOURCE[n.source] ? RS_SOURCE[n.source][0].replace('World Monitor · ', '') : n.source) + ' for ' + n.query + ' (' + (n.reason === 'time' ? 'time' : n.reason === 'spend' ? 'spend cap' : n.reason) + ')');
      add(panel, mk('p', 'hub-muted hub-not-reached', 'Not reached: ' + q.join('; ') + (nr.length > 6 ? ' and ' + (nr.length - 6) + ' more' : '') + '.', 'No alcanzado: ' + q.join('; ') + (nr.length > 6 ? ' y ' + (nr.length - 6) + ' más' : '') + '.', { id: 'rs-not-reached' }));
    }
    const t = tab();
    if (t) { let n = t.querySelector('.n'); if (!n) { n = dv('span', 'n', '0'); add(t, n); } n.textContent = String(findings.length); }
  }

  async function refresh() {
    const r = await api('/api/projects/' + encodeURIComponent(ctx.project.id) + '/research');
    if (!r.ok) return;
    const before = state.lastStatus;
    state.view = r.body; state.available = true;
    const now = latest() ? latest().status : null;
    state.lastStatus = now;
    paintStatus(); paintPanel();
    if (before && (before === 'queued' || before === 'running') && now && now !== 'queued' && now !== 'running' && ctx.repaintProposals) ctx.repaintProposals();
    schedule();
  }
  function schedule() {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
    if (active()) state.timer = setTimeout(refresh, pollMs());
  }
  async function start() {
    pnotices().textContent = '';
    btn.disabled = true;
    const r = await api('/api/projects/' + encodeURIComponent(ctx.project.id) + '/research', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
    if (r.status === 202 && r.body) {
      state.view = { ...(state.view || { findings: [] }), runs: [{ id: r.body.job_id, status: r.body.state === 'running' ? 'running' : 'queued', started_at: new Date().toISOString(), finished_at: null, summary: { findings: 0 } }, ...((state.view && state.view.runs) || [])] };
      state.lastStatus = 'queued';
      paintStatus(); paintPanel(); schedule();
      return;
    }
    btn.disabled = false;
    if (r.status === 409) { add(pnotices(), notice('warn', 'A run is already in progress.', 'Ya hay una ejecución en curso.', 'Its findings land in the Research tab as they arrive.', 'Sus hallazgos llegan a la pestaña Investigación a medida que aparecen.')); state.lastStatus = 'running'; refresh(); return; }
    if (r.status === 501) { add(pnotices(), notice('warn', 'Research runs are switched off.', 'Las ejecuciones de investigación están desactivadas.', errMessage(r) || 'RESEARCH_ENABLED=false on the Vault service.', errMessage(r) || 'RESEARCH_ENABLED=false en el servicio Vault.')); return; }
    add(pnotices(), notice('bad', 'The run could not be started.', 'No se pudo iniciar la ejecución.', errMessage(r) || (r.status ? 'HTTP ' + r.status : 'The Vault is unreachable.'), errMessage(r) || (r.status ? 'HTTP ' + r.status : 'El Vault no es accesible.')));
  }

  state.lastStatus = latest() ? latest().status : null;
  paintStatus(); paintPanel(); schedule();
  return state;
}

const TABS = [
  ['timeline', 'Timeline', 'Cronología'], ['vintages', 'Headline numbers', 'Cifras principales'], ['research', 'Research', 'Investigación'], ['lineage', 'Lineage', 'Linaje'],
  ['basis', 'Basis notes', 'Notas de bases'], ['lessons', 'Lessons in scope', 'Lecciones en alcance'], ['scorecard', 'Scorecard', 'Ficha de evaluación'],
];
let activeTabs = [];

function buildTabs(counts, hide) {
  const bar = $('#p-tabs');
  bar.textContent = '';
  activeTabs = TABS.filter((t) => !hide.has(t[0]));
  for (const t of TABS) { const p = $('#panel-' + t[0]); if (hide.has(t[0]) && p) p.setAttribute('hidden', ''); }
  for (const [key, en, es] of activeTabs) {
    const b = mk('button', null, null, null, { type: 'button', role: 'tab', id: 'tab-' + key, 'aria-controls': 'panel-' + key, 'aria-selected': 'false', tabindex: '-1', 'data-tab': key });
    add(b, mk('span', null, en, es));
    const c = counts[key];
    if (c !== undefined && c !== null) {
      if (typeof c === 'object') add(b, mk('span', 'n bad', c.en, c.es));
      else add(b, dv('span', 'n', String(c)));
    }
    b.addEventListener('click', () => { location.hash = key; });
    b.addEventListener('keydown', (ev) => {
      const i = activeTabs.findIndex((t) => t[0] === key);
      let j = -1;
      if (ev.key === 'ArrowRight') j = (i + 1) % activeTabs.length; else if (ev.key === 'ArrowLeft') j = (i - 1 + activeTabs.length) % activeTabs.length; else if (ev.key === 'Home') j = 0; else if (ev.key === 'End') j = activeTabs.length - 1;
      if (j >= 0) { ev.preventDefault(); location.hash = activeTabs[j][0]; $('#tab-' + activeTabs[j][0]).focus(); }
    });
    add(bar, b);
  }
}

function showTab(key) {
  if (!activeTabs.some((t) => t[0] === key)) key = 'timeline';
  for (const [k, en, es] of activeTabs) {
    const on = k === key, b = $('#tab-' + k), p = $('#panel-' + k);
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
    if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    if (on) { const c = $('#crumb-tab'); if (c) setText(c, en, es); if (b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  currentTab = key;
  return key;
}
/** Opens the File disclosure (wave 7 R6) and, when asked, puts focus on its summary. */
function openFileDisclosure(focus) {
  const d = $('#p-file-wrap');
  if (!d) return;
  d.open = true;
  if (focus) { const s = d.querySelector('summary'); if (s) { s.focus(); s.scrollIntoView({ block: 'start' }); } }
}
/** Shows the timeline tab with a filter chip pressed and the list in view (the stateline's counts land here). */
function showTimelineFiltered(filter) {
  showTab('timeline');
  const tl = $('#tl');
  if (tl) { tl.filter = filter; tl.scrollIntoView({ block: 'start' }); }
}
/** The address's hash: a tab, or (wave 7 R1) one of the stateline's targets, which is acted on and then folded back to the tab. */
const ACTION_HASH = /^(stage|next|file|tab-runs|tab-docs|stale|rec=.+)$/;
let currentTab = 'timeline';
function routeHash() {
  const h = (location.hash || '#timeline').slice(1);
  if (!ACTION_HASH.test(h)) { routeTab(h); return; }
  const ctx = panelCtx.ctx;
  if (h === 'stage') { const s = $('#p-stage'); if (s) { s.scrollIntoView({ block: 'center' }); s.focus(); } }
  else if (h === 'next') { if (ctx && ctx.openRegisterEditor) ctx.openRegisterEditor('op-next'); else openFileDisclosure(true); }
  else if (h === 'file') openFileDisclosure(true);
  else if (h === 'tab-runs') showTimelineFiltered('run');
  else if (h === 'tab-docs') showTimelineFiltered('docs');
  else if (h === 'stale') showTimelineFiltered('stale');
  else if (h.startsWith('rec=')) {
    const ref = decodeURIComponent(h.slice(4));
    showTab('timeline');
    const id = ref.slice(ref.indexOf(':') + 1);
    const row = document.querySelector('.hub-tl-item[data-id="' + CSS.escape(id) + '"]');
    for (const r of document.querySelectorAll('.hub-tl-item.hilite')) r.classList.remove('hilite');
    if (row) { row.classList.add('hilite'); row.scrollIntoView({ block: 'center' }); }
    const e = panelCtx.entryById.get(id);
    openRecord({ ref, title: e && e.title, entry: e, trigger: row && row.querySelector('button') });
  }
  history.replaceState(null, '', location.pathname + location.search + '#' + currentTab);   // the address names the tab again, without a second hashchange
}
const routeTab = (key) => {
  currentTab = showTab(key || (location.hash || '#timeline').slice(1));
  const p = $('#record-panel');
  if (p && !p.hasAttribute('hidden')) { p.setAttribute('hidden', ''); document.body.classList.remove('has-panel'); panelTrigger = null; }   // the panel belongs to the tab it was opened from
};

/* ── record panel ────────────────────────────────────────────────────── */

let panelTrigger = null;
let draftUi = null;          // Write to…, when the person may write this project
let panelCtx = { project: null, entryById: new Map(), lineage: null, catalog: null, ctx: null };
const versionsCache = new Map();

function closePanel() {
  const p = $('#record-panel');
  p.setAttribute('hidden', '');
  const scrim = $('#record-scrim'); if (scrim) scrim.setAttribute('hidden', '');
  document.body.classList.remove('has-panel');
  for (const g of document.querySelectorAll('.ln-node.sel')) g.classList.remove('sel');
  if (panelTrigger && panelTrigger.isConnected) panelTrigger.focus();
  panelTrigger = null;
}

/**
 * Opens the side panel (a bottom sheet below 1200 px) for a record ref
 * (run:<uuid>, doc:<uuid>, ref:...): a highlights strip, related cards you can
 * pivot through, and the raw record behind a closed disclosure (hub/record.js).
 */
async function openRecord({ ref, title, node, entry, trigger, passage, highlight }) {
  const panel = $('#record-panel'), body = $('#rp-body');
  const first = panel.hasAttribute('hidden');
  if (first) panelTrigger = trigger || document.activeElement;        // a pivot keeps the trigger that opened the panel
  const kind = ref.startsWith('run:') ? 'run' : ref.startsWith('doc:') ? 'doc' : 'ref';
  const kindLabel = { run: ['Run', 'Ejecución'], doc: ['Document', 'Documento'], ref: ['Reference set', 'Conjunto de referencia'] }[kind];
  setText($('#rp-kind'), kindLabel[0], kindLabel[1]);
  setText($('#rp-title'), title || (node && node.label) || ref);
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
  if (panel.getAttribute('data-ref') !== ref) return;         // another record was opened meanwhile
  if (res && res.ok && res.body) rec = res.body;
  if (rec && rec.title) setText($('#rp-title'), rec.title);        // the full record title beats the graph's short label
  if (!entry && panelCtx.entryById.has(uuid)) entry = panelCtx.entryById.get(uuid);

  const ctx = {
    ...panelCtx,
    versionsOf: async (id) => {
      if (!versionsCache.has(id)) {
        const r = await api('/api/items/' + encodeURIComponent(id) + '/versions');
        versionsCache.set(id, r.ok ? listOf(r.body, 'versions') : null);
      }
      return versionsCache.get(id);
    },
    open: (r, t, b) => openRecord({ ref: r, title: t, entry: panelCtx.entryById.get(r.slice(r.indexOf(':') + 1)), node: panelCtx.lineage && (panelCtx.lineage.nodes || []).find((n) => n.id === r), trigger: b }),
    // A draft note written in the Hub goes back into Write to… with its saved review (partners only; the panel closes).
    openDraft: draftUi ? (r) => { closePanel(); draftUi.load(r); } : null,
    // Wave 7 (R5): Write a reply opens Write to… on the thread (the panel closes so the draft sits beside the file).
    openReply: draftUi ? (r) => { closePanel(); draftUi.reply(r); } : null,
    highlight: highlight || null,         // the Find term, when opened from Find (?doc=…&q=…)
    passage: passage || null,
    siteRoot: new URL('../', location.href),
  };
  const content = await renderRecord({ kind, ref, rec, node, entry, ctx });
  if (panel.getAttribute('data-ref') !== ref) return;
  body.textContent = '';
  // Wave 5: a citation chip opens the record with the passage the drafter used at the top.
  if (passage) add(body, add(mk('blockquote', 'hub-rp-passage', null, null, { 'data-passage': '' }), mk('span', 'hub-muted', 'Passage cited: ', 'Pasaje citado: '), dv('span', null, passage)));
  add(body, content);
  if (node && node.restricted) add(body, notice('warn', 'Restricted.', 'Restringido.', 'This record is outside your scope; only its id is shown.', 'Este registro está fuera de su alcance; solo se muestra su id.'));
  if (!rec && kind !== 'ref' && !(node && node.restricted)) add(body, notice('warn', 'Full record unavailable.', 'Registro completo no disponible.', 'Showing what the graph knows' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.', 'Se muestra lo que conoce el grafo' + (res && errMessage(res) ? ' (' + errMessage(res) + ')' : '') + '.'));
  // Wave 7 (R5): a record carries its own Technical disclosure; only a bare node or entry still needs the raw dump here.
  if (!rec) add(body, detailsNode({ node: node || null, entry: entry || null }));
  // The passage anchor: the first highlighted match (or the cited passage) scrolled into view inside the panel.
  const anchor = body.querySelector('[data-anchor]');
  if (anchor) anchor.scrollIntoView({ block: 'center' });
}

/* ── tab contents ────────────────────────────────────────────────────── */

function tabError(host, res, en, es) {
  host.textContent = '';
  add(host, notice('warn', en, es, res && res.status ? '(' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') + ')' : '(network)', res && res.status ? '(' + res.status + (errMessage(res) ? ': ' + errMessage(res) : '') + ')' : '(red)'));
}

function renderBasis(basis, entryById, lineageEdges) {
  const host = $('#basis');
  host.textContent = '';
  if (!basis.length) { add(host, add(mk('div', 'card'), mk('div', 'hub-empty', 'No basis notes on this project yet.', 'Aún no hay notas de bases en este proyecto.'))); return; }
  const grid = mk('div', 'hub-cards');
  for (const b of basis) {
    const e = entryById.get(b.id) || {};
    const stale = !!(e.stale || b.stale);
    const card = mk('article', 'card hub-basis', null, null, { 'data-basis-id': b.id, 'data-stale': String(stale) });
    const top = mk('div', 'hub-row');
    const t = mk('h3'); const btn = dv('button', 'hub-tl-title', b.title, { type: 'button' }); add(t, btn);
    btn.addEventListener('click', () => openRecord({ ref: 'doc:' + b.id, title: b.title, entry: e.id ? e : b, trigger: btn }));
    add(top, t);
    const pills = mk('div', 'hub-actions-row');
    if (stale) { const sb = document.createElement('stale-badge'); sb.reasons = e.stale_reasons; add(pills, sb); }
    add(top, pills);
    add(card, top);
    const when = (b.authored_at || b.created_at || '').slice(0, 10);
    add(card, add(mk('div', 'hub-note-s'), when ? dv('span', null, when) : null, b.reference_no ? document.createTextNode(' · ') : null, b.reference_no ? dv('span', 'mono', b.reference_no) : null, b.version > 1 ? dv('span', null, ' · v' + b.version) : null));
    const cites = (b.cites && b.cites.length ? b.cites : lineageEdges.filter((x) => x.to === 'doc:' + b.id).map((x) => x.from));
    if (cites.length) {
      const c = mk('div', 'chips hub-actions-row');
      add(c, mk('span', 'hub-note-s', 'Cites', 'Cita'));
      for (const r of cites.slice(0, 6)) add(c, dv('span', 'hub-asset', r.length > 30 ? r.slice(0, 30) + '…' : r));
      add(card, c);
    }
    if (stale) add(card, notice('bad', 'Why stale.', 'Por qué obsoleta.', firstReason(e.stale_reasons) || 'no reason recorded', firstReason(e.stale_reasons) || 'sin motivo registrado'));
    add(grid, card);
  }
  add(host, grid);
}

function renderLessons(list) {
  const host = $('#lessons');
  host.textContent = '';
  if (!list.length) { add(host, mk('div', 'hub-empty', 'No lessons in scope for this project.', 'No hay lecciones en alcance para este proyecto.')); return; }
  const SCOPE = { firm: ['Firm', 'Firma'], discipline: ['Discipline', 'Disciplina'], client: ['Client', 'Cliente'], project: ['Project', 'Proyecto'], tool: ['Tool', 'Herramienta'] };
  for (const l of list) {
    const row = mk('div', 'hub-lesson', null, null, { 'data-lesson-id': l.id || '' });
    add(row, dv('div', 't', l.claim || l.statement || l.text || l.id));
    const m = mk('div', 'm');
    const sc = SCOPE[l.scope] || [l.scope, l.scope];
    if (l.scope) add(m, mk('span', 'hub-pill info', sc[0], sc[1]));
    if (l.status) add(m, l.status === 'proposed' ? mk('span', 'hub-pill warn', 'Proposed', 'Propuesta') : l.status === 'confirmed' ? mk('span', 'hub-pill ok', 'Confirmed', 'Confirmada') : dv('span', 'hub-pill muted', l.status));
    if (l.confidence != null) add(m, mk('span', null, 'confidence ' + l.confidence, 'confianza ' + l.confidence));
    for (const ev of (l.evidence || []).slice(0, 4)) add(m, dv('span', 'hub-asset', ev.length > 26 ? ev.slice(0, 26) + '…' : ev));
    add(row, m);
    add(host, row);
  }
}

/* ── KPI strip ───────────────────────────────────────────────────────── */

function kpi(labelEn, labelEs, valueNode, detailNode, cls) {
  const k = mk('div', 'hub-kpi');
  add(k, mk('span', 'k', labelEn, labelEs), add(mk('span', 'v' + (cls ? ' ' + cls : '')), valueNode), add(mk('span', 'd'), detailNode));
  return k;
}
/** Idea D: a figure in tabular Barlow Condensed with its unit in small caps after it. */
const figure = (value, unit) => add(mk('span', 'hub-figure'), dv('span', 'hub-num', typeof value === 'number' ? num(value) : value), unit ? dv('span', 'hub-unit', unit) : null);
/** "npv10_musd" with unit "MUSD" reads "NPV10", never "NPV10 MUSD MUSD". */
const keyLabel = (k, unit) => {
  let s = String(k).replace(/_/g, ' ');
  if (unit) { const u = String(unit).toLowerCase(); if (s.toLowerCase().endsWith(' ' + u)) s = s.slice(0, -(u.length + 1)); }
  return s.replace(/\bnpv(\d+)\b/i, 'NPV$1').replace(/\birr\b/i, 'IRR').replace(/\bbopd\b/i, 'bopd');
};

function renderKpis(ctx, card) {
  const host = $('#p-kpis');
  host.textContent = '';
  const { vintages, entries } = ctx;
  const newest = vintages.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (newest) {
    const meta = annotate(vintages).get(newest.run_id);
    const keys = Object.keys(newest.outputs || {}).filter((k) => k !== 'method' && typeof (newest.outputs[k] || {}).value === 'number');
    const pick = [];
    for (const re of [/^2p/i, /npv/i]) { const k = keys.find((x) => re.test(x) && !pick.includes(x)); if (k) pick.push(k); }
    for (const k of keys) if (pick.length < 2 && !pick.includes(k)) pick.push(k);
    for (const k of pick) {
      const o = newest.outputs[k], d = meta.deltas[k];
      const val = figure(o.value, o.unit);
      const det = d && typeof d.delta_pct === 'number'
        ? add(mk('span'), dv('span', (d.delta_pct < 0 ? 'dn' : 'up') + ' hub-num', fmtPct(d.delta_pct)), mk('span', null, ' vs vintage ' + (meta.number - 1), ' vs añada ' + (meta.number - 1)))
        : mk('span', null, 'vintage ' + meta.number, 'añada ' + meta.number);
      const kk = kpi('Latest ' + keyLabel(k, o.unit), 'Última ' + keyLabel(k, o.unit), val, det);
      kk.setAttribute('data-kpi', k);
      add(host, kk);
    }
  } else add(host, kpi('Latest headline', 'Última cifra', figure('—'), mk('span', null, 'no final run yet', 'aún sin ejecución final')));

  const runs = entries.filter((e) => e.kind === 'run');
  const sup = runs.filter((r) => r.status === 'superseded').length;
  add(host, kpi('Active runs', 'Ejecuciones activas', figure(runs.length - sup), mk('span', null, sup + ' superseded', sup + ' reemplazadas')));

  const stale = entries.filter((e) => e.stale);
  const byKind = {};
  for (const e of stale) { const k = iconKind(e); byKind[k] = (byKind[k] || 0) + 1; }
  const KL = { run: ['run', 'ejecución'], letter: ['letter', 'carta'], email: ['email', 'correo'], spreadsheet: ['spreadsheet', 'hoja'], paper: ['paper', 'artículo'], invoice: ['invoice', 'factura'], note: ['note', 'nota'], reference: ['reference set', 'conjunto'], other: ['other', 'otro'] };
  const en = Object.entries(byKind).map(([k, n]) => n + ' ' + KL[k][0]).join(' · '), es = Object.entries(byKind).map(([k, n]) => n + ' ' + KL[k][1]).join(' · ');
  add(host, kpi('Stale records', 'Registros obsoletos', figure(stale.length), stale.length ? mk('span', null, en, es) : mk('span', null, 'nothing stale', 'nada obsoleto'), stale.length ? 'bad' : ''));

  const rag = card.rag === 'g' ? 'g' : card.rag === 'r' ? 'r' : '';
  const v = add(mk('span', 'hub-figure'), mk('span', 'hub-rag ' + rag, null, null, { 'aria-hidden': 'true' }), dv('span', 'hub-num', card.pass + '/6'), mk('span', 'hub-unit', 'rules', 'reglas'));
  add(host, kpi('Scorecard', 'Ficha', v, mk('span', null, card.fail + card.na + ' rules failing or unmeasured', card.fail + card.na + ' reglas fallan o no son medibles')));
}

/* ── load ────────────────────────────────────────────────────────────── */

async function init() {
  const me = await showSession();
  if (!projectId) return failPage(null);
  const enc = encodeURIComponent(projectId);
  const pr = await api('/api/projects/' + enc);
  if (!pr.ok || !pr.body) return failPage(pr);
  showVault(true);
  const project = pr.body;

  const [tlR, vR, lnR, noteR, lessonR, runsR, orgR, fileR, cat, geo, rsR, ctR] = await Promise.all([
    api('/api/projects/' + enc + '/timeline'),
    api('/api/projects/' + enc + '/vintages'),
    api('/api/projects/' + enc + '/lineage'),
    api('/api/items?project=' + enc + '&type=note&limit=1000'),
    api('/api/lessons?scope=' + encodeURIComponent('project:' + projectId)),
    api('/api/runs?project=' + enc + '&limit=1000'),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id)) : Promise.resolve(null),
    project.client_id ? api('/api/organisations/' + encodeURIComponent(project.client_id) + '/file') : Promise.resolve(null),
    loadCatalog(),
    loadGeo(),
    api('/api/projects/' + enc + '/research'),
    api('/api/projects/' + enc + '/contacts'),                 // wave 7 (S15): the list Write to… uses
  ]);
  const names = new Map();
  if (geo) for (const f of geo.features) if (!names.has(f.properties.iso2)) names.set(f.properties.iso2, { en: f.properties.en, es: f.properties.es });

  const entries = tlR.ok ? listOf(tlR.body, 'entries') : [];
  const vintages = vR.ok ? listOf(vR.body, 'vintages') : [];
  const lineage = lnR.ok && lnR.body ? { nodes: listOf(lnR.body, 'nodes'), edges: Array.isArray(lnR.body.edges) ? lnR.body.edges : [] } : null;
  const org = orgR && orgR.ok ? orgR.body : null;
  const orgFile = fileR && fileR.ok ? fileR.body : null;
  const runs = runsR.ok ? listOf(runsR.body, 'runs', 'items') : null;
  const entryById = new Map(entries.map((e) => [e.id, e]));
  panelCtx = { project, entryById, lineage, catalog: cat && cat.catalog ? cat.catalog : null, ctx: null };
  let basis;
  if (noteR.ok) basis = listOf(noteR.body, 'items').filter(isBasisItem);
  else basis = entries.filter((e) => e.kind === 'item' && e.type === 'note' && /^basis/i.test(e.title || ''));
  const lessonsOk = lessonR.ok && lessonR.status !== 404 && lessonR.status !== 501;
  const lessons = lessonsOk ? listOf(lessonR.body, 'lessons', 'items') : [];
  const now = Date.now();
  const contactsList = ctR.ok && ctR.body && Array.isArray(ctR.body.contacts) ? ctR.body.contacts : null;
  const ctx = { project, org, orgFile, entries, vintages, lineage, runs, basis, now, names, person: me, contactsList, catalog: cat };
  panelCtx.ctx = ctx;

  renderHeader(ctx);
  const researchOk = rsR.ok && rsR.status !== 404 && rsR.status !== 501;
  if (isHoldingProject(project)) { const opp = $('#p-opportunity'); if (opp) opp.setAttribute('hidden', ''); } else renderOpportunity(ctx);
  await renderFields(ctx);
  renderHeader(ctx);                                       // the asset chips and the File brief now carry names
  setupUpload(project);

  const rules = computeScorecard(ctx);
  const card = renderScorecard(rules);
  renderKpis(ctx, card);

  // Timeline.
  const tl = $('#tl');
  if (!tlR.ok) tabError($('#panel-timeline'), tlR, 'The timeline could not be loaded.', 'No se pudo cargar la cronología.');
  else {
    tl.entries = [...entries, ...stageEntries(project)];
    tl.addEventListener('record-select', (ev) => openRecord({ ref: ev.detail.ref, title: ev.detail.entry.title, entry: ev.detail.entry, trigger: ev.detail.trigger }));
  }

  // Headline numbers.
  const vt = $('#vint');
  if (!vR.ok) tabError($('#panel-vintages'), vR, 'The headline numbers could not be loaded.', 'No se pudieron cargar las cifras principales.');
  else {
    const breaking = new Set();
    for (const t of (cat.catalog && cat.catalog.tools) || []) for (const v of t.versions || []) if (v.breaking) breaking.add(t.id + '@' + v.version);
    vt.breaking = breaking;
    vt.staleReasons = new Map(entries.filter((e) => e.kind === 'run' && e.stale).map((e) => [e.id, firstReason(e.stale_reasons)]));
    vt.titles = new Map(entries.filter((e) => e.kind === 'run').map((e) => [e.id, e.title]));
    vt.vintages = vintages;
  }

  // Lineage.
  const lg = $('#lineage');
  if (!lineage) tabError($('#panel-lineage'), lnR, 'The lineage could not be loaded.', 'No se pudo cargar el linaje.');
  else {
    lg.graph = lineage;
    lg.addEventListener('node-select', (ev) => {
      const nd = ev.detail.node;
      openRecord({ ref: nd.id, title: nd.restricted ? 'Restricted record' : nd.label, node: nd, entry: entryById.get(nd.id.slice(nd.id.indexOf(':') + 1)), trigger: ev.detail.trigger });
    });
  }

  renderBasis(basis, entryById, (lineage && lineage.edges) || []);
  if (lessonsOk) renderLessons(lessons);

  buildTabs({
    timeline: entries.length, vintages: vintages.length, basis: basis.length,
    research: researchOk ? listOf(rsR.body, 'findings').length : null,
    lessons: lessonsOk ? lessons.length : null,
    scorecard: card.fail + card.na ? bi(card.fail + card.na + ' fail', card.fail + card.na + ' fallan') : null,
  }, new Set([...(lessonsOk ? [] : ['lessons']), ...(researchOk ? [] : ['research'])]));
  renderResearch(ctx, researchOk ? rsR : null);              // after the tabs exist: the status line, the Research tab and its count
  if (canWriteProject(ctx)) draftUi = mountDraft(ctx, { openRecord });  // wave 5: Write to… beside Research
  ctx.refreshTimeline = () => refreshTimeline(ctx);
  $('#p-body').removeAttribute('hidden');
  const sk = $('#p-skeleton'); if (sk) sk.setAttribute('hidden', '');
  routeHash();
  window.addEventListener('hashchange', routeHash);
  $('#rp-close').addEventListener('click', closePanel);
  const scrim = $('#record-scrim'); if (scrim) scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#record-panel').hasAttribute('hidden')) closePanel(); });

  // ?draft=<id>: reopen a draft note in Write to… (linked from the record panel and the timeline).
  const draftParam = params.get('draft');
  if (draftParam && draftUi) {
    const r = await api('/api/items/' + encodeURIComponent(draftParam));
    if (r.ok && r.body && !(await draftUi.load(r.body))) add($('#p-notices') || $('#p-body'), notice('warn', 'Not a draft.', 'No es un borrador.', 'That record was not written in the Hub.', 'Ese registro no se escribió en el Hub.'));
  }
  // ?doc=<id>: open a document's record (linked from What came in on Today and from Find, which adds &q= so the term is highlighted).
  const docParam = params.get('doc');
  if (docParam) {
    const row = document.querySelector('.hub-tl-item[data-id="' + CSS.escape(docParam) + '"]');
    if (row) { row.classList.add('hilite'); row.scrollIntoView({ block: 'center' }); }
    const e = entryById.get(docParam);
    await openRecord({ ref: 'doc:' + docParam, title: e && e.title, entry: e, trigger: row && row.querySelector('button'), highlight: params.get('q') || null });
  }
  // ?run=<id>: highlight the run in the timeline and open its record (linked from the tool page).
  const runParam = params.get('run');
  if (runParam) {
    const row = document.querySelector('.hub-tl-item[data-id="' + CSS.escape(runParam) + '"]');
    if (row) { row.classList.add('hilite'); row.scrollIntoView({ block: 'center' }); }
    const e = entryById.get(runParam);
    await openRecord({ ref: 'run:' + runParam, title: e && e.title, entry: e, trigger: row && row.querySelector('button') });
  }
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'project') init();
