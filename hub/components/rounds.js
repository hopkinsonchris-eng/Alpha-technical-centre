/* ============================================================
   The round watch (wave 7, PR6, O; docs/vault-hub/wave7/05-markup.md §1.9,
   W7-AC22; 04-step-changes.md P2). One module renders the licence rounds
   wherever they appear, from the shapes in vault/src/rounds/types.ts:

     GET  /api/rounds?country=&status=&within=    RoundsView {countries[], deadlines[], proposed}
     GET  /api/items/:id                          the stored original behind a source chip

     import { loadRounds, deadlinesCard, roundLine, movedLines, roundQueueBody, sourceChip,
              openOriginal, STAGES, stageLabel, fmtDays } from './components/rounds.js';

   `deadlinesCard` is the "Deadlines in the next 90 days" card among Today's
   counters: one tappable row per confirmed event (country, round, stage, date,
   "in N days", overdue in red) with the source page as a chip, and the
   proposals waiting as one line to the queue. `roundLine` is the one line in
   the globe's country panel ("Round: … · bid deadline 7 Oct 2026 (in 2 days)",
   or "No open round"). `movedLines` names the confirmed deadlines that moved
   since the person last looked, for What came in. `roundQueueBody` fills a
   review-queue row of kind `round` with the proposal and its verbatim quote.
   `sourceChip` is the host and the day the page was read; with a stored
   original it opens the record panel (`openOriginal` mounts one on a page
   that has none), without one it opens the page in a new tab. Plain
   functions returning elements; every text carries data-en and data-es;
   figures are .hub-num; dates go through the shared formatters.
   ============================================================ */
import { mk, dv, add, api, setText, fmtShortDate, lang, listOf } from '../hub.js';
import { renderRecord, detailsNode } from '../record.js';

/** The stages, in the order vault/src/rounds/types.ts STAGES lists them, with their bilingual labels. */
export const STAGES = [
  { id: 'announced',     en: 'Round announced',          es: 'Ronda anunciada' },
  { id: 'data_package',  en: 'Data package available',   es: 'Paquete de datos disponible' },
  { id: 'qualification', en: 'Qualification',            es: 'Calificación' },
  { id: 'bids_open',     en: 'Bids open',                es: 'Apertura de ofertas' },
  { id: 'bid_deadline',  en: 'Bid deadline',             es: 'Plazo de ofertas' },
  { id: 'award',         en: 'Award',                    es: 'Adjudicación' },
  { id: 'signature',     en: 'Signature',                es: 'Firma' },
  { id: 'other',         en: 'Other dated step',         es: 'Otro paso con fecha' },
];
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
/** The label of a stage in both languages; an unknown id is shown as it came. */
export const stageLabel = (id) => { const s = STAGE_BY_ID.get(id); return s ? { en: s.en, es: s.es } : { en: String(id || ''), es: String(id || '') }; };
/** The same label after "Round: …", lower-cased ("bid deadline 7 Oct 2026"). */
const lower = (w) => ({ en: w.en.charAt(0).toLowerCase() + w.en.slice(1), es: w.es.charAt(0).toLowerCase() + w.es.slice(1) });

/** A date-only value ("2026-10-07") as a local Date, so the shared formatter prints the day the page states; an ISO stamp as it is. */
const localDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00') : new Date(d));
export const fmtEventDate = (d) => fmtShortDate(localDate(d));
const startOfToday = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); };
/** Days from today to the event: the Vault's own figure when it gives one, else from the date; null without a date. */
export function daysOf(ev) {
  if (typeof ev.days === 'number' && Number.isFinite(ev.days)) return ev.days;
  if (!ev.event_date) return null;
  const d = localDate(ev.event_date);
  if (isNaN(d)) return null;
  return Math.round((d.getTime() - startOfToday()) / 864e5);
}
/** "in 2 days", "today", "3 days overdue" as an element: the figure a .hub-num, the overdue one marked for the red. */
export function fmtDays(days) {
  const el = mk('span', 'hub-dl-days', null, null, { 'data-days': String(days) });
  if (days === null || days === undefined) { el.setAttribute('data-days', ''); add(el, mk('span', null, 'no date yet', 'aún sin fecha')); return el; }
  if (days === 0) { add(el, mk('span', null, 'today', 'hoy')); return el; }
  if (days > 0) { add(el, mk('span', null, 'in ', 'en '), dv('b', 'hub-num', String(days)), mk('span', null, days === 1 ? ' day' : ' days', days === 1 ? ' día' : ' días')); return el; }
  const n = -days;
  el.setAttribute('data-overdue', '1');
  add(el, dv('b', 'hub-num', String(n)), mk('span', null, n === 1 ? ' day overdue' : ' days overdue', n === 1 ? ' día de retraso' : ' días de retraso'));
  return el;
}
/** "gov.br" from the source page's address: the host without its www., so the chip reads as attribution. */
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
/** The country's name in both languages: the globe's polygons first, then the view's own, then the code. */
export const countryName = (code, names, view) => {
  if (names && names.get(code)) return names.get(code);
  const c = view && Array.isArray(view.countries) ? view.countries.find((x) => x.country === code) : null;
  const n = c && c.name;
  if (n && typeof n === 'object') return { en: n.en || code, es: n.es || n.en || code };
  return { en: n || code, es: n || code };
};
const confirmedOnly = (events) => (events || []).filter((e) => e && e.status === 'confirmed');

