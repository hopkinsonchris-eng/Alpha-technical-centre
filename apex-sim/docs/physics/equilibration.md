# Equilibration (EQUIL)

Initial conditions are set to capillary–gravity equilibrium rather than a flat
guess, so the simulation starts in (near) steady state.

## Hydrostatic pressure

Integrate `dP/dz = ρ(P, z) g` from the datum pressure downward, with phase
densities from PVT. Done per equilibration region.

## Contacts

`WOC` and `GOC` set the reference depths where phase pressures equal. Capillary
pressure shifts the actual saturation fronts relative to the free-fluid contacts.

## Dissolved/vaporized ratios with depth

`Rs(z)` and `Rv(z)` may vary with depth (RSVD / RVVD tables) — important for
under-saturated columns. `init/equilibration` integrates these alongside P.

## Output

Per cell: `P`, `Sw`, `Sg` (hence `So`), `Rs`, `Rv` — the initial
`state/ReservoirState`. Checked in `test/analytic/gravity_segregation`.
