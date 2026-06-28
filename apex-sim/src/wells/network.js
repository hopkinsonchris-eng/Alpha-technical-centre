// ===========================================================================
// apex-sim · wells/network
// ---------------------------------------------------------------------------
// Surface network: couples well tubing-heads through a pipe/node network to a separator/export node (future).
// ===========================================================================

export class SurfaceNetwork {
  constructor({ nodes = [], branches = [] } = {}) { Object.assign(this, { nodes, branches }); }
  solve(/* wellTHPs */) { /* TODO network balance */ }
}
