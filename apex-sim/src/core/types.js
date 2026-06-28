// ===========================================================================
// apex-sim · core/types
// ---------------------------------------------------------------------------
// Shared type definitions (JSDoc typedefs) used across modules. Kept in one place so the public surfaces stay consistent.
// ===========================================================================

/**
 * @typedef {Object} CellProps
 * @property {number} poro  porosity (fraction)
 * @property {number} permX absolute permeability x (mD)
 * @property {number} permY
 * @property {number} permZ
 * @property {number} ntg   net-to-gross (fraction)
 */

/**
 * @typedef {Object} PhaseState
 * @property {number} P  pressure (psi)
 * @property {number} Sw water saturation
 * @property {number} Sg gas saturation
 * @property {number} Rs solution GOR
 * @property {number} Rv vaporized OGR
 */

export {}; // typedef-only module
