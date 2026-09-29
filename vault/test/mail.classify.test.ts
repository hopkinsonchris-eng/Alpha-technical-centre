import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FakeProvider, type LlmProvider } from '../src/llm/provider.ts';
import { classify, confidenceOf, excludedReason, FILE_THRESHOLD, parseExclusions, type Classification } from '../src/ingest/mail/classify.ts';
import type { RawMessage } from '../src/ingest/mail/types.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { LABELLED, type Labelled } from './fixtures/mail/labelled.ts';
import { PROJECTS, seedMailProjects } from './fixtures/mail/seed.ts';

let h: Harness;
before(async () => { h = await setup('vault-mailc-'); await seedMailProjects(h.db); });
after(async () => { await h.db.close(); });

const INFO = 'info@alpha-technical-centre.com';
const addr = (s: string) => { const m = /^(.*?)\s*<(.+)>$/.exec(s); return m ? { name: m[1].trim(), address: m[2].toLowerCase() } : { address: s.toLowerCase() }; };

function raw(l: Labelled): RawMessage {
  const parent = l.thread ? `parent-${l.id}@fixture` : null;
  return {
    mailbox: INFO, external_id: `${l.id}@fixture`, thread_id: parent ?? `${l.id}@fixture`, in_reply_to: parent, references: parent ? [parent] : [],
    from: addr(l.from), to: (l.to ?? [INFO]).map(addr), cc: (l.cc ?? []).map(addr), subject: l.subject, date: '2026-04-01T10:00:00Z', text: l.text,
    attachments: [], labels: [], folder: l.folder ?? 'inbox',
  };
}

/** A stand-in for the model: it settles a tie by what the message is about. Only ever asked when two projects tie. */
function scripted(calls: string[]): LlmProvider {
  return new FakeProvider(req => {
    const text = req.messages.at(-1)!.content;
    const body = text.split('Candidate projects:')[0].toLowerCase();
    calls.push(/^subject: (.*)$/m.exec(body)?.[1] ?? '');
    if (/regal|royalt|fiscal|tax/.test(body)) return '{"project_id":"ecopetrol-fiscal-review","confidence":0.9}';
    if (/well|drill|pad|infill/.test(body)) return '{"project_id":"middle-magdalena","confidence":0.9}';
    return '{"project_id":"none","confidence":0.2}';
  });
}

