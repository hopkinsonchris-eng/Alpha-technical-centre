/* Technical potential for a producing asset.
 *
 * Two routes, chosen per opportunity by drive mechanism:
 *
 *   waterflood  Darcy radial deliverability with the damage removed, capped by
 *               the movable oil that Buckley-Leverett says an ideal sweep can
 *               recover. Corey relative permeability, fractional flow, Welge
 *               tangent for the front and the average saturation behind it.
 *   gas         Pressure-squared deliverability, capped by what p/Z material
 *               balance recovers down to abandonment pressure.
 *
 * The number this produces is a ceiling and nothing else. Areal and vertical
 * sweep are held at unity, skin is zero and the flowing pressure sits at the
 * lift limit, so no real field reaches it. The distance between this and what
 * Alpha will commit to belongs in the modifying-factor ledger below, where each
 * deduction is named, sized and attributable. Mobility ratio is computed and
 * reported here precisely because it predicts how far the ideal case will be
 * missed - but it does not reduce the ceiling, or the reduction would be
 * invisible.
 *
 * Field units throughout: md, ft, acres, psi, cp, rb/stb, degrees Rankine.
 * Rates leave as kboe/d.
 */

export const DRIVE = { WATERFLOOD: 'waterflood', GAS: 'gas' };
export const PROVENANCE = { MEASURED: 'measured', ANALOGUE: 'analogue', ASSUMED: 'assumed' };

/** Raised for an input set that has no physical answer, so a caller never has
 *  to tell a NaN apart from a rate. */
export class PotentialError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'PotentialError';
    this.field = field || null;
  }
}

const BBL_PER_ACRE_FT = 7758;
const CF_PER_ACRE_FT = 43560;
const DARCY_OIL = 141.2;     // q [stb/d] = k·kro·h·dp / (141.2·mu·B·(ln(re/rw) - 0.75 + s))
const DARCY_GAS = 1424;      // q [Mscf/d], pressure-squared form
const DAYS = 365;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
function need(v, name, test, message) {
  const x = num(v);
  if (Number.isNaN(x) || !test(x)) throw new PotentialError(message, name);
  return x;
}

/* ── Relative permeability and fractional flow ───────────────────────── */

/** Normalised water saturation, clamped to the movable range. */
function swn(sw, { swc, sor }) {
  const span = 1 - swc - sor;
  if (!(span > 0)) throw new PotentialError(
    'Connate water and residual oil leave no movable oil (Swc + Sor must be below 1).', 'relperm');
  return Math.min(1, Math.max(0, (sw - swc) / span));
}

export function coreyKrw(sw, rp) {
  return rp.krwMax * Math.pow(swn(sw, rp), rp.nw);
}

export function coreyKro(sw, rp) {
  return rp.kroMax * Math.pow(1 - swn(sw, rp), rp.no);
}

/** Fraction of the flowing stream that is water, ignoring gravity and
 *  capillary pressure - the standard Buckley-Leverett simplification. */
export function fractionalFlow(sw, rp, { muo, muw }) {
  const krw = coreyKrw(sw, rp);
  const kro = coreyKro(sw, rp);
  if (krw <= 0) return 0;
  if (kro <= 0) return 1;
  return 1 / (1 + (kro * muw) / (krw * muo));
}

/** End-point mobility ratio. Above 1 the water is more mobile than the oil it
 *  is pushing, so the front fingers and real sweep falls well short of ideal. */
export function mobilityRatio(rp, { muo, muw }) {
  return (rp.krwMax / muw) / (rp.kroMax / muo);
}

/** Welge tangent from (Swc, 0) to the fractional-flow curve.
 *
 *  The tangent point is where the chord from connate water is steepest, so it
 *  is found by maximising fw/(Sw - Swc): a coarse sweep to bracket it, then a
 *  ternary search, which converges on the trailing endpoint when the curve is
 *  convex and displacement is piston-like. */
export function welge(rp, fl) {
  const lo0 = rp.swc + 1e-9;
  const hi0 = 1 - rp.sor;
  if (!(hi0 > lo0)) throw new PotentialError(
    'Connate water and residual oil leave no movable oil (Swc + Sor must be below 1).', 'relperm');

  const chord = (sw) => (sw <= rp.swc ? 0 : fractionalFlow(sw, rp, fl) / (sw - rp.swc));

  const N = 2000;
  let bi = 1, best = -Infinity;
  for (let i = 1; i <= N; i++) {
    const sw = lo0 + (hi0 - lo0) * (i / N);
    const g = chord(sw);
    if (g > best) { best = g; bi = i; }
  }
  let lo = lo0 + (hi0 - lo0) * ((bi - 1) / N);
  let hi = lo0 + (hi0 - lo0) * (Math.min(N, bi + 1) / N);
  for (let i = 0; i < 200 && hi - lo > 1e-12; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (chord(a) < chord(b)) lo = a; else hi = b;
  }
  const swf = Math.min(hi0, (lo + hi) / 2);
  const fwf = fractionalFlow(swf, rp, fl);

  // Extrapolating the tangent to fw = 1 gives the average saturation behind
  // the front, which is what sets recovery at breakthrough.
  const swBar = fwf > 0 ? Math.min(hi0, rp.swc + (swf - rp.swc) / fwf) : rp.swc;
  const edUltimate = (1 - rp.sor - rp.swc) / (1 - rp.swc);
  const edBreakthrough = Math.min(edUltimate, (swBar - rp.swc) / (1 - rp.swc));

  return { swf, fwf, swBar, edBreakthrough, edUltimate };
}

