// Wave 7 PR5 (docs/vault-hub/wave7/05-markup.md §1.8, W7-AC18): every sentence of every pack section cites a stored
// original; an unreachable section says "no source reached" without a model call; the service section is honest; the
// Spanish is drafted in the same call; a client record never appears in a pack prompt; the budget stops drafting.
// Written before the implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDb, seedClient, seedOriginal, sourceOf, unreachable } from './country-pack.helpers.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { draftSection, draftSections, draftSectionsWithSummary, parsePackReply, diffSentences, type DraftCtx } from '../src/llm/country-pack.ts';
import { SECTION_SPECS, caveatFor } from '../src/country/sections.ts';
import { SECTIONS } from '../src/country/types.ts';

const CITED = /\[doc:[0-9a-f-]+\]$/;
const ids = (prompt: string) => [...new Set([...prompt.matchAll(/\[doc:([0-9a-f-]{36})\]/g)].map(m => m[1]))];

/** A reply that cites the originals it was given, adds one sentence with a fabricated id and one with no citation at all. */
function reply(req: LlmRequest): string {
  const user = req.messages[0].content;
  const given = ids(user);
  const a = given[0], b = given[1] ?? given[0];
  return [
    `HEADLINE EN: Hydrocarbons belong to the state and are licensed under the Petroleum Act [doc:${a}]`,
    `HEADLINE ES: Los hidrocarburos pertenecen al Estado y se licencian bajo la Ley de Petróleo [doc:${a}]`,
    `EN: Ownership of petroleum in the ground vests in the state [doc:${a}].`,
    `ES: La propiedad del petróleo en el subsuelo corresponde al Estado [doc:${a}].`,
    `EN: Royalty is 5 % of gross production [doc:${b}].`,
    `ES: La regalía es el 5 % de la producción bruta [doc:${b}].`,
    `EN: Corporate tax is 35 % [doc:99999999-9999-4999-8999-999999999999].`,
    `ES: El impuesto corporativo es el 35 % [doc:99999999-9999-4999-8999-999999999999].`,
    `EN: Licences run for 25 years.`,
    `ES: Las licencias duran 25 años.`,
    `EN: The Minister may extend a licence on application.`,
    `ES: El Ministro puede prorrogar una licencia a solicitud.`,
    `QUESTION EN: What is the current cost-recovery ceiling?`,
    `QUESTION ES: ¿Cuál es el tope vigente de recuperación de costos?`,
  ].join('\n');
}

