// ===========================================================================
// apex-sim · rock/transmissibility
// ---------------------------------------------------------------------------
// Geometric + rock transmissibility for a face: harmonic average of the two half-transmissibilities, with MULT* and fault multipliers. See docs/physics/discretization.md.
// ===========================================================================

/**
 * Half-transmissibility of cell side facing a connection.
 * @returns {number}
 */
export function halfTrans(perm, area, dCell, C_D) {
  // T_half = C_D · k · A / d   (d: center-to-face distance projected on normal)
  return (C_D * perm * area) / dCell;
}

/** Harmonic combination of two half-transmissibilities, times multipliers. */
export function faceTransmissibility(tHalfA, tHalfB, mult = 1.0) {
  if (tHalfA <= 0 || tHalfB <= 0) return 0;
  return mult / (1 / tHalfA + 1 / tHalfB);
}
