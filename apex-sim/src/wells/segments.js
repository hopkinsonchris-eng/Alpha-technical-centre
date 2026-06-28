// ===========================================================================
// apex-sim · wells/segments
// ---------------------------------------------------------------------------
// Multi-segment wells: segment topology, pressure drop correlations, and cross-flow between segments/connections.
// ===========================================================================

export class MultiSegmentWell {
  constructor({ segments = [], topology = [] } = {}) { Object.assign(this, { segments, topology }); }
  /** Segment pressure drops (hydrostatic + friction + acceleration). */
  pressureDrops(/* state */) { /* TODO */ return []; }
}
