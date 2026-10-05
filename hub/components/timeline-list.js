/* ============================================================
   <timeline-list> (M07). The project timeline: runs and documents,
   newest first, one row per record, a type icon, a filter by type and a
   stale badge with the first stale reason inline.

     const tl = document.querySelector('timeline-list');
     tl.entries = timeline.entries;             // GET /api/projects/:id/timeline
     tl.addEventListener('record-select', (e) => e.detail.entry);

   Wave 7 PR2 (R6): a row is one tappable block at least 44 px tall (the
   title button's hit area is stretched over the row), the date sits on one
   line ("5 Oct · 13:54"), the type is a small mono prefix rather than a pill,
   and every kind carries a status pill on the right. A "Documents" filter
   joins the chips so the stateline's docs count has a place to land.

   Wave 7 PR3 (H2, W7-AC13): every entry carries a class, foreground or
   background, from the Vault (`entry.class`) or, on an older Vault, from the
   rules in docs/vault-hub/wave7/03-data-hierarchy.md §4 (superseded runs,
   research findings and dossiers, history mail, older stage changes). The
   list shows Foreground by default; the background rows stay in the list in
   date order but hidden behind one "Background (n)" toggle at the foot, so
   a row's address, count and order never change. The type prefix reads the
   record's `kind` (draft, research, dossier, basis note…) when the Vault
   gives one, else the type.
   Plain custom element, light DOM, every text carries data-en and data-es.
   ============================================================ */
import { mk, dv, add, RUN_STATUS } from '../hub.js';
import { firstReason } from './stale-badge.js';
import './stale-badge.js';

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
export const ICONS = {
  stage: svg('<path d="M5 21V4h11l-2 4 2 4H5"/>'),
  run: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  letter: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  email: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  spreadsheet: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  paper: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/>'),
  invoice: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  note: svg('<path d="M5 4h14v12l-5 5H5z"/><path d="M14 21v-5h5M8 9h8M8 13h4"/>'),
  reference: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
  other: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
};
const WARN = svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>');

/** Filter buckets, in the order of the mockup chips; "Documents" (wave 7) is every record that is not a run or a stage change. */
export const TYPE_FILTERS = [
  ['all', 'All', 'Todo'], ['run', 'Runs', 'Ejecuciones'], ['docs', 'Documents', 'Documentos'], ['letter', 'Letters', 'Cartas'], ['email', 'Emails', 'Correos'],
  ['spreadsheet', 'Spreadsheets', 'Hojas de cálculo'], ['paper', 'Papers', 'Artículos'], ['invoice', 'Invoices', 'Facturas'],
  ['other', 'Other', 'Otros'], ['stale', 'Stale only', 'Solo obsoletos'],
];
const TYPE_LABEL = {
  stage: ['Stage', 'Etapa'], run: ['Run', 'Ejecución'], letter: ['Letter', 'Carta'], email: ['Email', 'Correo'], spreadsheet: ['Spreadsheet', 'Hoja de cálculo'],
  paper: ['Paper', 'Artículo'], invoice: ['Invoice', 'Factura'], note: ['Note', 'Nota'], reference: ['Reference set', 'Conjunto de referencia'],
};

