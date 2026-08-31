# Alpha Technical Centre — Situation Room

Operator-facing energy dashboard for `alpha-technical-centre.com` or `alpha.energy`.
Navy / gold branding matches the Technical Centre site.

## What it shows

- Live (or last-reference) WTI, Brent, Henry Hub, RBOB, heating oil, gold, DXY, VIX
- Book of business: US Gulf Coast, Venezuela watch, UK option, Ukraine PSA
- Theatre map with chokepoints and asset pins
- Energy-weighted maritime status
- Public intelligence tape (Google News RSS when the proxy allows, otherwise seeded wires)
- Houston / London / Caracas / Kyiv clocks

## Files

```
index.html
styles.css
app.js
README.md
```

Drop the folder on any static host, or copy `index.html` into the existing site as `/situation-room/`.

Needs outbound HTTPS for:

- fonts.googleapis.com
- unpkg.com (Leaflet)
- query1.finance.yahoo.com and/or corsproxy.io / api.allorigins.win
- earthquake.usgs.gov
- cartocdn.com map tiles

If a corporate firewall blocks those, the page still renders on the 27 Aug 2026 reference marks baked into `app.js`.

## Password gate

In `app.js`:

```js
const AUTH_ENABLED = false;
const AUTH_CODE = "alpha-internal";
```

Set `AUTH_ENABLED` to `true` before a public URL. This is a browser-side gate only — it keeps casual visitors out. It is **not** real security. For a production lock use basic auth, Cloudflare Access, or the host’s password page.

## What this is not

- Not a Palantir / World Monitor clone
- Not live AIS or flight tracking
- Not a substitute for Bloomberg
- Not investment advice

Next upgrades if you want them: EIA key for official cash prices, password at the host, a Venezuela field panel, TPIC lifting-cost / production strip, or an iframe embed on the Technical Centre nav.
