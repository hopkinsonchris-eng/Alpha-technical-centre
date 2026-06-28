# Wells

## Peaceman well index

For a vertical well in a Cartesian cell, the (rock) well index:

    WI = (2π · C_D · K·h) / ( ln(r_e / r_w) + S )

- `r_e` — Peaceman equivalent radius. Isotropic square cell: `r_e ≈ 0.28·√(dx²+dy²)`.
  Anisotropic form uses `kx,ky` and `dx,dy` (implemented in `wells/peaceman`).
- `S` — skin. `C_D` — Darcy field constant (`core/constants`).

## Inflow

Phase rate at a connection:

    q_p = WI · (k_{rp} b_p / μ_p)^{up} · ( P_cell − P_bh − ρ_p g (z_cell − z_bh) )

## Controls

`wells/controls`: BHP target, surface/reservoir rate targets, with automatic
switching when a constraint is violated (e.g. rate-controlled well hitting its BHP
limit). VFP tables map bottom-hole to tubing-head conditions.

## Multi-segment / groups / network

- `wells/segments` — multi-segment wells (segment pressure drop, cross-flow).
- `wells/groups` — group controls and rate allocation.
- `wells/network` — surface network coupling (later).