test('sections.ts: ten sections, each with its question, what it may read and its caveat; service and legal/fiscal are honest by construction', () => {
  assert.deepEqual(Object.keys(SECTION_SPECS), SECTIONS.map(s => s.id));
  for (const s of SECTIONS) {
    const spec = SECTION_SPECS[s.id];
    assert.ok(spec.question.en.length > 10 && spec.question.es.length > 10, `${s.id} asks a question in both languages`);
    assert.ok(spec.reads.en.length > 10, `${s.id} says what it may read`);
    assert.equal(spec.ttl_days, s.ttl_days);
  }
  assert.match(caveatFor('legal')!.en, /orientation for screening; verify against the instrument in force/);
  assert.match(caveatFor('fiscal')!.en, /orientation for screening; verify against the instrument in force/);
  assert.match(caveatFor('service', { contacts: ['Walvis Bay Drilling', 'Namib Logging'] })!.en, /no public register; the firm's contacts here are Walvis Bay Drilling, Namib Logging/);
  assert.match(caveatFor('service', { contacts: [] })!.en, /no public register; the firm's contacts here are none recorded/);
  assert.equal(caveatFor('companies'), null);
});

test('parsePackReply pairs the English and Spanish lines; diffSentences names what was added, removed and changed', () => {
  const p = parsePackReply('HEADLINE EN: A [doc:x]\nHEADLINE ES: A-es [doc:x]\nEN: One [doc:x].\nES: Uno [doc:x].\nEN: Two [doc:y].\nES: Dos [doc:y].\nQUESTION EN: Why?\nQUESTION ES: ¿Por qué?');
  assert.deepEqual(p.headline, { en: 'A [doc:x]', es: 'A-es [doc:x]' });
  assert.deepEqual(p.sentences.map(s => [s.en, s.es]), [['One [doc:x].', 'Uno [doc:x].'], ['Two [doc:y].', 'Dos [doc:y].']]);
  assert.deepEqual(p.questions, [{ en: 'Why?', es: '¿Por qué?' }]);
  const d = diffSentences(
    [{ en: 'Royalty is 5 % [doc:a].', es: 'La regalía es el 5 % [doc:a].', cites: ['doc:a'] }, { en: 'Gone [doc:b].', es: 'Ido [doc:b].', cites: ['doc:b'] }],
    [{ en: 'Royalty is 6 % [doc:a].', es: 'La regalía es el 6 % [doc:a].', cites: ['doc:a'] }, { en: 'New [doc:c].', es: 'Nuevo [doc:c].', cites: ['doc:c'] }]);
  assert.equal(d.length, 3);
  assert.ok(d.some(x => /^Changed: /.test(x.en) && /6 %/.test(x.en) && /^Cambió: /.test(x.es)));
  assert.ok(d.some(x => /^Removed: Gone/.test(x.en) && /^Eliminado: /.test(x.es)));
  assert.ok(d.some(x => /^Added: New/.test(x.en) && /^Añadido: /.test(x.es)));
  assert.deepEqual(diffSentences([], [{ en: 'x', es: 'y', cites: [] }]), [], 'a first version has nothing to compare with');
});

test('W7-AC18 draftSection: every sentence cites one of this section\'s originals, in both languages, from one call; a foreign or missing citation becomes a question', async () => {
  const db = await baseDb();
  const act = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'mme-petroleum-act', url: 'https://mme.gov.na/petroleum-act.pdf', text: 'Petroleum (Exploration and Production) Act 2 of 1991. Ownership vests in the State. See https://mme.gov.na/acts for the gazette.' });
  const guide = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'chambers-oil-gas', url: 'https://practiceguides.chambers.com/oil-gas-2026/namibia', text: 'Royalty 5 % of gross production; corporate tax 35 %.' });
  let calls = 0; let captured: LlmRequest | null = null;
  const provider = new FakeProvider((req) => { calls++; captured = req; return reply(req); });
  const r = await draftSection(provider, 'legal', [
    { id: act.id, title: 'Petroleum Act', source_id: act.source_id, fetched_at: act.fetched_at, text: act.text, version: 1 },
    { id: guide.id, title: 'Chambers chapter', source_id: guide.source_id, fetched_at: guide.fetched_at, text: guide.text, version: 1 },
  ], { country: 'NA' });
  assert.equal(calls, 1, 'English and Spanish in one call');
  assert.equal(r.status, 'fresh');
  assert.ok(r.body.sentences.length >= 2);
  for (const s of r.body.sentences) {
    assert.match(s.en, CITED, s.en); assert.match(s.es, CITED, s.es);
    assert.ok(s.cites.length && s.cites.every(c => c === `doc:${act.id}` || c === `doc:${guide.id}`), `cites only this section's originals: ${s.cites}`);
    assert.ok(s.es.length > 0 && s.es !== s.en, 'Spanish present and different');
  }
  assert.ok(r.body.headline && CITED.test(r.body.headline.en) && CITED.test(r.body.headline.es));
  assert.ok(!JSON.stringify(r.body.sentences).includes('99999999-9999'), 'the fabricated id is gone');
  // The three sentences that could not cite an original of this section are questions, never facts.
  const qs = r.body.questions.map(q => q.en).join(' | ');
  assert.match(qs, /Corporate tax is 35 %/); assert.match(qs, /Licences run for 25 years/); assert.match(qs, /The Minister may extend/); assert.match(qs, /cost-recovery ceiling/);
  assert.ok(r.body.questions.every(q => q.es.length > 0), 'questions are bilingual');
  assert.ok(r.citations.includes(`doc:${act.id}`) && r.citations.includes(`doc:${guide.id}`));
  assert.ok(r.usage && r.usage.output > 0); assert.equal(typeof r.spend_gbp, 'number');
  // The prompt carries no URL except inside the stored originals' text, and the model is told never to fetch.
  const text = `${captured!.system}\n${captured!.messages.map(m => m.content).join('\n')}`;
  const urls = text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
  assert.deepEqual(urls, ['https://mme.gov.na/acts'], 'only the URL quoted inside an original\'s text appears');
  assert.match(captured!.system, /never fetch|do not fetch|no fetching/i);
  await db.close();
});

