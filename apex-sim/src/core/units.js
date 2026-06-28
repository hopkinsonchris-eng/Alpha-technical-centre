// ===========================================================================
// apex-sim · core/units
// ---------------------------------------------------------------------------
// Unit systems (FIELD / METRIC / LAB) and conversion helpers. The solver works in a single internal system; IO converts at the boundary.
// ===========================================================================

export const Systems = Object.freeze({ FIELD: 'FIELD', METRIC: 'METRIC', LAB: 'LAB' });

// Conversion factors keyed by quantity, into internal (FIELD) units.
const FACTORS = {
  // TODO: fill from docs as needed; identity for FIELD.
};

export function convert(value, _quantity, _from, _to) {
  // TODO: implement unit conversion table.
  return value;
}
