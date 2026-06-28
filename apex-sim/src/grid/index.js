// ===========================================================================
// apex-sim · grid
// ---------------------------------------------------------------------------
// Grid module barrel: geometry, connectivity, NNCs, faults, regions.
// ===========================================================================

export { CartesianGrid } from './cartesian.js';
export { CornerPointGrid } from './cornerpoint.js';
export { UnstructuredGrid } from './unstructured.js';
export { NNC, buildNNCs } from './nnc.js';
export { Fault, applyFaultMultipliers } from './faults.js';
export { Regions, REGION_KINDS } from './regions.js';
