// Wave 7 PR6 (docs/vault-hub/wave7/05-markup.md §1.9, W7-AC21 and the Vault half of W7-AC22; 04-step-changes.md P2;
// practice P63). The round watch: the pack's licensing pages are fetched weekly and filed as the same stored originals the
// pack cites; an unchanged page is skipped; a changed page is read once by the model, which proposes dated stages each
// with a verbatim quote (a quote not in the text is refused); nothing counts until a member confirms it; an unreachable
// page is reported with "since", which persists across runs; the view the Hub reads has one shape; the pack's licensing
// section carries the confirmed event with its citation. Written before the implementation; no network anywhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-rounds-'));
delete process.env.CF_ACCESS_TEAM_DOMAIN;
delete process.env.WORLD_MONITOR_API_KEY;
process.env.NODE_ENV = 'test';

const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { createApp } = await import('../src/app.ts');
const { filesystemStorage } = await import('../src/storage.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
type LlmRequest = import('../src/llm/provider.ts').LlmRequest;
const { FakeEmbedder } = await import('../src/ingest/embed.ts');
const { fakeFetch, mockClock, text } = await import('./miners.helpers.ts');
const { watchRounds, watchedSources, JOB_NAME } = await import('../src/rounds/watch.ts');
const { extractRounds, ROUND_AUDIT_ACTION } = await import('../src/rounds/extract.ts');
const { roundsView, confirmRound } = await import('../src/rounds/store.ts');
const { draftSectionsWithSummary } = await import('../src/llm/country-pack.ts');
const { featureOf } = await import('../src/cost.ts');
const { STAGE_IDS } = await import('../src/rounds/types.ts');
type Db = Awaited<ReturnType<typeof openDb>>;
type CountryRegistry = import('../src/country/types.ts').CountryRegistry;
type RoundEvent = import('../src/rounds/types.ts').RoundEvent;
type RoundsView = import('../src/rounds/types.ts').RoundsView;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'rounds');
const fx = (name: string) => readFileSync(path.join(FIX, name), 'utf8');
const DOMAIN = 'alpha-technical-centre.com';
const DAY = 86_400_000;

