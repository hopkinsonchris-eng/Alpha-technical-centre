// Wave 7 PR2 (R8, W7-AC9): touch and type. At 1024×768 (iPad landscape) and 390×844 (phone) every interactive
// element on Today, the project page, Find, Queues and Settings has a hit area of at least 36 px (44 px for primary
// actions and row taps), and no label or pill is set under 12 px. Fonts come from hub/fonts/ and the public site keeps
// its own loading. The pages that builders D and E are rebuilding in parallel are listed with test.fixme and a note;
// the coordinator enables them at merge. Find and Settings (F) are asserted now.
import { test, expect } from '@playwright/test';
import { seedHub, PAGES, ready, ROOT } from './fixtures/hub-seed.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const VIEWPORTS = [{ width: 1024, height: 768 }, { width: 390, height: 844 }];
const MIN = 36, MIN_PRIMARY = 44, MIN_LABEL = 12;
const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="tab"], [tabindex="0"]';
const PRIMARY = '.btn-primary, [type="submit"], .hub-tl-item .hub-tl-title, [data-register-row] a, .result [data-open-record], .result .r-title a, .find-group-name';
const LABELS = '.label, .hub-pill, .hub-table th, .hub-partners th, .hub-field label, .hub-kv dt, .hub-crumb, .hub-kpi .k, .hub-flag, .hub-kind, .hub-stale, .hub-count, .find-field label, .find-date label, .hub-sl-label, .hub-tabs button, .hub-nav-group';

/** Every visible interactive element with its box, whether it is a primary action, and whether it sits inline in prose. */
const audit = (page) => page.evaluate(({ INTERACTIVE, PRIMARY, LABELS }) => {
  const seen = new Set();
  const targets = [];
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (seen.has(el) || el.closest('[hidden], .skip-link, .sr-only, .hub-palette') || el.type === 'hidden' || el.type === 'radio' || el.type === 'checkbox') continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const inline = cs.display === 'inline' && !!el.closest('p, .hub-muted, .hub-sub, .hint, dd, .snip, .path, .hub-tl-meta, .hub-note-s, td');
    const what = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' "' + (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"';
    targets.push({ what, w: Math.round(r.width), h: Math.round(r.height), primary: el.matches(PRIMARY), inline });
  }
  const labels = [];
  for (const el of document.querySelectorAll(LABELS)) {
    if (el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    labels.push({ what: el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\s+/).join('.') + ' "' + el.textContent.trim().slice(0, 24) + '"', size: parseFloat(getComputedStyle(el).fontSize) });
  }
  return { targets, labels, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
}, { INTERACTIVE, PRIMARY, LABELS });

function failures(a) {
  const small = a.targets.filter((t) => !t.inline && (t.h < MIN || t.w < MIN)).map((t) => `${t.what} ${t.w}×${t.h} (min ${MIN})`);
  const primary = a.targets.filter((t) => t.primary && t.h < MIN_PRIMARY).map((t) => `${t.what} ${t.w}×${t.h} (primary, min ${MIN_PRIMARY})`);
  const labels = a.labels.filter((l) => l.size < MIN_LABEL).map((l) => `${l.what} ${l.size}px (min ${MIN_LABEL})`);
  return { small, primary, labels };
}

const ASSERTED = ['find', 'settings', 'today', 'project', 'queue'];   // every page, now that D and E are merged
const PARALLEL = { today: 'E rebuilds Today (status strip, globe, register) in parallel', project: 'D rebuilds the project page in parallel', queue: 'E owns the shared chrome and the queue page' };

for (const name of ['today', 'project', 'find', 'queue', 'settings']) {
  for (const vp of VIEWPORTS) {
    test(`W7-AC9 (${vp.width}×${vp.height}): ${name}: every control ≥ ${MIN} px (${MIN_PRIMARY} for primary actions and row taps), labels and pills ≥ ${MIN_LABEL} px, no sideways scroll`, async ({ page }) => {
      if (!ASSERTED.includes(name)) test.fixme(true, PARALLEL[name] + '; enable at merge');
      await page.setViewportSize(vp);
      await seedHub(page);
      await page.goto(PAGES[name].url);
      await ready(page);
      if (name === 'find') await expect(page.locator('#find-results .result')).toHaveCount(2);
      const a = await audit(page);
      expect(a.targets.length, 'the page has controls').toBeGreaterThan(5);
      const f = failures(a);
      expect(f.small, 'hit areas under ' + MIN).toEqual([]);
      expect(f.primary, 'primary actions and row taps under ' + MIN_PRIMARY).toEqual([]);
      expect(f.labels, 'labels and pills under ' + MIN_LABEL).toEqual([]);
      expect(a.scrollWidth, 'no sideways scroll').toBeLessThanOrEqual(a.innerWidth);
      if (name === 'find' && vp.width === 390) {
        await page.locator('#find-results .result').first().locator('[data-open-record]').click();
        await expect(page.locator('#record-panel')).toBeVisible();
        const b = failures(await audit(page));
        expect(b.small, 'record panel hit areas').toEqual([]);
      }
    });
  }
}

test('W7-AC9: the EN/ES toggle is a 36 px segmented control on every page at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedHub(page);
  for (const name of ['find', 'settings', 'cost']) {
    await page.goto(PAGES[name].url);
    await ready(page);
    const seg = page.locator('aside .nav-lang');
    expect(await seg.evaluate((el) => getComputedStyle(el).display), name).toMatch(/flex/);
    for (const b of await seg.locator('button').all()) {
      const box = await b.boundingBox();
      expect(box.height, name).toBeGreaterThanOrEqual(36);
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(parseFloat(await b.evaluate((el) => getComputedStyle(el).fontSize)), name).toBeGreaterThanOrEqual(12);
    }
  }
});

