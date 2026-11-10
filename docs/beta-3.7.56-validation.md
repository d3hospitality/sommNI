# sommNI 3.7.56 — native phone camera and photo picker

The reported failure was before recognition: opening the scanner inside Even showed no camera preview. The prior implementation used browser getUserMedia and HTML file inputs only, with SDK 0.0.9. The official SDK now provides captureImageFromCamera and pickImageFromAlbum; those were introduced in 0.0.11.

## Fix
- Pin SDK 0.0.16 and update both manifests. Minimum Even app remains 2.2.10, confirmed by pack metadata.
- Inside Even, Scan a Bottle opens the native phone camera. Open Camera retries capture; Choose Photo opens the native album. Returned image bytes enter the existing recognition/review/explicit-approval pipeline.
- Shared bottle-upload controls use the same native picker adapter, preserving their existing photo consumers.
- Native photo return supplies base64 bytes; never fetch the private phone path. Local PNG/JPEG/WebP data decoding no longer uses fetch(data:), avoiding unnecessary dependence on WebView networking.
- Scanner survives pagehide/visibility transitions during native capture. Closed/replaced/account-changed scans ignore late results. Native pickers cannot overlap.
- Browser getUserMedia live-grid preview is retained outside Even where supported. Native SDK capture is a still-image flow; this release does not claim a continuous embedded native camera stream.

## Verification
- App and site TypeScript passed; site build and beta pack passed; URL audit zero unapproved origins.
- 49 beta checks passed after SDK upgrade; added native upload-control regression passed separately (50 total checks, both new checks included in beta runner).
- Native adapter tests cover camera/album routing, cancel, permission error recovery, duplicate picker prevention, image-byte conversion and no local-path/data-URL fetch.
- Upload-control tests cover callback delivery, cancel, permission errors and ignoring returns into a removed screen.
- Photo tests now deliberately reject fetch(data:) and still pass resize, PNG alpha preservation, JPEG recognition conversion and old-WebView image decoding.
- Portrait browser fixture simulates native capture plus pagehide and reaches recognition review; cancel leaves Open Camera actionable. Fixture saves are mocked; no test wine is submitted.
- Official simulator renders Home animation and Atlas with SDK 0.0.16; no captured console errors/warnings during those checks.
- Physical phone camera permission and native capture still require validation on the user's device. Desktop browser/simulator tests cannot prove that hardware permission flow.

Official references checked November 10, 2026:
- https://hub.evenrealities.com/docs/get-started/overview
- https://raw.githubusercontent.com/even-realities/everything-evenhub/main/plugins/everything-evenhub/skills/sdk-reference/SKILL.md
- npm SDK package changelog and pinned 0.0.16 typings.
