# wineLENS Wine Atlas — implemented prototype + integration handoff

Date: 29 September 2026. Requested by Romario: a 3D globe with outlined countries, country highlighting and a dithered glow while scrolling on G2, then a closer view of a selected wine region.

## Run it

- Phone/browser: http://localhost:5186/sommNI/atlas.html
- Isolated Even simulator: automation port 9901, launched with `--no-glow`; the renderer supplies its own restrained highlight. Existing wineLENS 9899 and PolyGot 9898 are separate.
- Code lives in `work/winelens-release` on the current wineLENS draft-PR branch. No changes to Main, events, pages, image-utils, bottle or study files were needed for this prototype.
- This is a functioning standalone Even Hub page and a reusable module, **not yet a replacement for the main app's existing country/grape navigation**. The main catalog still uses its original globe until integration.

## Implemented behavior

1. Scroll a country: an orthographic 3D globe rotates to its location and highlights its actual outline. All 242 Natural Earth country/territory shapes provide the background geography. The navigation list includes the 62 countries represented by assigned winerymap groups.
2. Tap: enter that country's region list; its highlighted region is framed in a closer geographic view.
3. Scroll the regions: the view follows their calculated winery-cluster centers.
4. Tap a region: zoom farther to its winery locations. Each dot is a source point. The interface explicitly identifies clusters as different from appellation boundaries.
5. Double tap: detail → regions → countries. The module accepts an `onExit` callback so the integrated app can return to Home from countries.
6. Phone: country/region selectors, smooth 420 ms camera transitions, keyboard controls, mobile layout and reduced-motion support. A G2 layout preview is visible beside the globe.

## Files

- `src/atlas/renderer.ts`: inverse orthographic projection, country-ID texture, per-pixel borders, stable Bayer dithering, low-intensity shading, country highlights and region point rendering. Antimeridian wrapping and hemisphere clipping are inherent in the inverse projection. Microstates too small to occupy a pixel get a locator.
- `src/atlas/navigator.ts`: one country/region/detail state model shared by browser and G2.
- `src/atlas/glasses.ts`: five-container 576×288 layout, two 244×122 image tiles, one capture text container, scroll/tap/back gestures. Handles SDK 0.0.9's omitted zero-valued click enum on system events.
- `src/atlas/transport.ts`: serial bridge operations, latest-selection cancellation and a stalled-link stop. It never releases a timed-out operation's queue to start overlapping bridge traffic. Reload is required after a stalled link.
- `src/atlas/demo.ts`: standalone companion and Even-host startup. Ordinary desktop browsers do not attempt a glasses takeover.
- `public/atlas.html`, `public/atlas/*`: portable preview, offline map data, renderer bundle and retained licenses.
- `scripts/build-atlas-data.py`: reproducible asset generation from pinned source commits (Python + Pillow).
- `scripts/build-atlas.mjs`: rebuild the portable JS bundle using the existing Vite/esbuild dependency.
- `tests/atlas.cjs`, `.github/workflows/atlas.yml`: geography, navigation, renderer and transfer regression checks.

Run `node scripts/build-atlas.mjs` after TypeScript changes, then `npm run build`. The current application build copies the prebuilt public preview. Main-app integration should import the TypeScript modules directly and lazy-load map assets; it does not need to import the preview bundle.

## Geographic evidence and limitations

