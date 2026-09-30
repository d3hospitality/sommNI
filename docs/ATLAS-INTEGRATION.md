# Wine Atlas in wineLENS — integration notes

Builds on Codex's prototype (`docs/atlas/ATLAS-HANDOFF.md`, `src/atlas/`, unchanged here).

## Scope: only where wineLENS has wines
- Countries = catalog countries (15 today), ordered by catalog wine count.
- Regions = winerymap winery clusters **explicitly linked** to a catalog region in `src/data/atlas-region-links.json` (38 clusters today). Adding wines and their links widens the Atlas automatically.
- Link kinds: `exact-name` (same name, same country), `alias` (spelling/official-name variant, note says why), `broader-area` (the cluster contains the catalog region, e.g. Valle de Guadalupe → Baja California), `unmapped`. All are `review: pending`.
- `unmapped` (19): broad regions that span many clusters (Tuscany, Burgundy, Piedmont, Loire…) or names with no cluster. They stay fully browsable through Home › wine type › country › grape. No boundaries are invented; clusters are winery locations, not appellations.
- `tests/glasses.navigation.cjs` fails if a catalog region has no entry or a linked cluster does not exist in that country, so new wines force a mapping decision.

## Display ownership (`src/display.ts`)
- One owner at a time: `study`, `library`, `atlas`, or the catalog (default).
- `claimDisplay(name, release)` awaits the previous owner's release before a page is sent. Atlas release = `AtlasGlasses.close()` (its transport idle). Before Atlas opens, the app image queue is invalidated and awaited (`imageIdle`).
- Atlas consumes events before Study, Winebrary and the catalog while active. Double tap from its country list closes it and rebuilds Home.

## Catalog pages
- Country list: the globe shows the wine type's footprint (every catalog country lit, turned to the one with the most wines) + "Red · 10 countries / 117 wines". G2 lists scroll natively and the simulator sends no list scroll events; if hardware reports a hovered row, the globe and text follow that country.
- Grape list: the chosen country on the globe (replaces the decorative grape sprites).
- All catalog globe frames and the info-text upgrade go through the app-wide image queue (`sendSerial`/`pushGrayImage`), never a second transport.

## Phone
- Discover › Wine Atlas card: lazy mini globe, "Open on glasses" (only inside the Even app), "Explore on phone" link to `atlas.html` (plain browsers only), live line showing where the glasses are.

## Not done / next
- Physical G2 check: transfer time for 2×(244×122) and 2×(190×95) frames, brightness of the lit footprint, whether list scroll events exist on hardware.
- Review the pending links; add sourced polygons (authority, URL, effective date, CRS, licence) before any boundary claim.
- Study extensions (place recall, region orientation, wine-to-place) on the existing engine.
