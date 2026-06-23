/* ============================================================
   ALPHA TECHNICAL CENTRE — SHARED SCRIPT
   Mobile nav · scroll reveals · language toggle · nav scroll state
   ============================================================ */

(function () {
  'use strict';

  /* ---------- MOBILE NAV TOGGLE ---------- */
  var nav = document.querySelector('.nav');
  var toggle = document.querySelector('.nav-toggle');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      nav.classList.toggle('nav-mobile-open');
    });
    // Close menu when a link is tapped
    nav.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('nav-mobile-open');
      });
    });
  }

  /* ---------- MOBILE DROPDOWN (Capabilities tap) ---------- */
  var dropdown = document.querySelector('.nav-dropdown');
  if (dropdown) {
    var dropBtn = dropdown.querySelector('button');
    if (dropBtn) {
      dropBtn.addEventListener('click', function (e) {
        // Only intercept on mobile (nav-mobile-open state)
        if (nav && nav.classList.contains('nav-mobile-open')) {
          e.stopPropagation();
          dropdown.classList.toggle('open');
        }
      });
    }
  }

  /* ---------- SCROLL REVEALS ---------- */
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var items = document.querySelectorAll('.reveal');

  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- LANGUAGE TOGGLE (EN / ES) ---------- */
  var langButtons = document.querySelectorAll('.nav-lang button');
  var STORAGE_KEY = 'atc-lang';

  function applyLang(lang) {
    document.documentElement.setAttribute('lang', lang);
    document.querySelectorAll('[data-en]').forEach(function (el) {
      var val = el.getAttribute('data-' + lang);
      if (val !== null) el.textContent = val;
    });
    // Placeholders
    document.querySelectorAll('[data-en-ph]').forEach(function (el) {
      var val = el.getAttribute('data-' + lang + '-ph');
      if (val !== null) el.setAttribute('placeholder', val);
    });
    langButtons.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === lang);
    });
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
  }

  langButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      applyLang(b.getAttribute('data-lang'));
    });
  });

  // Init from saved preference (default EN)
  var saved = 'en';
  try { saved = localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) {}
  if (saved !== 'en') applyLang(saved);

  /* ---------- ANIMATED STAT COUNTERS ---------- */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window && !reduce) {
    var cObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        var target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '';
        var dur = 1400, start = null;
        function step(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          var val = target * eased;
          el.textContent = (target % 1 === 0 ? Math.round(val) : val.toFixed(1)) + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        cObs.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (c) { cObs.observe(c); });
  }

})();
