// ===========================================================================
// apex-sim · grid/faults
// ---------------------------------------------------------------------------
// Fault definitions and transmissibility multipliers (FAULTS/MULTFLT). Faults may seal, partially seal, or create across-fault NNCs.
// ===========================================================================

export class Fault {
  /** @param {string} name @param {number} multflt */
  constructor(name, multflt = 1.0) { this.name = name; this.multflt = multflt; this.faces = []; }
}
/** Apply MULTFLT to face transmissibilities. */
export function applyFaultMultipliers(/* faults, trans */) { /* TODO */ }
