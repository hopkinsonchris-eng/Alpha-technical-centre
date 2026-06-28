# apex-sim

A black-oil (→ compositional) reservoir simulator, ECLIPSE-deck compatible, built
as the engineering successor to the in-browser **APEX Reservoir 3D** prototype
(`reservoir-simulator.html`) of the Alpha Technical Centre.

The aim is a small, auditable, physically-honest simulator that reproduces the
standard benchmarks (SPE1/3/9/10, Egg, Norne) against tNavigator / ECLIPSE / OPM
references — and keeps the discipline of the prototype: every number traceable to
a derivation in `docs/physics/` and a test in `test/`.

## Layout

```
src/core          types, units, constants, config, logging
src/grid          cartesian → corner-point → unstructured; NNCs, faults, regions
src/rock          poro, perm, NTG, rock compressibility, transmissibility mults
src/pvt           black-oil tables (PVTO/PVTW/PVTG) → later EOS for compositional
src/scal          kr, Pc, end-point scaling, hysteresis, 3-phase (Stone/Baker)
src/init          equilibration (EQUIL): contacts, hydrostatic P, Rs(z)/Rv(z)
src/discretization TPFA (→MPFA), phase-potential upwinding, residual + accumulation
src/wells         Peaceman WI, controls (BHP/rate/VFP), multi-segment, groups, network
src/linalg        sparse assembly, Krylov (GMRES/BiCGStab), preconditioners (CPR)
src/nonlinear     Newton, AD Jacobian, line search, Appleyard chopping, convergence
src/timestep      IMPES / sequential / fully-implicit / adaptive; dt control, TUNING
src/state         primary variables, phase switching, restart
src/io            deck parser (ECLIPSE keywords) + summary/restart/grid writers
src/driver        main loop / orchestration
apps/apex         the CLI executable
viz               the repurposed HTML front-end (pre/post/QC)
test              unit · analytic · regression
benchmark         decks · reference results · compare harness
```

## Status

Scaffold. Every module is a documented stub with the intended public surface and
`TODO` markers pointing at the relevant physics note. See `CHANGELOG.md`.

## Running

```bash
node apps/apex/cli.js --help        # CLI entry point (stub)
node test/run.js                    # test harness (stub)
node benchmark/compare/compare.js   # benchmark comparison (heir to physics_harness.js)
```

No build step. Plain ES modules, Node ≥ 18.
