# Claude handoff: wineLENS product foundation

Romario wants the robot removed, a real release path, trustworthy wine-reference details and a substantially better way to study. The product direction is approved: wineLENS, Chroma composition with Atelier colors, actual photographic bottles, intelligent and tasteful presentation.

## Start here

Read `wineLENS-PRD.md` and `wine-reference-register.json` in this folder. The PDF is for product review; Markdown and JSON are the implementation sources. Do not assume every proposed PRD requirement is already implemented.

Review branch: `codex/winelens-product-foundation-20260929` in `d3hospitality/sommni`.
Isolated checkout: `/Users/d3hospitality/Documents/Codex/2026-09-29/can-you-do-a-deep-audit/work/winelens-release`.
Original development checkout: `/Users/d3hospitality/Desktop/d3-apps/sommni 2`.
Shared API: `/Users/d3hospitality/Desktop/d3-web/sommni-api`.
Web/marketing: `/Users/d3hospitality/Desktop/d3-web/sommni-web`.
Photo pipeline: `/Users/d3hospitality/Desktop/d3-apps/sommNI - Sprite Bottle Maker`.

Use the isolated branch for the next G2 implementation. The original checkout remains dirty with Romario's prior staged state; do not reset it, overwrite it with an old script, or force-push its main branch. Inspect each repo's current instructions and changes before editing. The API's existing local Winebrary work has not been bundled into the G2 PR and needs its own scoped review.

## What Codex just completed

- Removed robot event/emotion routing and rendering helper, reflowed six page builders into list + full-height text panels, and removed twelve public robot PNGs. Finder, quiz picker, question, feedback, score and course-overview layouts now use two containers. No robot download is required to navigate those pages.
- Preserved your Winebrary navigation, paging, byte clipping, offline account cache and return-to-origin changes.
- Installed 214 photograph-based catalog assets with original aspect ratios, transparent backgrounds and provenance. The remaining Pahlmeyer w105 keeps the previous sprite pending identity confirmation. All 215 IDs have an image.
- Kept physical bottle dimensions null: display size is normalized, not measured centimeters. Did not assign catalog-photo label years to user vintages.
- Wrote the complete PRD, the 215-row reference register, and directly checked three pilot wine records against producer documents.
- Added a narrow robot-free layout regression test and a GitHub Actions browser/build workflow to the review branch. Existing direct-module navigation tests use a blank page to avoid real application startup interfering with a mock bridge.

Photo review: `http://localhost:5186/sommNI/bottle-review.html`.
App: `http://localhost:5186/sommNI/`.
Simulator automation: `http://localhost:9899`.
Port 5173 / simulator 9898 belong to PolyGot. Do not stop them. When direct-import mock tests see disconnected state after edits, restart only this Vite server: HMR timestamps can create duplicate module instances. Start without inherited `NODE_ENV=production`.

## First implementation slice

Deliver one end-to-end flow: **a sourced wine/release → an approved recall card → answer/reveal on phone or G2 → exactly one persisted review → a correct next due date**.

1. Establish immutable wine/release IDs and a lossless legacy map. Remove the `w0` fallback. Preserve favorites, photos, stock, pairings and history through a tested migration.
2. Add claim/source/release records. Start with Cain NV14, IXSIR Grande Réserve Rosé 2023 and Pater Patriae from the register. Unknown values stay unknown; an AI completion is never evidence.
3. Consolidate the duplicated phone/G2 quiz logic. Separate objective facts from subjective tasting observations. Hide answer cues before recall, support a reveal interaction and explain the answer with its source.
4. Implement a deterministic, versioned study scheduler and idempotent review events. Keep same-day recognition separate from delayed unaided recall. Fix the non-persisting learned state by replacing it with the PRD's explicit card/skill model.
5. Add offline review replay and account isolation. Legacy `saveJSON` currently swallows errors and some read-modify-write operations can race; show pending/error state and serialize writes.
6. Adapt the G2 UI with your EvenHub SDK judgment. Keep short prompts, consistent tap/double-tap behavior, one event capture, valid byte lengths and stale-image cancellation. Compare SDK 0.0.12 against the installed 0.0.9 in an isolated change; verify vendor docs and actual package availability before upgrading.
7. Evaluate actual G2/R1 and phone-host behavior. Simulator observations are not hardware certification. Add a concise service card and recent/pinned access after the core learning loop works.

Use the PRD's acceptance matrix, and improve weak product details with your design judgment. Keep changes scoped and make uncertainty explicit. Do not turn the whole document into an unbounded rewrite before one full slice is working.

## Reference findings that matter

- Cain NV14 combines 2013 and 2014; preserve its NV release code.
- IXSIR's 2023 sheet lists three varieties, but gives no percentages. Ratings for other years on the same sheet must not become the 2023 rating.
- Pater Patriae's producer page supports Pinot Nero / IGT Toscana identity; it does not verify every user vintage.
- Brochard maturation descriptions differ between current and older material. Confirm release/version before teaching them.
- Pahlmeyer “Cabernet Sauvignon” needs Romario to choose Proprietary Red or Jayson Cabernet Sauvignon. It blocks only that record.
- Only fifteen photo selections currently have retained source URLs; the rest retain local reference paths. Recover original web provenance and image-use rights as a separate content task. Do not confuse 214 visually matched bottles with 214 complete verified wine profiles.

## Release work still outstanding

Read the API's `WINELENS-ROLLOUT.md`. Confirm historical provider-key revocation, then configure a fresh server-only key if generation is enabled. Review/apply the additive collection/storage/quota migrations in staging, deploy the API, configure exact auth return URLs, and test a real account before frontend release. Reconcile old Android/import callers with the changed rendering contract. Neither live migration nor deployment has been performed here.

Do not execute the old G2 `deploy.sh`; it kills all Vite processes and deletes a generated checkout. Use scoped builds. Build the web app with `/sommNI/` and an Even package separately with relative asset paths. The old checked-in `.ehpk` is not this release candidate. Measure package size, remove review-only assets from a release package if needed, and verify image transfer on hardware.

A draft PR is the review boundary. Keep production/store submission behind the concrete live/hardware gates. Do not reuse historical credentials, invent missing measurements, or mark proposed features complete without executing their workflow.

## Verification baseline

Passed locally after robot removal: TypeScript, Vite build, account/vintage/photo browser flow with mocked services, Winebrary glasses tests, all 306 catalog-page/nav checks, all 214 photo raster checks, and ten robot-free page variants. The Even simulator was visually checked on the reflowed Finder page. Browser tests do not prove live OAuth, production migration status, paid rendering or real hardware behavior.

Run from the G2 checkout with Vite at 5186:

```sh
npm run typecheck
npm run build
npm run test:ui
npm run test:glasses
npm run test:nav
npm run test:display
npm run test:bottles
```

Report what changed, the exact checks run, next reviewable milestone and any release blockers. Keep source facts, product hypotheses and observed test results distinct.
