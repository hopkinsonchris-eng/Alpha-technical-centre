// ===========================================================================
// apex-sim · scal/hysteresis
// ---------------------------------------------------------------------------
// Saturation hysteresis (Killough/Carlson): drainage vs. imbibition scanning curves with reversal/trapping state.
// ===========================================================================

export class HysteresisModel {
  constructor({ model = 'Killough' } = {}) { this.model = model; }
  /** @returns {{kr:number, dkr_dS:number}} */
  eval(/* S, history */) { /* TODO scanning curve */ return { kr: 0, dkr_dS: 0 }; }
}
