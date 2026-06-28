// ===========================================================================
// apex-sim · init/equilibration
// ---------------------------------------------------------------------------
// Equilibration (EQUIL): integrates hydrostatic pressure, places contacts (WOC/GOC), and applies Rs(z)/Rv(z). See docs/physics/equilibration.md.
// ===========================================================================

/**
 * Compute initial reservoir state at capillary-gravity equilibrium.
 * @returns {import('../state/state.js').ReservoirState}
 */
export function equilibrate(/* grid, rock, pvt, scal, equilSpec */) {
  // TODO: per EQLNUM region:
  //  1. integrate dP/dz = rho(P,z) g from datum
  //  2. set phase pressures, apply Pc to find Sw, Sg at each depth
  //  3. interpolate Rs(z)/Rv(z) (RSVD/RVVD)
  return null;
}
