// Wave 7 PR5 (M) (docs/vault-hub/wave7/05-markup.md §1.8, W7-AC19 Hub part; 04-step-changes.md P1 "Where it appears"):
// the country pack where the work is. On the project page a Country pack card sits between the standing strip and the
// File disclosure: ten rows in section order, each a headline sentence and a freshness dot, a header line "Assembled
// 5 Oct · 9 of 10 · 1 stale" with Assemble the pack (never built) or Refresh (built), which POSTs and polls while the
// job runs; the card is hidden when the Vault has no pack route and absent when the project has no country. A row opens
// the bottom sheet (the wave 2 record-sheet pattern) with the sentences in the current language, every citation a chip
// carrying the source's attribution and fetch date that opens the record panel on the original with the sentence
// highlighted, what changed, the open questions, the licence lines and the caveat. The globe's country panel shows the
// pack line and the button; Today shows one line when a pack landed or a section changed since the person last looked.
// The API is stubbed with page.route against the shapes in vault/src/country/types.ts; the static server serves the pages.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/wave7/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const MEMBER = { id: 'ana', name: 'Ana Pérez', email: 'ana@alpha-technical-centre.com', role: 'associate' };
const u = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PID = 'reconcavo';
const DAY = 864e5;
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const ymd = (msAgo) => iso(msAgo).slice(0, 10);

// The ten sections in the order of vault/src/country/types.ts SECTIONS, with their titles.
const SECTIONS = [
  ['legal', 'Legal framework', 'Marco legal', 180], ['licensing', 'Licensing and the current round', 'Licencias y la ronda en curso', 7],
  ['fiscal', 'Fiscal terms', 'Términos fiscales', 90], ['companies', 'Who works there', 'Quién opera allí', 30],
  ['service', 'The service industry', 'La industria de servicios', 180], ['regulator', 'Regulator and data room', 'Regulador y sala de datos', 180],
  ['production', 'Production, reserves and market', 'Producción, reservas y mercado', 31], ['risk', 'Risk and context', 'Riesgo y contexto', 1],
  ['literature', 'Technical literature', 'Literatura técnica', 30], ['questions', 'What no source answered', 'Lo que ninguna fuente respondió', 7],
];
const CHAMBERS = u(701), ANP = u(702), RC = u(703), GEM = u(704), EIA = u(705);
const src = (id, url, licence, attribution, fetched_at, item_id, reachable = true, note) => ({ id, url, licence, attribution, fetched_at, item_id, reachable, ...(note ? { note } : {}) });
const SRC = {
  chambers: src('chambers-oil-gas', 'https://practiceguides.chambers.com/practice-guides/oil-gas-2026/brazil', 'Chambers and Partners, free to read', 'Chambers Global Practice Guides, Oil & Gas 2026, Brazil', '2026-10-05T06:00:00.000Z', CHAMBERS),
  anp: src('anp-oferta-permanente', 'https://www.gov.br/anp/pt-br/rodadas-anp/oferta-permanente', 'Government of Brazil, open data', 'ANP, Oferta Permanente', '2026-10-05T06:10:00.000Z', ANP),
  rc: src('resourcecontracts', 'https://www.resourcecontracts.org/countries/br', 'CC BY-SA 4.0', 'ResourceContracts.org (NRGI, CCSI, World Bank)', '2026-10-05T06:12:00.000Z', RC),
  gem: src('gem-extraction', 'https://globalenergymonitor.org/projects/global-oil-gas-extraction-tracker/', 'CC BY 4.0', 'Global Energy Monitor, Global Oil and Gas Extraction Tracker, March 2026', '2026-10-05T06:15:00.000Z', GEM),
  eia: src('eia-international', 'https://api.eia.gov/v2/international/', 'Public domain, EIA attribution', 'U.S. Energy Information Administration, International data', '2026-10-05T06:20:00.000Z', EIA),
  bdep: src('anp-bdep', 'https://www.gov.br/anp/pt-br/assuntos/exploracao-e-producao-de-oleo-e-gas/dados-tecnicos', 'Government of Brazil, open data', 'ANP, BDEP data room', null, null, false),
};
const sent = (en, es, cites) => ({ en, es, cites });
const section = (id, status, builtAgoDays, body, sources, extra) => {
  const [, en, es, ttl] = SECTIONS.find((s) => s[0] === id);
  const built = iso(builtAgoDays * DAY);
  return { section: id, title: { en, es }, version: 1, status, stale_reason: null, built_at: built, ttl_days: ttl, due_at: new Date(Date.parse(built) + ttl * DAY).toISOString().slice(0, 10), body, sources, ...(extra || {}) };
};
const empty = (id) => { const [, en, es, ttl] = SECTIONS.find((s) => s[0] === id); return { section: id, title: { en, es }, version: 0, status: 'empty', stale_reason: null, built_at: null, ttl_days: ttl, due_at: null, body: { headline: null, sentences: [], questions: [], changed_since: [] }, sources: [] }; };

