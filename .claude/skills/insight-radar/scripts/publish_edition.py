#!/usr/bin/env python3
"""Turn an edition JSON into a published insight article.

Writes the article page, inserts its card on insights.html (rolling older
cards into an archive list), updates sitemap.xml and appends to the radar
ledger. Refuses to run on unverified citations.

    python3 publish_edition.py edition.json [--repo DIR] [--force] [--dry-run]

See references/article-spec.md for the JSON schema.
"""

import argparse
import html
import json
import os
import re
import sys
from datetime import date

FEATURED = 6                      # cards kept on the Insights grid; older ones go to the archive
BASE = "https://www.alpha-technical-centre.com/"
TIERS = {"E1", "E2", "E3", "E4"}
READINESS = {1: "Lab / concept", 2: "Pilot", 3: "Field-proven", 4: "Commercial"}
ACCESS = {"open": "Open access", "paywall": "Paywalled", "abstract": "Abstract only",
          "preprint": "Preprint", "registration": "Free registration"}

# Words the humaniser flags. Style warnings only - never fatal.
AI_WORDS = """delve crucial pivotal robust vibrant seamless showcase showcasing underscore
underscores underscoring foster fostering leverage leveraging testament tapestry intricate
meticulous garner bolster bolstered enhance enhancing boasts comprehensive realm navigate
transformative cutting-edge game-changing empower empowering harness unlock elevate
additionally furthermore moreover holistic myriad plethora synergy cornerstone""".split()


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def esc(s):
    """Escape a string for use inside a double-quoted HTML attribute."""
    return html.escape(str(s), quote=True)


def strip_tags(s):
    return re.sub(r"<[^>]+>", "", str(s))


# ---------------------------------------------------------------- validation

REQUIRED_TOP = ["slug", "edition", "iso_date", "date_label", "title", "hero_title",
                "standfirst", "desc", "tag", "card", "cta", "prev", "radar",
                "body", "references"]


def validate(spec, repo, force):
    for k in REQUIRED_TOP:
        if not spec.get(k):
            die(f"missing required field: {k}")

    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{3,70}", spec["slug"]):
        die(f"slug must be lowercase alphanumeric with hyphens: {spec['slug']!r}")
    if not re.fullmatch(r"\d{4}-\d{2}", spec["edition"]):
        die(f"edition must be YYYY-MM: {spec['edition']!r}")
    try:
        date.fromisoformat(spec["iso_date"])
    except ValueError:
        die(f"iso_date must be YYYY-MM-DD: {spec['iso_date']!r}")

    filename = f"insights-{spec['slug']}.html"
    if os.path.exists(os.path.join(repo, filename)) and not force:
        die(f"{filename} already exists - pass --force to overwrite")

    # references
    refs = spec["references"]
    if len(refs) < 4:
        die(f"only {len(refs)} references; an edition needs at least 4")
    seen_urls = set()
    for i, r in enumerate(refs, 1):
        for k in ("title", "publication", "url", "tier", "access"):
            if not r.get(k):
                die(f"reference {i} missing {k}")
        if r["tier"] not in TIERS:
            die(f"reference {i} tier {r['tier']!r} not in {sorted(TIERS)} "
                "(E5 press-release-only sources may not be cited)")
        if r["access"] not in ACCESS:
            die(f"reference {i} access {r['access']!r} not in {sorted(ACCESS)}")
        if r.get("verified") is not True:
            die(f"reference {i} is not marked verified:true - every URL must be "
                "fetched and confirmed to resolve before publishing")
        if not r["url"].startswith(("http://", "https://")):
            die(f"reference {i} url must be absolute: {r['url']!r}")
        if r["url"] in seen_urls:
            die(f"reference {i} duplicates an earlier url: {r['url']}")
        seen_urls.add(r["url"])
    if not any(r["tier"] in ("E1", "E2") for r in refs):
        die("no E1 or E2 reference - an edition must rest on at least one "
            "peer-reviewed or society-published source")

    # radar rows
    n = len(refs)
    for i, row in enumerate(spec["radar"], 1):
        for k in ("name", "discipline", "readiness", "tier", "impact", "ref"):
            if row.get(k) in (None, ""):
                die(f"radar row {i} missing {k}")
        if row["readiness"] not in READINESS:
            die(f"radar row {i} readiness must be 1-4, got {row['readiness']!r}")
        if row["tier"] not in TIERS:
            die(f"radar row {i} tier {row['tier']!r} invalid")
        for rn in (row["ref"] if isinstance(row["ref"], list) else [row["ref"]]):
            if not isinstance(rn, int) or not 1 <= rn <= n:
                die(f"radar row {i} cites reference {rn}, which does not exist")

    # inline citations in the body must resolve
    body_html = " ".join(b.get("html", "") + b.get("text", "") for b in spec["body"])
    cited = set()
    for m in re.finditer(r'href="#ref-(\d+)"', body_html):
        k = int(m.group(1))
        if not 1 <= k <= n:
            die(f"body cites #ref-{k}, but there are only {n} references")
        cited.add(k)
    if not cited:
        die("body contains no inline citations - every development needs one")

    uncited = [i for i in range(1, n + 1)
               if i not in cited and not any(
                   i in (r["ref"] if isinstance(r["ref"], list) else [r["ref"]])
                   for r in spec["radar"])]
    if uncited:
        die(f"references {uncited} are listed but never cited in body or radar table")

    # card
    for k in ("eyebrow_en", "eyebrow_es", "title_en", "title_es", "blurb_en", "blurb_es"):
        if not spec["card"].get(k):
            die(f"card missing {k} (Insights cards are bilingual)")

    return filename


