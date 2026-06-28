// ===========================================================================
// apex-sim · benchmark/compare/metrics
// ---------------------------------------------------------------------------
// Error metrics for benchmark comparison: relative L2 and peak error on resampled, time-aligned vectors.
// ===========================================================================

/** Relative L2 error of `sim` against `ref` (same length). */
export function relL2(sim, ref) {
  let num = 0, den = 0;
  for (let i = 0; i < ref.length; i++) { const d = sim[i] - ref[i]; num += d * d; den += ref[i] * ref[i]; }
  return den > 0 ? Math.sqrt(num / den) : (num === 0 ? 0 : Infinity);
}

/** Peak absolute and relative error. */
export function peak(sim, ref) {
  let absMax = 0, relMax = 0;
  for (let i = 0; i < ref.length; i++) {
    const a = Math.abs(sim[i] - ref[i]); absMax = Math.max(absMax, a);
    if (ref[i] !== 0) relMax = Math.max(relMax, a / Math.abs(ref[i]));
  }
  return { absMax, relMax };
}

export function metrics(sim, ref) { return { relL2: relL2(sim, ref), ...peak(sim, ref) }; }
