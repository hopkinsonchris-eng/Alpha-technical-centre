// ===========================================================================
// apex-sim · nonlinear/ad
// ---------------------------------------------------------------------------
// Forward-mode automatic differentiation (dual numbers) used to build the exact Jacobian from the residual code.
// ===========================================================================

/** Dual number: value + partial derivatives wrt active primaries. */
export class AD {
  constructor(value, deriv = {}) { this.v = value; this.d = deriv; }
  static c(value) { return new AD(value, {}); }
  static x(value, key) { return new AD(value, { [key]: 1 }); }
  add(o) { return new AD(this.v + o.v, combine(this.d, o.d, 1, 1)); }
  mul(o) { return new AD(this.v * o.v, combine(this.d, o.d, o.v, this.v)); }
}
function combine(a, b, sa, sb) {
  const out = {};
  for (const k in a) out[k] = (out[k] ?? 0) + sa * a[k];
  for (const k in b) out[k] = (out[k] ?? 0) + sb * b[k];
  return out;
}
