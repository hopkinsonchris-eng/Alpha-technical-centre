// ===========================================================================
// apex-sim · nonlinear/newton
// ---------------------------------------------------------------------------
// Newton loop: assemble J,R → solve → globalize/chop → update → check. The heart of a fully-implicit step.
// ===========================================================================

import { assembleJacobian } from './jacobian.js';
import { checkConvergence } from './convergence.js';
import { applyChopping } from './appleyard.js';
import { backtrack } from './linesearch.js';

/** @returns {{converged:boolean, iters:number, state:object}} */
export function newton(model, state, dt, { maxIter = 12, solve } = {}) {
  for (let it = 0; it < maxIter; it++) {
    const { J, R } = assembleJacobian(model, state, dt);
    const conv = checkConvergence(R, model, dt);
    if (conv.converged) return { converged: true, iters: it, state };
    const dx = solve(J, R);               // linalg/krylov + cpr
    const alpha = backtrack(0, state, dx);
    applyChopping(dx, state);
    void alpha; // state update applied here (TODO)
  }
  return { converged: false, iters: maxIter, state };
}
