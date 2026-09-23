/* Smoke tests for the technical-potential calculator.
 *
 * These were written before the module they test. Where a criterion needs a
 * numeric answer, the test either derives it analytically (a case with a known
 * closed form) or recomputes it by a deliberately different route, so a wrong
 * implementation cannot agree with a wrong test for the same reason.
 *
 *   node --test test/
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  coreyKrw, coreyKro, fractionalFlow, mobilityRatio, welge,
  ooip, giipVolumetric, gasRecoverable, darcyOilRate, darcyGasRate,
  reFromSpacing, technicalPotential, potentialBand,
  applyModifyingFactors, provenanceSummary, PotentialError,
} from '../js/potential.js';

/* ── helpers ─────────────────────────────────────────────────────────── */

// Reproducible pseudo-randomness, so a failure can be re-run.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const near = (a, b, tolFrac, what) =>
  assert.ok(Math.abs(a - b) <= Math.abs(b) * tolFrac + 1e-12,
    `${what}: got ${a}, expected ${b} (tol ${tolFrac * 100}%)`);

const RP = { swc: 0.22, sor: 0.25, krwMax: 0.35, kroMax: 0.90, nw: 2.5, no: 2.0 };
const FL = { muo: 3.2, muw: 0.45 };

/* An independent tangency solver. The module finds the Welge point by
 * maximising the chord slope; this finds the root of
 *   h(Sw) = f'(Sw)·(Sw − Swc) − f(Sw)
 * by bisection with central-difference derivatives. Different method, same
 * answer, or one of them is wrong. */
function welgeByBisection(rp, fl) {
  const f = (sw) => fractionalFlow(sw, rp, fl);
  const d = (sw) => { const e = 1e-7; return (f(sw + e) - f(sw - e)) / (2 * e); };
  const h = (sw) => d(sw) * (sw - rp.swc) - f(sw);
  let lo = rp.swc + 1e-4, hi = 1 - rp.sor - 1e-4;
  assert.ok(h(lo) > 0 && h(hi) < 0, 'bracket for tangency root');
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (h(mid) > 0) lo = mid; else hi = mid;
  }
  const swf = (lo + hi) / 2, fwf = f(swf);
  return { swf, fwf, swBar: rp.swc + (swf - rp.swc) / fwf };
}

/* ── AC2 · rel perm and fractional flow ──────────────────────────────── */

describe('Corey relative permeability', () => {
  test('endpoints are exact', () => {
    assert.equal(coreyKrw(RP.swc, RP), 0, 'krw at Swc');
    assert.equal(coreyKro(1 - RP.sor, RP), 0, 'kro at 1-Sor');
    near(coreyKro(RP.swc, RP), RP.kroMax, 1e-12, 'kro at Swc');
    near(coreyKrw(1 - RP.sor, RP), RP.krwMax, 1e-12, 'krw at 1-Sor');
  });

  test('monotonic between the endpoints', () => {
    let prevW = -1, prevO = Infinity;
    for (let i = 0; i <= 200; i++) {
      const sw = RP.swc + (1 - RP.sor - RP.swc) * (i / 200);
      const kw = coreyKrw(sw, RP), ko = coreyKro(sw, RP);
      assert.ok(kw >= prevW - 1e-15, `krw rising at Sw=${sw}`);
      assert.ok(ko <= prevO + 1e-15, `kro falling at Sw=${sw}`);
      assert.ok(kw >= 0 && ko >= 0, 'non-negative');
      prevW = kw; prevO = ko;
    }
  });

  test('saturations outside the movable range clamp, they do not go negative', () => {
    assert.equal(coreyKrw(RP.swc - 0.05, RP), 0);
    assert.equal(coreyKro(1 - RP.sor + 0.05, RP), 0);
  });
});

