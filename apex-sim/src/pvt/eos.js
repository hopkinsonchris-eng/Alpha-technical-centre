// ===========================================================================
// apex-sim · pvt/eos
// ---------------------------------------------------------------------------
// Cubic EOS (Peng–Robinson / SRK) for compositional runs (future). Provides two-phase flash, K-values, and phase densities/viscosities.
// ===========================================================================

export class CubicEOS {
  /** @param {{components:string[], kij?:number[][], type?:'PR'|'SRK'}} spec */
  constructor(spec) { this.spec = spec; this.type = spec.type ?? 'PR'; }
  /** Two-phase flash at (P,T,z). @returns {{V:number, x:number[], y:number[], K:number[]}} */
  flash(/* P, T, z */) { /* TODO Rachford-Rice + stability */ return null; }
}
