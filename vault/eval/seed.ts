/**
 * Evaluation corpus (M17): a small, fully synthetic Vault that the retrieval gold set is written against, so the
 * evaluation is reproducible offline. Three clients (each with an NDA-tagged project), 42 items, 10 runs
 * (one superseded), 3 confirmed lessons and 9 dispatches, plus firm and public records.
 *
 * Everything is deterministic: ids come from uuidFrom("eval:<key>"), dates are fixed, chunks are embedded with the
 * FakeEmbedder. `npx tsx eval/seed.ts` prints the key → ref table used to write gold questions.
 *
 * Text is short on purpose (one chunk per record, 120-260 characters) and avoids abbreviations with full stops so
 * that sentence splitting in the drafting checks is unambiguous. Each project holds two broad records (kickoff notes
 * and a risk register) that mention most of its topics without answering any of them, and the firm and public
 * records share vocabulary with the client records: those are the distractors that make ranking matter.
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Db } from '../src/db/client.ts';
import type { Person } from '../src/auth.ts';
import { uuidFrom } from '../src/db/seed.ts';
import { templateContext } from '../src/ingest/chunk.ts';
import { FakeEmbedder, vectorLiteral, type Embedder } from '../src/ingest/embed.ts';

export const EVAL_NOW = new Date('2026-09-29T12:00:00Z');
export const EVAL_PERSON: Person = { id: 'chris', email: 'chris@alpha-technical-centre.com', name: 'Chris Hopkinson', role: 'partner' };

export const id = (key: string) => uuidFrom(`eval:${key}`);
export const docRef = (key: string) => `doc:${id(key)}`;
export const runRef = (key: string) => `run:${id(key)}`;
export const lessonRef = (key: string) => `lesson:${id(key)}`;

const CLIENTS = [
  { id: 'frontera', name: 'Frontera Energy', project: 'llanos-waterflood', title: 'Llanos Basin waterflood screening', tag: 'lt-frontera-nda-2025', members: ['chris', 'ana'] },
  { id: 'ecopetrol', name: 'Ecopetrol', project: 'middle-magdalena', title: 'Middle Magdalena infill screening', tag: 'lt-ecopetrol-nda-2026', members: ['chris', 'ben'] },
  { id: 'costa-norte', name: 'Costa Norte Petróleos', project: 'talara-brownfield', title: 'Talara brownfield redevelopment', tag: 'lt-costanorte-nda-2025', members: ['chris', 'ana', 'ben'] },
] as const;
type ProjectId = (typeof CLIENTS)[number]['project'] | 'firm';

interface Doc { key: string; type: string; title: string; project: ProjectId; date: string; author: string; text: string; tag?: string; ref_no?: string; kind?: string; direction?: 'in' | 'out'; channel?: string }

const DOCS: Doc[] = [
  /* ── Frontera Energy · Llanos Basin waterflood screening ── */
  { key: 'l-volumetrics', type: 'report', title: 'Llanos waterflood screening: volumetrics memo', project: 'llanos-waterflood', date: '2026-08-20', author: 'ana',
    text: 'Volumetrics for the Guadalupe reservoir from 14 wells: P50 OOIP is 412 MMSTB, with P10 498 and P90 351 MMSTB. Net-to-gross of 0.71 and porosity drive the range.' },
  { key: 'l-basis', type: 'note', kind: 'basis', title: 'Basis note: Llanos waterflood screening v2', project: 'llanos-waterflood', date: '2026-09-02', author: 'chris',
    text: 'Basis of evaluation: five-spot injection pattern, voidage replacement ratio 1.1, Brent flat 68 USD/bbl real, discount rate 10 percent and a 15-year horizon. OOIP is the P50 volumetric case.' },
  { key: 'l-email-inj', type: 'email', title: 'RE: Cubiro water injection data request', project: 'llanos-waterflood', date: '2026-09-28', author: 'jorge.salazar@frontera.example', direction: 'in', channel: 'email',
    text: 'Frontera confirms that Cubiro-14 injection averaged 8,200 bwpd over the last quarter. Monthly allocation files follow by 10 October and the Station 2 meter calibration certificate is attached.' },
  { key: 'l-letter', type: 'letter', title: 'Letter ATC-2026-0142: waterflood screening scope', project: 'llanos-waterflood', date: '2026-07-08', author: 'chris', ref_no: 'ATC-2026-0142', direction: 'out', channel: 'post',
    text: 'We propose a three-phase waterflood screening covering a data audit, simulation screening and economic ranking, for a fixed fee of USD 96,000 with delivery within ten weeks of data receipt.' },
  { key: 'l-water', type: 'report', title: 'Llanos produced water handling review', project: 'llanos-waterflood', date: '2026-08-27', author: 'ben',
    text: 'Station 2 produced water treatment capacity is 45,000 bwpd. Expansion to 60,000 bwpd needs a third skim tank and one additional injection pump.' },
  { key: 'l-kickoff', type: 'note', title: 'Kickoff meeting notes 2026-08-11', project: 'llanos-waterflood', date: '2026-08-11', author: 'chris',
    text: 'Waterflood screening kickoff with Frontera: scope, data audit, OOIP volumetrics, voidage replacement, injection rates, PVT and schedule discussed. Frontera to share the Cubiro-14 PVT report and injection history.' },
  { key: 'l-pvt', type: 'report', title: 'PVT report Cubiro-14 sample', project: 'llanos-waterflood', date: '2026-09-05', author: 'ana',
    text: 'Cubiro-14 separator sample: bubble point pressure 1,850 psia at 168 F, oil viscosity 3.2 cP, formation volume factor 1.21 rb/stb and solution gas-oil ratio 420 scf/stb.' },
  { key: 'l-core', type: 'report', title: 'Llanos core analysis summary', project: 'llanos-waterflood', date: '2026-08-30', author: 'ana',
    text: 'Core plugs from the Guadalupe sands show average porosity 18.5 percent, permeability 240 mD and a Kv/Kh ratio of 0.3. A high-permeability streak of 1,200 mD sits near the top.' },
  { key: 'l-risk', type: 'note', title: 'Llanos waterflood risk register', project: 'llanos-waterflood', date: '2026-09-10', author: 'chris',
    text: 'Risks: early water breakthrough through the high-permeability streak, uncertain aquifer support, injection allocation quality, OOIP uncertainty and water handling capacity at Station 2.' },
  { key: 'l-inj-history', type: 'spreadsheet', title: 'Injection history Cubiro 2024-2026', project: 'llanos-waterflood', date: '2026-09-14', author: 'ana',
    text: 'Cumulative water injected is 31.4 MMbbl to August 2026. The voidage replacement ratio was 0.82 over the last twelve months, below the 1.0 target.' },
  { key: 'l-questions', type: 'email', title: 'Frontera questions ahead of the workshop', project: 'llanos-waterflood', date: '2026-09-18', author: 'jorge.salazar@frontera.example', direction: 'in', channel: 'email',
    text: 'Frontera asks: How big is the oil in place of the Guadalupe reservoir and how uncertain is it? At what pressure does the Cubiro-14 oil release gas? How much water per day goes into Cubiro-14 and can Station 2 treat it?' },
  { key: 'l-comments', type: 'email', title: 'Frontera comments on draft screening report', project: 'llanos-waterflood', date: '2026-09-25', author: 'jorge.salazar@frontera.example', direction: 'in', channel: 'email',
    text: 'Frontera asks for an oil price sensitivity at 55 and 80 USD/bbl and for water disposal cost to be shown separately from lifting cost in the economics.' },

  /* ── Ecopetrol · Middle Magdalena infill screening ── */
  { key: 'm-spacing', type: 'report', title: 'Nare infill drilling screening: well spacing study', project: 'middle-magdalena', date: '2026-08-18', author: 'ben',
    text: 'Reducing well spacing in the Mugrosa sands from 40 to 20 acres adds 34 infill locations. Estimated incremental reserves are 6.4 MMSTB, an average of 190 MSTB per well.' },
  { key: 'm-basis', type: 'note', kind: 'basis', title: 'Basis note: Middle Magdalena infill screening', project: 'middle-magdalena', date: '2026-09-08', author: 'chris',
    text: 'Basis: type curve from 12 offset wells, initial rate 320 bopd, hyperbolic decline with b factor 1.1, drilling and completion cost USD 3.8 MM per well and Brent flat 68 USD/bbl real.' },
  { key: 'm-email-tests', type: 'email', title: 'RE: Nare well test data', project: 'middle-magdalena', date: '2026-09-19', author: 'a.ruiz@ecopetrol.example', direction: 'in', channel: 'email',
    text: 'Ecopetrol sent the second quarter well tests: 22 wells tested, average water cut 78 percent and average oil rate 96 bopd per well.' },
  { key: 'm-letter', type: 'letter', title: 'Letter ATC-2026-0139: infill screening proposal', project: 'middle-magdalena', date: '2026-07-15', author: 'chris', ref_no: 'ATC-2026-0139', direction: 'out', channel: 'post',
    text: 'We propose a two-phase infill screening, locations first and economics second, for a fixed fee of USD 74,000 with delivery in eight weeks from data receipt.' },
  { key: 'm-petro', type: 'report', title: 'Mugrosa petrophysical summary', project: 'middle-magdalena', date: '2026-08-25', author: 'ben',
    text: 'Mugrosa sands net pay averages 42 ft with water saturation 0.38, using a shale volume cutoff of 0.35 and a porosity cutoff of 12 percent.' },
  { key: 'm-kickoff', type: 'note', title: 'Kickoff meeting notes 2026-07-22', project: 'middle-magdalena', date: '2026-07-22', author: 'chris',
    text: 'Infill screening kickoff with Ecopetrol: well spacing, type curves, drilling cost, facilities constraints, well tests and schedule discussed. Ecopetrol to share well tests and the drilling cost history.' },
  { key: 'm-decline', type: 'report', title: 'Nare decline curve analysis', project: 'middle-magdalena', date: '2026-09-01', author: 'ben',
    text: 'Wells drilled after 2021 decline exponentially at 11 percent per year. EUR per infill well is 210 MSTB over a 15-year horizon.' },
  { key: 'm-benchmark', type: 'spreadsheet', title: 'Drilling cost benchmark', project: 'middle-magdalena', date: '2026-09-03', author: 'ben',
    text: 'Benchmark drilling cost per well is USD 3.4 to 4.1 MM in the Middle Magdalena for 4,500 ft wells, with completion adding USD 0.6 MM.' },
  { key: 'm-facilities', type: 'report', title: 'Nare surface facilities constraints', project: 'middle-magdalena', date: '2026-09-11', author: 'ben',
    text: 'Gas handling at Nare is limited to 6 MMscfd. The infill programme needs 2 MMscfd of additional compression and a new 3 km flowline.' },
  { key: 'm-questions', type: 'email', title: 'Ecopetrol questions ahead of the review', project: 'middle-magdalena', date: '2026-09-16', author: 'a.ruiz@ecopetrol.example', direction: 'in', channel: 'email',
    text: 'Ecopetrol asks: How many additional wells fit in the Mugrosa at 20-acre spacing? What well cost do you assume for the infill economics? Is there enough compression capacity, and how wet are the Nare wells in the latest tests?' },
  { key: 'm-access', type: 'email', title: 'Ecopetrol site access approvals', project: 'middle-magdalena', date: '2026-09-22', author: 'a.ruiz@ecopetrol.example', direction: 'in', channel: 'email',
    text: 'Ecopetrol approved site access for four rigs from 1 November. Environmental licence amendments for the 34 infill locations remain pending.' },
  { key: 'm-risk', type: 'note', title: 'Middle Magdalena infill risk register', project: 'middle-magdalena', date: '2026-09-12', author: 'chris',
    text: 'Risks: type curve extrapolation to 20-acre spacing, interference between infill wells, gas handling limits, drilling cost escalation and rig availability.' },

  /* ── Costa Norte Petróleos · Talara brownfield redevelopment ── */
  { key: 't-reserves', type: 'report', title: 'Talara brownfield redevelopment: reserves review', project: 'talara-brownfield', date: '2026-06-24', author: 'ana',
    text: 'After the 2026 revision 2P reserves are 38.5 MMboe and 1P reserves are 22.1 MMboe. The increase reflects production histories to May 2026 and a revised decline analysis.' },
  { key: 't-basis', type: 'note', kind: 'basis', title: 'Basis note: Talara brownfield redevelopment', project: 'talara-brownfield', date: '2026-06-26', author: 'chris',
    text: 'Basis: decline analysis plus material balance, Brent deck of June 2026, lifting cost dependent on water cut, Opportunity Register tool version 2.0.0.' },
  { key: 't-tests', type: 'email', title: 'Fwd: Talara well tests, Q3 summary', project: 'talara-brownfield', date: '2026-09-26', author: 'r.quispe@costanorte.example', direction: 'in', channel: 'email',
    text: 'Costa Norte forwards the third quarter well tests for Talara: 31 wells tested, average water cut 64 percent, and three wells shut in for casing repairs.' },
  { key: 't-letter', type: 'letter', title: 'Letter ATC-2026-0136: clarification of redevelopment scope', project: 'talara-brownfield', date: '2026-06-10', author: 'chris', ref_no: 'ATC-2026-0136', direction: 'out', channel: 'post',
    text: 'Further to the kickoff we confirm that the redevelopment evaluation covers reserves, facilities integrity and secondary recovery, for a fixed fee of USD 118,000.' },
  { key: 't-parinas', type: 'report', title: 'Parinas formation reservoir description', project: 'talara-brownfield', date: '2026-07-05', author: 'ana',
    text: 'The Parinas formation is a stacked fluvial-deltaic sequence with net pay of 60 ft, average porosity 14 percent and permeability 35 mD.' },
  { key: 't-kickoff', type: 'note', title: 'Kickoff meeting notes 2026-05-20', project: 'talara-brownfield', date: '2026-05-20', author: 'chris',
    text: 'Redevelopment kickoff with Costa Norte: reserves, facilities integrity, secondary recovery pilot, well tests and schedule discussed. Costa Norte to open the data room and share production history.' },
  { key: 't-integrity', type: 'report', title: 'Talara facilities integrity assessment', project: 'talara-brownfield', date: '2026-08-14', author: 'ben',
    text: 'Pipeline inspection found wall loss of up to 27 percent at km 4.2. Remaining life is six years at the current corrosion rate and 11 tanks need recoating.' },
  { key: 't-history', type: 'spreadsheet', title: 'Talara production history 1990-2026', project: 'talara-brownfield', date: '2026-08-01', author: 'ana',
    text: 'Cumulative production is 396 MMbbl since 1990. The current rate is 5,200 bopd from 640 active wells at 89 percent water cut.' },
  { key: 't-pilot', type: 'report', title: 'Talara secondary recovery pilot', project: 'talara-brownfield', date: '2026-09-09', author: 'ben',
    text: 'Pilot water injection of 1,500 bwpd in four patterns produced an oil response of 120 bopd after nine months, with breakthrough in one pattern only.' },
  { key: 't-questions', type: 'email', title: 'Costa Norte questions ahead of the review', project: 'talara-brownfield', date: '2026-09-17', author: 'r.quispe@costanorte.example', direction: 'in', channel: 'email',
    text: 'Costa Norte asks: How large are the proven and probable reserves after the latest revision? How badly is the Talara pipeline corroded? What is the redevelopment worth, and did the water injection pilot raise oil production?' },
  { key: 't-dataroom', type: 'email', title: 'Costa Norte data room access', project: 'talara-brownfield', date: '2026-08-05', author: 'r.quispe@costanorte.example', direction: 'in', channel: 'email',
    text: 'Costa Norte opened the data room with 1,140 documents. Well files for the Lobitos block are still being scanned and will follow.' },
  { key: 't-risk', type: 'note', title: 'Talara redevelopment risk register', project: 'talara-brownfield', date: '2026-09-15', author: 'chris',
    text: 'Risks: pipeline corrosion, water handling capacity, pilot representativeness, well casing integrity and fiscal terms after the 2027 contract review.' },

  /* ── firm and public ── */
  { key: 'f-paper-wf', type: 'paper', title: 'Waterflood performance in mature clastic basins: a review', project: 'firm', date: '2026-03-10', author: 'chris', tag: 'lt-public',
    text: 'A review of 62 waterfloods found a median recovery factor uplift of 8 percent of OOIP. Voidage replacement between 0.9 and 1.2 gave the best results, and early breakthrough was the main cause of underperformance.' },
  { key: 'f-paper-infill', type: 'paper', title: 'Infill drilling response in Andean foreland reservoirs', project: 'firm', date: '2026-02-18', author: 'chris', tag: 'lt-public',
    text: 'Infill wells at 20-acre spacing recovered 65 percent of the reserves of their parent wells in eleven Andean foreland fields, with interference visible within eight months.' },
  { key: 'f-method-vrr', type: 'note', title: 'ATC method: voidage replacement screening', project: 'firm', date: '2026-05-04', author: 'chris', tag: 'lt-firm',
    text: 'Screening method: compute the monthly voidage replacement ratio from injection and production, flag ratios below 0.9 for six months, and test aquifer strength before assuming a ratio of 1.0.' },
  { key: 'f-method-decline', type: 'note', title: 'ATC method: type curve decline analysis', project: 'firm', date: '2026-05-06', author: 'chris', tag: 'lt-firm',
    text: 'Type curves are built from at least ten offset wells with a hyperbolic b factor between 0.5 and 1.5. Wells with under 12 months of history are excluded.' },
  { key: 'f-anh', type: 'report', title: 'ANH production statistics 2025', project: 'firm', date: '2026-01-31', author: 'ana', tag: 'lt-public',
    text: 'Colombia crude production averaged 771 kbopd in 2025, with the Llanos basin contributing 71 percent of the national total.' },
  { key: 'f-price', type: 'note', title: 'Firm price deck 2026-09', project: 'firm', date: '2026-09-01', author: 'chris', tag: 'lt-firm',
    text: 'Screening price deck: Brent flat real 68 USD/bbl, with sensitivities at 55 and 80 USD/bbl. Henry Hub 3.10 USD/MMBtu for gas-linked cases.' },
];

