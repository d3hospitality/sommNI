# Catalog bottles, tasting notes and exit — Beta 3.1.7

## Behavior

- Atlas country and region navigation still shows geography. Entering a region's wine list replaces the map with the selected bottle photograph; scrolling updates it after the cursor settles. The rendering preserves the photograph's proportions.
- Tapping a wine opens tasting notes. Double tap returns to the same region and selected wine. Input during this transition is consumed so a second tap cannot fall through to Home.
- A refused notes page restores the wine list. Missing photos leave the wine selectable without showing the previous wine's bottle.
- Double tap navigates back inside the app. At Home it requests the SDK confirmation dialog with `shutDownPageContainer(1)`. Cancel leaves the event listener active. Confirmed/system or abnormal exit unsubscribes once, releases display ownership, cancels pending images and finishes queued local writes.
- Foreground/background events are routed separately from gestures. Background pauses display updates and flushes local writes; Atlas resume restores its cursor.

## Hardware defect corrected

Catalog notes had a 288 × 10 image container for a one-pixel decorative rule. Winebrary's mapped notes used 288 × 8. The installed Even SDK documents an image minimum of 20 × 20 and maximum of 288 × 144. Both rule images now use a 20-pixel-high canvas while drawing a one-pixel line. This was a confirmed invalid hardware payload and a likely cause of the reported closure; the physical G2 crash itself was not reproduced locally.

Page preflight checks image dimensions, screen bounds, container counts, unique IDs, name lengths, content limits and exactly one capture container. It also exposed two overlong container names, now shortened. Page rebuilds use the image queue so a new page cannot replace a container during its image transfer. The offline grape-map fallback no longer recurses into itself.

## Validation

The new regression failed on all 215 catalog note layouts before the change. It now passes and exercises actual protobuf-style system taps, rapid scroll with an exact expected bottle raster, refused-page recovery, a second tap during the transition, return to the same wine, background/resume, cancel/confirmed exit, idempotent cleanup and nonoverlapping bridge sends.

All local checks passed: typecheck, production build, canonical IDs, catalog/navigation (306 pages), Winebrary glasses, study engine/glasses/phone, Atlas (178 assertions), robot-free layouts, 214 photographic bottle rasters and mocked account/vintage/photo UI flows.

The native Even simulator verified France → Champagne map → wine list → Dom Pérignon bottle → tasting notes → same selected wine → Home, without console warnings/errors. The notes page displays an explicit Back hint. Simulator screenshots are saved in the task's `outputs/wineLENS-catalog-fix` directory.

The simulator cleared the display when asked for the SDK exit dialog; its confirmation/cancel UI is not evidence of physical behavior. Cancel and confirmed-exit routing were verified with the mock SDK. Physical G2/R1 acceptance is still required, including repeat open/back, rapid scrolling, cancel/confirm and background/resume.

## Release

Package: `wineLENS-3.1.7-beta.ehpk`, built with the existing beta package ID and a relative asset base. Check the task output release record for publication status. Preparing this package does not mean it is published to Even Hub.
