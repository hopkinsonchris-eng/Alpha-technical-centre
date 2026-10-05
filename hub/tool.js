/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB TOOL PAGE (M07)
   hub/tool.html?id=<tool id>

   Manifest, versions newest first with status, breaking flag and changelog,
   runs grouped by version, the runs still on older versions each with a
   Re-run (wave 7, S36: POST /api/runs/:id/rerun, the server's reason shown
   when it cannot run them) and the owner. An external app's page is not
   shown (wave 7, S37): its runs live in the app until it pushes them.

     GET /api/catalog              tool manifest + changelog releases
     GET /api/tools/:id/resolve    where "Open current" goes (best effort)
     GET /api/runs?job=<id>        the tool's runs
     GET /api/projects             project names for the run links
     POST /api/runs/:id/rerun      replay a run on the current version
   Every string a person reads carries data-en and data-es.
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault, loadCatalog, openTarget, fmtShortDate, LIFECYCLE, KIND, SECTION, RUN_STATUS, armOnOpen, renderCatalog } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const params = new URLSearchParams(location.search);
const toolId = params.get('id');
const bi = (en, es) => ({ en, es: es === undefined ? en : es });
const errMessage = (res) => (res && res.body && res.body.error && res.body.error.message) || '';

/** Semver comparison, the same rule the staleness engine uses. */
export function cmpSemver(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}
const desc = (a, b) => cmpSemver(b, a);

function notice(kind, boldEn, boldEs, en, es) {
  const n = mk('div', 'hub-notice ' + kind);
  add(n, add(mk('span', 'grow'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), mk('span', null, en, es)));
  return n;
}

function failPage(res, source) {
  const st = res ? res.status : 0;
  let t, en, es;
  if (!toolId) { t = bi('No tool selected', 'Ninguna herramienta seleccionada'); en = 'Open a tool from the Tools index.'; es = 'Abra una herramienta desde el índice de herramientas.'; }
  else if (source === 'none') { t = bi('The Vault is unreachable', 'El Vault no es accesible'); en = 'The catalog could not be loaded from the Vault or from the copy kept with the Hub.'; es = 'No se pudo cargar el catálogo desde el Vault ni desde la copia guardada con el Hub.'; showVault(false); }
  else { t = bi('Tool not found', 'Herramienta no encontrada'); en = 'There is no tool "' + toolId + '" in the catalog.'; es = 'No existe la herramienta "' + toolId + '" en el catálogo.'; }
  setText($('#t-title'), t.en, t.es);
  add($('#notices'), notice('bad', t.en + '.', t.es + '.', en, es));
  document.body.setAttribute('data-ready', '1');
}

const list = (parts, en) => {
  if (parts.length <= 1) return parts.join('');
  const and = en ? ' and ' : ' y ';
  return parts.slice(0, -1).join(', ') + and + parts[parts.length - 1];
};

/* ── header, alert, manifest ─────────────────────────────────────────── */

function renderHeader(tool, currentVersion, siteRoot, byId, source) {
  const kind = KIND[tool.kind] || [tool.kind, tool.kind];
  setText($('#t-label'), 'Tool · ' + kind[0], 'Herramienta · ' + kind[1]);
  setText($('#t-title'), tool.name);
  document.title = tool.name + ' — Tool page — Alpha Technical Centre';
  const sub = $('#t-sub');
  sub.textContent = '';
  if (tool.description) add(sub, dv('span', null, tool.description), mk('br'));
  add(sub, mk('span', null, 'Owner', 'Responsable'), document.createTextNode(' '), dv('b', null, tool.owner, { 'data-owner': tool.owner }));

  const act = $('#t-actions');
  act.textContent = '';
  const life = LIFECYCLE[tool.lifecycle] || [tool.lifecycle, tool.lifecycle, 'muted'];
  add(act, mk('span', 'hub-pill ' + life[2], life[0], life[1], { 'data-lifecycle': tool.lifecycle }));
  if (tool.docs) add(act, mk('a', 'btn btn-outline btn-sm', 'Docs', 'Documentación', { href: new URL(tool.docs, siteRoot).href }));
  if (tool.lifecycle !== 'retired') {
    const t = openTarget(tool, byId, siteRoot);
    const a = mk('a', 'btn btn-primary btn-sm', null, null, { href: t.href, 'data-open': tool.id });
    add(a, mk('span', null, 'Open current ', 'Abrir versión actual'), dv('span', null, currentVersion));
    if (t.external) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    add(act, armOnOpen(a));                                   // wave 7 (S13)
    if (source === 'api') {
      api('/api/tools/' + encodeURIComponent(tool.id) + '/resolve').then((r) => { if (r.ok && r.body && r.body.entry) a.setAttribute('href', new URL(r.body.entry, siteRoot).href); });
    }
  }
}

