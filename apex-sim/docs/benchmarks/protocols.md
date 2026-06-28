# Benchmark protocols

For each deck: run apex-sim, export the summary vectors, and compare against the
reference simulator's summary on a common time grid.

## Decks

| Deck   | Tests | Reference |
|--------|-------|-----------|
| SPE1   | basic black-oil, gas injection | ECLIPSE / OPM |
| SPE3   | gas cycling, condensate | ECLIPSE |
| SPE9   | many wells, group control, heterogeneity | ECLIPSE |
| SPE10  | fine-scale, two-phase, solver stress | OPM |
| Egg    | ensemble waterflood, channelized | OPM |
| Norne  | real field, corner-point, faults | OPM |

## Compared quantities

- Field rates/totals: FOPR, FGPR, FWPR, FWIR, FGIR, FPR.
- Per-well: WBHP, WOPR, WWCT, WGOR.
- Tolerances per metric in `benchmark/compare/` (relative L2 + peak error).

## Procedure

1. `node apps/apex/cli.js benchmark/decks/<deck>.DATA`
2. `node benchmark/compare/compare.js --deck <deck>`
3. Record metrics + plots in `docs/benchmarks/results.md`.
