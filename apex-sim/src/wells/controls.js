// ===========================================================================
// apex-sim · wells/controls
// ---------------------------------------------------------------------------
// Well controls: BHP / surface-rate / reservoir-rate targets with automatic constraint switching. VFP lookup for tubing-head conditions.
// ===========================================================================

export const ControlMode = Object.freeze({ BHP: 'BHP', ORAT: 'ORAT', WRAT: 'WRAT', GRAT: 'GRAT', LRAT: 'LRAT', RESV: 'RESV' });

export class WellControl {
  constructor({ mode, target, limits = {} }) { Object.assign(this, { mode, target, limits }); }
  /** Decide active control given current solution (switch if limit hit). */
  resolve(/* wellState */) { /* TODO constraint switching */ return this.mode; }
}
