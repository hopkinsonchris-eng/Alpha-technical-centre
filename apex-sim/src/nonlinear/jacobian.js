// ===========================================================================
// apex-sim · nonlinear/jacobian
// ---------------------------------------------------------------------------
// Assemble the sparse Jacobian J = ∂R/∂x from AD-typed residual evaluation.
// ===========================================================================

import { SparseMatrix } from '../linalg/sparse.js';

/** @returns {{J:SparseMatrix, R:Float64Array}} */
export function assembleJacobian(/* model, state, dt */) {
  // TODO: evaluate residual with AD primaries, scatter derivatives into J.
  return { J: new SparseMatrix(0), R: new Float64Array(0) };
}
