# Tests

- `unit/` — per-module behavior in isolation.
- `analytic/` — verification against closed-form solutions (the truth standard).
- `regression/` — golden outputs; the heir to the prototype's audit.

Run all:

```bash
node test/run.js
```

Each test file exports `async function run()` and throws on failure. Stubs that
don't export `run()` are reported as skipped.
