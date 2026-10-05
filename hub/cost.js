/* ============================================================
   ALPHA TECHNICAL CENTRE — HUB COST & HEALTH (M17, Tier C)
   hub/cost.html[?from=YYYY-MM-DD&to=YYYY-MM-DD]   (default: this month to date)

   Three independent sections; a section whose endpoint answers 404 or 501 stays hidden.
     GET /api/cost?from=&to=   token spend per feature and week from the audit log, infrastructure lines
                               (settings.infra_costs), total, budget alerts (settings.budgets). Partners only.
     GET /api/eval/results     the retrieval-evaluation runs (faithfulness, context precision, recall, relevancy), oldest first
     GET /api/scorecards       every project against the six rules, pass / fail / not-measurable, and its RAG
   The page shows what the server returns and adds nothing up on its own: the total is the server's total, which is the
   sum of the token cost and of the infrastructure lines. Every string a person reads carries data-en and data-es.
   No secrets, no provider calls: this file only talks to /api/* on the same origin (behind Cloudflare Access).
   ============================================================ */
import { api, listOf, mk, dv, add, setText, showSession, showVault } from './hub.js';

const $ = (sel, root) => (root || document).querySelector(sel);
const SVGNS = 'http://www.w3.org/2000/svg';
const unbuilt = (r) => r.status === 404 || r.status === 501;
const errText = (r) => (r && r.body && r.body.error && r.body.error.message) || '';
const usd = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');
const ymd = (d) => d.toISOString().slice(0, 10);

const FEATURE_ES = {
  draft: 'Redacción (correo, carta, informe, nota de cálculo)',
  tool: 'Asistente de herramientas',
  delta: 'Notas de diferencias (explicación de re-ejecuciones)',
  chunking: 'Fragmentación (recuperación contextual)',
  dream: 'Dream (lecciones semanales)',
  extraction: 'Extracción (datos de artículos, términos legales y financieros)',
  other: 'Otros',
};
const FEATURE_EN = {
  draft: 'Drafting (email, letter, report, calc note)',
  tool: 'Tool assistant',
  delta: 'Delta notes (re-run explanations)',
  chunking: 'Chunking (contextual retrieval)',
  dream: 'Dream (weekly lessons)',
  extraction: 'Extraction (paper facts, legal and finance terms)',
  other: 'Other',
};
/** Short column heads for the six scorecard rules, keyed by the server's rule ids. */
const RULE_HEAD = {
  'tool-version': ['R1 Version', 'R1 Versión'],
  'basis-note': ['R2 Basis note', 'R2 Nota de bases'],
  'letter-cites-run': ['R3 Letters', 'R3 Cartas'],
  'stale-documents': ['R4 Not stale', 'R4 Sin obsoletos'],
  'unfiled-mail': ['R5 Mail filed', 'R5 Correo archivado'],
  'legal-expiry': ['R6 Legal tags', 'R6 Etiquetas legales'],
};
const RULE_ES = {
  'tool-version': 'Toda ejecución final usa la versión actual de la herramienta',
  'basis-note': 'Toda evaluación tiene una nota de bases',
  'letter-cites-run': 'Toda carta cita al menos una ejecución',
  'stale-documents': 'Ningún documento obsoleto de más de 7 días',
  'unfiled-mail': 'Ninguna correspondencia sin archivar de más de 3 días',
  'legal-expiry': 'Etiquetas legales que vencen en 30 días con nota de renovación',
};
const STATUS = {
  pass: ['Pass', 'Cumple'],
  fail: ['Fail', 'No cumple'],
  'not-measurable': ['Not measurable', 'No medible'],
};
const RAG = { green: ['g', 'Green', 'Verde'], amber: ['', 'Amber', 'Ámbar'], red: ['r', 'Red', 'Rojo'], grey: ['grey', 'Not measurable', 'No medible'] };

/* ── formatting ──────────────────────────────────────────────────────── */

function tokensText(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' k';
  return String(n);
}
const pct = (r) => (typeof r === 'number' ? Math.round(r * 100) + '%' : '—');
const month = (iso, locale) => new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortDay = (iso, locale) => new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function range() {
  const q = new URLSearchParams(location.search);
  const today = ymd(new Date());
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const to = ok(q.get('to')) ? q.get('to') : today;
  const from = ok(q.get('from')) ? q.get('from') : to.slice(0, 8) + '01';
  return { from, to, custom: ok(q.get('from')) || ok(q.get('to')) };
}