test('W7-AC18 draftSections: an unreachable section says "no source reached" with no model call; the service section is honest by construction; the prompts carry no client record; rows are versioned and superseded, never deleted', async () => {
  const db = await baseDb();
  const { ndaItem } = await seedClient(db, 'NA', 'p-na');
  await db.query("INSERT INTO organisations (id,name,kind,country) VALUES ('wbd','Walvis Bay Drilling','vendor','NA'), ('acme-uk','Acme UK','vendor','GB')");
  const act = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'mme-petroleum-act', url: 'https://mme.gov.na/petroleum-act.pdf', text: 'Petroleum Act 2 of 1991. Ownership vests in the State.' });
  const psa = await seedOriginal(db, { country: 'NA', section: 'fiscal', source_id: 'resourcecontracts', url: 'https://resourcecontracts.org/contract/na-1', text: 'Royalty 5 %; cost recovery ceiling 65 %; profit split 50/50.' });
  const prompts: LlmRequest[] = [];
  const provider = new FakeProvider((req) => { prompts.push(req); return reply(req); });
  const ctx: DraftCtx = {
    db, provider, country: 'NA', jobId: (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id, by: 'chris', now: new Date('2026-10-05T09:00:00Z'), budgetGbp: 2,
    sections: [
      { section: 'legal', sources: [sourceOf(act)] },
      { section: 'licensing', sources: [unreachable('mme-licensing', 'https://mme.gov.na/licensing')] },
      { section: 'fiscal', sources: [sourceOf(psa, { licence: 'CC BY-SA 4.0', attribution: 'ResourceContracts.org, CC BY-SA 4.0' })] },
      { section: 'service', sources: [] },
      { section: 'questions', sources: [] },
    ],
  };
  await draftSections(ctx);
  const rows = (await db.query('SELECT * FROM country_packs WHERE country = $1 ORDER BY section', ['NA'])).rows;
  const by = Object.fromEntries(rows.map((r: any) => [r.section, r]));
  assert.deepEqual(Object.keys(by).sort(), ['fiscal', 'legal', 'licensing', 'questions', 'service']);
  // Model calls: legal and fiscal only.
  assert.equal(prompts.length, 2);
  assert.equal(by.legal.status, 'fresh'); assert.equal(by.fiscal.status, 'fresh');
  for (const s of [...by.legal.body.sentences, ...by.fiscal.body.sentences]) { assert.match(s.en, CITED); assert.match(s.es, CITED); }
  assert.deepEqual(by.legal.source_items, [act.id]); assert.equal(by.legal.ttl_days, 180); assert.equal(by.legal.version, 1);
  assert.equal(by.legal.built_by, 'chris'); assert.equal(by.legal.model, 'fake-1'); assert.equal(by.legal.sources[0].attribution, 'mme-petroleum-act (public)');
  assert.equal(by.fiscal.sources[0].licence, 'CC BY-SA 4.0');
  // Unreachable: honest body, no sentences, no call.
  assert.equal(by.licensing.status, 'unreachable'); assert.equal(by.licensing.stale_reason, 'unreachable:mme-licensing');
  assert.match(by.licensing.body.headline.en, /no source reached/i); assert.match(by.licensing.body.headline.es, /ninguna fuente/i);
  assert.deepEqual(by.licensing.body.sentences, []); assert.equal(by.licensing.ttl_days, 7);
  // Service: no public register; the firm's own vendors in Namibia, not the one in the UK; no sentence without a citation.
  assert.equal(by.service.status, 'empty');
  assert.match(by.service.body.headline.en, /no public register; the firm's contacts here are Walvis Bay Drilling/);
  assert.ok(!by.service.body.headline.en.includes('Acme UK'));
  assert.deepEqual(by.service.body.sentences, []);
  // Questions: what the other sections could not answer, plus the sections that had no source.
  assert.equal(by.questions.status, 'fresh');
  assert.ok(by.questions.body.questions.length >= 2);
  assert.ok(by.questions.body.questions.some((q: any) => /cost-recovery ceiling/.test(q.en)));
  assert.ok(by.questions.body.questions.some((q: any) => /Licensing and the current round/.test(q.en) && /no source reached/i.test(q.en)));
  // Confidentiality: the client's record is in no prompt, nor is the NDA item id, nor the firm's vendor list in a non-service prompt.
  for (const p of prompts) {
    const t = `${p.system}\n${p.messages.map(m => m.content).join('\n')}`;
    assert.ok(!t.includes('CLIENT SECRET') && !t.includes(ndaItem) && !t.includes('123.4'), 'no client record reaches a pack prompt');
    assert.ok(!t.includes('p-na') && !t.includes('Client Co'), 'no project or client name either');
    for (const id of ids(t)) assert.ok([act.id, psa.id].includes(id), `only pack originals are offered: ${id}`);
    assert.ok(!/https?:\/\//.test(t), 'no URL in the prompt (the originals quoted here carry none)');
  }
  // Spend: one audit row per model call, under the feature's action, summed on the rows.
  const spend = (await db.query("SELECT action, tokens_in, tokens_out, detail FROM audit_events WHERE action = 'llm.country-pack' ORDER BY id")).rows;
  assert.equal(spend.length, 2); assert.ok(spend.every((s: any) => s.tokens_in > 0 && s.detail.country === 'NA' && ['legal', 'fiscal'].includes(s.detail.section)));
  assert.ok(rows.every((r: any) => r.spend_gbp !== null));

  // A rebuild writes version 2, points version 1 at it, keeps version 1, and says what changed.
  const act2 = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'mme-petroleum-act', url: 'https://mme.gov.na/petroleum-act.pdf', text: 'Petroleum Act 2 of 1991 as amended 2026. Ownership vests in the State. Royalty 6 %.', version: 2 });
  const provider2 = new FakeProvider((req) => reply(req).replace('5 %', '6 %').replace('el 5 %', 'el 6 %'));
  const summary = await draftSectionsWithSummary({ ...ctx, provider: provider2, sections: [{ section: 'legal', sources: [sourceOf(act2)] }] });
  const legal = (await db.query("SELECT * FROM country_packs WHERE country = 'NA' AND section = 'legal' ORDER BY version")).rows;
  assert.equal(legal.length, 2);
  assert.equal(legal[0].superseded_by, legal[1].id); assert.equal(legal[1].version, 2); assert.equal(legal[1].superseded_by, null);
  assert.ok(legal[1].body.changed_since.length >= 1, 'what changed is written');
  assert.ok(legal[1].body.changed_since.some((c: any) => /6 %/.test(c.en) && c.es.length > 0));
  assert.equal(summary.sections.find(s => s.section === 'legal')!.status, 'fresh');
  assert.ok(summary.spend_gbp >= 0);
  await db.close();
});