describe('fractional flow', () => {
  test('bounded 0..1 and monotonic in Sw', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const sw = RP.swc + (1 - RP.sor - RP.swc) * (i / 200);
      const fw = fractionalFlow(sw, RP, FL);
      assert.ok(fw >= 0 && fw <= 1, `fw in range at Sw=${sw}, got ${fw}`);
      assert.ok(fw >= prev - 1e-12, `fw rising at Sw=${sw}`);
      prev = fw;
    }
    near(fractionalFlow(RP.swc, RP, FL), 0, 1e-12, 'fw at Swc');
    near(fractionalFlow(1 - RP.sor, RP, FL), 1, 1e-12, 'fw at 1-Sor');
  });

  test('more viscous oil pushes fw up at the same saturation', () => {
    const sw = 0.5;
    const thin = fractionalFlow(sw, RP, { muo: 1.0, muw: 0.45 });
    const thick = fractionalFlow(sw, RP, { muo: 20.0, muw: 0.45 });
    assert.ok(thick > thin, 'viscous oil is bypassed sooner');
  });
});

test('mobility ratio uses endpoint mobilities', () => {
  const M = mobilityRatio(RP, FL);
  near(M, (RP.krwMax / FL.muw) / (RP.kroMax / FL.muo), 1e-12, 'M');
  assert.ok(M > 1, 'this fluid pair is unfavourable');
});

/* ── AC2 · Welge ─────────────────────────────────────────────────────── */

describe('Welge tangent construction', () => {
  test('linear rel perm with favourable mobility is piston-like (analytic case)', () => {
    // With nw = no = 1 and M < 1 the fractional-flow curve is convex, the
    // tangent touches at 1-Sor, and displacement is piston-like: breakthrough
    // recovery equals ultimate recovery. No numerical tolerance needed on the
    // physics, only on the arithmetic.
    const rp = { swc: 0.20, sor: 0.25, krwMax: 0.10, kroMax: 0.90, nw: 1, no: 1 };
    const fl = { muo: 1.0, muw: 2.0 };
    assert.ok(mobilityRatio(rp, fl) < 1, 'case really is favourable');
    const w = welge(rp, fl);
    near(w.swf, 1 - rp.sor, 1e-4, 'front saturation at the trailing endpoint');
    near(w.fwf, 1, 1e-4, 'fw at the front');
    near(w.swBar, 1 - rp.sor, 1e-4, 'average saturation behind the front');
    near(w.edBreakthrough, w.edUltimate, 1e-4, 'piston: breakthrough == ultimate');
  });

  test('S-shaped case agrees with an independent bisection solver', () => {
    const w = welge(RP, FL);
    const b = welgeByBisection(RP, FL);
    near(w.swf, b.swf, 1e-4, 'Swf');
    near(w.fwf, b.fwf, 1e-4, 'fwf');
    near(w.swBar, b.swBar, 1e-4, 'Sw bar');
  });

  test('the tangent really is tangent', () => {
    // Chord slope from (Swc, 0) must equal the curve slope at the front.
    const w = welge(RP, FL);
    const e = 1e-7;
    const slope = (fractionalFlow(w.swf + e, RP, FL) - fractionalFlow(w.swf - e, RP, FL)) / (2 * e);
    near(slope, w.fwf / (w.swf - RP.swc), 2e-3, 'tangency condition');
  });

  test('ultimate displacement efficiency matches its closed form', () => {
    const w = welge(RP, FL);
    near(w.edUltimate, (1 - RP.sor - RP.swc) / (1 - RP.swc), 1e-12, 'ED ultimate');
  });

  test('breakthrough never beats ultimate, over 300 random rel perm sets', () => {
    const r = rng(20260923);
    for (let i = 0; i < 300; i++) {
      const swc = 0.05 + r() * 0.3, sor = 0.05 + r() * 0.35;
      if (swc + sor > 0.92) continue;
      const rp = { swc, sor, krwMax: 0.05 + r() * 0.6, kroMax: 0.3 + r() * 0.7,
                   nw: 1 + r() * 3, no: 1 + r() * 3 };
      const fl = { muo: 0.3 + r() * 50, muw: 0.2 + r() * 1.2 };
      const w = welge(rp, fl);
      assert.ok(Number.isFinite(w.swf) && Number.isFinite(w.edBreakthrough),
        `finite at i=${i}`);
      assert.ok(w.swf > swc && w.swf <= 1 - sor + 1e-9, `Swf in range at i=${i}`);
      assert.ok(w.edBreakthrough <= w.edUltimate + 1e-9,
        `ED_bt ${w.edBreakthrough} > ED_ult ${w.edUltimate} at i=${i}`);
      assert.ok(w.edBreakthrough > 0, `positive recovery at i=${i}`);
    }
  });
});