/* ── the registry under watch: only the licensing pages of countries with a live project ──────────────────── */
const ANP_URL = 'https://www.gov.br/anp/pt-br/rodadas-anp/oferta-permanente/opc/6o-ciclo-da-oferta-permanente-de-concessao/cronograma-do-6o-ciclo-da-oferta-permanente-de-concessao';
const NSTA_URL = 'https://www.nstauthority.co.uk/licensing-consents/licensing-rounds/';
const REGISTRY: CountryRegistry = {
  generic: [],
  countries: {
    BR: { name: 'Brazil', regulator: 'ANP', sources: [
      { id: 'anp-opc6-cronograma', section: 'licensing', url: ANP_URL, access: 'html', licence: 'CC BY 3.0 BR (gov.br)', attribution: 'ANP, Oferta Permanente de Concessão, cronograma do 6º Ciclo', allowed_domains: ['www.gov.br'] },
      { id: 'anp-blocos-ofertados', section: 'licensing', url: 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/rlpgn/blocos-ofertados-rodadas.csv', access: 'csv', licence: 'CC BY 3.0 BR', attribution: 'ANP dados abertos', allowed_domains: ['www.gov.br'], options: { expect_header: ['Rodada'] } },
      { id: 'anp-lei-do-petroleo', section: 'legal', url: 'https://www.gov.br/anp/pt-br/legislacao/lei-9478', access: 'html', licence: 'CC BY 3.0 BR', attribution: 'ANP, legislação', allowed_domains: ['www.gov.br'] },
    ] },
    GB: { name: 'United Kingdom', regulator: 'NSTA', sources: [
      { id: 'nsta-licensing-rounds-page', section: 'licensing', url: NSTA_URL, access: 'html', licence: 'Open Government Licence v3.0', attribution: 'North Sea Transition Authority, licensing rounds', allowed_domains: ['www.nstauthority.co.uk'] },
    ] },
    NA: { name: 'Namibia', regulator: 'MME', sources: [
      { id: 'mme-petroleum-upstream', section: 'licensing', url: 'https://www.mme.gov.na/petroleum/upstream/', access: 'html', licence: 'Public', attribution: 'Namibia MME', allowed_domains: ['mme.gov.na'] },
    ] },
  },
};
const OPC6 = '6º Ciclo da Oferta Permanente de Concessão';
const R34 = '34th Offshore Licensing Round';
const Q = {
  opc6_deadline_v1: 'A sessão pública de apresentação de ofertas será realizada em 17 de dezembro de 2026, na sede da ANP, no Rio de Janeiro.',
  opc6_deadline_v2: 'A sessão pública de apresentação de ofertas será realizada em 18 de fevereiro de 2027, na sede da ANP, no Rio de Janeiro.',
  opc6_announced: 'A publicação do edital do 6º Ciclo da Oferta Permanente de Concessão ocorreu em 10 de setembro de 2026.',
  opc6_data: 'O pacote de dados técnicos dos setores em oferta está disponível às empresas inscritas por meio do sistema e-BID, mediante pagamento da taxa de participação.',
  r34_announced: 'The 34th Offshore Licensing Round was announced on 2 September 2026, offering 310 blocks and part-blocks across the North Sea, the West of Shetland and the East Irish Sea.',
  r34_data: 'The data package for the 34th Round, including the blocks on offer and the featured prospects, is available through the National Data Repository from 16 September 2026.',
  r34_deadline: 'Applications for the 34th Offshore Licensing Round must be submitted through the UK Energy Portal by 13:00 on 14 January 2027.',
  r34_award: 'The NSTA expects to make the first tranche of licence offers in the summer of 2027, subject to the completion of the Habitats Regulations Assessment.',
};

/** The canned model: the page's text decides the answer; one quote is never in the text (refused); the reply is fenced. */
const prompts: LlmRequest[] = [];
function roundReply(req: LlmRequest): string {
  const t = req.messages[0].content;
  let out: unknown[] = [];
  if (t.includes('17 de dezembro de 2026')) out = [
    { round: OPC6, stage: 'bid_deadline', date: '2026-12-17', title: 'Public session for the presentation of offers', quote: Q.opc6_deadline_v1 },
    { round: OPC6, stage: 'announced', date: '2026-09-10', title: 'Tender notice and draft concession contract published', quote: Q.opc6_announced },
    { round: OPC6, stage: 'qualification', date: '2026-11-12', title: 'Qualification documents due', quote: 'The qualification documents are due on 12 November 2026.' },
    { round: OPC6, stage: 'data_package', date: null, title: 'Technical data package through e-BID', quote: Q.opc6_data },
  ];
  else if (t.includes('18 de fevereiro de 2027')) out = [
    { round: OPC6, stage: 'bid_deadline', date: '2027-02-18', title: 'Public session for the presentation of offers (postponed)', quote: Q.opc6_deadline_v2 },
    { round: OPC6, stage: 'announced', date: '2026-09-10', title: 'Tender notice and draft concession contract published', quote: Q.opc6_announced },
    { round: OPC6, stage: 'data_package', date: null, title: 'Technical data package through e-BID', quote: Q.opc6_data },
  ];
  else if (t.includes('34th Offshore Licensing Round')) out = [
    { round: R34, stage: 'announced', date: '2026-09-02', title: '34th Round announced with 310 blocks and part-blocks', quote: Q.r34_announced },
    { round: R34, stage: 'data_package', date: '2026-09-16', title: 'Data package available through the National Data Repository', quote: Q.r34_data },
    { round: R34, stage: 'bid_deadline', date: '2027-01-14', title: 'Applications due through the UK Energy Portal', quote: Q.r34_deadline },
    { round: R34, stage: 'award', date: null, title: 'First tranche of licence offers expected in summer 2027', quote: Q.r34_award },
  ];
  return '```json\n' + JSON.stringify(out, null, 1) + '\n```';
}
const provider = new FakeProvider((req) => { prompts.push(req); return roundReply(req); });
provider.model = 'claude-sonnet-5-5';          // the fake is priced at nothing; a priced model shows the spend path

/* ── the pages, mutable between runs ───────────────────────────────────── */
const pages = { anp: 'anp-opc6-cronograma-v1.html', nsta: 'up' as 'up' | 'down' };
const clock = mockClock(Date.UTC(2026, 9, 5, 4, 30));
const ff = fakeFetch([
  [/gov\.br\/anp\/.*cronograma-do-6o-ciclo-da-oferta-permanente-de-concessao$/, () => text(fx(pages.anp), 200, { 'content-type': 'text/html; charset=utf-8' })],
  [/nstauthority\.co\.uk\/licensing-consents\/licensing-rounds\/$/, () => (pages.nsta === 'down' ? text('Service unavailable', 503, { 'content-type': 'text/html' }) : text(fx('nsta-licensing-rounds.html'), 200, { 'content-type': 'text/html' }))],
], clock);
const storage = filesystemStorage(mkdtempSync(path.join(os.tmpdir(), 'vault-rounds-store-')));
const runAt = (iso: string) => {
  const now = new Date(iso);
  return watchRounds(db, { registry: REGISTRY, now: () => now, storage, env: {} as NodeJS.ProcessEnv, fetch: ff.fetch, clock, provider, ingest: { provider: null, embedder: new FakeEmbedder() }, by: 'job:round-watch', log: () => undefined });
};

let db: Db;
let partner: Awaited<ReturnType<typeof createApp>>;
let associate: Awaited<ReturnType<typeof createApp>>;
const call = async (a: typeof partner, method: string, url: string, body?: unknown) => {
  const r = await a.request(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const events = async (where = '', params: unknown[] = []) => (await db.query<any>(`SELECT id, country, round, stage, to_char(event_date,'YYYY-MM-DD') AS event_date, title, quote, source_item, source_url, read_at, status, confirmed_by, confirmed_at, superseded_by FROM round_events ${where} ORDER BY event_date NULLS LAST, round, stage`, params)).rows;
const queueRows = async (status = 'open') => (await db.query<any>("SELECT id, kind, payload, status, resolved_by FROM review_queue WHERE kind = 'round' AND status = $1 ORDER BY created_at, id", [status])).rows;
const jobs = async () => (await db.query<any>(`SELECT id, status, summary FROM jobs WHERE name = '${JOB_NAME}' ORDER BY id`)).rows;

before(async () => {
  db = await openDb(undefined); await migrate(db); await seedMaster(db);
  await db.query(`INSERT INTO people (id,email,name,role) VALUES ('ana','ana@${DOMAIN}','Ana','associate') ON CONFLICT (id) DO NOTHING`);
  // Brazil active (chris), the UK a prospect (chris and ana), Namibia archived: only the first two are watched.
  await db.query("INSERT INTO projects (id,name,default_legal_tag,members,country,status) VALUES ('p-br','Santos farm-in','lt-firm','{chris}','BR','active'),('p-gb','UKCS screen','lt-firm','{chris,ana}','GB','prospect'),('p-na','Orange basin (closed)','lt-firm','{chris}','NA','archived')");
  partner = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `chris@${DOMAIN}` } });
  associate = await createApp({ db, auth: { allowedEmailDomain: DOMAIN, devUserEmail: `ana@${DOMAIN}` } });
});
after(async () => { await db.close(); });