test('W7-AC18: the budget stops drafting; the sections not reached are written as due with stale_reason budget, never silently skipped', async () => {
  const db = await baseDb();
  const a = await seedOriginal(db, { country: 'GY', section: 'legal', source_id: 'act', url: 'https://petroleum.gov.gy/act.pdf', text: 'Petroleum Activities Act 2023.' });
  const b = await seedOriginal(db, { country: 'GY', section: 'fiscal', source_id: 'psa', url: 'https://petroleum.gov.gy/psa.pdf', text: 'Royalty 10 %; cost recovery 65 %.' });
  const c = await seedOriginal(db, { country: 'GY', section: 'regulator', source_id: 'mnr', url: 'https://petroleum.gov.gy/', text: 'The Ministry of Natural Resources regulates.' });
  let calls = 0;
  const provider = new FakeProvider((req) => { calls++; return reply(req); });
  provider.model = 'claude-sonnet-5-5';     // a priced model, so the fake's token counts cost something
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  const s = await draftSectionsWithSummary({ db, provider, country: 'GY', jobId, by: 'job:1', now: new Date('2026-10-05T09:00:00Z'), budgetGbp: 0.00001,
    sections: [{ section: 'legal', sources: [sourceOf(a)] }, { section: 'fiscal', sources: [sourceOf(b)] }, { section: 'regulator', sources: [sourceOf(c)] }] });
  assert.equal(calls, 1, 'the first section spends the budget; the rest are not drafted');
  const rows = Object.fromEntries((await db.query("SELECT section, status, stale_reason, body FROM country_packs WHERE country = 'GY'")).rows.map((r: any) => [r.section, r]));
  assert.equal(rows.legal.status, 'fresh');
  assert.equal(rows.fiscal.status, 'due'); assert.equal(rows.fiscal.stale_reason, 'budget');
  assert.equal(rows.regulator.status, 'due'); assert.equal(rows.regulator.stale_reason, 'budget');
  assert.deepEqual(rows.fiscal.body.sentences, []); assert.match(rows.fiscal.body.headline.en, /budget/i);
  assert.equal(s.stopped_by, 'budget'); assert.ok(s.spend_gbp > 0);
  await db.close();
});

test('no drafting provider: nothing is drafted, nothing is invented; the sections are written as due so the weekly refresh retries them', async () => {
  const db = await baseDb();
  const a = await seedOriginal(db, { country: 'GY', section: 'legal', source_id: 'act', url: 'https://petroleum.gov.gy/act.pdf', text: 'Petroleum Activities Act 2023.' });
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  await draftSections({ db, provider: null, country: 'GY', jobId, by: 'job:1', now: new Date(), budgetGbp: 2, sections: [{ section: 'legal', sources: [sourceOf(a)] }] });
  const row = (await db.query("SELECT status, stale_reason, body, source_items FROM country_packs WHERE country = 'GY' AND section = 'legal'")).rows[0];
  assert.equal(row.status, 'due'); assert.equal(row.stale_reason, 'no_provider');
  assert.deepEqual(row.body.sentences, []); assert.deepEqual(row.source_items, [a.id]);
  await db.close();
});
