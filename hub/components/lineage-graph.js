/* ============================================================
   <lineage-graph> (M07). Inline SVG lineage of a project: nodes are runs,
   documents and reference sets; edges are inputs and cites (plus parent,
   artifact and supersedes links). Layered left to right, stale nodes outlined
   in red, click (or Enter) on a node to select it.

     const g = document.querySelector('lineage-graph');
     g.graph = { nodes, edges };                    // GET /api/projects/:id/lineage
     g.addEventListener('node-select', (e) => e.detail.node);

   layoutLineage() is exported and pure: a longest-path layering (cycles are
   broken first), barycentre ordering inside each layer, and column packing:
   a layer with more than `maxPerColumn` nodes is split into side-by-side
   sub-columns, so every node owns its own cell and no two rectangles can
   overlap, however large the graph.
   ============================================================ */
import { mk, add, setText } from '../hub.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const DEFAULTS = { nodeW: 200, nodeH: 50, gapX: 64, gapY: 14, maxPerColumn: 12, padX: 24, padTop: 44, padBottom: 24 };

/** Pure layered layout. Returns {width, height, nodes:[{id,x,y,w,h,layer,col}], layers:[{layer,x,count,kinds}]}. */
export function layoutLineage(nodes, edges, opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const n = nodes.length;
  const idx = new Map();
  nodes.forEach((nd, i) => idx.set(nd.id, i));
  const succ = nodes.map(() => []), pred = nodes.map(() => []);
  const seen = new Set();
  for (const e of edges || []) {
    if (!e || e.type === 'supersedes') continue;            // supersedes points backwards in time; it does not layer
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const k = a + '>' + b;
    if (seen.has(k)) continue;
    seen.add(k); succ[a].push(b);
  }
  // Break cycles: an iterative depth-first search drops every edge that closes a loop.
  const state = new Uint8Array(n), back = new Set();
  for (let s = 0; s < n; s++) {
    if (state[s]) continue;
    const stack = [[s, 0]];
    state[s] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1], v = top[0];
      if (top[1] < succ[v].length) {
        const w = succ[v][top[1]++];
        if (state[w] === 0) { state[w] = 1; stack.push([w, 0]); } else if (state[w] === 1) back.add(v + '>' + w);
      } else { state[v] = 2; stack.pop(); }
    }
  }
  const dag = nodes.map(() => []), indeg = new Array(n).fill(0);
  for (let a = 0; a < n; a++) for (const b of succ[a]) if (!back.has(a + '>' + b)) { dag[a].push(b); pred[b].push(a); indeg[b]++; }
  // Longest path from any source (Kahn).
  const layer = new Array(n).fill(0), queue = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) queue.push(i);
  for (let q = 0; q < queue.length; q++) {
    const u = queue[q];
    for (const w of dag[u]) { if (layer[w] < layer[u] + 1) layer[w] = layer[u] + 1; if (--indeg[w] === 0) queue.push(w); }
  }
  const depth = n ? Math.max(...layer) + 1 : 0;
  const cols = Array.from({ length: depth }, () => []);
  for (let i = 0; i < n; i++) cols[layer[i]].push(i);

  // Order inside each layer by the mean position of the neighbours (two sweeps each way).
  const rank = new Array(n).fill(0);
  const setRanks = () => cols.forEach((c) => c.forEach((v, i) => { rank[v] = (i + 0.5) / c.length; }));
  setRanks();
  const bary = (v, nb) => (nb[v].length ? nb[v].reduce((s, w) => s + rank[w], 0) / nb[v].length : rank[v]);
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < depth; l++) { const b = new Map(cols[l].map((v) => [v, bary(v, pred)])); cols[l].sort((x, y) => b.get(x) - b.get(y) || x - y); setRanks(); }
    for (let l = depth - 2; l >= 0; l--) { const b = new Map(cols[l].map((v) => [v, bary(v, dag)])); cols[l].sort((x, y) => b.get(x) - b.get(y) || x - y); setRanks(); }
  }

  // Column packing: split tall layers into sub-columns, then place every node in its own cell.
  const cellW = o.nodeW + o.gapX, cellH = o.nodeH + o.gapY;
  const plan = cols.map((c) => { const subs = Math.max(1, Math.ceil(c.length / o.maxPerColumn)); return { c, subs, per: Math.ceil(c.length / subs) || 1 }; });
  const tallest = plan.reduce((m, p) => Math.max(m, Math.min(p.c.length, p.per)), 0);
  const bodyH = tallest * cellH - o.gapY;
  const placed = new Array(n), layers = [];
  let x = o.padX;
  plan.forEach((p, l) => {
    layers.push({ layer: l, x, count: p.c.length, kinds: p.c.reduce((m, v) => { const k = kindOf(nodes[v]); m[k] = (m[k] || 0) + 1; return m; }, {}) });
    for (let s = 0; s < p.subs; s++) {
      const slice = p.c.slice(s * p.per, (s + 1) * p.per);
      const h = slice.length * cellH - o.gapY;
      const y0 = o.padTop + Math.round((bodyH - h) / 2);
      slice.forEach((v, r) => { placed[v] = { id: nodes[v].id, x: x + s * cellW, y: y0 + r * cellH, w: o.nodeW, h: o.nodeH, layer: l, col: s }; });
    }
    x += p.subs * cellW;
  });
  return { width: Math.max(x - o.gapX + o.padX, 2 * o.padX + o.nodeW), height: o.padTop + Math.max(bodyH, 0) + o.padBottom, nodes: placed, layers, options: o };
}

