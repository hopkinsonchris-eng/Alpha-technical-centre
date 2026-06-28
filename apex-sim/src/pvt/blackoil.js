// ===========================================================================
// apex-sim · pvt/blackoil
// ---------------------------------------------------------------------------
// Black-oil PVT from PVTO/PVTW/PVTG tables. Returns b_p, ρ_p, μ_p and their derivatives wrt primaries. See docs/physics/pvt.md.
// ===========================================================================

export class BlackOilPVT {
  /** @param {{pvto?:object, pvtw?:object, pvtg?:object, densities?:object}} tables */
  constructor(tables) { this.tables = tables; }

  // Each returns { value, dP, dRs|dRv } for the AD Jacobian.
  oil(/* P, Rs, saturated */)  { /* TODO interpolate PVTO */ return { Bo: 1, muo: 1, dP: 0, dRs: 0 }; }
  water(/* P */)               { /* TODO PVTW */ return { Bw: 1, muw: 0.5, dP: 0 }; }
  gas(/* P, Rv, saturated */)  { /* TODO interpolate PVTG */ return { Bg: 0.005, mug: 0.02, dP: 0, dRv: 0 }; }

  /** Bubble-point pressure for given Rs (saturation boundary). */
  bubblePoint(/* Rs */) { /* TODO */ return 0; }
}
