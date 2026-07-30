# Article spec

House format for a radar edition, and the JSON the publish script consumes.

---

## Shape of the article

Budget **250 to 350 words per development**, plus about 120 for the opening and
the closing read. So roughly 1,200 words for a four-item edition and 2,400 for
eight. Do not hold a total word count fixed across editions: each development
has to carry what it is, what was measured, who did it and where, what it is
good for, and the honest limit. That is five things, and under about 250 words
one of them gets dropped, which is always the limit.

The lead development may run to about 500 words, because it carries the most
quantitative content and the reader who stops after it should still be served.
Every other section holds to 350.

If a section runs past its budget, the usual cause is explaining the method at
greater length than the reader needs. Cut the method, keep the numbers and the
benefit. Never cut the limit.

1. **Standfirst** (2–3 sentences). What this month's edition covers and the one
   thing a reader should take from it. Name the single most consequential
   development here.
2. **Radar table** — the ranked list, immediately after the standfirst. A reader
   who stops here should still have got their money's worth.
3. **One section per development**, strongest first, `<h2>` each. Per section:
   - What it is, in plain terms, in the first sentence.
   - What was actually measured or built, with the numbers, cited.
   - Who did it and where — operator, basin, well count.
   - **What it is good for**: the concrete benefit, tied to a decision an asset
     owner or investor makes. This is the part readers come back for. Be
     specific: which workflow it replaces, what it costs, what it saves.
   - The honest limit. Sample size, unreplicated result, paywalled data, vendor
     source, or a caveat the authors themselves flag.
4. **What we would use, and where** — one short section giving the firm's own
   read: which of these would change how a field development plan, a redevelopment
   screen or a due-diligence review gets done, and which are worth watching only.
   This is the section that distinguishes the series from an aggregator.
5. **Sources** — rendered automatically from the references array.
6. **Method note** — rendered automatically from `method`; one or two sentences
   on the window searched, how many items were screened, and what was excluded.

Every factual claim carries an inline citation: `<sup><a href="#ref-3">3</a></sup>`
immediately after the claim, before the full stop.

## Writing rules

Write it the way the humaniser skill demands — **run the humaniser over the body
before publishing, every time**. In particular:

- No em dashes. Commas, colons, brackets, full stops.
- Straight quotes and apostrophes.
- No "underscores", "showcases", "pivotal", "robust", "landscape", "leverage".
- No "not just X, but Y". No rule-of-three padding.
- Say "is" and "has".
- Attribute vendor claims to the vendor in the sentence.
- No hedged attribution to nobody. Name the source or drop the claim.
- No closing paragraph that restates the article.

British spelling, matching the rest of the site: *modelled*, *rigour*,
*optimisation*, *behaviour*. Keep US spelling inside quoted titles and
organisation names.

Technical vocabulary stays technical. The audience is petroleum engineers,
geoscientists and the investors who hire them. Do not explain what porosity is.

---

## Edition JSON