export function kindOf(nd) {
  if (nd.restricted) return 'restricted';
  if (nd.kind === 'reference' || (nd.id || '').startsWith('ref:')) return 'reference';
  if (nd.kind === 'item') return 'item';
  if (nd.kind === 'run') return 'run';
  return 'other';
}
const LAYER_LABEL = {
  reference: ['Reference sets', 'Conjuntos de referencia'], run: ['Runs', 'Ejecuciones'], item: ['Documents', 'Documentos'],
  restricted: ['Restricted', 'Restringidos'], other: ['Other', 'Otros'],
};

const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function el(name, attrs, cls) {
  const e = document.createElementNS(SVGNS, name);
  if (cls) e.setAttribute('class', cls);
  if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
  return e;
}
function text(x, y, cls, en, es) {
  const t = el('text', { x, y }, cls);
  setText(t, en, es);
  return t;
}
const SUB = { run: ['Run', 'Ejecución'], item: ['Document', 'Documento'], reference: ['Reference set', 'Conjunto de referencia'], restricted: ['Restricted record', 'Registro restringido'], other: ['Record', 'Registro'] };

export class LineageGraph extends HTMLElement {
  constructor() { super(); this._g = { nodes: [], edges: [] }; this._sel = null; this.layout = null; }
  set graph(g) { this._g = g && Array.isArray(g.nodes) ? { nodes: g.nodes, edges: Array.isArray(g.edges) ? g.edges : [] } : { nodes: [], edges: [] }; this._sel = null; if (this.isConnected) this.render(); }
  get graph() { return this._g; }
  connectedCallback() { this.render(); }

