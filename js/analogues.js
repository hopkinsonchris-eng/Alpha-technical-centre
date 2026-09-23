/* Analogue input sets, by play type.
 *
 * Screening assets almost never arrive with permeability, net pay, relative
 * permeability endpoints or fluid viscosities attached. Rather than refuse to
 * compute anything - which would leave the register blank for most of what it
 * holds - each play type carries a low / mid / high default for every input the
 * calculator needs, and every value the asset does not supply itself is stamped
 * "analogue" so the reader can see exactly how much of the answer is borrowed.
 *
 * These are screening defaults. They are the starting point for a conversation
 * with a data room, not a substitute for one. Replace them field by field as
 * real measurements arrive; the provenance badge will improve as you do.
 */

import { PROVENANCE, mobilityRatio } from './potential.js';

export const PLAYS = {
  'onshore-clastic-waterflood': {
    label: 'Onshore clastic, waterflood',
    drive: 'waterflood',
    rock: { k: [60, 150, 320], hFt: [25, 45, 80], phi: [0.16, 0.21, 0.26] },
    relperm: { swc: 0.22, sor: 0.25, krwMax: 0.30, kroMax: 0.90, nw: 2.5, no: 2.0 },
    fluids: { muo: 3.0, muw: 0.45, bo: 1.20, boi: 1.24 },
    wells: { spacingAcres: 40, rwFt: 0.354 },
    pressure: { pres: 2800, pwfFrac: 0.35, skin: 6 },
  },
  'shallow-marine-clastic-waterflood': {
    label: 'Shallow marine / lacustrine clastic, waterflood',
    drive: 'waterflood',
    rock: { k: [120, 350, 800], hFt: [30, 60, 110], phi: [0.18, 0.24, 0.30] },
    relperm: { swc: 0.20, sor: 0.24, krwMax: 0.35, kroMax: 0.88, nw: 2.2, no: 2.0 },
    fluids: { muo: 6.0, muw: 0.50, bo: 1.15, boi: 1.18 },
    wells: { spacingAcres: 60, rwFt: 0.354 },
    pressure: { pres: 2400, pwfFrac: 0.40, skin: 9 },
  },
  'carbonate-waterflood': {
    label: 'Carbonate, waterflood',
    drive: 'waterflood',
    rock: { k: [10, 40, 150], hFt: [50, 110, 200], phi: [0.10, 0.15, 0.22] },
    relperm: { swc: 0.18, sor: 0.30, krwMax: 0.25, kroMax: 0.85, nw: 3.0, no: 2.5 },
    fluids: { muo: 1.5, muw: 0.40, bo: 1.30, boi: 1.35 },
    wells: { spacingAcres: 80, rwFt: 0.354 },
    pressure: { pres: 3400, pwfFrac: 0.35, skin: 4 },
  },
  'offshore-clastic-waterflood': {
    label: 'Offshore clastic, waterflood',
    drive: 'waterflood',
    rock: { k: [100, 250, 600], hFt: [30, 55, 95], phi: [0.18, 0.23, 0.28] },
    relperm: { swc: 0.20, sor: 0.24, krwMax: 0.32, kroMax: 0.90, nw: 2.4, no: 2.0 },
    fluids: { muo: 2.0, muw: 0.45, bo: 1.25, boi: 1.30 },
    wells: { spacingAcres: 120, rwFt: 0.354 },
    pressure: { pres: 3400, pwfFrac: 0.45, skin: 3 },
  },
  'onshore-gas': {
    label: 'Onshore gas',
    drive: 'gas',
    rock: { k: [5, 25, 90], hFt: [40, 90, 160], phi: [0.12, 0.17, 0.22] },
    gas: { mug: 0.022, z: 0.92, tempF: 180, bgiCfPerScf: 0.0050, swc: 0.25,
           pi: 4200, zi: 0.94, pab: 700, zab: 0.98 },
    wells: { spacingAcres: 320, rwFt: 0.354 },
    pressure: { pres: 4000, pwfFrac: 0.40, skin: 5 },
  },
  'offshore-gas': {
    label: 'Offshore gas',
    drive: 'gas',
    rock: { k: [20, 60, 180], hFt: [50, 110, 190], phi: [0.15, 0.20, 0.26] },
    gas: { mug: 0.024, z: 0.90, tempF: 210, bgiCfPerScf: 0.0045, swc: 0.22,
           pi: 5000, zi: 0.95, pab: 900, zab: 0.97 },
    wells: { spacingAcres: 640, rwFt: 0.354 },
    pressure: { pres: 4600, pwfFrac: 0.45, skin: 2 },
  },
};

