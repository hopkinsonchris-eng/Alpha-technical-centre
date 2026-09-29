/* ============================================================
   <timeline-list> (M07). The project timeline: runs and documents,
   newest first, one row per record, a type icon, a filter by type and a
   stale badge with the first stale reason inline.

     const tl = document.querySelector('timeline-list');
     tl.entries = timeline.entries;             // GET /api/projects/:id/timeline
     tl.addEventListener('record-select', (e) => e.detail.entry);

   Plain custom element, light DOM, every text carries data-en and data-es.
   ============================================================ */
import { mk, dv, add, RUN_STATUS } from '../hub.js';
import { firstReason } from './stale-badge.js';
import './stale-badge.js';

const svg = (d) => '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
export const ICONS = {
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

/** Filter buckets, in the order of the mockup chips. */
export const TYPE_FILTERS = [
  ['all', 'All', 'Todo'], ['run', 'Runs', 'Ejecuciones'], ['letter', 'Letters', 'Cartas'], ['email', 'Emails', 'Correos'],
  ['spreadsheet', 'Spreadsheets', 'Hojas de cálculo'], ['paper', 'Papers', 'Artículos'], ['invoice', 'Invoices', 'Facturas'],
  ['other', 'Other', 'Otros'], ['stale', 'Stale only', 'Solo obsoletos'],
];
const TYPE_LABEL = {
  run: ['Run', 'Ejecución'], letter: ['Letter', 'Carta'], email: ['Email', 'Correo'], spreadsheet: ['Spreadsheet', 'Hoja de cálculo'],
  paper: ['Paper', 'Artículo'], invoice: ['Invoice', 'Factura'], note: ['Note', 'Nota'], reference: ['Reference set', 'Conjunto de referencia'],
};

/** Icon / label kind of a timeline entry. */
export function iconKind(e) {
  if (e.kind === 'run') return 'run';
  const t = e.type;
  if (t === 'letter' || t === 'email' || t === 'paper' || t === 'invoice' || t === 'note') return t;
  if (t === 'spreadsheet') return 'spreadsheet';
  if (t === 'reference-set' || t === 'feed-snapshot' || t === 'firm-asset') return 'reference';
  return 'other';
}
/** Which filter chip an entry belongs to. */
export function filterKind(e) {
  const k = iconKind(e);
  return k === 'note' || k === 'reference' ? 'other' : k;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return {
    en: d.toLocaleDateString('en-GB', o), es: d.toLocaleDateString('es-ES', o),
    tail: d.getUTCFullYear() + ' · ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()),
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
  constructor() { super(); this._entries = []; this._filter = 'all'; this._built = false; }
  set entries(v) { this._entries = Array.isArray(v) ? v.slice().sort(byNewest) : []; if (this.isConnected) this.render(); }
  get entries() { return this._entries; }
  get filter() { return this._filter; }
  set filter(v) { this._filter = v; if (this._built) this.renderList(); }
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
    return this._entries.filter((e) => (f === 'all' ? true : f === 'stale' ? !!e.stale : filterKind(e) === f));
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
    for (const e of rows) add(this._list, this.row(e));
  }

  row(e) {
    const kind = iconKind(e), stale = !!e.stale;
    const li = mk('li', 'hub-tl-item' + (stale ? ' is-stale' : ''), null, null, { 'data-ref': e.ref || (e.kind === 'run' ? 'run:' : 'doc:') + e.id, 'data-id': e.id, 'data-kind': e.kind, 'data-icon': kind, 'data-stale': String(stale) });
    const st = stamp(e.at);
    const date = mk('div', 'hub-tl-date');
    if (st) add(date, mk('b', null, st.en, st.es), dv('span', null, st.tail)); else add(date, dv('b', null, '—'));
    add(li, date, icon(kind, stale));

    const body = mk('div', 'hub-tl-body');
    const title = dv('button', 'hub-tl-title', e.title || e.job || e.id, { type: 'button' });
    title.addEventListener('click', () => this.dispatchEvent(new CustomEvent('record-select', { bubbles: true, detail: { entry: e, ref: li.getAttribute('data-ref'), trigger: title } })));
    add(body, title);

    const lab = TYPE_LABEL[kind];
    const meta = mk('div', 'hub-tl-meta', null, null);
    add(meta, lab ? mk('span', 'hub-kind', lab[0], lab[1]) : dv('span', 'hub-kind', e.type));
    if (e.kind === 'run') {
      add(meta, dv('span', 'mono', (e.job || '—') + (e.tool_version ? '@' + e.tool_version : '')));
      if (e.superseded_by) add(meta, mk('span', null, 'superseded', 'reemplazada'));
      if (e.supersedes) add(meta, mk('span', null, 'supersedes an earlier run', 'reemplaza una ejecución anterior'));
    } else {
      if (e.reference_no) add(meta, dv('span', 'mono', e.reference_no));
      if (e.version && e.version > 1) add(meta, dv('span', null, 'v' + e.version));
    }
    add(body, meta);

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

    const side = mk('div', 'hub-tl-side');
    if (stale) { const b = document.createElement('stale-badge'); b.reasons = e.stale_reasons; add(side, b); }
    if (e.kind === 'run' && e.status) {
      const s = RUN_STATUS[e.status] || [e.status, e.status, 'muted'];
      add(side, mk('span', 'hub-pill ' + s[2], s[0], s[1], { 'data-status': e.status }));
    }
    add(li, side);
    return li;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('timeline-list')) customElements.define('timeline-list', TimelineList);
