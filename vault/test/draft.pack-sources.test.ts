// Wave 7 PR5 (docs/vault-hub/wave7/05-markup.md §1.8, W7-AC19): Write to… can cite a pack original. The pack's stored
// originals (public, under the firm project) join the drafter's allowed set and its context for a project in that
// country, so a letter can quote the Act with a chip; a project elsewhere does not see them. Written before the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseDb, seedClient, seedOriginal, sourceOf } from './country-pack.helpers.ts';
import { FakeProvider, type LlmRequest } from '../src/llm/provider.ts';
import { draftSections } from '../src/llm/country-pack.ts';
import { assembleContext, allowedRefs, draft, userPrompt } from '../src/llm/draft.ts';
import type { Person } from '../src/auth.ts';

const PARTNER: Person = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris', role: 'partner' };
const ids = (prompt: string) => [...new Set([...prompt.matchAll(/\[doc:([0-9a-f-]{36})\]/g)].map(m => m[1]))];

test('W7-AC19: a letter for a project in Namibia may cite the pack\'s originals; a project in Brazil may not', async () => {
  const db = await baseDb();
  await seedClient(db, 'NA', 'p-na', 'active');
  await seedClient(db, 'BR', 'p-br', 'active');
  const act = await seedOriginal(db, { country: 'NA', section: 'legal', source_id: 'mme-petroleum-act', url: 'https://mme.gov.na/petroleum-act.pdf', title: 'Petroleum (Exploration and Production) Act 2 of 1991', text: 'Section 12: a petroleum exploration licence is granted for an initial period of 4 years.' });
  const loose = await seedOriginal(db, { country: 'NA', section: 'fiscal', source_id: 'stray', url: 'https://example.na/stray', text: 'A fetched page no pack section was built from.' });
  const jobId = (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id;
  await draftSections({ db, provider: new FakeProvider((req: LlmRequest) => { const a = ids(req.messages[0].content)[0]; return `HEADLINE EN: Licences run 4 years [doc:${a}]\nHEADLINE ES: Las licencias duran 4 años [doc:${a}]\nEN: An exploration licence runs 4 years [doc:${a}].\nES: Una licencia de exploración dura 4 años [doc:${a}].`; }),
    country: 'NA', jobId, by: 'chris', now: new Date('2026-10-05T09:00:00Z'), budgetGbp: 2, sections: [{ section: 'legal', sources: [sourceOf(act)] }] });

  const ctx = await assembleContext(db, PARTNER, { kind: 'letter', project_id: 'p-na', brief: 'Confirm the initial term of an exploration licence under the Act.' }, {});
  assert.ok(allowedRefs(ctx).has(`doc:${act.id}`), 'the pack original is in the allowed set');
  assert.ok(!allowedRefs(ctx).has(`doc:${loose.id}`), 'a fetched page no section was built from is not');
  assert.ok(ctx.pack_sources && ctx.pack_sources.length === 1 && ctx.pack_sources[0].ref === `doc:${act.id}`);
  assert.match(ctx.pack_sources![0].title, /Petroleum \(Exploration and Production\) Act/);
  assert.match(ctx.pack_sources![0].why, /country pack: Legal framework/);
  const prompt = userPrompt({ kind: 'letter', project_id: 'p-na', brief: 'x' }, ctx);
  assert.match(prompt, /COUNTRY PACK ORIGINALS \(public, NA\): .*Petroleum \(Exploration and Production\) Act.*initial period of 4 years.*\[doc:/);

  const r = await draft(db, PARTNER, { kind: 'letter', project_id: 'p-na', brief: 'Confirm the initial term of an exploration licence under the Act.' },
    new FakeProvider(() => `Under section 12 of the Act an exploration licence is granted for an initial period of 4 years [doc:${act.id}].\n\nWe propose to confirm this with the Ministry.`), {});
  assert.ok(r.citations.includes(`doc:${act.id}`));
  assert.equal(r.questions.length, 0, 'the sentence that cites the Act is a fact, not a question');
  assert.ok(r.sources.some(s => s.ref === `doc:${act.id}`), 'the chip is offered with the sources');

  const br = await assembleContext(db, PARTNER, { kind: 'letter', project_id: 'p-br', brief: 'Confirm the initial term of an exploration licence under the Act.' }, {});
  assert.ok(!allowedRefs(br).has(`doc:${act.id}`), 'Brazil does not cite Namibia\'s pack');
  assert.equal((br.pack_sources ?? []).length, 0);
  await db.close();
});