/* ── the extractor on its own ─────────────────────────────────────────── */

test('W7-AC21 extractRounds: a proposal needs a verbatim quote (whitespace-normalised) and a stage from STAGE_IDS; a quote not in the text is refused and counted; a date must parse or be null; no provider means no proposals', async () => {
  const page = `The 34th Offshore Licensing Round was announced on 2 September 2026, offering 310 blocks\n  and part-blocks   across the North Sea, the West of Shetland and the East Irish Sea.\nApplications for the 34th Offshore Licensing Round must be submitted through the UK Energy Portal by 13:00 on 14 January 2027.`;
  const canned = new FakeProvider(() => JSON.stringify([
    { round: R34, stage: 'announced', date: '2026-09-02', title: 'Announced', quote: Q.r34_announced },                      // whitespace differs from the page: still verbatim
    { round: R34, stage: 'bid_deadline', date: '14 January 2027', title: 'Applications due', quote: Q.r34_deadline },          // a date in words parses
    { round: R34, stage: 'award', date: '2027-06-30', title: 'Offers', quote: 'Offers will be made on 30 June 2027.' },     // not in the text: refused
    { round: R34, stage: 'qualification', date: null, title: 'Pre-qualification', quote: Q.r34_deadline },                   // undated stage with a real quote: kept
    { round: R34, stage: 'bidding', date: null, title: 'Bidding', quote: Q.r34_announced },                                   // not a stage: refused
    { round: R34, stage: 'signature', date: 'next summer', title: 'Signature', quote: Q.r34_announced },                      // a date that does not parse: refused
  ]));
  canned.model = 'claude-sonnet-5-5';
  const r = await extractRounds(canned, 'GB', page, NSTA_URL, null, '2026-10-05T04:30:00Z');
  assert.equal(r.called, true);
  assert.deepEqual(r.proposals.map(p => [p.stage, p.event_date]), [['announced', '2026-09-02'], ['bid_deadline', '2027-01-14'], ['qualification', null]]);
  for (const p of r.proposals) { assert.ok(STAGE_IDS.includes(p.stage)); assert.equal(p.country, 'GB'); assert.equal(p.source_url, NSTA_URL); assert.equal(p.source_item, null); assert.equal(p.read_at, '2026-10-05T04:30:00.000Z'); assert.ok(p.quote.length > 20); }
  assert.equal(r.refused_quotes, 1, 'the invented sentence');
  assert.equal(r.refused, 3, 'the invented sentence, the unknown stage and the date that does not parse');
  assert.ok(r.spend_gbp > 0);
  const none = await extractRounds(null, 'GB', page, NSTA_URL, null, '2026-10-05T04:30:00Z');
  assert.deepEqual({ proposals: none.proposals, called: none.called, refused_quotes: none.refused_quotes, spend_gbp: none.spend_gbp }, { proposals: [], called: false, refused_quotes: 0, spend_gbp: 0 });
  // The model is told what it may not do, and never receives a URL to fetch.
  const sys = (await import('../src/rounds/extract.ts')).roundSystemPrompt('GB');
  assert.match(sys, /verbatim/i); assert.match(sys, /never .*memory|from memory/i);
  assert.ok(!sys.includes('http'), 'no URL in the prompt');
});

