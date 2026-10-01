// Wave 3, PR 1 (docs/vault-hub/wave3/05-markup.md §1.2): the project file carries a Fields card
// listing the attached fields with their source and coordinates, a dossier per gazetteer record,
// detach, and Add field (search the gazetteers → candidates with a source pill → Attach).
// W3-AC6, Hub side. The API is stubbed with page.route.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const PID = 'ven-barinas';
const DOSSIER = '00000000-0000-4000-8000-000000000901';

const PROJECT = {
  id: PID, client_id: null, name: 'Barinas–Apure Cluster', status: 'active', default_legal_tag: 'lt-firm', asset_ids: ['field:ve:barinas', 'field:ve:apure'], members: ['chris'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: [], country: 'VE', lat: 8.1, lon: -69.3, stage: 'Technical review',
  stage_history: [{ stage: 'Technical review', at: '2026-09-22T12:00:00.000Z', by: 'chris' }],
  register: { source: 'Tennor', current: 42, plan: 58, risk: 'red', risk_score: 78, owner: 'Lars / Chris' },
};
const BARINAS = { id: 'field:ve:barinas', kind: 'field', name: 'Barinas', parent_id: null, country: 'VE', operator: 'PDVSA', source_url: 'https://www.gem.wiki/Barinas_Oil_Field', lat: 8.62, lon: -70.21, location_source: 'gem', status: 'operating', created_by: 'gem', created_at: '2026-09-30T00:00:00.000Z', props: { gem: { unit_id: 'G1', release: 'March 2026', wiki_url: 'https://www.gem.wiki/Barinas_Oil_Field' } } };
const APURE = { id: 'field:ve:apure', kind: 'field', name: 'Apure', parent_id: null, country: 'VE', operator: null, source_url: null, lat: 7.9, lon: -67.5, location_source: 'geonames', status: null, created_by: 'chris', created_at: '2026-10-01T00:00:00.000Z', props: { geonames: { id: '3648000', feature_code: 'OILF' } } };
const GUAFITA_GEM = { name: 'Guafita', kind: 'field', country: 'VE', lat: 7.98, lon: -69.12, source: 'gem', source_id: 'G100', source_url: 'https://www.gem.wiki/Guafita_Oil_Field', confidence: 1, asset_id: 'field:ve:guafita', detail: { unit_id: 'G100', status: 'operating', operator: 'PDVSA', release: 'March 2026' } };
const GUAFITA_WD = { name: 'Guafita oil field', kind: 'field', country: 'VE', lat: 7.97, lon: -69.1, source: 'wikidata', source_id: 'Q5614', source_url: 'https://www.wikidata.org/wiki/Q5614', confidence: 0.7, detail: { operator: 'PDVSA' } };
const LOCATE = { candidates: [GUAFITA_GEM, GUAFITA_WD], unavailable: [{ source: 'geonames', reason: 'GEONAMES_USERNAME not set on the Vault service' }] };
const ITEM = { id: DOSSIER, type: 'note', title: 'Field dossier: Barinas', created_at: '2026-10-01T09:00:00.000Z', authors: ['chris'], client_id: null, project_id: PID, asset_ids: ['field:ve:barinas'], legal_tag: 'lt-public', origin: { source: 'gem', external_id: 'gem:G1', fetched_at: '2026-10-01T09:00:00.000Z', url: 'https://www.gem.wiki/Barinas_Oil_Field' }, external_id: 'gem:G1', content_hash: 'sha256:' + 'a'.repeat(64), version: 1, extracted: { kind: 'dossier', asset_id: 'field:ve:barinas', source: 'gem', summary: 'Barinas: status operating; operator PDVSA.' }, tags: ['dossier', 'gem'], cites: [] };
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function stubApi(page, { attach } = {}) {
  const calls = { posted: [], deleted: [], locate: [] };
  let assets = [{ ...BARINAS, dossier: [DOSSIER] }, { ...APURE, dossier: [] }];
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/projects/' + PID) return json(route, PROJECT);
    if (p === '/api/projects/' + PID + '/assets' && m === 'GET') return json(route, { project_id: PID, assets });
    if (p === '/api/projects/' + PID + '/assets' && m === 'POST') {
      const b = JSON.parse(route.request().postData()); calls.posted.push(b);
      if (attach) return attach(route, b);
      const c = b.create;
      const asset = b.asset_id ? { ...BARINAS, id: b.asset_id, name: 'Guafita', lat: 7.98, lon: -69.12, props: { gem: { unit_id: 'G100', release: 'March 2026' } } }
        : { id: 'field:ve:' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), kind: c.kind, name: c.name, parent_id: null, country: c.country || null, operator: (c.detail && c.detail.operator) || null, source_url: c.source_url || null, lat: c.lat ?? null, lon: c.lon ?? null, location_source: c.lat != null ? c.location_source || 'manual' : null, status: null, created_by: 'chris', created_at: '2026-10-01T10:00:00.000Z', props: c.location_source === 'wikidata' ? { wikidata: { id: c.source_id } } : {} };
      const dossier = asset.location_source === 'wikidata' || asset.location_source === 'gem' ? ['00000000-0000-4000-8000-00000000090' + (calls.posted.length + 1)] : [];
      assets = [...assets.filter((a) => a.id !== asset.id), { ...asset, dossier }];
      return json(route, { asset, attached: true, already: false, created: !b.asset_id, dossier }, b.asset_id ? 200 : 201);
    }
    if (p.startsWith('/api/projects/' + PID + '/assets/') && m === 'DELETE') {
      const id = decodeURIComponent(p.slice(('/api/projects/' + PID + '/assets/').length)); calls.deleted.push(id);
      assets = assets.filter((a) => a.id !== id);
      return json(route, { project_id: PID, asset_id: id, detached: true });
    }
    if (p === '/api/assets/locate') { calls.locate.push(u.search); return json(route, u.searchParams.get('name') === 'Guafita' ? LOCATE : { candidates: [], unavailable: LOCATE.unavailable }); }
    if (p === '/api/items/' + DOSSIER) return json(route, ITEM);
    if (p === '/api/items/' + DOSSIER + '/versions') return json(route, { item_id: DOSSIER, versions: [] });
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/projects') return json(route, { projects: [PROJECT] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W3-AC6: the Fields card lists the attached fields with kind, coordinates, source and facts; the header chips carry their names; a dossier opens in the record panel', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const card = page.locator('#p-fields');
  await expect(card.locator('h3')).toHaveText('Fields');
  const rows = card.locator('li[data-field]');
  await expect(rows).toHaveCount(2);
  const barinas = card.locator('li[data-field="field:ve:barinas"]');
  await expect(barinas.locator('b')).toHaveText('Barinas');
  await expect(barinas.locator('.hub-kind')).toHaveText('field');
  await expect(barinas.locator('[data-coords]')).toHaveText('8.62, -70.21');
  await expect(barinas.locator('.hub-src')).toHaveText('GEM');
  await expect(barinas.locator('.hub-src')).toHaveAttribute('data-source', 'gem');
  await expect(barinas).toContainText('March 2026');
  await expect(barinas).toContainText('operating, PDVSA');
  await expect(barinas.locator('[data-dossier]')).toHaveText('Dossier');
  const apure = card.locator('li[data-field="field:ve:apure"]');
  await expect(apure.locator('.hub-src')).toHaveText('GeoNames');
  await expect(apure).toContainText('7.9, -67.5');
  await expect(apure).toContainText('no dossier');
  await expect(apure.locator('[data-dossier]')).toHaveCount(0);
  // The header's asset chips show the names, not the ids.
  await expect(page.locator('#p-file .hub-asset[data-asset="field:ve:barinas"]')).toHaveText('Barinas');
  // The dossier is an ordinary record: it opens in the panel.
  await barinas.locator('[data-dossier]').click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#rp-title')).toHaveText('Field dossier: Barinas');
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + DOSSIER);
  await expect(panel.locator('#rp-kind')).toHaveText('Document');
  await page.locator('#rp-close').click();
  await expect(panel).toBeHidden();
  // Spanish follows.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(card.locator('h3')).toHaveText('Campos');
  await expect(barinas.locator('.hub-kind')).toHaveText('campo');
  await expect(barinas.locator('[data-dossier]')).toHaveText('Dosier');
});