/** Reads a view. `state` is 'ready', 'unavailable' (404 or 501: the Vault has no rounds route; callers show nothing) or 'failed'. */
export async function loadRounds(query) {
  const r = await api('/api/rounds' + (query ? '?' + query : ''));
  if (r.status === 404 || r.status === 501) return { state: 'unavailable', view: null, status: r.status };
  if (!r.ok || !r.body || typeof r.body !== 'object' || r.body.error) return { state: 'failed', view: null, status: r.status };
  const b = r.body;
  return { state: 'ready', status: r.status, view: { countries: Array.isArray(b.countries) ? b.countries : [], deadlines: listOf(b, 'deadlines'), proposed: Number(b.proposed || 0) } };
}

/* ── the source chip and the record panel it opens ──────────────────── */

/**
 * The source page as a chip in the attribution style: the host and the day it was read. With a stored original it is a
 * button that opens the record panel on the original with the quote as the cited passage; without one, the page itself
 * in a new tab. `opts.onOpen(ev, chip)` replaces the default panel.
 */
export function sourceChip(ev, opts) {
  const o = opts || {};
  const host = hostOf(ev.source_url) || (ev.source_item ? 'stored page' : '');
  const read = ev.read_at ? fmtShortDate(ev.read_at) : null;
  const label = { en: host + (read ? ' · read ' + read.en : ''), es: host + (read ? ' · leído el ' + read.es : '') };
  if (ev.source_item) {
    const b = mk('button', 'hub-cite hub-dl-src', label.en, label.es, { type: 'button', 'data-item': ev.source_item, title: 'Open the stored page as it was read', 'aria-label': 'Open the stored source page: ' + label.en });
    b.addEventListener('click', () => (o.onOpen ? o.onOpen(ev, b) : openOriginal({ itemId: ev.source_item, title: ev.title || host, quote: ev.quote, trigger: b })));
    return b;
  }
  if (ev.source_url) return mk('a', 'hub-cite hub-dl-src', label.en, label.es, { href: ev.source_url, target: '_blank', rel: 'noopener noreferrer', title: 'Open the source page', 'aria-label': 'Open the source page: ' + label.en });
  return mk('span', 'hub-cite hub-dl-src', 'no source page', 'sin página de origen');
}

let panelTrigger = null;
const versionsCache = new Map();
/** The record panel's markup (what hub/search.html carries) when the page has none: Today and the queue. Returns the panel. */
function ensurePanel() {
  let panel = document.getElementById('record-panel');
  if (panel) return panel;
  const scrim = mk('div', 'hub-scrim', null, null, { id: 'record-scrim', hidden: '' });
  panel = mk('div', 'hub-panel hub-record', null, null, { id: 'record-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'rp-title', hidden: '', 'data-rounds-panel': '' });
  const head = mk('div', 'hub-panel-head');
  const close = mk('button', 'btn btn-outline btn-sm', 'Close', 'Cerrar', { type: 'button', id: 'rp-close' });
  add(head, add(mk('div'), mk('span', 'label', 'Record', 'Registro', { id: 'rp-kind' }), mk('h2', null, null, null, { id: 'rp-title', tabindex: '-1' })), close);
  add(panel, head, mk('div', 'hub-panel-body', null, null, { id: 'rp-body' }));
  document.body.append(scrim, panel);
  close.addEventListener('click', closePanel);
  scrim.addEventListener('click', closePanel);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePanel(); });
  return panel;
}
export function closePanel() {
  const p = document.getElementById('record-panel');
  if (!p || !p.hasAttribute('data-rounds-panel') || p.hasAttribute('hidden')) return;
  p.setAttribute('hidden', '');
  const scrim = document.getElementById('record-scrim'); if (scrim) scrim.setAttribute('hidden', '');
  document.body.classList.remove('has-panel');
  if (panelTrigger && panelTrigger.isConnected) panelTrigger.focus();
  panelTrigger = null;
}
/**
 * Opens the record panel on a stored original (the page as it was read) with the quote as the passage cited and
 * highlighted, the way a country-pack chip opens its source on the project page. Builds the panel when the page has none.
 */