/* ── AC3, AC4 · volumes and rates ────────────────────────────────────── */

describe('volumetrics', () => {
  test('OOIP against a hand figure', () => {
    // 640 acres, 50 ft net, 22% porosity, Swc 0.22, Boi 1.25
    // 7758 * 640 * 50 * 0.22 * 0.78 / 1.25 = 34,090,168 STB
    const N = ooip({ areaAcres: 640, hFt: 50, phi: 0.22, swc: 0.22, boi: 1.25 });
    near(N, 7758 * 640 * 50 * 0.22 * (1 - 0.22) / 1.25, 1e-12, 'OOIP formula');
    near(N, 34.09e6, 0.005, 'OOIP magnitude');
  });

  test('GIIP and recovery to abandonment', () => {
    const G = giipVolumetric({ areaAcres: 1200, hFt: 90, phi: 0.18, swc: 0.25, bgiCfPerScf: 0.0052 });
    near(G, 43560 * 1200 * 90 * 0.18 * 0.75 / 0.0052 / 1000, 1e-12, 'GIIP formula');
    // Blowing down from pi/Zi to pab/Zab recovers the fraction between them.
    const rec = gasRecoverable({ giipMscf: G, pi: 4200, zi: 0.93, pab: 700, zab: 0.98 });
    near(rec, G * (1 - (700 / 0.98) / (4200 / 0.93)), 1e-12, 'recoverable formula');
    assert.ok(rec > 0 && rec < G, 'a fraction, not all of it');
  });

  test('drainage radius from spacing', () => {
    // 40-acre spacing: sqrt(43560*40/pi) = 744.7 ft
    near(reFromSpacing(40), Math.sqrt(43560 * 40 / Math.PI), 1e-12, 're formula');
    near(reFromSpacing(40), 744.7, 0.001, 're magnitude');
  });
});

describe('Darcy deliverability', () => {
  const OIL = { k: 100, kro: 0.8, hFt: 50, pres: 3000, pwf: 1500,
                bo: 1.2, muo: 2, re: 1000, rw: 0.354, skin: 0 };

  test('radial oil rate, cross-checked with the 0.00708 form', () => {
    const q = darcyOilRate(OIL);
    const alt = 0.00708 * OIL.k * OIL.kro * OIL.hFt * (OIL.pres - OIL.pwf) /
      (OIL.muo * OIL.bo * (Math.log(OIL.re / OIL.rw) - 0.75 + OIL.skin));
    near(q, alt, 0.001, 'oil rate against the alternative constant');
    near(q, 2460, 0.005, 'oil rate magnitude');
  });

  test('skin chokes the well, negative skin helps it', () => {
    const clean = darcyOilRate(OIL);
    const damaged = darcyOilRate({ ...OIL, skin: 8 });
    const stimulated = darcyOilRate({ ...OIL, skin: -2 });
    assert.ok(damaged < clean && clean < stimulated, 'skin ordering');
  });

  test('rate is linear in drawdown', () => {
    const a = darcyOilRate({ ...OIL, pwf: 2000 });
    const b = darcyOilRate({ ...OIL, pwf: 1000 });
    near(b / a, 2000 / 1000, 1e-9, 'double the drawdown, double the rate');
  });

  test('gas rate uses the pressure-squared form', () => {
    const G = { k: 20, hFt: 80, pres: 4000, pwf: 2500, mug: 0.022, z: 0.92,
                tempR: 640, re: 2000, rw: 0.354, skin: 0 };
    const q = darcyGasRate(G);
    const alt = G.k * G.hFt * (G.pres ** 2 - G.pwf ** 2) /
      (1424 * G.mug * G.z * G.tempR * (Math.log(G.re / G.rw) - 0.75 + G.skin));
    near(q, alt, 1e-9, 'gas rate formula');
    assert.ok(q > 0, 'positive');
    // Halving both pressures quarters the driving force, not halves it.
    const half = darcyGasRate({ ...G, pres: 2000, pwf: 1250 });
    near(half / q, 0.25, 1e-9, 'p-squared scaling');
  });
});

