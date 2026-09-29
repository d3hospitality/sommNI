# wineLENS / Winebrary

The G2 companion now uses the selected Chroma composition with Atelier colors. The existing catalog, pairing, study, and course screens remain available. Winebrary is a new account-backed collection using the same Supabase project as the existing wineLENS website and shared API.

## Local development

```sh
npm install
npm run dev
npm run typecheck
npm run build
npm run test:ui
npm run test:glasses
```

The browser tests expect the dev server at `http://localhost:5186/sommNI/`. They mock account, collection and paid-image services. On macOS they use installed Google Chrome; set `CHROME_PATH` to override. Screenshots go to the OS temporary directory unless `WINELENS_TEST_OUTPUT` is set. These tests do not create real accounts, change live collections or buy renders.

wineLENS reserves port 5186 with `strictPort`; it stops rather than silently selecting another port if occupied. The development server proxies `/api` to the shared backend so this local port does not require a production CORS change.

`VITE_SOMMNI_API_URL` can point at a deployed staging API. Only public configuration belongs in Vite variables. Supabase's public anon key is shared with the existing website; provider keys stay on the server.

## Behavior

- Sign in with the existing Google or email account. New email accounts are supported by the configured Supabase project. OAuth/email callback URLs must be allowlisted for the deployed companion URL.
- Add a wine manually, or choose `+ Winebrary` on a catalog wine card.
- Vintage is explicitly `year`, `non_vintage`, or `unknown`. Each saved release has its own immutable collection UUID.
- `Add another vintage` copies wine identity and clears year, notes and photo. It creates a separate collection row. Editing a wine's identity/year detaches the prior label image.
- Upload a PNG/JPEG/WebP under 2 MB. Either approve the original or request a reference-led studio rendering, then review it before attaching it. The collection save is independent of the image action.
- Image URLs are temporary private links. Refresh Winebrary to renew them.
- `Show on glasses` sends the selected private wine from the phone companion to the G2. The full library is also browsable on the glasses (below).

## Glasses

**My Winebrary** is the first item on the G2 home menu. Click selects, double tap goes back one level:

`Home › My Winebrary (list) › [wine with several vintages › vintage list] › detail`

- One row per wine. Releases of the same wine (same name + producer) are grouped as `Grand Malbec · 3 vintages`, newest year first, then non-vintage, then unknown. A single release shows its year (`· 2017`, `· NV`) directly.
- Lists page at 18 entries + `More · 19-36 of 52` + `Back`. Double tap on page 2 returns to page 1.
- Signed out, empty, still loading or failed to load: a calm one-screen message. Loading switches to the list when the phone finishes.
- Offline: after each successful load, a text-only copy of the signed-in account's library is saved in Even Hub storage (`winelens_library_cache_v1`). If loading fails, the glasses browse that copy and say `offline copy`. Signed image links are not saved. The copy is tied to the account id and cleared on sign-out or account switch.
- `Show on glasses` from the phone opens the same detail page; there, double tap returns home.

Detail page: 576 × 288, bottle photo left (two 100 × 120 halves), title (1–2 lines) → vintage · producer · region → your notes (the one event-capturing container; scroll to read) → hint. Heights follow the title and notes use whole text lines. Bottle alpha bounds are fitted before conversion to 16 green levels. Image transfers share a paced queue; obsolete page transfers are discarded.

### Firmware limits (measured, not documented)

Probed on Even simulator 0.9.5 with SDK 0.0.9 on 2026-09-29. `rebuildPageContainer` returns `false` (page silently not shown) when:

| Limit | Value |
|---|---|
| List row label | **≤ 63 UTF-8 bytes** (64 rejected; `é` and `·` cost 2 bytes) |
| Text container content | **≤ 999 UTF-8 bytes** (1000 rejected) |
| List rows | ≤ 20 |

`src/glasses-list.ts` enforces these (`clipLabel`, `clipBytes`, `pageList`) and every list builder routes through it. Other measured layout facts: list rows are 40 px; text lines are 27 px at ~9 px per character; a list shorter than its container is **centred vertically**, so lists are sized to their row count.

### Navigation fixes in the catalog flow

- Every page change goes through `rebuild()`, which throws if the glasses reject the page, so navigation state never advances past a page that is not on screen.
- Back from tasting notes returns to where you opened them (wine list page, grapes, Finder results, pairing).
- Wine lists over 20 rows (Sangiovese, Champagne Blend: 25 wines), the quiz picker and the pairings list are paged.
- The dead separator row on home is gone. Quiz "Try Again" repeats the wine you just played.
- Tasting notes: the region · style line was 22 px tall and clipped descenders ("Tuscanv"); it is now a full line, long names wrap to two lines, and notes show whole lines.
- If only the web view reloads (Even Hub web view restart, dev hot reload), startup takes over the existing glasses page instead of stopping.

### Testing on the simulator

```sh
npm run test:nav       # mock bridge: limits across all 306 catalog pages, Winebrary + catalog navigation
npm run test:glasses   # image raster/queue + private page
# Simulator with sample account wines (DEV only; never in production builds):
evenhub-simulator --automation-port 9899 "http://localhost:5186/sommNI/?g2-fixture=library"
```

Start the dev server without `NODE_ENV=production` in the environment; otherwise Vite runs with `import.meta.env.DEV === false`, the `/api` proxy is bypassed and the fixture does not load.

The browser preview uses the same coordinates but an approximate browser font. Physical G2, R1, BLE, native photo selection and OAuth behavior still require device verification. The legacy catalog keeps its existing IDs and bridge storage keys (positional `w0…w214` IDs remain an open audit item).

## Packaging

The GitHub Pages build uses `/sommNI/`. Build a separate relative-path directory for an Even Hub package:

```sh
npx vite build --base=./ --outDir /absolute/path/to/a/test-build
# Use the installed scoped CLI binary; npm's unscoped `evenhub` package does not exist.
evenhub pack app.json /absolute/path/to/a/test-build -o winelens.ehpk
```

The existing package ID is unchanged. The name is wineLENS and the app version is 3.0.0. The generated test package is not a store submission or a hardware certification.
