/* ============================================================
   The country pack (wave 7, PR5, M; docs/vault-hub/wave7/05-markup.md §1.8,
   W7-AC19; 04-step-changes.md P1 "Where it appears"). One module renders the
   pack wherever it appears, from the shapes in vault/src/country/types.ts:

     GET  /api/countries/:code/pack            PackView (ten sections in order)
     POST /api/countries/:code/pack            202 {job_id, state}: queues a build

     import { packController, packCard, packSheetBody, packLine, packSummary, SECTIONS } from './components/country-pack.js';

   `packController(code)` fetches, hides on 404 or 501, queues a build and polls
   GET every interval while `job.status` is running. `packCard` is the card on the
   project page (ten rows, dots, the header line and the button); `packSheetBody`
   the bottom sheet for one section (sentences with a chip per citation, what
   changed, the questions, the sources and the caveat); `packLine` the one line in
   the globe's country panel; `packSummary` the words "assembled 5 Oct · 9 of 10 ·
   1 stale" that the card, the panel and Today share. Plain functions returning
   elements; every text carries data-en and data-es; figures are .hub-num/.hub-unit.
   ============================================================ */
import { mk, dv, add, api, fmtShortDate } from '../hub.js';

/** The ten sections, in the order the card shows them (vault/src/country/types.ts SECTIONS), with the short word Today uses. */
export const SECTIONS = [
  { id: 'legal',      en: 'Legal framework',                es: 'Marco legal',                         short: ['legal framework', 'marco legal'] },
  { id: 'licensing',  en: 'Licensing and the current round', es: 'Licencias y la ronda en curso',       short: ['licensing', 'licencias'] },
  { id: 'fiscal',     en: 'Fiscal terms',                    es: 'Términos fiscales',                   short: ['fiscal terms', 'términos fiscales'] },
  { id: 'companies',  en: 'Who works there',                 es: 'Quién opera allí',                    short: ['who works there', 'quién opera allí'] },
  { id: 'service',    en: 'The service industry',            es: 'La industria de servicios',           short: ['service industry', 'industria de servicios'] },
  { id: 'regulator',  en: 'Regulator and data room',         es: 'Regulador y sala de datos',           short: ['regulator', 'regulador'] },
  { id: 'production', en: 'Production, reserves and market', es: 'Producción, reservas y mercado',      short: ['production', 'producción'] },
  { id: 'risk',       en: 'Risk and context',                es: 'Riesgo y contexto',                   short: ['risk', 'riesgo'] },
  { id: 'literature', en: 'Technical literature',            es: 'Literatura técnica',                  short: ['literature', 'literatura'] },
  { id: 'questions',  en: 'What no source answered',         es: 'Lo que ninguna fuente respondió',     short: ['open questions', 'preguntas abiertas'] },
];
const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/** The five freshness states: the word, its tone, and how bad it is (the panel shows the worst). */
export const STATUS = {
  fresh:       { en: 'fresh',       es: 'vigente',      tone: 'ok',    rank: 0 },
  empty:       { en: 'not drafted', es: 'sin redactar', tone: 'muted', rank: 1 },
  due:         { en: 'due',         es: 'por vencer',   tone: 'warn',  rank: 2 },
  unreachable: { en: 'unreachable', es: 'inaccesible',  tone: 'muted', rank: 3 },
  stale:       { en: 'stale',       es: 'obsoleta',     tone: 'bad',   rank: 4 },
  /** The sources answered but the Vault's own file store refused them: ours to fix, so it ranks with stale and reads red. */
  unfiled:     { en: 'not filed',   es: 'sin archivar', tone: 'bad',   rank: 4 },
  /** The originals are filed but the drafting assistant failed on the build (no credit, a refused key): ours to fix too. */
  failed:      { en: 'not drafted', es: 'sin redactar', tone: 'bad',   rank: 4 },
};
/** A section left empty because the drafting failed: the Vault writes stale_reason "draft failed: <the provider's error>". */
const isDraftFailed = (s) => !!s && s.status === 'empty' && /^draft failed:/.test(String(s.stale_reason || ''));
/** The provider's error in the owner's words, with where it is fixed. */
function draftFailureWhy(s) {
  const raw = String((s && s.stale_reason) || '').replace(/^draft failed:\s*/, '');
  if (/model budget spent today/i.test(raw)) return { en: "the Vault's daily model budget is spent; it resets at 00:00 UTC, or raise VAULT_DAILY_BUDGET_GBP on the API service", es: 'el presupuesto diario del modelo de la Bóveda está agotado; se reinicia a las 00:00 UTC, o eleve VAULT_DAILY_BUDGET_GBP en el servicio de la API' };
  if (/credit balance|purchase credits/i.test(raw)) return { en: 'the Anthropic account has no credit; add credits under Plans & Billing at console.anthropic.com', es: 'la cuenta de Anthropic no tiene crédito; añada crédito en Plans & Billing en console.anthropic.com' };
  if (/\b429\b|rate.?limit/i.test(raw)) return { en: 'the drafting assistant is rate limited; try again in a few minutes', es: 'el asistente de redacción está limitado por tasa; inténtelo en unos minutos' };
  if (/\b401\b|authentication|api.?key|x-api-key/i.test(raw)) return { en: 'the drafting key was refused; check ANTHROPIC_API_KEY on the API service', es: 'la clave de redacción fue rechazada; revise ANTHROPIC_API_KEY en el servicio de la API' };
  if (/no provider|not.?configured/i.test(raw)) return { en: 'no drafting assistant is connected (vault/SETUP.md §5)', es: 'no hay asistente de redacción conectado (vault/SETUP.md §5)' };
  const m = raw.slice(0, 120); return { en: m, es: m };
}
/** A section the store could not file: the Vault records it unreachable with a stale_reason that starts "storage:". */
const isUnfiled = (s) => !!s && s.status === 'unreachable' && /^storage:/.test(String(s.stale_reason || ''));
const statusOf = (s) => (isUnfiled(s) ? STATUS.unfiled : isDraftFailed(s) ? STATUS.failed : STATUS[s && s.status] || STATUS.empty);
/** The owner's reason, from the stale_reason the Vault wrote ("storage:the storage bucket does not exist"). */
const unfiledWhy = (s) => String((s && s.stale_reason) || '').replace(/^storage:/, '');
const isBuilt = (s) => !!s && Number(s.version || 0) > 0 && s.status !== 'empty';

