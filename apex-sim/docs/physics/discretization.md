# Discretization

## Governing equations (black-oil, component form)

Conservation of standard-volume of each component c ∈ {o, w, g} over control
volume i:

    d/dt ( Vp Σ_p (b_p S_p R_{c,p}) )_i  =  Σ_{j∈N(i)} F_{c,ij}  +  Q_{c,i}

where `Vp = V·φ·NTG` is pore volume, `b_p = 1/B_p` the inverse FVF, `S_p` phase
saturation, and `R_{c,p}` the dissolved/vaporized ratios (Rs couples gas into oil,
Rv oil into gas).

## Two-point flux approximation (TPFA)

Inter-cell phase flux across face `ij`:

    F_{p,ij} = T_ij · (b_p k_{rp} / μ_p)^{up} · ( Φ_{p,i} − Φ_{p,j} )

- `T_ij` — geometric+rock transmissibility (see `rock/transmissibility`), the
  harmonic combination of half-transmissibilities, times any fault/region mult.
- Phase potential `Φ_p = P_p − ρ_p g z` (datum-referenced depth `z`).
- `(·)^{up}` — phase-potential **upwinding**: mobility taken from the cell on the
  upstream side of `Φ_{p,i} − Φ_{p,j}` (see `discretization/upwinding`).

TPFA is consistent only for K-orthogonal grids; MPFA-O is the planned upgrade for
full-tensor permeability and skewed corner-point geometry.

## Accumulation

The time term is discretized backward-Euler; `discretization/accumulation`
returns the per-cell accumulation residual and its derivatives w.r.t. primaries.

## Residual

`discretization/residual` assembles, per cell and component:

    R_{c,i} = ACC_{c,i}^{n+1} − ACC_{c,i}^{n} − dt·( Σ flux + well source )

The AD Jacobian (`nonlinear/jacobian`) is ∂R/∂x for primaries x.