function notice(kind, boldEn, boldEs, en, es) {
  return add(mk('div', 'hub-notice ' + kind), add(mk('span'), mk('b', null, boldEn, boldEs), document.createTextNode(' '), en ? mk('span', null, en, es) : null));
}

/* ── cost ────────────────────────────────────────────────────────────── */

function kpi(key, en, es, value, noteEn, noteEs, tone) {
  const c = mk('div', 'hub-kpi', null, null, { 'data-kpi': key });
  add(c, mk('span', 'k', en, es), dv('span', 'v' + (tone ? ' ' + tone : ''), value, { 'data-value': '' }), noteEn ? mk('span', 'd', noteEn, noteEs) : null);
  return c;
}

function renderKpis(cost) {
  const host = $('#kpis');
  host.textContent = '';
  host.removeAttribute('hidden');
  const infra = cost.infrastructure, over = infra.total_usd > infra.ceiling_usd;
  add(host,
    kpi('llm', 'Tokens (LLM)', 'Tokens (LLM)', 'USD ' + usd(cost.llm.cost_usd), cost.llm.calls + ' calls', cost.llm.calls + ' llamadas'),
    // Wave 7 (S39): planning defaults are said to be defaults; no acceptance-criterion ids in what a partner reads.
    kpi('infra', 'Infrastructure', 'Infraestructura', 'USD ' + usd(infra.total_usd),
      (over ? 'above the ' + infra.ceiling_usd + ' ceiling' : 'within the ' + infra.ceiling_usd + ' ceiling') + (infra.source === 'settings' ? '' : ' · planning defaults, no invoices entered'),
      (over ? 'por encima del techo de ' + infra.ceiling_usd : 'dentro del techo de ' + infra.ceiling_usd) + (infra.source === 'settings' ? '' : ' · valores de planificación, sin facturas'), over ? 'bad' : ''),
    kpi('total', 'Total', 'Total', 'USD ' + usd(cost.total_usd), 'tokens plus infrastructure', 'tokens más infraestructura'),
    kpi('cache', 'Cache hit rate', 'Tasa de aciertos de caché', pct(cost.llm.cache_hit_rate), 'cached share of input tokens', 'parte de tokens de entrada en caché'));
  if (cost.llm.unpriced_calls) {
    add($('#notices'), notice('warn', cost.llm.unpriced_calls + ' call(s) have no price.', cost.llm.unpriced_calls + ' llamada(s) sin precio.',
      'Their tokens are counted but their cost is not; add the model to the price table.', 'Sus tokens se cuentan pero su coste no; añada el modelo a la tabla de precios.'));
  }
}

function renderAlerts(cost) {
  const sec = $('#sec-alerts'), host = $('#alerts');
  host.textContent = '';
  $('#n-alerts').textContent = String(cost.alerts.length);
  if (!cost.alerts.length) { sec.setAttribute('hidden', ''); return; }
  sec.removeAttribute('hidden');
  for (const a of cost.alerts) {
    const es = FEATURE_ES[a.feature] || a.label, en = FEATURE_EN[a.feature] || a.label;
    const exceeded = a.level === 'exceeded';
    const n = add(mk('div', 'hub-notice ' + (exceeded ? 'bad' : 'warn'), null, null, { 'data-alert': a.feature, 'data-level': a.level }),
      add(mk('span'),
        exceeded ? mk('b', null, en + ' is over its monthly budget.', es + ' supera su presupuesto mensual.') : mk('b', null, en + ' is at ' + a.pct + '% of its monthly budget.', es + ' está al ' + a.pct + '% de su presupuesto mensual.'),
        document.createTextNode(' '),
        mk('span', null, 'USD ' + usd(a.spent_usd) + ' of USD ' + usd(a.budget_usd) + ' in ' + a.month + '.', 'USD ' + usd(a.spent_usd) + ' de USD ' + usd(a.budget_usd) + ' en ' + a.month + '.')));
    add(host, n);
  }
}