/** Wave 7 PR3: the record's own kind (the items.kind column), as the type prefix reads it. */
const KIND_LABEL = {
  draft: ['Draft', 'Borrador'], research: ['Research', 'Investigación'], dossier: ['Dossier', 'Dosier'], basis: ['Basis note', 'Nota de bases'],
  'calc-note': ['Calc note', 'Nota de cálculo'], paper: ['Paper', 'Artículo'], 'reference-set': ['Reference set', 'Conjunto de referencia'],
  history: ['History', 'Histórico'], bulk: ['Bulk', 'Masivo'],
};
const STRUCTURAL_KINDS = new Set(['run', 'item', 'stage']);
/** The record kind of an entry: `record_kind`, a `kind` that is not the structural run/item/stage, or extracted.kind; null when the Vault gives none. */
export function recordKind(e) {
  if (!e) return null;
  if (typeof e.record_kind === 'string' && e.record_kind) return e.record_kind;
  if (typeof e.kind === 'string' && e.kind && !STRUCTURAL_KINDS.has(e.kind)) return e.kind;
  if (e.extracted && typeof e.extracted.kind === 'string' && e.extracted.kind) return e.extracted.kind;
  return null;
}
/** foreground | background: the Vault's class when given, else §4's rules (superseded runs, research and dossiers, history, older stage changes). */
export function classOf(e) {
  if (!e) return 'foreground';
  if (e.class === 'background' || e.class === 'foreground') return e.class;
  if (e.kind === 'run' && (e.status === 'superseded' || e.superseded_by)) return 'background';
  const rk = recordKind(e);
  if (rk === 'research' || rk === 'dossier' || rk === 'history' || rk === 'bulk') return 'background';
  if (e.history === true || (e.extracted && e.extracted.history === true)) return 'background';
  return 'foreground';
}

/** Icon / label kind of a timeline entry. */
export function iconKind(e) {
  if (e.kind === 'run') return 'run';
  if (e.kind === 'stage') return 'stage';          // wave 2: a stage change of the opportunity
  const t = e.type;
  if (t === 'letter' || t === 'email' || t === 'paper' || t === 'invoice' || t === 'note') return t;
  if (t === 'spreadsheet') return 'spreadsheet';
  if (t === 'reference-set' || t === 'feed-snapshot' || t === 'firm-asset') return 'reference';
  return 'other';
}
/** Which filter chip an entry belongs to. */
export function filterKind(e) {
  const k = iconKind(e);
  return k === 'note' || k === 'reference' || k === 'stage' ? 'other' : k;
}

const pad = (n) => String(n).padStart(2, '0');
/** "5 Oct · 13:54" on one line; the year travels in the title. */
function stamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const hm = pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  return {
    en: d.toLocaleDateString('en-GB', o) + ' · ' + hm, es: d.toLocaleDateString('es-ES', o) + ' · ' + hm,
    title: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ' ' + hm + ' UTC',
  };
}
const byNewest = (a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1);

function icon(kind, stale) {
  const s = document.createElement('span');
  s.className = 'hub-tl-ico ' + kind + (stale ? ' stale' : '');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('data-icon', kind);
  s.innerHTML = ICONS[kind]; // static, trusted markup defined above
  return s;
}

export class TimelineList extends HTMLElement {
  constructor() { super(); this._entries = []; this._filter = 'all'; this._built = false; this._showBackground = false; }
  set entries(v) { this._entries = Array.isArray(v) ? v.slice().sort(byNewest) : []; if (this.isConnected) this.render(); }
  get entries() { return this._entries; }
  get filter() { return this._filter; }
  set filter(v) { this._filter = v; if (this._built) this.renderList(); }
  /** Wave 7 PR3: whether the background rows are shown (false by default; the toggle at the foot flips it). */
  get showBackground() { return this._showBackground; }
  set showBackground(v) { this._showBackground = !!v; if (this._built) this.renderList(); }
  connectedCallback() { this.render(); }

  render() {
    this.textContent = '';
    const head = mk('div', 'hub-card-head hub-tl-head');
    const chips = mk('div', 'hub-chips', null, null, { role: 'group', 'aria-label': 'Filter by type' });
    for (const [key, en, es] of TYPE_FILTERS) {
      const b = mk('button', 'hub-chip', en, es, { type: 'button', 'data-filter': key, 'aria-pressed': String(this._filter === key) });
      b.addEventListener('click', () => { this._filter = key; this.renderList(); });
      add(chips, b);
    }
    this._count = mk('span', 'hub-muted hub-tl-count');
    add(head, chips, this._count);
    this._list = mk('ol', 'hub-tl');
    add(this, head, this._list);
    this._built = true;
    this.renderList();
  }

