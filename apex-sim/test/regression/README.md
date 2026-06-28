# Regression — golden outputs

Heir to the prototype's audit. Each entry stores a frozen reference output for a
small deterministic case; the test re-runs and diffs against it within tolerance.

- `golden/` — committed reference summary/restart snapshots.
- A change to a golden file must be deliberate and explained in `CHANGELOG.md`.
