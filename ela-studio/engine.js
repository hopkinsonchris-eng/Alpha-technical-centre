// ============================================================================
//  ALPHA ELA — PHASE 1 BEST-FIRST ENGINE  (ported from the Excel model)
//  Pure functions, no DOM. Used by the web app and by the node validation test.
// ============================================================================
(function (global) {
  "use strict";

  // ---- normal inverse (Acklam) for lognormal quantiles -------------------
  function normInv(p) {
    const a=[-3.969683028665376e+01,2.209460984245205e+02,-2.759285104469687e+02,1.383577518672690e+02,-3.066479806614716e+01,2.506628277459239e+00];
    const b=[-5.447609879822406e+01,1.615858368580409e+02,-1.556989798598866e+02,6.680131188771972e+01,-1.328068155288572e+01];
    const c=[-7.784894002430293e-03,-3.223964580411365e-01,-2.400758277161838e+00,-2.549732539343734e+00,4.374664141464968e+00,2.938163982698783e+00];
    const d=[7.784695709041462e-03,3.224671290700398e-01,2.445134137142996e+00,3.754408661907416e+00];
    const pl=0.02425, ph=1-pl; let q,r;
    if(p<pl){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
    if(p<=ph){q=p-0.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
    q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  const Z10=normInv(0.10), Z90=normInv(0.90);  // ±1.2816

  // ---- lognormal fit per class -------------------------------------------
  // If class.fit has real P10/P90 (+optional P50), derive sigma/mu from the band.
  // Otherwise derive from assumed mean (mu) and CoV.
  function classCurve(c) {
    let sigma, muln;
    const f = c.fit;
    const fitted = f && f.use && f.p10 > 0 && f.p90 > f.p10;
    if (fitted) {
      sigma = (Math.log(f.p90) - Math.log(f.p10)) / (Z90 - Z10);
      muln  = (f.p50 > 0) ? Math.log(f.p50) : (Math.log(f.p10) + Math.log(f.p90)) / 2;
    } else {
      sigma = Math.sqrt(Math.log(1 + c.cov * c.cov));
      muln  = Math.log(c.mu) - sigma * sigma / 2;
    }
    const mean = Math.exp(muln + sigma * sigma / 2);
    const cov  = Math.sqrt(Math.exp(sigma * sigma) - 1);
    return {
      sigma, muln, mean, cov, fitted: !!fitted,
      p10: Math.exp(muln + Z10 * sigma),
      p50: Math.exp(muln),
      p90: Math.exp(muln + Z90 * sigma),
      perWellRisked: c.ps * mean,           // EV per well = Ps × mean
      evDay: (c.ps * mean) / c.dur,         // EV per crew-day → ranking metric
    };
  }

  // ---- full portfolio solve ----------------------------------------------
  function solve(state) {
    const e = state.econ, classes = state.classes;
    // per-class curves + risked totals
    const rows = classes.map(c => {
      const cv = classCurve(c);
      return {
        name: c.name, N: c.N, dur: c.dur, ps: c.ps, cost: c.cost,
        ...cv,
        unrisked: c.N * cv.mean,
        risked:   c.N * cv.perWellRisked,
        crewDays: c.N * c.dur,
        capex:    c.N * c.cost,             // $000s
      };
    });
    const unrisked = rows.reduce((s, r) => s + r.unrisked, 0);
    const riskedPlateau = rows.reduce((s, r) => s + r.risked, 0);
    const haircut = unrisked > 0 ? 1 - riskedPlateau / unrisked : 0;
    const totalCapex = rows.reduce((s, r) => s + r.capex, 0) * e.capexMult; // $000s

    // best-first ordering by EV/day (desc)
    const ranked = [...rows].sort((a, b) => b.evDay - a.evDay);

    // phasing ramp F(t): share of plateau reached each year (from model engine)
    // crews-driven: model used F = [2026..] 0,0,.483,.868,.974,1 at 6 crews.
    // We scale the ramp mid-years by crews (more crews → faster), anchored to model at 6.
    const crewFactor = Math.min(1.6, Math.max(0.5, state.crews / 6));
    const baseF = { 2026: 0, 2027: 0.4834, 2028: 0.8682, 2029: 0.9736, 2030: 1 };
    const years = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035];
    const F = {};
    years.forEach(y => {
      if (y <= 2026) F[y] = 0;
      else if (y >= 2030) F[y] = 1;
      else { const lift = baseF[y]; F[y] = Math.min(1, lift + (1 - lift) * (crewFactor - 1) * 0.6); }
    });

    // ---- ECONOMICS: full per-field 20-year waterfall (ported & reconciled) --
    const fields = state.fields;
    const totalBaseline = fields.reduce((s, f) => s + f.baseline, 0);
    // The user-controlled Phase-1 plateau flexes the field ramps: rampScale is
    // the ratio of the live risked plateau to the model's reconciled baseline
    // (the best-first plateau that produced the stored ramps).
    const BASELINE_PLATEAU = 98235.6;            // model risked plateau behind stored ramps
    const rampScale = riskedPlateau / BASELINE_PLATEAU;
    // Phase development cap (block ⑦): "1a" | "1b" | "2" | "3". Default "3" = base
    // case (full development, reconciled). Missing on old saved scenarios → "3".
    const phaseCap = state.phaseCap || "3";
    let econOut = null;
    if (global.ELAEcon) {
      const ek = { brent: e.brent, capexMult: e.capexMult, opexMult: e.opexMult,
                   discount: e.discount, gasPrice: e.gasPrice, royalty: e.royalty,
                   govtDecline: e.govtDecline };
      econOut = global.ELAEcon.portfolio(ek, rampScale, phaseCap);
    }
    const phaseMeta = global.ELAEcon ? global.ELAEcon.PHASE_META : null;
    const phaseTargetBopd = (phaseMeta && phaseMeta.targetBopd[phaseCap]) || null;
    // Active-phase production plateau = sum of the in-program (active four) fields'
    // block-⑦ plateau for the selected phase. This is the authoritative Phase plateau,
    // exactly as in the Excel model: 1a → 83,500 · 1b → 120,000 (inclusive of 1a) ·
    // 2 → 228,500 · 3 → 362,500. The bottom-up workover riskedPlateau still drives the
    // best-first ramp shape, ramp speed (rampScale) and the risk haircut.
    const PP = global.ELAEcon ? global.ELAEcon.PHASE_PLATEAU : null;
    const phasePlateau = PP
      ? state.fields.filter(f => f.inProgram)
          .reduce((s, f) => s + ((PP[f.name] && PP[f.name][phaseCap]) || 0), 0)
      : riskedPlateau;
    const npv  = econOut ? econOut.npv * 1000 : null;   // $000s (UI divides by 1000)
    const irr  = econOut ? econOut.irr : null;
    const peak = econOut ? econOut.peak : (totalBaseline + riskedPlateau);
    const proj = econOut ? econOut.years.map((y, i) => ({
        year: y, cf: econOut.cfTot[i], prod: econOut.prodTot[i],
      })) : [];

    return { rows, ranked, unrisked, riskedPlateau, haircut, totalCapex, F,
             proj, npv, irr, peak, econOut, rampScale,
             phaseCap, phaseTargetBopd, phaseMeta, phasePlateau,
             months: rampMonths(ranked, riskedPlateau, state.crews) };
  }

  // monthly cumulative ramp (best-first, continuous crew flow) — for the chart
  function rampMonths(ranked, plateau, crews) {
    const out = []; let cumDays = 0;
    const totalCrewDays = ranked.reduce((s, r) => s + r.crewDays, 0);
    const perDayPlateau = totalCrewDays > 0 ? plateau / totalCrewDays : 0;
    for (let m = 0; m <= 36; m++) {
      const day = m * 30.4375;
      const capacityDays = day * crews;
      const done = Math.min(totalCrewDays, capacityDays);
      out.push({ month: m, bopd: done * perDayPlateau });
    }
    return out;
  }

  function computeIRR(cfs) {
    let lo = -0.9, hi = 5.0;
    const npvAt = r => cfs.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
    if (npvAt(lo) * npvAt(hi) > 0) return null; // no sign change → n/m
    for (let k = 0; k < 200; k++) {
      const mid = (lo + hi) / 2, v = npvAt(mid);
      if (Math.abs(v) < 1e-6) return mid;
      if (npvAt(lo) * v < 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- default state (ported defaults from the model) --------------------
  function defaultState() {
    return {
      crews: 6,
      phaseCap: "3",   // development cap: "1a" restart · "1b" Phase-1 · "2" · "3" full (base case)
      econ: { brent: 70, capexMult: 1, opexMult: 1, discount: 0.15, gasPrice: 3,
              royalty: 0.30, govtDecline: 0.05, tax: 0, drawdownYear: 2026 },
      classes: [
        { name: "Surface tie-in restoration",          N: 14,  mu: 60,  cov: 0.30, ps: 0.95, cost: 85,  dur: 4,
          fit: { use: true,  p10: 64.5,  p50: 155.5, p90: 635.5 } },
        { name: "Gas-lift restoration (valve/mandrel)", N: 213, mu: 75,  cov: 0.38, ps: 0.95, cost: 210, dur: 6.5,
          fit: { use: true,  p10: 27.0,  p50: 62.0,  p90: 214.6 } },
        { name: "Chemical + slickline cleanout",        N: 2,   mu: 70,  cov: 0.42, ps: 0.95, cost: 165, dur: 7.5,
          fit: { use: true,  p10: 23.0,  p50: 31.0,  p90: 43.5  } },
        { name: "Gas-lift optimization (active)",       N: 456, mu: 28,  cov: 0.45, ps: 0.95, cost: 121, dur: 3,
          fit: { use: true,  p10: 28.0,  p50: 85.0,  p90: 406.0 } },
        { name: "ESP-equipped reactivation (Cat 2)",    N: 71,  mu: 115, cov: 0.48, ps: 0.95, cost: 480, dur: 15,
          fit: { use: true,  p10: 110.0, p50: 168.0, p90: 401.8 } },
        { name: "ESP rehabilitation program",           N: 191, mu: 110, cov: 0.50, ps: 0.95, cost: 310, dur: 14,
          fit: { use: true,  p10: 22.0,  p50: 38.0,  p90: 79.0  } },
        { name: "Tubing + light recompletion",          N: 0,   mu: 95,  cov: 0.50, ps: 0.95, cost: 640, dur: 19, fit: { use: false } },
        { name: "Acid stimulation / matrix",            N: 0,   mu: 55,  cov: 0.60, ps: 0.95, cost: 185, dur: 5,  fit: { use: false } },
        { name: "Recompletions / add-perfs",            N: 0,   mu: 125, cov: 0.55, ps: 0.95, cost: 420, dur: 12, fit: { use: false } },
        { name: "Water shutoff / conformance",          N: 0,   mu: 45,  cov: 0.58, ps: 0.95, cost: 165, dur: 6,  fit: { use: false } },
      ],
      fields: [
        { name: "Lagunillas Lago",       baseline: 6000,  opex: 12, qDisc: 15, weight: 0.4082, inProgram: true },
        { name: "Tía Juana Lago-Tierra", baseline: 20000, opex: 11, qDisc: 14, weight: 0.3469, inProgram: true },
        { name: "Rosa Mediano",          baseline: 3500,  opex: 9,  qDisc: 5,  weight: 0.0816, inProgram: true },
        { name: "Cabimas Field",         baseline: 5000,  opex: 10, qDisc: 10, weight: 0.1633, inProgram: true },
        { name: "Trevi Field",           baseline: 0,     opex: 6,  qDisc: 3,  weight: 0, inProgram: false, greenfieldPlateau: 8000, gasPlateau: 0 },
      ],
    };
  }

  const API = { solve, classCurve, defaultState, computeIRR, normInv };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.ELAEngine = API;
})(typeof window !== "undefined" ? window : globalThis);