export async function openOriginal({ itemId, title, quote, trigger }) {
  const panel = ensurePanel(), body = document.getElementById('rp-body');
  const ref = 'doc:' + itemId;
  if (panel.hasAttribute('hidden')) panelTrigger = trigger || document.activeElement;
  setText(document.getElementById('rp-kind'), 'Source page', 'Página de origen');
  setText(document.getElementById('rp-title'), title || ref);
  panel.setAttribute('data-ref', ref);
  panel.removeAttribute('hidden');
  const scrim = document.getElementById('record-scrim'); if (scrim) scrim.removeAttribute('hidden');
  document.body.classList.add('has-panel');
  body.textContent = '';
  add(body, mk('p', 'hub-muted', 'Loading the record…', 'Cargando el registro…'));
  document.getElementById('rp-title').focus();
  const res = await api('/api/items/' + encodeURIComponent(itemId));
  if (panel.getAttribute('data-ref') !== ref) return;
  const rec = res.ok && res.body && !res.body.error ? res.body : null;
  if (rec && rec.title) setText(document.getElementById('rp-title'), rec.title);
  const ctx = {
    project: rec && rec.project_id ? { id: rec.project_id, name: rec.project_id } : null, entryById: new Map(), lineage: null,
    versionsOf: async (id) => { if (!versionsCache.has(id)) { const r = await api('/api/items/' + encodeURIComponent(id) + '/versions'); versionsCache.set(id, r.ok ? listOf(r.body, 'versions') : null); } return versionsCache.get(id); },
    open: (r, t, b) => { if (r.startsWith('doc:')) openOriginal({ itemId: r.slice(4), title: t, trigger: b }); },
    // The quote is the highlight and the passage, as the pack chip does on the project page: the phrase is marked first, its words after.
    openDraft: null, openReply: null, highlight: quote || null, passage: quote || null, siteRoot: new URL('../', location.href),
  };
  const content = await renderRecord({ kind: 'doc', ref, rec, node: null, entry: null, ctx });
  if (panel.getAttribute('data-ref') !== ref) return;
  body.textContent = '';
  if (quote) add(body, add(mk('blockquote', 'hub-rp-passage', null, null, { 'data-passage': '' }), mk('span', 'hub-muted', 'Passage the date was read from: ', 'Pasaje del que se leyó la fecha: '), dv('span', null, quote)));
  add(body, content);
  if (!rec) {
    const msg = res.body && res.body.error && res.body.error.message;
    add(body, add(mk('div', 'hub-notice warn'), add(mk('span'), mk('b', null, 'Stored page unavailable.', 'Página guardada no disponible.'), document.createTextNode(' '), mk('span', null, 'The original could not be read' + (msg ? ' (' + msg + ')' : '') + '.', 'No se pudo leer el original' + (msg ? ' (' + msg + ')' : '') + '.'))));
    add(body, detailsNode({ ref }));
  }
  const anchor = body.querySelector('[data-anchor]');
  if (anchor) anchor.scrollIntoView({ block: 'center' });
}

/* ── Today: the Deadlines card ──────────────────────────────────────── */

