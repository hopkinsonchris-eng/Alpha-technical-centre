// ===========================================================================
// apex-sim · grid/unstructured
// ---------------------------------------------------------------------------
// General unstructured/polyhedral grid (future): explicit cells, faces, and geometry for fully unstructured discretizations.
// ===========================================================================

export class UnstructuredGrid {
  constructor({ cells = [], faces = [], nodes = [] } = {}) {
    Object.assign(this, { cells, faces, nodes });
    // TODO: face areas/normals/centroids; cell volumes/centroids.
  }
}