/* ── Volumes ─────────────────────────────────────────────────────────── */

export function ooip({ areaAcres, hFt, phi, swc, boi }) {
  return BBL_PER_ACRE_FT * areaAcres * hFt * phi * (1 - swc) / boi;
}

/** Gas initially in place, Mscf. */
export function giipVolumetric({ areaAcres, hFt, phi, swc, bgiCfPerScf }) {
  return CF_PER_ACRE_FT * areaAcres * hFt * phi * (1 - swc) / bgiCfPerScf / 1000;
}

/** Recovery from blowing a tank down from pi/Zi to the abandonment p/Z. */
export function gasRecoverable({ giipMscf, pi, zi, pab, zab }) {
  return giipMscf * (1 - (pab / zab) / (pi / zi));
}

/** Drainage radius implied by well spacing, ft. */
export function reFromSpacing(acresPerWell) {
  return Math.sqrt(CF_PER_ACRE_FT * acresPerWell / Math.PI);
}

/* ── Deliverability ──────────────────────────────────────────────────── */

export function darcyOilRate({ k, kro, hFt, pres, pwf, bo, muo, re, rw, skin }) {
  const denom = DARCY_OIL * muo * bo * (Math.log(re / rw) - 0.75 + skin);
  return k * kro * hFt * (pres - pwf) / denom;
}

export function darcyGasRate({ k, hFt, pres, pwf, mug, z, tempR, re, rw, skin }) {
  const denom = DARCY_GAS * mug * z * tempR * (Math.log(re / rw) - 0.75 + skin);
  return k * hFt * (pres * pres - pwf * pwf) / denom;
}

/* ── Technical potential ─────────────────────────────────────────────── */

function validate(inp) {
  const { rock = {}, wells = {}, pressure = {} } = inp;
  need(rock.k, 'rock.k', (v) => v > 0, 'Permeability must be greater than zero.');
  need(rock.hFt, 'rock.hFt', (v) => v > 0, 'Net pay must be greater than zero.');
  need(rock.phi, 'rock.phi', (v) => v > 0 && v < 1, 'Porosity must be between 0 and 1.');
  need(rock.areaAcres, 'rock.areaAcres', (v) => v > 0, 'Area must be greater than zero.');
  need(wells.producers, 'wells.producers', (v) => v >= 1,
    'At least one producer is needed for a deliverability ceiling.');
  need(wells.spacingAcres, 'wells.spacingAcres', (v) => v > 0, 'Well spacing must be greater than zero.');
  const rw = need(wells.rwFt, 'wells.rwFt', (v) => v > 0, 'Wellbore radius must be greater than zero.');
  const re = reFromSpacing(wells.spacingAcres);
  if (!(re > rw)) throw new PotentialError(
    'Well spacing gives a drainage radius inside the wellbore; check the spacing.', 'wells.spacingAcres');
  const pres = need(pressure.pres, 'pressure.pres', (v) => v > 0, 'Reservoir pressure must be greater than zero.');
  need(pressure.pwf, 'pressure.pwf', (v) => v >= 0 && v < pres,
    'Flowing bottomhole pressure must be below reservoir pressure, or there is no drawdown.');
  if (pressure.pwfNow != null) {
    need(pressure.pwfNow, 'pressure.pwfNow', (v) => v >= 0 && v < pres,
      "Today's flowing pressure must be below reservoir pressure.");
  }
  if (wells.activeProducers != null) {
    need(wells.activeProducers, 'wells.activeProducers', (v) => v >= 0 && v <= wells.producers,
      'Active producers cannot exceed the well stock.');
  }
  need(inp.plateauYears, 'plateauYears', (v) => v > 0, 'Plateau length must be greater than zero years.');
  return { re, rw };
}

/**
 * @returns {{
 *   drive: string, rateCeilingKboed: number, currentSkinRateKboed: number,
 *   plateauSustainableKboed: number, potentialKboed: number,
 *   bound: 'rate'|'volume', plateauYearsAtCeiling: number,
 *   mobilityRatio: number|null, welge: object|null, warnings: string[] }}
 */
