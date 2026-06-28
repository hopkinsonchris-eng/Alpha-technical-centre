// ===========================================================================
// apex-sim · discretization/accumulation
// ---------------------------------------------------------------------------
// Accumulation (storage) term: per-cell component mass and its time derivative (backward Euler). See docs/physics/discretization.md.
// ===========================================================================

/** @returns {{acc:number[], deriv:object}} component accumulation for a cell. */
export function accumulation(/* cell, state, rock, pvt */) {
  // ACC_c = Vp · sum_p ( b_p S_p R_{c,p} )
  return { acc: [0, 0, 0], deriv: {} };
}
