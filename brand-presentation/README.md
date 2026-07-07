# Alpha Technical Centre — Presentation Brand Kit

Everything needed to brand a slide deck (PowerPoint, Keynote, Google Slides).

## ⚠️ Do this first — install the fonts
The brand fonts are **not** on most computers by default. Without them your deck
falls back to Arial/Calibri and won't look on-brand.

1. Download (free) from Google Fonts and install the `.ttf` files:
   - **Playfair Display** — fonts.google.com/specimen/Playfair+Display  (headings)
   - **Barlow** — fonts.google.com/specimen/Barlow  (body)
   - **Barlow Condensed** — fonts.google.com/specimen/Barlow+Condensed  (labels/eyebrows)
2. **PowerPoint (Windows):** File → Options → Save → **“Embed fonts in the file”**
   so the deck keeps the fonts on other machines.
3. **Keynote / PowerPoint (Mac):** install via Font Book; embedding support is limited —
   share as PDF for final distribution, or keep fonts installed on presenting machine.
4. **Google Slides:** no install needed — pick **Playfair Display**, **Barlow** and
   **Barlow Condensed** straight from the font menu (“More fonts”).

Fallbacks if a font truly can’t be used: headings → Georgia; body/labels → any
clean sans (Arial). It won’t match exactly, but stays legible.

## Colours (paste the HEX into the custom-colour picker)
| Name | HEX | RGB | Use |
|------|-----|-----|-----|
| Alpha Navy | `#0B1F3A` | 11, 31, 58 | Backgrounds, titles |
| Venezuela Gold | `#C9A84C` | 201, 168, 76 | Accents, key numbers, rules |
| Highlight Gold | `#E8C96A` | 232, 201, 106 | Hover/secondary accent |
| Cream | `#F8F5EE` | 248, 245, 238 | Light slide background |
| Steel | `#6B7A8D` | 107, 122, 141 | Muted/secondary text |
| White | `#FFFFFF` | 255, 255, 255 | Text on navy |

Rule of thumb: ~70% navy/neutral, ~25% white/cream, ~5% gold.

## Logos — which file, where
All are **transparent background**, so they sit on any slide colour.

| File | Use on |
|------|--------|
| `logo-lockup-light.png` | Light/white/cream slides (navy wordmark) |
| `logo-lockup-dark.png` | Navy/dark slides (white wordmark) |
| `mark-gold.svg` / `.png` | Small corner mark / bullet / section tab |
| `mark-white.svg` | The mark on a dark slide |
| `mark-navy.svg` | The mark on a light or gold slide |

**SVG** = infinitely sharp at any size (best for PowerPoint/Keynote if supported).
**PNG** = universal fallback (rendered at 3× for crisp scaling).

Do: keep clear space around the logo; place on a quiet area.
Don’t: stretch, recolour, add shadows, or rebuild the wordmark in another font.

## Type hierarchy for slides
- **Title:** Playfair Display Bold, Alpha Navy (or white on navy). Lift one word in gold.
- **Eyebrow/label:** Barlow Condensed, UPPERCASE, letter-spaced, gold.
- **Body/bullets:** Barlow Regular.
- **Big stat numbers:** Barlow Condensed Bold, gold.
