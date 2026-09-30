# wineLENS website + accounts handoff

Build and preview completed on `codex/winelens-site-accounts`, from `cac90e2`. The brief is `docs/codex/SITE-ACCOUNTS-BRIEF.md`. Nothing was deployed, pushed, uploaded to Even Hub or migrated. No live credentials were read or tested. The existing reference/release working trees were not edited. `src/atlas/` is unchanged.

## Delivered

- Separate Atelier website in `site/`: landing, `/link`, privacy and terms. Vite builds every page into `dist-site` with base `/`. `vercel.json` targets the site build for project **sommni**. The original G2 build still emits `dist` with `/sommNI/`.
- Editorial landing page with Glasses, Winebrary, Atlas, Study, linking instructions and FAQ. No invented reviews, counts, pricing or subscriptions. Even Hub CTA currently goes to the real Hub home; a verified public package listing can replace it at launch.
- Real supplied G2 screenshots, cropped/converted to WebP; image provenance in `site/public/media/PROVENANCE.md`. Captures and composites are explicitly labelled. Local Space Grotesk fonts match the companion. Layouts checked at 390 and 1440 px, with keyboard focus, mobile navigation, semantic headings, alt text and reduced motion.
- PolyGot's G2B stage and 1.2 MB model, with wineLENS captures. The Three.js chunk and model load only after **Explore in 3D**; rotation and screen selection are user controlled. No animation runs while idle. Static captures remain useful without WebGL. Total built site is about **2.2 MB**, including the optional 607 KB uncompressed / 156 KB gzip 3D JavaScript chunk. Initial landing JS is about 3 KB uncompressed plus CSS/fonts/media. Vite's 500 KB chunk warning is limited to this explicitly requested 3D module.
- `/link`: canonical-origin PKCE Google sign-in, provider availability check, disabled localhost preview, eight-character code, countdown, copy/new code, polling, device list/revoke, local browser sign-out, and account deletion with a typed confirmation. Existing valid sessions can manage their account even if Google is subsequently unavailable. No billing or premium gating.
- Vercel `api/device-link.js` and server-only `server/device-link.cjs`: issue, issued-status, redeem, list, revoke, unlink, device-status and delete-account. Public configuration has one canonical origin in `shared/accounts.json`. Server configuration refuses any Supabase project URL except **mcmtasetompygfktzhpr**.
- Draft migration `supabase/migrations/20260930100000_winelens_site_accounts.sql`, **not applied**: service-only code/attempt/device/deletion tables, RLS/grants, profile-on-signup/backfill, atomic rate limits and device cap, per-session revocation, deletion support and an upload restriction during deletion.
- Companion accounts point to wineLENS. The existing Winebrary data API URL logic remains. Password/magic-email UI is replaced with the site link, three steps and a code field. Host storage is selected through `initSync` before account creation; browser fallback uses localStorage. Linked state displays the email and **Unlink this device**. API requests and active/resumed sessions check link validity; invalid sessions clear private account views/caches. Independent guest companion data is retained.
- SDK 0.0.9 has no documented open-browser/open-URL method in its installed declarations. The companion therefore offers a normal external link and shows the complete URL plainly, as requested.
- Both manifests allow the wineLENS project and canonical site origin. Beta version is **3.2.0**. No beta package was rebuilt/uploaded in this round.

**Dependencies:** Added `three@0.180.0` and dev-only `@types/three@0.180.0` for the requested reference viewer. Replaced this worktree's node_modules symlink with its own install before installing anything. The release worktree's dependencies were not modified. `npm install --include=dev --ignore-scripts` was required; no other new runtime dependency was added.

## Redeem-model decision: (b), a Supabase session

The code is the one-time credential. Authenticated website users issue it; the unauthenticated companion redeems it. The API atomically claims its hash and reserves a device slot, looks up that exact existing user, uses admin `generateLink(type: magiclink)` followed by `verifyOtp(token_hash)` on a separate non-persisting public client, and records the returned session ID. It returns the access/refresh pair only after finalization succeeds. No email is sent and no password flow is added.

This keeps one authentication model for collection, bottle images and study sync. It avoids modifying the uncommitted `sommni-api` rollout or duplicating its data endpoints. The tradeoff is that the device has a full user session, not a narrower device-only credential. Anyone holding a code can access that account; the UI says to enter it only on your own device.

Only code hashes are stored in the new code tables, never raw codes. The alphabet is `23456789ABCDEFGHJKMNPQRSTUVWXYZ`; normalization removes whitespace/hyphens and uppercases, and rejects ambiguous/other characters. Codes expire in ten minutes, work once and are invalidated by a newer unused code. Issuance is capped at ten per user per hour; redemption counts all attempts and caps twenty per keyed network hash per ten minutes. PostgreSQL advisory locks serialize the relevant account/network operations and code consumption. Five live devices or unexpired reservations are allowed; mere unused codes do not consume slots. A failed mint consumes the code and releases the reservation; the user requests a fresh code.

