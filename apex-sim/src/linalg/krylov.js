// ===========================================================================
// apex-sim · linalg/krylov
// ---------------------------------------------------------------------------
// Krylov linear solvers: GMRES and BiCGStab, both taking a preconditioner apply (e.g. CPR) as an operator.
// ===========================================================================

/** Restarted GMRES. @returns {{x:Float64Array, iters:number, residual:number}} */
export function gmres(A, b, { precond, tol = 1e-6, maxIter = 200, restart = 30 } = {}) {
  // TODO: Arnoldi + Givens rotations with right preconditioning.
  void [A, b, precond, tol, maxIter, restart];
  return { x: new Float64Array(b.length), iters: 0, residual: Infinity };
}

/** BiCGStab. */
export function bicgstab(A, b, { precond, tol = 1e-6, maxIter = 200 } = {}) {
  void [A, b, precond, tol, maxIter];
  return { x: new Float64Array(b.length), iters: 0, residual: Infinity };
}