[winerymap](https://github.com/oOo0oOo/winerymap) is an MIT-licensed Leaflet/vanilla-JS project. Its README describes data collected August–October 2024. The pinned dataset contains **34,178 points in 2,078 source groups**. It supplies point positions, winery labels and grouped region names. Its code calculates regional centers from points; it does not include appellation polygons.

This prototype retains **31,247 assigned points in 2,077 named groups**. The source's **2,931 `Unknown` points** are accounted for but excluded from country/region views. Country association is by explicit source-country suffix and explicit aliases, not a guessed geographic match. These associations are inherited from the source and have not all been independently audited.

Country geometry uses [Natural Earth 1:50m admin-0](https://github.com/nvkelso/natural-earth-vector), whose maps are [public domain](https://www.naturalearthdata.com/about/terms-of-use/). The 242 features include territories; this count is not a count of sovereign states. Simplified borders follow the source cartography.

Pinned inputs:
- Winerymap: `6aa35599993104b378cd86ed24eb2d76a0be60f8`.
- Natural Earth: `ca96624a56bd078437bca8184e78163e5039ad19`.
- Source URLs, SHA-256 hashes and exclusion accounting: `public/atlas/atlas-data.json`.
- Source and SDK licenses are retained in `public/atlas`.

Regions are not joined to wineLENS's catalog yet. A source group such as “Bordeaux” may contain only a subset of the area's wineries; a point group must not be treated as the legal boundary or complete regional inventory. Zoom framing uses the 95th-percentile point distance to resist outliers; a few distant points can fall outside the viewport. Current dots are geographic discovery data, not verified wine-production claims.

## G2 rendering decisions

The renderer produces 16-level-compatible grayscale values, with output capped below full white. Low-level land uses sparse ordered dithering because faint grayscale can appear surprisingly bright in the simulator. Selected borders and winery dots carry the strongest light; black stays unlit.

The phone can animate camera movement. G2 receives a settled raster after 180 ms; it does not stream the phone animation over BLE. Text updates lead image transfers. Each 244×122 PNG is sent sequentially. Two image tiles improve detail, but they are not an atomic display transaction: a brief mixed-half transition is possible while updating, and hardware throughput must be measured. No hardware frame-rate claim is made.

Validation completed:
- 178 automated assertions, including every one of the 62 navigable countries, known geographic coordinates, quantized levels, microstate locator, 576×288 bounds, image-size limits, no overlap, one event capture, rapid-scroll cancellation, single-flight transport and stalled-link handling.
- Browser navigation country → region → detail → back, no browser bridge error, mobile width 390 with no horizontal overflow.
- Actual Even simulator input: France → Italy → Valpolicella Classico → close focus; double tap back through both levels. No error entries in the simulator console.
- TypeScript typecheck and production build pass.
- Physical G2/R1 brightness, transfer speed, reconnects and input feel remain to be tested.

## Claude's integration task

First review the live prototype and the `G2-*.png` evidence. Preserve Romario's Chroma/Atelier visual direction, the new study engine and the corrected bottle pipeline.

1. Add a `Wine Atlas` entry to the main glasses Home and a phone Discover entry. Append the Home entry or update all indexes deliberately; avoid silently shifting wine-type selection.
2. Lazy-load `GlobeRenderer.load(new URL('atlas/', baseUrl).href)` and construct `AtlasNavigator`. Create `AtlasGlasses` with the main bridge, an `onChange` callback for phone synchronization, an error UI callback and an `onExit` callback that rebuilds Home.
3. Give Atlas explicit display ownership. While active, its handler should consume events before catalog handlers. On exit or any phone-triggered takeover, await `close()` before letting another module send bridge operations. Coordinate with bottle/study image queues; separate queues must never send concurrently. The standalone module's queue owns only its own traffic.
4. Reuse the renderer to replace the static country image in existing catalog browsing. Use that page's actual tile dimensions/container IDs, its country list and the existing app-wide image queue. Do not register a second uncoordinated transport for the same display.
5. Keep country → grape → wine browsing working. Introduce region filtering only after an explicit catalog-region mapping is reviewed. Unknown/ambiguous mappings stay available through existing browsing. Winerymap points alone do not prove which wine belongs to which appellation.
6. For verified region shapes, add a geometry record with authority, source URL, effective date, CRS, license and review status. Prefer appellation authorities/official geographic registries. Until those polygons exist, retain point-cluster labeling and do not invent regional borders.
7. Add the Atlas build/test steps to the consolidated app workflow when merging; this prototype already includes its own workflow.

Acceptance: launch from Home; scroll changes country and map together; tap/back traverses all levels; rapid input ends on the selected country; opening Study or Winebrary from the phone relinquishes Atlas first; offline map data loads; plain browsers never claim a G2 connection; unknown regions never disappear from wine discovery.

## Learning depth for the next product slice

- **Place recall:** show a highlighted country without its label, ask the learner to name it, then reveal. A viewed map does not count as a correct recall.
- **Region orientation:** ask “Which part of Italy?” before zooming from Italy into the verified region. Use a sourced polygon when the question requires an exact boundary; a source cluster supports approximate orientation only.
- **Wine-to-place:** connect a verified catalog wine to its region, then return that source-backed card through the existing spaced-review engine.
- **Compare two places:** alternate two already-verified wine origins; add climate/altitude/grape claims only when each is separately sourced. Never infer those facts from dot density.

These learning modes are proposed, not implemented or scored in this prototype.
