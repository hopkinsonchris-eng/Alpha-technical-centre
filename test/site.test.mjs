// Wave 7 PR1 (docs/vault-hub/wave7/05-markup.md §1.5, W7-AC4 and W7-AC5): every Hub page carries
// the same sidebar, byte for byte, with the five entries Today · Projects · Queues · Find · Settings
// (Cost & health is reached from Settings, Analogues by address and the palette); the current page
// is marked by script from the body's data-page, never in the markup. The design mockup no longer
// ships beside the product: it lives under docs/vault-hub/mockups/hub/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUB = path.join(ROOT, 'hub');
const pages = readdirSync(HUB).filter((f) => f.endsWith('.html')).sort();

const asideOf = (html) => {
  const m = /<aside class="hub-side">[\s\S]*?<\/aside>/.exec(html);
  return m ? m[0] : null;
};
const navOf = (aside) => /<nav aria-label="Hub">[\s\S]*?<\/nav>/.exec(aside)?.[0] ?? null;
const linksOf = (nav) => [...nav.matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<span data-en="([^"]+)"/g)].map((m) => ({ href: m[1], label: m[2] }));

test('every hub page has the sidebar', () => {
  assert.ok(pages.length >= 8, pages.join(', '));
  for (const p of pages) assert.ok(asideOf(readFileSync(path.join(HUB, p), 'utf8')), `${p} has no <aside class="hub-side">`);
});

test('W7-AC4: the sidebar is byte-identical on every hub page', () => {
  const first = asideOf(readFileSync(path.join(HUB, pages[0]), 'utf8'));
  for (const p of pages) {
    const aside = asideOf(readFileSync(path.join(HUB, p), 'utf8'));
    assert.equal(aside, first, `${p}: sidebar differs from ${pages[0]}`);
  }
});

test('W7-AC4: the nav is Today · Projects · Queues · Find · Settings, with no page marked current in the markup', () => {
  const nav = navOf(asideOf(readFileSync(path.join(HUB, pages[0]), 'utf8')));
  assert.ok(nav, 'no <nav aria-label="Hub">');
  assert.deepEqual(linksOf(nav), [
    { href: '/hub/index.html', label: 'Today' },
    { href: '/hub/index.html#register', label: 'Projects' },
    { href: '/hub/queue.html', label: 'Queues' },
    { href: '/hub/search.html', label: 'Find' },
    { href: '/hub/settings.html', label: 'Settings' },
  ]);
  assert.ok(!/aria-current/.test(nav), 'aria-current belongs to the script, not the markup');
  assert.ok(!/cost\.html|analogues\.html/.test(nav), 'Cost & health and Analogues are not in the main nav');
  for (const a of nav.match(/<span data-en="[^"]+"/g)) assert.match(nav, new RegExp(a + ' data-es="[^"]+"'), a + ' has no Spanish');
});

test('W7-AC5: the mockup is not served under hub/; it lives in the design pack', () => {
  assert.ok(!existsSync(path.join(HUB, 'mockups')), 'hub/mockups/ still exists');
  assert.ok(existsSync(path.join(ROOT, 'docs/vault-hub/mockups/hub/index.html')), 'docs/vault-hub/mockups/hub/index.html is missing');
  for (const p of pages) assert.ok(!/mockups/.test(readFileSync(path.join(HUB, p), 'utf8')), `${p} links to the mockups`);
});

test('S13: the legacy Staff Portal gate is gone from opportunity-register.html (not in the sitemap)', () => {
  assert.ok(!/opportunity-register\.html/.test(readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8')), 'the page is in the sitemap: it must stay byte-identical');
  const html = readFileSync(path.join(ROOT, 'opportunity-register.html'), 'utf8');
  assert.ok(!/atc_auth/.test(html), 'opportunity-register.html still checks sessionStorage atc_auth');
  assert.ok(!/admin\.html\?next=/.test(html), 'opportunity-register.html still redirects to the portal');
});