/** The built Brazil pack: nine of ten sections, one stale (licensing), one due (fiscal), one unreachable (regulator), the questions section never built. */
const BRAZIL = () => ({
  country: 'BR', assembled_at: '2026-10-05T06:30:00.000Z', spend_gbp: 1.42, job: { id: 41, status: 'ok', started_at: '2026-10-05T06:00:00.000Z' },
  counts: { built: 9, fresh: 6, due: 1, stale: 1, unreachable: 1, empty: 1 },
  sections: [
    section('legal', 'fresh', 0, { headline: { en: 'Petroleum Law 9,478 of 1997 governs upstream; the Union owns the resources.', es: 'La Ley del Petróleo 9.478 de 1997 rige el upstream; la Unión es dueña de los recursos.' },
      sentences: [sent('Petroleum Law 9,478 of 1997 governs upstream activity and the Union owns the resources in the ground.', 'La Ley del Petróleo 9.478 de 1997 rige la actividad upstream y la Unión es dueña de los recursos en el subsuelo.', ['doc:' + CHAMBERS]),
        sent('The last amendment of note was Law 13,365 of 2016, which ended Petrobras\'s mandatory operatorship in the pre-salt.', 'La última enmienda relevante fue la Ley 13.365 de 2016, que puso fin a la operación obligatoria de Petrobras en el presal.', ['doc:' + CHAMBERS])],
      questions: [], changed_since: [] }, [SRC.chambers]),
    section('licensing', 'stale', 0, { headline: { en: 'Permanent Offer schedule changed; bids 7 Oct 2026.', es: 'Cambió el calendario de la Oferta Permanente; ofertas el 7 oct 2026.' },
      sentences: [sent('Acreage is awarded through the Permanent Offer, in concession and production-sharing cycles with a published schedule.', 'Las áreas se adjudican mediante la Oferta Permanente, en ciclos de concesión y de reparto de producción con calendario publicado.', ['doc:' + ANP]),
        sent('The fifth concession cycle receives bids on 7 October 2026.', 'El quinto ciclo de concesión recibe ofertas el 7 de octubre de 2026.', ['doc:' + ANP])],
      questions: [{ en: 'Whether the Recôncavo blocks sit in the fifth cycle or the sixth.', es: 'Si los bloques del Recôncavo están en el quinto ciclo o en el sexto.' }],
      changed_since: [{ en: 'The bid date moved from 30 September to 7 October 2026.', es: 'La fecha de ofertas pasó del 30 de septiembre al 7 de octubre de 2026.' }] }, [SRC.anp], { version: 2, stale_reason: 'source changed: anp-oferta-permanente' }),
    section('fiscal', 'due', 85, { headline: { en: 'Concession regime: 10 % royalty, special participation on large fields, 34 % corporate tax.', es: 'Régimen de concesión: regalía del 10 %, participación especial en campos grandes, impuesto corporativo del 34 %.' },
      sentences: [sent('Concessions pay a 10 % royalty, reducible to 5 % for marginal fields, plus a special participation on large fields.', 'Las concesiones pagan una regalía del 10 %, reducible al 5 % en campos marginales, más una participación especial en campos grandes.', ['doc:' + RC, 'doc:' + CHAMBERS])],
      questions: [], changed_since: [] }, [SRC.rc, SRC.chambers]),
    section('companies', 'fresh', 1, { headline: { en: 'Petrobras operates the pre-salt; 3R, PetroReconcavo and Eneva hold the onshore Recôncavo.', es: 'Petrobras opera el presal; 3R, PetroReconcavo y Eneva tienen el Recôncavo terrestre.' },
      sentences: [sent('PetroReconcavo operates 22 onshore fields in the Recôncavo basin.', 'PetroReconcavo opera 22 campos terrestres en la cuenca del Recôncavo.', ['doc:' + GEM])], questions: [], changed_since: [] }, [SRC.gem]),
    section('service', 'fresh', 2, { headline: { en: 'No public register; the firm\'s contacts here are Halliburton Macaé and a local workover crew.', es: 'Sin registro público; los contactos de la firma aquí son Halliburton Macaé y una cuadrilla local de workover.' },
      sentences: [sent('No public register of service companies exists for Brazil; the firm\'s contacts here are Halliburton Macaé and a local workover crew.', 'No existe un registro público de empresas de servicios en Brasil; los contactos de la firma aquí son Halliburton Macaé y una cuadrilla local de workover.', ['doc:' + CHAMBERS])], questions: [], changed_since: [] }, [SRC.chambers]),
    section('regulator', 'unreachable', 3, { headline: { en: 'No source reached.', es: 'No se alcanzó ninguna fuente.' }, sentences: [], questions: [{ en: 'How the BDEP data room is entered and what it costs.', es: 'Cómo se entra a la sala de datos del BDEP y cuánto cuesta.' }], changed_since: [] }, [SRC.bdep], { stale_reason: 'unreachable since 2 Oct 2026' }),
    section('production', 'fresh', 4, { headline: { en: 'Brazil produced 3.4 million barrels a day in August 2026.', es: 'Brasil produjo 3,4 millones de barriles diarios en agosto de 2026.' },
      sentences: [sent('Brazil produced 3.4 million barrels a day in August 2026, 78 % of it from the pre-salt.', 'Brasil produjo 3,4 millones de barriles diarios en agosto de 2026, el 78 % del presal.', ['doc:' + EIA])], questions: [], changed_since: [] }, [SRC.eia]),
    section('risk', 'fresh', 0, { headline: { en: 'World Monitor 38, exercise normal precautions.', es: 'World Monitor 38, precauciones normales.' }, sentences: [], questions: [], changed_since: [] }, []),
    section('literature', 'fresh', 5, { headline: { en: '14 papers on the Recôncavo basin since 2020.', es: '14 artículos sobre la cuenca del Recôncavo desde 2020.' }, sentences: [], questions: [], changed_since: [] }, []),
    empty('questions'),
  ],
});
/** A country whose pack was never built: ten empty sections, no job. */
const NEVER = (code) => ({ country: code, assembled_at: null, spend_gbp: 0, job: null, counts: { built: 0, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 10 }, sections: SECTIONS.map((s) => empty(s[0])) });

