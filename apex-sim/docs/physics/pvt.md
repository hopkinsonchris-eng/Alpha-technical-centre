# PVT (black-oil)

The black-oil model lumps hydrocarbons into a surface "oil" and "gas" component
that partition between liquid and vapour phases via `Rs` (gas dissolved in oil)
and `Rv` (oil vaporized in gas).

## Tables

- **PVTO** — Bo(P, Rs), μo(P, Rs); saturated branch + undersaturated extensions.
- **PVTW** — Bw, μw, water compressibility, viscosibility at reference P.
- **PVTG** — Bg(P, Rv), μg(P, Rv).

## Properties used by the solver

    b_p = 1 / B_p          (inverse formation volume factor)
    ρ_p = (ρ_surface terms, Rs, Rv) / B_p
    μ_p = μ_p(P, Rs|Rv)

`pvt/blackoil` interpolates the tables and returns values **and derivatives**
(for the AD Jacobian). Saturated vs. undersaturated state determines which
primary variable is active (see `state/phaseswitch`).

## Compositional (later)

`pvt/eos` will provide a cubic EOS (Peng–Robinson / SRK) flash for compositional
runs, replacing Rs/Rv bookkeeping with K-values and phase split.