def style_report(spec):
    text = strip_tags(" ".join(
        [spec["standfirst"], spec["hero_title"]]
        + [b.get("html", b.get("text", "")) for b in spec["body"]]))
    warns = []
    em = text.count("—")
    if em:
        warns.append(f"{em} em dash{'es' if em > 1 else ''}")
    curly = sum(text.count(c) for c in "“”‘’")
    if curly:
        warns.append(f"{curly} curly quote/apostrophe character(s)")
    hits = {}
    low = text.lower()
    for w in AI_WORDS:
        c = len(re.findall(r"\b" + re.escape(w) + r"\b", low))
        if c:
            hits[w] = c
    if hits:
        warns.append("AI vocabulary: " + ", ".join(
            f"{w}x{c}" if c > 1 else w for w, c in sorted(hits.items())))
    words = len(text.split())
    print(f"  body: {words} words, {len(spec['references'])} refs, "
          f"{len(spec['radar'])} radar rows")
    if warns:
        print("  style warnings (run the humaniser skill over the body):")
        for w in warns:
            print(f"    - {w}")
    else:
        print("  style: clean - no em dashes, curly quotes or flagged vocabulary")
    return warns


# ---------------------------------------------------------------- rendering

def render_radar(rows):
    out = ['<div class="ins-radar-wrap">',
           '  <table class="ins-radar">',
           '    <caption>Ranked by evidence and potential impact</caption>',
           '    <thead><tr><th>Development</th><th>Discipline</th><th>Readiness</th>'
           '<th>Evidence</th><th>Why it matters</th></tr></thead>',
           '    <tbody>']
    for r in rows:
        refs = r["ref"] if isinstance(r["ref"], list) else [r["ref"]]
        sup = "".join(f'<sup><a href="#ref-{k}">{k}</a></sup>' for k in refs)
        rl = r.get("readiness_label") or READINESS[r["readiness"]]
        out.append(
            "      <tr>"
            f'<td>{r["name"]}{sup}</td>'
            f'<td><span class="ins-disc">{esc(r["discipline"])}</span></td>'
            f'<td><span class="ins-ready" data-r="{r["readiness"]}">'
            f'<span></span>{esc(rl)}</span></td>'
            f'<td><span class="ins-badge ins-badge-{r["tier"].lower()}">'
            f'{r["tier"]}</span></td>'
            f'<td>{r["impact"]}</td>'
            "</tr>")
    out += ["    </tbody>", "  </table>", "</div>"]
    return "\n".join(out)


