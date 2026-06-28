// ===========================================================================
// apex-sim · grid/cartesian
// ---------------------------------------------------------------------------
// Structured Cartesian (box) grid: cell centers, volumes, depths, and the face connectivity that downstream transmissibility uses.
// ===========================================================================

export class CartesianGrid {
  /** @param {{nx:number,ny:number,nz:number,dx:number,dy:number,dz:number,depth?:number}} spec */
  constructor(spec) {
    this.spec = spec;
    this.nCells = spec.nx * spec.ny * spec.nz;
    // TODO: build cell centers, volumes, and i-j-k <-> index maps.
  }
  /** @returns {Array<{i:number,j:number,area:number,d_i:number,d_j:number}>} */
  faces() { /* TODO: enumerate internal faces */ return []; }
}
