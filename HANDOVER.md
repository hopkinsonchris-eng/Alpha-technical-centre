# Developer Handover & Operations Runbook

**Welcome.** This document is everything you need to develop, deploy and run the
Alpha Technical Centre website. Read it once end-to-end, then keep it as your
reference. It complements — does not replace — `README.md` (architecture) and
`STYLE-GUIDE.md` (how to build a page that matches the site).

---

## 0. Ownership & guardrails (read first)

**Chris Hopkinson owns this website** — the GitHub account, the hosting, the
domain and the billing. You have full *operational* access to build, deploy and
run it, but a few things are deliberately out of scope:

**Do not, without checking with Chris first:**
- Change or transfer the **domain** (`alpha-technical-centre.com`) at the registrar.
- Change **billing / payment** on any platform.
- Delete a service, repo, DNS zone, or mailbox.
- Remove Chris (or yourself) from any account.
- Point DNS away from the current host, or edit **MX / email DNS records** (breaking these takes email offline).
- Un-hide the internal tools (`admin.html`, `app.html`) from search engines.

Everything else — code, content, deploys, SEO, analytics — is yours to run.

**Work in the open:** prefer branches + Pull Requests over pushing straight to
`main`, so Chris can see what's shipping. See §4.

---

## 1. The stack at a glance

| Layer | Technology | Where |
|-------|-----------|-------|
| **Code** | Static HTML/CSS/JS — **no build step, no framework** | GitHub: `hopkinsonchris-eng/Alpha-technical-centre` |
| **Hosting** | Render (static site) — **auto-deploys from `main`** | dashboard.render.com |
| **Config** | `render.yml` (routes, headers, caching) | in the repo root |
| **DNS** | Cloudflare | dash.cloudflare.com |
| **Email** | Zoho Mail (`info@alpha-technical-centre.com`) | mailadmin.zoho.com |
| **Analytics** | Google Analytics 4 — `G-NKCRSSV2RQ` | analytics.google.com |
| **Search** | Google Search Console + Bing Webmaster Tools | search.google.com/search-console |
| **Social** | LinkedIn company page | linkedin.com |
| **External apps** | APEX 3D model (`apex-3d-model.uk`), APEX Asset Intelligence (`apex-app2.onrender.com`) | linked from the site |

The whole site is plain files served statically. If you can edit HTML/CSS/JS,
you can run this site. There is nothing to compile.

---

## 2. Access you should have

Chris grants these during onboarding. Confirm you can reach each:

