// ===========================================================================
// apex-sim · scal/relperm
// ---------------------------------------------------------------------------
// Relative permeability tables (SWOF/SGOF/SWFN...) with interpolation and derivatives. Two-phase curves; three-phase combined in threephase.js.
// ===========================================================================

export class RelPermTable {
  /** @param {{S:number[], kr:number[], krOther?:number[], pc?:number[]}} t */
  constructor(t) { this.t = t; }
  /** @returns {{kr:number, dkr_dS:number}} */
  eval(/* S */) { /* TODO piecewise-linear interp + slope */ return { kr: 0, dkr_dS: 0 }; }
}