const CAL_ICON = '<svg class="hub-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
const MAX_ROWS = 8;
/** The countries the person's live projects are in: archived and closed ones, and the internal holding project, never count. */
export function projectCountries(projects) {
  const codes = new Set();
  for (const p of projects || []) if (p && p.country && p.id !== 'firm' && p.status !== 'archived' && p.status !== 'closed') codes.add(p.country);
  return codes;
}
/** The confirmed deadlines of the view for `codes` (all of them when no project list is known), soonest first as the Vault sorts them. */
export function deadlinesFor(view, codes) {
  const all = confirmedOnly(view && view.deadlines);
  return codes && codes.size ? all.filter((d) => codes.has(d.country)) : codes ? [] : all;
}
/** The one line "country · round · stage · date · in N days" as a tap to the country, plus the chip; shared by the card. */
function deadlineRow(ev, names, view, opts) {
  const o = opts || {};
  const n = countryName(ev.country, names, view), st = stageLabel(ev.stage), days = daysOf(ev);
  const row = mk('div', 'hub-dl-row', null, null, { 'data-deadline': ev.id, 'data-country': ev.country, 'data-stage': ev.stage });
  const main = mk('a', 'hub-dl-main', null, null, { href: '/hub/index.html?country=' + encodeURIComponent(ev.country), 'data-deadline-open': ev.country });
  add(main, mk('span', 'hub-dl-country', n.en, n.es), dv('span', 'hub-dl-round', ev.round), mk('span', 'hub-dl-stage', st.en, st.es));
  if (ev.event_date) { const d = fmtEventDate(ev.event_date); add(main, mk('span', 'hub-dl-date', d.en, d.es, { 'data-date': ev.event_date })); }
  add(main, fmtDays(days));
  if (o.onCountry) main.addEventListener('click', (e) => { e.preventDefault(); o.onCountry(ev.country, ev); });
  add(row, main, sourceChip(ev, o));
  return row;
}
/**
 * The card among the counters (W7-AC22): the title and the count in one line (collapsed at zero, like the other
 * counters), one row per deadline, "N more" past eight, and the proposals waiting as a line to the queue. `opts`:
 * names (Map<code, {en, es}>), codes (the project countries; null lists every deadline), onCountry(code), onOpen(ev, chip).
 */
export function deadlinesCard(card, view, opts) {
  const o = opts || {};
  card.textContent = '';
  card.removeAttribute('hidden');
  card.setAttribute('data-rounds', 'ready');
  const list = deadlinesFor(view, o.codes || null);
  const n = list.length;
  const head = mk('div', 'hub-card-head hub-counter-head');
  const ico = mk('span', 'hub-item-ico gold', null, null, { 'aria-hidden': 'true' }); ico.innerHTML = CAL_ICON;   // static, trusted markup defined above
  add(head, add(mk('div', 'hub-counter-title'), ico, mk('h3', null, 'Deadlines in the next 90 days', 'Plazos en los próximos 90 días', { id: 'h-deadlines' })),
    add(mk('span', 'hub-fig'), dv('b', 'hub-num', String(n), { 'aria-label': n + (n === 1 ? ' deadline' : ' deadlines') })));
  add(card, head);
  if (n) card.removeAttribute('data-empty'); else card.setAttribute('data-empty', '1');
  const rows = mk('div', 'hub-dl-rows', null, null, { role: 'list' });
  list.forEach((ev, i) => { const r = deadlineRow(ev, o.names, view, o); r.setAttribute('role', 'listitem'); if (i >= MAX_ROWS) r.setAttribute('hidden', ''); add(rows, r); });
  if (n) add(card, rows);
  if (n > MAX_ROWS) {
    const more = n - MAX_ROWS;
    const b = mk('button', 'btn btn-outline btn-sm hub-dl-more', more + ' more', more + ' más', { type: 'button', 'aria-expanded': 'false', 'data-deadlines-more': String(more) });
    b.addEventListener('click', () => { for (const r of rows.querySelectorAll('[hidden]')) r.removeAttribute('hidden'); b.remove(); });
    add(card, add(mk('div', 'hub-more'), b));
  }
  const proposed = Number(view && view.proposed || 0);
  if (proposed > 0) {
    const a = mk('a', 'hub-dl-proposed', null, null, { href: '/hub/queue.html?kind=round', 'data-rounds-proposed': String(proposed) });
    add(a, dv('b', 'hub-num', String(proposed)), mk('span', null, proposed === 1 ? ' round date to confirm' : ' round dates to confirm', proposed === 1 ? ' fecha de ronda por confirmar' : ' fechas de ronda por confirmar'));
    add(card, add(mk('p', 'hub-dl-foot'), a));
  }
  return list;
}

/* ── the globe's country panel ──────────────────────────────────────── */

