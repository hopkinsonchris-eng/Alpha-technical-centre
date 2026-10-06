/* ============================================================
   The one risk scale (wave 8, docs/vault-hub/wave8/01-risk-lens.md §4).
   The globe halo, the risk table on Today, the country panel's risk line
   and the opportunity register's heat table all colour a 0–100 score the
   same way and use the same two names: "World Monitor instability" for the
   country (the feed's Instability Index) and "our execution risk" for the
   project (what a partner entered). The server states the same bands in
   vault/src/intel/worldmonitor.ts (bandOf); opportunity-register.html, a
   plain script, repeats the stops in its own heatColour with a comment
   pointing here.

     import { bandOf, heatColour, trendGlyph, BAND_COLOUR, BAND_WORD, INSTABILITY_WORD, EXECUTION_WORD } from './components/risk-scale.js';
   ============================================================ */

/** 70 and over is red, 40 and over amber, else green; null without a number. */
export function bandOf(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score >= 70 ? 'red' : score >= 40 ? 'amber' : 'green';
}

/** The band colours, the register's: green (managed / low), amber (elevated), red (high). */
export const BAND_COLOUR = { green: '#2ECC8A', amber: '#E8963A', red: '#E0544A' };

/** Words for the country band, kept apart from the project's Managed / Elevated / High. */
export const BAND_WORD = { green: ['low', 'baja'], amber: ['elevated', 'elevada'], red: ['high', 'alta'] };
export const INSTABILITY_WORD = ['World Monitor instability', 'Inestabilidad World Monitor'];
export const EXECUTION_WORD = ['our execution risk', 'nuestro riesgo de ejecución'];

const STOPS = [[0, [46, 204, 138]], [40, [232, 150, 58]], [70, [224, 84, 74]], [100, [176, 32, 40]]];
/** A continuous colour for a 0–100 score through the band stops (green → amber at 40 → red at 70 → deep red at 100). */
export function heatColour(v) {
  const x = Math.max(0, Math.min(100, Number(v) || 0));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const t = (x - a) / (b - a);
      const c = ca.map((p, k) => Math.round(p + (cb[k] - p) * t));
      return 'rgb(' + c.join(',') + ')';
    }
  }
  return 'rgb(' + STOPS[STOPS.length - 1][1].join(',') + ')';
}

/** ▲ rising, ▼ falling, nothing for stable or unknown. */
export function trendGlyph(trend) {
  return trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : '';
}

/** "+5" / "−10" / "" for a delta, with a proper minus sign. */
export function signed(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return v === 0 ? '0' : '';
  const s = Math.abs(v) % 1 === 0 ? String(Math.abs(v)) : Math.abs(v).toFixed(1);
  return (v > 0 ? '+' : '−') + s;
}