/** The caveat under a section (the body's own when the drafter wrote one; the orientation line for legal and fiscal; the service section's honest "no public register"). */
const ORIENTATION = { en: 'Orientation for screening; verify against the instrument in force.', es: 'Orientación para el cribado; verifique contra el instrumento vigente.' };
const NO_REGISTER = /no public register|sin registro p[uú]blico|no existe un registro p[uú]blico/i;
const NO_REGISTER_CAVEAT = { en: 'No public register of service companies; only the firm\'s own contacts are named, nothing from marketing pages.', es: 'Sin registro público de empresas de servicios; solo se nombran los contactos de la firma, nada de páginas comerciales.' };
export function caveatOf(section) {
  if (!section) return null;
  const b = section.body || {};
  if (b.caveat) return typeof b.caveat === 'string' ? { en: b.caveat, es: b.caveat } : { en: b.caveat.en || '', es: b.caveat.es || b.caveat.en || '' };
  if (!isBuilt(section)) return null;
  if (section.section === 'legal' || section.section === 'fiscal') return ORIENTATION;
  if (section.section === 'service') {
    const h = b.headline || {};
    if (NO_REGISTER.test(h.en || '') || (b.sentences || []).some((s) => NO_REGISTER.test(s.en || ''))) return NO_REGISTER_CAVEAT;
  }
  return null;
}

