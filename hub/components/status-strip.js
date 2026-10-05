/* ============================================================
   The status strip (wave 7 PR2, signature idea C, R4 part 1). A 28 px line
   under the top bar on every Hub page, in the sidebar navy with gold figures:

     ● Vault synced 14:02 · mail polled 13:58 · 3 need you · 12 came in ·
       1 to file · 0 stale · 1 lesson to confirm

   Each figure is a link to the place it counts; zeros are dimmed, never
   hidden; a figure whose source did not answer is left out rather than shown
   as a number. When the Vault is unreachable the strip renders a quiet dash.

     import { mountStatusStrip } from './components/status-strip.js';
     const strip = mountStatusStrip();          // once per page, after .hub-top
     strip.load(['health', 'mailbox', 'activity', 'filing', 'lessons', 'stale']);
     strip.set('stale', 3);                     // a page that already holds a count feeds it

   Sources: GET /api/health (synced), GET /api/me/mailbox (polled, when
   connected), GET /api/me/activity (need you, came in), GET /api/queue/filing
   (to file), GET /api/lessons?status=proposed (lessons), and for the stale
   count either what the page fetched or the per-project counts on
   GET /api/projects. The Queues entry in the sidebar carries filing plus
   lessons from the same figures (R3). Plain functions; every text carries
   data-en and data-es.
   ============================================================ */
import { mk, add, api, listOf, setText } from '../hub.js';

const hm = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; };

/** The figures, in strip order: key, href, and the bilingual wording for a count. */
const FIGURES = [
  { key: 'need', href: '/hub/queue.html?kind=review', text: (n) => [n + ' need you', n + ' le esperan'] },
  { key: 'came', href: '/hub/index.html#sec-activity', text: (n) => [n + ' came in', n + (n === 1 ? ' llegó' : ' llegaron')] },
  { key: 'file', href: '/hub/queue.html', text: (n) => [n + ' to file', n + ' por archivar'] },
  { key: 'stale', href: '/hub/index.html#card-stale', text: (n) => [n + ' stale', n + (n === 1 ? ' obsoleto' : ' obsoletos')] },
  { key: 'lessons', href: '/hub/queue.html?kind=lesson', text: (n) => [n + (n === 1 ? ' lesson to confirm' : ' lessons to confirm'), n + (n === 1 ? ' lección por confirmar' : ' lecciones por confirmar')] },
];

let instance = null;

