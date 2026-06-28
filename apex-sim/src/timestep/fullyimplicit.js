// ===========================================================================
// apex-sim · timestep/fullyimplicit
// ---------------------------------------------------------------------------
// Fully-implicit (FIM) step: one coupled Newton solve via nonlinear/newton.
// ===========================================================================

import { newton } from '../nonlinear/newton.js';
export function fullyImplicitStep(model, state, dt, opts) { return newton(model, state, dt, opts); }