test('R14: the Hub serves its three families from hub/fonts as WOFF2 with font-display swap; the public site keeps its own loading', async ({ page, request }) => {
  const css = readFileSync(path.join(ROOT, 'hub/hub.css'), 'utf8');
  const block = css.slice(css.indexOf('Wave 7 PR2 F'));
  expect(block.length).toBeGreaterThan(0);
  const faces = [...block.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  expect(faces.length).toBeGreaterThanOrEqual(12);
  for (const f of faces) {
    expect(f).toMatch(/font-display:\s*swap/);
    const file = /url\(['"]?(fonts\/[a-z0-9-]+\.woff2)['"]?\)/.exec(f);
    expect(file, f).not.toBeNull();
    const r = await request.get('/hub/' + file[1]);
    expect(r.status(), file[1]).toBe(200);
    const bytes = await r.body();
    expect(bytes.slice(0, 4).toString('latin1'), file[1]).toBe('wOF2');
  }
  const families = new Set(faces.map((f) => /font-family:\s*['"]([^'"]+)['"]/.exec(f)[1]));
  expect([...families].sort()).toEqual(['Barlow', 'Barlow Condensed', 'Playfair Display']);
  // The public site is untouched: its stylesheet still imports from Google Fonts and no public page links hub.css.
  const style = await (await request.get('/style.css')).text();
  expect(style).toMatch(/@import url\('https:\/\/fonts\.googleapis\.com/);
  expect(await (await request.get('/index.html')).text()).not.toMatch(/hub\.css|hub\/fonts/);
  // In the browser the Hub's text really renders from the local files.
  await seedHub(page);
  await page.goto(PAGES.settings.url);
  await ready(page);
  const loaded = await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family + ' ' + f.weight + ' ' + f.style); });
  expect(loaded).toContain('Playfair Display 700 normal');
  expect(loaded).toContain('Barlow 400 normal');
  expect(loaded).toContain('Barlow Condensed 600 normal');
});
