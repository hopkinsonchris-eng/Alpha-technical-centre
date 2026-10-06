// The pack rework (docs/vault-hub/wave7/07-pack-rework.md, W7-R1, R2, R5): the terms card drafted from every original of
// the country in one cached call, a value standing only when it cites an original; any section may cite any original;
// the quality bar; the connector resource prints the terms first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.VAULT_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'vault-pack-terms-'));
const { openDb } = await import('../src/db/client.ts');
const { migrate } = await import('../src/db/migrate.ts');
const { seedMaster } = await import('../src/db/seed.ts');
const { FakeProvider } = await import('../src/llm/provider.ts');
type LlmRequest = import('../src/llm/provider.ts').LlmRequest;
const { draftSectionsWithSummary, loadPack, packMarkdown, packSystemPrompt, loadTerms, termsLines } = await import('../src/llm/country-pack.ts');
const { parseTermsReply, checkTerms, packQuality, termsFormat } = await import('../src/country/terms.ts');
const { TERMS } = await import('../src/country/types.ts');
type Db = Awaited<ReturnType<typeof openDb>>;
type DraftCtx = import('../src/llm/country-pack.ts').DraftCtx;

let db: Db;
before(async () => { db = await openDb(undefined); await migrate(db); await seedMaster(db); });
after(async () => { await db.close(); });

/** A stored pack original with its text in extracted (the drafter reads it from there when no chunks exist). */
async function seedOriginal(o: { country: string; section: string; source_id: string; url: string; text: string; title?: string }): Promise<string> {
  const id = (await db.query<{ id: string }>(`INSERT INTO items (id, type, title, created_at, authored_at, authors, project_id, legal_tag, origin, external_id, storage_key, mime, content_hash, version, filing, extracted, tags)
    VALUES (gen_random_uuid(), 'feed-snapshot', $1, now(), '2026-10-05T06:00:00Z', '{}', 'firm', 'lt-public', $2::jsonb, $3, $4, 'text/html', $5, 1, '{"method":"tool"}'::jsonb, $6::jsonb, $7::text[]) RETURNING id::text AS id`,
    [o.title ?? `${o.source_id} (${o.country})`, JSON.stringify({ source: 'country-pack', external_id: o.url, url: o.url, fetched_at: '2026-10-05T06:00:00Z' }), o.url, `originals/aa/${Math.random().toString(16).slice(2)}`, `sha256:${'a'.repeat(64)}`,
     JSON.stringify({ kind: 'country-source', pack: { country: o.country, section: o.section, source_id: o.source_id }, text: o.text, text_chars: o.text.length, ingest: { version: 1, status: 'ok' } }), ['country-pack', `country:${o.country}`, `section:${o.section}`]])).rows[0].id;
  return id;
}
const ref = (id: string, source_id: string, section: string) => ({ id: source_id, url: `https://example.org/${source_id}`, licence: 'public', attribution: `${source_id} (public)`, fetched_at: '2026-10-05T06:00:00.000Z', item_id: id, sha256: 'a'.repeat(64), reachable: true, section });
const ids = (t: string) => [...new Set([...t.matchAll(/\[doc:([^\]]+)\]/g)].map(m => m[1]))];

test('parseTermsReply and checkTerms: values pair EN and ES, stand only with an allowed citation, inherit the original\'s date, and the required terms missing are questions and quality.missing', () => {
  const reply = [
    'TERM regime EN: Primary activities run through empresas mixtas with PDVSA majority or, since 2026, Productive Participation Contracts [doc:aaa]',
    'TERM regime ES: Las actividades primarias se realizan mediante empresas mixtas con mayoría de PDVSA o, desde 2026, Contratos de Participación Productiva [doc:aaa]',
    'TERM royalty EN: Royalty of up to 30 % under article 51 of the 2026 reform [doc:bbb]',
    'TERM royalty ES: Regalía de hasta 30 % según el artículo 51 de la reforma de 2026 [doc:bbb]',
    'AS OF royalty: 2026-01-29',
    'TERM income_tax EN: Empresas mixtas pay 50 % income tax [doc:zzz]',     // zzz was not offered: not a value
    'TERM income_tax ES: Las empresas mixtas pagan 50 % de impuesto sobre la renta [doc:zzz]',
    'TERM noc EN: PDVSA and its subsidiaries form the national oil company [doc:aaa]',
    'QUESTION EN: The current round and its dates are not published.',
    'QUESTION ES: La ronda en curso y sus fechas no están publicadas.',
  ].join('\n');
  const parsed = parseTermsReply(reply);
  assert.equal(parsed.fields.regime?.en?.includes('[doc:aaa]'), true);
  assert.equal(parsed.fields.royalty?.as_of, '2026-01-29');
  const c = checkTerms(parsed, new Set(['doc:aaa', 'doc:bbb']), id => (id === 'aaa' ? '2026-10-05' : null));
  assert.match(c.fields.regime!.en, /^Primary activities run through empresas mixtas .*\. \[doc:aaa\]$/);
  assert.equal(c.fields.regime!.as_of, '2026-10-05', 'the original\'s own date when the model stated none');
  assert.equal(c.fields.royalty!.as_of, '2026-01-29');
  assert.equal(c.fields.income_tax, null, 'a value citing an original not offered does not stand');
  assert.ok(c.questions.some(q => /^Income tax: .*not cited to an original/.test(q.en)));
  assert.equal(c.fields.noc!.es, 'PDVSA and its subsidiaries form the national oil company. [doc:aaa]', 'the Spanish inherits the English when it is missing');
  assert.ok(c.questions.some(q => q.en === 'Regulator: not published in the originals.'));
  assert.ok(c.questions.some(q => q.en === 'The current round and its dates are not published.'));
  assert.deepEqual(c.citations.sort(), ['doc:aaa', 'doc:bbb']);
  const q = packQuality({ version: 1, status: 'fresh', stale_reason: null, built_at: null, fields: c.fields, questions: c.questions });
  assert.equal(q.ok, false);
  assert.deepEqual(q.missing, ['income_tax', 'regulator', 'awards', 'sanctions']);
  assert.ok(termsFormat().includes('TERM regime EN:') && termsFormat().includes('sanctions'));
  assert.equal(TERMS.filter(t => t.required).length, 7);
});

