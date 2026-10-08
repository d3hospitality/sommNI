# wineLENS site media

All UI images are real app/simulator captures supplied in the task. No generated interface screenshots.

| Output | Source | Processing |
| --- | --- | --- |
| g2-notes.webp | wineLENS-study-slice/G2-notes-v2-before-after.png | AFTER capture only: x=0, y=632, width=1152, height=576; lossless WebP |
| g2-atlas.webp | wineLENS-study-slice/G2-catalog-globe.png | Top display: x=0, y=0, width=576, height=288; lossless WebP |
| g2-study.webp | wineLENS-study-slice/G2-study-reveal.png | Lossless WebP |
| g2-library.webp | wineLENS-G2-Claude-Pass/screens/F-library.png | Lossless WebP |
| phone-atlas.webp | wineLENS-study-slice/phone-atlas-card.png | WebP quality 85 |

Source root: ~/Documents/Codex/2026-09-29/can-you-do-a-deep-audit/outputs/.
Converted with cwebp. G2 display green is the simulator's rendering. Hero artwork frames a real capture; the 3D viewer composites these captures onto the model. Both are labelled. No model video or unrelated PolyGot media is shipped.

## 3D renders (September 30, 2026)
The g2-notes / g2-library / g2-atlas / g2-study flat captures were replaced by renders:
- `site/public/g2b/media/winelens/glasses-*.png`: real wineLENS simulator captures (automation port 9899),
  576 × 288, on black. Winebrary and Atlas-region captures use the built-in sample collection (dev fixture).
- `site/public/media/lens/*.webp`, `site/public/g2b/out/winelens/*`: the vendored G2B stage (3D Even G2 model,
  `site/public/g2b/ERG2B.web.glb`) with those captures on the lenses, rendered by `tools/render-showcase.cjs`
  from the live page. Renders, not photographs; display colour is simulated.

## Find My Wine, Study and wine cards (October 8, 2026)
- `site/public/g2b/media/winelens/glasses-finder.png`: real wineLENS capture from the Even Hub simulator 0.9.5
  (automation port 9911), 576 × 288 on black: Find My Wine picks for Dinner · Steak & red meat · Red · Bold & powerful.
- `site/public/g2b/media/winelens/glasses-study.png`: replaced with a Study seasons flash card (Regions 1, Tuscany),
  same simulator.
- `site/public/media/lens/still-finder.webp`, `still-study.webp`: rendered by `tools/render-showcase.cjs stills
  still-finder,still-study` (SwiftShader on Linux; the other stills are unchanged Metal renders).
- The wine card in the Wine cards section is an HTML/SVG illustration (an original bottle and label, with the catalog's
  Grand Malbec notes), labelled ILLUSTRATION. It is not a capture.
