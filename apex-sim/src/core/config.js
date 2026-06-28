// ===========================================================================
// apex-sim · core/config
// ---------------------------------------------------------------------------
// Run configuration object: merges deck-derived settings with CLI/defaults. Single source of truth handed to the driver.
// ===========================================================================

export const DEFAULTS = Object.freeze({
  units: 'FIELD',
  method: 'fully-implicit',   // 'impes' | 'sequential' | 'fully-implicit'
  linearSolver: 'gmres',      // 'gmres' | 'bicgstab'
  preconditioner: 'cpr',
  tuning: {},                 // see timestep/adaptive
});

export function makeConfig(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}