/* ── AC5, AC6 · technical potential ──────────────────────────────────── */

const WF_INPUTS = {
  drive: 'waterflood',
  wells: { producers: 12, spacingAcres: 40, rwFt: 0.354 },
  rock: { k: 120, hFt: 45, phi: 0.21, areaAcres: 480 },
  relperm: RP,
  fluids: { ...FL, bo: 1.24, boi: 1.28 },
  pressure: { pres: 2900, pwf: 1100, skin: 0 },
  plateauYears: 5,
};

const GAS_INPUTS = {
  drive: 'gas',
  wells: { producers: 8, spacingAcres: 320, rwFt: 0.354 },
  rock: { k: 15, hFt: 110, phi: 0.17, areaAcres: 2400 },
  gas: { mug: 0.023, z: 0.91, tempF: 180, bgiCfPerScf: 0.0049,
         pi: 4300, zi: 0.94, pab: 800, zab: 0.98 },
  pressure: { pres: 4100, pwf: 1800, skin: 0 },
  plateauYears: 5,
  mscfPerBoe: 6,
};

describe('technical potential', () => {
  test('waterflood case reports both bounds and takes the lower', () => {
    const r = technicalPotential(WF_INPUTS);
    assert.ok(r.rateCeilingKboed > 0, 'rate ceiling positive');
    assert.ok(r.plateauSustainableKboed > 0, 'volume-limited rate positive');
    near(r.potentialKboed, Math.min(r.rateCeilingKboed, r.plateauSustainableKboed),
      1e-12, 'potential is the binding one');
    assert.ok(['rate', 'volume'].includes(r.bound), 'bound is named');
    assert.ok(r.welge && r.welge.edUltimate > 0, 'Buckley-Leverett result carried');
    assert.ok(r.mobilityRatio > 0, 'M reported');
  });

  test('the ceiling is computed with skin removed, whatever skin was given', () => {
    const damaged = technicalPotential({ ...WF_INPUTS,
      pressure: { ...WF_INPUTS.pressure, skin: 15 } });
    const clean = technicalPotential(WF_INPUTS);
    near(damaged.rateCeilingKboed, clean.rateCeilingKboed, 1e-12,
      'technical potential assumes the damage is removed');
    assert.ok(damaged.currentSkinRateKboed < clean.rateCeilingKboed,
      'but the as-is rate is reported separately and is lower');
  });

  test("today's rate uses the active wells, the ceiling uses the whole stock", () => {
    // A brownfield's story is mostly here: the stock is large, the active
    // subset is small, and the difference is the prize.
    const r = technicalPotential({ ...WF_INPUTS,
      wells: { ...WF_INPUTS.wells, producers: 40, activeProducers: 10 },
      pressure: { ...WF_INPUTS.pressure, skin: 0 } });
    near(r.currentSkinRateKboed, r.rateCeilingKboed * 10 / 40, 1e-9,
      'today scales on the active count alone when nothing else differs');
  });

  test("today's rate uses today's flowing pressure, not the lift limit", () => {
    const base = { ...WF_INPUTS, pressure: { pres: 3000, pwf: 1000, pwfNow: 2400, skin: 0 } };
    const r = technicalPotential(base);
    // Drawdown today is 600 psi against 2000 psi at the lift limit.
    near(r.currentSkinRateKboed, r.rateCeilingKboed * 600 / 2000, 1e-9, 'drawdown ratio');
    assert.ok(r.currentSkinRateKboed < r.rateCeilingKboed, 'and it is lower');
  });

  test('active wells and flowing pressure default to the full case', () => {
    const r = technicalPotential({ ...WF_INPUTS,
      pressure: { ...WF_INPUTS.pressure, skin: 0 } });
    near(r.currentSkinRateKboed, r.rateCeilingKboed, 1e-9,
      'with no skin and no separate today values, the two coincide');
  });

  test('the calibration ratio reports how far today sits below the model', () => {
    const r = technicalPotential({ ...WF_INPUTS,
      wells: { ...WF_INPUTS.wells, producers: 40, activeProducers: 8 },
      pressure: { pres: 3000, pwf: 1000, pwfNow: 2500, skin: 25 } });
    assert.ok(r.currentSkinRateKboed > 0, 'positive');
    assert.ok(r.currentSkinRateKboed < r.rateCeilingKboed * 0.1,
      'shut-in wells, damage and no lift compound');
  });

  test('more active wells than the stock is refused', () => {
    assert.throws(() => technicalPotential({ ...WF_INPUTS,
      wells: { ...WF_INPUTS.wells, producers: 10, activeProducers: 25 } }),
      (e) => e instanceof PotentialError, 'cannot have more active wells than wells');
  });

  test('a tiny reservoir is volume-bound, a huge one is rate-bound', () => {
    const small = technicalPotential({ ...WF_INPUTS,
      rock: { ...WF_INPUTS.rock, areaAcres: 8 } });
    assert.equal(small.bound, 'volume', 'small tank cannot sustain the wells');
    const big = technicalPotential({ ...WF_INPUTS,
      rock: { ...WF_INPUTS.rock, areaAcres: 80000 } });
    assert.equal(big.bound, 'rate', 'big tank is limited by what the wells flow');
  });

  test('gas case runs and converts to kboe/d at the stated factor', () => {
    const r = technicalPotential(GAS_INPUTS);
    assert.ok(r.potentialKboed > 0, 'positive');
    assert.equal(r.drive, 'gas');
    assert.ok(r.recoverableMscf > 0, 'recoverable gas reported');
    const at12 = technicalPotential({ ...GAS_INPUTS, mscfPerBoe: 12 });
    near(at12.rateCeilingKboed, r.rateCeilingKboed / 2, 1e-9,
      'doubling Mscf per boe halves the boe rate');
  });

  test('gas case never invokes Buckley-Leverett', () => {
    const r = technicalPotential(GAS_INPUTS);
    assert.equal(r.welge, null, 'no fractional-flow result on a gas asset');
    assert.equal(r.mobilityRatio, null, 'no waterflood mobility ratio');
  });

  test('plateau years shorten as the plateau rate is raised', () => {
    const five = technicalPotential(WF_INPUTS);
    const ten = technicalPotential({ ...WF_INPUTS, plateauYears: 10 });
    assert.ok(ten.plateauSustainableKboed < five.plateauSustainableKboed,
      'holding a plateau for longer means holding it lower');
  });
});

