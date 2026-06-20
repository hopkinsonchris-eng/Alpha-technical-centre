# Alpha Technical Centre — Website

Static multi-page site for Alpha Technical Centre, a wholly-owned subsidiary of
Alpha Energy Latin America. No build step required.

Brand: Alpha Energy Latin America v1.0 — Alpha Navy (#0B1F3A), Venezuela Gold
(#C9A84C). Typography: Playfair Display (display), Barlow (body), Barlow
Condensed (labels).

## Architecture (shared "Option A")

All pages share three files — edit once, every page updates:

- `style.css` — design system (colours, type, components, hero, footer)
- `main.js`   — nav, scroll reveals, EN/ES language toggle, stat counters
- `hero.js`   — Three.js (WebGL) 3D reservoir hero on the homepage

The homepage loads Three.js from CDN via an import map and lazy-initialises the
3D scene. The render loop pauses when the hero scrolls out of view, checks for
WebGL support (showing a poster fallback if absent), and respects reduced-motion.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home — 3D reservoir hero + Integrated Asset Loop |
| `about.html` | About the firm and the Alpha Energy relationship |
| `tools.html` | Our Tools — Financial Model + Oil & Gas Evaluation System |
| `oil-gas-modelling.html` | Capability — subsurface & production modelling |
| `financial-modelling.html` | Tool — Upstream Quick-Look Financial Model |
| `plan-your-job.html` | Tool — Scope-of-Work generator |
| `team.html` | The four core partners + associate network |
| `case-studies.html` | Selected mandates (placeholder cards) |
| `insights.html` | Notes from the technical desk (placeholder cards) |
| `contact.html` | Enquiry form + direct contact details |

## Navigation

Top bar on every page:
- **Home · About · Capabilities ▾ · Our Tools · Case Studies · Team · Insights · Contact**
- Capabilities dropdown → Oil & Gas Modelling · Financial Modelling
- **Plan Your Job** (gold CTA button)
- EN / ES language toggle

## Bilingual (EN / ES)

Every text element carries `data-en` / `data-es` attributes. The toggle in the
nav switches all content live and remembers the choice (localStorage). Form
placeholders use `data-en-ph` / `data-es-ph`.

## Local preview

Because pages share external `style.css` / `main.js` / `hero.js`, open the site
through a local server (not file://) so those load:

```bash
cd alpha-technical-centre
python3 -m http.server 8000
# visit http://localhost:8000
```

`*_preview.html` files are self-contained (CSS/JS inlined) for quick single-file
viewing only — do not deploy these; they are not linked in navigation.

## Deploy (Render — static site)

1. Push this folder to a GitHub repo.
2. In Render: New → Static Site → connect the repo.
3. Publish directory: `.` (root). Build command: leave blank.
4. `render.yaml` is included for blueprint deploys (sets caching + security headers).

## Custom domain

Point a DNS CNAME for `technical.alpha.energy` at your Render URL. Update
`sitemap.xml` if the domain changes.

## Housekeeping

Working/backup files are prefixed with `_` (e.g. `_hero_FINAL.html`,
`_*_backup.html`, `_nav_snippet.html`). These are not part of the live site and
can be deleted before deploy if desired.
