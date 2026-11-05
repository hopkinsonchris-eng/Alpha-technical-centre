/* Smoke tests for the www.alpha-technical-centre.com path split (cloudflare/site-router.js).
 *
 * The public site moves to the Vibe build; the Hub, the Vault API, the browser tools and the
 * insights articles stay on Render at the addresses they have today.
 *
 *   node --test test/site-router.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import siteRouter, { route } from '../cloudflare/site-router.js';

test('the Hub, the API, the MCP endpoint and their shared files stay on Render', () => {
  for (const p of ['/hub', '/hub/', '/hub/project.html', '/hub/vendor/d3-geo.min.js', '/api/me', '/mcp', '/mcp/sse',
    '/style.css', '/main.js', '/favicon.svg', '/robots.txt', '/sitemap.xml'])
    assert.deepEqual(route(p), { to: 'render' }, p);
});

test('the browser tools, their folders and the insights articles stay on Render', () => {
  for (const p of ['/plan-your-job.html', '/financial-modelling.html', '/nodal-analysis-tool.html', '/reservoir-simulator.html',
    '/opportunity-register.html', '/ela-model-suite.html', '/admin.html', '/app.html', '/ela-studio/', '/ela-studio/index.html',
    '/situation-room/', '/situation-room/app.js', '/tools/apex/', '/js/lang.js', '/insights.html',
    '/insights-mid2026-upstream-outlook.html', '/insights-data/radar.json', '/adipec.html', '/adipec-2026-handout.pdf', '/logo.png'])
    assert.deepEqual(route(p), { to: 'render' }, p);
});

test('the home page, the new pages and the new build\'s own files go to the Vibe site', () => {
  for (const p of ['/', '/about', '/contact', '/tools', '/plan-your-job', '/financial-modelling', '/case-studies',
    '/partners', '/technical-due-diligence', '/oil-gas-modelling', '/assets/index-Dj8g2QRG.js', '/assets/styles-CnXCoHTW.css', '/no-such-page'])
    assert.deepEqual(route(p), { to: 'vibe' }, p);
});

test('the old brochure pages send visitors and search engines to their new addresses', () => {
  const map = { '/index.html': '/', '/about.html': '/about', '/contact.html': '/contact', '/case-studies.html': '/case-studies',
    '/tools.html': '/tools', '/technical-due-diligence.html': '/technical-due-diligence', '/oil-gas-modelling.html': '/oil-gas-modelling' };
  for (const [from, to] of Object.entries(map)) assert.deepEqual(route(from), { to: 'redirect', location: to }, from);
});

test('the Worker fetches the Vibe site from its own address, passes Render paths through, and keeps visitors on www', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    seen.push(req.url);
    if (req.url.startsWith('https://alpha-glass-digital.vibepreview.app/moved'))
      return new Response(null, { status: 301, headers: { location: 'https://alpha-glass-digital.vibepreview.app/about' } });
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': '__cf_bm=x; Domain=vibepreview.app' } });
  };
  try {
    const env = { VIBE_ORIGIN: 'https://alpha-glass-digital.vibepreview.app' };
    const home = await siteRouter.fetch(new Request('https://www.alpha-technical-centre.com/?ref=x'), env);
    assert.equal(seen.at(-1), 'https://alpha-glass-digital.vibepreview.app/?ref=x');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('set-cookie'), null, 'the preview domain\'s cookies are not passed on');

    await siteRouter.fetch(new Request('https://www.alpha-technical-centre.com/hub/index.html'), env);
    assert.equal(seen.at(-1), 'https://www.alpha-technical-centre.com/hub/index.html', 'Render paths go to the origin unchanged');

    const moved = await siteRouter.fetch(new Request('https://www.alpha-technical-centre.com/moved'), env);
    assert.equal(moved.headers.get('location'), 'https://www.alpha-technical-centre.com/about', 'a redirect from the Vibe site stays on www');

    const old = await siteRouter.fetch(new Request('https://www.alpha-technical-centre.com/about.html?x=1'), env);
    assert.equal(old.status, 301);
    assert.equal(old.headers.get('location'), 'https://www.alpha-technical-centre.com/about?x=1');
  } finally { globalThis.fetch = realFetch; }
});
