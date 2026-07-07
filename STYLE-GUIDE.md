# Alpha Technical Centre — Style Guide (for developers)

How to build or update a page so it matches the rest of the site. Everything
below is the **actual** design system defined in `style.css` — not a copy to
keep in sync, but the source of truth. Reference it, don't duplicate it.

---

## The one rule

**Link the two shared files and reuse the classes.** You get the fonts,
colours, typography, nav, footer, buttons and layout for free.

```html
<link rel="stylesheet" href="style.css">   <!-- design system + Google Fonts @import -->
...
<script src="main.js"></script>            <!-- nav toggle, scroll reveals, EN/ES toggle, counters -->
```

- Serve through a local web server (not `file://`) so the shared files load:
  `python3 -m http.server 8000` → visit `http://localhost:8000`.
- Copy **`_page-template.html`** (ships next to this file) as your starting point.

---

## Fonts

Loaded automatically by `style.css` (top of file):

```css
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Barlow:wght@300;400;500;600&family=Barlow+Condensed:wght@300;400;500;600;700&display=swap');
```

| Role | Family (CSS var) | Stack | Weights |
|------|------------------|-------|---------|
| Display / headings | `--font-display` | `'Playfair Display', Georgia, serif` | 400, 600, 700 (+ italic 400/600) |
| Body / UI | `--font-body` | `'Barlow', system-ui, sans-serif` | 300, 400, 500, 600 |
| Labels / eyebrows / data | `--font-label` | `'Barlow Condensed', system-ui, sans-serif` | 300–700 |

**Convention:** gold italic is reserved for lifting *one* word in a headline
(`<em>` inside an `<h1>`/`<h2>`). Labels are always UPPERCASE and letter-spaced.

---

## Colour tokens

Use the CSS variables — never hard-code the hex.

```css
/* Primary */
--navy:        #0B1F3A;   /* primary: backgrounds, text            */
--navy-mid:    #132845;   /* body-text navy, secondary surfaces     */
--gold:        #C9A84C;   /* accent: rules, labels, CTAs, the mark  */
--gold-light:  #E8C96A;   /* hover/gradient highlight               */
--cream:       #F8F5EE;   /* default page background                */
--white:       #FFFFFF;

/* Secondary */
--steel:       #6B7A8D;   /* muted text                             */
--rule:        #D8DCE2;   /* hairline borders                       */
--summa-red:   #C0392B;   /* data accent (saturation ramp)          */

/* Signature gradient (gold → red → navy) */
--grad: linear-gradient(90deg, #C9A84C 0%, #C0392B 50%, #0B1F3A 100%);
```

**Usage ratio:** ~70% navy/neutral, ~25% white/cream, ~5% gold. Gold is a
seasoning. Example: `color: var(--navy); background: var(--cream);`

---

## Typography scale (already applied to base tags)

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| `h1` | `clamp(2.4rem, 5vw, 3.8rem)` | 700 | Playfair, `line-height:1.2` |
| `h2` | `clamp(1.8rem, 3.5vw, 2.6rem)` | 600 | Playfair |
| `h3` | `clamp(1.2rem, 2vw, 1.5rem)` | 600 | Playfair |
| `p`  | `1rem` | 400 | `color:var(--navy-mid)`, `max-width:65ch` |
| `.label` | `11px` | 600 | Barlow Condensed, UPPERCASE, `letter-spacing:.18em`, `color:var(--gold)` — the gold eyebrow above headings |

Base: `html { font-size:16px }`, body uses `--font-body` on `--cream`.

---

## Layout & spacing tokens

```css
--maxw:  1160px;   /* content width — use the .wrap container      */
--nav-h: 72px;     /* fixed nav height                             */
--r:     6px;      /* default corner radius                        */
--r-lg:  12px;     /* large radius (cards, panels)                 */
--ease:  cubic-bezier(0.4, 0, 0.2, 1);   /* standard transition    */
```

- **`.wrap`** — centres content at `--maxw`. Put it inside every section.
- **`section { padding: 96px 0 }`** — vertical rhythm is automatic.
- **Section backgrounds:** `.section-white`, `.section-cream`, `.section-dark`
  (dark = navy bg, white text). Alternate them down the page.
- **`.section-head`** — wraps a `.label` + `h2` + intro `p` (56px bottom margin).

---

## Components (reuse these class names)

**Buttons**
```html
<a class="btn btn-primary" href="#">Primary CTA</a>     <!-- gold fill -->
<a class="btn btn-outline" href="#">Secondary</a>       <!-- navy outline -->
<a class="btn btn-ghost-light" href="#">On dark bg</a>  <!-- use inside .section-dark -->
```

**Eyebrow + heading**
```html
<span class="label" data-en="Our Capability" data-es="Capacidad">Our Capability</span>
<h2>Headline with a <em>gold</em> word</h2>
```

**Cards & grids**
```html
<div class="grid-3">           <!-- also .grid-2 / .grid-4 -->
  <div class="card"> … </div>
</div>
```

**Gold rule divider:** `<div class="grad-rule"></div>` (or `.grad-rule--short`).

**Nav & footer:** copy them verbatim from `_page-template.html` (or any existing
page). Set `class="active"` on the current page's nav link.

---

## Bilingual (EN / ES)

Every visible text element carries `data-en` and `data-es`; `main.js` swaps them
live via the nav toggle and remembers the choice. Form placeholders use
`data-en-ph` / `data-es-ph`.

```html
<a href="about.html" data-en="About" data-es="Nosotros">About</a>
```

If you add copy, add both attributes or it won't translate.

---

## Checklist for a new page that matches

1. Start from `_page-template.html`.
2. Set `<title>` and `<meta name="description">`.
3. Add the SEO/social block (canonical, OG, Twitter, JSON-LD) — copy the
   `<!-- SEO -->` block from an existing page and update the URL/title/description.
4. Add the GA4 snippet (`G-NKCRSSV2RQ`) before `</head>` (already in the template).
5. Keep `class="active"` on the correct nav item.
6. Use `.wrap` inside every `section`; alternate `.section-white` / `.section-cream` / `.section-dark`.
7. Add `data-en` / `data-es` to all text.
8. Add the new URL to `sitemap.xml`.
