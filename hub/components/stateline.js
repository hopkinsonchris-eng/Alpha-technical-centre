/* ============================================================
   <hub-stateline> (wave 7, PR2, idea B / R1). One line that states where a
   project stands: STAGE · NEXT · LAST · NDA · counts. It is the project
   header, the register row on Today and in the country panel, and the Find
   result card, so the same facts render once and read the same everywhere.

     import { stateline } from './components/stateline.js';
     add(host, stateline(project, { size: 'full' | 'row' | 'card', now }));

   `project` is a row from GET /api/projects (id, name, stage, stage_history,
   status, register.next, register.owner, run_count, item_count, stale_count,
   last_activity_at, country) with, when known, `last_activity` ({title, at,
   ref}) and `legal_tag_expiry` (ISO date). Missing facts render as a quiet
   empty token, never as a dash soup.

   Every token is a link into the project file at the thing it names:
     stage → project.html?id=…#stage      next → #next      last → #timeline (or the record)
     nda   → #file                        runs → #tab-runs  docs → #tab-docs   stale → #stale
   Plain function returning an element; every text carries data-en and data-es.
   ============================================================ */
import { mk, add, ago, fmtStamp, fmtShortDate, STAGE_ES } from '../hub.js';

/** Stage tone for the dot: early stages are neutral, live stages gold, closed ones muted. */
const STAGE_TONE = { 'Initial screen': 'early', Qualified: 'early', 'Technical review': 'live', 'Commercial review': 'live', Negotiation: 'live', Won: 'won', Lost: 'closed', Closed: 'closed' };

// The language toggle rewrites the text of any element that carries data-en/data-es, so a token's own words live
// in a child span and the anchor itself carries no pair; children (the dot, the label, the date) survive a toggle.
const link = (project, hash, token, en, es, extra) => {
  const a = mk('a', 'hub-sl-token', null, null, Object.assign({ href: '/hub/project.html?id=' + encodeURIComponent(project.id) + (hash ? '#' + hash : ''), 'data-token': token }, extra || {}));
  if (en !== '' && en !== null && en !== undefined) add(a, mk('span', 'hub-sl-text', en, es));
  return a;
};
const label = (en, es) => mk('span', 'hub-sl-label', en, es);
const sep = () => mk('span', 'hub-sl-sep', '·', '·', { 'aria-hidden': 'true' });

function stageSince(project) {
  const h = Array.isArray(project.stage_history) ? project.stage_history : [];
  const last = h.length ? h[h.length - 1] : null;
  return last && last.at ? last.at : null;
}

/**
 * Build the stateline. `size`: 'full' (the project header: every token, two rows at phone width),
 * 'row' (register rows: name, stage dot, next, last age), 'card' (Find results: stage dot, next, last age, counts).
 * `stageControl` (full only): an element, normally the stage <select>, rendered as the stage token itself.
 */