export function technicalPotential(inp) {
  const { re, rw } = validate(inp);
  const { rock, wells, pressure } = inp;
  const skinNow = num(pressure.skin) || 0;
  // The ceiling is the whole well stock, cleaned up, drawn down to the lift
  // limit. Today is whatever subset is actually open, as damaged as it is, at
  // whatever backpressure it flows against. On a neglected brownfield those
  // are very different numbers, and the difference is the case for the deal.
  const activeProducers = wells.activeProducers != null ? wells.activeProducers : wells.producers;
  const pwfNow = pressure.pwfNow != null ? pressure.pwfNow : pressure.pwf;
  const warnings = [];
  const drive = inp.drive === DRIVE.GAS ? DRIVE.GAS : DRIVE.WATERFLOOD;

  let rateCeilingKboed, currentSkinRateKboed, recoverablePlateau, recoverableUltimate;
  let mr = null, w = null, recoverableStb = null, recoverableMscf = null;
  const mscfPerBoe = num(inp.mscfPerBoe) > 0 ? inp.mscfPerBoe : 6;

  if (drive === DRIVE.GAS) {
    const g = inp.gas || {};
    need(g.mug, 'gas.mug', (v) => v > 0, 'Gas viscosity must be greater than zero.');
    need(g.z, 'gas.z', (v) => v > 0, 'Gas compressibility factor must be greater than zero.');
    need(g.bgiCfPerScf, 'gas.bgiCfPerScf', (v) => v > 0, 'Gas formation volume factor must be greater than zero.');
    const tempR = need(g.tempF, 'gas.tempF', (v) => v > -459.67, 'Reservoir temperature is below absolute zero.') + 459.67;

    const per = (skin, pwf) => darcyGasRate({
      k: rock.k, hFt: rock.hFt, pres: pressure.pres, pwf,
      mug: g.mug, z: g.z, tempR, re, rw, skin });
    rateCeilingKboed = wells.producers * per(0, pressure.pwf) / mscfPerBoe / 1000;
    currentSkinRateKboed = activeProducers * per(skinNow, pwfNow) / mscfPerBoe / 1000;

    const giip = giipVolumetric({ areaAcres: rock.areaAcres, hFt: rock.hFt, phi: rock.phi,
      swc: g.swc != null ? g.swc : (inp.relperm ? inp.relperm.swc : 0.2), bgiCfPerScf: g.bgiCfPerScf });
    recoverableMscf = gasRecoverable({ giipMscf: giip, pi: g.pi, zi: g.zi, pab: g.pab, zab: g.zab });
    if (!(recoverableMscf > 0)) throw new PotentialError(
      'Abandonment pressure is at or above initial pressure, so nothing is recoverable.', 'gas.pab');
    recoverablePlateau = recoverableMscf / mscfPerBoe;
    recoverableUltimate = recoverablePlateau;
  } else {
    const rp = inp.relperm || {};
    const fl = inp.fluids || {};
    need(rp.swc, 'relperm.swc', (v) => v >= 0 && v < 1, 'Connate water saturation must be between 0 and 1.');
    need(rp.sor, 'relperm.sor', (v) => v >= 0 && v < 1, 'Residual oil saturation must be between 0 and 1.');
    if (!(1 - rp.swc - rp.sor > 0)) throw new PotentialError(
      'Connate water and residual oil leave no movable oil (Swc + Sor must be below 1).', 'relperm');
    need(fl.muo, 'fluids.muo', (v) => v > 0, 'Oil viscosity must be greater than zero.');
    need(fl.muw, 'fluids.muw', (v) => v > 0, 'Water viscosity must be greater than zero.');
    need(fl.bo, 'fluids.bo', (v) => v > 0, 'Oil formation volume factor must be greater than zero.');
    need(fl.boi, 'fluids.boi', (v) => v > 0, 'Initial oil formation volume factor must be greater than zero.');

    mr = mobilityRatio(rp, fl);
    w = welge(rp, fl);
    if (mr > 1) warnings.push(
      'Mobility ratio is above 1, so the real sweep will fall well short of the ideal case. '
      + 'Size that shortfall in the areal and vertical sweep factors.');

    // The ceiling reads oil permeability at connate water - the best the rock
    // ever flows oil - with the damage removed.
    const per = (skin, pwf) => darcyOilRate({
      k: rock.k, kro: rp.kroMax, hFt: rock.hFt, pres: pressure.pres, pwf,
      bo: fl.bo, muo: fl.muo, re, rw, skin });
    rateCeilingKboed = wells.producers * per(0, pressure.pwf) / 1000;
    currentSkinRateKboed = activeProducers * per(skinNow, pwfNow) / 1000;

    const N = ooip({ areaAcres: rock.areaAcres, hFt: rock.hFt, phi: rock.phi, swc: rp.swc, boi: fl.boi });
    recoverableStb = N * w.edUltimate;
    // The plateau is bounded by what comes back before water breaks through;
    // the tail beyond breakthrough arrives at a falling rate, not on plateau.
    recoverablePlateau = N * w.edBreakthrough;
    recoverableUltimate = recoverableStb;
  }

  const plateauSustainableKboed = recoverablePlateau / (inp.plateauYears * DAYS) / 1000;
  const bound = rateCeilingKboed <= plateauSustainableKboed ? 'rate' : 'volume';
  const potentialKboed = Math.min(rateCeilingKboed, plateauSustainableKboed);
  const plateauYearsAtCeiling = recoverablePlateau / (rateCeilingKboed * 1000 * DAYS);

  if (plateauYearsAtCeiling < 1) warnings.push(
    'The deliverability ceiling would drain the movable volume in under a year. '
    + 'Treat the rate as a burst, not a plateau.');

  return {
    drive,
    rateCeilingKboed,
    currentSkinRateKboed,
    activeProducers,
    plateauSustainableKboed,
    potentialKboed,
    bound,
    plateauYearsAtCeiling,
    recoverableStb,
    recoverableMscf,
    recoverableUltimate,
    mobilityRatio: mr,
    welge: w,
    warnings,
  };
}