- [ ] **GitHub** — Write access to the repo
- [ ] **Render** — team member (can see deploys)
- [ ] **Cloudflare** — DNS access
- [ ] **Zoho** — your mailbox (and admin, if you'll manage email)
- [ ] **Google Analytics** — Editor
- [ ] **Google Search Console** — Full user
- [ ] **Google Business Profile** — Manager
- [ ] **Bing Webmaster Tools** — delegated
- [ ] **LinkedIn** — Content/Super Admin
- [ ] **Shared password manager vault** ("Alpha Web")

If any are missing, ask Chris — he has a matching setup guide.

---

## 3. Repo & local development

Clone and open — there's genuinely nothing to install:

```bash
git clone https://github.com/hopkinsonchris-eng/Alpha-technical-centre.git
cd Alpha-technical-centre
```

To preview locally, run any static server (the site uses relative paths and
loads a couple of libraries from CDN):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

That's it — no `npm install`, no bundler, no environment variables.

### Repo map

```
index.html                 Homepage (hero + sections)
about / team / contact / case-studies / insights   Core marketing pages
technical-due-diligence.html                        Investor service page
oil-gas-modelling / financial-modelling             Capability pages
tools.html                                          Tools hub
plan-your-job.html          Scope-of-Work generator
nodal-analysis(-tool).html  Well performance optimiser (+ ESP feature)
reservoir-simulator.html    APEX Reservoir 3D black-oil simulator
insights-*.html             Individual insight articles
admin.html / app.html       INTERNAL — noindex, staff only
ela-studio/ situation-room/ ela-model-suite.html    Internal/app modules

style.css                   Design system (colours, type, components) — SOURCE OF TRUTH
main.js                     Nav, scroll reveals, EN/ES toggle, stat counters
hero.js                     Three.js WebGL reservoir hero (homepage)

_page-template.html         Starter template for a new page
STYLE-GUIDE.md              How to build a matching page
README.md                   Architecture notes
robots.txt / sitemap.xml    SEO crawl files
render.yml                  Hosting config
.claude/skills/             AI automation (see §10)
```

---

## 4. Branching & deployment

**Deployment is automatic: anything merged to `main` goes live on Render within a
minute or two.** There is no separate "publish" step.

Recommended workflow:

```bash
git checkout main && git pull
git checkout -b feature/short-description      # work on a branch
# ...edit, test locally...
git add -A && git commit -m "Clear description of the change"
git push -u origin feature/short-description
```

Then open a **Pull Request** on GitHub and let Chris review before merging to
`main`. For small/urgent fixes you may commit to `main` directly, but PRs are the
default so changes are visible.

**Rolling back a bad deploy:** either revert the commit
(`git revert <hash>` → push to `main`) or, in the **Render dashboard → the
service → Deploys**, click **Rollback** on the last good deploy. Render keeps a
history.

### render.yml — what's configured
- Static site, publish path `.` (repo root)
- `/BOE` → redirects to `/financial-modelling.html`
- `/` → serves `index.html`
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`)
- Long-cache immutable headers on `*.css` and `*.js`

If you rename `style.css`/`main.js` you get free cache-busting; if you edit them
in place, note browsers cache aggressively (see §11).

---

## 5. Architecture — the one rule

**Every page links the same three shared files and reuses the same CSS classes.**
Edit `style.css` once and all pages update. Never fork per-page styles.

```html
<link rel="stylesheet" href="style.css">
<script src="main.js" defer></script>
```

Full details and the class list are in `STYLE-GUIDE.md`. Start any new page from
`_page-template.html`.

### Brand tokens (defined in `style.css :root`)
- Navy `#0B1F3A` · Gold `#C9A84C` · Gold-light `#E8C96A` · Cream `#F8F5EE`
- Fonts: Playfair Display (display), Barlow (body), Barlow Condensed (labels)

---

## 6. Bilingual system (EN / ES)

Every user-facing string carries both languages as data attributes; `main.js`
swaps them when the visitor toggles EN/ES in the nav:

```html
<h2 data-en="From first screening to final decision"
    data-es="Desde el cribado inicial hasta la decisión final">From first screening to final decision</h2>
```

Rules:
- **Add `data-en` AND `data-es` to every new piece of copy.** A missing `data-es`
  means that element won't translate.
- For inputs use `data-en-ph` / `data-es-ph` (placeholder text).
- Copy that contains markup (e.g. a gold-italic word) uses `<em>…</em>` inside the
  attribute — `main.js` renders it as HTML when it detects a `<` character.
  (This was a real bug once; the fix lives in `applyLang()` in `main.js`.)

---

## 7. SEO — the must-maintain checklist

SEO is a core asset of this site. **Every new indexable page must include the full
block below.** Copy it from any existing page (e.g. `technical-due-diligence.html`)
and adapt.

For each new public page:
1. **Unique `<title>`** — target the phrase people search, end with `Alpha Technical Centre`.
2. **Unique `<meta name="description">`** — ~150 chars, compelling.
3. **Canonical** — `<link rel="canonical" href="https://www.alpha-technical-centre.com/PAGE.html">` (always `https://www`).
4. **Robots** — `<meta name="robots" content="index, follow, max-image-preview:large">`.
5. **Open Graph (9 tags)** + **Twitter Card (4 tags)** — controls LinkedIn/social previews; point `og:image` at `og-image.png` (or a page-specific 1200×630).
6. **JSON-LD structured data** — `Service` for service pages, `Article` for insights, etc.
7. **GA4 snippet** — the `gtag` block for `G-NKCRSSV2RQ` (copy from any public page). **Never** add it to `admin.html`/`app.html`.
8. **Add the URL to `sitemap.xml`** with `lastmod`/`changefreq`/`priority`.

For an **internal/private** page instead: set robots to `noindex, nofollow`, add
it to `robots.txt` `Disallow`, and leave it out of the sitemap.

**After publishing a new page:** in Google Search Console, use **URL Inspection →
Request Indexing** so Google picks it up quickly (otherwise it can take days).

Current SEO state (all in place and verified): canonical + robots on every page,
19-URL sitemap, JSON-LD on homepage/DD/insight pages, GA4 site-wide, OG/Twitter
site-wide, security + cache headers via `render.yml`.

> **Known SEO to-dos** (good first tasks): add `Service` JSON-LD to the capability
> and tool pages (they currently have none); add `ItemList`/`Blog` schema to
> `insights.html`; decide indexing for `ela-model-suite.html` / `ela-studio/` /
> `situation-room/` (currently no canonical/robots/sitemap entry — set them
> `noindex` if private, or give them the full block + sitemap entry if public).

---

## 8. The interactive tools

These are self-contained pages with their own logic — treat each as its own mini-app:

- **`financial-modelling.html`** — Upstream Quick-Look economics (NPV, IRR, payback, sensitivities).
- **`nodal-analysis-tool.html`** — IPR/VLP nodal analysis with an **ESP feature** (models bottom-hole pressure drawn to a ~50 atm target; pump head via Darcy-Weisbach). Physics lives inline in the page.
- **`reservoir-simulator.html`** — APEX Reservoir 3D multiwell black-oil simulator.
- **`plan-your-job.html`** — interactive Scope-of-Work generator.
- **`ela-studio/`, `situation-room/`, `ela-model-suite.html`** — additional modules; read their local `README`/source before changing.

When editing physics/calculations, sanity-check the numbers against realistic
field values — the tools are client-facing credibility pieces.

---

## 9. Content: adding an insight article

1. Copy an existing `insights-*.html` (they share `.ins-*` styles).
2. Update: `<title>`, meta description, canonical, OG/Twitter, and the **`Article`
   JSON-LD** (`headline`, `datePublished`, author/publisher).
3. Write the body; keep the house style (see the `humaniser` skill in §10 — the
   prose must not read machine-written, every claim sourced).
4. Add a card linking to it on `insights.html`.
5. Add the URL to `sitemap.xml`.
6. Commit → PR → merge → it's live. Then request indexing (§7).
7. Post a teaser on the LinkedIn company page.

---

## 10. AI automation (`.claude/skills/`)

The repo ships two Claude Code skills:
- **`insight-radar`** — researches, ranks, humanises and publishes the monthly
  "Oil & Gas Technology Radar" insight article, with a citation ledger in
  `insights-data/`. Run via `/insight-radar` in Claude Code. Every claim must be
  sourced and every source must resolve — a thin honest edition beats a padded one.
- **`humaniser`** — rewrites copy so it doesn't read as AI-generated.

These are optional power tools, not required to run the site. If you don't use
Claude Code, ignore them — but keep `insights-data/` intact, the radar relies on it.

---

## 11. Operations & troubleshooting

| Task | How |
|------|-----|
| **See live traffic** | Google Analytics → Reports (realtime + acquisition) |
| **See search performance** | Search Console → Performance (impressions, clicks, queries, position) |
| **Get a new page indexed** | Search Console → URL Inspection → Request Indexing |
| **Roll back a bad deploy** | Render → service → Deploys → Rollback; or `git revert` + push |
| **"My CSS/JS change isn't showing"** | Long immutable cache (`render.yml`). Hard-refresh (Ctrl/Cmd+Shift+R); for a forced bust, version the filename or query-string |
| **Site down** | Check Render deploy status first; then Cloudflare DNS; don't touch MX records |
| **Email down** | Zoho status + Cloudflare **MX** records — change these only with great care |
| **Manage 3D-model access keys** | Requests arrive at `info@alpha-technical-centre.com` (if Chris assigned you that inbox) |

---

## 12. Handover checklist (your first week)

- [ ] Confirm all access in §2 works
- [ ] Clone the repo and preview locally
- [ ] Read `README.md` and `STYLE-GUIDE.md`
- [ ] Make a trivial change on a branch → PR → get it reviewed → watch it deploy
- [ ] Log in to GA4 and Search Console; find the Performance report
- [ ] Skim each interactive tool so you know what's there
- [ ] Pick up a "known SEO to-do" from §7 as a first real task
- [ ] Agree with Chris on the review workflow (what needs a PR vs. direct-to-main)

---

## 13. Contacts

- **Owner / product decisions:** Chris Hopkinson — `info@alpha-technical-centre.com`
- **This document lives in the repo** — keep it updated as the site evolves.
