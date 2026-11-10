# sommNI 3.7.55 — lighter glasses bottle portraits

Bottle-only quantization uses seven native G2 brightness values: 0, 17, 34, 68, 102, 153, 204. The previous photographic renderer produced thirteen values (0–204 in steps of 17). Transparency, original pixel dimensions, peak brightness and the underlying full-detail photographs are preserved. Map shading and native text are unchanged.

Applied to Atlas bottle previews, Winebrary map overlays, bottle note views and the local glasses preview export. Original photographs and uploaded master artwork are not overwritten.

## Settings comparison

| View | Combined image size | Containers | Shading |
| --- | --- | --- | --- |
| Atlas globe / country | 244 × 244 | 2 × 244 × 122 | Coarse 51-step dithered fills, finer 17-step borders and glow |
| Atlas bottle | 244 × 244 | 2 × 244 × 122 | Seven bottle tones |
| Winebrary bottle/map | 200 × 252 | 2 × 200 × 126 | Seven bottle tones over the existing dithered map |
| Winebrary note bottle | 100 × 240 | 2 × 100 × 120 | Seven bottle tones |

All still use serialized lossless PNG transfers after quantization. The additional change is deliberately lossy in tonal detail, not image size.

## Verification

- App TypeScript and all 48 beta check groups passed.
- Beta build/package passed; no unapproved network origins.
- Browser comparison uses real catalog images, the actual stage renderer and actual PNG encoder at 244 × 244, summed over both tiles.
  - Grand Malbec: 1,972 → 1,614 bytes.
  - Booker MFN Chardonnay: 1,746 → 1,294 bytes.
  - Brice Heritage Brut Rosé: 2,599 → 2,044 bytes.
  - Combined: 6,317 → 4,952 bytes, 21.6% smaller than 3.7.54.
- Visual comparison retains readable major label features and bottle silhouettes. Small print is still constrained by G2 resolution.
- This measures payload savings, not real-device Bluetooth latency. Cold photo fetch/decode can still contribute to initial load time.
- Local comparison: tests/fixtures/bottle-tones.html (not part of the production entrypoint).