interface RunSeed { key: string; job: string; version: string; title: string; project: ProjectId; date: string; author: string; status: 'final' | 'reviewed' | 'superseded'; outputs: Record<string, { value: number; unit: string }>; text: string }
const RUNS: RunSeed[] = [
  { key: 'r-l-base', job: 'opportunity-register', version: '2.0.0', title: 'Llanos waterflood screening: base case', project: 'llanos-waterflood', date: '2026-09-03', author: 'ana', status: 'final',
    outputs: { incremental_recovery_factor: { value: 0.062, unit: 'fraction' }, npv10_usd_mm: { value: 84.6, unit: 'USD MM' }, breakeven_usd_bbl: { value: 41, unit: 'USD/bbl' } },
    text: 'Opportunity Register base case for the Llanos waterflood screening: incremental recovery factor 0.062, NPV10 USD 84.6 MM and breakeven 41 USD/bbl at Brent 68.' },
  { key: 'r-l-base-v1', job: 'opportunity-register', version: '1.4.0', title: 'Llanos waterflood screening: base case (first pass)', project: 'llanos-waterflood', date: '2026-08-22', author: 'ana', status: 'superseded',
    outputs: { incremental_recovery_factor: { value: 0.048, unit: 'fraction' }, npv10_usd_mm: { value: 71.2, unit: 'USD MM' } },
    text: 'Opportunity Register first pass for the Llanos waterflood screening: incremental recovery factor 0.048 and NPV10 USD 71.2 MM, before the volumetrics were revised.' },
  { key: 'r-l-sim', job: 'reservoir-simulator', version: '1.2.0', title: 'Llanos five-spot pattern simulation', project: 'llanos-waterflood', date: '2026-09-06', author: 'ben', status: 'reviewed',
    outputs: { water_breakthrough_months: { value: 14, unit: 'months' }, incremental_oil_mmstb: { value: 9.8, unit: 'MMSTB' } },
    text: 'Five-spot pattern simulation for Llanos: water breakthrough at 14 months and incremental oil of 9.8 MMSTB over 15 years at a voidage replacement ratio of 1.1.' },
  { key: 'r-l-nodal', job: 'nodal-analysis', version: '1.1.0', title: 'Cubiro-14 nodal analysis', project: 'llanos-waterflood', date: '2026-09-07', author: 'ana', status: 'final',
    outputs: { operating_rate_bopd: { value: 1240, unit: 'bopd' }, flowing_bhp_psia: { value: 980, unit: 'psia' }, skin: { value: 4.5, unit: '' } },
    text: 'Nodal analysis of Cubiro-14: operating point 1,240 bopd at a flowing bottomhole pressure of 980 psia with a skin factor of 4.5.' },
  { key: 'r-m-base', job: 'opportunity-register', version: '2.0.0', title: 'Middle Magdalena infill base case', project: 'middle-magdalena', date: '2026-09-09', author: 'ben', status: 'final',
    outputs: { npv10_usd_mm: { value: 41.2, unit: 'USD MM' }, irr: { value: 0.27, unit: 'fraction' }, payback_years: { value: 2.6, unit: 'years' } },
    text: 'Opportunity Register base case for the Middle Magdalena infill screening: NPV10 USD 41.2 MM, IRR 27 percent and payback of 2.6 years at Brent 68.' },
  { key: 'r-m-nodal', job: 'nodal-analysis', version: '1.1.0', title: 'Nare-31 nodal analysis', project: 'middle-magdalena', date: '2026-09-04', author: 'ben', status: 'final',
    outputs: { operating_rate_bopd: { value: 310, unit: 'bopd' }, flowing_bhp_psia: { value: 720, unit: 'psia' } },
    text: 'Nodal analysis of Nare-31: operating point 310 bopd at a flowing bottomhole pressure of 720 psia.' },
  { key: 'r-m-plan', job: 'plan-your-job', version: '1.0.0', title: 'Infill campaign plan', project: 'middle-magdalena', date: '2026-09-10', author: 'ben', status: 'reviewed',
    outputs: { wells: { value: 34, unit: 'wells' }, rig_days_per_well: { value: 18, unit: 'days' }, duration_months: { value: 26, unit: 'months' } },
    text: 'Job plan for the 34-well infill campaign: 18 rig days per well and a total duration of 26 months with two rigs.' },
  { key: 'r-t-econ', job: 'opportunity-register', version: '2.0.0', title: 'Talara redevelopment economics v2', project: 'talara-brownfield', date: '2026-06-24', author: 'ana', status: 'final',
    outputs: { npv10_usd_mm: { value: 186.4, unit: 'USD MM' }, recovery_factor_frac: { value: 0.21, unit: 'fraction' }, breakeven_usd_bbl: { value: 38, unit: 'USD/bbl' } },
    text: 'Opportunity Register economics for the Talara brownfield redevelopment version 2: NPV10 USD 186.4 MM, recovery factor 0.21 and breakeven 38 USD/bbl.' },
  { key: 'r-t-sim', job: 'reservoir-simulator', version: '1.2.0', title: 'Talara pilot history match', project: 'talara-brownfield', date: '2026-09-12', author: 'ben', status: 'reviewed',
    outputs: { simulated_oil_response_bopd: { value: 118, unit: 'bopd' }, match_error_pct: { value: 6.5, unit: 'percent' } },
    text: 'History match of the Talara secondary recovery pilot: simulated oil response of 118 bopd against 120 observed, with a water cut error of 6.5 percent.' },
  { key: 'r-t-nodal', job: 'nodal-analysis', version: '1.1.0', title: 'Talara-212 nodal analysis', project: 'talara-brownfield', date: '2026-08-18', author: 'ana', status: 'final',
    outputs: { operating_rate_bopd: { value: 85, unit: 'bopd' }, flowing_bhp_psia: { value: 410, unit: 'psia' } },
    text: 'Nodal analysis of Talara-212: operating point 85 bopd at a flowing bottomhole pressure of 410 psia.' },
];

