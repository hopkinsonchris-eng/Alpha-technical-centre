// ===========================================================================
// apex-sim · io/summary
// ---------------------------------------------------------------------------
// Summary writer: time-series vectors (FOPR, WBHP, ...) for post-processing and benchmark comparison. JSON/CSV now; UNSMRY later.
// ===========================================================================

export class SummaryWriter {
  constructor() { this.vectors = {}; this.time = []; }
  record(t, sample) { this.time.push(t); for (const k in sample) (this.vectors[k] ??= []).push(sample[k]); }
  toJSON() { return { time: this.time, vectors: this.vectors }; }
}
