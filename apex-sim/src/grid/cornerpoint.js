// ===========================================================================
// apex-sim · grid/cornerpoint
// ---------------------------------------------------------------------------
// Corner-point geometry (ZCORN/COORD pillars): the ECLIPSE-standard format for faulted, non-orthogonal reservoir grids.
// ===========================================================================

export class CornerPointGrid {
  /** @param {{COORD:Float64Array, ZCORN:Float64Array, DIMENS:number[]}} g */
  constructor(g) {
    this.g = g;
    // TODO: decode pillars + corner depths into cell geometry and faces;
    // detect pinch-outs and across-fault connections (-> grid/faults, grid/nnc).
  }
  faces() { return []; }
}