function renderBars(cost) {
  const host = $('#token-bars');
  host.textContent = '';
  const max = Math.max(0, ...cost.features.map((f) => f.cost_usd));
  const exceeded = new Set(cost.alerts.filter((a) => a.level === 'exceeded').map((a) => a.feature));
  for (const f of cost.features) {
    const en = FEATURE_EN[f.feature] || f.label, es = FEATURE_ES[f.feature] || f.label;
    const row = mk('div', 'c-feat', null, null, { 'data-feature': f.feature, 'data-cost': String(f.cost_usd) });
    add(row, add(mk('div', 'c-feat-top'), mk('span', null, en, es), dv('b', null, 'USD ' + usd(f.cost_usd))));
    const bar = mk('div', 'hub-bar' + (exceeded.has(f.feature) ? ' over' : ''), null, null, { role: 'img', 'aria-label': en + ': USD ' + usd(f.cost_usd) });
    const fill = document.createElement('i');
    fill.style.width = (max > 0 ? Math.max(f.cost_usd > 0 ? 2 : 0, (f.cost_usd / max) * 100) : 0) + '%';
    add(bar, fill);
    add(row, bar);
    const bits = [tokensText(f.tokens_in) + ' in', tokensText(f.tokens_out) + ' out'];
    const bitsEs = [tokensText(f.tokens_in) + ' entrada', tokensText(f.tokens_out) + ' salida'];
    if (f.tokens_cached) { bits.push('cached ' + pct(f.cache_hit_rate)); bitsEs.push('en caché ' + pct(f.cache_hit_rate)); }
    if (f.budget_usd !== null) { bits.push('budget USD ' + usd(f.budget_usd)); bitsEs.push('presupuesto USD ' + usd(f.budget_usd)); }
    add(row, mk('span', 'c-note', bits.join(' · '), bitsEs.join(' · ')));
    add(host, row);
  }
  add(host, add(mk('div', 'c-total', null, null, { 'data-llm-total': String(cost.llm.cost_usd) }), mk('span', null, 'Total tokens', 'Total de tokens'), dv('span', null, 'USD ' + usd(cost.llm.cost_usd))));
}

function renderWeeks(cost) {
  const host = $('#weeks');
  host.textContent = '';
  const max = Math.max(0, ...cost.weekly.map((w) => w.cost_usd));
  cost.weekly.forEach((w, i) => {
    const col = mk('div', 'c-week' + (i === cost.weekly.length - 1 ? ' now' : ''), null, null, { 'data-week': w.week, 'data-cost': String(w.cost_usd), title: 'USD ' + usd(w.cost_usd) });
    const bar = document.createElement('i');
    bar.style.height = (max > 0 ? Math.max(2, (w.cost_usd / max) * 70) : 2) + 'px';
    add(col, bar, mk('span', null, shortDay(w.week, 'en-GB'), shortDay(w.week, 'es-ES')));
    add(host, col);
  });
}

function renderInfra(cost) {
  const infra = cost.infrastructure;
  const body = $('#infra-table tbody');
  body.textContent = '';
  for (const l of infra.lines) {
    add(body, add(mk('tr', null, null, null, { 'data-infra-line': l.key, 'data-usd': String(l.usd_month) }),
      dv('td', null, l.label), dv('td', null, l.plan), dv('td', 'r', usd(l.usd_month))));
  }
  const over = infra.total_usd > infra.ceiling_usd;
  add(body, add(mk('tr', 'sum', null, null, { 'data-infra-total': String(infra.total_usd) }),
    add(mk('td'), mk('b', null, 'Infrastructure total', 'Total de infraestructura')),
    add(mk('td', 'hub-muted'), mk('span', null, 'ceiling ' + infra.ceiling_usd + (over ? ' (exceeded)' : ''), 'techo ' + infra.ceiling_usd + (over ? ' (superado)' : ''))),
    dv('td', 'r', usd(infra.total_usd))));
  add(body, add(mk('tr', null, null, null, { 'data-llm-line': String(cost.llm.cost_usd) }),
    mk('td', null, 'LLM tokens', 'Tokens LLM'), mk('td', null, 'Anthropic, all features', 'Anthropic, todas las funciones'), dv('td', 'r', usd(cost.llm.cost_usd))));
  add(body, add(mk('tr', 'grand', null, null, { 'data-grand-total': String(cost.total_usd) }),
    add(mk('td'), mk('b', null, 'Total', 'Total')), mk('td'), dv('td', 'r', usd(cost.total_usd))));
  if (infra.source === 'default') {
    add($('#notices'), notice('warn', 'Infrastructure lines are the planning defaults.', 'Las partidas de infraestructura son las previstas por defecto.',
      'Enter the real invoices in settings (infra_costs) and they replace these.', 'Introduzca las facturas reales en ajustes (infra_costs) y las sustituirán.'));
  }
  if (infra.ignored && infra.ignored.length) {
    add($('#notices'), notice('warn', 'Some infrastructure entries were ignored.', 'Se ignoraron algunas partidas de infraestructura.', infra.ignored.join(', '), infra.ignored.join(', ')));
  }
}