describe('low / mid / high band', () => {
  const band = {
    low: { ...WF_INPUTS, rock: { ...WF_INPUTS.rock, k: 60, hFt: 30 } },
    mid: WF_INPUTS,
    high: { ...WF_INPUTS, rock: { ...WF_INPUTS.rock, k: 260, hFt: 65 } },
  };

  test('ordered low <= mid <= high', () => {
    const b = potentialBand(band);
    assert.ok(b.low.potentialKboed <= b.mid.potentialKboed + 1e-9, 'low <= mid');
    assert.ok(b.mid.potentialKboed <= b.high.potentialKboed + 1e-9, 'mid <= high');
  });

  test('ordering holds over 500 random input sets', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const swc = 0.08 + r() * 0.25, sor = 0.08 + r() * 0.3;
      const rp = { swc, sor, krwMax: 0.08 + r() * 0.5, kroMax: 0.4 + r() * 0.6,
                   nw: 1.2 + r() * 2.5, no: 1.2 + r() * 2.5 };
      const base = {
        ...WF_INPUTS, relperm: rp,
        fluids: { muo: 0.5 + r() * 30, muw: 0.3 + r() * 0.8, bo: 1.05 + r() * 0.4, boi: 1.1 + r() * 0.4 },
        pressure: { pres: 1500 + r() * 3000, pwf: 300 + r() * 600, skin: 0 },
        wells: { producers: 1 + Math.floor(r() * 40), spacingAcres: 10 + r() * 300, rwFt: 0.354 },
        plateauYears: 2 + r() * 10,
      };
      const kMid = 20 + r() * 300, hMid = 10 + r() * 120, aMid = 50 + r() * 2000;
      const phi = 0.12 + r() * 0.12;
      const mk = (f) => ({ ...base, rock: { k: kMid * f, hFt: hMid * f, phi, areaAcres: aMid * f } });
      const b = potentialBand({ low: mk(0.5), mid: mk(1), high: mk(1.8) });
      for (const c of ['low', 'mid', 'high']) {
        assert.ok(Number.isFinite(b[c].potentialKboed) && b[c].potentialKboed > 0,
          `finite positive ${c} at i=${i}`);
      }
      assert.ok(b.low.potentialKboed <= b.mid.potentialKboed + 1e-6, `low<=mid at i=${i}`);
      assert.ok(b.mid.potentialKboed <= b.high.potentialKboed + 1e-6, `mid<=high at i=${i}`);
    }
  });
});