async function seedThreadParents() {
  for (const l of LABELLED) {
    if (!l.thread) continue;
    const p = (await h.db.query<any>('SELECT default_legal_tag, client_id FROM projects WHERE id = $1', [l.thread])).rows[0];
    await h.db.query(
      `INSERT INTO items (id, type, title, created_at, project_id, client_id, legal_tag, origin, external_id, content_hash, extracted) VALUES ($1,'email','earlier message',now(),$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
      [randomUUID(), l.thread, p.client_id, p.default_legal_tag, JSON.stringify({ source: 'zoho-mail', external_id: `parent-${l.id}@fixture` }), `parent-${l.id}@fixture`, 'sha256:' + '0'.repeat(64), JSON.stringify({ thread_id: `parent-${l.id}@fixture` })]);
  }
}

test('the labelled set: 63 messages over four projects, precision at the 0.85 threshold is at least 0.95, recall is reported', async () => {
  assert.ok(LABELLED.length >= 60);
  assert.deepEqual([...new Set(LABELLED.map(l => l.expect).filter(Boolean))].sort(), [...PROJECTS].sort());
  await seedThreadParents();
  const calls: string[] = [];
  const provider = scripted(calls);
  const results = new Map<string, Classification>();
  for (const l of LABELLED) results.set(l.id, await classify(h.db, raw(l), { provider }));

  const filed = LABELLED.filter(l => results.get(l.id)!.confidence >= FILE_THRESHOLD);
  const right = filed.filter(l => results.get(l.id)!.project_id === l.expect);
  const wrong = filed.filter(l => results.get(l.id)!.project_id !== l.expect);
  const belong = LABELLED.filter(l => l.expect);
  const recalled = belong.filter(l => results.get(l.id)!.confidence >= FILE_THRESHOLD && results.get(l.id)!.project_id === l.expect);
  const precision = right.length / filed.length, recall = recalled.length / belong.length;
  console.log(`classifier: ${LABELLED.length} messages, ${filed.length} auto-filed, precision ${precision.toFixed(3)} (${right.length}/${filed.length}), recall ${recall.toFixed(3)} (${recalled.length}/${belong.length}); wrong: ${wrong.map(w => w.id).join(', ') || 'none'}; tie-break asked ${calls.length} times (${calls.join(' | ')})`);

  assert.ok(filed.length >= 40, `enough messages file for precision to mean something (${filed.length})`);
  assert.ok(precision >= 0.95, `precision ${precision}: ${wrong.map(w => `${w.id}→${results.get(w.id)!.project_id}`).join(', ')}`);
  assert.deepEqual(wrong.map(w => w.id), ['h01'], 'the only wrong filing is the documented hard case');
  assert.ok(recall >= 0.7, `recall ${recall}`);
  // Noise never files.
  for (const l of LABELLED.filter(x => x.group === 'noise' || x.group === 'free-mail' && x.expect === null)) assert.ok(results.get(l.id)!.confidence < FILE_THRESHOLD, l.id);
  // Messages with several candidate projects were labelled as such, and the provider was asked only about ties.
  assert.ok(calls.length >= 3 && calls.length <= 8, `tie-breaks asked: ${calls.length}`);
  assert.equal(results.get('c04')!.tie_break, 'llm');
  assert.equal(results.get('c05')!.project_id, 'ecopetrol-fiscal-review');
  assert.ok(results.get('c01')!.confidence < FILE_THRESHOLD, 'a tie the model cannot settle goes to the queue');
});

test('confidence: an address match alone reaches the threshold, a domain match or a thread alone does not', () => {
  assert.equal(confidenceOf(0.5), 0.85);
  assert.ok(confidenceOf(0.35) < FILE_THRESHOLD);
  assert.ok(confidenceOf(0.3) < FILE_THRESHOLD);
  assert.ok(confidenceOf(0.2) < FILE_THRESHOLD);
  assert.ok(confidenceOf(0.35 + 0.2) >= FILE_THRESHOLD, 'domain plus a token hit files');
  assert.ok(confidenceOf(0.3 + 0.2) >= FILE_THRESHOLD, 'thread plus a token hit files');
  assert.equal(confidenceOf(1), 1);
  assert.equal(confidenceOf(0), 0);
});

test('evidence names the signals behind the winning project', async () => {
  const l = LABELLED.find(x => x.id === 'a07')!;
  const c = await classify(h.db, raw(l), { provider: null });
  assert.equal(c.project_id, 'middle-magdalena');
  assert.deepEqual(c.evidence.map(e => e.signal), ['contact', 'tokens']);
  assert.equal(c.evidence[0].detail, 'ptorres@ecopetrol.com.co');
  assert.equal(c.evidence[0].weight, 0.5);
  assert.match(c.evidence[1].detail, /middle/);
  assert.equal(c.candidates[0].project_id, 'middle-magdalena');
  assert.equal(c.candidates[1].project_id, 'ecopetrol-fiscal-review');
  assert.equal(c.candidates[1].evidence[0].signal, 'contact');
});

test('a tie within 0.1 goes to the provider; its answer needs confidence of 0.85 to file, and an unusable answer queues the message', async () => {
  const tie = raw(LABELLED.find(x => x.id === 'c04')!);
  const asked: string[] = [];
  const say = (reply: string): LlmProvider => new FakeProvider(req => { asked.push(req.messages.at(-1)!.content); return reply; });

  const ok = await classify(h.db, tie, { provider: say('{"project_id":"middle-magdalena","confidence":0.92}') });
  assert.equal(ok.project_id, 'middle-magdalena'); assert.equal(ok.tie_break, 'llm'); assert.ok(ok.confidence >= FILE_THRESHOLD);
  assert.match(asked[0], /Candidate projects:/); assert.match(asked[0], /id: middle-magdalena/); assert.match(asked[0], /id: ecopetrol-fiscal-review/);
  assert.ok(ok.evidence.some(e => e.signal === 'llm'));

  const unsure = await classify(h.db, tie, { provider: say('{"project_id":"middle-magdalena","confidence":0.6}') });
  assert.ok(unsure.confidence < FILE_THRESHOLD);
  for (const reply of ['not json', '{"project_id":"talara-brownfield","confidence":0.99}', '{"project_id":"none","confidence":0}']) {
    const r = await classify(h.db, tie, { provider: say(reply) });
    assert.equal(r.tie_break, 'unresolved', reply); assert.ok(r.confidence <= 0.6);
  }
  const none = await classify(h.db, tie, { provider: null });
  assert.equal(none.tie_break, 'unresolved'); assert.ok(none.confidence <= 0.6);
  const boom = await classify(h.db, tie, { provider: { name: 'x', model: 'x', complete: async () => { throw new Error('down'); } } });
  assert.equal(boom.tie_break, 'unresolved');

  // No tie, no call.
  const before = asked.length;
  await classify(h.db, raw(LABELLED.find(x => x.id === 'a06')!), { provider: say('{}') });
  assert.equal(asked.length, before);
});

test('firm addresses do not count as counterparties; a closed project is not a candidate; no signal means no project', async () => {
  const base = raw(LABELLED.find(x => x.id === 'f01')!);
  const internal = await classify(h.db, { ...base, from: { address: 'chris@alpha-technical-centre.com' }, to: [{ address: INFO }], subject: 'Notes', text: 'Notes to self.' });
  assert.equal(internal.project_id, null); assert.equal(internal.confidence, 0); assert.deepEqual(internal.candidates, []);

  await h.db.query(`UPDATE projects SET status = 'closed' WHERE id = 'talara-brownfield'`);
  try {
    const c = await classify(h.db, raw(LABELLED.find(x => x.id === 'a16')!), { provider: null });
    assert.notEqual(c.project_id, 'talara-brownfield');
    assert.ok(c.confidence < FILE_THRESHOLD);
  } finally { await h.db.query(`UPDATE projects SET status = 'active' WHERE id = 'talara-brownfield'`); }
});

test('exclusions: settings.mail_exclusions holds addresses, domains and label names; personal labels are always excluded', () => {
  const ex = parseExclusions({ addresses: ['Family@Example.com'], domains: ['bank.example'], labels: ['Private/Health', 'Finance-Personal'] });
  assert.deepEqual(ex, { addresses: ['family@example.com'], domains: ['bank.example'], labels: ['private/health', 'finance-personal'] });
  assert.deepEqual(parseExclusions(['a@b.com', '@c.org', '*@d.org', 'Legal-Private']), { addresses: ['a@b.com'], domains: ['c.org', 'd.org'], labels: ['legal-private'] });
  assert.deepEqual(parseExclusions(undefined), { addresses: [], domains: [], labels: [] });

  const msg = (over: Partial<RawMessage>): RawMessage => ({ ...raw(LABELLED[0]), ...over });
  assert.equal(excludedReason(msg({}), ex), null);
  assert.deepEqual(excludedReason(msg({ from: { address: 'family@example.com' } }), ex), { kind: 'address' });
  assert.deepEqual(excludedReason(msg({ from: { address: 'x@bank.example' } }), ex), { kind: 'domain' });
  assert.deepEqual(excludedReason(msg({ labels: ['INBOX', 'Private/Health'] }), ex), { kind: 'label' });
  for (const l of ['Personal', '$Personal', '\\Personal', 'personal/family', 'PRIVATE']) assert.deepEqual(excludedReason(msg({ labels: [l] }), parseExclusions(undefined)), { kind: 'personal-label' }, l);
  assert.equal(excludedReason(msg({ labels: ['CATEGORY_PERSONAL', 'Personalization'] }), parseExclusions(undefined)), null, 'Gmail\'s Personal tab is not a personal label');
  // Mail the firm sent to an excluded address is excluded too; mail merely copied to one is not.
  const sent = msg({ from: { address: 'chris@alpha-technical-centre.com' }, to: [{ address: 'family@example.com' }], folder: 'sent' });
  assert.deepEqual(excludedReason(sent, ex), { kind: 'address' });
  assert.equal(excludedReason(msg({ cc: [{ address: 'family@example.com' }] }), ex), null);
});