  visible() {
    const f = this._filter;
    return this._entries.filter((e) => (f === 'all' ? true : f === 'stale' ? !!e.stale : f === 'docs' ? e.kind !== 'run' && e.kind !== 'stage' : filterKind(e) === f));
  }

  renderList() {
    for (const b of this.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === this._filter));
    const rows = this.visible();
    this._list.textContent = '';
    const n = rows.length, m = this._entries.length;
    const c = this._count;
    c.setAttribute('data-en', n + ' of ' + m + ' records · newest first');
    c.setAttribute('data-es', n + ' de ' + m + ' registros · más recientes primero');
    c.textContent = document.documentElement.getAttribute('lang') === 'es' ? c.getAttribute('data-es') : c.getAttribute('data-en');
    if (!rows.length) {
      const li = mk('li', 'hub-empty', 'No records match this filter.', 'Ningún registro coincide con este filtro.');
      return void add(this._list, li);
    }
    // Wave 7 PR3 (H2): foreground rows show; background rows stay in place, hidden until the toggle at the foot opens them.
    let bg = 0;
    for (const e of rows) {
      const li = this.row(e);
      if (li.getAttribute('data-class') === 'background') { bg++; if (!this._showBackground) li.setAttribute('hidden', ''); }
      add(this._list, li);
    }
    this.setAttribute('data-background', String(bg));
    if (bg) {
      const foot = mk('li', 'hub-tl-bg-row', null, null, { 'data-background-row': '' });
      const b = mk('button', 'hub-chip hub-tl-bg-toggle', null, null, { type: 'button', 'data-background-toggle': '', 'aria-expanded': String(this._showBackground) });
      add(b, mk('span', 'hub-tl-bg-caret', this._showBackground ? '▾' : '▸', this._showBackground ? '▾' : '▸', { 'aria-hidden': 'true' }), document.createTextNode(' '),
        mk('span', null, 'Background (' + bg + ')', 'Segundo plano (' + bg + ')'));
      b.addEventListener('click', () => { this._showBackground = !this._showBackground; this.renderList(); });
      add(foot, b, mk('span', 'hub-muted hub-tl-bg-note', 'superseded runs, research findings, dossiers, history mail and sent drafts', 'ejecuciones reemplazadas, hallazgos de investigación, dosieres, correo histórico y borradores enviados'));
      add(this._list, foot);
    }
  }

  row(e) {
    const kind = iconKind(e), stale = !!e.stale, cls = classOf(e), rk = recordKind(e);
    const li = mk('li', 'hub-tl-item' + (stale ? ' is-stale' : '') + (cls === 'background' ? ' is-background' : ''), null, null, { 'data-ref': e.ref || (e.kind === 'run' ? 'run:' : 'doc:') + e.id, 'data-id': e.id, 'data-kind': e.kind, 'data-icon': kind, 'data-stale': String(stale), 'data-class': cls, ...(rk ? { 'data-record-kind': rk } : {}) });
    const st = stamp(e.at);
    const date = mk('div', 'hub-tl-date');
    if (st) { add(date, mk('span', null, st.en, st.es)); date.setAttribute('title', st.title); } else add(date, dv('span', null, '—'));
    add(li, date, icon(kind, stale));

    const body = mk('div', 'hub-tl-body');
    // The type prefix: the record's kind when the Vault gives one (wave 7 PR3), else the type.
    const kl = rk && e.kind !== 'run' && e.kind !== 'stage' ? (KIND_LABEL[rk] || [rk.replace(/[-_]/g, ' '), rk.replace(/[-_]/g, ' ')]) : null;
    const lab = kl || TYPE_LABEL[kind];
    const type = lab ? mk('span', 'hub-tl-type mono', lab[0].toLowerCase(), lab[1].toLowerCase(), { 'data-type': kind, ...(kl ? { 'data-kind-label': rk } : {}) }) : dv('span', 'hub-tl-type mono', e.type, { 'data-type': kind });
    if (e.kind === 'stage') {
      // A stage change has no record to open: the row states it.
      add(body, add(mk('span', 'hub-tl-title hub-tl-stage'), type, document.createTextNode(' '), mk('span', null, 'Stage: ', 'Etapa: '), dv('b', null, e.title),
        e.from ? add(mk('span', 'hub-muted'), mk('span', null, ' · from ' + e.from, ' · desde ' + e.from)) : null));
      if (e.by) add(body, add(mk('div', 'hub-tl-meta'), mk('span', null, 'by ' + e.by, 'por ' + e.by)));
      const side = mk('div', 'hub-tl-side');
      add(side, mk('span', 'hub-pill info', 'Stage', 'Etapa', { 'data-status': 'stage' }));
      add(li, body, side);
      return li;
    }
    const line = mk('div', 'hub-tl-line');
    const title = dv('button', 'hub-tl-title', e.title || e.job || e.id, { type: 'button' });
    title.addEventListener('click', () => this.dispatchEvent(new CustomEvent('record-select', { bubbles: true, detail: { entry: e, ref: li.getAttribute('data-ref'), trigger: title } })));
    add(line, type, title);
    add(body, line);

    const meta = mk('div', 'hub-tl-meta', null, null);
    if (e.kind === 'run') {
      add(meta, dv('span', 'mono', (e.job || '—') + (e.tool_version ? '@' + e.tool_version : '')));
      if (e.superseded_by) add(meta, mk('span', null, 'superseded', 'reemplazada'));
      if (e.supersedes) add(meta, mk('span', null, 'supersedes an earlier run', 'reemplaza una ejecución anterior'));
    } else {
      if (e.reference_no) add(meta, dv('span', 'mono', e.reference_no));
      if (e.version && e.version > 1) add(meta, dv('span', null, 'v' + e.version));
      if (e.sent) add(meta, mk('span', 'hub-pill ok', 'sent to ' + e.sent.organisation, 'enviado a ' + e.sent.organisation, { 'data-sent': '' }));
    }
    if (meta.childNodes.length) add(body, meta);

    if (stale) {
      const why = firstReason(e.stale_reasons);
      const extra = Array.isArray(e.stale_reasons) ? e.stale_reasons.length - 1 : 0;
      const w = mk('div', 'hub-tl-why');
      w.insertAdjacentHTML('afterbegin', WARN);
      add(w, mk('b', null, 'Stale:', 'Obsoleto:'), document.createTextNode(' '), why ? dv('span', 'why-text', why) : mk('span', 'why-text', 'no reason recorded', 'sin motivo registrado'));
      if (extra > 0) add(w, document.createTextNode(' '), mk('span', 'hub-muted', '+' + extra + ' more', '+' + extra + ' más'));
      add(body, w);
    }
    add(li, body);

    // The right-hand pill: the run's status, a sent document's dispatch, else the document's version.
    const side = mk('div', 'hub-tl-side');
    if (stale) { const b = document.createElement('stale-badge'); b.reasons = e.stale_reasons; add(side, b); }
    if (e.kind === 'run' && e.status) {
      const s = RUN_STATUS[e.status] || [e.status, e.status, 'muted'];
      add(side, mk('span', 'hub-pill ' + s[2], s[0], s[1], { 'data-status': e.status }));
    } else if (e.kind !== 'run') {
      if (e.sent) add(side, mk('span', 'hub-pill ok', 'Sent', 'Enviado', { 'data-status': 'sent' }));
      else add(side, dv('span', 'hub-pill muted', 'v' + (e.version || 1), { 'data-status': 'filed' }));
    }
    add(li, side);
    return li;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('timeline-list')) customElements.define('timeline-list', TimelineList);
