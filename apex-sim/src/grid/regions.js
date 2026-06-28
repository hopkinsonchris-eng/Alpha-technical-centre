// ===========================================================================
// apex-sim · grid/regions
// ---------------------------------------------------------------------------
// Region partitions: FIPNUM/SATNUM/PVTNUM/EQLNUM etc. Each cell carries its region ids so rock/pvt/scal/init look up the right tables.
// ===========================================================================

export const REGION_KINDS = ['SATNUM', 'PVTNUM', 'EQLNUM', 'FIPNUM', 'PVTNUM'];

export class Regions {
  constructor(nCells) { this.maps = {}; this.nCells = nCells; }
  set(kind, arr) { this.maps[kind] = arr; }
  get(kind, cell) { return (this.maps[kind]?.[cell]) ?? 1; }
}
