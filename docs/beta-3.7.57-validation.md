# sommNI 3.7.57 — label recognition and fitted scan mesh

## Result
The user-supplied Irrosso screenshot reproduced the live 502 “identity is not clear enough” error. A final live research request using the cropped screenshot plus an automatically generated central label close-up correctly returned **Irrosso / Casanova di Neri / 2022** in 22 seconds. This is a result on that screenshot, not a general recognition accuracy claim. A uniform blank image returned 422 and no invented wine. No test bottle was saved or contributed.

## Changes
- Dedicated configurable vision model (`SOMMNI_VISION_MODEL`, default `gpt-6.1-sol`) uses strict structured output with OpenAI. Existing Google fallback remains when only its key is configured.
- Full bottle photo plus a bounded central label-detail image; the original stays authoritative for shape coordinates. Crop stays under 1.2 MB encoded, keeping the combined request inside the existing request limit.
- Bundled catalog names provide spelling context only, without vintages or tasting notes. Outside-catalog bottles remain valid; uncertain identity must remain unknown. New community names are not yet included in this static spelling context.
- Provider-only normalization tolerates style capitalization and numeric year strings. Public save/review validation remains strict. Malformed provider data is distinguished from an unreadable wine name. Diagnostics do not log photos, label text, credentials or user inputs.
- Research cannot silently replace the photographed wine/producer or supply a vintage absent from the label. Visible identity evidence is retained alongside research provenance. Ambiguous reports must not blend notes from several possible wines.
- Approximate photo-space silhouette with 12 bands, independent left/right edges and center shifts. Projected elliptical rings and curved strands follow neck, shoulders and tilt. Softer lines across the label and a gold scanning sweep; reduced motion respected. No fabricated default silhouette when local contrast tracking fails.
- This is a depth-styled wireframe fitted to a 2D image, not depth measurement or full 3D reconstruction. In the native Even camera flow it is shown on the returned photograph; native continuous video remains unavailable in this implementation. Local contrast tracking supplies an initial outline; the vision outline replaces it when research returns.
- Failed scan keeps its photo and offers an optional producer/name hint. Native photo-picker handlers apply only to file inputs, never the new text field. Explicit approval remains required before saving.

## Verification
- 50 existing beta checks passed in the final full run. Added scanner-controls regression passed separately and is included in the runner (51 groups next run).
- 10 research/provider tests passed, including strict schema, dual image input, catalog spelling context, unknown vintage, malformed data vs unreadable label, invalid geometry and producer/vintage drift prevention.
- Photo preprocessing tests cover bounded detail JPEG, PNG alpha preservation, WebView conversion and cleanup. Mesh tests cover asymmetric centers, shoulders and malformed/out-of-image coordinates.
- App and site typechecks, site build and beta pack passed; whitelist audit: zero unapproved URLs.
- The broader Deno test graph has a pre-existing `menu-import.ts:25` inference error; backend runtime tests were run with `--no-check`. The changed provider is checked separately.
- Interactive browser screenshot verification was unavailable because the computer-control transport closed, including after reset. DOM controls were exercised with a simulated native picker. Physical phone/camera behavior still needs device confirmation.

## Deployment
- Updated Supabase `winelens-beta` v48 and `winelens-research` v13. Their existing `verify_jwt: false` settings were preserved; application-level account checks and daily allowance remain unchanged.
- Even Hub beta: 3.7.57. Git branch: `codex/sommni-beta-3.7.39`.
- Even Hub upload ID 138685, package 40,675,522 bytes. Promotion to beta confirmed by CLI; active testers can install the build manually in Even.