Revocation deletes only the selected session's refresh-token chain and `auth.sessions` row and records `revoked_at`. The server's own endpoints verify the Auth user **and** current session row. The app checks device status before data calls, on return/online and every minute while visible. `last_seen_at` reflects those checks, not a hardware serial or physical wear detection.

A previously issued JWT can remain accepted by other stateless services until it expires; it is not possible to promise instant invalidation of every existing token. This is the standard [Supabase session model](https://supabase.com/docs/guides/auth/sessions). Use a short, reviewed JWT lifetime at launch, and test the existing data API's revoked-session behavior. SQL revocation deliberately relies on `auth.sessions.id/user_id` and `auth.refresh_tokens.session_id`; verify those managed-schema columns/privileges before migration. See [Supabase sign-out behavior](https://supabase.com/docs/reference/javascript/auth-signout).

Deletion marks the account as deleting, invalidates codes and other sessions, blocks new authenticated bottle uploads, removes private bottle objects through the Storage API, then deletes the Auth user. The current website session remains available to retry if cleanup fails. Owned profile/collection rows are explicitly removed by a delete trigger; linking, quota and study rows cascade. Shared wines and ingest provenance remain. Deletion is permanent. Offline installations cannot be remotely erased while offline; cache cleanup follows reconnection/validation, or a local unlink. Provider backups follow provider retention.

## Definition of done and checks

All required build and regression checks passed. Browser checks used **this worktree on 5188**, never Claude's server on 5186. The site preview is **5187**. Ports 5173, 5186, 9898, 9899 and 9901 were not touched.

| Check | Result |
| --- | --- |
| `npm run build:site` | PASS; all four HTML entries, correct assets and `/` base |
| `npm run typecheck` | PASS |
| `npm run typecheck:site` | PASS |
| `npm run build` | PASS; original `/sommNI/` G2 app |
| `npm run test:ui` | PASS; code sign-in, collection save, vintage, photo/render, G2 preview, unlink clears collection |
| `npm run test:glasses` | PASS; bounds, capture, images, race/rejection handling and clearing |
| `npm run test:nav` | PASS; catalog/library/Atlas navigation and isolation |
| `npm run test:display` | PASS; six text-first pages, no overlap/mascot |
| `npm run test:bottles` | PASS; 214 rendered, one pre-existing pending identity, zero clipping failures |
| `npm run test:study` | PASS; engine, G2 and phone suites |
| `npm run check:ids` | PASS; 215 canonical entries, zero problems |
| `node tests/atlas.cjs` | PASS; 178 checks |
| `npm run test:accounts` | PASS; 17 mocked-handler tests, including auth/CORS, claim races, failure cleanup, rate limits and deletion |
| `npm run test:link` | PASS; normalization, invalid/expired/rate-limited responses, successful redeem, reload, mock bridge storage and unlink |
| `npm run test:site` | PASS; both viewports, no horizontal scroll or page errors, navigation, clean URLs, lazy 3D, mocked canonical sign-in/code/poll/revoke/deletion and screenshots |
| `git diff --check` | PASS |

The machine inherited `NODE_ENV=production`; explicitly set development mode for the app test server. All account flows in automated checks used fake credentials and mocked fetch routes. Real Google OAuth, live database functions and physical G2 pairing are deliberately reserved for the approved go-live run. SQL files have not been applied to any database; handler mocks do not establish that the migration executes on the hosted schema.

Reproduce locally (separate terminals):

```sh
NODE_ENV=development npm run dev -- --port 5188 --host 127.0.0.1
NODE_ENV=development npm run dev:site
WL_BASE_URL=http://127.0.0.1:5188 npm run test:ui
WL_BASE_URL=http://127.0.0.1:5188 npm run test:link
npm run build:site
npm run test:site
```

Every existing browser test supports `WL_BASE_URL` (default `http://localhost:5186`); Atlas also retains `ATLAS_URL`. The signed-in site test fulfills the built assets locally under the canonical browser origin and mocks all account traffic. There is **no production mock sign-in switch**.

## Screenshot evidence

Saved under `~/Documents/Codex/2026-09-29/can-you-do-a-deep-audit/outputs/wineLENS-site/`:

| State | 390 px | 1440 px |
| --- | --- | --- |
| Landing, full page | `landing-390.png` | `landing-1440.png` |
| Landing, first viewport | `landing-hero-390.png` | `landing-hero-1440.png` |
| `/link`, signed out/local disabled | `link-signed-out-390.png` | `link-signed-out-1440.png` |
| `/link`, mocked signed-in code | `link-signed-in-mocked-390.png` | `link-signed-in-mocked-1440.png` |
| Interactive G2 composite | `g2-composite-390.png` | `g2-composite-1440.png` |

The signed-in images use `romario@example.test` and a fake code. They are preview evidence, not a live account. `index.html` in that output directory is a local screenshot gallery.

## Ordered go-live checklist for Romario — approval required before starting

1. **Enable Google in wineLENS Supabase (`mcmtasetompygfktzhpr`).** Configure the Google OAuth client and Supabase provider. Google's authorized redirect URI is `https://mcmtasetompygfktzhpr.supabase.co/auth/v1/callback`; set the Supabase Site URL to `https://sommni-beige.vercel.app` and allow `https://sommni-beige.vercel.app/link` (plus `/link.html` only if you intend to support that direct entry). Confirm basic profile/email scopes. Do not configure d3-shared or enable localhost OAuth for this preview.
2. **Set Vercel environment on project `sommni`.** Use the public defaults in `.env.example`: wineLENS `VITE_SUPABASE_URL`, publishable key and `VITE_API_BASE_URL=https://sommni-beige.vercel.app`. Set server-only `SUPABASE_URL` to that same project and its `SUPABASE_SERVICE_ROLE_KEY` in Vercel; never prefix a secret with `VITE_`, paste it into chat or commit it. Keep `VITE_SOMMNI_API_URL=https://sommni-api.vercel.app`. Production build/output: `npm run build:site` / `dist-site`. Use separate projects for the site and data API.
3. **Review and apply migrations to that same wineLENS project, in order.** Confirm the existing `0001_profiles_and_collection`, `0002_wine_catalog`, `0003_ingest_provenance`, `0004_ingest_rpc_no_service_key`. Then apply `sommni-api/db/migrations/20260929202333_winelens_bottle_storage_and_quota.sql`, `sommni-api/db/migrations/20260930090000_winelens_study_reviews.sql`, and this repo's `supabase/migrations/20260930100000_winelens_site_accounts.sql`. Before execution, inspect existing signup triggers, Auth session/refresh-token columns and grants, and confirm private storage cleanup semantics. Test duplicate claims, the sixth-device limit, expiry, role denial and deletion in an approved nonproduction database first. These two pending `sommni-api` migrations **must target wineLENS**, not d3-shared.
4. **Point `sommni-api` at wineLENS.** Update its `SUPABASE_URL` and applicable publishable/server keys, and release its pending storage/study rollout through its own reviewed process. Preserve existing collection/image/study contracts. Confirm allowed companion origins and RLS using two separate test accounts. This task did not modify that repository.
5. **Deploy the reviewed site to `sommni`.** First confirm the account privacy/terms wording, model redistribution permission, contact address and final Even Hub listing link. Verify `/`, `/link`, `/privacypolicy` and `/terms`, canonical Google PKCE return, code issue/poll, clipboard fallback, device revoke and typed account deletion with a disposable test account. Check Vercel runtime timeouts against deletion of a collection with many photos. Do not log codes, tokens or request bodies.
6. **Rebuild beta 3.2.0 `.ehpk`.** Build from the approved branch with the canonical site/API settings, inspect the two new allowed origins and bundle contents, then use the existing reviewed beta packaging/store process. The G2 build still uses `/sommNI/`. No store upload is authorized by this brief.
7. **Test on physical G2 through the Even app.** Google in the external browser → fresh code → companion redeem → stored session survives restart → collection/photos, Atlas and Study all load. Confirm lowercase/hyphen normalization, expired/used/rate-limited errors, second-device linking, per-device revoke/refresh denial, unlink clearing glasses and host storage, offline/reconnect behavior and deletion without impacting another account. The app does not expose a password flow.

## Known gaps and review boundaries

- Google is currently disabled and there are no live accounts, per the supplied brief. Local `/link` is intentionally disabled; production OAuth and Auth-schema compatibility remain launch checks.
- A full user session is broader than a scoped device token. Other APIs may honor an already-issued JWT until expiry. Devices must reconnect to receive account revocation/deletion. No instant remote wipe is claimed.
- Migration execution, RLS concurrency and hosted deletion have not been tested against Supabase because this round forbids migrations and live writes. The SQL provides atomic enforcement; the mocked handler suite verifies its API contract, not PostgreSQL execution.
- Failed deletion is retryable from the still-signed-in website. A process crash between OTP verification and finalization could leave an unreturned orphan Auth session; no credential reaches the caller, the reservation ages out, and account deletion revokes it. A future server cleanup job can remove such orphan sessions if needed.
- The Even Hub listing URL and source-model publication rights need owner confirmation before public release. The contact address matches Romario's existing PolyGot site. Legal copy describes the implemented beta; Romario should approve it before publishing.
- No physical G2, real OAuth or live data API rollout test was performed. The existing unresolved catalog identity remains unresolved; this work does not alter wine facts or Atlas behavior.

## Rollback note

Do not execute rollback during this preview. Before a future rollback, disable code issuance and revoke each linked device session while the functions/tables still exist. Preserve needed audit records. Remove the `wl_no_upload_during_deletion` storage policy, the `wl_profile_on_signup` and `wl_delete_owned_rows` triggers, then the `wl_*` functions and four `wl_*` tables (devices before codes). Remove only objects introduced by this migration. Keep existing profiles, collection, shared wines, ingest history and the separate bottle/study rollout. Roll back site/app code together to avoid a client calling removed endpoints. Deleted accounts/photos cannot be restored by rolling back schema; any recovery would require a separately approved provider-backup process.