function chips(values) {
  const d = mk('dd', 'chips');
  if (!values || !values.length) add(d, mk('span', 'hub-muted', 'none', 'ninguno'));
  else for (const v of values) add(d, dv('span', 'hub-asset', v));
  return d;
}

function renderManifest(tool) {
  setText($('#t-path'), tool.id);
  const dl = $('#t-manifest');
  dl.textContent = '';
  const row = (en, es, node) => add(dl, mk('dt', null, en, es), node);
  row('id', 'id', dv('dd', 'mono', tool.id));
  row('Name', 'Nombre', dv('dd', null, tool.name));
  row('Owner', 'Responsable', dv('dd', null, tool.owner));
  const life = LIFECYCLE[tool.lifecycle] || [tool.lifecycle, tool.lifecycle, 'muted'];
  row('Lifecycle', 'Ciclo de vida', add(mk('dd'), mk('span', 'hub-pill ' + life[2], life[0], life[1])));
  row('Kind', 'Tipo', dv('dd', 'mono', tool.kind));
  row('Entry', 'Entrada', dv('dd', 'mono', tool.entry));
  row('Produces', 'Produce', chips(tool.produces));
  row('Consumes', 'Consume', chips(tool.consumes));
  const al = mk('dd');
  const entries = Object.entries(tool.aliases || {});
  entries.forEach(([k, v], i) => {
    if (i) add(al, document.createTextNode(' · '));
    add(al, dv('span', 'mono', k), document.createTextNode(' → '), v ? dv('b', null, v) : mk('span', 'hub-muted', 'none', 'ninguno'));
  });
  row('Aliases', 'Alias', al);
}

/* ── run analysis ────────────────────────────────────────────────────── */

/** Counts of active (not superseded) runs per tool version. */
export function activeByVersion(runs) {
  const m = new Map();
  for (const r of runs) if (r.status !== 'superseded') m.set(r.tool_version, (m.get(r.tool_version) || 0) + 1);
  return m;
}