def render_body(spec):
    parts = []
    for b in spec["body"]:
        t = b.get("type")
        if t == "h2":
            parts.append(f'  <h2>{b["text"]}</h2>')
        elif t == "p":
            parts.append(f'  <p>{b["html"]}</p>')
        elif t == "pull":
            parts.append(f'  <div class="ins-pull">\n    <p>{b["html"]}</p>\n  </div>')
        elif t == "callout":
            parts.append(f'  <div class="ins-callout">\n    <p>{b["html"]}</p>\n  </div>')
        elif t == "divider":
            parts.append('  <div class="ins-divider"></div>')
        elif t == "stats":
            cells = "".join(
                f'<div class="ins-stat"><div class="ins-stat-val">{i["val"]}</div>'
                f'<div class="ins-stat-lbl">{i["lbl"]}</div></div>'
                for i in b["items"])
            parts.append(f'  <div class="ins-stat-row">{cells}</div>')
        elif t == "radar":
            parts.append(render_radar(spec["radar"]))
        elif t == "list":
            items = "".join(f"\n    <li>{i}</li>" for i in b["items"])
            parts.append(f'  <ul class="ins-list">{items}\n  </ul>')
        else:
            die(f"unknown body block type: {t!r}")

    # references
    refs = ['  <div class="ins-refs">', "    <h2>Sources</h2>", "    <ol>"]
    for i, r in enumerate(spec["references"], 1):
        bits = []
        if r.get("authors"):
            bits.append(f'{r["authors"]}')
        if r.get("year"):
            bits.append(f'({r["year"]})')
        bits.append(f'<cite>{r["title"]}</cite>')
        bits.append(f'{r["publication"]}.')
        head = " ".join(bits)
        refs.append(
            f'      <li id="ref-{i}">{head} '
            f'<a href="{esc(r["url"])}" target="_blank" rel="noopener noreferrer">'
            f'{esc(r["url"])}</a>'
            f'<span class="ins-access">{r["tier"]} &middot; {ACCESS[r["access"]]}</span>'
            + (f' {r["note"]}' if r.get("note") else "")
            + "</li>")
    refs += ["    </ol>", "  </div>"]
    parts.append("\n".join(refs))

    if spec.get("method"):
        parts.append(f'  <div class="ins-method">{spec["method"]}</div>')

    return "\n\n".join(parts)


def render_article(spec, template, filename):
    body = render_body(spec)
    values = {
        "TITLE": spec["title"],
        "TITLE_PLAIN": strip_tags(spec["title"]).replace('"', '\\"'),
        "DESC": esc(strip_tags(spec["desc"])),
        "FILENAME": filename,
        "ISO_DATE": spec["iso_date"],
        "TAG": spec["tag"],
        "DATE_LABEL": spec["date_label"],
        "HERO_TITLE": spec["hero_title"],
        "STANDFIRST": spec["standfirst"],
        "BODY": body,
        "CTA_TITLE": spec["cta"]["title"],
        "CTA_TEXT": spec["cta"]["text"],
        "CTA_HREF": esc(spec["cta"]["href"]),
        "CTA_LABEL": spec["cta"]["label"],
        "PREV_HREF": esc(spec["prev"]["href"]),
        "PREV_LABEL": spec["prev"]["label"],
    }
    out = template
    for k, v in values.items():
        out = out.replace("{{" + k + "}}", str(v))
    left = re.findall(r"\{\{[A-Z_]+\}\}", out)
    if left:
        die(f"template placeholders left unfilled: {sorted(set(left))}")
    return out


# ------------------------------------------------------- insights.html cards

CARD = """    <!-- {edition} · {slug} -->
    <article class="news-card {reveal}">
      <a href="{filename}" style="text-decoration:none;color:inherit;display:block;">
        <div class="case-card-header" style="height:120px;background:{gradient};">
          <span class="case-card-region" style="position:absolute;top:20px;left:24px;" data-en="{eyebrow_en}" data-es="{eyebrow_es}">{eyebrow_en}</span>
          <span style="position:absolute;bottom:16px;right:20px;font-family:'Barlow Condensed',sans-serif;font-size:10px;letter-spacing:.12em;color:rgba(240,237,230,0.35);text-transform:uppercase;">{date_label}</span>
        </div>
        <div class="news-card-body">
          <h3 data-en="{title_en}" data-es="{title_es}">{title_en}</h3>
          <p data-en="{blurb_en}" data-es="{blurb_es}">{blurb_en}</p>
          <span class="news-card-date" style="color:#C9A84C;font-weight:600;" data-en="Read article &rarr;" data-es="Leer art&iacute;culo &rarr;">Read article &rarr;</span>
        </div>
      </a>
    </article>"""

ARCHIVE_CSS = """<style>
/* archive list - added by insight-radar when the Insights grid overflows */
.ins-arch{list-style:none;margin:0;padding:0;border-top:1px solid #D8DCE2;}
.ins-arch li{border-bottom:1px solid #D8DCE2;}
.ins-arch a{
  display:grid;grid-template-columns:132px 1fr auto;gap:22px;align-items:baseline;
  padding:17px 4px;text-decoration:none;color:inherit;transition:background .2s ease;
}
.ins-arch a:hover{background:rgba(201,168,76,0.06);}
.ins-arch .d{
  font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:600;
  letter-spacing:.16em;text-transform:uppercase;color:#6B7A8D;
}
.ins-arch .t{font-family:'Playfair Display',Georgia,serif;font-size:16px;font-weight:600;color:#0B1F3A;line-height:1.35;}
.ins-arch a:hover .t{color:#8A6F1F;}
.ins-arch .k{
  font-family:'Barlow Condensed',sans-serif;font-size:10px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:#C9A84C;white-space:nowrap;
}
@media(max-width:700px){
  .ins-arch a{grid-template-columns:1fr;gap:5px;}
  .ins-arch .k{display:none;}
}
</style>
"""

