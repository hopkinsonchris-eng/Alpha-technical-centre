/* ============================================================
   The Hub globe (wave 2, docs/vault-hub/wave2/05-markup.md §1.1).
   An orthographic Earth drawn on a canvas from the firm's own copy of
   Natural Earth polygons (hub/geo/countries-110m.json) with d3-geo
   (hub/vendor). No tiles, no key, no WebGL: it runs on the iPad and
   behind Cloudflare Access.

   createGlobe(canvas, { geo, lang, onSelect, onHover, reducedMotion })
     .setData({ held: Map<iso2, {projects, stale, expiring}>, points: [{lat, lon, id, name}] })
     .select(code, { fly: true })      // fly to a country and highlight it; null clears
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
};
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
  let hovered = null, selected = null;
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

    // Project points on the visible hemisphere, pulsing unless motion is reduced.
    const centre = [-rotation[0], -rotation[1]];
    const pulse = reduced ? 0.5 : (Math.sin(now / 600) + 1) / 2;
    for (const p of points) {
      if (!(Number.isFinite(p.lat) && Number.isFinite(p.lon))) continue;
      if (d3.geoDistance([p.lon, p.lat], centre) > Math.PI / 2 - 0.02) continue;
      const xy = projection([p.lon, p.lat]);
      if (!xy) continue;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 4 + 6 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = COLOURS.pointRing; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.9 - 0.6 * pulse; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 3, 0, Math.PI * 2); ctx.fillStyle = COLOURS.point; ctx.fill();
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
    const f = hit(x, y);
    const code = f ? f.properties.iso2 : null;
    if (code !== hovered) {
      hovered = code;
      canvas.style.cursor = f ? 'pointer' : 'grab';
      if (opts.onHover) opts.onHover(f ? { code, name: f.properties[lang] || f.properties.en, x, y } : null);
      if (reduced) draw();
    }
  }
  function onPointerUp(ev) {
    pointers.delete(ev.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) {
      const f = hit(...local(ev));
      if (f && opts.onSelect) opts.onSelect(f.properties.iso2, f);
    } else if (!reduced) inertia = clamp(d.vx, -0.5, 0.5);
    schedule();
  }
  function onPointerLeave() {
    if (hovered) { hovered = null; canvas.style.cursor = 'grab'; if (opts.onHover) opts.onHover(null); if (reduced) draw(); }
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
    setLang(l) { lang = l; },
    nameOf(code) { const f = byCode.get(code); return f ? { en: f.properties.en, es: f.properties.es } : null; },
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