test('W7-AC21 watchedSources: the licensing pages of the registry only (html and pdf); datasets and other sections are the pack\'s, not the watch\'s', () => {
  assert.deepEqual(watchedSources(REGISTRY, 'BR').map(s => s.id), ['anp-opc6-cronograma']);
  assert.deepEqual(watchedSources(REGISTRY, 'GB').map(s => s.id), ['nsta-licensing-rounds-page']);
  assert.deepEqual(watchedSources(REGISTRY, 'AR').map(s => s.id), []);
});

/* ── the watch across five weeks ──────────────────────────────────────── */

test('W7-AC21 first run: every licensing page of a country with a live project is fetched and filed as the pack\'s own original; a first-seen page is read once; proposals carry a verbatim quote and wait as proposed; the refused quote is counted; spend is on the cost page under round-watch', async () => {
  const s = await runAt('2026-10-05T04:30:00Z');
  assert.deepEqual({ pages: s.pages, unchanged: s.unchanged, changed: s.changed, unreachable: s.unreachable, proposals: s.proposals, refused_quotes: s.refused_quotes }, { pages: 2, unchanged: 0, changed: 2, unreachable: [], proposals: 7, refused_quotes: 1 });
  assert.ok(s.spend_gbp > 0);
  assert.equal(prompts.length, 2, 'one low-effort read per changed page');
  assert.ok(prompts.every(p => (p.maxTokens ?? 9999) <= 1500 || p.effort === 'low'), 'low effort');
  assert.ok(!ff.calls.some(c => /mme\.gov\.na/.test(c.url)), 'an archived project\'s country is not watched');
  assert.ok(!ff.calls.some(c => /\.csv$/.test(c.url) || /lei-9478/.test(c.url)), 'datasets and other sections are not fetched by the watch');

  // One jobs row with the summary exactly.
  const j = await jobs();
  assert.equal(j.length, 1); assert.equal(j[0].status, 'ok');
  assert.deepEqual(Object.keys(j[0].summary).sort(), ['changed', 'pages', 'proposals', 'refused_quotes', 'spend_gbp', 'unchanged', 'unreachable']);
  assert.equal(j[0].summary.proposals, 7);

  // Every proposal is a round_events row 'proposed' citing the stored original, which is the pack's own filing of the page.
  const rows = await events();
  assert.equal(rows.length, 7);
  assert.ok(rows.every(r => r.status === 'proposed' && r.confirmed_by === null && r.confirmed_at === null));
  const br = rows.filter(r => r.country === 'BR');
  assert.deepEqual(br.map(r => [r.stage, r.event_date]), [['announced', '2026-09-10'], ['bid_deadline', '2026-12-17'], ['data_package', null]]);
  assert.equal(br.find(r => r.stage === 'bid_deadline').quote, Q.opc6_deadline_v1);
  const item = (await db.query<any>("SELECT id, version, extracted, tags, project_id, legal_tag FROM items WHERE origin->>'source' = 'country-pack' AND external_id = $1", [ANP_URL])).rows[0];
  assert.ok(item, 'the page is filed as a country-pack original');
  assert.equal(item.version, 1); assert.equal(item.project_id, 'firm'); assert.equal(item.legal_tag, 'lt-public');
  assert.deepEqual(item.extracted.pack, { country: 'BR', section: 'licensing', source_id: 'anp-opc6-cronograma' });
  assert.ok(br.every(r => r.source_item === item.id && r.source_url === ANP_URL && new Date(r.read_at).toISOString() === '2026-10-05T04:30:00.000Z'));
  assert.ok(!rows.some(r => /qualification documents are due/.test(r.quote)), 'the invented sentence never reached round_events');

  // A review-queue entry of kind round per proposal, with what the queue page needs.
  const q = await queueRows();
  assert.equal(q.length, 7);
  const dl = q.find(x => x.payload.round_event_id === br.find(r => r.stage === 'bid_deadline').id);
  assert.deepEqual(dl.payload, {
    round_event_id: dl.payload.round_event_id, country: 'BR', country_name: { en: 'Brazil', es: 'Brasil' }, round: OPC6, stage: 'bid_deadline', stage_label: { en: 'Bid deadline', es: 'Plazo de ofertas' },
    event_date: '2026-12-17', title: 'Public session for the presentation of offers', quote: Q.opc6_deadline_v1, source_item: item.id, source_url: ANP_URL, read_at: '2026-10-05T04:30:00.000Z',
    proposal: `${OPC6} · Bid deadline · 2026-12-17`,
  });

  // Spend recorded like the pack's: audit rows with tokens under the watch's own feature.
  const spend = (await db.query<any>(`SELECT action, tokens_in, tokens_out, cost_usd::float AS cost_usd, detail FROM audit_events WHERE action = '${ROUND_AUDIT_ACTION}' ORDER BY id`)).rows;
  assert.equal(spend.length, 2);
  assert.ok(spend.every(r => r.tokens_in > 0 && r.tokens_out > 0 && r.cost_usd > 0));
  assert.equal(featureOf(ROUND_AUDIT_ACTION), 'round-watch');
  assert.ok(spend.some(r => r.detail.source_id === 'anp-opc6-cronograma' && r.detail.country === 'BR'));
});

