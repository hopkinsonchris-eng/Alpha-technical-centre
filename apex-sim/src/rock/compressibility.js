// ===========================================================================
// apex-sim · rock/compressibility
// ---------------------------------------------------------------------------
// Rock compressibility (ROCK keyword): pore-volume multiplier as a function of pressure, and its derivative for the Jacobian.
// ===========================================================================

export class RockCompressibility {
  /** @param {number} pRef @param {number} cr (1/psi) */
  constructor(pRef, cr) { this.pRef = pRef; this.cr = cr; }
  /** @returns {{mult:number, dmult_dP:number}} */
  multiplier(P) {
    const x = this.cr * (P - this.pRef);
    return { mult: 1 + x + 0.5 * x * x, dmult_dP: this.cr * (1 + x) };
  }
}
