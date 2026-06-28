// ===========================================================================
// apex-sim · timestep/adaptive
// ---------------------------------------------------------------------------
// Adaptive dt control (TUNING): grow/cut dt from Newton iteration count and max solution change; honor report/limit dates.
// ===========================================================================

export class Tuning {
  constructor(opts = {}) {
    this.dtMin = opts.dtMin ?? 0.01;
    this.dtMax = opts.dtMax ?? 365;
    this.grow = opts.grow ?? 1.25;
    this.cut = opts.cut ?? 0.5;
    this.targetNewton = opts.targetNewton ?? 6;
  }
  /** Suggest next dt from last step outcome. */
  nextDt(dt, { converged, iters }) {
    if (!converged) return Math.max(this.dtMin, dt * this.cut);
    const f = iters <= this.targetNewton ? this.grow : 1.0;
    return Math.min(this.dtMax, dt * f);
  }
}