/** The ten sections of a pack in SECTIONS order, every one present (a missing one rendered as never built). */
export function orderedSections(pack) {
  const by = new Map(((pack && pack.sections) || []).map((s) => [s.section, s]));
  return SECTIONS.map((d) => by.get(d.id) || { section: d.id, title: { en: d.en, es: d.es }, version: 0, status: 'empty', stale_reason: null, built_at: null, ttl_days: null, due_at: null, body: { headline: null, sentences: [], questions: [], changed_since: [] }, sources: [] });
}
const titleOf = (s) => { const d = SECTION_BY_ID.get(s.section); return { en: (s.title && s.title.en) || (d && d.en) || s.section, es: (s.title && s.title.es) || (d && d.es) || (s.title && s.title.en) || s.section }; };
export const shortWord = (id) => { const d = SECTION_BY_ID.get(id); return d ? { en: d.short[0], es: d.short[1] } : { en: id, es: id }; };

/** "5 Oct" in both languages: the day the pack carries in its header and on Today. */
export function fmtDayMonth(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { en: '—', es: '—' };
  return { en: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), es: d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) };
}
/** The worst section of a pack by freshness (stale before unreachable before due), or null when nothing is built. */
export function worstSection(pack) {
  let worst = null;
  for (const s of orderedSections(pack)) if (isBuilt(s) || s.status === 'unreachable' || isDraftFailed(s)) if (!worst || statusOf(s).rank > statusOf(worst).rank) worst = s;
  return worst;
}
const n = (pack, k) => Number((pack && pack.counts && pack.counts[k]) || 0);
const fig = (value, unitEn, unitEs) => { const f = mk('span', 'hub-fig', null, null, { 'data-count': unitEn.replace(/\s+/g, '-') }); add(f, dv('span', 'hub-num', String(value))); if (unitEn) add(f, document.createTextNode(' '), mk('span', 'hub-unit', unitEn, unitEs)); return f; };

/**
 * The words the card, the panel and Today share: "assembled 5 Oct · 9 of 10 · 1 stale" (the non-zero of stale, due and
 * unreachable after the count), or "not assembled yet". Returns an element; `lead` is the word before it ("Pack:" or "Assembled").
 */
export function packSummary(pack, opts) {
  const o = opts || {};
  const el = mk('span', 'hub-pack-summary', null, null, { 'data-pack-summary': '', 'data-assembled-at': pack && pack.assembled_at ? String(pack.assembled_at).slice(0, 10) : '' });
  if (o.lead) add(el, mk('span', 'hub-pack-lead', o.lead.en, o.lead.es), document.createTextNode(' '));
  if (!pack || !pack.assembled_at) { add(el, mk('span', null, o.capital ? 'Not assembled yet' : 'not assembled yet', o.capital ? 'Aún sin armar' : 'aún sin armar')); return el; }
  const d = fmtDayMonth(pack.assembled_at);
  add(el, mk('span', null, (o.capital ? 'Assembled ' : 'assembled ') + d.en, (o.capital ? 'Armado el ' : 'armado el ') + d.es));
  const total = orderedSections(pack).length;
  const built = pack.counts && typeof pack.counts.built === 'number' ? pack.counts.built : orderedSections(pack).filter(isBuilt).length;
  add(el, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), add(mk('span', 'hub-fig', null, null, { 'data-count': 'built' }), dv('span', 'hub-num', String(built)), mk('span', null, ' of ', ' de '), dv('span', 'hub-num', String(total))));
  // Sections the store could not file are counted apart from the publishers that did not answer.
  const unfiled = orderedSections(pack).filter(isUnfiled).length;
  for (const [k, en, es] of [['stale', 'stale', 'obsoleta'], ['due', 'due', 'por vencer'], ['unreachable', 'unreachable', 'inaccesible']]) {
    const v = k === 'unreachable' ? Math.max(0, n(pack, k) - unfiled) : n(pack, k);
    if (v) add(el, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), fig(v, en, es));
  }
  if (unfiled) { const f = fig(unfiled, 'not filed', 'sin archivar'); f.classList.add('bad'); add(el, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), f); }
  return el;
}

