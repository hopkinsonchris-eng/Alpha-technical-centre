// ===========================================================================
// apex-sim · state/restart
// ---------------------------------------------------------------------------
// Restart serialization: snapshot/restore full solver state to resume a run.
// ===========================================================================

export function snapshot(state, meta) { return { meta, ...serialize(state) }; }
export function restore(/* blob */) { /* TODO */ return null; }
function serialize(state) { return { P: Array.from(state.P), Sw: Array.from(state.Sw), Sg: Array.from(state.Sg), Rs: Array.from(state.Rs), Rv: Array.from(state.Rv) }; }