  render() {
    this.textContent = '';
    const { nodes, edges } = this._g;
    if (!nodes.length) { add(this, mk('div', 'hub-empty', 'No lineage recorded for this project yet.', 'Aún no hay linaje registrado para este proyecto.')); return; }
    const L = (this.layout = layoutLineage(nodes, edges));
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));
    const pos = new Map(L.nodes.map((p) => [p.id, p]));
    const superseded = new Set(edges.filter((e) => e.type === 'supersedes').map((e) => e.to));
    const stateOf = (nd) => (nd.stale ? 'stale' : nd.status === 'superseded' || superseded.has(nd.id) ? 'superseded' : nd.restricted ? 'restricted' : 'current');

    const legend = mk('div', 'hub-legend');
    for (const [cls, en, es] of [['current', 'current', 'vigente'], ['stale', 'stale', 'obsoleto'], ['superseded', 'superseded', 'reemplazado']]) {
      add(legend, add(mk('span'), mk('i', 'hub-lg ' + cls), mk('span', null, en, es)));
    }
    add(legend, mk('span', 'hub-muted', nodes.length + ' nodes · ' + edges.length + ' links', nodes.length + ' nodos · ' + edges.length + ' enlaces'));
    add(this, legend);

    const wrap = mk('div', 'hub-lineage-wrap', null, null, { tabindex: '0', role: 'region', 'aria-label': 'Lineage graph' });
    const svg = el('svg', { width: L.width, height: L.height, viewBox: '0 0 ' + L.width + ' ' + L.height, role: 'group', 'aria-label': 'Lineage graph' }, 'hub-lineage');
    const defs = el('defs');
    const mkr = (id, color) => {
      const m = el('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      m.appendChild(el('path', { d: 'M0 0 L10 5 L0 10 z', fill: color }));
      return m;
    };
    defs.appendChild(mkr('ln-arrow', '#7B8797')); defs.appendChild(mkr('ln-arrow-bad', '#A5301F'));
    svg.appendChild(defs);

    // Column headings, named by what most of the layer holds.
    for (const ly of L.layers) {
      const top = Object.keys(ly.kinds).sort((a, b) => ly.kinds[b] - ly.kinds[a])[0] || 'other';
      const lab = ly.kinds.reference && ly.kinds.item && !ly.kinds.run ? ['Inputs', 'Entradas'] : (LAYER_LABEL[top] || LAYER_LABEL.other);
      svg.appendChild(text(ly.x, 22, 'ln-col', lab[0], lab[1]));
    }

    // Edges first so nodes draw over them.
    const gEdges = el('g', null, 'ln-edges');
    for (const e of edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) continue;
      const bad = (byId.get(e.to) || {}).stale && (((byId.get(e.from) || {}).stale) || superseded.has(e.from)) && e.type !== 'supersedes';
      let d;
      const ay = a.y + a.h / 2, by = b.y + b.h / 2;
      if (b.x >= a.x + a.w + 1) { const dx = Math.max(24, (b.x - a.x - a.w) / 2); d = 'M' + (a.x + a.w) + ' ' + ay + ' C' + (a.x + a.w + dx) + ' ' + ay + ' ' + (b.x - dx) + ' ' + by + ' ' + b.x + ' ' + by; }
      else if (b.x + b.w <= a.x - 1) { const dx = Math.max(24, (a.x - b.x - b.w) / 2); d = 'M' + a.x + ' ' + ay + ' C' + (a.x - dx) + ' ' + ay + ' ' + (b.x + b.w + dx) + ' ' + by + ' ' + (b.x + b.w) + ' ' + by; }
      else { const r = a.x + a.w; d = 'M' + r + ' ' + ay + ' C' + (r + 46) + ' ' + ay + ' ' + (r + 46) + ' ' + by + ' ' + r + ' ' + by; }
      const path = el('path', { d, 'marker-end': 'url(#' + (bad ? 'ln-arrow-bad' : 'ln-arrow') + ')', 'data-from': e.from, 'data-to': e.to }, 'ln-edge ' + e.type + (bad ? ' bad' : ''));
      gEdges.appendChild(path);
    }
    svg.appendChild(gEdges);

    const gNodes = el('g', null, 'ln-nodes');
    for (const nd of nodes) {
      const p = pos.get(nd.id);
      const st = stateOf(nd), kind = kindOf(nd);
      const label = nd.restricted ? ['Restricted record', 'Registro restringido'] : [nd.label || nd.id, nd.label || nd.id];
      const sub = [];
      if (nd.restricted) sub.push('outside your scope', 'fuera de su alcance'); else if (kind === 'run') sub.push(clip((nd.job || '') + (nd.status ? ' · ' + nd.status : ''), 34), clip((nd.job || '') + (nd.status ? ' · ' + nd.status : ''), 34)); else if (kind === 'item') sub.push(clip(nd.type || 'document', 34), clip(nd.type || 'documento', 34)); else sub.push(SUB[kind][0], SUB[kind][1]);
      const g = el('g', { transform: 'translate(' + p.x + ' ' + p.y + ')', tabindex: '0', role: 'button', 'data-node': nd.id, 'data-kind': kind, 'data-state': st, 'aria-label': (label[0] || '') + ', ' + kind + (st === 'stale' ? ', stale' : st === 'superseded' ? ', superseded' : '') }, 'ln-node ' + st + ' k-' + kind);
      const t = el('title'); t.textContent = (nd.restricted ? 'Restricted record' : nd.label || nd.id) + ' · ' + nd.id; g.appendChild(t);
      g.appendChild(el('rect', { x: 0, y: 0, width: p.w, height: p.h, rx: 7, ry: 7, 'data-w': p.w, 'data-h': p.h }, 'ln-rect'));
      const tt = el('text', { x: 10, y: 20 }, 'ln-t'); const room = st === 'stale' ? 18 : 27; setText(tt, clip(label[0], room), clip(label[1], room)); g.appendChild(tt);
      const ss = el('text', { x: 10, y: 38 }, 'ln-s'); setText(ss, sub[0], sub[1]); g.appendChild(ss);
      if (st === 'stale') {
        g.appendChild(el('rect', { x: p.w - 48, y: 4, width: 42, height: 14, rx: 3, ry: 3 }, 'ln-tag'));
        g.appendChild(text(p.w - 27, 14.2, 'ln-tag-t', 'STALE', 'OBSOLETO'));
        g.lastChild.setAttribute('text-anchor', 'middle');
      }
      const pick = (ev) => {
        this.select(nd.id);
        this.dispatchEvent(new CustomEvent('node-select', { bubbles: true, detail: { node: nd, incoming: edges.filter((e) => e.to === nd.id), outgoing: edges.filter((e) => e.from === nd.id), trigger: g } }));
      };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(ev); } });
      gNodes.appendChild(g);
    }
    svg.appendChild(gNodes);
    add(wrap, svg);
    add(this, wrap);
    this._svg = svg;
  }

  select(id) {
    this._sel = id;
    if (!this._svg) return;
    for (const g of this._svg.querySelectorAll('.ln-node')) g.classList.toggle('sel', g.getAttribute('data-node') === id);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('lineage-graph')) customElements.define('lineage-graph', LineageGraph);