ARCHIVE_START = "<!-- insight-radar:archive:start -->"
ARCHIVE_END = "<!-- insight-radar:archive:end -->"


def parse_card(card):
    def grab(pat, default=""):
        m = re.search(pat, card, re.S)
        return m.group(1) if m else default
    return {
        "href": grab(r'<a href="([^"]+)"'),
        "date": grab(r'text-transform:uppercase;">([^<]+)</span>'),
        "title_en": grab(r'<h3 data-en="([^"]*)"'),
        "title_es": grab(r'<h3 data-en="[^"]*" data-es="([^"]*)"'),
        "eyebrow_en": grab(r'class="case-card-region"[^>]*data-en="([^"]*)"'),
        "eyebrow_es": grab(r'class="case-card-region"[^>]*data-en="[^"]*" data-es="([^"]*)"'),
    }


def reveal_for(i):
    d = min(2, (i + 1) // 2)
    return "reveal" if d == 0 else f"reveal reveal-delay-{d}"


def parse_archive(src):
    """Recover already-archived entries so the archive accumulates across runs."""
    if ARCHIVE_START not in src:
        return []
    block = src[src.index(ARCHIVE_START):src.index(ARCHIVE_END)]
    out = []
    for li in re.findall(r"<li><a .*?</a></li>", block, re.S):
        def grab(pat, default=""):
            m = re.search(pat, li, re.S)
            return m.group(1) if m else default
        out.append({
            "href": grab(r'<a href="([^"]+)"'),
            "date": grab(r'<span class="d">([^<]*)</span>'),
            "title_en": grab(r'<span class="t" data-en="([^"]*)"'),
            "title_es": grab(r'<span class="t" data-en="[^"]*" data-es="([^"]*)"'),
            "eyebrow_en": grab(r'<span class="k" data-en="([^"]*)"'),
            "eyebrow_es": grab(r'<span class="k" data-en="[^"]*" data-es="([^"]*)"'),
        })
    return out


def build_archive(entries):
    rows = []
    for p in entries:
        rows.append(
            f'      <li><a href="{p["href"]}">'
            f'<span class="d">{p["date"]}</span>'
            f'<span class="t" data-en="{p["title_en"]}" data-es="{p["title_es"]}">{p["title_en"]}</span>'
            f'<span class="k" data-en="{p["eyebrow_en"]}" data-es="{p["eyebrow_es"]}">{p["eyebrow_en"]}</span>'
            "</a></li>")
    return "\n".join([
        ARCHIVE_START,
        '<section class="section-cream" id="archive"><div class="wrap">',
        '  <div class="section-head">',
        '    <span class="label" data-en="Archive" data-es="Archivo">Archive</span>',
        '    <h2 data-en="Previous editions" data-es="Ediciones anteriores">Previous editions</h2>',
        "  </div>",
        '  <ul class="ins-arch">',
        *rows,
        "  </ul>",
        "</div></section>",
        ARCHIVE_END,
    ])


def update_insights(repo, spec, filename, dry):
    path = os.path.join(repo, "insights.html")
    src = open(path, encoding="utf-8").read()

    cards = re.findall(r'(?:[ \t]*<!--[^\n]*-->\n)?[ \t]*<article class="news-card.*?</article>',
                       src, re.S)
    if not cards:
        die("found no existing news-card articles in insights.html")

    new_card = CARD.format(
        edition=spec["edition"], slug=spec["slug"], filename=filename,
        reveal="reveal", gradient=spec["card"].get(
            "gradient", "linear-gradient(135deg,#0B1F3A 0%,#162F50 100%)"),
        date_label=spec["date_label"],
        **{k: esc(spec["card"][k]) for k in
           ("eyebrow_en", "eyebrow_es", "title_en", "title_es", "blurb_en", "blurb_es")})

    # drop any previous card for the same article (re-runs with --force)
    cards = [c for c in cards if f'href="{filename}"' not in c]
    ordered = [new_card] + cards

    featured, demoted = ordered[:FEATURED], ordered[FEATURED:]
    featured = [re.sub(r'<article class="news-card[^"]*"',
                       f'<article class="news-card {reveal_for(i)}"', c, count=1)
                for i, c in enumerate(featured)]

    # the archive is cumulative: newly demoted cards, then whatever was already
    # archived. Without this, every run would silently drop the oldest article.
    archived = [parse_card(c) for c in demoted]
    seen = {e["href"] for e in archived} | {filename}
    for e in parse_archive(src):
        if e["href"] not in seen:
            archived.append(e)
            seen.add(e["href"])

    # replace the contiguous span of existing cards with the new featured set
    first = re.search(r'(?:[ \t]*<!--[^\n]*-->\n)?[ \t]*<article class="news-card',
                      src).start()
    last = src.rindex("</article>") + len("</article>")
    out = src[:first] + "\n\n".join(featured) + src[last:]

    # archive block
    if ARCHIVE_START in out:
        a, b = out.index(ARCHIVE_START), out.index(ARCHIVE_END) + len(ARCHIVE_END)
        out = out[:a] + (build_archive(archived) if archived else "") + out[b:]
        out = re.sub(r"\n{3,}", "\n\n", out)
    elif archived:
        if ".ins-arch{" not in out:
            out = out.replace("</head>", ARCHIVE_CSS + "</head>", 1)
        out = out.replace("<footer class=\"footer\">",
                          build_archive(archived) + "\n\n<footer class=\"footer\">", 1)

    if not dry:
        open(path, "w", encoding="utf-8").write(out)
    return len(featured), len(archived)


def update_sitemap(repo, filename, iso, dry):
    path = os.path.join(repo, "sitemap.xml")
    src = open(path, encoding="utf-8").read()
    loc = f"{BASE}{filename}"
    if loc in src:
        src = re.sub(r"(<url><loc>" + re.escape(loc) + r"</loc><lastmod>)[^<]+",
                     r"\g<1>" + iso, src)
    else:
        entry = (f"  <url><loc>{loc}</loc><lastmod>{iso}</lastmod>"
                 "<changefreq>monthly</changefreq><priority>0.8</priority></url>\n")
        anchor = f"{BASE}insights.html</loc>"
        i = src.index(anchor)
        eol = src.index("\n", i) + 1
        src = src[:eol] + entry + src[eol:]
    src = re.sub(r"(<loc>" + re.escape(BASE) + r"insights\.html</loc><lastmod>)[^<]+",
                 r"\g<1>" + iso, src)
    if not dry:
        open(path, "w", encoding="utf-8").write(src)


def update_ledger(repo, spec, filename, dry):
    path = os.path.join(repo, "insights-data", "radar-ledger.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = {"editions": []}
    if os.path.exists(path):
        data = json.load(open(path, encoding="utf-8"))
    data["editions"] = [e for e in data["editions"] if e["edition"] != spec["edition"]]
    data["editions"].append({
        "edition": spec["edition"],
        "slug": spec["slug"],
        "filename": filename,
        "published": spec["iso_date"],
        "title": strip_tags(spec["title"]),
        "developments": [
            {"name": strip_tags(r["name"]), "discipline": r["discipline"],
             "tier": r["tier"], "readiness": r["readiness"],
             "urls": [spec["references"][(k if isinstance(k, int) else k) - 1]["url"]
                      for k in (r["ref"] if isinstance(r["ref"], list) else [r["ref"]])]}
            for r in spec["radar"]],
        "sources": [{"title": strip_tags(r["title"]), "url": r["url"], "tier": r["tier"]}
                    for r in spec["references"]],
    })
    data["editions"].sort(key=lambda e: e["edition"])
    if not dry:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    return path


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    spec = json.load(open(args.spec, encoding="utf-8"))
    filename = validate(spec, repo, args.force)

    tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "..", "assets", "article-template.html")
    template = open(os.path.normpath(tpl), encoding="utf-8").read()
    article = render_article(spec, template, filename)

    print(f"edition {spec['edition']} -> {filename}")
    style_report(spec)

    if not args.dry_run:
        open(os.path.join(repo, filename), "w", encoding="utf-8").write(article)
    feat, arch = update_insights(repo, spec, filename, args.dry_run)
    update_sitemap(repo, filename, spec["iso_date"], args.dry_run)
    ledger = update_ledger(repo, spec, filename, args.dry_run)

    print(f"  insights.html: {feat} featured card(s), {arch} in archive")
    print(f"  sitemap.xml + {os.path.relpath(ledger, repo)} updated")
    if args.dry_run:
        print("  DRY RUN - nothing written")
    else:
        print(f"\nwrote {filename}. Review it in a browser before committing.")


if __name__ == "__main__":
    main()