test('W7-R1, R2: the terms card and every section are drafted from one shared, cached block; the fiscal section cites the legal chapter; the card has every required value and meets the bar; the resource prints the terms first', async () => {
  const chapter = await seedOriginal({ country: 'VE', section: 'legal', source_id: 'chambers-oil-gas', url: 'https://practiceguides.chambers.com/oil-gas-2026/venezuela', title: 'Chambers, Oil & Gas 2026, Venezuela', text: 'The Ministry of People\'s Power for Hydrocarbons (MINHIDROCARBUROS) oversees the industry. PDVSA and its subsidiaries form the national oil company. Empresas mixtas are subject to income tax at 50 % of net income. Primary activities can run through empresas mixtas, direct service contracts or Productive Participation Contracts. Royalty is 30 % of extracted volumes. Acreage is awarded by direct negotiation with the Ministry. OFAC General License 46 governs US persons.' });
  const pwc = await seedOriginal({ country: 'VE', section: 'fiscal', source_id: 'pwc-tax-summaries', url: 'https://taxsummaries.pwc.com/venezuela/corporate/taxes-on-corporate-income', title: 'PwC, Venezuela corporate', text: 'Income from the exploitation of hydrocarbons is subject to a flat 50% rate under the Income Tax Law.' });
  const prompts: LlmRequest[] = [];
  const provider = new FakeProvider((req) => {
    prompts.push(req);
    const user = req.messages[0].content;
    const given = ids(req.system);
    const [a, b] = [given.find(x => x === chapter)!, given.find(x => x === pwc)!];
    if (/TASK: the terms card/.test(user)) return [
      `TERM regime EN: Empresas mixtas, direct service contracts or Productive Participation Contracts [doc:${a}]`, `TERM regime ES: Empresas mixtas, contratos de servicio directos o Contratos de Participación Productiva [doc:${a}]`,
      `TERM royalty EN: Royalty of 30 % of extracted volumes [doc:${a}]`, `TERM royalty ES: Regalía del 30 % de los volúmenes extraídos [doc:${a}]`,
      `TERM income_tax EN: 50 % on hydrocarbon income [doc:${b}] [doc:${a}]`, `TERM income_tax ES: 50 % sobre la renta de hidrocarburos [doc:${b}] [doc:${a}]`,
      `TERM regulator EN: MINHIDROCARBUROS [doc:${a}]`, `TERM regulator ES: MINHIDROCARBUROS [doc:${a}]`,
      `TERM noc EN: PDVSA and its subsidiaries [doc:${a}]`, `TERM noc ES: PDVSA y sus filiales [doc:${a}]`,
      `TERM awards EN: Direct negotiation with the Ministry [doc:${a}]`, `TERM awards ES: Negociación directa con el Ministerio [doc:${a}]`,
      `TERM sanctions EN: OFAC General License 46 governs US persons [doc:${a}]`, `TERM sanctions ES: La Licencia General 46 de la OFAC rige a las personas de EE. UU. [doc:${a}]`,
    ].join('\n');
    // Every section cites the chapter, whichever section it was fetched for; fiscal cites both.
    const cite = /SECTION: Fiscal terms/.test(user) ? `[doc:${b}] [doc:${a}]` : `[doc:${a}]`;
    return [`HEADLINE EN: Income tax is 50 % on hydrocarbon income ${cite}`, `HEADLINE ES: El impuesto sobre la renta es 50 % sobre la renta de hidrocarburos ${cite}`, `EN: PDVSA is the national oil company ${cite}.`, `ES: PDVSA es la petrolera estatal ${cite}.`].join('\n');
  });
  const ctx: DraftCtx = {
    db, provider, country: 'VE', jobId: (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id, by: 'chris', now: new Date('2026-10-06T12:00:00Z'), budgetGbp: 2,
    sections: [{ section: 'legal', sources: [ref(chapter, 'chambers-oil-gas', 'legal')] }, { section: 'fiscal', sources: [ref(pwc, 'pwc-tax-summaries', 'fiscal')] }, { section: 'regulator', sources: [] }, { section: 'questions', sources: [] }],
  };
  const s = await draftSectionsWithSummary(ctx);
  assert.equal(s.calls, 4, 'legal, fiscal, regulator (from the shared originals) and the terms');
  assert.ok(s.terms && s.terms.called && !s.terms.kept && s.terms.missing.length === 0, JSON.stringify(s.terms));
  // One cached block: the system prompt is identical across the calls and carries both originals; the user message names the section's own.
  assert.equal(new Set(prompts.map(p => p.system)).size, 1);
  assert.equal(prompts[0].system, packSystemPrompt('VE', await (async () => { const { loadOriginals } = await import('../src/llm/country-pack.ts'); return loadOriginals(db, [{ item_id: chapter, source_id: 'chambers-oil-gas' }, { item_id: pwc, source_id: 'pwc-tax-summaries' }]); })()));
  assert.ok(prompts.some(p => /SECTION: Fiscal terms/.test(p.messages[0].content) && p.messages[0].content.includes(`ORIGINALS FETCHED FOR THIS SECTION (read first, then any other that answers): [doc:${pwc}]`)));
  assert.ok(prompts.some(p => /SECTION: Regulator/.test(p.messages[0].content) && /FETCHED FOR THIS SECTION: none/.test(p.messages[0].content)));
  assert.ok(!prompts.some(p => /https?:\/\//.test(p.system + p.messages[0].content)), 'no URL in any prompt');
  const pack = (await loadPack(db, 'VE'))!;
  const fiscal = pack.sections.find(x => x.section === 'fiscal')!, regulator = pack.sections.find(x => x.section === 'regulator')!;
  assert.equal(fiscal.status, 'fresh'); assert.ok(fiscal.body.sentences[0].cites.includes(`doc:${chapter}`), 'fiscal cites the legal chapter');
  assert.equal(regulator.status, 'fresh', 'a section with no source of its own drafts from the shared originals');
  assert.equal(pack.quality.ok, true); assert.deepEqual(pack.quality.missing, []);
  assert.equal(pack.terms!.fields.income_tax!.en, `50 % on hydrocarbon income. [doc:${pwc}] [doc:${chapter}]`);
  assert.equal(pack.terms!.fields.income_tax!.as_of, '2026-10-05');
  assert.equal(pack.terms!.fields.state_share, null);
  const md = packMarkdown(pack);
  assert.ok(md.indexOf('## Terms · Términos') < md.indexOf('## Legal framework'), 'the terms print first');
  assert.match(md, /- Royalty · Regalía: Royalty of 30 % of extracted volumes\. \[doc:/);
  assert.match(md, /meets the bar/);
  assert.ok(termsLines(pack).some(l => /Income tax: 50 %/.test(l)));
  // The spend row for the terms call names the section 'terms'.
  const rows = (await db.query<any>("SELECT detail FROM audit_events WHERE action = 'llm.country-pack' AND detail->>'country' = 'VE'")).rows;
  assert.ok(rows.some(r => r.detail.section === 'terms'));
  // A second build with the same originals: nothing re-drafted, the terms kept, no call.
  const again = await draftSectionsWithSummary({ ...ctx, jobId: (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id });
  assert.equal(again.calls, 0); assert.equal(again.terms?.kept, true);
  assert.equal((await loadTerms(db, 'VE'))!.version, 1);
  // The same bytes, but text that arrived later (the ingest cron OCR'd a scan): the originals changed for the drafter, so the next build re-drafts.
  await db.query(`UPDATE items SET extracted = jsonb_set(extracted, '{text}', to_jsonb($2::text)) WHERE id = $1`, [pwc, 'Income tax 50 % on hydrocarbon income. Royalty 30 % of extracted volumes. Cost recovery is capped at 60 % of revenue.']);
  const third = await draftSectionsWithSummary({ ...ctx, jobId: (await db.query("INSERT INTO jobs (name) VALUES ('country-pack') RETURNING id")).rows[0].id });
  assert.ok(third.calls >= 4, `text that arrived later re-drafts the sections and the terms: ${third.calls} calls`);
  assert.equal((await loadTerms(db, 'VE'))!.version, 2);
});