test('W7-AC21 second run, same pages: the sha matches the newest stored version, nothing is read, nothing is proposed', async () => {
  const s = await runAt('2026-10-12T04:30:00Z');
  assert.deepEqual({ pages: s.pages, unchanged: s.unchanged, changed: s.changed, unreachable: s.unreachable, proposals: s.proposals, refused_quotes: s.refused_quotes, spend_gbp: s.spend_gbp }, { pages: 2, unchanged: 2, changed: 0, unreachable: [], proposals: 0, refused_quotes: 0, spend_gbp: 0 });
  assert.equal(prompts.length, 2, 'the model was not called');
  assert.equal((await events()).length, 7);
  assert.equal((await db.query<any>("SELECT version FROM items WHERE external_id = $1", [ANP_URL])).rows[0].version, 1);
});

test('W7-AC21 third run: the ANP page changed and the NSTA page is down; the changed page becomes version 2 and is read once, only the new stage is proposed (the unchanged ones are deduplicated), the unreachable page is reported with since', async () => {
  pages.anp = 'anp-opc6-cronograma-v2.html'; pages.nsta = 'down';
  const s = await runAt('2026-10-19T04:30:00Z');
  assert.deepEqual({ pages: s.pages, unchanged: s.unchanged, changed: s.changed, proposals: s.proposals, refused_quotes: s.refused_quotes }, { pages: 2, unchanged: 0, changed: 1, proposals: 1, refused_quotes: 0 });
  assert.deepEqual(s.unreachable, [{ source_id: 'nsta-licensing-rounds-page', since: '2026-10-19' }]);
  assert.equal(prompts.length, 3);
  const item = (await db.query<any>("SELECT id, version FROM items WHERE external_id = $1", [ANP_URL])).rows[0];
  assert.equal(item.version, 2);
  const br = await events("WHERE country = 'BR'");
  assert.deepEqual(br.map(r => [r.stage, r.event_date, r.status]), [['announced', '2026-09-10', 'proposed'], ['bid_deadline', '2026-12-17', 'proposed'], ['bid_deadline', '2027-02-18', 'proposed'], ['data_package', null, 'proposed']]);
  const nw = br.find(r => r.event_date === '2027-02-18');
  assert.equal(nw.quote, Q.opc6_deadline_v2); assert.equal(nw.source_item, item.id); assert.equal(new Date(nw.read_at).toISOString(), '2026-10-19T04:30:00.000Z');
  assert.equal((await jobs()).at(-1).summary.unreachable[0].since, '2026-10-19');
});

test('W7-AC21 fourth and fifth runs: "since" persists while the page stays down and clears when it answers again with the bytes already stored', async () => {
  const s4 = await runAt('2026-10-26T04:30:00Z');
  assert.deepEqual(s4.unreachable, [{ source_id: 'nsta-licensing-rounds-page', since: '2026-10-19' }], 'the first failure date, not today');
  assert.deepEqual({ pages: s4.pages, unchanged: s4.unchanged, changed: s4.changed, proposals: s4.proposals }, { pages: 2, unchanged: 1, changed: 0, proposals: 0 });
  pages.nsta = 'up';
  const s5 = await runAt('2026-11-02T04:30:00Z');
  assert.deepEqual({ pages: s5.pages, unchanged: s5.unchanged, changed: s5.changed, unreachable: s5.unreachable, proposals: s5.proposals }, { pages: 2, unchanged: 2, changed: 0, unreachable: [], proposals: 0 });
  assert.equal(prompts.length, 3, 'a page back with the same bytes is not read again');
});

/* ── confirm before it counts ─────────────────────────────────────────── */