export const PLAY_KEYS = Object.keys(PLAYS);

/** Areal sweep a real pattern reaches, as a screening default read off the
 *  end-point mobility ratio. Unfavourable mobility fingers the front and
 *  strands oil the ideal case counts as recovered, which is why this is the
 *  first and usually the largest deduction on the ledger. Replace it with a
 *  pattern-specific number as soon as one exists. */
export function arealSweepDefault(M) {
  const pts = [[0.2, 0.95], [0.5, 0.90], [1, 0.80], [2, 0.68], [5, 0.55], [10, 0.46], [20, 0.40]];
  const m = Math.min(20, Math.max(0.2, M));
  for (let i = 1; i < pts.length; i++) {
    if (m <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const t = (Math.log(m) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
      return y0 + (y1 - y0) * t;
    }
  }
  return 0.40;
}

/** The standing deduction list. Every opportunity starts from the same nine
 *  lines so two assets can be compared line for line, and so a missing
 *  deduction is visible as a factor left at 1.00 rather than as an omission. */
export function defaultFactors(mobility) {
  const areal = mobility == null ? 0.80 : arealSweepDefault(mobility);
  return [
    { id: 'areal', label: 'Areal sweep efficiency', kind: 'multiplier', value: round2(areal),
      note: mobility == null ? 'Screening default.'
        : `Screening default read off a mobility ratio of ${mobility.toFixed(2)}.`,
      provenance: PROVENANCE.ANALOGUE },
    { id: 'vertical', label: 'Vertical sweep and layering', kind: 'multiplier', value: 0.75,
      note: 'Screening default. Replace with a Dykstra-Parsons value once layer permeabilities exist.',
      provenance: PROVENANCE.ANALOGUE },
    { id: 'access', label: 'Well access and integrity', kind: 'multiplier', value: 0.85,
      note: 'Share of the well stock that can actually be worked.', provenance: PROVENANCE.ASSUMED },
    { id: 'facility', label: 'Facility and processing limit', kind: 'volume', value: 0,
      note: 'Hard ceiling in kboe/d imposed by the plant. Zero means no limit recorded.',
      provenance: PROVENANCE.ASSUMED },
    { id: 'water', label: 'Water handling and injection capacity', kind: 'multiplier', value: 0.90,
      note: 'Voidage replacement the surface plant can actually support.', provenance: PROVENANCE.ASSUMED },
    { id: 'power', label: 'Power and utilities', kind: 'multiplier', value: 0.95,
      note: 'Availability of electrical supply and utilities.', provenance: PROVENANCE.ASSUMED },
    { id: 'capex', label: 'Capex and schedule', kind: 'multiplier', value: 0.85,
      note: 'What can be funded and executed inside the plan window.', provenance: PROVENANCE.ASSUMED },
    { id: 'legal', label: 'Legal, sanctions and contracting', kind: 'multiplier', value: 1.00,
      note: 'Access to services, equipment and markets. Set below 1 where screening says so.',
      provenance: PROVENANCE.ASSUMED },
    { id: 'contingency', label: 'Subsurface uncertainty contingency', kind: 'multiplier', value: 0.90,
      note: 'Explicit reserve against the analogue inputs being wrong.', provenance: PROVENANCE.ASSUMED },
  ];
}

const round2 = (v) => Math.round(v * 100) / 100;
const CASES = ['low', 'mid', 'high'];

/**
 * Builds the three input cases for one opportunity and the provenance map that
 * goes with them.
 *
 * @param {string} playKey  a key of PLAYS
 * @param {object} asset    { areaAcres, producers, pres, spacingAcres, skin,
 *                            plateauYears, mscfPerBoe, measured: {path: value},
 *                            assumed: {path: value} }
 */
export function buildInputs(playKey, asset) {
  const play = PLAYS[playKey] || PLAYS['onshore-clastic-waterflood'];
  const a = asset || {};
  const given = { ...(a.measured || {}) };
  const assumed = { ...(a.assumed || {}) };
  const provenance = {};

  // A value the asset supplies is measured; one it merely asserts is assumed;
  // everything else is borrowed from the play and marked analogue.
  const pick = (path, analogueValue) => {
    if (Object.prototype.hasOwnProperty.call(given, path)) {
      provenance[path] = PROVENANCE.MEASURED; return given[path];
    }
    if (Object.prototype.hasOwnProperty.call(assumed, path)) {
      provenance[path] = PROVENANCE.ASSUMED; return assumed[path];
    }
    provenance[path] = PROVENANCE.ANALOGUE; return analogueValue;
  };

  const areaAcres = pick('rock.areaAcres', 2000);
  const producers = pick('wells.producers', 20);
  const activeProducers = pick('wells.activeProducers', producers);
  const spacingAcres = pick('wells.spacingAcres', play.wells.spacingAcres);
  const rwFt = pick('wells.rwFt', play.wells.rwFt);
  const pres = pick('pressure.pres', play.pressure.pres);
  const skin = pick('pressure.skin', play.pressure.skin);
  const pwfFrac = pick('pressure.pwfFrac', play.pressure.pwfFrac);
  // Today's backpressure. A neglected field flows against far more of it than
  // one on artificial lift, which is most of why today sits below the ceiling.
  const pwfNowFrac = pick('pressure.pwfNowFrac', 0.75);
  const plateauYears = pick('plateauYears', a.plateauYears != null ? a.plateauYears : 5);
  const mscfPerBoe = pick('mscfPerBoe', a.mscfPerBoe != null ? a.mscfPerBoe : 6);

  const out = {};
  CASES.forEach((c, i) => {
    const rock = {
      k: pick('rock.k', play.rock.k[i]),
      hFt: pick('rock.hFt', play.rock.hFt[i]),
      phi: pick('rock.phi', play.rock.phi[i]),
      areaAcres,
    };
    const base = {
      drive: play.drive,
      rock,
      wells: { producers, activeProducers, spacingAcres, rwFt },
      pressure: { pres, pwf: pres * pwfFrac, pwfNow: pres * pwfNowFrac, skin },
      plateauYears,
      mscfPerBoe,
    };
    if (play.drive === 'gas') {
      base.gas = { ...play.gas, pi: Math.max(play.gas.pi, pres), };
      Object.keys(play.gas).forEach((k) => { provenance['gas.' + k] = PROVENANCE.ANALOGUE; });
    } else {
      base.relperm = { ...play.relperm };
      base.fluids = { ...play.fluids };
      Object.keys(play.relperm).forEach((k) => {
        if (!(('relperm.' + k) in provenance)) provenance['relperm.' + k] = PROVENANCE.ANALOGUE; });
      Object.keys(play.fluids).forEach((k) => {
        if (!(('fluids.' + k) in provenance)) provenance['fluids.' + k] = PROVENANCE.ANALOGUE; });
    }
    out[c] = base;
  });

  // Low/mid/high vary the rock only; the same well count and pressure apply to
  // all three, so the band reflects what the rock might be rather than a
  // different development.
  out.provenance = provenance;
  out.play = playKey;
  out.drive = play.drive;
  return out;
}

/** Mobility ratio for a play's default fluids, used to seed the sweep factor. */
export function playMobility(playKey) {
  const play = PLAYS[playKey];
  if (!play || play.drive !== 'waterflood') return null;
  return mobilityRatio(play.relperm, play.fluids);
}
