// ===========================================================================
// apex-sim · linalg/preconditioners
// ---------------------------------------------------------------------------
// Preconditioners. CPR (Constrained Pressure Residual) is the workhorse for reservoir Jacobians: AMG on the pressure block + ILU smoother on the full system. Also plain ILU(0)/Jacobi.
// ===========================================================================

/** Build a CPR preconditioner apply operator from a block Jacobian. */
export function cpr(A, { /* pressureWeights, amg, smoother */ } = {}) {
  // TODO: decouple pressure (true-IMPES/quasi-IMPES), AMG V-cycle, then
  // global ILU(0) smoothing. Return function r -> z.
  void A;
  return (r) => r.slice();
}

export function ilu0(A) { void A; return (r) => r.slice(); }
export function jacobi(A) { void A; return (r) => r.slice(); }