const LESSONS = [
  { key: 'lesson-aquifer', scope: 'firm', scope_id: null, claim: 'Test aquifer strength before assuming a voidage replacement ratio of 1.0 in a waterflood screening.', disciplines: ['reservoir-engineering'], evidence: ['l-inj-history'] },
  { key: 'lesson-royalty', scope: 'firm', scope_id: null, claim: 'Ask for the royalty sliding-scale table before modelling fiscal terms for a Colombian contract.', disciplines: ['commercial'], evidence: ['f-price'] },
  { key: 'lesson-meters', scope: 'project', scope_id: 'llanos-waterflood', claim: 'Reconcile injection allocation files against the Station 2 meters before history matching Cubiro.', disciplines: ['reservoir-engineering'], evidence: ['l-email-inj'] },
] as const;

const hex = (s: string) => createHash('sha256').update(s).digest('hex');
const at = (d: string) => `${d}T09:00:00Z`;

/** key → ref for every seeded record (docs, runs, lessons): what gold questions cite. */
export function refTable(): Record<string, string> {
  return Object.fromEntries([...DOCS.map(d => [d.key, docRef(d.key)]), ...RUNS.map(r => [r.key, runRef(r.key)]), ...LESSONS.map(l => [l.key, lessonRef(l.key)])]);
}

