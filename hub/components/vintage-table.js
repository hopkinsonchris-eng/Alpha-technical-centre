/* ============================================================
   <vintage-table> (M07). One row per final evaluation run (a "vintage"):
   date, tool@version, each headline output, method if present, the delta
   against the previous vintage of the same job and the reason.

     const t = document.querySelector('vintage-table');
     t.breaking = new Set(['opportunity-register@2.0.0']);   // job@version marked breaking
     t.staleReasons = new Map([[runId, 'reason text']]);     // from the timeline
     t.titles = new Map([[runId, 'Run title']]);             // to name a superseder
     t.vintages = vintages;                                  // GET /api/projects/:id/vintages

   The API already returns `deltas`; when it is missing the table computes the
   same numbers (computeDeltas) from `outputs` and the previous vintage of the job.
   ============================================================ */
import { mk, dv, add, num, RUN_STATUS } from '../hub.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Same rules as the API: per output key, previous, current, delta and delta_pct (2 dp) when both are numbers. */
export function computeDeltas(prev, cur) {
  const out = {};
  if (!prev) return out;
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur || {})]);
  for (const k of keys) {
    const a = prev[k] && prev[k].value, b = cur && cur[k] && cur[k].value;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const d = isNum(a) && isNum(b) ? b - a : null;
    out[k] = { previous: a === undefined ? null : a, current: b === undefined ? null : b, delta: d, delta_pct: d !== null && a !== 0 ? Math.round((d / Math.abs(a)) * 10000) / 100 : null };
  }
  return out;
}

/** Vintages oldest-to-newest per job, each given its number, previous run and deltas. Input order is not assumed. */
export function annotate(vintages) {
  const asc = vintages.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const lastByJob = new Map(), count = new Map();
  const info = new Map();
  for (const v of asc) {
    const prev = lastByJob.get(v.job) || null;
    const n = (count.get(v.job) || 0) + 1;
    count.set(v.job, n); lastByJob.set(v.job, v);
    const deltas = v.deltas && typeof v.deltas === 'object' ? v.deltas : computeDeltas(prev && prev.outputs, v.outputs);
    info.set(v.run_id, { number: n, previous: prev, deltas });
  }
  return info;
}

/** Numeric headline columns (union over the vintages, first-seen order); `method` is shown separately. */
export function outputColumns(vintages) {
  const cols = [], seen = new Map();
  for (const v of vintages) for (const k of Object.keys(v.outputs || {})) {
    if (k === 'method') continue;
    const o = v.outputs[k];
    if (!seen.has(k)) { const c = { key: k, label: k.replace(/_/g, ' '), unit: (o && o.unit) || '' }; seen.set(k, c); cols.push(c); }
    else if (!seen.get(k).unit && o && o.unit) seen.get(k).unit = o.unit;
  }
  return cols;
}

/** "−8.2%" with a true minus sign, one decimal. */
export function fmtPct(p) {
  const r = Math.round(Math.abs(p) * 10) / 10;
  return (p < 0 && r !== 0 ? '−' : p > 0 && r !== 0 ? '+' : '') + r.toFixed(1) + '%';
}

export class VintageTable extends HTMLElement {
  constructor() { super(); this._v = []; this.breaking = new Set(); this.staleReasons = new Map(); this.titles = new Map(); }
  set vintages(v) { this._v = Array.isArray(v) ? v : []; if (this.isConnected) this.render(); }
  get vintages() { return this._v; }
  connectedCallback() { this.render(); }

  render() {
    this.textContent = '';
    if (!this._v.length) { add(this, mk('div', 'hub-empty', 'No final evaluation runs yet.', 'Aún no hay ejecuciones de evaluación finales.')); return; }
    const rows = this._v.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    const info = annotate(this._v);
    const cols = outputColumns(rows);
    const hasMethod = rows.some((v) => v.outputs && v.outputs.method && v.outputs.method.value != null);
    const wrap = mk('div', 'hub-table-wrap', null, null, { tabindex: '0', role: 'region', 'aria-label': 'Headline numbers by vintage' });
    const table = mk('table', 'hub-table hub-vintages');
    add(table, mk('caption', 'sr-only', 'Headline numbers by vintage, newest first', 'Cifras principales por añada, la más reciente primero'));
    const tr = mk('tr');
    const th = (en, es, cls) => mk('th', cls || null, en, es, { scope: 'col' });
    add(tr, th('Vintage', 'Añada'), th('Date', 'Fecha'), th('Tool version', 'Versión de la herramienta'));
    for (const c of cols) add(tr, dv('th', 'right', c.label + (c.unit ? ' ' + c.unit : ''), { scope: 'col' }));
    if (hasMethod) add(tr, th('Method', 'Método'));
    add(tr, th('Delta vs previous', 'Variación vs anterior'), th('Reason', 'Motivo'));
    add(table, add(mk('thead'), tr));

    const tb = mk('tbody');
    for (const v of rows) add(tb, this.row(v, info.get(v.run_id), cols, hasMethod));
    add(table, tb);
    add(wrap, table);
    add(this, wrap);
  }