/** The confirmed event the panel names: the soonest still to come, else the latest dated one, else the first. */
export function nextEvent(events) {
  const list = confirmedOnly(events).map((e) => ({ e, d: daysOf(e) }));
  const coming = list.filter((x) => x.d !== null && x.d >= 0).sort((a, b) => a.d - b.d);
  if (coming.length) return coming[0].e;
  const dated = list.filter((x) => x.d !== null).sort((a, b) => b.d - a.d);
  return dated.length ? dated[0].e : (list[0] ? list[0].e : null);
}
/** The one line in the country panel: "Round: … · bid deadline 7 Oct 2026 (in 2 days)", "No open round" when none. */
export function roundLine(host, view, code) {
  host.textContent = '';
  host.removeAttribute('hidden');
  const c = view && Array.isArray(view.countries) ? view.countries.find((x) => x.country === code) : null;
  const ev = c && c.open ? nextEvent(c.events) : null;
  if (!c || !c.open) { host.setAttribute('data-round-state', 'none'); add(host, mk('span', null, 'No open round', 'Sin ronda abierta')); return host; }
  host.setAttribute('data-round-state', 'open');
  add(host, mk('span', 'hub-dl-lead', 'Round: ', 'Ronda: '));
  if (!ev) { add(host, mk('span', null, 'open, no dated step yet', 'abierta, aún sin paso con fecha')); return host; }
  const st = lower(stageLabel(ev.stage));
  add(host, dv('span', 'hub-dl-round', ev.round), mk('span', 'hub-dl-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', 'hub-dl-stage', st.en + (ev.event_date ? ' ' : ''), st.es + (ev.event_date ? ' ' : '')));
  if (ev.event_date) {
    const d = fmtEventDate(ev.event_date);
    add(host, mk('span', 'hub-dl-date', d.en, d.es, { 'data-date': ev.event_date }), mk('span', null, ' (', ' ('), fmtDays(daysOf(ev)), mk('span', null, ')', ')'));
  }
  return host;
}

/* ── What came in ───────────────────────────────────────────────────── */

/**
 * The confirmed deadlines confirmed since the person last looked, for the countries given: a line each, "moved to" when
 * an earlier event of the same round and stage sits in the view (superseded, or confirmed before it), "confirmed for"
 * when it is the first date of that step.
 */
export function movedLines(view, sinceMs, names, codes) {
  const out = [];
  if (!view || !Number.isFinite(sinceMs)) return out;
  for (const d of deadlinesFor(view, codes || null)) {
    const at = Date.parse(d.confirmed_at || '');
    if (!Number.isFinite(at) || at <= sinceMs) continue;
    const c = view.countries.find((x) => x.country === d.country);
    const earlier = ((c && c.events) || []).filter((e) => e && e.id !== d.id && e.round === d.round && e.stage === d.stage && (e.status === 'superseded' || (e.status === 'confirmed' && Date.parse(e.confirmed_at || '') < at)));
    const n = countryName(d.country, names, view), st = lower(stageLabel(d.stage)), dt = d.event_date ? fmtEventDate(d.event_date) : null;
    const moved = earlier.length > 0;
    out.push({
      id: d.id, code: d.country, moved,
      en: n.en + ': ' + st.en + (dt ? (moved ? ' moved to ' : ' confirmed for ') + dt.en : (moved ? ' changed' : ' confirmed')),
      es: n.es + ': ' + st.es + (dt ? (moved ? ' pasó al ' : ' confirmado para el ') + dt.es : (moved ? ' cambió' : ' confirmado')),
    });
  }
  return out;
}

/* ── the review queue ───────────────────────────────────────────────── */

/**
 * Fills a review-queue row's body for a proposal of kind `round`: the title with the round, the line with the country,
 * the stage, the date and the days, the verbatim quote as a blockquote, and the source chip. `tid` is the title's id for
 * the controls' aria-describedby.
 */
export function roundQueueBody(body, payload, tid, names) {
  const p = payload || {};
  const st = stageLabel(p.stage), n = countryName(p.country, names, null);
  add(body, add(mk('span', 't', null, null, { id: tid }), mk('span', null, 'Round date: ', 'Fecha de ronda: '), dv('b', null, p.round || p.title || '—')));
  const m = mk('span', 'm hub-dl-meta');
  add(m, mk('span', 'hub-dl-country', n.en, n.es), mk('span', 'hub-dl-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', 'hub-dl-stage', st.en, st.es));
  if (p.event_date) { const d = fmtEventDate(p.event_date); add(m, mk('span', 'hub-dl-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', 'hub-dl-date', d.en, d.es, { 'data-date': p.event_date }), document.createTextNode(' '), fmtDays(daysOf(p))); }
  else add(m, mk('span', 'hub-dl-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', 'hub-muted', 'no date on the page', 'sin fecha en la página'));
  add(body, m);
  if (p.quote) add(body, dv('blockquote', 'q-quote hub-dl-quote', p.quote, { cite: p.source_url || undefined }));
  add(body, add(mk('div', 'hub-dl-source'), mk('span', 'hub-muted', 'Read from ', 'Leído en '), sourceChip(p)));
  return body;
}