/** Builds the strip after the top bar (or returns the one already built) and returns its controller. */
export function mountStatusStrip() {
  if (instance) return instance;
  const top = document.querySelector('.hub-main .hub-top');
  if (!top) return null;
  const el = mk('div', 'hub-strip', null, null, { id: 'hub-strip', role: 'status', 'aria-live': 'polite', 'data-state': 'unknown' });
  const dot = mk('span', 'hub-strip-dot', '●', '●', { 'aria-hidden': 'true' });
  const vault = mk('span', 'hub-strip-fig', 'Vault not checked', 'Vault sin comprobar', { 'data-figure': 'vault', id: 'vault-state' });
  const mail = mk('span', 'hub-strip-fig', 'mail not connected', 'correo sin conectar', { 'data-figure': 'mail', 'data-zero': '1' });
  add(el, dot, vault, sep(), mail);
  const links = new Map();
  for (const f of FIGURES) {
    const s = sep();
    const a = mk('a', 'hub-strip-fig', null, null, { 'data-figure': f.key, href: f.href, hidden: '' });
    s.setAttribute('hidden', '');
    add(el, s, a);
    links.set(f.key, { a, s, f });
  }
  top.insertAdjacentElement('afterend', el);

  const state = { vault: 'unknown', figures: {} };
  const paint = () => {
    el.setAttribute('data-state', state.vault);
    const off = state.vault === 'off';
    dot.setAttribute('data-off', off ? '1' : '0');
    setText(dot, off ? '—' : '●', off ? '—' : '●');
    if (state.vault === 'synced') setText(vault, 'Vault synced ' + state.at, 'Vault sincronizado ' + state.at);
    else if (state.vault === 'on') setText(vault, 'Vault reachable', 'Vault accesible');
    else if (off) setText(vault, 'Vault unreachable', 'Vault no accesible');
    else setText(vault, 'Vault not checked', 'Vault sin comprobar');
    // Off: the figures would be guesses, so only the dash and the mail line remain.
    for (const { a, s, f } of links.values()) {
      const n = state.figures[f.key];
      const show = !off && Number.isFinite(n);
      if (!show) { a.setAttribute('hidden', ''); s.setAttribute('hidden', ''); continue; }
      a.removeAttribute('hidden'); s.removeAttribute('hidden');
      const t = f.text(n);
      setText(a, t[0], t[1]);
      if (n === 0) a.setAttribute('data-zero', '1'); else a.removeAttribute('data-zero');
    }
    if (off) mail.previousElementSibling.setAttribute('hidden', ''); else mail.previousElementSibling.removeAttribute('hidden');
    // R3: the Queues entry in the sidebar carries filing plus lessons proposed.
    const badge = document.querySelector('[data-nav-count="queue"]');
    if (badge) {
      const file = state.figures.file, lessons = state.figures.lessons;
      const known = Number.isFinite(file) || Number.isFinite(lessons);
      const n = (Number.isFinite(file) ? file : 0) + (Number.isFinite(lessons) ? lessons : 0);
      if (known && n > 0 && !off) { badge.textContent = String(n); badge.removeAttribute('hidden'); badge.setAttribute('aria-label', n + (n === 1 ? ' item waiting' : ' items waiting')); }
      else { badge.textContent = ''; badge.setAttribute('hidden', ''); }
    }
  };

  const ctrl = {
    el,
    /** 'synced' with a time wins; 'on' never downgrades 'synced'; a failed health check downgrades only an unknown state. */
    vault(st, at) {
      if (st === 'synced') { state.vault = 'synced'; state.at = at || hm(new Date().toISOString()); }
      else if (st === 'on') { if (state.vault !== 'synced') state.vault = 'on'; }
      else if (st === 'off') state.vault = 'off';
      else if (st === 'fail') { if (state.vault === 'unknown') state.vault = 'off'; }
      paint();
    },
    /** The mailbox body from GET /api/me/mailbox, or null when there is none for this person. */
    mail(body) {
      const conn = body && body.connected && body.connection ? body.connection : null;
      const t = conn ? hm(conn.last_poll_at) : '';
      if (conn && t) { setText(mail, 'mail polled ' + t, 'correo consultado ' + t); mail.removeAttribute('data-zero'); }
      else if (conn) { setText(mail, 'mail connected, not polled yet', 'correo conectado, aún sin consultar'); mail.removeAttribute('data-zero'); }
      else { setText(mail, 'mail not connected', 'correo sin conectar'); mail.setAttribute('data-zero', '1'); }
    },
    /** A figure: a finite number shows (zero dimmed); null or undefined leaves it out. */
    set(key, n) { state.figures[key] = Number.isFinite(n) ? n : null; paint(); },
    /** Fetches the named sources; a page that already holds a count passes only the others. */
    async load(keys) {
      const want = new Set(keys || []);
      const jobs = [];
      if (want.has('health')) jobs.push(api('/api/health').then((r) => ctrl.vault(r.ok && r.body && r.body.ok !== false ? 'synced' : 'fail')));
      if (want.has('mailbox')) jobs.push(api('/api/me/mailbox').then((r) => ctrl.mail(r.ok ? r.body : null)));
      if (want.has('activity')) jobs.push(api('/api/me/activity').then((r) => { const c = r.ok && r.body && r.body.counts; ctrl.set('need', c ? Number(c.review || 0) : null); ctrl.set('came', c ? Number(c.records || 0) : null); }));
      if (want.has('filing')) jobs.push(api('/api/queue/filing').then((r) => ctrl.set('file', r.ok ? listOf(r.body, 'items', 'queue', 'entries').length : null)));
      if (want.has('lessons')) jobs.push(api('/api/lessons?status=proposed').then((r) => ctrl.set('lessons', r.ok ? listOf(r.body, 'lessons', 'items').length : null)));
      if (want.has('stale')) jobs.push(api('/api/projects').then((r) => {
        if (!r.ok) { ctrl.set('stale', null); return; }
        const rows = listOf(r.body, 'projects', 'items').filter((p) => p && p.status !== 'archived' && p.id !== 'firm');
        ctrl.set('stale', rows.reduce((n, p) => n + (Number.isFinite(Number(p.stale_count)) ? Number(p.stale_count) : 0), 0));
      }));
      await Promise.all(jobs);
      return ctrl;
    },
  };
  paint();
  instance = ctrl;
  return ctrl;
}

function sep() { return mk('span', 'hub-strip-sep', '·', '·', { 'aria-hidden': 'true' }); }