  supersederOf(v) {
    const o = this._v.find((x) => x.supersedes === v.run_id);
    return o ? (this.titles.get(o.run_id) || o.title || o.run_id) : (v.superseded_by ? (this.titles.get(v.superseded_by) || v.superseded_by) : null);
  }

  row(v, meta, cols, hasMethod) {
    const stale = this.staleReasons.get(v.run_id) || '';
    const superseded = v.superseded || v.status === 'superseded';
    const tr = mk('tr', stale ? 'is-stale' : '', null, null, { 'data-run-id': v.run_id, 'data-vintage': String(meta.number) });
    const st = RUN_STATUS[v.status] || [v.status, v.status, 'muted'];
    const first = mk('td');
    add(first, add(mk('b', 'hub-vint-n'), mk('span', null, 'Vintage ', 'Añada '), dv('span', null, String(meta.number))));
    add(first, add(mk('div', 'hub-vint-st'), mk('span', 'hub-pill ' + st[2], st[0], st[1])));
    add(tr, first);
    add(tr, dv('td', 'nowrap', (v.created_at || '').slice(0, 10)));

    const ver = add(mk('td', 'nowrap'), dv('b', 'mono', v.tool_version || '—', { 'data-tool-version': v.tool_version || '' }));
    if (this.breaking.has(v.job + '@' + v.tool_version)) add(ver, mk('div', null), mk('span', 'hub-pill bad', 'Breaking', 'Cambio incompatible', { 'data-breaking': 'true' }));
    add(tr, ver);

    for (const c of cols) {
      const o = v.outputs && v.outputs[c.key];
      add(tr, dv('td', 'right num', o && o.value != null ? num(o.value) : '—', { 'data-output': c.key }));
    }
    if (hasMethod) add(tr, dv('td', null, v.outputs && v.outputs.method ? v.outputs.method.value : '—'));

    const dcell = mk('td', 'hub-delta', null, null, { 'data-delta': '' });
    const parts = cols.map((c) => ({ c, d: meta.deltas[c.key] })).filter((x) => x.d && isNum(x.d.delta_pct));
    if (!meta.previous) add(dcell, mk('span', 'hub-muted', 'first vintage', 'primera añada'));
    else if (!parts.length) add(dcell, mk('span', 'hub-muted', 'no change', 'sin cambios'));
    else {
      parts.forEach((x, i) => {
        if (i) add(dcell, document.createTextNode(' · '));
        add(dcell, dv('span', x.d.delta_pct < 0 ? 'dn' : x.d.delta_pct > 0 ? 'up' : 'flat', x.c.label + ' ' + fmtPct(x.d.delta_pct), { 'data-delta-key': x.c.key }));
      });
    }
    add(tr, dcell);

    const rcell = mk('td', 'hub-reason', null, null, { 'data-reason': '' });
    const reasons = [];
    if (superseded) {
      const by = this.supersederOf(v);
      reasons.push(by ? [mk('span', null, 'Superseded by ', 'Reemplazada por '), dv('span', null, by)] : [mk('span', null, 'Superseded', 'Reemplazada')]);
    }
    if (stale) reasons.push([mk('b', null, 'Stale: ', 'Obsoleta: '), dv('span', null, stale)]);
    if (!reasons.length) add(rcell, dv('span', 'hub-muted', '—'));
    reasons.forEach((r, i) => { const d = mk('div'); add(d, ...r); add(rcell, d); });
    add(tr, rcell);
    return tr;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('vintage-table')) customElements.define('vintage-table', VintageTable);
