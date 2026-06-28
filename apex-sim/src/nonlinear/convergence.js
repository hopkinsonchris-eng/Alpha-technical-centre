// ===========================================================================
// apex-sim · nonlinear/convergence
// ---------------------------------------------------------------------------
// Convergence criteria: scaled component residual (CNV) and material-balance (MB) errors, ECLIPSE-style.
// ===========================================================================

/** @returns {{converged:boolean, cnv:number[], mb:number[]}} */
export function checkConvergence(/* R, model, dt, tols */) {
  // TODO: CNV_c = max|R_c|/(pv·...), MB_c = sum|R_c|/(...)
  return { converged: false, cnv: [], mb: [] };
}
