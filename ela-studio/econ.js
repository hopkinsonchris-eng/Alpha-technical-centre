// ============================================================================
//  ALPHA ELA — FULL ECONOMICS  (ported from the model's per-field waterfall)
//  20-year model, 2025-2044. Reproduces each field tab's cash-flow columns and
//  the PORTFOLIO SUMMARY aggregation. Reconciled number-for-number to the model.
// ============================================================================
(function (global) {
  "use strict";
  const FE = (typeof require !== "undefined") ? require("./field_econ.js").FIELD_ECON
            : global.FIELD_ECON;

  const YEARS = []; for (let y = 2025; y <= 2044; y++) YEARS.push(y);

  // ---- Phase production plateaus (Total Field BOPD) -----------------------
  // Mirrors the source model's ASSUMPTIONS block ⑦ (columns B/E/C/D). Each phase
  // caps the field's ramp exactly like the field-tab formula B = MIN(rawRamp, cap):
  //   1a = restart plateau   · 1b = Phase-1 development plateau (Ph1 cap)
  //   2  = Phase-2 plateau    · 3  = Phase-3 peak (full development · base case)
  // Active-four (Lagunillas+Tía Juana+Rosa+Cabimas) sums: 1a→83,500 · 1b→120,000.
  // Phase 3 equals each field's stored `plateau`, so phaseCap "3" reproduces the
  // reconciled base-case economics number-for-number.
  const PHASE_PLATEAU = {
    "Lagunillas Lago":       { "1a": 26000, "1b": 37365, "2": 75000, "3": 130000 },
    "Tía Juana Lago-Tierra": { "1a": 37000, "1b": 53174, "2": 90000, "3": 140000 },
    "Rosa Mediano":          { "1a":  7500, "1b": 10778, "2": 20500, "3":  30500 },
    "Cabimas Field":         { "1a": 13000, "1b": 18683, "2": 43000, "3":  62000 },
    "Trevi Field":           { "1a":  8000, "1b": 11497, "2": 18000, "3":  20000 },
  };
  // Program-level Phase-1 split targets & CAPEX (active four fields), from the model.
  const PHASE_META = {
    targetBopd: { "1a": 83500, "1b": 120000 },
    ph1aCapexMM: 123.0,                     // Phase-1a restart CAPEX ($MM)
    ph1aCapexByField: { "Lagunillas Lago": 49.69, "Tía Juana Lago-Tierra": 33.83,
                        "Rosa Mediano": 19.74, "Cabimas Field": 19.74 },
  };
  function plateauFor(fname, phaseCap) {
    const p = PHASE_PLATEAU[fname];
    if (p && phaseCap != null && p[phaseCap] != null) return p[phaseCap];
    return FE[fname] ? FE[fname].plateau : 0;   // fallback = stored (Phase-3) plateau
  }

  // Per-field annual cash flow, mirroring the field tab columns B,D,E,F,H,J..X.
  // econ: { brent, capexMult, opexMult, discount, gasPrice, royalty, govtDecline }
  // rampScale: multiplies the field's stored scheduled ramp (1.0 = model baseline).
  //   Lets the Phase-1 plateau the user controls flex the whole field ramp.
  function fieldCashflow(fname, econ, rampScale, phaseCap) {
    const f = FE[fname];
    if (!f) return null;
    rampScale = rampScale == null ? 1 : rampScale;
    const cap = plateauFor(fname, phaseCap);                       // active-phase plateau (block ⑦)
    const rows = YEARS.map((yr, i) => {
      const sched = (f.ramp[i] || 0) * (i <= 1 ? 1 : rampScale); // keep 2025-26 actuals fixed
      const totalProd = Math.min(sched, cap);                     // B = MIN(rawRamp, AA4 phase cap)
      const govtBase  = f.baseline * Math.pow(1 - econ.govtDecline, yr - 2025); // D
      const invNet    = Math.max(0, totalProd - govtBase);        // E
      const oilMM     = invNet * 365 / 1e6;                       // F MMbbl/yr
      const gasBCF    = (f.gas[i] || 0) * 365 / 1000;             // G BCF/yr
      const price     = econ.brent - f.qdisc;                     // H realized
      const oilRev    = oilMM * price;                            // J $MM
      const gasRev    = gasBCF * (f.gas[i] > 0 ? econ.gasPrice : 0); // K $MM
      const gross     = oilRev + gasRev;                          // L
      const royalty   = gross * econ.royalty;                     // M
      const netRev    = gross - royalty;                          // N
      const opexRate  = f.opexRate * econ.opexMult;               // O
      const opex      = oilMM * opexRate;                         // P
      const cx        = f.capex[i] || [0, 0, 0];
      const capex     = (cx[0] + cx[1] + cx[2]) * econ.capexMult; // T (Ph2/3 mult=1 in model)
      const cf        = netRev - opex - capex;                    // U
      const disc      = 1 / Math.pow(1 + econ.discount, yr - 2025); // W
      const pv        = cf * disc;                                // X
      return { yr, totalProd, govtBase, invNet, oilMM, gross, royalty, netRev, opex, capex, cf, pv };
    });
    const npv = rows.reduce((s, r) => s + r.pv, 0);
    const irr = irrOf(rows.map(r => r.cf));
    const cumRev = rows.reduce((s, r) => s + r.netRev, 0);
    const totalCapex = rows.reduce((s, r) => s + r.capex, 0);
    const payback = paybackMonths(rows.map(r => r.cf));
    return { rows, npv, irr, cumRev, totalCapex, payback };
  }

  function portfolio(econ, rampScale, phaseCap) {
    const fields = Object.keys(FE);
    const byField = {};
    let npv = 0, capex = 0;
    const cfTot = YEARS.map(() => 0);
    fields.forEach(fn => {
      const r = fieldCashflow(fn, econ, rampScale, phaseCap);
      byField[fn] = r; npv += r.npv; capex += r.totalCapex;
      r.rows.forEach((row, i) => cfTot[i] += row.cf);
    });
    const prodTot = YEARS.map((y, i) => fields.reduce((s, fn) => s + byField[fn].rows[i].totalProd, 0));
    return { years: YEARS, byField, npv, totalCapex: capex, irr: irrOf(cfTot),
             payback: paybackMonths(cfTot), cfTot, prodTot, phaseCap: phaseCap || null,
             peak: Math.max(...prodTot) };
  }

  function irrOf(cfs) {
    const f = r => cfs.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i), 0);
    let lo = -0.95, hi = 10;
    if (f(lo) * f(hi) > 0) return null;
    for (let k = 0; k < 300; k++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; if (hi - lo < 1e-9) break; }
    return (lo + hi) / 2;
  }
  function paybackMonths(cfs) {
    let cum = 0;
    for (let i = 0; i < cfs.length; i++) { const prev = cum; cum += cfs[i];
      if (cum >= 0 && prev < 0) { const frac = cfs[i] !== 0 ? -prev / cfs[i] : 0; return Math.round((i - 1 + frac) * 12); } }
    return null;
  }

  const API = { fieldCashflow, portfolio, YEARS, FIELD_ECON: FE,
                PHASE_PLATEAU, PHASE_META, plateauFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.ELAEcon = API;
})(typeof window !== "undefined" ? window : globalThis);