const PROJECT = (over) => ({
  id: PID, client_id: null, name: 'Recôncavo late-life economics', status: 'active', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris', 'ana'],
  created_at: '2026-09-01T09:00:00.000Z', closed_at: null, contacts: [], country: 'BR', lat: -12.5, lon: -38.5, stage: 'Negotiation',
  stage_history: [{ stage: 'Negotiation', at: '2026-09-20T12:00:00.000Z', by: 'chris' }], register: { next: 'Sign the farm-in', owner: 'Chris' }, ...(over || {}),
});
const CATALOG = { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc1234' };
// The stored original behind a chip: a Chambers chapter fetched on 5 Oct, indexed, served as text.
const ORIGINAL = (id, title, text) => ({
  id, type: 'feed-snapshot', title, created_at: '2026-10-05T06:00:00.000Z', authored_at: null, authors: [], client_id: null, project_id: 'firm', asset_ids: [], organisation_ids: [], legal_tag: 'lt-public',
  origin: { source: 'country-pack', external_id: 'https://practiceguides.chambers.com/practice-guides/oil-gas-2026/brazil', fetched_at: '2026-10-05T06:00:00.000Z' },
  storage_key: 'originals/ee/' + 'e'.repeat(64), content_hash: 'sha256:' + 'e'.repeat(64), version: 1, supersedes: null, cites: [], filing: { method: 'job' }, mime: 'text/html',
  extracted: { kind: 'country-source', pack: { country: 'BR', section: 'legal', source_id: 'chambers-oil-gas' }, text_chars: text.length, chunks: 3, format: 'html', text, ingest: { version: 2, status: 'ok', at: '2026-10-05T06:01:00.000Z' } }, stale: false, tags: [],
});
const CHAMBERS_TEXT = 'Oil & Gas 2026, Brazil\n\nGeneral structure of hydrocarbon ownership and regulation. Petroleum Law 9,478 of 1997 governs upstream activity and the Union owns the resources in the ground; the ANP grants concessions on its behalf.\n\nThe last amendment of note was Law 13,365 of 2016.';

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Stub the project page. `pack` is the PackView for BR (null answers 404, 'off' answers 501); `onPost` answers POST
 * /api/countries/BR/pack; `packs` maps other codes. Returns the log of pack requests.
 */
async function stubProject(page, { me = PARTNER, project = PROJECT(), pack = BRAZIL(), onPost, packGet } = {}) {
  const log = { gets: 0, posts: [] };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()); const p = url.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/catalog') return json(route, CATALOG);
    const pk = /^\/api\/countries\/([A-Z]{2})\/pack$/.exec(p);
    if (pk) {
      if (m === 'POST') { log.posts.push(pk[1]); return onPost ? onPost(route, pk[1]) : json(route, { job_id: 77, state: 'running' }, 202); }
      log.gets++;
      if (packGet) return packGet(route, pk[1], log);
      if (pack === null) return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
      if (pack === 'off') return json(route, { error: { code: 'not_implemented', message: 'packs are not configured' } }, 501);
      return json(route, pack);
    }
    if (p === '/api/projects/' + PID) return json(route, project);
    if (p === '/api/projects/' + PID + '/standing') return json(route, { project: { id: PID, name: project.name, status: project.status, stage: project.stage, stage_since: '2026-09-20T12:00:00.000Z', country: project.country, client_id: null }, next: { title: 'Sign the farm-in', due_at: '2026-10-20', owner: 'Chris', ref: null }, figures: [], open: { proposals: {}, filing: 0, questions_in_drafts: 0, unanswered_inbound: 0, unacknowledged_dispatches: 0 }, counterparties: [], deadlines: [], since: null, stale_counts: { runs: 0, items: 0 }, last_activity: null });
    if (p === '/api/projects/' + PID + '/timeline') return json(route, { project_id: PID, count: 0, entries: [] });
    if (p === '/api/projects/' + PID + '/vintages') return json(route, { project_id: PID, vintages: [] });
    if (p === '/api/projects/' + PID + '/lineage') return json(route, { project_id: PID, nodes: [], edges: [] });
    if (p === '/api/projects/' + PID + '/contacts') return json(route, { project_id: PID, client_id: null, contacts: [], counterparties: [] });
    if (p === '/api/projects/' + PID + '/assets') return json(route, { project_id: PID, assets: [] });
    if (p === '/api/projects/' + PID + '/research') return json(route, { project_id: PID, runs: [], findings: [], enabled: false });
    if (p === '/api/items/' + CHAMBERS) return json(route, ORIGINAL(CHAMBERS, 'Chambers Global Practice Guides, Oil & Gas 2026, Brazil', CHAMBERS_TEXT));
    if (p === '/api/items/' + ANP) return json(route, ORIGINAL(ANP, 'ANP, Oferta Permanente', 'The fifth concession cycle receives bids on 7 October 2026 at the ANP auditorium in Rio de Janeiro.\n\nOferta Permanente de Concessão, fifth cycle: the schedule was published on 1 October 2026 and replaces the one of 30 September.'));
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    if (p === '/api/queue/review') return json(route, { items: [] });
    if (p === '/api/items') return json(route, { items: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();
const card = (page) => page.locator('#p-pack');
const rows = (page) => card(page).locator('[data-pack-row]');

test('W7-AC19 (card): ten rows in section order with title, headline and freshness dot; the header reads "Assembled 5 Oct · 9 of 10 · 1 stale" with Refresh; the caveats sit under legal, fiscal and service; questions and what-changed stay off the card; it sits between the standing strip and the File disclosure', async ({ page }) => {
  await stubProject(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  await expect(c).toBeVisible();
  await expect(c).toHaveAttribute('data-pack-state', 'ready');
  await expect(c.locator('h3')).toHaveText('Country pack');
  // Position: after the header's standing strip, before the File disclosure.
  expect(await c.evaluate((el) => el.nextElementSibling && el.nextElementSibling.id)).toBe('p-file-wrap');
  expect(await page.locator('#p-standing').evaluate((st, id) => !!(st.compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING), 'p-pack')).toBe(true);
  // The header line, with the figures as data.
  const sum = c.locator('[data-pack-summary]');
  await expect(sum).toContainText('Assembled 5 Oct');
  await expect(sum).toContainText('9 of 10');
  await expect(sum).toContainText('1 stale');
  await expect(sum.locator('.hub-num').first()).toHaveText('9');
  await expect(sum).toHaveAttribute('data-assembled-at', '2026-10-05');
  await expect(c.locator('[data-pack-assemble]')).toHaveText('Refresh');
  await expect(c.locator('[data-pack-assemble]')).toHaveClass(/btn-outline/);
  // Ten rows in SECTIONS order, each with the title, the headline and a dot that carries as-of and due in its title.
  await expect(rows(page)).toHaveCount(10);
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-pack-row')))).toEqual(SECTIONS.map((s) => s[0]));
  expect(await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))).toEqual(['fresh', 'stale', 'due', 'fresh', 'fresh', 'unreachable', 'fresh', 'fresh', 'fresh', 'empty']);
  const lic = c.locator('[data-pack-row="licensing"]');
  await expect(lic.locator('.hub-pack-title')).toHaveText('Licensing and the current round');
  await expect(lic.locator('.hub-pack-headline')).toHaveText('Permanent Offer schedule changed; bids 7 Oct 2026.');
  await expect(lic.locator('.hub-pack-dot')).toHaveAttribute('data-status', 'stale');
  await expect(lic.locator('.hub-pack-dot')).toHaveAttribute('title', /as of \d+ \w+ 2026 · due \d+ \w+ 2026/);
  await expect(c.locator('[data-pack-row="regulator"] .hub-pack-dot')).toHaveAttribute('data-status', 'unreachable');
  await expect(c.locator('[data-pack-row="regulator"] .hub-pack-headline')).toHaveText('No source reached.');
  await expect(c.locator('[data-pack-row="questions"] .hub-pack-dot')).toHaveAttribute('data-status', 'empty');
  await expect(c.locator('[data-pack-row="questions"] .hub-pack-headline')).toContainText('not drafted yet');
  // The dots are the five tones: gold, amber, red, hollow grey, grey.
  const tones = await c.locator('.hub-pack-dot').evaluateAll((els) => els.map((e) => { const cs = getComputedStyle(e); return cs.backgroundColor + '|' + cs.borderColor; }));
  expect(new Set(tones).size).toBe(5);
  // Caveats under legal, fiscal and service; none under the others; questions and changed_since are not on the card.
  await expect(c.locator('[data-pack-row="legal"] [data-caveat]')).toContainText('Orientation for screening');
  await expect(c.locator('[data-pack-row="fiscal"] [data-caveat]')).toContainText('verify against the instrument in force');
  await expect(c.locator('[data-pack-row="service"] [data-caveat]')).toContainText('No public register');
  await expect(c.locator('[data-pack-row="licensing"] [data-caveat]')).toHaveCount(0);
  await expect(c.locator('[data-pack-row="companies"] [data-caveat]')).toHaveCount(0);
  await expect(c).not.toContainText('bid date moved');
  await expect(c).not.toContainText('fifth cycle or the sixth');
  // Every row is one tap, at least 44 px tall.
  for (const r of await rows(page).locator('[data-pack-open]').all()) expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Spanish: titles and headlines follow the toggle.
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(lic.locator('.hub-pack-title')).toHaveText('Licencias y la ronda en curso');
  await expect(lic.locator('.hub-pack-headline')).toHaveText('Cambió el calendario de la Oferta Permanente; ofertas el 7 oct 2026.');
  await expect(c.locator('h3')).toHaveText('Paquete del país');
  await page.locator('aside .nav-lang button[data-lang="en"]').click();
  mkdirSync(EVIDENCE, { recursive: true });
  await c.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-pack-card.png') });
});

test('W7-AC19 (card): the card is hidden when the Vault answers 404 or 501, and absent when the project has no country', async ({ page }) => {
  await stubProject(page, { pack: null });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(card(page)).toBeHidden();
  await expect(card(page)).toHaveAttribute('data-pack-state', 'unavailable');
  await expect(page.locator('#p-file-wrap')).toBeVisible();
  await stubProject(page, { pack: 'off' });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(card(page)).toBeHidden();
  const log = await stubProject(page, { project: PROJECT({ country: null, lat: null, lon: null }) });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(card(page)).toBeHidden();
  await expect(card(page)).toHaveAttribute('data-pack-state', 'no-country');
  expect(log.gets).toBe(0);
});

test('W7-AC19 (card): Assemble the pack on a never-built pack POSTs, shows the job state and polls every interval while the job runs, then renders the rows; a member sees the button too', async ({ page }) => {
  let built = false; let polls = 0;
  await page.addInitScript(() => { window.HUB_PACK_POLL_MS = 150; });
  const log = await stubProject(page, {
    me: MEMBER,
    packGet: (route, code) => {
      if (!built) return json(route, NEVER(code));
      polls++;
      if (polls === 2) return route.abort('failed');            // an iPad asleep, a timeout: one failed poll must not end the polling (6 Oct 2026)
      if (polls < 4) return json(route, { ...NEVER(code), job: { id: 77, status: 'running', started_at: iso(0) } });
      return json(route, BRAZIL());
    },
  });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  await expect(c).toHaveAttribute('data-pack-state', 'none');
  await expect(c.locator('[data-pack-summary]')).toContainText('Not assembled yet');
  await expect(rows(page)).toHaveCount(10);
  await expect(c.locator('[data-pack-row="legal"] .hub-pack-dot')).toHaveAttribute('data-status', 'empty');
  const btn = c.locator('[data-pack-assemble]');
  await expect(btn).toHaveText('Assemble the pack');
  await expect(btn).toHaveClass(/btn-primary/);
  built = true;
  await btn.click();
  await expect.poll(() => log.posts).toEqual(['BR']);
  await expect(c).toHaveAttribute('data-pack-state', 'building');
  await expect(c.locator('[data-pack-job]')).toContainText('Assembling');
  await expect(btn).toBeDisabled();
  await expect(c).toHaveAttribute('data-pack-state', 'ready', { timeout: 5000 });
  expect(polls).toBeGreaterThanOrEqual(4);                       // GET every interval while the job ran, through the failed one
  await expect(c.locator('[data-pack-summary]')).toContainText('9 of 10');
  await expect(c.locator('[data-pack-row="legal"] .hub-pack-dot')).toHaveAttribute('data-status', 'fresh');
  await expect(btn).toHaveText('Refresh');
  await expect(btn).toBeEnabled();
  await expect(c.locator('[data-pack-job]')).toBeHidden();
});

test('W7-AC19 (sheet): a row opens the bottom sheet with the section title, status and as-of, the sentences with a chip per citation (attribution and fetch date), what changed, the open questions, the licence and attribution lines and the caveat; a chip opens the record panel on the original with the sentence highlighted', async ({ page }) => {
  await stubProject(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const open = card(page).locator('[data-pack-row="licensing"] [data-pack-open]');
  await expect(open).toHaveAttribute('aria-haspopup', 'dialog');
  await open.click();
  const sheet = page.locator('#pack-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-section', 'licensing');
  await expect(sheet.locator('#h-pack-sheet')).toHaveText('Licensing and the current round');
  const meta = sheet.locator('[data-pack-meta]');
  await expect(meta.locator('.hub-pill')).toHaveText('stale');
  await expect(meta).toContainText('as of');
  await expect(meta).toContainText('source changed');
  // The sentences, each citation a chip with the source's attribution and the fetch date.
  const sentences = sheet.locator('[data-sentence]');
  await expect(sentences).toHaveCount(2);
  await expect(sentences.nth(1)).toContainText('The fifth concession cycle receives bids on 7 October 2026.');
  const chip = sentences.nth(1).locator('[data-cite]');
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('data-cite', 'doc:' + ANP);
  await expect(chip).toHaveText('ANP, Oferta Permanente · 5 Oct 2026');
  // What changed, the questions, the sources with licence and attribution, the caveat (none for licensing).
  await expect(sheet.locator('[data-changed] li')).toHaveText(['The bid date moved from 30 September to 7 October 2026.']);
  await expect(sheet.locator('[data-questions] li')).toHaveText(['Whether the Recôncavo blocks sit in the fifth cycle or the sixth.']);
  const srcs = sheet.locator('[data-sources] li');
  await expect(srcs).toHaveCount(1);
  await expect(srcs.first()).toContainText('ANP, Oferta Permanente');
  await expect(srcs.first()).toContainText('Government of Brazil, open data');
  await expect(srcs.first().locator('a')).toHaveAttribute('href', SRC.anp.url);
  await expect(sheet.locator('[data-caveat]')).toHaveCount(0);
  // Spanish follows the toggle inside the sheet (the scrim covers the sidebar while the sheet is open, so the toggle is driven directly).
  await page.locator('aside .nav-lang button[data-lang="es"]').dispatchEvent('click');
  await expect(sentences.nth(1)).toContainText('El quinto ciclo de concesión recibe ofertas el 7 de octubre de 2026.');
  await expect(sheet.locator('[data-changed] li')).toHaveText(['La fecha de ofertas pasó del 30 de septiembre al 7 de octubre de 2026.']);
  await page.locator('aside .nav-lang button[data-lang="en"]').dispatchEvent('click');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-pack-sheet.png') });
  // The chip opens the record panel on the original at the cited passage: the sentence is the highlight (the panel marks the phrase and
  // its words, as Find does with ?q=), the first match is the anchor and the sentence sits at the top as the passage cited.
  await chip.click();
  const panel = page.locator('#record-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-ref', 'doc:' + ANP);
  await expect(panel.locator('[data-passage]')).toContainText('The fifth concession cycle receives bids on 7 October 2026.');
  const marks = panel.locator('[data-text] mark');
  expect(await marks.count()).toBeGreaterThan(0);
  await expect(marks.first()).toHaveAttribute('data-anchor', '');
  await expect(marks.first()).toHaveText('The fifth concession cycle receives bids on 7 October 2026');
  expect(await marks.first().evaluate((m) => { const r = m.getBoundingClientRect(), b = m.closest('.hub-panel-body').getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom; })).toBe(true);
  await expect(sheet).toBeHidden();                               // the sheet steps aside for the panel
  await page.locator('#rp-close').click();
  await expect(panel).toBeHidden();
  // The legal, fiscal and service sheets carry their caveat; the unreachable section says so and lists its source as unreachable; Escape closes.
  await card(page).locator('[data-pack-row="legal"] [data-pack-open]').click();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-caveat]')).toContainText('Orientation for screening; verify against the instrument in force.');
  await expect(sheet.locator('[data-sentence]').first().locator('[data-cite]')).toHaveText('Chambers Global Practice Guides, Oil & Gas 2026, Brazil · 5 Oct 2026');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await card(page).locator('[data-pack-row="regulator"] [data-pack-open]').click();
  await expect(sheet.locator('[data-pack-meta] .hub-pill')).toHaveText('unreachable');
  await expect(sheet.locator('[data-sentence]')).toHaveCount(0);
  await expect(sheet.locator('[data-no-sentences]')).toContainText('No source reached');
  await expect(sheet.locator('[data-sources] li').first()).toContainText('unreachable');
  await expect(sheet.locator('[data-questions] li')).toHaveCount(1);
  await page.locator('#pack-close').click();
  await expect(sheet).toBeHidden();
  // The hash opens a section directly (the Today line lands here).
  await page.goto('/hub/project.html?id=' + PID + '#pack-fiscal');
  await ready(page);
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-section', 'fiscal');
  await expect(sheet.locator('[data-caveat]')).toContainText('verify against the instrument in force');
  await expect(sheet.locator('[data-sentence]').first().locator('[data-cite]')).toHaveCount(2);
});

test('W7-AC19 (iPad): the card and the sheet at 820×1180 keep every control at 36 px and the rows at 44', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await stubProject(page);
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  await expect(c).toBeVisible();
  for (const r of await rows(page).locator('[data-pack-open]').all()) expect((await r.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await c.locator('[data-pack-assemble]').boundingBox()).height).toBeGreaterThanOrEqual(36);
  await c.locator('[data-pack-row="fiscal"] [data-pack-open]').click();
  const sheet = page.locator('#pack-sheet');
  await expect(sheet).toBeVisible();
  for (const chip of await sheet.locator('[data-cite]').all()) expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(36);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-pack-ipad.png') });
});

/* ── the globe's country panel and Today ───────────────────────────────── */

const cproj = (id, name, code, lat, lon, status = 'active') => ({ id, name, status, stage: 'Technical review', client_id: null, client_name: null, lat, lon, last_run_at: null, attention: { stale: 0, filing: 0, expiring_days: null }, assets: [] });
const tproj = (id, name, code, lat, lon, status = 'active') => ({ id, name, status, client_id: null, default_legal_tag: 'lt-firm', country: code, lat, lon, stage: 'Technical review', stage_history: [{ stage: 'Technical review', at: '2026-09-22T12:00:00.000Z', by: 'chris' }], register: { next: 'Next step', owner: 'Chris' }, members: ['chris'], contacts: [], created_at: '2026-09-01T00:00:00.000Z', last_activity_at: iso(2 * DAY), run_count: 1, item_count: 2, stale_count: 0 });
const COUNTRIES = {
  countries: [
    { code: 'BR', name: { en: 'Brazil', es: 'Brasil' }, projects: [cproj(PID, 'Recôncavo late-life economics', 'BR', -12.5, -38.5)], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
    { code: 'CO', name: { en: 'Colombia', es: 'Colombia' }, projects: [cproj('llanos', 'Llanos waterflood', 'CO', 4.1, -72.9)], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
    { code: 'VE', name: { en: 'Venezuela', es: 'Venezuela' }, projects: [cproj('barinas', 'Barinas cluster', 'VE', 8.1, -69.3)], counts: { projects: 1, stale: 0, filing: 0, expiring: 0 }, risk: null },
  ],
  unplaced: [], generated_at: iso(0), world_monitor: { status: 'not_connected', notes: [] },
};
const PROJECTS = [tproj(PID, 'Recôncavo late-life economics', 'BR', -12.5, -38.5), tproj('llanos', 'Llanos waterflood', 'CO', 4.1, -72.9), tproj('barinas', 'Barinas cluster', 'VE', 8.1, -69.3), tproj('talara', 'Talara redevelopment', 'PE', -4.6, -81.3, 'archived')];

async function stubToday(page, { me = PARTNER, packs = {}, since = iso(DAY), onPost } = {}) {
  const log = { gets: [], posts: [] };
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname; const m = route.request().method();
    if (p === '/api/me') return json(route, me);
    if (p === '/api/health') return json(route, { ok: true, version: '0.7.0', migrations: 9, backend: 'pg' });
    if (p === '/api/catalog') return json(route, CATALOG);
    if (p === '/api/countries') return json(route, COUNTRIES);
    if (p === '/api/projects') return json(route, { projects: PROJECTS });
    if (p === '/api/organisations') return json(route, { organisations: [] });
    if (p === '/api/me/mailbox') return json(route, { prompt: false, connected: false, configured: false });
    if (p === '/api/me/activity') return json(route, { since, counts: { records: 0 }, projects: [], brief_available: false });
    if (/^\/api\/countries\/[A-Z]{2}\/intel$/.test(p)) return json(route, { country: p.split('/')[3], name: { en: 'Country', es: 'País' }, world_monitor: { status: 'not_connected', reason: 'not connected' }, sections: {} });
    const pk = /^\/api\/countries\/([A-Z]{2})\/pack$/.exec(p);
    if (pk) {
      if (m === 'POST') { log.posts.push(pk[1]); return onPost ? onPost(route, pk[1]) : json(route, { job_id: 78, state: 'running' }, 202); }
      log.gets.push(pk[1]);
      const v = packs[pk[1]];
      if (v === undefined) return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
      return json(route, v);
    }
    if (p.startsWith('/api/queue')) return json(route, { items: [] });
    if (p === '/api/lessons') return json(route, { lessons: [] });
    if (p === '/api/runs') return json(route, { runs: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return log;
}
const globeReady = (page) => page.locator('#sec-globe[data-globe="ready"]').waitFor();

test('W7-AC19 (globe): the country panel shows "Pack: assembled 5 Oct · 9 of 10 · 1 stale" with the worst section; a country without a pack offers Assemble the pack, which POSTs; Create a project here says it assembles the pack', async ({ page }) => {
  const log = await stubToday(page, { packs: { BR: BRAZIL(), VE: NEVER('VE') } });
  await page.goto('/hub/index.html?country=BR');
  await ready(page); await globeReady(page);
  const line = page.locator('#country-pack');
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('data-pack-state', 'ready');
  await expect(line).toContainText('Pack: assembled 5 Oct');
  await expect(line).toContainText('9 of 10');
  await expect(line).toContainText('1 stale');
  await expect(line.locator('[data-pack-worst]')).toContainText('licensing');
  await expect(line.locator('[data-pack-worst]')).toContainText('stale');
  await expect(line.locator('.hub-num').first()).toHaveText('9');
  await expect(page.locator('#country-pack-assemble')).toHaveCount(0);
  await expect(page.locator('#country-pack-note')).toContainText('assembles its country pack');
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, 'w7-pack-globe.png') });
  // A country with no pack yet: the line says so and offers the button (members), which posts once.
  await page.locator('#country-back').click();
  await page.locator('#register [data-country="VE"]').click();
  await expect(page.locator('#country-panel')).toBeVisible();
  await expect(line).toHaveAttribute('data-pack-state', 'none');
  await expect(line).toContainText('Pack: not assembled yet');
  const btn = page.locator('#country-pack-assemble');
  await expect(btn).toHaveText('Assemble the pack');
  await btn.click();
  await expect.poll(() => log.posts).toEqual(['VE']);
  await expect(line).toHaveAttribute('data-pack-state', 'building');
  await expect(line).toContainText('Assembling');
  // A country whose Vault has no pack route shows nothing.
  await page.locator('#country-back').click();
  await page.locator('#register [data-country="CO"]').click();
  await expect(page.locator('#country-panel')).toBeVisible();
  await expect(line).toBeHidden();
  await expect(page.locator('#country-pack-note')).toBeHidden();
});

test('W7-AC19 (Today): What came in shows one line per country whose pack landed or whose section changed since the person last looked, from the section headline, linking to the project at that section; one fetch per country with an active project; an unchanged pack shows nothing', async ({ page }) => {
  const since = iso(DAY);
  const co = BRAZIL(); co.country = 'CO'; co.assembled_at = iso(3 * DAY);
  for (const s of co.sections) if (s.built_at) { s.built_at = iso(3 * DAY); s.version = 1; }
  const ve = NEVER('VE'); ve.assembled_at = iso(3600e3);
  for (const s of ve.sections) { s.version = 1; s.status = 'fresh'; s.built_at = iso(3600e3); }
  ve.counts = { built: 10, fresh: 10, due: 0, stale: 0, unreachable: 0, empty: 0 };
  const log = await stubToday(page, { since, packs: { BR: BRAZIL(), CO: co, VE: ve } });
  await page.goto('/hub/index.html');
  await ready(page);
  const lines = page.locator('#card-activity [data-activity-pack]');
  await expect(lines).toHaveCount(2);
  const br = page.locator('#card-activity [data-activity-pack="BR"]');
  await expect(br).toContainText('Brazil: licensing changed; Permanent Offer schedule changed; bids 7 Oct 2026.');
  await expect(br.locator('a')).toHaveAttribute('href', '/hub/project.html?id=' + PID + '#pack-licensing');
  const vz = page.locator('#card-activity [data-activity-pack="VE"]');
  await expect(vz).toContainText('Venezuela: country pack assembled');
  await expect(vz).toContainText('10 of 10');
  await expect(vz.locator('a')).toHaveAttribute('href', '/hub/project.html?id=barinas#pack');
  await expect(page.locator('#card-activity [data-activity-pack="CO"]')).toHaveCount(0);
  await expect(page.locator('#card-activity')).not.toHaveAttribute('data-empty', '1');
  expect(log.gets.slice().sort()).toEqual(['BR', 'CO', 'VE']);     // one per country with an active project; PE (archived) never asked
  await page.locator('aside .nav-lang button[data-lang="es"]').click();
  await expect(br).toContainText('Brasil: licencias cambió; Cambió el calendario de la Oferta Permanente; ofertas el 7 oct 2026.');
});

test('a store that could not file: the row and the sheet say "not filed" in red with the fix, the chips say "reached, not filed", the header counts them apart from unreachable, and the globe line shows the worst as not filed', async ({ page }) => {
  // The Vault records a section the store refused as unreachable with stale_reason "storage:<why>" and the chips carrying fault 'storage'.
  const pack = BRAZIL();
  const why = 'the storage bucket does not exist';
  const note = 'could not be filed: supabase storage put 400 for originals/9c/9c96f0: {"statusCode":"404","error":"Bucket not found","code":"NoSuchBucket"}';
  pack.sections = pack.sections.map((s) => s.section !== 'legal' ? s : {
    ...s, status: 'unreachable', stale_reason: 'storage:' + why,
    body: { headline: { en: 'Reached 2 sources for Legal framework but the Vault could not file them: ' + why + '. Fix the file store (vault/SETUP.md §1.5) and press Refresh.', es: 'Se alcanzaron 2 fuentes para Marco legal pero la Bóveda no pudo archivarlas: el bucket de almacenamiento no existe. Corrija el almacén de archivos (vault/SETUP.md §1.5) y pulse Actualizar.' }, sentences: [], questions: s.body.questions, changed_since: [] },
    sources: [{ ...SRC.chambers, item_id: null, fault: 'storage', note }, { ...SRC.chambers, id: 'legal500-energy-oil-gas', url: 'https://www.legal500.com/guides/chapter/brazil-energy-oil-gas/', attribution: 'The Legal 500, Energy: Oil & Gas, Brazil', item_id: null, fault: 'storage', note }],
  });
  pack.counts = { built: 9, fresh: 5, due: 1, stale: 1, unreachable: 2, empty: 1 };
  await stubProject(page, { pack });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  const row = c.locator('[data-pack-row="legal"]');
  await expect(row).toHaveAttribute('data-status', 'unfiled');
  await expect(row.locator('.hub-pack-dot')).toHaveAttribute('data-status', 'unfiled');
  await expect(row.locator('.hub-pack-headline')).toContainText('could not file them: the storage bucket does not exist. Fix the file store (vault/SETUP.md §1.5) and press Refresh.');
  // The header: the store's failures are counted apart from publishers that did not answer.
  const sum = c.locator('[data-pack-summary]');
  await expect(sum.locator('[data-count="not-filed"] .hub-num')).toHaveText('1');
  await expect(sum.locator('[data-count="unreachable"] .hub-num')).toHaveText('1');
  await expect(sum.locator('[data-count="not-filed"]')).toHaveClass(/bad/);
  // The sheet: the status pill reads "not filed", the notice says what to fix, the chips say "reached, not filed".
  await row.locator('[data-pack-open]').click();
  const sheet = page.locator('#pack-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-pack-meta] .hub-pill')).toHaveText('not filed');
  await expect(sheet.locator('[data-pack-meta] .hub-pill')).toHaveClass(/bad/);
  await expect(sheet.locator('[data-pack-meta] .hub-pack-reason')).toHaveCount(0);        // the raw reason is said in the notice, not as a code
  await expect(sheet.locator('[data-unfiled]')).toHaveText('The sources answered but the Vault could not file them: the storage bucket does not exist. Nothing is drafted until the file store works; it is set up in vault/SETUP.md §1.5. Press Refresh once it is fixed.');
  await expect(sheet.locator('[data-unfiled]')).toHaveAttribute('data-es', /no pudo archivarlas/);
  await expect(sheet.locator('[data-no-sentences]')).toHaveText('Reached, not filed: see the notice above.');
  const chips = sheet.locator('[data-sources] li');
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveAttribute('data-fault', 'storage');
  await expect(chips.first()).toHaveAttribute('data-reachable', 'true');
  await expect(chips.first().locator('.hub-pill')).toHaveText('reached, not filed');
  await expect(chips.first().locator('.hub-pill')).toHaveClass(/bad/);
  await expect(chips.first()).toContainText('fetched 5 Oct 2026');
  await page.keyboard.press('Escape');
  // The language toggle keeps the state words.
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(row.locator('.hub-pack-headline')).toContainText('no pudo archivarlas');
  await expect(sum.locator('[data-count="not-filed"] .hub-unit')).toHaveText('sin archivar');
});

test('drafting failed on the last build: the card says why in the owner\'s words with the fix, every empty row says it is not drafted because of it, the sheet repeats the notice, and the globe line shows the worst as not drafted', async ({ page }) => {
  // The Vault leaves every section empty with stale_reason "draft failed: <the provider's error>" when the drafting threw.
  const pack = BRAZIL();
  const err = 'draft failed: anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011"}';
  pack.sections = pack.sections.map((s) => ({ ...s, status: 'empty', stale_reason: err, body: { headline: null, sentences: [], questions: s.body.questions || [], changed_since: [] } }));
  pack.counts = { built: 10, fresh: 0, due: 0, stale: 0, unreachable: 0, empty: 10 };
  await stubProject(page, { pack });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  const notice = c.locator('.hub-pack-head [data-draft-failed]');
  await expect(notice).toHaveText('Drafting failed on the last build: the Anthropic account has no credit; add credits under Plans & Billing at console.anthropic.com. The originals are filed; press Refresh once it is fixed.');
  await expect(notice).toHaveAttribute('data-es', /la cuenta de Anthropic no tiene crédito/);
  await expect(notice).toHaveAttribute('title', /credit balance is too low/);
  await expect(notice).toHaveClass(/bad/);
  const row = c.locator('[data-pack-row="legal"]');
  await expect(row).toHaveAttribute('data-status', 'failed');
  await expect(row.locator('.hub-pack-dot')).toHaveAttribute('data-status', 'failed');
  await expect(row.locator('.hub-pack-headline')).toHaveText('Not drafted: the drafting assistant failed on the last build; see the notice above.');
  await expect(c.locator('[data-pack-row][data-status="failed"]')).toHaveCount(10);
  await row.locator('[data-pack-open]').click();
  const sheet = page.locator('#pack-sheet');
  await expect(sheet.locator('[data-pack-meta] .hub-pill')).toHaveText('not drafted');
  await expect(sheet.locator('[data-pack-meta] .hub-pill')).toHaveClass(/bad/);
  await expect(sheet.locator('[data-pack-meta] .hub-pack-reason')).toHaveCount(0);
  await expect(sheet.locator('[data-draft-failed]')).toContainText('the Anthropic account has no credit');
  await expect(sheet.locator('[data-no-sentences]')).toHaveText('Not drafted: see the notice above.');
  await page.keyboard.press('Escape');
  // A refused key and a rate limit are named too; anything else is quoted.
  const why = await page.evaluate(async () => {
    const m = await import('/hub/components/country-pack.js');
    return m.STATUS.failed.en;
  });
  expect(why).toBe('not drafted');
});

test('the terms card first (W7-R5): the fixed facts with chips and as-of, "not published" where no original states one, "below standard" naming the missing required terms; a chip opens the original; the words toggle to Spanish', async ({ page }) => {
  const pack = BRAZIL();
  const v = (en, es, cites, as_of) => ({ en: en + ' ' + cites.map((c) => '[doc:' + c + ']').join(' '), es: es + ' ' + cites.map((c) => '[doc:' + c + ']').join(' '), cites: cites.map((c) => 'doc:' + c), as_of });
  pack.terms = { version: 3, status: 'fresh', stale_reason: null, built_at: '2026-10-06T12:00:00.000Z', questions: [{ en: 'Sanctions and restrictions: not published in the originals.', es: 'Sanciones y restricciones: no publicado en los originales.' }],
    fields: { regime: v('Concession contracts under the Petroleum Law and production sharing in the pre-salt.', 'Contratos de concesión bajo la Ley del Petróleo y reparto de producción en el presal.', [CHAMBERS], '2026-10-05'), state_share: null, royalty: v('Royalty of 10 % on production, reducible to 5 %.', 'Regalía del 10 % sobre la producción, reducible al 5 %.', [CHAMBERS, ANP], '2026-10-05'), income_tax: v('34 % corporate income tax and social contribution.', '34 % de impuesto a la renta y contribución social.', [CHAMBERS], null), special_taxes: null, cost_recovery: null, stability: null, local_content: null, regulator: v('ANP, the National Agency of Petroleum.', 'ANP, la Agencia Nacional del Petróleo.', [ANP], '2026-10-05'), noc: v('Petrobras.', 'Petrobras.', [CHAMBERS], '2026-10-05'), awards: v('Permanent Offer cycles run by the ANP.', 'Ciclos de Oferta Permanente de la ANP.', [ANP], '2026-10-05'), sanctions: null } };
  pack.quality = { ok: false, missing: ['sanctions'] };
  await stubProject(page, { pack });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  const c = card(page);
  const terms = c.locator('[data-pack-terms]');
  await expect(terms).toBeVisible();
  await expect(terms).toHaveAttribute('data-quality', 'below');
  await expect(terms.locator('[data-quality-pill]')).toHaveText('below standard');
  await expect(terms.locator('[data-quality-notice]')).toHaveText('Below standard: no original states sanctions and restrictions. Press Refresh after adding a source, or ask counsel.');
  const termsBox = await terms.boundingBox(), rowsBox = await c.locator('.hub-pack-rows').boundingBox();
  expect(termsBox.y).toBeLessThan(rowsBox.y);
  await expect(terms.locator('dt[data-term]')).toHaveCount(12);
  await expect(terms.locator('dt[data-term="royalty"]')).toHaveAttribute('data-state', 'cited');
  const royalty = terms.locator('[data-term-value="royalty"]');
  await expect(royalty.locator('.hub-term-text')).toHaveText('Royalty of 10 % on production, reducible to 5 %.');
  await expect(royalty.locator('.hub-pack-chip')).toHaveCount(2);
  await expect(royalty.locator('.hub-pack-chip').nth(1)).toHaveText('ANP, Oferta Permanente');
  await expect(royalty).toContainText('as of 5 Oct 2026');
  await expect(terms.locator('dt[data-term="sanctions"]')).toHaveAttribute('data-state', 'missing');
  await expect(terms.locator('[data-term-value="sanctions"]')).toHaveText('not published');
  await expect(terms.locator('[data-term-value="income_tax"]')).not.toContainText('as of');
  await royalty.locator('.hub-pack-chip').nth(1).click();
  await expect(page.locator('#record-panel')).toBeVisible();
  await expect(page.locator('#record-panel')).toHaveAttribute('data-ref', 'doc:' + ANP);
  await page.keyboard.press('Escape');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(terms.locator('dt[data-term="royalty"]')).toHaveText('Regalía');
  await expect(royalty.locator('.hub-term-text')).toHaveText('Regalía del 10 % sobre la producción, reducible al 5 %.');
  await expect(terms.locator('[data-quality-pill]')).toHaveText('por debajo del estándar');
  await page.locator('.nav-lang button[data-lang="en"]').click();                 // the choice persists across loads
  const ok = BRAZIL(); ok.terms = { ...pack.terms, fields: { ...pack.terms.fields, sanctions: v('No sanctions touch the sector.', 'Ninguna sanción afecta al sector.', [CHAMBERS], '2026-10-05') } }; ok.quality = { ok: true, missing: [] };
  await stubProject(page, { pack: ok });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(card(page).locator('[data-pack-terms]')).toHaveAttribute('data-quality', 'ok');
  await expect(card(page).locator('[data-quality-pill]')).toHaveText('meets the bar');
  await expect(card(page).locator('[data-quality-notice]')).toHaveCount(0);
  const none = BRAZIL(); none.terms = null; none.quality = { ok: false, missing: ['regime', 'royalty', 'income_tax', 'regulator', 'noc', 'awards', 'sanctions'] };
  await stubProject(page, { pack: none });
  await page.goto('/hub/project.html?id=' + PID);
  await ready(page);
  await expect(card(page).locator('[data-pack-terms]')).toHaveAttribute('data-quality', 'none');
  await expect(card(page).locator('[data-terms-empty]')).toHaveText('Not drafted yet: assemble the pack.');
});