function renderOlder(tool, current, runs, byVer) {
  const host = $('#t-older');
  host.textContent = '';
  const older = [...byVer.entries()].filter(([v]) => cmpSemver(v, current) < 0).sort((a, b) => cmpSemver(b[0], a[0]));
  const n = older.reduce((s, x) => s + x[1], 0);
  const box = mk('div', 'hub-notice ' + (n ? 'bad' : 'ok'), null, null, { 'data-older-count': String(n) });
  if (!n) {
    add(box, add(mk('span', 'grow'), mk('b', null, '0 runs on older versions.', '0 ejecuciones en versiones anteriores.'), document.createTextNode(' '),
      mk('span', null, 'Every active run is on ' + current + '.', 'Todas las ejecuciones activas están en ' + current + '.')));
    return void add(host, box);
  }
  const partsEn = older.map(([v, c]) => c + ' on ' + v), partsEs = older.map(([v, c]) => c + ' en ' + v);
  const oldest = older[older.length - 1][0];
  const brk = (tool.versions || []).filter((v) => v.breaking && cmpSemver(v.version, oldest) > 0 && cmpSemver(v.version, current) <= 0).sort((a, b) => cmpSemver(b.version, a.version))[0];
  const body = add(mk('span', 'grow'),
    mk('b', null, n + (n === 1 ? ' run' : ' runs') + ' on older versions.', n + (n === 1 ? ' ejecución' : ' ejecuciones') + ' en versiones anteriores.'), document.createTextNode(' '),
    mk('span', null, list(partsEn, true) + '.', list(partsEs, false) + '.'));
  if (brk) add(body, document.createTextNode(' '), mk('span', null,
    'Version ' + brk.version + ' is marked breaking, so these runs are not comparable with current and every document citing them is flagged stale. Re-running creates new runs with parents=[old]; nothing is overwritten.',
    'La versión ' + brk.version + ' está marcada como incompatible, así que estas ejecuciones no son comparables con la actual y todo documento que las cite se marca obsoleto. Volver a ejecutar crea ejecuciones nuevas con parents=[antigua]; nada se sobrescribe.'));
  add(box, body);
  const all = mk('button', 'btn btn-outline btn-sm', 'Re-run all ' + n, 'Volver a ejecutar las ' + n, { type: 'button', 'data-action': 'rerun-all' });
  add(box, add(mk('span', 'hub-rerun'), all));
  add(host, box);

  // Wave 7 (S36): each run on an older version, with its own Re-run; the server's reason when it cannot run them.
  const rerunList = mk('ul', 'hub-rerun-list', null, null, { 'data-rerun-list': '' });
  const olderRuns = runs.filter((r) => r.status !== 'superseded' && cmpSemver(r.tool_version, current) < 0).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const reason = mk('div', 'hub-notice warn', null, null, { 'data-rerun-reason': '', hidden: '' });
  const rows = new Map();
  for (const r of olderRuns) {
    const li = mk('li', null, null, null, { 'data-rerun-run': r.id });
    add(li, dv('a', 'hub-inline-link', r.title || r.job || r.id, { href: '/hub/project.html?id=' + encodeURIComponent(r.project_id) + '&run=' + encodeURIComponent(r.id) }),
      dv('span', 'hub-muted', ' · ' + r.tool_version + ' · ' + (r.created_at || '').slice(0, 10)));
    const b = mk('button', 'btn btn-outline btn-sm', 'Re-run', 'Volver a ejecutar', { type: 'button', 'data-action': 'rerun' });
    const st = mk('span', 'hub-rerun-state', null, null, { role: 'status' });
    add(li, document.createTextNode(' '), b, document.createTextNode(' '), st);
    b.addEventListener('click', () => rerunOne(r, { li, b, st }));
    rows.set(r.id, { li, b, st });
    add(rerunList, li);
  }
  add(host, rerunList, reason);

  let stopped = false;
  function stopAll(res) {
    stopped = true;
    reason.textContent = '';
    const msg = errMessage(res);
    add(reason, add(mk('span'), mk('b', null, 'Re-run is not available on this server yet.', 'La re-ejecución aún no está disponible en este servidor.'), document.createTextNode(' '),
      mk('span', null, 'Ask Chris.', 'Pregunte a Chris.'), msg ? dv('span', 'hub-muted', ' (' + msg + ')') : null));
    reason.removeAttribute('hidden');
    all.disabled = true;
    for (const { b } of rows.values()) b.disabled = true;
  }
  /** POST /api/runs/:id/rerun: a 201 links the new run; a 503 is the server saying it cannot run tools, shown once and stopping everything. */
  async function rerunOne(r, { li, b, st }) {
    if (stopped) return 'stop';
    b.disabled = true; st.textContent = '';
    add(st, mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' re-running…', ' re-ejecutando…'));
    const res = await api('/api/runs/' + encodeURIComponent(r.id) + '/rerun', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(120000) });
    st.textContent = '';
    if (res.ok && res.body && res.body.id) {
      b.remove();
      const changes = res.body.delta && Array.isArray(res.body.delta.changes) ? res.body.delta.changes.length : null;
      add(st, mk('a', 'btn btn-primary btn-sm', changes ? 'Open the new run (' + changes + ' changed)' : 'Open the new run', changes ? 'Abrir la nueva ejecución (' + changes + ' cambios)' : 'Abrir la nueva ejecución', { href: '/hub/project.html?id=' + encodeURIComponent(r.project_id) + '&run=' + encodeURIComponent(res.body.id), 'data-rerun-done': res.body.id }));
      li.setAttribute('data-rerun-state', 'done');
      return 'ok';
    }
    if (res.status === 503) { stopAll(res); li.setAttribute('data-rerun-state', 'unavailable'); return 'stop'; }
    b.disabled = false;
    li.setAttribute('data-rerun-state', 'failed');
    add(st, mk('span', 'hub-pill bad', 'not re-run', 'no re-ejecutada'), document.createTextNode(' '), dv('span', 'hub-muted', errMessage(res) || (res.status ? 'HTTP ' + res.status : 'the Vault is unreachable')));
    return 'failed';
  }
  all.addEventListener('click', async () => {
    all.disabled = true;
    for (const r of olderRuns) { if (rows.get(r.id).li.getAttribute('data-rerun-state') === 'done') continue; if ((await rerunOne(r, rows.get(r.id))) === 'stop') return; }
    all.disabled = false;
  });
}

// The tooltip is an attribute, which the shared language toggle does not translate: follow the html lang here.
function followLang() {
  const apply = () => {
    const es = document.documentElement.getAttribute('lang') === 'es';
    for (const el of document.querySelectorAll('[data-title-en]')) el.setAttribute('title', el.getAttribute(es ? 'data-title-es' : 'data-title-en'));
  };
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  apply();
}

