# wineLENS / Focus Pour

The supplied wine-glass/focus-frame reference was simplified into a compact mark: one wine line, a short stem, open optical corners, and no sparkle or shaded liquid. Chroma composition and Atelier colours remain the visual direction.

## Masters and exports

`identity.json` is the source geometry and palette. `wordmark.json` contains the Space Grotesk glyph outlines used on glasses. The wordmark SVGs contain paths, not live text; they do not need a font installed. The OFL font files and licence are included in `fonts/`.

`public/brand/` includes primary, reverse, black and white marks; a distinct micro mark; outlined horizontal lockups; favicons; Apple/app/maskable icons; a 120px Google branding logo; a 1200×630 social card; native grayscale marks; and the actual 190×190 glasses panel.

Use oxblood `#772B39`, ivory `#FBF7EF`, blush `#E8D0CA`, olive `#8A9270`, and ink `#302822`. Olive is a supporting colour, not body text on ivory. Keep green confined to glasses previews. Preserve the exact spelling **wineLENS**.

## Usage

- Use the dedicated micro mark at 32px and below. The favicon has a cream backing for browser-theme contrast.
- Keep at least 20/128 of the mark's width clear around its outside edge. Avoid text or borders touching the focus corners.
- Do not stretch, rotate, emboss, add an AI sparkle, or introduce gradients into the logo.
- Default lockup height is 40–44 CSS px on desktop and 32–35 CSS px on phones.
- Use `maskable-*.png` for OS masking; the safe-area logo is smaller and the background fills the square.
- Bottle imagery remains prominent in wine lists and tasting notes; the large brand mark appears only in the existing home/finder brand panel.

## G2 implementation

`src/brand-mark.ts` draws the same vector geometry directly to the production 190×190 canvas. It includes the outlined wordmark and quantizes to 16 grayscale levels. Black is off; white is full illumination. `src/image-utils.ts` sends the existing two 190×95 halves through the existing serial queue. Container IDs, page counts, event capture, catalog, tasting notes and graceful exit logic are unchanged. No image network fetch, font load, new image container, or animation is needed.

The native export was verified for dimensions, grayscale channels and 16-level quantization. The interactive preview's menu typography and green glow are illustrative. Physical G2 optical brightness and final legibility still require device acceptance.

## Build

Asset tooling is separate from the app's runtime dependencies. Use Node with `fontkit@2.0.4`, `sharp`, TypeScript, and `@napi-rs/canvas` available through `NODE_PATH`:

```sh
node brand/build.cjs
node brand/export-g2.cjs
```

The dev-only `brand-preview.html` uses production exports and is intentionally not a Vite build entry. The web app and account page reference `./brand/`; the separate website references `/brand/`.

## Rollout and provenance

The account/app branch and the local site worktree have matching brand assets and header/favicon updates. Existing account, billing, legal, 3D-showcase and database work was preserved. Publication, Google logo upload/verification, store listing imagery, and a new beta package are separate actions; this branding pass does not claim they happened.

The raster concept exploration was made with the built-in image generation tool using the user's reference. It explores alternative shapes and serif typography; it is not the canonical production artwork. Production SVG/PNG exports are deterministic vector artwork; the installed wordmark uses Space Grotesk. Prompt records and the exploration image are in the output brand kit.