/** The dot: fresh gold, due amber, stale red, unreachable hollow grey, empty grey; as-of and due in its title. */
function dot(section) {
  const t = [];
  if (section.built_at) { const a = fmtShortDate(section.built_at); t.push('as of ' + a.en); }
  if (section.due_at) { const d = fmtShortDate(section.due_at); t.push('due ' + d.en); }
  const st = statusOf(section);
  return mk('span', 'hub-pack-dot', null, null, { 'data-status': isUnfiled(section) ? 'unfiled' : isDraftFailed(section) ? 'failed' : section.status || 'empty', title: t.length ? t.join(' · ') : st.en, 'aria-hidden': 'true' });
}
const statusPill = (section) => { const st = statusOf(section); return mk('span', 'hub-pill ' + st.tone, st.en, st.es, { 'data-status': isUnfiled(section) ? 'unfiled' : isDraftFailed(section) ? 'failed' : section.status || 'empty' }); };

/**
 * The card on the project page. `opts`: onOpen(section, trigger), onAssemble(trigger), state ('ready' | 'none' |
 * 'building'), job (the open job, when building). Re-rendered whole by the controller on every change.
 */
export function packCard(host, pack, opts) {
  const o = opts || {};
  host.textContent = '';
  const built = !!(pack && pack.assembled_at);
  const building = o.state === 'building';
  host.setAttribute('data-pack-state', o.state || (built ? 'ready' : 'none'));
  const head = mk('div', 'hub-card-head hub-pack-head');
  const left = mk('div');
  add(left, mk('h3', null, 'Country pack', 'Paquete del país', { id: 'h-pack' }), packSummary(pack, { capital: true }));
  add(head, left);
  // Drafting failed on the last build: said once, at the top, with where it is fixed; the rows below stay honest.
  const failed = pack && Array.isArray(pack.sections) ? pack.sections.find(isDraftFailed) : null;
  if (failed && !building) {
    const why = draftFailureWhy(failed);
    const nt = mk('p', 'hub-notice bad', 'Drafting failed on the last build: ' + why.en + '. The originals are filed; press Refresh once it is fixed.', 'La redacción falló en la última construcción: ' + why.es + '. Los originales están archivados; pulse Actualizar cuando esté corregido.', { 'data-draft-failed': '', title: String(failed.stale_reason || '') });
    add(left, nt);
  }
  const actions = mk('div', 'hub-pack-actions');
  const job = mk('span', 'hub-pack-job', null, null, { 'data-pack-job': '', role: 'status' });
  if (building) add(job, mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' Assembling…', ' Armando…'));
  else if (o.failed) { job.setAttribute('data-failed', '1'); add(job, mk('span', null, 'The last build failed; try again.', 'La última construcción falló; inténtelo de nuevo.')); }
  else job.setAttribute('hidden', '');
  const btn = mk('button', 'btn btn-sm ' + (built ? 'btn-outline' : 'btn-primary'), built ? 'Refresh' : 'Assemble the pack', built ? 'Actualizar' : 'Armar el paquete', { type: 'button', 'data-pack-assemble': '' });
  if (building) btn.disabled = true;
  if (o.onAssemble) btn.addEventListener('click', () => o.onAssemble(btn));
  add(actions, job, btn);
  add(head, actions);
  add(host, head);
  const list = mk('ol', 'hub-pack-rows');
  for (const s of orderedSections(pack)) {
    const t = titleOf(s);
    const li = mk('li', 'hub-pack-row', null, null, { 'data-pack-row': s.section, 'data-status': isUnfiled(s) ? 'unfiled' : isDraftFailed(s) ? 'failed' : s.status || 'empty', 'data-version': String(s.version || 0) });
    const b = mk('button', 'hub-pack-open', null, null, { type: 'button', 'data-pack-open': s.section, 'aria-haspopup': 'dialog', 'aria-controls': 'pack-sheet' });
    add(b, dot(s), mk('span', 'hub-pack-title', t.en, t.es));
    const h = s.body && s.body.headline;
    if (h && h.en) add(b, mk('span', 'hub-pack-headline', h.en, h.es || h.en));
    else if (s.status === 'unreachable') add(b, mk('span', 'hub-pack-headline hub-muted', 'No source reached.', 'No se alcanzó ninguna fuente.'));
    else if (isDraftFailed(s)) add(b, mk('span', 'hub-pack-headline', 'Not drafted: the drafting assistant failed on the last build; see the notice above.', 'Sin redactar: el asistente de redacción falló en la última construcción; vea el aviso de arriba.'));
    else add(b, mk('span', 'hub-pack-headline hub-muted', 'This section is not drafted yet.', 'Esta sección aún no está redactada.'));
    if (o.onOpen) b.addEventListener('click', () => o.onOpen(s, b));
    add(li, b);
    const cv = caveatOf(s);
    if (cv) add(li, mk('p', 'hub-pack-caveat', cv.en, cv.es, { 'data-caveat': '' }));
    add(list, li);
  }
  add(host, list);
  if (pack && typeof pack.spend_gbp === 'number' && pack.spend_gbp > 0) add(host, add(mk('p', 'hub-muted hub-note-s hub-pack-spend'), mk('span', null, 'Public sources only; the last build cost ', 'Solo fuentes públicas; la última construcción costó '), add(mk('span', 'hub-fig'), dv('span', 'hub-num', '£' + (Math.round(pack.spend_gbp * 100) / 100).toFixed(2)))));
  return host;
}