function renderBars(versions, current, byVer) {
  const host = $('#t-bars');
  host.textContent = '';
  const all = new Set([...versions.map((v) => v.version), ...byVer.keys()]);
  const list_ = [...all].sort(desc).filter((v) => byVer.get(v) || v === current);
  const max = Math.max(1, ...[...byVer.values()]);
  const total = [...byVer.values()].reduce((s, x) => s + x, 0);
  const oldN = [...byVer.entries()].filter(([v]) => cmpSemver(v, current) < 0).reduce((s, x) => s + x[1], 0);
  const wrap = mk('div', 'hub-runbars');
  for (const v of list_) {
    const c = byVer.get(v) || 0, old = cmpSemver(v, current) < 0;
    const bar = mk('div', 'hub-bar' + (old ? ' old' : ''));
    const fill = document.createElement('i'); fill.style.width = Math.round((c / max) * 100) + '%'; add(bar, fill);
    add(wrap, add(mk('div', 'hub-runbar', null, null, { 'data-version': v }), dv('b', null, v), bar, dv('span', 'num', String(c))));
  }
  add(host, wrap);
  const pct = total ? Math.round((oldN / total) * 100) : 0;
  add(host, mk('p', 'hub-note-s', total + ' active runs · ' + oldN + ' (' + pct + '%) on versions older than current.', total + ' ejecuciones activas · ' + oldN + ' (' + pct + '%) en versiones anteriores a la actual.'));
}

/* ── versions and changelog ──────────────────────────────────────────── */

const V_STATUS = { approved: ['Approved', 'Aprobada', 'ok'], reviewed: ['Reviewed', 'Revisada', 'info'], draft: ['Draft', 'Borrador', 'muted'], deprecated: ['Deprecated', 'Obsoleta', 'bad'] };

function firstLine(rel) {
  if (!rel) return '';
  for (const k of Object.keys(rel.sections || {})) if ((rel.sections[k] || []).length) return rel.sections[k][0];
  return '';
}

function renderVersions(tool, byVer) {
  const host = $('#t-versions');
  host.textContent = '';
  const versions = (tool.versions || []).slice().sort((a, b) => cmpSemver(b.version, a.version));
  const rel = new Map((tool.releases || []).map((r) => [r.version, r]));
  const table = mk('table', 'hub-table', null, null, { 'data-versions': '' });
  add(table, mk('caption', 'sr-only', 'Versions, newest first', 'Versiones, la más reciente primero'));
  const cols = [['Version', 'Versión'], ['Released', 'Publicada'], ['Commit', 'Commit'], ['Status', 'Estado'], ['Alias', 'Alias'], ['Breaking', 'Incompatible'], ['Modules', 'Módulos'], ['Active runs', 'Ejecuciones activas'], ['Notes', 'Notas']];
  add(table, add(mk('thead'), add(mk('tr'), ...cols.map((c) => mk('th', null, c[0], c[1], { scope: 'col' })))));
  const tb = mk('tbody');
  for (const v of versions) {
    const tr = mk('tr', null, null, null, { 'data-version-row': v.version });
    const st = V_STATUS[v.status] || [v.status || '—', v.status || '—', 'muted'];
    const aliases = Object.entries(tool.aliases || {}).filter(([, t]) => t === v.version).map(([k]) => k);
    const al = mk('td');
    if (aliases.length) for (const a of aliases) add(al, dv('span', 'hub-pill ' + (a === 'current' ? 'gold' : 'ghost'), a), document.createTextNode(' '));
    else add(al, dv('span', 'hub-muted', '—'));
    add(tr,
      add(mk('td'), dv('b', null, v.version)),
      dv('td', 'nowrap', v.released_at),
      dv('td', 'mono', v.commit),
      add(mk('td'), mk('span', 'hub-pill ' + st[2], st[0], st[1])),
      al,
      add(mk('td'), v.breaking ? mk('span', 'hub-pill bad', 'Breaking', 'Incompatible') : mk('span', 'hub-pill ghost', 'No', 'No')),
      dv('td', 'mono wrap', (v.modules || []).join(', ')),
      dv('td', 'num', String(byVer.get(v.version) || 0)),
      dv('td', 'notes', v.notes || firstLine(rel.get(v.version)), { 'data-source-text': 'notes' }));
    add(tb, tr);
  }
  add(table, tb);
  add(host, table);
}

