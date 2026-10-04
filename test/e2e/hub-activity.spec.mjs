// Wave 6, PR 3 (docs/vault-hub/wave6/05-markup.md §1.4; W6-AC7): What came in on Today: the counts since the person last
// looked, one cited sentence per opportunity with a chip per claim that opens the record, Mark all as seen. The API is stubbed.
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE = path.join(ROOT, 'docs/vault-hub/evidence');
const PARTNER = { id: 'chris', name: 'Chris Hopkinson', email: 'chris@alpha-technical-centre.com', role: 'partner' };
const DR = '00000000-0000-4000-8000-00000000a001', INV = '00000000-0000-4000-8000-00000000a002', REP = '00000000-0000-4000-8000-00000000a003';
const SINCE = '2026-10-03T17:20:00.000Z';
const ACTIVITY = { since: SINCE, brief_available: true, counts: { messages_filed: 14, ready: 3, review: 2, invoices: 2, files: 5, organisations_proposed: 1, bulk_hidden: 38, records: 24 },
  projects: [
    { id: 'hte-apure', name: 'High Tech Electronica', records: [{ ref: 'doc:' + DR, type: 'email', title: 'Data room index', date: '2026-10-04T08:00:00.000Z', direction: 'in', from: 'Tom Reed' }, { ref: 'doc:' + INV, type: 'invoice', title: 'Invoice ATC-2026-0152', date: '2026-10-04T07:00:00.000Z' }] },
    { id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', records: [{ ref: 'doc:' + REP, type: 'report', title: 'Field report.pdf', date: '2026-10-04T06:00:00.000Z' }] },
  ] };
const BRIEF = { since: SINCE, provider: 'claude', projects: [
  { project_id: 'hte-apure', name: 'High Tech Electronica', sentence: `Zuata's CFO sent the data-room index and asked for the NDA countersigned by Friday [doc:${DR}]. Invoice ATC-2026-0152 was paid [doc:${INV}].`, citations: ['doc:' + DR, 'doc:' + INV], dropped: 1, records: ACTIVITY.projects[0].records },
  { project_id: 'kaz-brownfield', name: 'Western Kazakhstan Brownfield', sentence: null, citations: [], dropped: 0, records: ACTIVITY.projects[1].records },
] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stub(page, { activity = ACTIVITY, brief = BRIEF } = {}) {
  const calls = { brief: [], seen: 0 };
  await page.route('**/api/**', (route) => {
    const p = new URL(route.request().url()).pathname, m = route.request().method();
    if (p === '/api/me') return json(route, PARTNER);
    if (p === '/api/me/activity' && m === 'GET') return json(route, activity);
    if (p === '/api/me/activity/brief' && m === 'POST') { calls.brief.push(JSON.parse(route.request().postData() || '{}')); return brief ? json(route, brief) : json(route, { error: { code: 'error', message: 'no' } }, 500); }
    if (p === '/api/me/activity/seen' && m === 'POST') { calls.seen++; return json(route, { last_seen_activity_at: '2026-10-04T14:00:00.000Z' }); }
    if (p === '/api/me/mailbox') return json(route, { configured: true, connected: true, prompt: false, connection: null, counts: null, firm_domains: [] });
    if (p === '/api/catalog') return json(route, { tools: [], built_at: '2026-09-29T09:00:00.000Z', commit: 'abc' });
    if (p === '/api/projects/hte-apure') return json(route, { id: 'hte-apure', client_id: 'hte', name: 'High Tech Electronica', status: 'prospect', default_legal_tag: 'lt-firm', asset_ids: [], members: ['chris'], contacts: [], created_at: '2026-09-30T09:00:00.000Z', closed_at: null, country: 'VE', stage: 'Initial screen', stage_history: [], register: {} });
    if (p === '/api/projects/hte-apure/timeline') return json(route, { project_id: 'hte-apure', count: 1, entries: [{ kind: 'item', ref: 'doc:' + DR, id: DR, at: '2026-10-04T08:00:00.000Z', title: 'Data room index', type: 'email', version: 1, legal_tag: 'lt-firm', stale: false, stale_reasons: [], supersedes: null }] });
    if (p === '/api/items/' + DR) return json(route, { id: DR, type: 'email', title: 'Data room index', created_at: '2026-10-04T08:00:00.000Z', authored_at: '2026-10-04T08:00:00.000Z', authors: ['tom@hte.example'], client_id: 'hte', project_id: 'hte-apure', asset_ids: [], organisation_ids: [], legal_tag: 'lt-firm', origin: { source: 'zoho-mail' }, storage_key: null, mime: null, content_hash: 'sha256:' + 'a'.repeat(64), version: 1, supersedes: null, cites: [], filing: {}, extracted: { direction: 'in', contacts: [] }, stale: false, tags: [] });
    if (p.endsWith('/versions')) return json(route, { item_id: p.split('/')[3], versions: [] });
    for (const tail of ['/assets', '/vintages', '/lineage', '/stale', '/lessons', '/scorecard', '/basis', '/research']) if (p === '/api/projects/hte-apure' + tail) return json(route, { project_id: 'hte-apure', assets: [], vintages: [], nodes: [], edges: [], runs: [], items: [], lessons: [], rules: [], findings: [], enabled: false });
    if (p === '/api/projects' || p === '/api/countries' || p === '/api/items' || p === '/api/runs') return json(route, { projects: [], countries: [], items: [], runs: [] });
    return json(route, { error: { code: 'not_found', message: 'no route' } }, 404);
  });
  return calls;
}
const ready = (page) => page.locator('body[data-ready="1"]').waitFor();

test('W6-AC7: the card shows the counts since the last look and a cited sentence per opportunity; a chip opens the record on the project page; a project without a sentence lists its records; Mark all as seen', async ({ page }) => {
  const calls = await stub(page);
  await page.goto('/hub/index.html');
  await ready(page);
  const card = page.locator('#card-activity');
  await expect(card).toBeVisible();
  await expect(card.locator('#activity-since')).toContainText('since you looked on 3 Oct, 17:20');
  await expect(card.locator('#activity-count')).toHaveText('24');
  await expect(card.locator('#activity-counts')).toHaveText('14 messages filed · 3 ready · 2 need a decision · 2 invoices · 5 files · 1 new organisations proposed · 38 bulk hidden');
  await expect.poll(() => calls.brief.length).toBe(1);
  expect(calls.brief[0]).toEqual({ since: SINCE, language: 'en' });
  await expect(card).toHaveAttribute('data-brief', 'claude');
  const hte = card.locator('[data-activity-project="hte-apure"]');
  await expect(hte.locator('.hub-activity-name')).toHaveAttribute('href', '/hub/project.html?id=hte-apure');
  await expect(hte.locator('[data-activity-line]')).toHaveAttribute('data-cited', '2');
  await expect(hte.locator('[data-activity-line]')).toContainText("Zuata's CFO sent the data-room index and asked for the NDA countersigned by Friday");
  const chips = hte.locator('.hub-cite');
  await expect(chips).toHaveText(['Data room index', 'Invoice ATC-2026-0152']);
  await expect(chips.first()).toHaveAttribute('href', '/hub/project.html?id=hte-apure&doc=' + DR);
  const kaz = card.locator('[data-activity-project="kaz-brownfield"]');
  await expect(kaz.locator('.hub-cite')).toHaveText(['Field report.pdf']);
  mkdirSync(EVIDENCE, { recursive: true });
  await card.screenshot({ path: path.join(EVIDENCE, 'w6-what-came-in.png') });
  // Mark all as seen.
  await card.locator('#activity-seen').click();
  await expect.poll(() => calls.seen).toBe(1);
  await expect(card).toHaveAttribute('data-seen', '1');
  await expect(card.locator('#activity-status')).toContainText('Seen.');
  // A chip opens the record on the project page.
  await chips.first().click();
  await expect(page).toHaveURL(/project\.html\?id=hte-apure&doc=/);
  const rp = page.locator('#record-panel');
  await expect(rp).toBeVisible();
  await expect(rp.locator('#rp-title')).toHaveText('Data room index');
});

test('W6-AC7: without a provider the counts show alone with the records as chips; nothing new says so; Spanish follows', async ({ page }) => {
  const calls = await stub(page, { activity: { ...ACTIVITY, brief_available: false } });
  await page.goto('/hub/index.html');
  await ready(page);
  const card = page.locator('#card-activity');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-activity-project="hte-apure"] [data-activity-line]')).toContainText('2 new records');
  expect(calls.brief.length).toBe(0);
  await stub(page, { activity: { since: SINCE, brief_available: true, counts: { messages_filed: 0, ready: 0, review: 0, invoices: 0, files: 0, organisations_proposed: 0, bulk_hidden: 0, records: 0 }, projects: [] } });
  await page.goto('/hub/index.html');
  await ready(page);
  await expect(card.locator('#activity-counts')).toHaveText('Nothing new since then.');
  await page.locator('.nav-lang button[data-lang="es"]').click();
  await expect(card.locator('#h-activity')).toHaveText('Qué llegó');
  await expect(card.locator('#activity-counts')).toHaveText('Nada nuevo desde entonces.');
});
