# Changelog

All notable changes to apex-sim are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/); the project aims for SemVer once
the first benchmark passes.

## [Unreleased]

### Added
- Initial project scaffold: full `src/` module tree, `docs/` (architecture +
  physics derivations + benchmark protocols), `test/` (unit/analytic/regression),
  `benchmark/` (decks/reference/compare), `apps/apex` CLI, and `viz/`.
- Each module ships as a documented stub declaring its intended public surface.

### Carried over from the prototype
- The "every number traceable" discipline: derivations in `docs/physics/`,
  golden-output regression tests, and a benchmark compare harness (heir to
  `physics_harness.js`).
