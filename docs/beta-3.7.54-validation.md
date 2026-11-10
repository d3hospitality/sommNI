# sommNI 3.7.54 beta — scanner, image transfers and Study Today

Released 2026-11-10. Even Hub version ID 138636, beta promotion confirmed by CLI. Active testers install manually in the Even app.

## Changes
- Phone camera scanner with a gold outline, capture/research/review states, explicit approval and the existing Winebrary contribution pipeline. Native photo/file fallback; camera and pending lookups stop on cancellation. Contrast-based outline is an alignment aid, not semantic object recognition or 3D tracking.
- Photo research converts to bounded JPEG to match the endpoint; stored artwork retains PNG transparency. Failed cutout retains the original photo.
- Glasses bottle/map PNGs now use lossless DEFLATE compression, preserve serialized acknowledgements and stale-page cancellation, and remove an extra 100 ms wait per tile. Bottle hover settles at 80 ms; Atlas image scheduling at 60 ms.
- Study preloads a shared daily flight on startup, displays an accessible gold loading state, coalesces simultaneous requests, and lets glasses await the preload. Saved Flights remain visible through rerenders; a deliberately reopened older flight remains selected on G2.

## Evidence
- All 48 beta check groups passed; app and site TypeScript checks passed; site build and beta package build passed.
- Package URL audit: zero unapproved origins. Package 40,665,230 bytes.
- PNG tests independently inflate and compare grayscale pixels at all relevant tile dimensions; old-WebView fallback passes.
- Measured 200 x 126 px bottle/map tiles: 50,788 combined bytes before, 3,505 after (93.1% smaller). Compression took about 21 ms on first use and 1.3 ms for the second tile in this desktop sample. This is payload reduction, not a measured Bluetooth latency claim.
- Browser live check: November 10 flight loaded 20 questions across eight wines; Saved Flights listed seven dates and November 9 reopened successfully. Question/progress caching and concurrent preload/glasses behavior covered by tests.
- Portrait scanner fixture: moving catalog bottle, framing, review and explicit approval work; fixture save is mocked and submits no wine. Earlier live recognition identified Grand Malbec / Terrazas de los Andes / 2017 / Mendoza. Native camera inside the Even phone app still needs physical-device verification.

## Study persistence and cost
Questions are shared and persisted in Supabase per day, locale and catalog/prompt version. Reopening saved questions does not call generation. Answers and revisit markers currently stay on the device. The default study model is gpt-6.1-sol; SOMMNI_STUDY_MODEL may override it. Four five-question requests are used, each with a maximum of 7,000 completion tokens. Actual token usage is not currently recorded per flight, so no exact billed price is claimed.
At standard pricing checked November 10 ($2/M input and $10/M output tokens), an illustrative total of 10,000 input plus 10,000 output tokens is $0.12 for one shared flight, not per person. https://developers.openai.com/api/docs/pricing

## Limits preserved
Ten-bottle free daily allowance and existing owner exception remain. Premium bypass is future work. No new billing or account rules were introduced.
