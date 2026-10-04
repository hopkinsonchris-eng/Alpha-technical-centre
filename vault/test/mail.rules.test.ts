// Wave 6, PR 2 (docs/vault-hub/wave6/05-markup.md §1.2, §1.3; W6-AC3 evaluation, W6-AC5 memory and status, W6-AC6 bulk):
// Protected and Blocked at capture, privacy levels, bulk mail kept apart, the filing memory and the ready status.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serviceSink } from '../src/ingest/items-client.ts';
import { captureMessage, type CaptureDeps } from '../src/ingest/mail/capture.ts';
import { bulkReason, loadRules, rememberDecision, ruleHit } from '../src/ingest/mail/rules.ts';
import { classify } from '../src/ingest/mail/classify.ts';
import type { RawMessage } from '../src/ingest/mail/types.ts';
import { setup, type Harness } from './fixtures/ingest/harness.ts';
import { seedMailProjects } from './fixtures/mail/seed.ts';

let h: Harness;
let deps: CaptureDeps;
before(async () => { h = await setup('vault-mailrules-'); await seedMailProjects(h.db); deps = { sink: await serviceSink(h.db), ingest: null, origin: 'zoho-mail' }; });
after(async () => { await h.db.close(); });

const CHRIS = 'chris@alpha-technical-centre.com', INFO = 'info@alpha-technical-centre.com';
const addr = (s: string) => { const m = /^(.*?)\s*<(.+)>$/.exec(s); return m ? { name: m[1].trim(), address: m[2].toLowerCase() } : { address: s.toLowerCase() }; };
let seq = 0;
function mk(o: Partial<Omit<RawMessage, 'from' | 'to' | 'cc'>> & { from?: string; to?: string[]; cc?: string[]; mailbox?: string } = {}): RawMessage {
  const n = ++seq;
  const id = o.external_id ?? `r${n}@rules.fixture`;
  const references = o.references ?? (o.in_reply_to ? [o.in_reply_to] : []);
  return { mailbox: o.mailbox ?? CHRIS, external_id: id, thread_id: references[0] ?? o.in_reply_to ?? id, in_reply_to: o.in_reply_to ?? null, references, from: addr(o.from ?? 'Jorge Ruiz <jruiz@fronteraenergy.com>'), to: (o.to ?? [CHRIS]).map(addr), cc: (o.cc ?? []).map(addr), subject: o.subject ?? `Message ${n}`, date: o.date ?? new Date(Date.UTC(2026, 3, 1, 8, 0, n)).toISOString(), text: o.text ?? `Body ${n}.`, attachments: o.attachments ?? [], labels: o.labels ?? [], folder: o.folder ?? 'inbox', ...(o.bulk_signals ? { bulk_signals: o.bulk_signals } : {}) };
}
const q = <T = any>(sql: string, p: unknown[] = []) => h.db.query<T>(sql, p).then(r => r.rows);
const row = async (id: string) => (await q('SELECT * FROM items WHERE external_id = $1 AND parent_id IS NULL', [id]))[0];
const byId = async (id: string) => (await q('SELECT * FROM items WHERE id = $1', [id]))[0];
const lastSkip = async () => (await q(`SELECT detail FROM audit_events WHERE action = 'mail.capture.skipped' ORDER BY id DESC LIMIT 1`))[0]?.detail;
const rule = (owner: string | null, kind: 'protected' | 'blocked', pattern: string) => h.db.query('INSERT INTO mail_rules (id, owner_id, kind, pattern, created_by) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), owner, kind, pattern, 'chris']);

test('W6-AC3: mail between colleagues only is never kept (Protected by rule), with an audit row; a Blocked address or domain on either list hides the message whoever else is on it', async () => {
  const internal = await captureMessage(h.db, h.storage, mk({ from: CHRIS, to: [INFO], cc: ['ana@alpha-technical-centre.com'], subject: 'Lunch?' }), deps);
  assert.deepEqual([internal.status, internal.reason], ['skipped', 'protected']);
  assert.equal((await lastSkip()).reason, 'protected');
  assert.equal(await row(internal.item_id ?? 'none'), undefined);
  const mixed = await captureMessage(h.db, h.storage, mk({ from: CHRIS, to: ['jruiz@fronteraenergy.com'], cc: [INFO], folder: 'sent', subject: 'Cubiro data' }), deps);
  assert.equal(mixed.status, 'created', 'an outside party on the message makes it firm business');
  // A firm Protected domain: a partner firm's own people count as colleagues.
  await rule(null, 'protected', 'partnerfirm.example');
  const partner = await captureMessage(h.db, h.storage, mk({ from: 'pat@partnerfirm.example', to: [CHRIS] }), deps);
  assert.deepEqual([partner.status, partner.reason], ['skipped', 'protected']);
  const partnerPlus = await captureMessage(h.db, h.storage, mk({ from: 'pat@partnerfirm.example', to: [CHRIS], cc: ['jruiz@fronteraenergy.com'] }), deps);
  assert.equal(partnerPlus.status, 'created');
  // Firm Blocked domain and address.
  await rule(null, 'blocked', 'recruiter.example'); await rule(null, 'blocked', 'spammer@vendor.example');
  const blocked = await captureMessage(h.db, h.storage, mk({ from: 'jruiz@fronteraenergy.com', cc: ['x@recruiter.example'] }), deps);
  assert.deepEqual([blocked.status, blocked.reason], ['skipped', 'blocked']);
  assert.equal((await lastSkip()).pattern, 'x@recruiter.example');
  assert.equal((await captureMessage(h.db, h.storage, mk({ from: 'spammer@vendor.example' }), deps)).reason, 'blocked');
  assert.equal((await captureMessage(h.db, h.storage, mk({ from: 'other@vendor.example' }), deps)).status, 'created', 'only the address is blocked, not the domain');
  // A personal Blocked rule applies to that person's mailbox only.
  await rule('chris', 'blocked', 'mybank.com');
  const mine = await captureMessage(h.db, h.storage, mk({ from: 'alerts-team@mybank.com' }), { ...deps, context: { person_id: 'chris', privacy: 'all' } });
  assert.deepEqual([mine.status, mine.reason], ['skipped', 'blocked']);
  const theirs = await captureMessage(h.db, h.storage, mk({ from: 'alerts-team@mybank.com', mailbox: INFO }), { ...deps, context: { person_id: 'ana', privacy: 'all' } });
  assert.equal(theirs.status, 'created');
  const rules = await loadRules(h.db);
  assert.deepEqual(rules.firm, { protected: ['partnerfirm.example'], blocked: ['recruiter.example', 'spammer@vendor.example'] });
  assert.deepEqual(ruleHit(mk({ from: CHRIS, to: [INFO] }), rules), { kind: 'protected' });
  assert.equal(ruleHit(mk({ from: 'jruiz@fronteraenergy.com' }), rules), null);
  await h.db.query('DELETE FROM mail_rules');
});

test('W6-AC3: public mail domains never become organisation proposals; privacy Subjects only keeps the subject line and nothing else; Nothing keeps nothing', async () => {
  const g = await captureMessage(h.db, h.storage, mk({ from: 'Some One <someone@gmail.com>', subject: 'A question about Talara' }), deps);
  assert.equal(g.status, 'created'); assert.deepEqual(g.proposals, []);
  assert.equal((await q(`SELECT count(*)::int AS n FROM review_queue WHERE kind = 'organisation' AND payload->>'domain' = 'gmail.com'`))[0].n, 0);
  const subj = await captureMessage(h.db, h.storage, mk({ subject: 'Cubiro injection volumes', text: 'The volumes are attached.', attachments: [{ filename: 'volumes.csv', mime: 'text/csv', bytes: new TextEncoder().encode('a,b\n1,2\n') }] }), { ...deps, context: { person_id: 'chris', privacy: 'subjects', connection_id: 'c-1' } });
  assert.equal(subj.status, 'created'); assert.deepEqual(subj.attachment_ids, []);
  const it = await byId(subj.item_id!);
  assert.equal(it.title, 'Cubiro injection volumes'); assert.equal(it.extracted.privacy, 'subjects'); assert.equal(it.extracted.connection_id, 'c-1');
  assert.equal((await q('SELECT count(*)::int AS n FROM chunks WHERE item_id = $1', [subj.item_id]))[0].n, 0);
  assert.equal((await q('SELECT count(*)::int AS n FROM items WHERE parent_id = $1', [subj.item_id]))[0].n, 0);
  const none = await captureMessage(h.db, h.storage, mk({}), { ...deps, context: { person_id: 'chris', privacy: 'none' } });
  assert.deepEqual([none.status, none.reason], ['skipped', 'privacy']);
});

test('W6-AC6: list headers, a no-reply sender or an unsubscribe line make a message bulk: kept apart (hidden, no queue row, no chunks, no proposal) and counted; outbound mail never is', async () => {
  assert.equal(bulkReason(mk({ bulk_signals: ['List-Unsubscribe'] })), 'List-Unsubscribe');
  assert.equal(bulkReason(mk({ from: 'noreply@notifications.example' })), 'sender noreply@notifications.example');
  assert.equal(bulkReason(mk({ from: 'news@oilgasjournal.com', text: 'Brent closed at 84. Click here to unsubscribe.' })), 'sender news@oilgasjournal.com', 'the sender rule comes first');
  assert.equal(bulkReason(mk({ from: 'jruiz@fronteraenergy.com', text: 'Please unsubscribe me from the list you set up.' })), 'unsubscribe line', 'a plain sender with an unsubscribe line is still bulk by this rule');
  assert.equal(bulkReason(mk({ from: CHRIS, folder: 'sent', to: ['jruiz@fronteraenergy.com'], text: 'You can unsubscribe any time.' })), null, 'the firm\'s own mail is never bulk');
  assert.equal(bulkReason(mk({ from: 'jruiz@fronteraenergy.com', text: 'Attaching the data.' })), null);
  const r = await captureMessage(h.db, h.storage, mk({ from: 'Newsletter <newsletter@trade.example>', subject: 'Weekly digest', text: 'News. Unsubscribe here.', bulk_signals: ['List-Id', 'Precedence'] }), deps);
  assert.equal(r.status, 'created'); assert.equal(r.outcome, 'bulk'); assert.equal(r.queue_id, undefined); assert.deepEqual(r.proposals, []);
  const it = await byId(r.item_id!);
  assert.equal(it.hidden, true); assert.equal(it.extracted.category, 'bulk'); assert.equal(it.extracted.bulk_reason, 'List-Id, Precedence'); assert.equal(it.extracted.hidden_reason, 'bulk'); assert.ok(it.tags.includes('bulk'));
  assert.equal((await q('SELECT count(*)::int AS n FROM filing_queue WHERE item_id = $1', [r.item_id]))[0].n, 0);
  assert.equal((await q(`SELECT detail->>'outcome' AS o FROM audit_events WHERE action = 'mail.capture' AND refs @> ARRAY['doc:' || $1::text]`, [r.item_id]))[0].o, 'bulk');
});

test('W6-AC5: one candidate at or above 0.6 with a known counterparty is ready; a thread anyone filed scores 1.0 with memory evidence; a domain decided three times adds the memory signal; Not a project email teaches a dismissal', async () => {
  // A registry contact at the client's domain who is not on the project's contact list: the domain and a field name carry it to 0.6+ but not to 0.85.
  await h.db.query(`INSERT INTO contacts (id, organisation_id, name, emails) VALUES ('ana-frontera', 'frontera-energy', 'Ana F.', '{afront@fronteraenergy.com}') ON CONFLICT DO NOTHING`);
  const ready = await captureMessage(h.db, h.storage, mk({ from: 'Ana F. <afront@fronteraenergy.com>', subject: 'Cubiro pressures', text: 'Monthly pressures for Cubiro.' }), deps);
  assert.equal(ready.status, 'created'); assert.equal(ready.outcome, 'ready', `confidence ${ready.confidence}`); assert.ok(ready.queue_id);
  assert.ok(ready.confidence! >= 0.6 && ready.confidence! < 0.85);
  assert.equal((await byId(ready.item_id!)).extracted.status, 'ready');
  const unknown = await captureMessage(h.db, h.storage, mk({ from: 'tech@vendor-x.example', subject: 'Service offer' }), deps);
  assert.equal(unknown.outcome, 'review');
  // The memory: a thread decided by hand.
  const first = await captureMessage(h.db, h.storage, mk({ external_id: 'thread-a@rules.fixture', from: 'eng@newco.example', subject: 'Proposal for Talara', text: 'We would like to discuss the Lote X redevelopment.' }), deps);
  assert.equal(first.outcome, 'review');
  assert.equal(await rememberDecision(h.db, first.item_id!, 'talara-brownfield', 'chris'), 2, 'the thread and the counterparty domain are remembered');
  const reply = mk({ from: 'eng@newco.example', in_reply_to: 'thread-a@rules.fixture', subject: 'Re: Proposal for Talara', text: 'Following up.' });
  const cls = await classify(h.db, reply);
  assert.equal(cls.project_id, 'talara-brownfield'); assert.equal(cls.confidence, 1); assert.deepEqual(cls.evidence.map(e => e.signal), ['memory']);
  const filed = await captureMessage(h.db, h.storage, reply, deps);
  assert.equal(filed.outcome, 'filed'); assert.equal(filed.project_id, 'talara-brownfield');
  // A domain decided three times adds 0.35 as evidence on a new thread.
  for (let i = 0; i < 2; i++) { const m = await captureMessage(h.db, h.storage, mk({ from: `p${i}@newco.example`, subject: `Note ${i}` }), deps); await rememberDecision(h.db, m.item_id!, 'talara-brownfield', 'chris'); }
  const fresh = await classify(h.db, mk({ from: 'new.person@newco.example', subject: 'Something else entirely', text: 'Hello.' }));
  const mem = fresh.evidence.find(e => e.signal === 'memory');
  assert.ok(mem && mem.weight === 0.35, JSON.stringify(fresh.evidence)); assert.equal(fresh.project_id, 'talara-brownfield');
  // Not a project email, remembered for the thread.
  const noise = await captureMessage(h.db, h.storage, mk({ external_id: 'thread-b@rules.fixture', from: 'sales@gadgets.example', subject: 'Great offer', text: 'Buy now.' }), deps);
  await rememberDecision(h.db, noise.item_id!, null, 'chris');
  const noiseReply = await captureMessage(h.db, h.storage, mk({ from: 'sales@gadgets.example', in_reply_to: 'thread-b@rules.fixture', subject: 'Re: Great offer', text: 'Still interested?' }), deps);
  assert.equal(noiseReply.outcome, 'dismissed'); assert.equal(noiseReply.project_id, 'firm'); assert.equal(noiseReply.queue_id, undefined);
  assert.equal((await byId(noiseReply.item_id!)).extracted.status, 'dismissed');
});
