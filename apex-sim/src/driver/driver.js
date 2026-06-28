// ===========================================================================
// apex-sim · driver/driver
// ---------------------------------------------------------------------------
// Top-level orchestration: build the model from a deck, equilibrate, then run the SCHEDULE time loop with adaptive dt, writing summary/restart.
// ===========================================================================

import { Tuning } from '../timestep/adaptive.js';
import { fullyImplicitStep } from '../timestep/fullyimplicit.js';
import { SummaryWriter } from '../io/summary.js';

/**
 * Run a full simulation from a parsed deck + config.
 * @returns {{summary: SummaryWriter}}
 */
export function run(model, config) {
  const tuning = new Tuning(config.tuning);
  const summary = new SummaryWriter();
  let { state, schedule } = model;        // from init + io
  let dt = config.tuning?.dtInit ?? 1.0;

  for (const period of schedule ?? []) {
    let t = period.start;
    while (t < period.end) {
      dt = Math.min(dt, period.end - t);
      const res = fullyImplicitStep(model, state, dt, { solve: config.solve });
      if (res.converged) { state = res.state; t += dt; /* summary.record(t, sample) */ }
      dt = tuning.nextDt(dt, res);
    }
  }
  return { summary };
}