/** The sources of a section keyed by the item id they were stored as, so a citation finds its attribution and fetch date. */
function sourcesByItem(section) {
  const by = new Map();
  for (const s of (section && section.sources) || []) if (s && s.item_id) by.set(String(s.item_id), s);
  return by;
}
const citeId = (c) => String(c || '').replace(/^\[|\]$/g, '').replace(/^doc:/, '');

/**
 * The body of the bottom sheet for one section: the status and as-of line, the sentences in the current language
 * with a chip per citation (attribution · fetched), what changed, the questions, the sources with their licence and
 * attribution, the caveat. `opts.onCite({itemId, sentence, source, trigger})` opens the original.
 */
export function packSheetBody(section, opts) {
  const o = opts || {};
  const body = mk('div', 'hub-pack-sheet-body', null, null, { 'data-pack-sheet': section.section });
  const meta = mk('p', 'hub-pack-meta', null, null, { 'data-pack-meta': '' });
  add(meta, statusPill(section));
  if (section.built_at) { const d = fmtShortDate(section.built_at); add(meta, mk('span', 'hub-asof-date', ' · as of ' + d.en, ' · al ' + d.es)); }
  if (section.due_at) { const d = fmtShortDate(section.due_at); add(meta, mk('span', 'hub-asof-date', ' · due ' + d.en, ' · vence el ' + d.es)); }
  if (section.stale_reason && !isUnfiled(section) && !isDraftFailed(section)) add(meta, document.createTextNode(' · '), dv('span', 'hub-pack-reason', section.stale_reason));
  add(body, meta);
  if (isDraftFailed(section)) {
    const why = draftFailureWhy(section);
    add(body, mk('p', 'hub-notice bad', 'Drafting failed on the last build: ' + why.en + '. The originals below are filed; press Refresh once it is fixed.', 'La redacción falló en la última construcción: ' + why.es + '. Los originales de abajo están archivados; pulse Actualizar cuando esté corregido.', { 'data-draft-failed': '', title: String(section.stale_reason || '') }));
  }
  // The store's fault is said in full, with where it is fixed, before anything else in the sheet.
  if (isUnfiled(section)) {
    const why = unfiledWhy(section);
    add(body, mk('p', 'hub-notice bad', 'The sources answered but the Vault could not file them' + (why ? ': ' + why : '') + '. Nothing is drafted until the file store works; it is set up in vault/SETUP.md §1.5. Press Refresh once it is fixed.',
      'Las fuentes respondieron pero la Bóveda no pudo archivarlas' + (why ? ': ' + why : '') + '. Nada se redacta hasta que el almacén de archivos funcione; se configura en vault/SETUP.md §1.5. Pulse Actualizar cuando esté corregido.', { 'data-unfiled': '' }));
  }

  const byItem = sourcesByItem(section);
  const sentences = Array.isArray(section.body && section.body.sentences) ? section.body.sentences : [];
  const list = mk('div', 'hub-pack-sentences');
  for (const s of sentences) {
    const p = mk('p', 'hub-pack-sentence', null, null, { 'data-sentence': '' });
    add(p, mk('span', 'hub-pack-text', s.en, s.es || s.en));
    for (const c of s.cites || []) {
      const id = citeId(c);
      const src = byItem.get(id) || null;
      const f = src && src.fetched_at ? fmtShortDate(src.fetched_at) : null;
      const label = src ? { en: src.attribution + (f ? ' · ' + f.en : ''), es: src.attribution + (f ? ' · ' + f.es : '') } : { en: 'original ' + id.slice(0, 8), es: 'original ' + id.slice(0, 8) };
      const chip = mk('button', 'hub-cite hub-pack-chip', label.en, label.es, { type: 'button', 'data-cite': 'doc:' + id, 'data-item': id, title: src ? src.licence : 'Open the original', 'aria-label': 'Open the original: ' + label.en });
      if (src && src.note) chip.setAttribute('data-note', src.note);
      if (o.onCite) chip.addEventListener('click', () => o.onCite({ itemId: id, sentence: s.en, sentenceEs: s.es, source: src, trigger: chip }));
      add(p, document.createTextNode(' '), chip);
    }
    add(list, p);
  }
  if (!sentences.length) {
    const w = isUnfiled(section) ? ['Reached, not filed: see the notice above.', 'Alcanzadas, sin archivar: vea el aviso de arriba.']
      : isDraftFailed(section) ? ['Not drafted: see the notice above.', 'Sin redactar: vea el aviso de arriba.']
      : section.status === 'unreachable' ? ['No source reached: nothing is drafted until one answers.', 'No se alcanzó ninguna fuente: nada se redacta hasta que una responda.']
      : isBuilt(section) ? ['Nothing to say yet beyond the headline.', 'Nada que decir todavía más allá del titular.']
        : ['This section is not drafted yet. Assemble the pack to write it.', 'Esta sección aún no está redactada. Arme el paquete para escribirla.'];
    add(list, mk('p', 'hub-muted', w[0], w[1], { 'data-no-sentences': '' }));
  }
  add(body, list);

  const block = (key, en, es, items) => {
    if (!items || !items.length) return;
    const b = mk('div', 'hub-pack-block', null, null, { ['data-' + key]: '' });
    add(b, mk('h4', null, en, es));
    const ul = mk('ul');
    for (const it of items) add(ul, mk('li', null, it.en, it.es || it.en));
    add(b, ul); add(body, b);
  };
  block('changed', 'What changed', 'Qué cambió', section.body && section.body.changed_since);
  block('questions', 'What no source answered', 'Lo que ninguna fuente respondió', section.body && section.body.questions);

  const sources = Array.isArray(section.sources) ? section.sources : [];
  if (sources.length) {
    const b = mk('div', 'hub-pack-block', null, null, { 'data-sources': '' });
    add(b, mk('h4', null, 'Sources, licence and attribution', 'Fuentes, licencia y atribución'));
    const ul = mk('ul', 'hub-pack-sources');
    for (const s of sources) {
      const li = mk('li', null, null, null, { 'data-source': s.id, 'data-reachable': String(s.reachable !== false), ...(s.fault ? { 'data-fault': s.fault } : {}) });
      add(li, s.url ? dv('a', 'hub-inline-link', s.attribution || s.id, { href: s.url, target: '_blank', rel: 'noopener noreferrer' }) : dv('span', null, s.attribution || s.id));
      if (s.licence) add(li, dv('span', 'hub-muted', ' · ' + s.licence));
      if (s.fetched_at) { const d = fmtShortDate(s.fetched_at); add(li, mk('span', 'hub-muted', ' · fetched ' + d.en, ' · obtenido el ' + d.es)); }
      if (s.fault === 'storage') add(li, document.createTextNode(' '), mk('span', 'hub-pill bad', 'reached, not filed', 'alcanzada, sin archivar'));
      else if (s.reachable === false) add(li, document.createTextNode(' '), mk('span', 'hub-pill muted', 'unreachable', 'inaccesible'));
      if (s.note) add(li, dv('span', 'hub-muted', ' · ' + s.note));
      add(ul, li);
    }
    add(b, ul); add(body, b);
  }
  const cv = caveatOf(section);
  if (cv) add(body, mk('p', 'hub-pack-caveat', cv.en, cv.es, { 'data-caveat': '' }));
  return body;
}

