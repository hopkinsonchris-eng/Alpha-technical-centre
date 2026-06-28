// ===========================================================================
// apex-sim · core/constants
// ---------------------------------------------------------------------------
// Physical and unit-system constants. C_D is the Darcy field constant used throughout transmissibility and well-index calculations.
// ===========================================================================

// Darcy field constant: q[STB/d] = C_D · k[mD]·A·ΔP / (μ·L) form.
// 0.001127 for field units (md, ft, cp, psi, rb/day).
export const C_D = 0.001127;

// Gravity / hydrostatic gradient constant for field units (psi/(lb/ft3·ft)).
export const GRAV_FIELD = 0.00694;

export const STANDARD_PRESSURE_PSI = 14.696;
export const STANDARD_TEMPERATURE_F = 60.0;

export const PHASES = Object.freeze(['oil', 'water', 'gas']);
export const COMPONENTS = Object.freeze(['oil', 'water', 'gas']);
