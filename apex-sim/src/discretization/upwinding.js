// ===========================================================================
// apex-sim · discretization/upwinding
// ---------------------------------------------------------------------------
// Phase-potential upwinding: choose mobility from the upstream cell per phase (handles counter-current gravity terms).
// ===========================================================================

/** @returns {{mob:number, dmob:object, upstream:0|1}} */
export function upwindMobility(potentialDiff, mobI, mobJ) {
  const upstream = potentialDiff >= 0 ? 0 : 1;
  return { mob: upstream === 0 ? mobI.value : mobJ.value, dmob: {}, upstream };
}
