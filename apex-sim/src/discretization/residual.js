// ===========================================================================
// apex-sim · discretization/residual
// ---------------------------------------------------------------------------
// Residual assembly: combines accumulation, fluxes, and well sources into the per-cell component residual vector R(x).
// ===========================================================================

import { tpfaFlux } from './tpfa.js';
import { accumulation } from './accumulation.js';

/** Assemble global residual. @returns {Float64Array} */
export function assembleResidual(/* model, stateNew, stateOld, dt */) {
  // R_c,i = ACC^{n+1} - ACC^{n} - dt·(sum flux + well source)
  tpfaFlux; accumulation; // composed here
  return new Float64Array(0);
}
