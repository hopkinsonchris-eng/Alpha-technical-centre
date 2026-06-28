// ===========================================================================
// apex-sim · wells/peaceman
// ---------------------------------------------------------------------------
// Peaceman well index: equivalent radius and WI for vertical/anisotropic cells. See docs/physics/wells.md.
// ===========================================================================

import { C_D } from '../core/constants.js';

/** Peaceman equivalent radius (anisotropic). */
export function equivalentRadius(dx, dy, kx, ky) {
  const a = Math.sqrt(ky / kx), b = Math.sqrt(kx / ky);
  return 0.28 * Math.sqrt(a * dx * dx + b * dy * dy) / (Math.sqrt(a) + Math.sqrt(b));
}

/** Well index for one connection. */
export function wellIndex({ kh, re, rw, skin = 0 }) {
  return (2 * Math.PI * C_D * kh) / (Math.log(re / rw) + skin);
}
