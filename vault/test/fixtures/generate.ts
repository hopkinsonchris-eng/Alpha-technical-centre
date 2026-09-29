/**
 * Generates the schema fixtures: three valid and three invalid examples per
 * schema (each invalid one breaks a different rule), plus the AC15 seeded
 * counterparty (organisation, contacts, NDA, six dispatches). Deterministic.
 * Run: npx tsx test/fixtures/generate.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.dirname(fileURLToPath(import.meta.url));
const H = 'sha256:' + 'a'.repeat(64);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const legalTags = {
  valid: [
    { id: 'lt-firm', classification: 'firm', data_type: 'first-party', originator: 'ATC' },
    { id: 'lt-public', classification: 'public', data_type: 'public', originator: 'ANH', country_of_origin: ['CO'] },
    { id: 'lt-frontera-nda-2026', classification: 'client-nda', data_type: 'second-party', client_id: 'frontera', contract_id: 'NDA-2026-02', originator: 'Frontera Energy', expires_at: '2027-03-31', country_of_origin: ['CO'] },
  ],
  invalid: [
    { id: 'lt-x', classification: 'client-nda', data_type: 'second-party', originator: 'X' }, // client-nda without client_id
    { id: 'bad id', classification: 'firm', data_type: 'first-party', originator: 'ATC' },      // id pattern
    { id: 'lt-y', classification: 'secret', data_type: 'first-party', originator: 'ATC' },     // enum
  ],
};

const versions = [{ version: '2.1.0', released_at: '2026-09-23', commit: 'd8a4835', status: 'approved', modules: ['js/potential.js', 'js/analogues.js'] }, { version: '2.0.0', released_at: '2026-09-15', commit: '3f68b41', status: 'deprecated', breaking: true }];
const toolManifests = {
  valid: [
    { id: 'opportunity-register', name: 'Opportunity Register', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'opportunity-register.html', changelog: 'tools/opportunity-register/CHANGELOG.md', produces: ['technical_potential_bopd', 'uplift_bopd'], consumes: ['price_deck'], versions, aliases: { current: '2.1.0', previous: '2.0.0' } },
    { id: 'apex-asset-intelligence', name: 'APEX Asset Intelligence', owner: 'chris', lifecycle: 'production', kind: 'external-app', entry: 'https://apex-app2.onrender.com', versions: [{ version: '4.0.0', released_at: '2026-06-01', commit: '0000000' }], aliases: { current: '4.0.0' } },
    { id: 'situation-room', name: 'Situation Room', owner: 'chris', lifecycle: 'experimental', kind: 'browser-tool', entry: 'situation-room/index.html', versions: [{ version: '0.9.0', released_at: '2026-08-27', commit: '1c54095' }], aliases: { current: '0.9.0' } },
  ],
  invalid: [
    { id: 'no-alias', name: 'X', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'x.html', versions: [{ version: '1.0.0', released_at: '2026-01-01', commit: 'abcdef1' }], aliases: {} }, // aliases.current required
    { id: 'Bad_ID', name: 'X', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'x.html', versions: [{ version: '1.0.0', released_at: '2026-01-01', commit: 'abcdef1' }], aliases: { current: '1.0.0' } }, // id pattern
    { id: 'semver', name: 'X', owner: 'chris', lifecycle: 'production', kind: 'browser-tool', entry: 'x.html', versions: [{ version: '1.0', released_at: '2026-01-01', commit: 'abcdef1' }], aliases: { current: '1.0' } }, // version pattern
  ],
};

const baseRun = {
  job: 'opportunity-register', tool_version: '2.1.0', tool_commit: 'd8a4835', author: 'chris', created_at: '2026-09-25T10:00:00Z',
  client_id: 'frontera', project_id: 'llanos-screen', asset_ids: ['field:llanos:cubiro'], legal_tag: 'lt-frontera-nda-2026', title: 'Cubiro waterflood screen',
  inputs: [{ ref: 'ref:price_decks/brent-2026-09', kind: 'reference', version: '2026-09', hash: H, role: 'price_deck' }],
  assumptions: { oil_viscosity_cp: { value: 3.0, unit: 'cP', source: 'analogue', provenance: 'analogue' } },
  params: { play: 'onshore-clastic-waterflood', k: 150, hFt: 45 },
  outputs: { technical_potential_bopd: { value: 4200, unit: 'bopd', low: 2900, high: 6100 } },
  input_hash: H, status: 'draft',
};
const runRecords = {
  valid: [
    { id: U(1), ...baseRun },
    { id: U(2), ...baseRun, status: 'final', reviewed_by: 'partner2', parents: [U(1)], tags: ['vintage-2026-q3'] },
    { id: U(3), ...baseRun, job: 'apex-reservoir-3d', tool_version: '2.2.0', tool_commit: '661d20d', inputs: [{ ref: `run:${U(1)}`, kind: 'run', version: '2.1.0', hash: H, role: 'seed_model' }], outputs: { recovery_factor: { value: 0.31 } } },
  ],
  invalid: [
    { id: U(4), ...baseRun, legal_tag: undefined },                     // legal_tag required
    { id: U(5), ...baseRun, input_hash: 'md5:abc' },                    // hash pattern
    { id: U(6), ...baseRun, status: 'published' },                      // enum
  ],
};

const baseItem = { created_at: '2026-09-20T09:00:00Z', project_id: 'llanos-screen', client_id: 'frontera', legal_tag: 'lt-frontera-nda-2026', origin: { source: 'upload' }, content_hash: H, version: 1 };
const vaultItems = {
  valid: [
    { id: U(11), type: 'letter', title: 'Letter ATC-2026-0142 to Ecopetrol', ...baseItem, authored_at: '2026-09-18T00:00:00Z', authors: ['chris'], organisation_ids: ['ecopetrol'], reference_no: 'ATC-2026-0142', cites: [`run:${U(2)}`] },
    { id: U(12), type: 'email', title: 'RE: Cubiro data room access', ...baseItem, origin: { source: 'zoho-mail', external_id: '<abc@frontera.com>' }, filing: { method: 'classifier', confidence: 0.92 }, extracted: { contacts: ['maria@frontera.com'] } },
    { id: U(13), type: 'invoice', title: 'Invoice INV-2026-031', ...baseItem, origin: { source: 'zoho-books', external_id: 'inv-031' }, extracted: { number: 'INV-2026-031', amount: 18500, currency: 'USD', due: '2026-10-15', paid: false } },
  ],
  invalid: [
    { id: U(14), type: 'memo', title: 'x', ...baseItem },              // type enum
    { id: U(15), type: 'letter', title: 'x', ...baseItem, content_hash: 'abc' }, // hash pattern
    { id: U(16), type: 'letter', title: 'x', ...baseItem, version: 0 }, // version minimum
  ],
};

const lessons = {
  valid: [
    { id: U(21), claim: 'Llanos heavy-oil waterfloods: analogue viscosity of 3 cP understates Cubiro; use measured 6 cP when available.', scope: 'discipline', scope_id: 'reservoir', evidence: [`run:${U(2)}`], author: 'chris', created_at: '2026-09-26T10:00:00Z', status: 'confirmed', confidence: 0.8, legal_tag: 'lt-firm', sanitised: true, last_confirmed: '2026-09-26T10:00:00Z' },
    { id: U(22), claim: 'Send data-room NDAs with a 24-month term; 12 months expired mid-evaluation twice.', scope: 'firm', evidence: [`doc:${U(11)}`], author: 'dream:2026-w39', created_at: '2026-09-28T02:00:00Z', status: 'proposed', confidence: 0.6, recurrence: 2 },
    { id: U(23), claim: 'Register runs on potential.js 2.0.0 are not comparable with 2.1.0.', scope: 'tool', scope_id: 'opportunity-register', evidence: [`run:${U(1)}`], author: 'chris', created_at: '2026-09-23T10:00:00Z', status: 'invalidated', confidence: 0.9, valid_to: '2026-09-27T00:00:00Z', superseded_by: U(21) },
  ],
  invalid: [
    { id: U(24), claim: 'x', scope: 'firm', evidence: [], author: 'chris', created_at: '2026-09-28T02:00:00Z', status: 'proposed', confidence: 0.5 }, // evidence minItems
    { id: U(25), claim: 'x', scope: 'galaxy', evidence: ['run:1'], author: 'chris', created_at: '2026-09-28T02:00:00Z', status: 'proposed', confidence: 0.5 }, // scope enum
    { id: U(26), claim: 'x', scope: 'firm', evidence: ['run:1'], author: 'chris', created_at: '2026-09-28T02:00:00Z', status: 'proposed', confidence: 1.5 }, // confidence max
  ],
};

const analogueRows = {
  valid: [
    { id: U(31), source_ref: `run:${U(2)}`, asset_id: 'field:llanos:cubiro', basin_id: 'basin:llanos', country: 'CO', as_of: '2026-09-25', legal_tag: 'lt-frontera-nda-2026', provenance: 'own-evaluation', lithology: 'clastic', drive_mechanism: 'waterflood', fluid_type: 'heavy-oil', porosity_frac: { value: 0.21, provenance: 'measured' }, permeability_md: { value: 150, low: 60, high: 320, provenance: 'analogue' }, recovery_factor_frac: { value: 0.31, provenance: 'calculated' }, method: ['analogy', 'volumetric'] },
    { id: U(32), source_ref: `doc:${U(12)}`, asset_id: 'field:maracaibo:boscan', basin_id: 'basin:maracaibo', country: 'VE', as_of: '2025-11-01', legal_tag: 'lt-public', provenance: 'paper', api_gravity: { value: 10.5, provenance: 'reported' }, evidence: [{ property: 'api_gravity', quote: 'Boscán crude of 10.5° API', location: 'p. 3' }] },
    { id: U(33), source_ref: `doc:${U(13)}`, asset_id: 'field:neuquen:loma-campana', country: 'AR', as_of: '2026-08-01', legal_tag: 'lt-public', provenance: 'regulator', peak_rate_bopd: { value: 65000, provenance: 'reported' } },
  ],
  invalid: [
    { id: U(34), source_ref: 'x', asset_id: 'f', as_of: '2026-01-01', legal_tag: 'lt-public', provenance: 'guess' },           // provenance enum
    { id: U(35), source_ref: 'x', asset_id: 'f', as_of: '2026-01-01', legal_tag: 'lt-public', provenance: 'paper', porosity_frac: 0.2 }, // num object shape
    { id: U(36), source_ref: 'x', asset_id: 'f', as_of: '2026-01-01', legal_tag: 'lt-public', provenance: 'paper', country: 'COL' },     // country pattern
  ],
};

// AC15 seed: prospective partner with six dispatches and an NDA in force.
const ORG = 'petrolera-del-orinoco';
const dispatchSeed = [
  { n: 41, item: 51, direction: 'out', channel: 'email', at: '2026-02-03T14:20:00Z', ref: 'ATC-2026-0098', subject: 'Introduction and capability statement' },
  { n: 42, item: 52, direction: 'in', channel: 'email', at: '2026-02-10T09:05:00Z', ref: null, their: 'PDO-GC-2026-014', subject: 'Draft mutual NDA' },
  { n: 43, item: 53, direction: 'out', channel: 'courier', at: '2026-02-14T00:00:00Z', ref: 'ATC-2026-0103', subject: 'Signed mutual NDA', reply: 42 },
  { n: 44, item: 54, direction: 'out', channel: 'email', at: '2026-04-22T16:40:00Z', ref: 'ATC-2026-0117', subject: 'Technical proposal: Carabobo heavy-oil screening' },
  { n: 45, item: 55, direction: 'in', channel: 'portal', at: '2026-06-30T11:00:00Z', ref: null, their: 'PDO-PR-2026-088', subject: 'Request for clarification on proposal scope' },
  { n: 46, item: 56, direction: 'out', channel: 'post', at: '2026-07-08T00:00:00Z', ref: 'ATC-2026-0131', subject: 'Clarification letter on proposal scope', reply: 45 },
];
const dispatches = {
  valid: dispatchSeed.slice(0, 3).map(d => dispatchOf(d)),
  invalid: [
    { id: U(47), item_id: U(51), direction: 'sideways', organisation_id: ORG, channel: 'email', occurred_at: '2026-02-03T14:20:00Z', recorded_by: 'chris' }, // direction enum
    { id: U(48), item_id: U(51), direction: 'out', organisation_id: ORG, channel: 'email', occurred_at: '2026-02-03T14:20:00Z', recorded_by: 'chris', reference_no: '2026/98' }, // reference pattern
    { id: U(49), item_id: U(51), direction: 'out', organisation_id: ORG, channel: 'pigeon', occurred_at: '2026-02-03T14:20:00Z', recorded_by: 'chris' }, // channel enum
  ],
};
function dispatchOf(d: any) {
  return { id: U(d.n), item_id: U(d.item), direction: d.direction, organisation_id: ORG, contact_ids: ['maria-fernandez'], channel: d.channel, occurred_at: d.at, reference_no: d.ref, their_reference: d.their ?? null, in_reply_to: d.reply ? U(d.reply) : null, signed_by: d.direction === 'out' ? 'chris' : null, acknowledged_at: d.direction === 'out' ? d.at : null, recorded_by: d.channel === 'email' ? 'mail-capture' : 'chris', notes: d.subject };
}
const ac15 = {
  organisation: { id: ORG, name: 'Petrolera del Orinoco S.A.', kind: 'partner', country: 'VE', jurisdiction: 'Venezuela', registered_address: 'Av. Francisco de Miranda, Torre Orinoco, Piso 12, Caracas 1060, Venezuela', identifiers: { domains: ['petroleradelorinoco.com'] } },
  contacts: [
    { id: 'maria-fernandez', organisation_id: ORG, name: 'Ing. María Fernández', role: 'Gerente de Nuevos Negocios', emails: ['mfernandez@petroleradelorinoco.com'], postal_address: 'Av. Francisco de Miranda, Torre Orinoco, Piso 12, Caracas 1060', language: 'es' },
    { id: 'luis-paredes', organisation_id: ORG, name: 'Dr. Luis Paredes', role: 'Consultor Jurídico', emails: ['lparedes@petroleradelorinoco.com'], language: 'es' },
  ],
  legal_tag: { id: 'lt-orinoco-nda-2026', classification: 'client-nda', data_type: 'second-party', client_id: ORG, contract_id: 'NDA-PDO-ATC-2026', originator: 'Petrolera del Orinoco S.A.', expires_at: '2028-02-13', country_of_origin: ['VE'] },
  project: { id: 'orinoco-partnership', client_id: ORG, name: 'Petrolera del Orinoco: partnership and Carabobo screening', status: 'prospect', default_legal_tag: 'lt-orinoco-nda-2026' },
  nda_item: { id: U(53), type: 'nda', title: 'Mutual NDA ATC / Petrolera del Orinoco', created_at: '2026-02-14T00:00:00Z', authored_at: '2026-02-14T00:00:00Z', project_id: 'orinoco-partnership', client_id: ORG, organisation_ids: [ORG], legal_tag: 'lt-firm', origin: { source: 'upload' }, content_hash: H, version: 1, reference_no: 'ATC-2026-0103', extracted: { parties: ['Alpha Technical Centre Ltd', 'Petrolera del Orinoco S.A.'], effective_date: '2026-02-14', expiry: '2028-02-13', governing_law: 'England and Wales', confidentiality_term_months: 24 } },
  items: dispatchSeed.map(d => ({ id: U(d.item), type: d.channel === 'email' || d.channel === 'portal' ? 'email' : 'letter', title: d.subject, created_at: d.at, authored_at: d.at, project_id: 'orinoco-partnership', client_id: ORG, organisation_ids: [ORG], legal_tag: 'lt-orinoco-nda-2026', origin: { source: d.channel === 'email' ? 'zoho-mail' : 'upload' }, content_hash: 'sha256:' + String(d.n).repeat(32).slice(0, 64), version: 1, reference_no: d.ref })),
  dispatches: dispatchSeed.map(d => dispatchOf(d)),
};

const sets: Record<string, { valid: unknown[]; invalid: unknown[] }> = { 'legal-tag': legalTags, 'tool-manifest': toolManifests, 'run-record': runRecords, 'vault-item': vaultItems, lesson: lessons, 'analogue-row': analogueRows, dispatch: dispatches };
for (const [name, set] of Object.entries(sets)) {
  const dir = path.join(OUT, name); mkdirSync(dir, { recursive: true });
  set.valid.forEach((x, i) => writeFileSync(path.join(dir, `valid-${i + 1}.json`), JSON.stringify(x, null, 2) + '\n'));
  set.invalid.forEach((x, i) => writeFileSync(path.join(dir, `invalid-${i + 1}.json`), JSON.stringify(x, null, 2) + '\n'));
}
mkdirSync(path.join(OUT, 'ac15'), { recursive: true });
writeFileSync(path.join(OUT, 'ac15', 'seed.json'), JSON.stringify(ac15, null, 2) + '\n');
console.log('fixtures written');
