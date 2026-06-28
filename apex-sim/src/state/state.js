// ===========================================================================
// apex-sim · state/state
// ---------------------------------------------------------------------------
// ReservoirState: the primary-variable arrays (P, Sw, Sg, Rs, Rv) plus phase presence flags. Cloned per timestep (n vs n+1).
// ===========================================================================

export class ReservoirState {
  constructor(nCells) {
    this.nCells = nCells;
    this.P = new Float64Array(nCells);
    this.Sw = new Float64Array(nCells);
    this.Sg = new Float64Array(nCells);
    this.Rs = new Float64Array(nCells);
    this.Rv = new Float64Array(nCells);
    this.phaseState = new Uint8Array(nCells); // see phaseswitch
  }
  clone() { const s = new ReservoirState(this.nCells); for (const k of ['P','Sw','Sg','Rs','Rv','phaseState']) s[k].set(this[k]); return s; }
}