async function renderCost(r0) {
  const res = await api('/api/cost?from=' + r0.from + '&to=' + r0.to);
  if (res.status === 403) {
    add($('#notices'), notice('warn', 'Cost is for partners only.', 'El coste es solo para socios.', 'Token spend is firm spend and is not shown to associates.', 'El gasto en tokens es gasto de la firma y no se muestra a los asociados.'));
    return false;
  }
  if (unbuilt(res)) return false;
  if (!res.ok || !res.body || !res.body.llm) {
    add($('#notices'), notice('bad', 'Could not load the cost report.', 'No se pudo cargar el informe de costes.', errText(res), errText(res)));
    return false;
  }
  const cost = res.body;
  $('#sec-cost').removeAttribute('hidden');
  renderKpis(cost);
  renderAlerts(cost);
  renderBars(cost);
  renderWeeks(cost);
  renderInfra(cost);
  return true;
}

/* ── evaluation ──────────────────────────────────────────────────────── */

function sparkline(points, target) {
  const W = 520, H = 96, L = 8, R = 8, T = 10, B = 22;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'c-spark');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const vals = points.map((p) => p.v).concat([target]);
  const lo = Math.max(0, Math.min(...vals) - 0.1), hi = Math.min(1, Math.max(...vals) + 0.05) || 1;
  const x = (i) => (points.length === 1 ? W / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const el = (name, attrs) => { const e = document.createElementNS(SVGNS, name); for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]); return e; };
  svg.appendChild(el('line', { class: 'thr', x1: L, x2: W - R, y1: y(target), y2: y(target) }));
  if (points.length > 1) svg.appendChild(el('polyline', { class: 'ln', points: points.map((p, i) => x(i) + ',' + y(p.v)).join(' ') }));
  points.forEach((p, i) => svg.appendChild(el('circle', { class: 'pt' + (i === points.length - 1 ? ' last' : ''), cx: x(i), cy: y(p.v), r: 3.5 })));
  const label = (i, anchor) => { const t = el('text', { x: x(i), y: H - 6, 'text-anchor': anchor }); t.textContent = points[i].date; svg.appendChild(t); };
  label(0, points.length === 1 ? 'middle' : 'start');
  if (points.length > 1) label(points.length - 1, 'end');
  return svg;
}

