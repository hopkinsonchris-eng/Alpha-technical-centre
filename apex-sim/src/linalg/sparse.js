// ===========================================================================
// apex-sim · linalg/sparse
// ---------------------------------------------------------------------------
// Sparse matrix assembly (block-CSR) for the Jacobian, plus mat-vec used by the Krylov solvers.
// ===========================================================================

export class SparseMatrix {
  /** @param {number} n rows (= blocks · blockSize) */
  constructor(n, blockSize = 1) { this.n = n; this.blockSize = blockSize; this.rows = Array.from({ length: n }, () => new Map()); }
  add(i, j, v) { this.rows[i].set(j, (this.rows[i].get(j) ?? 0) + v); }
  /** y = A·x */
  matvec(x) {
    const y = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) { let s = 0; for (const [j, v] of this.rows[i]) s += v * x[j]; y[i] = s; }
    return y;
  }
}