/** Load the corpus into an empty, migrated database. Nothing here needs a network or a model. */
export async function seedEval(db: Db, embedder: Embedder = new FakeEmbedder()): Promise<{ items: number; runs: number; chunks: number; lessons: number; dispatches: number }> {
  for (const [pid, email, name, role] of [['chris', EVAL_PERSON.email, EVAL_PERSON.name, 'partner'], ['ana', 'ana@alpha-technical-centre.com', 'Ana Restrepo', 'associate'], ['ben', 'ben@alpha-technical-centre.com', 'Ben Hughes', 'associate']] as const)
    await db.query('INSERT INTO people (id, email, name, role) VALUES ($1,$2,$3,$4)', [pid, email, name, role]);
  await db.query("INSERT INTO legal_tags (id, classification, data_type, originator) VALUES ('lt-public','public','public','public sources'),('lt-firm','firm','first-party','ATC')");
  await db.query("INSERT INTO projects (id, client_id, name, status, default_legal_tag) VALUES ('firm', NULL, 'ATC internal', 'active', 'lt-firm')");
  for (const c of CLIENTS) {
    await db.query("INSERT INTO organisations (id, name, kind) VALUES ($1,$2,'client')", [c.id, c.name]);
    await db.query("INSERT INTO legal_tags (id, classification, data_type, client_id, originator) VALUES ($1,'client-nda','second-party',$2,$3)", [c.tag, c.id, c.name]);
    await db.query('INSERT INTO projects (id, client_id, name, status, default_legal_tag, members) VALUES ($1,$2,$3,$4,$5,$6::text[])', [c.project, c.id, c.title, 'active', c.tag, c.members]);
  }
  const proj = (p: ProjectId) => CLIENTS.find(c => c.project === p);

  let chunks = 0;
  const addChunk = async (o: { item?: string; run?: string; title: string; type: string; text: string; tag: string; client: string | null; project: string; current?: boolean }) => {
    const context = templateContext({ title: o.title, type: o.type }, { anchor: null, text: o.text });
    const [vec] = await embedder.embed([`${context}\n\n${o.text}`], 'document');
    await db.query('INSERT INTO chunks (item_id, run_id, item_version, ordinal, context, text, legal_tag, client_id, project_id, current, embedding) VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,$9,$10::vector)',
      [o.item ?? null, o.run ?? null, o.item ? 1 : null, context, o.text, o.tag, o.client, o.project, o.current ?? true, vectorLiteral(vec)]);
    chunks++;
  };

  for (const d of DOCS) {
    const c = proj(d.project);
    const tag = d.tag ?? c?.tag ?? 'lt-firm';
    await db.query(`INSERT INTO items (id, type, title, created_at, authored_at, authors, client_id, project_id, organisation_ids, legal_tag, origin, content_hash, version, reference_no, extracted)
                    VALUES ($1,$2,$3,$4,$4,$5::text[],$6,$7,$8::text[],$9,$10::jsonb,$11,1,$12,$13::jsonb)`,
      [id(d.key), d.type, d.title, at(d.date), [d.author], c?.id ?? null, d.project, c && (d.direction || d.type === 'letter') ? [c.id] : [], tag, JSON.stringify({ source: 'eval-seed', external_id: `eval:${d.key}` }),
       `sha256:${hex(d.key)}`, d.ref_no ?? null, JSON.stringify(d.kind ? { kind: d.kind } : {})]);
    await db.query('INSERT INTO item_versions (item_id, version, content_hash, created_at) VALUES ($1,1,$2,$3)', [id(d.key), `sha256:${hex(d.key)}`, at(d.date)]);
    await addChunk({ item: id(d.key), title: d.title, type: d.type, text: d.text, tag, client: c?.id ?? null, project: d.project });
  }

  for (const r of RUNS) {
    const c = proj(r.project)!;
    await db.query(`INSERT INTO runs (id, job, tool_version, tool_commit, author, created_at, client_id, project_id, legal_tag, title, record, input_hash, status)
                    VALUES ($1,$2,$3,'abc1234',$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
      [id(r.key), r.job, r.version, r.author, at(r.date), c.id, r.project, c.tag, r.title, JSON.stringify({ outputs: r.outputs, assumptions: {} }), `sha256:${hex('input:' + r.key)}`, r.status]);
    await addChunk({ run: id(r.key), title: r.title, type: 'run', text: r.text, tag: c.tag, client: c.id, project: r.project, current: r.status !== 'superseded' });
  }

  for (const l of LESSONS) {
    const record = { id: id(l.key), claim: l.claim, scope: l.scope, scope_id: l.scope_id, disciplines: l.disciplines, legal_tag: 'lt-firm', sanitised: true, evidence: l.evidence.map(docRef), author: 'chris',
      created_at: at('2026-09-20'), valid_to: null, superseded_by: null, status: 'confirmed', confirmed_by: 'chris', last_confirmed: at('2026-09-21'), confidence: 0.8, recurrence: 1 };
    await db.query("INSERT INTO lessons (id, record, scope, scope_id, legal_tag, status, created_at, last_confirmed) VALUES ($1,$2::jsonb,$3,$4,'lt-firm','confirmed',$5,$6)",
      [id(l.key), JSON.stringify(record), l.scope, l.scope_id, at('2026-09-20'), at('2026-09-21')]);
  }

  // Dispatches: every letter and email that crossed the client boundary.
  let dispatches = 0;
  for (const d of DOCS.filter(x => x.direction)) {
    const c = proj(d.project)!;
    await db.query(`INSERT INTO dispatches (id, item_id, direction, organisation_id, channel, occurred_at, reference_no, signed_by, recorded_by)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'eval-seed')`,
      [id(`dispatch:${d.key}`), id(d.key), d.direction, c.id, d.channel ?? 'email', at(d.date), d.ref_no ?? null, d.direction === 'out' ? d.author : null]);
    dispatches++;
  }
  return { items: DOCS.length, runs: RUNS.length, chunks, lessons: LESSONS.length, dispatches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [k, v] of Object.entries(refTable())) console.log(k.padEnd(20), v);
}
