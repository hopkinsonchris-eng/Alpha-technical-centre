// ===========================================================================
// apex-sim · nonlinear/appleyard
// ---------------------------------------------------------------------------
// Appleyard chopping: limit per-iteration changes in saturation and Rs/Rv across phase boundaries to stabilize Newton.
// ===========================================================================

/** Clip a Newton update in-place per Appleyard rules. */
export function applyChopping(/* dx, state, limits */) {
  // TODO: cap dS, and damp Rs/Rv crossing the bubble/dew point.
}
