# viz — pre / post / QC front-end

The interactive front-end, repurposed from the Alpha Technical Centre prototype
`reservoir-simulator.html` (**APEX Reservoir 3D**). It will consume apex-sim's
outputs (`src/io/gridwriter`, `summary`, `restartwriter`) for:

- **Pre:** grid/property QC, well placement, region maps.
- **Post:** 3D field views (pressure/saturation), well/field summary plots.
- **QC:** side-by-side vs. benchmark references (`benchmark/reference/`).

## Plan

1. Lift the Three.js rendering + UI shell out of `reservoir-simulator.html`.
2. Replace the in-page mock solver with apex-sim result files (JSON now).
3. Keep the Alpha brand system (navy/gold, Playfair/Barlow) intact.

Until then, the live prototype remains the source at repo root:
`../reservoir-simulator.html`.
