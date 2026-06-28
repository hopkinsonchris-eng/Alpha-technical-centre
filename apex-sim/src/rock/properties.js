// ===========================================================================
// apex-sim · rock/properties
// ---------------------------------------------------------------------------
// Static cell properties: porosity, permeability tensor, NTG. Assembled from deck arrays (PORO/PERMX.../NTG) plus any region multipliers.
// ===========================================================================

export class RockModel {
  /** @param {{poro:Float64Array,permX:Float64Array,permY?:Float64Array,permZ?:Float64Array,ntg?:Float64Array}} a */
  constructor(a) {
    this.poro = a.poro;
    this.permX = a.permX;
    this.permY = a.permY ?? a.permX;
    this.permZ = a.permZ ?? a.permX;
    this.ntg = a.ntg ?? a.poro.map(() => 1.0);
  }
  poreVolume(cell, bulkVolume) { return bulkVolume * this.poro[cell] * this.ntg[cell]; }
}
