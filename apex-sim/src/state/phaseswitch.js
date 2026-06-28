// ===========================================================================
// apex-sim · state/phaseswitch
// ---------------------------------------------------------------------------
// Variable/phase switching: pick the active primary (Rs vs Sg in oil cells, Rv vs So in gas cells) based on saturation/saturation-pressure.
// ===========================================================================

export const PhaseState = Object.freeze({ OIL_GAS: 0, OIL_ONLY: 1, GAS_ONLY: 2, WATER_ONLY: 3 });

/** Decide phase state per cell and the active primary set. */
export function switchVariables(/* state, pvt */) {
  // TODO: appearance/disappearance of free gas / oil; set phaseState + Rs/Rv.
}