test('W3-AC6: Add field searches the gazetteers in the project country, shows each candidate with its source and the sources that were unavailable, and Attach posts the right body and updates the card in place', async ({ page }) => {
  const calls = await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const card = page.locator('#p-fields');
  const form = card.locator('#fld-add');
  await expect(form).toBeHidden();
  await card.locator('#fld-add-btn').click();
  await expect(form).toBeVisible();
  await expect(form).toContainText('Searching in Venezuela');
  await form.locator('#fld-q').fill('Guafita');
  await form.getByRole('button', { name: 'Search' }).click();
  const cands = form.locator('#fld-candidates li[data-candidate]');
  await expect(cands).toHaveCount(2);
  expect(calls.locate).toEqual(['?name=Guafita&country=VE']);
  await expect(cands.nth(0)).toContainText('Guafita');
  await expect(cands.nth(0).locator('.hub-src')).toHaveText('GEM');
  await expect(cands.nth(0)).toContainText('7.98, -69.12');
  await expect(cands.nth(0)).toContainText('already in the Vault');
  await expect(cands.nth(1).locator('.hub-src')).toHaveText('Wikidata');
  await expect(cands.nth(1)).toContainText('PDVSA');
  await expect(cands.nth(1).locator('a.hub-inline-link')).toHaveAttribute('href', 'https://www.wikidata.org/wiki/Q5614');
  await expect(form.locator('#fld-unavailable li[data-unavailable="geonames"]')).toContainText('GeoNames not available: GEONAMES_USERNAME not set on the Vault service');
  await expect(form.locator('#fld-manual')).toHaveText('Attach without a location');

  // Attach the Wikidata candidate: a new asset carrying its source, record id and the project's country.
  await cands.nth(1).locator('[data-attach]').click();
  await expect(card.locator('li[data-field]')).toHaveCount(3);
  expect(calls.posted).toEqual([{ create: { name: 'Guafita oil field', kind: 'field', lat: 7.97, lon: -69.1, location_source: 'wikidata', source_id: 'Q5614', source_url: 'https://www.wikidata.org/wiki/Q5614', detail: { operator: 'PDVSA' }, country: 'VE' } }]);
  const added = card.locator('li[data-field="field:ve:guafita-oil-field"]');
  await expect(added.locator('.hub-src')).toHaveText('Wikidata');
  await expect(added.locator('[data-dossier]')).toHaveText('Dossier');
  await expect(card.locator('#fld-notices .hub-notice.ok')).toContainText('Guafita oil field attached.');
  await expect(card.locator('#fld-notices .hub-notice.ok')).toContainText('1 dossier record filed from Wikidata');
  await expect(form).toBeHidden();
  await expect(page.locator('#p-file .hub-asset[data-asset="field:ve:guafita-oil-field"]')).toHaveText('Guafita oil field');

  // Attach the GEM candidate that already exists in the Vault: by id only.
  await card.locator('#fld-add-btn').click();
  await form.locator('#fld-q').fill('Guafita');
  await form.getByRole('button', { name: 'Search' }).click();
  await form.locator('#fld-candidates li[data-candidate="gem:G100"] [data-attach]').click();
  await expect(card.locator('li[data-field]')).toHaveCount(4);
  expect(calls.posted[1]).toEqual({ asset_id: 'field:ve:guafita' });

  // A name with no record anywhere can still be attached, without a location.
  await card.locator('#fld-add-btn').click();
  await form.locator('#fld-q').fill('Nowhere');
  await form.getByRole('button', { name: 'Search' }).click();
  await expect(form).toContainText('No record named "Nowhere"');
  await form.locator('#fld-manual').click();
  await expect(card.locator('li[data-field]')).toHaveCount(5);
  expect(calls.posted[2]).toEqual({ create: { name: 'Nowhere', kind: 'field', country: 'VE' } });
  await expect(card.locator('li[data-field="field:ve:nowhere"]')).toContainText('no location yet');
  await expect(card.locator('#fld-notices .hub-notice.ok')).toContainText('No gazetteer record to file');

  // Detach removes the row and the header chip; the dossier records stay.
  await card.locator('li[data-field="field:ve:apure"] [data-detach]').click();
  await expect(card.locator('li[data-field]')).toHaveCount(4);
  expect(calls.deleted).toEqual(['field:ve:apure']);
  await expect(card.locator('#fld-notices .hub-notice.ok')).toContainText('Apure detached.');
  await expect(page.locator('#p-file .hub-asset[data-asset="field:ve:apure"]')).toHaveCount(0);
});

test('W3-AC6: a refusal from the Vault is shown in the card and nothing changes', async ({ page }) => {
  await stubApi(page, { attach: (route) => json(route, { error: { code: 'forbidden', message: 'only a member of "ven-barinas" or a partner may write to it' } }, 403) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const card = page.locator('#p-fields');
  await card.locator('#fld-add-btn').click();
  await card.locator('#fld-q').fill('Guafita');
  await card.getByRole('button', { name: 'Search' }).click();
  await card.locator('#fld-candidates li[data-candidate="gem:G100"] [data-attach]').click();
  await expect(card.locator('#fld-notices .hub-notice.bad')).toContainText('Not attached.');
  await expect(card.locator('#fld-notices .hub-notice.bad')).toContainText('only a member of "ven-barinas" or a partner may write to it');
  await expect(card.locator('li[data-field]')).toHaveCount(2);
});

test('W3-AC12: evidence screenshot of the Fields card with candidates', async ({ page }) => {
  await stubApi(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await page.locator('#fld-add-btn').click();
  await page.locator('#fld-q').fill('Guafita');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('#fld-candidates li[data-candidate]')).toHaveCount(2);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.locator('#p-fields').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w3-fields-card.png') });
});