/** The one line in the globe's country panel: "Pack: assembled 5 Oct · 9 of 10 · 1 stale · worst: licensing stale", or the button when none exists. */
export function packLine(host, pack, opts) {
  const o = opts || {};
  host.textContent = '';
  const built = !!(pack && pack.assembled_at);
  const state = o.state || (built ? 'ready' : 'none');
  host.setAttribute('data-pack-state', state);
  host.removeAttribute('hidden');
  add(host, packSummary(pack, { lead: { en: 'Pack:', es: 'Paquete:' } }));
  const w = worstSection(pack);
  if (built && w && w.status !== 'fresh') {
    const sw = shortWord(w.section), st = statusOf(w);
    add(host, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), add(mk('span', 'hub-pack-worst', null, null, { 'data-pack-worst': w.section, 'data-status': w.status }), mk('span', null, sw.en + ' ', sw.es + ' '), mk('span', 'hub-pill ' + st.tone, st.en, st.es)));
  }
  if (state === 'building') add(host, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', 'hub-spin', null, null, { 'aria-hidden': 'true' }), mk('span', null, ' Assembling…', ' Armando…'));
  else if (o.failed) add(host, mk('span', 'hub-pack-sep', ' · ', ' · ', { 'aria-hidden': 'true' }), mk('span', null, 'the last build failed', 'la última construcción falló'));
  if (!built && state !== 'building' && o.onAssemble) {
    const b = mk('button', 'btn btn-outline btn-sm', 'Assemble the pack', 'Armar el paquete', { type: 'button', id: 'country-pack-assemble' });
    b.addEventListener('click', () => o.onAssemble(b));
    add(host, document.createTextNode(' '), b);
  }
  return host;
}

