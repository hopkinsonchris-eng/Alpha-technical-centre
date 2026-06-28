// ===========================================================================
// apex-sim · grid/nnc
// ---------------------------------------------------------------------------
// Non-neighbor connections: extra cell-to-cell connections (faults, LGRs, pinch-outs) beyond the structured neighbor stencil.
// ===========================================================================

export class NNC {
  /** @param {number} c1 @param {number} c2 @param {number} trans */
  constructor(c1, c2, trans) { Object.assign(this, { c1, c2, trans }); }
}
/** Build NNC list from explicit deck NNC keyword or geometry. @returns {NNC[]} */
export function buildNNCs(/* grid, deck */) { return []; }
