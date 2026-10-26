# Figure Guide

Conventions for writing figures in the question bank, so every item looks
consistent and renders safely.

## Format

**Inline SVG is the primary format.** It is written directly into the question
bank JSON — plain text, so it lives in git, can be diffed and reviewed, stays
sharp at any screen size, and needs no binary uploads.

```jsonc
"figure": {
  "kind": "svg",
  "svg": "<svg viewBox=\"0 0 220 150\" xmlns=\"http://www.w3.org/2000/svg\">...</svg>",
  "alt": "Trapesium ABCD dengan sisi sejajar 14 cm dan 8 cm, tinggi 6 cm",
  "caption": "Gambar 1"        // optional
}
```

Raster files are only for cases that are genuinely impractical as SVG, such as
photographs:

```jsonc
"figure": { "kind": "image", "src": "ipas/daur-hidup.png", "alt": "..." }
```

Those files go in `content/assets/` and are copied to `public/bank-assets/`
during `npm run bank:sync`. The `src` is relative to `content/assets/` and may
never be a URL.

> `alt` and `caption` are shown to students, so write them in Indonesian.

## Figures can attach in four places

| Location | Field |
|---|---|
| Reading passage | `stimuli[].figure` |
| Question stem | `questions[].figure` |
| Each answer option | `questions[].choices[].figure` |
| Explanation | `questions[].explanationFigure` |

Illustrated options are shuffled along with their option — shuffling moves the
whole option object, so a figure can never end up beside another option's text.

## Hard rules (enforced by `npm run bank:validate`)

1. **A `viewBox` is required.** Without it the figure cannot scale responsively.
   Do not set fixed pixel `width`/`height`.
2. **`alt` is required and must be descriptive** (at least 8 characters). Put
   the measurements and important labels in it, because `alt` is what a student
   gets if the figure fails to render.
   - Good: `"Diagram batang hasil panen 5 desa, tertinggi Desa Melati 45 ton"`
   - Bad: `"gambar"`, `"diagram"`
3. **Forbidden**: `<script>`, `<foreignObject>`, `<iframe>`, `<image>` pointing
   at an external URL, event attributes (`onload`, `onclick`), `@import`,
   `javascript:`.
4. **32 KB maximum** per figure.

## Visual conventions

- **Canvas** `viewBox="0 0 W H"`, width 200–360, height 120–260. Leave at least
  10 units of inner margin so labels are not clipped.
- **Colour follows the theme.** Use `currentColor` for strokes and text so the
  figure adapts to both light and dark mode. For fills use
  `fill="currentColor" fill-opacity="0.12"`. Avoid absolute colours such as
  `#000` or `white`.
- **Strokes**: `stroke="currentColor" stroke-width="2"`; construction lines
  dashed with `stroke-dasharray="4 3"` at `stroke-width="1.5"`.
- **Text**: `font-size="13"`, `fill="currentColor"`. Vertex labels are capitals
  (A, B, C, D) placed outside the shape, about 6 units from the point.
- **Measurements** sit next to the side they describe, with units
  (`14 cm`), `text-anchor="middle"`.
- **Right angles** are drawn as a small 8×8 unit box at the vertex.
- **Bar and line charts**: axes in `currentColor`, bars
  `fill="currentColor" fill-opacity="0.25"`, and label the value above each bar
  so the item is still readable when the figure is small.
- **Pie charts**: use `path` with an `A` (arc) command, and put the percentage
  inside the sector when it fits, otherwise in a legend alongside.

## Example: labelled rectangle

```xml
<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg">
  <rect x="30" y="30" width="160" height="90" fill="currentColor"
        fill-opacity="0.12" stroke="currentColor" stroke-width="2"/>
  <text x="110" y="22" font-size="13" fill="currentColor" text-anchor="middle">18 cm</text>
  <text x="205" y="80" font-size="13" fill="currentColor" text-anchor="middle">10 cm</text>
  <text x="24" y="28" font-size="13" fill="currentColor" text-anchor="end">A</text>
  <text x="196" y="28" font-size="13" fill="currentColor">B</text>
</svg>
```

## Example: bar chart

```xml
<svg viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg">
  <line x1="40" y1="20" x2="40" y2="140" stroke="currentColor" stroke-width="2"/>
  <line x1="40" y1="140" x2="265" y2="140" stroke="currentColor" stroke-width="2"/>
  <rect x="55" y="60" width="30" height="80" fill="currentColor" fill-opacity="0.25"
        stroke="currentColor" stroke-width="1.5"/>
  <text x="70" y="54" font-size="12" fill="currentColor" text-anchor="middle">40</text>
  <text x="70" y="155" font-size="12" fill="currentColor" text-anchor="middle">Sen</text>
</svg>
```

## Quick check

After writing an illustrated batch:

```bash
npm run bank:validate
npm run bank:stats     # the "Bergambar" column shows figure coverage
```

Then open **Admin → Bank soal**, filter to the strand you just wrote, and look
at the preview — including tapping to zoom at phone width.
