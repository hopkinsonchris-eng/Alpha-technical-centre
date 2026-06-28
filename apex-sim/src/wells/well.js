// ===========================================================================
// apex-sim · wells/well
// ---------------------------------------------------------------------------
// Well aggregate: connections (perforations), control, optional segments. Produces well-equation residual/Jacobian contributions.
// ===========================================================================

export class Well {
  /** @param {{name:string, connections:Array, control:object, type:'PROD'|'INJ'}} spec */
  constructor(spec) { Object.assign(this, spec); }
  /** Inflow per connection and the well-control equation. */
  equations(/* reservoirState */) { /* TODO */ return { residual: [], deriv: {} }; }
}