export function stateline(project, opts) {
  const o = Object.assign({ size: 'full', now: new Date() }, opts || {});
  const stage = project.stage || (project.status === 'archived' ? 'Closed' : '');
  const tone = STAGE_TONE[stage] || 'early';
  const el = mk('div', 'hub-stateline hub-stateline-' + o.size, null, null, { 'data-stateline': o.size, 'data-project': project.id, 'data-stage': stage || '', 'data-tone': tone, role: 'group' });
  el.setAttribute('aria-label', 'Where ' + (project.name || project.id) + ' stands');

  if (o.size === 'row') {
    const name = mk('a', 'hub-sl-name', null, null, { href: '/hub/project.html?id=' + encodeURIComponent(project.id), 'data-token': 'name' });
    add(name, mk('span', 'hub-sl-text', project.name || project.id, project.name || project.id));
    add(el, name);
  }

  // STAGE ● since. The project header (PR2 D, R1) passes `stageControl`, the stage <select>: the token then IS the
  // control, so tapping it opens the stage list as a native popover; everywhere else the token links to #stage.
  let st;
  if (o.size === 'full' && o.stageControl) {
    st = mk('span', 'hub-sl-token hub-sl-stage', null, null, { 'data-token': 'stage', 'data-stage-control': '' });
    add(st, o.stageControl);
  } else st = link(project, 'stage', 'stage', stage || 'No stage', stage ? (STAGE_ES[stage] || stage) : 'Sin etapa');
  st.insertBefore(mk('span', 'hub-sl-dot', null, null, { 'aria-hidden': 'true' }), st.firstChild);
  const since = stageSince(project);
  if (o.size === 'full' && since) {
    const d = fmtShortDate(since);
    add(st, mk('span', 'hub-sl-since', ' since ' + d.en, ' desde ' + d.es));
  }
  add(el, st);

  // NEXT  action · owner
  const next = project.register && project.register.next ? String(project.register.next) : '';
  const owner = project.register && project.register.owner ? String(project.register.owner) : '';
  if (next || o.size === 'full') {
    add(el, sep());
    const nx = link(project, 'next', 'next', next || 'No next step', next || 'Sin siguiente paso', next ? {} : { 'data-empty': '1' });
    nx.insertBefore(label('Next', 'Siguiente'), nx.firstChild);
    if (next && owner && o.size !== 'card') add(nx, mk('span', 'hub-sl-owner', ' · ' + owner, ' · ' + owner));
    add(el, nx);
  }

  // LAST  title, when
  const lastAt = (project.last_activity && project.last_activity.at) || project.last_activity_at || null;
  const lastTitle = project.last_activity && project.last_activity.title ? String(project.last_activity.title) : '';
  add(el, sep());
  const lastHash = project.last_activity && project.last_activity.ref ? 'rec=' + encodeURIComponent(project.last_activity.ref) : 'timeline';
  const la = link(project, lastHash, 'last', '', '', lastAt ? {} : { 'data-empty': '1' });
  add(la, label('Last', 'Último'));
  if (lastAt) {
    const when = o.size === 'full' ? fmtStamp(lastAt) : ago(lastAt, o.now);
    if (o.size === 'full' && lastTitle) add(la, mk('span', 'hub-sl-title', lastTitle, lastTitle), mk('span', 'hub-sl-when', ', ' + when.en, ', ' + when.es));
    else add(la, mk('span', 'hub-sl-when', when.en, when.es));
  } else add(la, mk('span', 'hub-sl-when', 'Nothing yet', 'Nada aún'));
  add(el, la);

  if (o.size === 'full') {
    // NDA to date (only when the project carries a dated tag)
    if (project.legal_tag_expiry) {
      add(el, sep());
      const d = fmtShortDate(project.legal_tag_expiry);
      const nda = link(project, 'file', 'nda', 'NDA to ' + d.en, 'NDA hasta ' + d.es);
      add(el, nda);
    }
  }

  if (o.size !== 'row') {
    // counts: runs · docs · stale (stale only when non-zero)
    const runs = Number(project.run_count || 0), docs = Number(project.item_count || 0), stale = Number(project.stale_count || 0);
    add(el, sep(), link(project, 'tab-runs', 'runs', runs + (runs === 1 ? ' run' : ' runs'), runs + (runs === 1 ? ' ejecución' : ' ejecuciones')));
    add(el, sep(), link(project, 'tab-docs', 'docs', docs + (docs === 1 ? ' doc' : ' docs'), docs + (docs === 1 ? ' doc' : ' docs')));
    if (stale > 0) add(el, sep(), link(project, 'stale', 'stale', stale + ' stale', stale + (stale === 1 ? ' obsoleto' : ' obsoletos'), { 'data-tone': 'warn' }));
  } else if (Number(project.stale_count || 0) > 0) {
    add(el, mk('span', 'hub-sl-flag', '●', '●', { 'data-tone': 'warn', title: project.stale_count + ' stale', 'aria-label': project.stale_count + ' stale' }));
  }
  return el;
}

/** Re-render a stateline in place when the project changes (the header after a stage change). */
export function refreshStateline(el, project, opts) {
  const fresh = stateline(project, opts);
  el.replaceWith(fresh);
  return fresh;
}