/* ── AC7, AC8 · the modifying-factor ledger ──────────────────────────── */

describe('modifying factors', () => {
  const FACTORS = [
    { id: 'areal', label: 'Areal sweep efficiency', kind: 'multiplier', value: 0.72 },
    { id: 'vertical', label: 'Vertical sweep', kind: 'multiplier', value: 0.80 },
    { id: 'access', label: 'Well access', kind: 'multiplier', value: 0.85 },
    { id: 'facility', label: 'Facility capacity limit', kind: 'volume', value: 6 },
    { id: 'capex', label: 'Capex and schedule', kind: 'multiplier', value: 0.9 },
  ];

  test('deductions sum exactly to the difference', () => {
    const r = applyModifyingFactors(100, FACTORS);
    const sum = r.ledger.reduce((a, l) => a + l.costKboed, 0);
    assert.ok(Math.abs(sum - (100 - r.atcPlanKboed)) < 1e-9,
      `ledger ${sum} vs difference ${100 - r.atcPlanKboed}`);
    assert.equal(r.balanced, true, 'reports itself balanced');
  });

  test('balance holds for 500 random factor sets', () => {
    const r = rng(99);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(r() * 8);
      const tp = 1 + r() * 400;
      const factors = [];
      for (let j = 0; j < n; j++) {
        factors.push(r() < 0.6
          ? { id: 'm' + j, label: 'm' + j, kind: 'multiplier', value: 0.3 + r() * 0.7 }
          : { id: 'v' + j, label: 'v' + j, kind: 'volume', value: r() * tp * 0.2 });
      }
      const out = applyModifyingFactors(tp, factors);
      const sum = out.ledger.reduce((a, l) => a + l.costKboed, 0);
      assert.ok(Math.abs(sum - (tp - out.atcPlanKboed)) < 1e-6,
        `balance at i=${i}: ${sum} vs ${tp - out.atcPlanKboed}`);
      assert.ok(out.atcPlanKboed <= tp + 1e-9, `plan <= ceiling at i=${i}`);
      assert.ok(out.atcPlanKboed >= 0, `never negative at i=${i}`);
    }
  });

  test('the plan can never exceed the ceiling, even with silly factors', () => {
    const r = applyModifyingFactors(50, [
      { id: 'a', label: 'over unity', kind: 'multiplier', value: 3 },
      { id: 'b', label: 'negative volume', kind: 'volume', value: -20 },
    ]);
    assert.ok(r.atcPlanKboed <= 50 + 1e-9, 'clamped to the ceiling');
    assert.ok(r.warnings.length >= 1, 'and says why');
  });

  test('multiplier-only ledgers do not depend on the order they are listed', () => {
    const only = FACTORS.filter((f) => f.kind === 'multiplier');
    const a = applyModifyingFactors(100, only).atcPlanKboed;
    const b = applyModifyingFactors(100, [...only].reverse()).atcPlanKboed;
    near(a, b, 1e-12, 'commutative');
  });

  test('an empty ledger means the plan equals the ceiling, and flags it', () => {
    const r = applyModifyingFactors(100, []);
    near(r.atcPlanKboed, 100, 1e-12, 'no deductions');
    assert.ok(r.warnings.some((w) => /no modifying factors/i.test(w)),
      'warns that an unreduced ceiling is not a plan');
  });
});

