# apex-sim — Architecture

This document is the living version of the original proposal. It describes *what*
each layer does, *why* it is separated, and the data that flows between them.

## Design goals

1. **Auditable physics.** Every governing equation has a note in `docs/physics/`
   and a test in `test/analytic/` against a closed-form solution.
2. **Deck compatibility.** Read enough of the ECLIPSE keyword language to run the
   standard benchmarks unmodified (`benchmark/decks/`).
3. **Separable numerics.** Discretization, linearization (Newton + AD), and the
   linear solver (Krylov + CPR) are independent and individually testable.
4. **No magic.** Plain ES modules, explicit units (field/SI via `core/units`),
   explicit constants (`core/constants`, e.g. the Darcy field constant `C_D`).

## Data flow (one simulation)

```
deck file ──io/deckparser──▶ config + keyword tables
   │
   ├─ grid/        build geometry, transmissibilities (rock + grid)
   ├─ rock/        poro/perm/NTG → cell props
   ├─ pvt/         PVT tables → fluid properties f(P, Rs, Rv)
   ├─ scal/        kr/Pc tables → saturation functions
   ├─ init/        EQUIL → initial P, Sw, Sg, Rs(z), Rv(z)
   │
   ▼
driver/  ── time loop ──┐
   │                    │  per step:
   │  timestep/  pick dt + method (IMPES/sequential/FIM)
   │  nonlinear/ Newton: assemble residual + AD Jacobian
   │     discretization/  TPFA fluxes, upwinding, accumulation
   │     wells/           well equations (Peaceman WI, controls)
   │  linalg/    solve J·δx = −R  (GMRES/BiCGStab + CPR)
   │  state/     update primaries, phase switching
   └────────────────────┘
   │
   ▼
io/  ── summary / restart / grid writers ──▶ viz/ (post/QC)
```

## Module responsibilities

| Layer | Responsibility | Key abstractions |
|-------|----------------|------------------|
| `core` | units, constants, config, logging, shared types | `Units`, `C_D`, `Config` |
| `grid` | cell geometry, connectivity, NNCs, faults, regions | `Grid`, `Connection` |
| `rock` | static cell properties + transmissibility | `RockModel`, `transmissibility()` |
| `pvt` | fluid PVT (black-oil now, EOS later) | `BlackOilPVT` |
| `scal` | relative permeability + capillary pressure | `SaturationFunctions` |
| `init` | equilibration to hydrostatic initial state | `equilibrate()` |
| `discretization` | residual/Jacobian contributions from flow | `TPFA`, `upwind()` |
| `wells` | well model, controls, groups, network | `Well`, `WellControl` |
| `linalg` | sparse assembly + linear solve | `SparseMatrix`, `cpr()` |
| `nonlinear` | Newton loop with AD + globalization | `newton()`, `AD` |
| `timestep` | method selection + adaptive dt | `Stepper`, `Tuning` |
| `state` | primary variables + restart | `ReservoirState` |
| `io` | deck in, results out | `parseDeck()`, writers |
| `driver` | orchestration | `run()` |

## Roadmap

- M1 — single-phase, single-well radial drawdown (analytic check).
- M2 — Buckley–Leverett 1D two-phase (analytic check).
- M3 — SPE1 black-oil to within reference tolerance.
- M4 — SPE9 (wells/groups), then Egg/Norne.
- M5 — MPFA, compositional (EOS), CPR tuning.
