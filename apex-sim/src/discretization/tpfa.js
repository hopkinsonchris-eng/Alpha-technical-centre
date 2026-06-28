// ===========================================================================
// apex-sim · discretization/tpfa
// ---------------------------------------------------------------------------
// Two-point flux approximation: per-face phase fluxes from transmissibility, upwind mobility, and phase-potential difference. (MPFA later.)
// ===========================================================================

import { upwindMobility } from './upwinding.js';

/** Phase flux across one connection. @returns {{flux:number, deriv:object}} */
export function tpfaFlux(/* conn, statesI, statesJ, pvt, scal, gravity */) {
  // F_p = T · (b_p kr_p / mu_p)^up · (Phi_i - Phi_j)
  // TODO: compute potentials, pick upstream cell, assemble derivatives.
  upwindMobility; // referenced; implemented in upwinding.js
  return { flux: 0, deriv: {} };
}