/* ── AC18 · degenerate inputs ────────────────────────────────────────── */

describe('degenerate inputs are named, never NaN', () => {
  const bad = [
    ['zero permeability', { rock: { ...WF_INPUTS.rock, k: 0 } }],
    ['zero net pay', { rock: { ...WF_INPUTS.rock, hFt: 0 } }],
    ['negative porosity', { rock: { ...WF_INPUTS.rock, phi: -0.1 } }],
    ['flowing pressure above reservoir pressure', { pressure: { pres: 1000, pwf: 2000, skin: 0 } }],
    ['immobile saturations', { relperm: { ...RP, swc: 0.6, sor: 0.5 } }],
    ['zero producers', { wells: { ...WF_INPUTS.wells, producers: 0 } }],
    ['wellbore larger than drainage', { wells: { ...WF_INPUTS.wells, spacingAcres: 1e-9 } }],
    ['zero plateau', { plateauYears: 0 }],
  ];
  for (const [name, patch] of bad) {
    test(name, () => {
      assert.throws(() => technicalPotential({ ...WF_INPUTS, ...patch }),
        (e) => e instanceof PotentialError && typeof e.message === 'string' && e.message.length > 5,
        `${name} should raise a named error`);
    });
  }

  test('a valid case never returns NaN or Infinity anywhere', () => {
    const r = technicalPotential(WF_INPUTS);
    const walk = (o, path = '') => {
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'number') assert.ok(Number.isFinite(v), `${path}${k} is finite`);
        else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}${k}.`);
      }
    };
    walk(r);
  });
});

/* ── AC9 · provenance ────────────────────────────────────────────────── */

describe('provenance', () => {
  test('counts by class and grades the result', () => {
    const s = provenanceSummary({
      k: 'measured', hFt: 'measured', phi: 'analogue',
      swc: 'analogue', sor: 'assumed', muo: 'measured',
    });
    assert.equal(s.measured, 3);
    assert.equal(s.analogue, 2);
    assert.equal(s.assumed, 1);
    assert.equal(s.total, 6);
    assert.ok(['measured', 'mixed', 'analogue-only'].includes(s.grade), 'graded');
  });

  test('nothing measured is called out as analogue-only', () => {
    const s = provenanceSummary({ k: 'analogue', hFt: 'analogue', phi: 'assumed' });
    assert.equal(s.grade, 'analogue-only');
    assert.equal(s.measured, 0);
  });

  test('all measured grades as measured', () => {
    const s = provenanceSummary({ k: 'measured', hFt: 'measured' });
    assert.equal(s.grade, 'measured');
  });
});
