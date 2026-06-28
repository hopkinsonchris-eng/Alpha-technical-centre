// ===========================================================================
// apex-sim · scal/capillary
// ---------------------------------------------------------------------------
// Capillary pressure Pc(S) from SWOF/SGOF, with derivatives. Used in fluxes and in init/equilibration to place saturation fronts.
// ===========================================================================

export function capillaryPressure(/* table, S */) {
  // TODO interpolate Pc(S) and dPc/dS.
  return { pc: 0, dpc_dS: 0 };
}