```json
{
  "slug": "2026-08-technology-radar",
  "edition": "2026-08",
  "iso_date": "2026-08-04",
  "date_label": "August 2026",

  "title": "Technology Radar, August 2026: Ocean-Bottom Nodes, NMR Rebound and the P&amp;A Cost Curve",
  "hero_title": "Technology Radar: <em>August</em> 2026",
  "standfirst": "Eight developments across the technical stack, ranked by evidence and impact. The one that matters most this month is ...",
  "desc": "Monthly review of oil and gas technical developments across seismic, geological modelling, petrophysics, reservoir engineering, production, completions, facilities and commercial, ranked by evidence quality and potential impact.",
  "tag": "Insights &middot; Technology Radar",

  "card": {
    "eyebrow_en": "TECHNOLOGY RADAR",
    "eyebrow_es": "RADAR TECNOLÓGICO",
    "title_en": "Technology Radar, August 2026",
    "title_es": "Radar Tecnológico, agosto de 2026",
    "blurb_en": "Eight developments across seismic, petrophysics, reservoir and facilities, ranked by evidence and impact, with what each is actually good for.",
    "blurb_es": "Ocho avances en sísmica, petrofísica, yacimientos e instalaciones, clasificados por evidencia e impacto.",
    "gradient": "linear-gradient(135deg,#0B1F3A 0%,#162F50 100%)"
  },

  "cta": {
    "title": "Want this applied to your asset?",
    "text": "Alpha Technical Centre builds integrated field development plans and runs independent technical due diligence, using the methods worth using.",
    "href": "oil-gas-modelling.html",
    "label": "Oil &amp; Gas Modelling"
  },
  "prev": { "href": "insights-2026-07-technology-radar.html", "label": "July 2026 edition" },

  "radar": [
    {
      "name": "Sparse OBN for shallow-water 4D",
      "discipline": "Seismic acquisition",
      "readiness": 3,
      "readiness_label": "Field-proven",
      "tier": "E1",
      "impact": "Cuts 4D survey cost enough to make monitoring viable on mature shelf assets.",
      "ref": [1, 2]
    }
  ],

  "body": [
    { "type": "p",       "html": "Opening paragraph." },
    { "type": "radar" },
    { "type": "h2",      "text": "Sparse ocean-bottom nodes reach shallow water" },
    { "type": "p",       "html": "Claim with a citation<sup><a href=\"#ref-1\">1</a></sup>." },
    { "type": "pull",    "html": "A short quotable line." },
    { "type": "callout", "html": "A boxed aside: what this replaces, and what it costs." },
    { "type": "stats",   "items": [ { "val": "38%", "lbl": "survey cost reduction, 12-well pilot" } ] },
    { "type": "list",    "items": [ "One point.", "Another point." ] },
    { "type": "divider" }
  ],

  "references": [
    {
      "authors": "Nakamura, T., Owusu, K.",
      "year": "2026",
      "title": "Sparse-node ocean-bottom acquisition for time-lapse monitoring in water depths under 60 m",
      "publication": "Geophysics, 91(4)",
      "url": "https://library.seg.org/doi/10.1190/geo2026-0123.1",
      "tier": "E1",
      "access": "paywall",
      "verified": true,
      "note": "Abstract read; results table reproduced in the authors' SEG expanded abstract."
    }
  ],

  "method": "<strong>Method.</strong> Sources published between 1 and 31 July 2026 across SPE, SEG, AAPG, SPWLA, EAGE, DOE/NETL and the regulator filings listed in the source registry. 63 items screened, 8 reported. Items with no primary technical source were excluded."
}
```

### Field notes

- **`slug`** — no `insights-` prefix; the script adds it. Use
  `YYYY-MM-technology-radar` so the archive sorts naturally.
- **`title`** — plain text, HTML-escaped (`&amp;`). Used in `<title>`, OG,
  Twitter and JSON-LD. The script appends the site suffix.
- **`hero_title`** — the on-page `<h1>`. One `<em>` allowed; it renders gold.
  Keep it shorter than `title`.
- **`desc`** — one sentence, under ~160 characters for search results.
- **Body `html` fields are inserted as raw HTML.** Escape `&` as `&amp;`
  yourself. `<em>`, `<strong>`, `<a>`, `<sup>` are the sanctioned inline tags.
- **`text` fields** (h2 only) are also raw HTML but should be plain.
- **`access`** — one of `open`, `paywall`, `abstract`, `preprint`,
  `registration`. Be accurate; this is the reader's warning about what they can
  actually click through to.
- **`verified`** — must be `true`, and must mean you fetched the URL in this run
  and it resolved to the cited work. The script refuses to publish otherwise.
  This is the single most important field in the file.
- **`note`** — optional, and the right place to be honest: what you could and
  could not read.
- **`prev`** — the previous edition, from the ledger. For the first edition,
  point at a relevant capability page instead.

### Components available in `body`

| type | renders |
|---|---|
| `p` | body paragraph |
| `h2` | section heading with the gold top rule |
| `radar` | the ranked table (include exactly once) |
| `pull` | large pull quote |
| `callout` | boxed aside, gold left border |
| `stats` | horizontal row of figure + label cells |
| `list` | plain bulleted list |
| `divider` | gradient rule |

`stats` works best with two or three cells and short labels. Do not use it as a
substitute for prose.

---

## Publishing

```bash
python3 .claude/skills/insight-radar/scripts/publish_edition.py edition.json --dry-run
python3 .claude/skills/insight-radar/scripts/publish_edition.py edition.json
```

The script writes `insights-<slug>.html`, puts the new card at the top of the
Insights grid, moves cards past the sixth into the archive list on the same
page, adds the sitemap entry, bumps `insights.html`'s `lastmod`, and appends the
edition to `insights-data/radar-ledger.json`.

It fails on: an unverified reference, a citation pointing at a reference that
does not exist, a reference nothing cites, a missing bilingual card field, no
E1/E2 source, fewer than four references, or an existing file without `--force`.

It warns, without failing, on em dashes, curly quotes and flagged vocabulary in
the body. Treat any warning as a defect and fix it before committing.
