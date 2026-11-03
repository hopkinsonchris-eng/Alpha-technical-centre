/* ============================================================
   ALPHA TECHNICAL CENTRE — EVENT BANNER
   A thin announcement bar above the nav while an event is on.
   Self-contained: injects its own markup and styles, follows the
   EN/ES choice that main.js stores, and switches itself off after
   EVENT.until, so the script tags can stay in the pages harmlessly.
   ============================================================ */

(function () {
  'use strict';

  var EVENT = {
    id: 'adipec-2026',
    until: '2026-11-05T20:00:00Z',          // 6 Nov 2026 00:00 in Abu Dhabi (UTC+4)
    href: 'adipec.html',
    long: {
      en: 'Alpha Technical Centre are at ADIPEC 2026 · Abu Dhabi · 2–5 November',
      es: 'Alpha Technical Centre estará en ADIPEC 2026 · Abu Dabi · 2–5 de noviembre'
    },
    short: {
      en: 'We are at ADIPEC 2026 · 2–5 Nov',
      es: 'Estamos en ADIPEC 2026 · 2–5 nov'
    },
    cta: { en: 'Meet us →', es: 'Reúnase con nosotros →' }
  };

  if (Date.now() > Date.parse(EVENT.until)) return;
  if (/^\/hub(\/|$)/.test(location.pathname)) return;          // staff Hub: never
  if (!document.querySelector('nav.nav')) return;               // only pages with the public nav
  var DISMISS_KEY = 'atc-banner-dismissed-' + EVENT.id;
  try { if (sessionStorage.getItem(DISMISS_KEY) === '1') return; } catch (e) {}

  var H = 40;
  var css =
    '.atc-event-bar{position:fixed;top:0;left:0;right:0;height:' + H + 'px;z-index:101;' +
      'background:var(--gold,#C9A84C);color:var(--navy,#0B1F3A);display:flex;align-items:center;' +
      'justify-content:center;gap:14px;padding:0 48px;font-family:var(--font-label,system-ui,sans-serif);' +
      'font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;box-sizing:border-box}' +
    '.atc-event-bar a.atc-event-link{color:inherit;text-decoration:none;display:flex;align-items:center;' +
      'gap:14px;min-height:' + H + 'px}' +
    '.atc-event-bar a.atc-event-link:hover .atc-event-cta,.atc-event-bar a.atc-event-link:focus-visible .atc-event-cta{' +
      'background:var(--navy,#0B1F3A);color:var(--gold,#C9A84C)}' +
    '.atc-event-cta{border:1px solid var(--navy,#0B1F3A);padding:4px 10px;border-radius:var(--r,6px);' +
      'white-space:nowrap;transition:background .2s,color .2s}' +
    '.atc-event-short{display:none}' +
    '.atc-event-close{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:' + H + 'px;' +
      'height:' + H + 'px;background:none;border:0;color:inherit;font-size:20px;line-height:1;cursor:pointer}' +
    'body.has-event-bar{padding-top:' + H + 'px}' +
    'body.has-event-bar .nav{top:' + H + 'px}' +
    '@media (max-width:900px){body.has-event-bar .nav-mobile-open .nav-links{top:calc(var(--nav-h,72px) + ' + H + 'px)}}' +
    '@media (max-width:700px){.atc-event-long{display:none}.atc-event-short{display:inline}' +
      '.atc-event-bar{font-size:11px;letter-spacing:.08em;padding:0 44px 0 12px}' +
      '.atc-event-bar a.atc-event-link{gap:10px}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var lang = 'en';
  try { lang = localStorage.getItem('atc-lang') || 'en'; } catch (e) {}
  if (lang !== 'es') lang = 'en';

  function span(cls, pair) {
    var s = document.createElement('span');
    s.className = cls;
    s.setAttribute('data-en', pair.en);
    s.setAttribute('data-es', pair.es);
    s.textContent = pair[lang];
    return s;
  }

  var bar = document.createElement('div');
  bar.className = 'atc-event-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'ADIPEC 2026');

  var link = document.createElement('a');
  link.className = 'atc-event-link';
  link.href = EVENT.href;
  link.appendChild(span('atc-event-long', EVENT.long));
  link.appendChild(span('atc-event-short', EVENT.short));
  link.appendChild(span('atc-event-cta', EVENT.cta));
  bar.appendChild(link);

  var close = document.createElement('button');
  close.className = 'atc-event-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss announcement');
  close.textContent = '×';
  close.addEventListener('click', function () {
    bar.remove();
    document.body.classList.remove('has-event-bar');
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
  });
  bar.appendChild(close);

  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add('has-event-bar');
})();
