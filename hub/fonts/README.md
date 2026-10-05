# Hub fonts

The three families the Hub uses, self-hosted so a blocked font CDN never drops every label into the system font
(wave 7, R14). The public site is untouched: `style.css` keeps its Google Fonts import, and only `hub/hub.css`
declares these files, with `font-display: swap`.

| Family | Weights | Files |
|---|---|---|
| Playfair Display | 400, 600, 700, 400 italic, 600 italic | `playfair-display-{400,600,700}.woff2`, `playfair-display-{400,600}-italic.woff2` |
| Barlow | 300, 400, 500, 600 | `barlow-{300,400,500,600}.woff2` |
| Barlow Condensed | 300, 400, 500, 600, 700 | `barlow-condensed-{300,400,500,600,700}.woff2` |

Latin subset (U+0000–00FF and the punctuation ranges), which covers English and Spanish. Fetched from Google Fonts'
WOFF2 endpoints on 5 October 2026. All three families are published under the SIL Open Font License 1.1
(Playfair Display © Claus Eggers Sørensen; Barlow and Barlow Condensed © Jeremy Tribby), which permits bundling
and self-hosting with this notice.

To refresh: request the same `css2?family=…` URL `style.css` imports with a modern browser user agent, take the
`latin` block of each `@font-face`, download its `url(...)` and save it under the name above.