function renderChangelog(tool) {
  const host = $('#t-changelog');
  host.textContent = '';
  host.setAttribute('data-source-text', 'changelog');   // the tool's own release notes, quoted verbatim
  const byV = new Map((tool.versions || []).map((v) => [v.version, v]));
  const rels = (tool.releases || []).filter((r) => r && r.version !== 'Unreleased' && (Object.keys(r.sections || {}).length || r.date));
  if (!rels.length) return void add(host, mk('p', 'hub-muted', 'No changelog entries.', 'Sin entradas en el registro de cambios.'));
  for (const r of rels) {
    const v = byV.get(r.version);
    const h = mk('h4', null, null, null, { 'data-release': r.version });
    add(h, dv('span', null, '[' + r.version + ']' + (r.date ? ' – ' + r.date : '')));
    if (v && v.breaking) add(h, mk('span', 'hub-pill bad', 'Breaking', 'Incompatible'));
    if (v && v.commit) add(h, dv('span', 'hub-muted mono', v.commit));
    add(host, h);
    for (const sec of Object.keys(r.sections || {})) {
      add(host, mk('h5', null, sec, SECTION[sec] || sec));
      const ul = mk('ul');
      for (const line of r.sections[sec]) add(ul, dv('li', null, line));
      add(host, ul);
    }
  }
}

/* ── runs grouped by version ─────────────────────────────────────────── */

const MAX_ROWS = 60;

function renderRuns(tool, current, runs, projects, note) {
  const host = $('#t-runs');
  host.textContent = '';
  if (note) return void add(host, add(mk('div', 'card'), mk('div', 'hub-empty', note.en, note.es)));
  if (!runs.length) return void add(host, add(mk('div', 'card'), mk('div', 'hub-empty', 'No runs saved with this tool yet.', 'Aún no hay ejecuciones guardadas con esta herramienta.')));
  const groups = new Map();
  for (const r of runs) (groups.get(r.tool_version) || groups.set(r.tool_version, []).get(r.tool_version)).push(r);
  const pname = new Map(projects.map((p) => [p.id, p.name || p.id]));
  for (const ver of [...groups.keys()].sort(desc)) {
    const rs = groups.get(ver).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const old = cmpSemver(ver, current) < 0;
    const card = mk('article', 'card hub-vgroup', null, null, { 'data-version-group': ver });
    const head = mk('div', 'hub-vgroup-head');
    add(head, dv('b', null, ver),
      ver === current ? mk('span', 'hub-pill gold', 'current', 'actual') : old ? mk('span', 'hub-pill bad', 'older than current', 'anterior a la actual') : mk('span', 'hub-pill ghost', 'newer than current', 'posterior a la actual'),
      mk('span', 'hub-muted', rs.length + (rs.length === 1 ? ' run' : ' runs'), rs.length + (rs.length === 1 ? ' ejecución' : ' ejecuciones')));
    add(card, head);
    const wrap = mk('div', 'hub-table-wrap', null, null, { tabindex: '0', role: 'region', 'aria-label': 'Runs on ' + ver });
    const table = mk('table', 'hub-table');
    add(table, mk('caption', 'sr-only', 'Runs on version ' + ver, 'Ejecuciones en la versión ' + ver));
    add(table, add(mk('thead'), add(mk('tr'), ...[['Run', 'Ejecución'], ['Project', 'Proyecto'], ['Author', 'Autor'], ['Status', 'Estado'], ['Saved', 'Guardada']].map((c) => mk('th', null, c[0], c[1], { scope: 'col' })))));
    const tb = mk('tbody');
    for (const r of rs.slice(0, MAX_ROWS)) {
      const tr = mk('tr', old && r.status !== 'superseded' ? 'older' : '', null, null, { 'data-run-id': r.id });
      const st = RUN_STATUS[r.status] || [r.status, r.status, 'muted'];
      const link = dv('a', 'hub-inline-link', r.title || r.job || r.id, { href: '/hub/project.html?id=' + encodeURIComponent(r.project_id) + '&run=' + encodeURIComponent(r.id), 'data-run-link': r.id });
      const proj = r.project_id ? dv('a', 'hub-inline-link', pname.get(r.project_id) || r.project_id, { href: '/hub/project.html?id=' + encodeURIComponent(r.project_id) }) : dv('span', null, '—');
      add(tr, add(mk('td'), link), add(mk('td'), proj), dv('td', null, r.author), add(mk('td'), mk('span', 'hub-pill ' + st[2], st[0], st[1])), dv('td', 'nowrap', (r.created_at || '').slice(0, 10)));
      add(tb, tr);
    }
    add(table, tb);
    add(wrap, table);
    add(card, wrap);
    if (rs.length > MAX_ROWS) add(card, mk('p', 'hub-more hub-muted', (rs.length - MAX_ROWS) + ' more not shown', (rs.length - MAX_ROWS) + ' más no mostradas'));
    add(host, card);
  }
}