test('W7-AC21 nothing reaches the deadlines until a member confirms; confirm sets status, who and when and resolves the queue row; a second confirm is a conflict', async () => {
  const before = await call(partner, 'GET', '/api/rounds?country=BR,GB&within=3650');
  assert.equal(before.status, 200);
  assert.deepEqual(before.body.deadlines, []);
  assert.deepEqual(before.body.countries.map((c: any) => [c.country, c.open, c.events.length]), [['BR', false, 0], ['GB', false, 0]]);
  assert.equal(before.body.proposed, 8);
  const listed = await call(partner, 'GET', '/api/rounds?country=BR&status=proposed');
  assert.equal(listed.body.countries[0].events.length, 4);
  assert.ok(listed.body.countries[0].events.every((e: RoundEvent) => e.status === 'proposed' && typeof e.quote === 'string' && e.source_url === ANP_URL));

  const dl = (await events("WHERE country = 'BR' AND stage = 'bid_deadline' AND event_date = '2026-12-17'"))[0];
  const c = await call(partner, 'POST', `/api/rounds/${dl.id}/confirm`);
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'confirmed'); assert.equal(c.body.confirmed_by, 'chris'); assert.ok(c.body.confirmed_at); assert.equal(c.body.id, dl.id);
  assert.equal(c.body.event_date, '2026-12-17'); assert.equal(c.body.quote, Q.opc6_deadline_v1); assert.equal(c.body.source_item, dl.source_item);
  const q = (await db.query<any>("SELECT status, resolved_by FROM review_queue WHERE kind = 'round' AND payload->>'round_event_id' = $1", [dl.id])).rows[0];
  assert.deepEqual(q, { status: 'accepted', resolved_by: 'chris' });
  const again = await call(partner, 'POST', `/api/rounds/${dl.id}/confirm`);
  assert.equal(again.status, 409);

  const after1 = await call(partner, 'GET', '/api/rounds?country=BR&within=3650');
  assert.equal(after1.body.deadlines.length, 1);
  assert.equal(after1.body.deadlines[0].id, dl.id);
  assert.equal(after1.body.deadlines[0].days, Math.round((Date.UTC(2026, 11, 17) - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / DAY));
  assert.equal(after1.body.countries[0].open, true, 'a confirmed bid deadline in the future opens the country');
  assert.equal(after1.body.proposed, 3, 'Brazil alone: the announcement, the data package and the newer deadline still wait');
  assert.equal((await call(partner, 'GET', '/api/rounds?country=BR,GB')).body.proposed, 7);
  const one = await call(partner, 'GET', `/api/rounds/${dl.id}`);
  assert.equal(one.status, 200); assert.equal(one.body.status, 'confirmed'); assert.equal(one.body.round, OPC6);
  assert.equal((await call(partner, 'GET', '/api/rounds/00000000-0000-4000-8000-000000000000')).status, 404);
  const audited = (await db.query<any>("SELECT scope, refs FROM audit_events WHERE action = 'round.confirm' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(audited.scope, 'public'); assert.ok(audited.refs.includes(`round:${dl.id}`));
});

test('W7-AC21 dismiss: the row stays as dismissed (never deleted), the queue row is rejected, it never counts', async () => {
  const award = (await events("WHERE country = 'GB' AND stage = 'award'"))[0];
  const d = await call(associate, 'POST', `/api/rounds/${award.id}/dismiss`);
  assert.equal(d.status, 200); assert.equal(d.body.status, 'dismissed');
  const row = (await events('WHERE id = $1', [award.id]))[0];
  assert.equal(row.status, 'dismissed'); assert.equal(row.confirmed_by, null);
  assert.equal((await db.query<any>("SELECT status, resolved_by FROM review_queue WHERE kind = 'round' AND payload->>'round_event_id' = $1", [award.id])).rows[0].resolved_by, 'ana');
  assert.equal((await db.query<any>("SELECT status FROM review_queue WHERE kind = 'round' AND payload->>'round_event_id' = $1", [award.id])).rows[0].status, 'rejected');
  assert.equal((await call(partner, 'POST', `/api/rounds/${award.id}/confirm`)).status, 409, 'a dismissed proposal cannot be confirmed');
  const v = await call(partner, 'GET', '/api/rounds?country=GB&status=dismissed');
  assert.deepEqual(v.body.countries[0].events.map((e: RoundEvent) => e.id), [award.id]);
});

test('W7-AC21 supersede: confirming the newer date for the same country, round and stage marks the older confirmed event superseded (pointing at the newer one), never deletes it; a member (associate) may confirm', async () => {
  const [oldDl] = await events("WHERE country = 'BR' AND stage = 'bid_deadline' AND event_date = '2026-12-17'");
  const [newDl] = await events("WHERE country = 'BR' AND stage = 'bid_deadline' AND event_date = '2027-02-18'");
  const c = await call(associate, 'POST', `/api/rounds/${newDl.id}/confirm`);
  assert.equal(c.status, 200); assert.equal(c.body.confirmed_by, 'ana');
  const o = (await events('WHERE id = $1', [oldDl.id]))[0];
  assert.equal(o.status, 'superseded'); assert.equal(o.superseded_by, newDl.id); assert.equal(o.confirmed_by, 'chris', 'the old confirmation is history, not erased');
  const v = await call(partner, 'GET', '/api/rounds?country=BR&within=3650');
  assert.deepEqual(v.body.deadlines.map((e: RoundEvent) => e.id), [newDl.id]);
  assert.equal(v.body.countries[0].open, true);
  // The default (confirmed) view carries the superseded row too, so the Hub can say "moved to 2027-02-18" against the earlier one.
  assert.deepEqual(v.body.countries[0].events.map((e: RoundEvent) => [e.event_date, e.status, e.confirmed_by]), [['2026-12-17', 'superseded', 'chris'], ['2027-02-18', 'confirmed', 'ana']]);
  assert.ok(v.body.countries[0].events.every((e: RoundEvent) => e.confirmed_at && typeof e.days === 'number'));
  const sup = await call(partner, 'GET', '/api/rounds?country=BR&status=superseded');
  assert.deepEqual(sup.body.countries[0].events.map((e: RoundEvent) => e.id), [oldDl.id]);
});

/* ── the view (W7-AC22, the Vault half) ────────────────────────────────── */

test('W7-AC22 RoundsView: the shape exactly, open from a future bid deadline or an announced round without an award, deadlines soonest first within the window, proposed counted for the countries asked', async () => {
  // Confirm the UK's announcement and bid deadline; the award was dismissed above, so the round is open on both counts.
  for (const stage of ['announced', 'bid_deadline']) {
    const [e] = await events(`WHERE country = 'GB' AND stage = '${stage}'`);
    await confirmRound(db, e.id, 'chris', new Date('2026-11-03T09:00:00Z'));
  }
  const now = new Date('2026-11-03T09:00:00Z');
  const gbRows = await events("WHERE country = 'GB' AND status = 'confirmed'");
  const toView = (r: any): RoundEvent => ({
    id: r.id, country: 'GB', round: R34, stage: r.stage, event_date: r.event_date, title: r.title, quote: r.quote, source_item: r.source_item, source_url: NSTA_URL, read_at: new Date(r.read_at).toISOString(),
    status: 'confirmed', confirmed_by: 'chris', confirmed_at: '2026-11-03T09:00:00.000Z', created_at: new Date(r.created_at ?? '2026-10-05T04:30:00Z').toISOString(),
    days: Math.round((Date.parse(r.event_date) - Date.UTC(2026, 10, 3)) / DAY),
  });
  const created = Object.fromEntries((await db.query<any>("SELECT id, created_at FROM round_events WHERE country = 'GB'")).rows.map((r: any) => [r.id, r.created_at]));
  const expectEvents = gbRows.map(r => toView({ ...r, created_at: created[r.id] }));
  const v = await roundsView(db, { countries: ['GB'], status: 'confirmed', within: 90, now });
  const expected: RoundsView = {
    countries: [{ country: 'GB', name: 'United Kingdom', open: true, events: expectEvents }],
    deadlines: expectEvents.filter(e => e.stage === 'bid_deadline'),
    proposed: 1,                                     // the UK's data-package proposal is still waiting
  };
  assert.deepEqual(v, expected);
  assert.deepEqual(v.deadlines.map(e => e.days), [72]);
  assert.deepEqual(v.countries[0].events.map(e => [e.stage, e.days]), [['announced', -62], ['bid_deadline', 72]]);

  // Soonest first across countries; the window cuts what lies beyond it.
  const both = await roundsView(db, { countries: ['BR', 'GB'], status: 'confirmed', within: 90, now });
  assert.deepEqual(both.deadlines.map(e => [e.country, e.event_date]), [['GB', '2027-01-14']], 'Brazil\'s 2027-02-18 lies beyond 90 days');
  const wide = await roundsView(db, { countries: ['BR', 'GB'], status: 'confirmed', within: 120, now });
  assert.deepEqual(wide.deadlines.map(e => [e.country, e.event_date]), [['GB', '2027-01-14'], ['BR', '2027-02-18']]);
  assert.deepEqual(wide.countries.map(c => [c.country, c.open]), [['BR', true], ['GB', true]]);
  assert.equal(wide.proposed, 3);

  // Once the UK's award is confirmed with a date in the past and the deadline has passed, the round is no longer open.
  const later = await roundsView(db, { countries: ['GB'], status: 'confirmed', within: 90, now: new Date('2027-03-01T00:00:00Z') });
  assert.equal(later.countries[0].open, true, 'announced without an award keeps it open even after the deadline');
  await db.query("INSERT INTO round_events (id, country, round, stage, event_date, title, quote, source_url, read_at, status, confirmed_by, confirmed_at) VALUES (gen_random_uuid(), 'GB', $1, 'award', '2027-02-20', 'Offers made', 'Offers were made on 20 February 2027.', $2, '2027-02-21T04:30:00Z', 'confirmed', 'chris', '2027-02-21T09:00:00Z')", [R34, NSTA_URL]);
  const closed = await roundsView(db, { countries: ['GB'], status: 'confirmed', within: 90, now: new Date('2027-03-01T00:00:00Z') });
  assert.equal(closed.countries[0].open, false);
});

test('W7-AC22 GET /api/rounds: without ?country= the view covers every country with an event (the Hub narrows the deadlines to the person\'s projects itself); a bad country code is 400; the route is audited in public scope', async () => {
  const mine = await call(associate, 'GET', '/api/rounds');
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.countries.map((c: any) => c.country), ['BR', 'GB'], 'every country with an event; Namibia has none');
  const all = await call(partner, 'GET', '/api/rounds');
  assert.deepEqual(all.body.countries.map((c: any) => c.country), ['BR', 'GB']);
  assert.ok(all.body.countries.every((c: any) => typeof c.open === 'boolean' && c.events.every((e: RoundEvent) => typeof e.days === 'number' || e.days === null)));
  assert.equal((await call(partner, 'GET', '/api/rounds?country=Brazil')).status, 400);
  assert.equal((await call(partner, 'GET', '/api/rounds?status=maybe')).status, 400);
  assert.equal((await call(partner, 'GET', '/api/rounds?within=0')).status, 400);
  const a = (await db.query<any>("SELECT scope, detail FROM audit_events WHERE action = 'rounds.view' ORDER BY id DESC LIMIT 1")).rows[0];
  assert.equal(a.scope, 'public');
});

/* ── the pack's licensing section reads from round_events ─────────────── */

test('W7-AC22 the licensing section carries each confirmed event as one cited line (the event cites its stored original); proposed, dismissed and superseded events are not written', async () => {
  const item = (await db.query<any>("SELECT id, version FROM items WHERE external_id = $1", [ANP_URL])).rows[0];
  const sysSeen: string[] = [];
  const packProvider = new FakeProvider((req) => {
    sysSeen.push(req.system);
    return [`HEADLINE EN: Acreage is offered through the permanent offer [doc:${item.id}]`, `HEADLINE ES: Las áreas se ofrecen mediante la oferta permanente [doc:${item.id}]`,
      `EN: The sixth cycle's schedule is indicative and may change by notice [doc:${item.id}].`, `ES: El cronograma del sexto ciclo es indicativo y puede cambiar por aviso [doc:${item.id}].`].join('\n');
  });
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  const r = await draftSectionsWithSummary({ db, provider: packProvider, country: 'BR', jobId, by: 'chris', now: new Date('2026-11-03T10:00:00Z'), budgetGbp: 2,
    sections: [{ section: 'licensing', sources: [{ id: 'anp-opc6-cronograma', url: ANP_URL, licence: 'CC BY 3.0 BR (gov.br)', attribution: 'ANP', fetched_at: '2026-10-19T04:30:00.000Z', item_id: item.id, sha256: null, reachable: true }] }] });
  assert.equal(r.sections[0].status, 'fresh');
  const head = (await db.query<any>("SELECT body FROM country_packs WHERE country = 'BR' AND section = 'licensing' AND superseded_by IS NULL")).rows[0];
  const lines = head.body.sentences as { en: string; es: string; cites: string[] }[];
  assert.ok(lines.some(l => /sixth cycle's schedule/.test(l.en)), 'the drafted sentence is there');
  const ev = lines.filter(l => l.en.includes(OPC6));
  assert.equal(ev.length, 1, `exactly the one confirmed event: ${JSON.stringify(lines.map(l => l.en))}`);
  assert.match(ev[0].en, /Bid deadline/); assert.match(ev[0].en, /2027-02-18/); assert.match(ev[0].en, /Public session for the presentation of offers \(postponed\)/);
  assert.match(ev[0].en, new RegExp(`\\[doc:${item.id}\\]$`), 'ends with the citation of the stored original');
  assert.match(ev[0].es, /Plazo de ofertas/); assert.match(ev[0].es, new RegExp(`\\[doc:${item.id}\\]$`));
  assert.deepEqual(ev[0].cites, [`doc:${item.id}`]);
  assert.ok(!lines.some(l => /2026-12-17/.test(l.en)), 'the superseded date is not written');
  assert.ok(!lines.some(l => /Tender notice/.test(l.en)), 'a proposed stage is not written');
  assert.ok(!sysSeen.some(s => /round_events|confirmed event/.test(s)), 'the events are added to the section from the table, not fed to the model');
});
