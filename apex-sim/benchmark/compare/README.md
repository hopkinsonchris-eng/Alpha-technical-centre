# compare — benchmark harness

Heir to the prototype's `physics_harness.js`. Compares apex-sim summary output
against reference-simulator results.

```bash
node benchmark/compare/compare.js --deck SPE1 \
  --sim out/spe1/summary.json \
  --ref ../reference/SPE1/opm-2024.10/summary.json
```

- `metrics.js` — relative L2 + peak error.
- Tolerances and pass/fail recorded in `docs/benchmarks/results.md`.