/**
 * Reads and builds one country's pack. `onChange(pack, state)` fires after every read; state is 'ready', 'none',
 * 'building', 'failed' or 'unavailable' (404 or 501: the Vault has no pack route; the caller hides what it shows).
 * `assemble()` POSTs and polls GET every `pollMs` while the job runs. One controller per code; `stop()` ends the polling.
 */
export function packController(code, onChange, opts) {
  const o = opts || {};
  const path = '/api/countries/' + encodeURIComponent(code) + '/pack';
  const pollMs = () => Number(window.HUB_PACK_POLL_MS) || Number(o.pollMs) || 10000;
  let pack = null, timer = null, stopped = false, failed = false;
  const state = () => (!pack ? 'none' : pack.job && pack.job.status === 'running' ? 'building' : pack.assembled_at ? 'ready' : 'none');
  const emit = (st) => { if (!stopped) onChange(pack, st, { failed }); };
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; load(); }, pollMs()); };
  async function load() {
    const r = await api(path);
    if (stopped) return null;
    if (r.status === 404 || r.status === 501) { pack = null; emit('unavailable'); return null; }
    if (!r.ok || !r.body || typeof r.body !== 'object' || r.body.error) { emit(pack ? state() : 'unavailable'); return pack; }
    pack = r.body;
    failed = !!(pack.job && pack.job.status === 'failed') && !pack.assembled_at;
    const st = state();
    emit(st);
    if (st === 'building') schedule();
    return pack;
  }
  async function assemble() {
    const r = await api(path, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
    if (stopped) return r;
    if (r.ok || r.status === 202) {
      failed = false;
      pack = Object.assign({}, pack || { country: code, assembled_at: null, sections: [], counts: {}, spend_gbp: 0 }, { job: { id: r.body && r.body.job_id, status: 'running', started_at: new Date().toISOString() } });
      emit('building');
      schedule();
    } else { failed = true; emit(pack && pack.assembled_at ? 'ready' : 'none'); }
    return r;
  }
  function stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; }
  return { load, assemble, stop, get pack() { return pack; }, get state() { return state(); } };
}