function metricBlock(results, key, titleEn, titleEs, subEn, subEs) {
  const pts = results.filter((r) => r.metrics && typeof r.metrics[key] === 'number').map((r) => ({ date: r.date, v: r.metrics[key] }));
  const last = pts[pts.length - 1], prev = pts[pts.length - 2];
  const target = (results[results.length - 1].thresholds || {})[key];
  const box = mk('div', null, null, null, { 'data-metric': key });
  const top = add(mk('div', 'c-metric-top'), mk('span', 'label', titleEn, titleEs));
  if (!last) { add(box, top, mk('p', 'hub-muted', 'Not measured in the latest run.', 'No medido en la última ejecución.')); return box; }
  add(top, dv('span', 'big', last.v.toFixed(2), { 'data-value': last.v.toFixed(2) }));
  if (typeof target === 'number') {
    const ok = last.v >= target;
    add(top, mk('span', 'hub-pill ' + (ok ? 'ok' : 'bad'), (ok ? 'Target ≥ ' : 'Below target ≥ ') + target.toFixed(2), (ok ? 'Objetivo ≥ ' : 'Bajo el objetivo ≥ ') + target.toFixed(2), { 'data-target-met': ok ? 'yes' : 'no' }));
  }
  if (prev) {
    const d = last.v - prev.v, s = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
    add(top, mk('span', 'c-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), s + ' vs last run', s + ' frente a la última', { 'data-delta': s }));
  } else {
    add(top, mk('span', 'hub-muted', 'first run', 'primera ejecución'));
  }
  add(box, top, subEn ? mk('p', 'hub-muted', subEn, subEs) : null);
  add(box, sparkline(pts, typeof target === 'number' ? target : 0));
  return box;
}

async function renderRagas() {
  const res = await api('/api/eval/results');
  if (unbuilt(res)) { $('#sec-ragas').setAttribute('hidden', ''); return; }
  const host = $('#ragas');
  host.textContent = '';
  const results = res.ok ? listOf(res.body, 'results') : [];
  if (!res.ok) { add(host, notice('bad', 'Could not load the evaluation results.', 'No se pudieron cargar los resultados de evaluación.', errText(res), errText(res))); return; }
  if (!results.length) {
    add(host, mk('div', 'hub-empty', 'No evaluation has run yet. From the vault folder: npx tsx eval/runner.ts', 'Aún no se ha ejecutado ninguna evaluación. Desde la carpeta vault: npx tsx eval/runner.ts'));
    return;
  }
  const latest = results[results.length - 1];
  setText($('#ragas-note'), (latest.questions || '?') + ' gold questions · latest run ' + latest.date + (latest.passed ? '' : ' · below threshold'), (latest.questions || '?') + ' preguntas de referencia · última ejecución ' + latest.date + (latest.passed ? '' : ' · bajo el umbral'));
  const grid = mk('div', 'c-ragas');
  add(grid,
    metricBlock(results, 'faithfulness', 'Faithfulness', 'Fidelidad', 'Every claim in the answer is supported by the retrieved context.', 'Cada afirmación de la respuesta está respaldada por el contexto recuperado.'),
    metricBlock(results, 'context_precision', 'Context precision', 'Precisión de contexto', 'Retrieved chunks that matter are ranked near the top.', 'Los fragmentos relevantes recuperados están cerca de los primeros puestos.'));
  add(host, grid);
  const m = latest.metrics || {};
  add(host, add(mk('div', 'c-others'),
    add(mk('span', null, null, null, { 'data-metric': 'context_recall' }), mk('span', null, 'Context recall ', 'Cobertura de contexto '), dv('b', null, typeof m.context_recall === 'number' ? m.context_recall.toFixed(2) : '—')),
    add(mk('span', null, null, null, { 'data-metric': 'response_relevancy' }), mk('span', null, 'Response relevancy ', 'Relevancia de la respuesta '), dv('b', null, typeof m.response_relevancy === 'number' ? m.response_relevancy.toFixed(2) : '—')),
    add(mk('span'), mk('span', null, 'Leaks across scope ', 'Fugas entre ámbitos '), dv('b', null, String(latest.leaks || 0)))));
}

/* ── scorecards ──────────────────────────────────────────────────────── */

function ruleCell(rule, def) {
  const st = STATUS[rule.status] || [rule.status, rule.status];
  const td = mk('td', 'dotcol', null, null, { 'data-rule': rule.id, 'data-status': rule.status });
  const dot = mk('span', 'c-dot ' + rule.status, null, null, { 'aria-hidden': 'true' });
  add(td, dot, mk('span', 'sr-only', st[0], st[1]));
  td.setAttribute('title', ((def && def.name) || rule.id) + (RULE_ES[rule.id] ? ' / ' + RULE_ES[rule.id] : ''));
  return td;
}

async function renderScorecards() {
  const res = await api('/api/scorecards');
  if (unbuilt(res)) return;
  if (!res.ok || !res.body || !Array.isArray(res.body.projects)) {
    $('#sec-scorecards').removeAttribute('hidden');
    add($('#sc-table').parentNode, notice('bad', 'Could not load the scorecards.', 'No se pudieron cargar las fichas.', errText(res), errText(res)));
    return;
  }
  $('#sec-scorecards').removeAttribute('hidden');
  const rules = res.body.rules || [];
  const legend = $('#sc-legend');
  legend.textContent = '';
  for (const s of ['pass', 'fail', 'not-measurable']) add(legend, add(mk('span'), mk('span', 'c-dot ' + s, null, null, { 'aria-hidden': 'true' }), document.createTextNode(' '), mk('span', null, STATUS[s][0].toLowerCase(), STATUS[s][1].toLowerCase())));
  const head = $('#sc-table thead'), body = $('#sc-table tbody');
  head.textContent = ''; body.textContent = '';
  const tr = mk('tr');
  add(tr, mk('th', null, 'Project', 'Proyecto', { scope: 'col' }), mk('th', null, 'Client', 'Cliente', { scope: 'col' }));
  for (const r of rules) {
    const h = RULE_HEAD[r.id] || ['R' + r.n, 'R' + r.n];
    const th = mk('th', 'dotcol', h[0], h[1], { scope: 'col', title: r.name + (RULE_ES[r.id] ? ' / ' + RULE_ES[r.id] : '') });
    add(tr, th);
  }
  add(tr, mk('th', 'dotcol', 'Score', 'Puntos', { scope: 'col' }), mk('th', 'dotcol', 'RAG', 'RAG', { scope: 'col' }));
  add(head, tr);
  if (!res.body.projects.length) {
    add(body, add(mk('tr'), add(mk('td', null, null, null, { colspan: String(rules.length + 4) }), mk('div', 'hub-empty', 'No projects to score.', 'No hay proyectos que puntuar.'))));
    return;
  }
  const byId = new Map(rules.map((r) => [r.id, r]));
  for (const p of res.body.projects) {
    const row = mk('tr', null, null, null, { 'data-project': p.id, 'data-rag': p.rag });
    add(row, add(mk('td'), add(mk('a', 'hub-link', null, null, { href: '/hub/project.html?id=' + encodeURIComponent(p.id) }), dv('span', null, p.name))), dv('td', 'hub-muted', p.client_name));
    for (const r of rules) {
      const u = (p.rules || []).find((x) => x.id === r.id) || { id: r.id, status: 'not-measurable' };
      add(row, ruleCell(u, byId.get(r.id)));
    }
    const total = rules.length;
    add(row, add(mk('td', 'dotcol'), dv('b', null, p.pass + '/' + total, { 'data-score': String(p.pass) })));
    const rg = RAG[p.rag] || RAG.grey;
    add(row, add(mk('td', 'dotcol'), mk('span', 'hub-rag ' + rg[0], null, null, { 'aria-hidden': 'true' }), mk('span', 'sr-only', rg[1], rg[2])));
    add(body, row);
  }
  const s = res.body.summary || {};
  add($('#status-strip'), mk('span', 'hub-pill ' + ((s.red || 0) ? 'bad' : (s.amber || 0) ? 'warn' : 'ok'),
    (s.green || 0) + ' green · ' + (s.amber || 0) + ' amber · ' + (s.red || 0) + ' red', (s.green || 0) + ' verdes · ' + (s.amber || 0) + ' ámbar · ' + (s.red || 0) + ' rojos'));
}

/* ── page ────────────────────────────────────────────────────────────── */

async function init() {
  const r0 = range();
  const en = r0.from.slice(0, 7) === r0.to.slice(0, 7) && !r0.custom ? month(r0.from, 'en-GB') : shortDay(r0.from, 'en-GB') + ' – ' + shortDay(r0.to, 'en-GB') + ' ' + r0.to.slice(0, 4);
  const es = r0.from.slice(0, 7) === r0.to.slice(0, 7) && !r0.custom ? month(r0.from, 'es-ES') : shortDay(r0.from, 'es-ES') + ' – ' + shortDay(r0.to, 'es-ES') + ' ' + r0.to.slice(0, 4);
  setText($('#c-title'), en.charAt(0).toUpperCase() + en.slice(1), es.charAt(0).toUpperCase() + es.slice(1));
  await showSession();
  const [ok] = await Promise.all([renderCost(r0), renderRagas(), renderScorecards()]);
  const cat = await api('/api/catalog');
  showVault(ok || cat.ok);
  document.body.setAttribute('data-ready', '1');
}
init();
