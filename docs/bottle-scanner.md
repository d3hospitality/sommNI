# Bottle Lens: camera scanning in the Even phone companion

Entry points: Home → Scan a Bottle, or Add a wine → Scan a Bottle.

The phone displays a rear-camera preview with a local contrast contour and curved grid. Tap Scan This Bottle to capture one image; live frames are never sent to the research service. The three steps are Capture, Research and Review. Research uses an indeterminate indicator because the service does not expose percentage completion.

The match screen shows the captured photo, wine, producer, vintage, place and reference notes. Approve & Add saves through the existing Winebrary pipeline; Edit Details opens the existing editable research draft. No automatic save happens after recognition. Unknown years remain unconfirmed. Duplicate bottles keep their existing notes and artwork.

Approved bottles use the same local/account storage, daily allowance, contribution outbox and glasses refresh event as other additions. Image processing tries the existing transparent cutout pipeline and falls back to the original capture if unavailable. A failed image attachment does not turn a successful wine save into a false failure. Public wine facts and selected artwork are queued for Supabase; this is distinct from owner review and public catalog publication.

The research endpoint requires JPEG. The client now explicitly converts research inputs to bounded JPEG, independently of the PNG used for transparent artwork. This also corrects the ordinary photo-upload research path.

## Validation

- TypeScript check and free-beta production build pass; bundle URL audit reports no unapproved origins.
- All 46 beta check groups pass, including new scan-session, camera-resource and save-pipeline tests.
- Portrait browser tests: moving real catalog photo, camera-denied fallback, file picker upload, processing, cancellation, retryable failure and explicit approval with a simulated save.
- Live research: catalog bottle photograph identified as Grand Malbec, Terrazas de los Andes, 2017, Mendoza, Argentina; notes returned and approval screen displayed. No test wine was published or saved to a real collection.

## Limits and next device test

The live grid is a lightweight 2D contrast estimate, not a semantic bottle detector or 3D reconstruction. Plain backgrounds and a single upright bottle work best; clutter or weak contrast falls back to a framing guide. User capture is intentional, not automatic. No extra vision model is downloaded for live tracking.

Physical rear-camera behavior inside the Even iOS/Android WebView still needs a phone test. Take Photo and Choose Photo are provided when embedded live-camera access is unavailable. The G2 glasses do not supply the camera; approved wines use the existing Winebrary on glasses.

Local test bench: `/sommNI/tests/fixtures/bottle-scanner.html`. This page is not a production build entry. Its camera is a moving catalog image, fixture research is labeled, and its save callback never writes a wine. The Live research button uses the real service and daily allowance but still cannot save a wine from the fixture.

The real companion Home entry point was also opened at portrait width. Its subsequent guest upload reached the existing daily allowance limit; this was displayed as a retryable service error, without saving anything. The earlier live lookup succeeded. No quota was bypassed and no owner-account credentials were requested for the test.
