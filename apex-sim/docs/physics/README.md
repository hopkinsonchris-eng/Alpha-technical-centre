# Physics derivations

Each note derives the equations a module implements, in field units unless noted,
with the discretized form actually coded. A module's `TODO` comments cite the note
here; a benchmark in `test/analytic/` checks the implementation.

- `discretization.md` — mass balance, TPFA, phase-potential upwinding, accumulation.
- `wells.md` — Peaceman well index, BHP/rate controls, VFP, multi-segment.
- `pvt.md` — black-oil formulation: Bo, Bw, Bg, Rs, Rv, viscosities, undersaturation.
- `equilibration.md` — hydrostatic equilibrium, contacts, Rs(z)/Rv(z), capillary.
