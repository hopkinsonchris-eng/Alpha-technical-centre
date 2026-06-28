// ===========================================================================
// apex-sim · nonlinear/linesearch
// ---------------------------------------------------------------------------
// Line search / globalization for the Newton update (backtracking on residual norm) to improve robustness far from the solution.
// ===========================================================================

/** @returns {number} step length alpha in (0,1]. */
export function backtrack(residualNorm, /* state, dx, evalResidual */) {
  // TODO: reduce alpha until ||R(x + alpha dx)|| < ||R(x)||.
  void residualNorm;
  return 1.0;
}