/** Low, mid and high cases. This is an input envelope, not a probability
 *  distribution: low is not P90 and high is not P10, and nothing here should
 *  present them as percentiles. */
export function potentialBand({ low, mid, high }) {
  return {
    low: technicalPotential(low),
    mid: technicalPotential(mid),
    high: technicalPotential(high),
  };
}

/* ── The bridge from ceiling to plan ─────────────────────────────────── */

/**
 * Walks the modifying factors in order, recording what each one costs in
 * kboe/d. The deductions are guaranteed to sum to the difference between the
 * ceiling and the plan, so the bridge can always be read line by line.
 *
 * @param {number} tpMidKboed technical potential, mid case
 * @param {Array<{id:string,label:string,kind:'multiplier'|'volume',value:number,
 *                note?:string,provenance?:string}>} factors
 */
export function applyModifyingFactors(tpMidKboed, factors) {
  const list = Array.isArray(factors) ? factors : [];
  const warnings = [];
  const ledger = [];
  let running = Math.max(0, num(tpMidKboed) || 0);

  for (const f of list) {
    const before = running;
    let after;
    if (f.kind === 'volume') {
      let v = num(f.value);
      if (Number.isNaN(v) || v < 0) {
        warnings.push(`"${f.label}" had a negative or unreadable volume and was treated as zero.`);
        v = 0;
      }
      after = before - v;
    } else {
      let v = num(f.value);
      if (Number.isNaN(v) || v < 0) {
        warnings.push(`"${f.label}" had a negative or unreadable factor and was treated as zero.`);
        v = 0;
      } else if (v > 1) {
        warnings.push(`"${f.label}" was above 1 and has been clamped: a modifying factor cannot add barrels to the ceiling.`);
        v = 1;
      }
      after = before * v;
    }
    if (after < 0) {
      warnings.push(`"${f.label}" took the plan below zero and was clamped.`);
      after = 0;
    }
    ledger.push({
      id: f.id, label: f.label, kind: f.kind === 'volume' ? 'volume' : 'multiplier',
      value: f.value, note: f.note || '', provenance: f.provenance || PROVENANCE.ASSUMED,
      costKboed: before - after, runningKboed: after,
    });
    running = after;
  }

  if (!list.length) warnings.push(
    'No modifying factors recorded. An unreduced technical ceiling is not a plan and must not be quoted as one.');

  const atcPlanKboed = running;
  const sum = ledger.reduce((a, l) => a + l.costKboed, 0);
  return {
    atcPlanKboed,
    ledger,
    sumDeductionsKboed: sum,
    balanced: Math.abs(sum - (tpMidKboed - atcPlanKboed)) < 1e-9,
    warnings,
  };
}

/* ── Provenance ──────────────────────────────────────────────────────── */

/** Counts how much of an input set was measured, borrowed from an analogue, or
 *  simply assumed, and grades the lot. A result with nothing measured is never
 *  shown without that grade beside it. */
export function provenanceSummary(map) {
  const out = { measured: 0, analogue: 0, assumed: 0, total: 0, grade: 'analogue-only' };
  for (const v of Object.values(map || {})) {
    if (v === PROVENANCE.MEASURED) out.measured++;
    else if (v === PROVENANCE.ANALOGUE) out.analogue++;
    else out.assumed++;
    out.total++;
  }
  if (out.total === 0) out.grade = 'analogue-only';
  else if (out.measured === out.total) out.grade = 'measured';
  else if (out.measured === 0) out.grade = 'analogue-only';
  else out.grade = 'mixed';
  return out;
}
