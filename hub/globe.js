/* ============================================================
   The Hub globe (wave 2, docs/vault-hub/wave2/05-markup.md §1.1).
   An orthographic Earth drawn on a canvas from the firm's own copy of
   Natural Earth polygons (hub/geo/countries-110m.json) with d3-geo
   (hub/vendor). No tiles, no key, no WebGL: it runs on the iPad and
   behind Cloudflare Access.

   createGlobe(canvas, { geo, lang, onSelect, onPoint, onHover, reducedMotion })
     .setData({ held: Map<iso2, {projects, stale, expiring}>, points: [{lat, lon, id, name, kind?: 'field'}] })
     // wave 3: a point with kind 'field' is drawn smaller and cream beside the gold project
     // points; hovering it reports its name. onSelect(code, feature, {lat, lon}) carries the
     // geographic point under the tap so "Create a project here" can prefill coordinates.
     // wave 7 PR2 (idea A): a tap on a project dot calls onPoint(point, {lat, lon}) instead of
     // onSelect, so the page can light the project's register row rather than open the country.
     .select(code, { fly: true })      // fly to a country and highlight it; null clears
     .setRings(['BR', 'PE'])           // wave 7 PR6: a thin gold ring around each country with an open licence
                                       // round, sized to the country's area; onHover carries open: true for it
     .setRisk(new Map([['VE', { tone: 'red', rising: true, sanctions: true }]]))   // wave 8: the risk halo, tick and mark
     .setEvents([{ lat, lon }])        // wave 8: the chosen country's conflict events as clustered dots
     .setLang('en' | 'es')
     .destroy()

   Behaviour: one revolution in about 90 s; slows to a quarter on hover;
   drag turns it with inertia; wheel and pinch zoom between 1x and 4x;
   tapping a country selects it. With prefers-reduced-motion the globe
   stands still and flights are instant.
   ============================================================ */

const COLOURS = {
  space: 'rgba(0,0,0,0)',
  sphereIn: '#163258', sphereOut: '#071428',
  glow: 'rgba(201,168,76,0.35)',
  graticule: 'rgba(255,255,255,0.07)',
  land: '#2F4A6D', landLine: '#0B1F3A',
  held: '#C9A84C', heldLine: '#F2DFA0',
  hover: '#E8C96A', selected: '#F2DFA0', selectedLine: '#FFFFFF',
  stale: '#E8A33D', expiring: '#E25B4A',
  point: '#FFFFFF', pointRing: 'rgba(201,168,76,0.9)',
  field: '#F3E9C9', fieldLine: 'rgba(11,31,58,0.9)', fieldHover: '#FFFFFF',
  ring: '#F2DFA0', ringOuter: 'rgba(201,168,76,0.75)',
  // Wave 8: the risk halo in the register's three tones, and the conflict event dots of the chosen country.
  haloGreen: '#2E9E6E', haloAmber: '#E0A020', haloRed: '#E25B4A',
  event: '#FF5A4A', eventLine: 'rgba(255,255,255,0.9)', eventText: '#FFFFFF',
};
const HALO_GAP = 9;                     // px outside the round ring, so the two never merge
const EVENT_CLUSTER_PX = 12;            // event dots closer than this on screen share one dot with a count
const RING_MIN = 12;                    // px: the smallest ring, so a small country still wears one
const FIELD_R = 2.6;                    // field points: smaller, no pulse
const POINT_HIT_PX = 8;                 // hover radius for a point
const FULL_TURN_MS = 90_000;            // one revolution
const HOVER_FACTOR = 0.25;              // slower under the pointer
const FLY_MS = 900;
const MAX_ZOOM = 4;
const CLICK_PX = 4;                     // a drag shorter than this is a tap
const BIG = 0.04;                       // steradians: countries larger than this fly to a lower zoom

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerpAngle = (a, b, t) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };

export function createGlobe(canvas, opts) {
  const d3 = window.d3;
  if (!d3 || !d3.geoOrthographic) throw new Error('d3-geo is not loaded');
  const geo = opts.geo;
  const features = geo.features;
  const byCode = new Map();
  for (const f of features) if (!byCode.has(f.properties.iso2)) byCode.set(f.properties.iso2, f);
  const area = new Map(features.map((f) => [f, d3.geoArea(f)]));
  const centroid = new Map(features.map((f) => [f, d3.geoCentroid(f)]));
  const graticule = d3.geoGraticule10();
  const sphere = { type: 'Sphere' };

  const ctx = canvas.getContext('2d');
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
  const path = d3.geoPath(projection, ctx);

  let lang = opts.lang || 'en';
  let reduced = !!opts.reducedMotion;
  let w = 0, h = 0, dpr = 1, r0 = 100;
  let rotation = [20, -18];             // [lambda, phi]: start over the Atlantic, tilted
  let zoom = 1;
  let held = new Map(), points = [];
  let rings = new Set();                // wave 7 PR6: iso2 codes with an open licence round
  let halos = new Map();                // wave 8: iso2 → {tone: 'green'|'amber'|'red', rising, sanctions}
  let events = [];                      // wave 8: [{lat, lon, n?}] conflict events of the chosen country
  let hovered = null, selected = null;
  let hoveredPoint = null;              // wave 3: the field point under the pointer
  let visible = [];                     // [{p, x, y}] drawn this frame, for hit testing
  let speed = 360 / FULL_TURN_MS;       // degrees per ms
  let raf = 0, last = 0, destroyed = false;
  let flight = null;                    // {from:[l,p,z], to:[l,p,z], start}
  let drag = null;                      // {x, y, lambda, phi, moved, vx, t}
  let inertia = 0;                      // degrees per ms carried after a drag
  let pinch = null;                     // {d0, z0}
  const pointers = new Map();
  let lastHit = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.round(rect.width)); h = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    r0 = Math.min(w, h) / 2 * 0.86;
    draw();
  }

  function applyProjection() {
    projection.rotate(rotation).scale(r0 * zoom).translate([w / 2, h / 2]);
  }

  function colourOf(f) {
    const code = f.properties.iso2;
    if (selected === code) return [COLOURS.selected, COLOURS.selectedLine, 1.2];
    const hv = held.get(code);
    if (hv) {
      const line = hv.expiring ? COLOURS.expiring : hv.stale ? COLOURS.stale : COLOURS.heldLine;
      return [hovered === code ? COLOURS.hover : COLOURS.held, line, hv.expiring || hv.stale ? 2 : 0.8];
    }
    return [hovered === code ? '#3F5F86' : COLOURS.land, COLOURS.landLine, 0.5];
  }

  function draw(now = performance.now()) {
    if (destroyed) return;
    applyProjection();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = r0 * zoom;

    // Atmosphere glow.
    const glow = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.09);
    glow.addColorStop(0, COLOURS.glow); glow.addColorStop(1, 'rgba(201,168,76,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.09, 0, Math.PI * 2); ctx.fill();

    // The sphere.
    const sg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sg.addColorStop(0, COLOURS.sphereIn); sg.addColorStop(1, COLOURS.sphereOut);
    ctx.fillStyle = sg; ctx.beginPath(); path(sphere); ctx.fill();

    // Graticule.
    ctx.beginPath(); path(graticule); ctx.strokeStyle = COLOURS.graticule; ctx.lineWidth = 0.6; ctx.stroke();

    // Countries: plain land first, then held countries on top so their outlines stay crisp.
    const order = features.slice().sort((a, b) => Number(!!held.get(a.properties.iso2) || selected === a.properties.iso2) - Number(!!held.get(b.properties.iso2) || selected === b.properties.iso2));
    for (const f of order) {
      const [fill, line, lw] = colourOf(f);
      ctx.beginPath(); path(f);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke();
    }

    // Points on the visible hemisphere: fields first (small, cream, still), then project
    // points on top, pulsing unless motion is reduced.
    const centre = [-rotation[0], -rotation[1]];
    // Wave 7 PR6 (O, W7-AC22): a thin gold ring around each country with an open licence round, drawn over the land
    // and under the points: the radius is that of the cap with the country's area, so the ring encloses the country
    // without any new data; a dashed outer line makes it read as a ring rather than a selection.
    for (const code of rings) {
      const f = byCode.get(code);
      if (!f) continue;
      const c = centroid.get(f);
      if (d3.geoDistance(c, centre) > Math.PI / 2 - 0.05) continue;
      const xy = projection(c);
      if (!xy) continue;
      const theta = Math.acos(Math.max(-1, Math.min(1, 1 - area.get(f) / (2 * Math.PI))));
      const rr = Math.max(RING_MIN, R * Math.sin(theta) * 1.05 + 6);
      ctx.save();
      ctx.beginPath(); ctx.arc(xy[0], xy[1], rr, 0, Math.PI * 2);
      ctx.strokeStyle = COLOURS.ring; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.95; ctx.stroke();
      ctx.beginPath(); ctx.arc(xy[0], xy[1], rr + 4, 0, Math.PI * 2);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = COLOURS.ringOuter; ctx.lineWidth = 1; ctx.globalAlpha = 0.8; ctx.stroke();
      ctx.restore();
    }
    // Wave 8 (W8-AC2): a halo per held country in the tone of its World Monitor score, outside the round ring: a soft
    // wide stroke under a thin one, a rising tick at the top when the trend is rising, a sanctions mark at the right.
    for (const [code, hv] of halos) {
      const f = byCode.get(code);
      if (!f) continue;
      const c = centroid.get(f);
      if (d3.geoDistance(c, centre) > Math.PI / 2 - 0.05) continue;
      const xy = projection(c);
      if (!xy) continue;
      const theta = Math.acos(Math.max(-1, Math.min(1, 1 - area.get(f) / (2 * Math.PI))));
      const rr = Math.max(RING_MIN, R * Math.sin(theta) * 1.05 + 6) + HALO_GAP;
      // A halo without a tone (sanctioned, no World Monitor reading) draws only its sanctions mark.
      const tone = hv.tone === 'red' ? COLOURS.haloRed : hv.tone === 'amber' ? COLOURS.haloAmber : hv.tone === 'green' ? COLOURS.haloGreen : COLOURS.eventLine;
      ctx.save();
      if (hv.tone) {
        ctx.beginPath(); ctx.arc(xy[0], xy[1], rr, 0, Math.PI * 2);
        ctx.strokeStyle = tone; ctx.lineWidth = 7; ctx.globalAlpha = 0.28; ctx.stroke();
        ctx.beginPath(); ctx.arc(xy[0], xy[1], rr, 0, Math.PI * 2);
        ctx.lineWidth = 1.3; ctx.globalAlpha = 0.9; ctx.stroke();
      }
      if (hv.tone && hv.rising) {                                   // the tick: a small triangle pointing up at twelve o'clock
        const tx = xy[0], ty = xy[1] - rr;
        ctx.beginPath(); ctx.moveTo(tx, ty - 7); ctx.lineTo(tx - 5, ty + 2); ctx.lineTo(tx + 5, ty + 2); ctx.closePath();
        ctx.fillStyle = tone; ctx.globalAlpha = 1; ctx.fill(); ctx.strokeStyle = COLOURS.eventLine; ctx.lineWidth = 0.8; ctx.stroke();
      }
      if (hv.sanctions) {                                // the mark: a small diamond at three o'clock
        const mx = xy[0] + rr, my = xy[1];
        ctx.beginPath(); ctx.moveTo(mx, my - 5); ctx.lineTo(mx + 5, my); ctx.lineTo(mx, my + 5); ctx.lineTo(mx - 5, my); ctx.closePath();
        ctx.fillStyle = COLOURS.ring; ctx.globalAlpha = 1; ctx.fill(); ctx.strokeStyle = tone; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.restore();
    }
    const pulse = reduced ? 0.5 : (Math.sin(now / 600) + 1) / 2;
    visible = [];
    for (const p of points) {
      if (!(Number.isFinite(p.lat) && Number.isFinite(p.lon))) continue;
      if (d3.geoDistance([p.lon, p.lat], centre) > Math.PI / 2 - 0.02) continue;
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      visible.push({ p, x: xy[0], y: xy[1] });
    }
    for (const v of visible) {
      if (v.p.kind !== 'field') continue;
      const hot = hoveredPoint === v.p;
      ctx.beginPath(); ctx.arc(v.x, v.y, hot ? FIELD_R + 1.5 : FIELD_R, 0, Math.PI * 2);
      ctx.fillStyle = hot ? COLOURS.fieldHover : COLOURS.field; ctx.fill();
      ctx.strokeStyle = COLOURS.fieldLine; ctx.lineWidth = 0.8; ctx.stroke();
    }
    // Wave 8 (W8-AC4): the chosen country's conflict events, clustered on screen with a count, under the project points.
    if (events.length) {
      const clusters = [];
      for (const e of events) {
        if (!(Number.isFinite(e.lat) && Number.isFinite(e.lon))) continue;
        if (d3.geoDistance([e.lon, e.lat], centre) > Math.PI / 2 - 0.02) continue;
        const xy = projection([e.lon, e.lat]);
        if (!xy) continue;
        const hit = clusters.find((k) => Math.hypot(k.x - xy[0], k.y - xy[1]) <= EVENT_CLUSTER_PX);
        if (hit) { hit.n += 1; hit.x = (hit.x * (hit.n - 1) + xy[0]) / hit.n; hit.y = (hit.y * (hit.n - 1) + xy[1]) / hit.n; }
        else clusters.push({ x: xy[0], y: xy[1], n: 1 });
      }
      ctx.save();
      for (const k of clusters) {
        const rad = Math.min(9, 3 + 1.6 * Math.sqrt(k.n - 1));
        ctx.beginPath(); ctx.arc(k.x, k.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = COLOURS.event; ctx.globalAlpha = 0.88; ctx.fill();
        ctx.strokeStyle = COLOURS.eventLine; ctx.lineWidth = 0.8; ctx.globalAlpha = 1; ctx.stroke();
        if (k.n > 1) { ctx.fillStyle = COLOURS.eventText; ctx.font = '700 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(k.n), k.x, k.y + 0.5); }
      }
      ctx.restore();
    }
    for (const v of visible) {
      if (v.p.kind === 'field') continue;
      ctx.beginPath(); ctx.arc(v.x, v.y, 4 + 6 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = COLOURS.pointRing; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9 - 0.6 * pulse; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, Math.PI * 2); ctx.fillStyle = COLOURS.point; ctx.fill();
      ctx.strokeStyle = COLOURS.held; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Rim.
    ctx.beginPath(); path(sphere); ctx.strokeStyle = 'rgba(242,223,160,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  }

  function needsFrames() { return !reduced || flight || drag || Math.abs(inertia) > 1e-4; }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    if (flight) {
      const t = clamp((now - flight.start) / FLY_MS, 0, 1), e = ease(t);
      rotation = [lerpAngle(flight.from[0], flight.to[0], e), flight.from[1] + (flight.to[1] - flight.from[1]) * e];
      zoom = flight.from[2] + (flight.to[2] - flight.from[2]) * e;
      if (t >= 1) flight = null;
    } else if (drag) {
      // position follows the pointer directly
    } else {
      if (Math.abs(inertia) > 1e-4) { rotation[0] += inertia * dt; inertia *= Math.pow(0.94, dt / 16); if (Math.abs(inertia) < 1e-4) inertia = 0; }
      else if (!reduced && !selected) rotation[0] = (rotation[0] + speed * dt * (hovered ? HOVER_FACTOR : 1)) % 360;
    }
    draw(now);
    if (needsFrames() || (!reduced && !selected)) schedule();
  }
  function schedule() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }

  /* ── hit testing ────────────────────────────────────────────────────── */

  function hit(x, y) {
    applyProjection();
    const ll = projection.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0])) return null;
    // Only the front hemisphere is a hit.
    if (d3.geoDistance(ll, [-rotation[0], -rotation[1]]) > Math.PI / 2) return null;
    for (const f of features) if (d3.geoContains(f, ll)) return f;
    return null;
  }
  /** The point (field or project) within POINT_HIT_PX of a canvas position, nearest first. */
  function pointAt(x, y) {
    let best = null, bd = POINT_HIT_PX;
    for (const v of visible) { const d = Math.hypot(v.x - x, v.y - y); if (d <= bd) { bd = d; best = v.p; } }
    return best;
  }
  /** The geographic point under a canvas position on the front hemisphere, or null. */
  function geoAt(x, y) {
    applyProjection();
    const ll = projection.invert([x, y]);
    if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
    if (d3.geoDistance(ll, [-rotation[0], -rotation[1]]) > Math.PI / 2) return null;
    return { lat: Math.round(ll[1] * 100) / 100, lon: Math.round((((ll[0] + 540) % 360) - 180) * 100) / 100 };
  }
  const local = (ev) => { const rect = canvas.getBoundingClientRect(); return [ev.clientX - rect.left, ev.clientY - rect.top]; };

  /* ── pointer, wheel, keyboard ───────────────────────────────────────── */

  function onPointerDown(ev) {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, local(ev));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: zoom }; drag = null; return;
    }
    const [x, y] = local(ev);
    drag = { x, y, lambda: rotation[0], phi: rotation[1], moved: false, vx: 0, t: performance.now(), lastX: x };
    flight = null; inertia = 0;
    schedule();
  }
  function onPointerMove(ev) {
    const [x, y] = local(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [x, y]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoom = clamp(pinch.z0 * (d / Math.max(1, pinch.d0)), 1, MAX_ZOOM); draw(); return;
    }
    if (drag) {
      const k = 0.25 / zoom;                                   // degrees per pixel
      const dx = x - drag.x, dy = y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > CLICK_PX) drag.moved = true;
      rotation = [drag.lambda + dx * k, clamp(drag.phi - dy * k, -75, 75)];
      const now = performance.now(), dt = now - drag.t;
      if (dt > 0) { drag.vx = ((x - drag.lastX) * k) / dt; drag.t = now; drag.lastX = x; }
      draw(); return;
    }
    // Hover: cheap enough to run on every move, but throttle the polygon test a little.
    const now = performance.now();
    if (now - lastHit < 40) return;
    lastHit = now;
    const pt = pointAt(x, y);
    const f = hit(x, y);
    const code = f ? f.properties.iso2 : null;
    if (code !== hovered || pt !== hoveredPoint) {
      hovered = code; hoveredPoint = pt;
      canvas.style.cursor = f || pt ? 'pointer' : 'grab';
      if (opts.onHover) {
        if (pt) opts.onHover({ code, name: pt.name, x, y, point: pt });
        else opts.onHover(f ? { code, name: f.properties[lang] || f.properties.en, x, y, open: rings.has(code) } : null);
      }
      if (reduced || pt || !code) draw();
    }
  }
  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) {
      const [x, y] = local(ev);
      // Wave 7 PR2 (idea A): a tap on a project dot is the project, not its country.
      const pt = pointAt(x, y);
      if (pt && pt.kind !== 'field' && opts.onPoint) { opts.onPoint(pt, geoAt(x, y)); schedule(); return; }
      const f = hit(x, y);
      if (f && opts.onSelect) opts.onSelect(f.properties.iso2, f, geoAt(x, y));
    } else if (!reduced) inertia = clamp(d.vx, -0.5, 0.5);
    schedule();
  }
  function onPointerLeave() {
    if (hovered || hoveredPoint) { hovered = null; hoveredPoint = null; canvas.style.cursor = 'grab'; if (opts.onHover) opts.onHover(null); draw(); }
  }
  function onWheel(ev) {
    ev.preventDefault();
    zoom = clamp(zoom * Math.pow(1.0015, -ev.deltaY), 1, MAX_ZOOM);
    draw();
  }

  /* ── public ─────────────────────────────────────────────────────────── */

  function flyTo(code) {
    const f = byCode.get(code);
    if (!f) return false;
    const [lon, lat] = centroid.get(f);
    const target = [[-lon, -lat][0], clamp(-lat, -75, 75)];
    const z = area.get(f) > BIG ? 1.5 : 2.3;
    if (reduced) { rotation = target; zoom = z; flight = null; draw(); return true; }
    flight = { from: [rotation[0], rotation[1], zoom], to: [target[0], target[1], z], start: performance.now() };
    schedule();
    return true;
  }

  const api = {
    setData({ held: hm, points: pts }) {
      held = hm instanceof Map ? hm : new Map(Object.entries(hm || {}));
      points = Array.isArray(pts) ? pts : [];
      draw(); schedule();
    },
    select(code, { fly = true } = {}) {
      selected = code || null;
      if (code && fly) flyTo(code);
      else if (!code && !reduced) { flight = { from: [rotation[0], rotation[1], zoom], to: [rotation[0], rotation[1], 1], start: performance.now() }; }
      else if (!code) zoom = 1;
      draw(); schedule();
    },
    /** Wave 7 PR6: the countries with an open licence round; each wears the ring until the list changes. */
    setRings(codes) { rings = new Set(Array.isArray(codes) ? codes.filter((c) => byCode.has(c)) : []); draw(); schedule(); },
    /** Wave 8 (W8-AC2): iso2 → {tone, rising, sanctions}; a country without an entry wears no halo, one with tone '' only its sanctions mark. */
    setRisk(map) { const m = map instanceof Map ? map : new Map(Object.entries(map || {})); halos = new Map([...m].filter(([c, v]) => byCode.has(c) && v && v.tone)); draw(); schedule(); },
    /** Wave 8 (W8-AC4): the chosen country's conflict events, [{lat, lon}]; an empty list clears them. */
    setEvents(list) { events = Array.isArray(list) ? list : []; draw(); schedule(); },
    setLang(l) { lang = l; },
    nameOf(code) { const f = byCode.get(code); return f ? { en: f.properties.en, es: f.properties.es } : null; },
    /** The country's geographic centre from its polygon (a computed point, never a guess). */
    centroidOf(code) { const f = byCode.get(code); if (!f) return null; const [lon, lat] = centroid.get(f); return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 }; },
    /** Canvas position of a geographic point when it is on the front hemisphere (used by tests and callers that place markers). */
    screenOf(lat, lon) { applyProjection(); if (d3.geoDistance([lon, lat], [-rotation[0], -rotation[1]]) > Math.PI / 2) return null; const xy = projection([lon, lat]); return xy ? { x: xy[0], y: xy[1] } : null; },
    has(code) { return byCode.has(code); },
    get rotation() { return rotation.slice(); },
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('wheel', onWheel); },
  };

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  schedule();
  return api;
}