/* ── load ────────────────────────────────────────────────────────────── */

/** Wave 7 PR2 (R4): without a tool id the page is the Tools index, the catalog that used to sit at the foot of Today. */
async function renderToolsIndex(person) {
  setText($('#t-label'), 'Tools', 'Herramientas');
  setText($('#t-title'), 'Tools', 'Herramientas');
  document.title = 'Tools — Alpha Technical Centre';
  const crumb = $('.hub-crumb b'); if (crumb) setText(crumb, 'Tools', 'Herramientas');
  const sub = $('#t-sub'); if (sub) setText(sub, 'Every tool the firm runs, with its current version and what changed. Open one here, or from a project file with Open in tool.', 'Cada herramienta que usa la firma, con su versión actual y lo que cambió. Ábrala aquí, o desde la ficha de un proyecto con Abrir en herramienta.');
  const sec = $('#sec-tools'); if (sec) sec.removeAttribute('hidden');
  await renderCatalog(person);
  document.body.setAttribute('data-ready', '1');
}

async function init() {
  const person = await showSession();
  if (!toolId) return renderToolsIndex(person);
  const { catalog, source } = await loadCatalog();
  if (!catalog) return failPage(null, 'none');
  const byId = new Map(catalog.tools.map((t) => [t.id, t]));
  const tool = byId.get(toolId);
  if (!tool) return failPage(null, source);
  showVault(source === 'api');
  if (source !== 'api') add($('#notices'), notice('warn', 'The Vault is unreachable.', 'El Vault no es accesible.', 'Showing the catalog kept with the Hub; runs are not available.', 'Se muestra el catálogo guardado con el Hub; las ejecuciones no están disponibles.'));

  const siteRoot = new URL('../', location.href);
  const versions = tool.versions || [];
  const cur = tool.aliases && tool.aliases.current;
  const current = versions.some((v) => v.version === cur) ? cur : (versions.slice().sort((a, b) => cmpSemver(b.version, a.version))[0] || {}).version || '—';

  // Wave 7 (S37, D65): an external app keeps its runs until it pushes them; its page here would be empty tables and a placeholder version.
  if (tool.kind === 'external-app') {
    renderHeader(tool, current, siteRoot, byId, source);
    add($('#notices'), notice('warn', tool.name + ' runs in its own app.', tool.name + ' se ejecuta en su propia app.',
      'Its runs are not held in the Vault yet; open the app from the catalog or the button above.', 'Sus ejecuciones aún no se guardan en el Vault; abra la app desde el catálogo o con el botón de arriba.'));
    document.body.setAttribute('data-ready', '1');
    return;
  }

  let runs = [], runsNote = null, projects = [];
  if (source === 'api') {
    const [rr, pr] = await Promise.all([api('/api/runs?job=' + encodeURIComponent(toolId) + '&limit=1000'), api('/api/projects')]);
    if (rr.ok) runs = listOf(rr.body, 'runs', 'items');
    else runsNote = bi('Runs could not be loaded' + (rr.status ? ' (' + rr.status + (errMessage(rr) ? ': ' + errMessage(rr) : '') + ')' : '') + '.', 'No se pudieron cargar las ejecuciones' + (rr.status ? ' (' + rr.status + ')' : '') + '.');
    if (pr.ok) projects = listOf(pr.body, 'projects', 'items');
  } else runsNote = bi('Runs are available when the Vault is reachable.', 'Las ejecuciones están disponibles cuando el Vault es accesible.');

  const byVer = activeByVersion(runs);
  renderHeader(tool, current, siteRoot, byId, source);
  if (!runsNote) renderOlder(tool, current, runs, byVer);
  renderManifest(tool);
  renderBars(versions, current, byVer);
  renderVersions(tool, byVer);
  renderChangelog(tool);
  renderRuns(tool, current, runs, projects, runsNote);
  followLang();
  $('#t-body').removeAttribute('hidden');
  document.body.setAttribute('data-ready', '1');
}

if (document.body && document.body.getAttribute('data-page') === 'tool') init();
