// ===========================================================================
// apex-sim · scal/threephase
// ---------------------------------------------------------------------------
// Three-phase oil relperm models (Stone I, Stone II, Baker linear interpolation) combining two-phase ow and og data.
// ===========================================================================

export const Models = Object.freeze({ STONE1: 'STONE1', STONE2: 'STONE2', BAKER: 'BAKER' });

/** Three-phase oil kr from two-phase curves. @returns {{kro:number, dkro:object}} */
export function threePhaseOilKr(model, /* krow, krog, Sw, Sg, params */) {
  // TODO implement STONE1/STONE2/BAKER per model.
  return { kro: 0, dkro: {} };
}
