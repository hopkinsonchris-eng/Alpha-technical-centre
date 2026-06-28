# apps/apex — CLI

Thin command-line wrapper over `src/driver`. Parses a deck, builds the model,
runs the schedule, and writes results.

```bash
node apps/apex/cli.js run benchmark/decks/SPE1.DATA --out out/spe1
node apps/apex/cli.js --help
```

Scaffold: argument parsing and the help text are wired; model construction and
the run itself are `TODO` (see `src/driver/driver.js`).
