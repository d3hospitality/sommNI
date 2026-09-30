# wineLENS Pro + tokens — local implementation handoff

Implemented on `codex/winelens-tokens`, starting at the requested `5cf144f` base. Codex's sandbox blocked native Postgres, Chrome and `git commit`; Claude re-ran every blocked check outside the sandbox on 30 September 2026 (all PASS, table below), hid the empty usage/activity headings while billing is unavailable, and made the local commit.

Nothing was deployed, pushed, uploaded, or applied to a hosted database. No Stripe/OpenAI calls with real credentials were made, and no secrets were read or printed. Protected reference worktrees were read only; `src/atlas/` is unchanged. The existing site server on **5187** was reused; the companion was started on **5190**. The prohibited ports were not used.

## Delivered

- The existing website `/link` and Vercel device-link handler remain the one pairing system. The account home adds Free/Pro, renewal/end date, monthly/yearly upgrade, Stripe management, remaining monthly allowances, Pro-only packs, auto-spend, balance, activity and a test-key badge. Account deletion is blocked while a mirrored subscription is still live, before revoking sessions or deleting private data. Manage billing remains available with the purchase kill switch off.
- Landing pricing reads `shared/rate-card.json`. The FAQ, terms and privacy policy cover allowances, Stripe, OpenAI label scans, draft review, token consent, non-expiry, canceled Pro, refunds and retained financial records. No invented users/reviews were added.
- `api/billing.js`, `api/stripe-webhook.js`, and `api/wine-scan.js` use server-only modules and the same verified Supabase user + active-session check as linking. Origin restrictions and no-store responses are preserved. Supabase configuration refuses the other project.
- The new migration is `supabase/migrations/20260930182315_winelens_tokens.sql`. It adds entitlements, wallet, immutable versioned rates, allowance counters, reservations, append-only ledger, checkout attempts and private scan results. Only local throwaway PostgreSQL engines executed it. The ledger and rate card reject UPDATE, DELETE and TRUNCATE; financial audit records survive account deletion without emails, photos or JWTs.
- Service-only reserve/settle/sweep/grant functions enforce allowance first, Pro-only extra usage, consent/auto-spend, available balance and optional monthly spending limit. Reservations retain their original rate version and period. Five-minute expired holds release automatically on status/reserve, or through the sweeper. Failed allowance usage is returned as well as tokens.
- The companion adds **Add a wine → Scan the label**: choose/take a photo, view cost, confirm token use or enable Always allow, review filled fields and the clearly marked draft note, then explicitly save through the existing collection API. Scans never save automatically or write the shared catalog. An unknown color remains unknown. Manual entry and original-photo use stay free. The account panel shows balance and links to plan management. No glasses screens were added.
- Bottle Studio's companion request passes explicit token consent. The ready-to-install server integration lives in `integrations/sommni-api/usage.js`. It was **not installed** in the protected API repository. The generic DB API accounts for wine-list pages; this brief does not introduce an importer.
- `tests/pairing.e2e.cjs` runs the real pairing handler on an ephemeral local HTTP port with an in-memory Supabase implementation. It drives the built signed-in account page and companion on 5190 through issue, redeem, storage, Winebrary, revoke within one status check, re-pair and unlink. It also tests scan cost, consent, draft review and explicit save. All external account/provider traffic is mocked. The harness exists, but its browser run is unverified because Chrome cannot launch here.
- `tools/smoke-live.mjs` is prepared for after launch and was **not run**. It needs only public configuration. It checks provider settings, `/link`, canonical preflight, invalid-input rejection, and the status endpoint's unauthenticated 401. To stay strictly read-only, the bad-code probe sends an overlong code rejected before any database client or redemption-attempt counter is touched; it does not test a valid-looking incorrect code, which would write a rate-limit record.

Added pinned `stripe@22.6.2` at runtime and `@electric-sql/pglite@0.3.14` for supplemental local tests. The native SQL harness has no additional runtime dependency. The existing optional 3D site chunk still produces Vite's >500 KB warning.

## Rate card v1

| Feature | Free / month | Pro / month | Tokens per extra use |
| --- | ---: | ---: | ---: |
| Label scan | 5 | 60 | 1 |
| Studio rendering | 0 | 10 | 8 |
| Wine-list page | 0 | 5 | 3 |

Pro: **$4.99/month or $39.99/year, USD**. Packs: **$5 → 100**, **$10 → 220**, **$15 → 350**, **$20 → 500 tokens**. One token is one integer unit. Owner has Pro allowances and token access. No trial is offered, so no trial can restart.

Free resets at calendar-month boundaries in UTC. Pro resets on its billing anniversary each month; annual Pro also receives monthly allowances, anchored to the original period start, with month-end clamping. Cancel-at-period-end retains access until the paid period expires. A non-active/non-trialing or expired entitlement falls back to Free. Existing tokens are retained but cannot be spent or purchased without Pro. The optional wallet monthly spending limit counts committed tokens plus open holds against the UTC calendar month.

The DB's immutable v1 JSON and `shared/rate-card.json` contain the plan/pack/rate/allowance numbers. Tests compare them structurally. Change rates by inserting an approved new immutable DB version and updating the shared JSON, then rebuilding; no TypeScript/JavaScript logic change is needed. Outstanding reservations keep their prior rate. Launch pack grants intentionally validate against immutable v1, so a delayed Checkout delivery cannot be reinterpreted using a different pack size. Changing pack definitions requires preserving historical pack mappings and reconciling pending checkouts, not mutating v1. Update static contractual wording when commercial terms change.

## Money flow and replay rules

1. **Checkout.** The client submits only a plan name or pack name. Prices, customer IDs, user IDs and return URLs from the client are rejected. Plan prices are retrieved and validated for active state, livemode, USD amount, recurring type/interval/count and per-unit billing. Customer creation and Checkout use stable idempotency keys. A DB advisory lock reserves one open attempt per user across plans and packs; retries reuse it. Both mirrored subscription status and paginated Stripe history block duplicates, including past-due, incomplete, unpaid and paused subscriptions. All checkout URLs return to the fixed canonical account page.
2. **Webhook.** Stripe's SDK verifies the signature against raw bytes. Other apps' events are ignored before any entitlement/grant work. Paid payment-mode token sessions require wineLENS metadata, matching account reference, exact amount and USD currency. Grants are unique by Checkout session in SQL, including concurrent deliveries. Subscription updates re-read current Stripe state; the DB serializes mirror writes, rejects stale events and older subscriptions, and preserves deletion tombstones. Canceled subscriptions can still be mirrored when their price has been retired.
3. **Ledger.** Grants add available wallet units exactly once. Reserve subtracts an available hold, commit records successful consumption, and release returns an unsuccessful/expired hold. **Do not sum every ledger event:** owned financial balance is grant + commit; reserve/release describe holds. Wallet units are the currently available balance. Usage counters separately distinguish reserved and committed included operations.
4. **Provider.** A scan validates a <=2 MiB PNG/JPEG/WebP data URL and its magic bytes, reserves one scan, calls OpenAI with strict structured output, validates the result, then atomically caches the result and settles. Failures release. A user/request ID is bound to the photo fingerprint: replay returns the cached result, reports still-processing/ended, or rejects changed input. It never starts another provider call or creates another charge. After a process crash, the hold expires; use a new request ID after checking the old result. The cache stores extracted fields/fingerprint, not the photo.

Refunds and disputes require operator reconciliation; there is no automatic refund API in this preview. Never edit/delete ledger rows to reconcile a payment. A pack paid after an account was deleted fails grant and must be reconciled/refunded from Stripe. No automatic renewal, refund or customer deletion was performed here.

## Bottle Studio without a service key

`winelens_reserve_studio(uuid,boolean)` and `winelens_settle_studio(uuid,boolean,uuid)` are the only JWT-callable write entry points. They derive `auth.uid()`, validate the live Auth session, restrict the feature to one Studio render, and require a random settlement receipt returned only on the first successful reserve. The caller cannot obtain that receipt by replaying the public request ID or reading their ledger. Do not return it to the phone, accept it from the phone, or log it. The server integration must deny replays before calling the provider. It returns a rendering only after a successful commit; provider/storage failures release. Its README covers installation and retry boundaries.

The protected `sommni-api` still has its prior enforcement until Romario installs this wrapper. Replace its old three-attempt daily render quota at installation while preserving input ownership, image approval and separate abuse controls. The site/app changes alone cannot enforce billing in an unchanged external provider endpoint. Wine-list processing must reserve validated `wine_list_page` quantities on its server before processing, using the generic service-only RPC.

## Checks on 30 September 2026

All requested commands were attempted with `WL_BASE_URL=http://127.0.0.1:5190`. PASS means the command actually completed, not that a test was mocked away. Browser failures occurred before tests reached application assertions. After the study engine launch failed, the separate study glasses and phone commands were also attempted and failed at the same launch boundary.

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run typecheck:site` | PASS |
| `npm run build` | PASS |
| `npm run build:site` | PASS; existing optional 3D chunk warning |
| `npm run test:accounts` | PASS; 18 handler tests |
| `npm run test:billing` | PASS; 10 tests, including real SDK signature verification with fake keys |
| `npm run test:scan` | PASS; 3 tests covering success, failure, replay, malformed output, input/auth/limits |
| `npm run test:sql:embedded` | PASS; real PostgreSQL/WASM migrations, RPCs, RLS, grants, immutability, expiry, limits, consent, receipts, period reset, subscription ordering and scan cache |
| `npm run test:sql:api` | PASS; production scan + signed webhook handlers against real PostgreSQL/WASM, actual cached result/rollback/idempotent grant and zero catalog/collection writes |
| `npm run test:sql` | PASS (Claude, native Postgres 16 via Homebrew): real migrations, rate-card parity, pairing/account RPCs, tokens, RLS, JWT scope/receipt, concurrent reserve/grant/claim |
| `npm run test:pairing` | PASS (Claude): real HTTP pairing handler → site code → companion session/Winebrary → revoke within one check → re-pair/unlink; scan cost, consent, draft review, explicit save |
| `npm run test:ui` | PASS (Claude, app on 5190) |
| `npm run test:link` | PASS (Claude, app on 5190) |
| `npm run test:site` | PASS (Claude, app on 5190) |
| `npm run test:glasses` | PASS (Claude, app on 5190) |
| `npm run test:nav` | PASS (Claude, app on 5190) |
| `npm run test:display` | PASS (Claude, app on 5190) |
| `npm run test:bottles` | PASS (Claude, app on 5190) |
| `npm run test:study` | PASS (Claude, app on 5190) |
| `npm run check:ids` | PASS |
| `node tests/atlas.cjs` | PASS (Claude, app on 5190) |
| Connected-browser manual preview | PASS; local pricing reviewed at desktop and 390 px; mobile menu and disabled localhost `/link` verified. This is not the signed-in Playwright proof. |
| `git diff --check` | PASS |
| Local commit on `codex/winelens-tokens` | PASS (Claude) |

Native `test:sql` creates a temp directory, chooses a free localhost port, starts `/opt/homebrew/bin/initdb` and `pg_ctl`, applies the Supabase-shaped Auth/Storage bootstrap, baseline and every repository migration in sorted order, and tears down in `finally`. Set `WL_PG_BIN` for another local PostgreSQL installation. Baseline fixtures are read-only copies of the supplied 0001/0002 and bottle/study migrations; missing 0003/0004 ingest objects are explicitly minimal stubs. This is not a claim of exact hosted-schema parity. Native concurrent reserve/grant/claim tests must pass outside the sandbox before approval.

The supplemental PGlite tests execute the actual PL/pgSQL and policies, not a JavaScript fake. They **do not establish cross-connection advisory-lock behavior**. Native startup was tried with default and alternate shared-memory settings; both failed on the sandbox's `shmget` restriction. No security restriction was bypassed.

Detailed command logs are in `/private/tmp/winelens-token-checks/` on this machine. The final builds and checks affected by later fixes were rerun. No live smoke run, OAuth, Stripe payment, OpenAI request or physical G2 test was attempted.

## Ordered go-live checklist for Romario (future approval only)

Native SQL and all browser checks were re-run outside the sandbox and pass; the local commit exists. Do not stage `docs/codex/`, `AGENTS.md`, `CLAUDE.md` or `CLAUDE-SKILLS-README.md`.

1. **Enable Google in wineLENS Supabase Auth and configure redirects.** Use project `mcmtasetompygfktzhpr`, not d3-shared. Google callback: `https://mcmtasetompygfktzhpr.supabase.co/auth/v1/callback`. Supabase Site URL: `https://sommni-beige.vercel.app`; redirect allowlist: `https://sommni-beige.vercel.app/link`. Confirm canonical PKCE login and provider settings. Follow the earlier account handoff for session lifetime, device revocation and Storage checks.
2. **Create the Stripe Pro products/prices and webhook endpoint.** USD $4.99/month and $39.99/year; recurring interval count 1, per-unit billing. Configure Customer Portal for management/cancellation. Endpoint: `https://sommni-beige.vercel.app/api/stripe-webhook`, events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `customer.subscription.created/updated/deleted`. Configure a supported Stripe API version with subscription item period dates. Test mode first; the endpoint and key must use the same mode. Token packs use inline price data at Checkout, so do not pre-create pack price IDs.
3. **Set Vercel server environment.** See `.env.example`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`, `WINELENS_BILLING_ENABLED`, `OPENAI_API_KEY`, `WINELENS_SCAN_MODEL` (default `gpt-4.1-mini`). Never prefix secrets with `VITE_`. Preserve the public account/data-API values. Keep `WINELENS_BILLING_ENABLED=false` until the remaining rollout checks pass. Set function timeouts as checked in `vercel.json`; provider timeout is shorter than the five-minute reservation.
4. **Approve Claude to apply migrations.** Review the hosted baseline against the local fixtures, existing triggers, Auth session/refresh-token columns, Storage privileges and prerequisite bottle/study migrations. Approve those prerequisites, then this repo's account migration, then the token migration, in order. Confirm RLS with two real disposable test users and test JWT Studio receipts; inspect new security-definer grants. Reconcile any existing account deletion hooks and billing records first. No migration has been applied to the project by this task.
5. **Deploy the reviewed site/API.** Use `npm run build:site`, output `dist-site`, project `sommni`. Review privacy/refund wording and canonical domain before publication. Verify raw webhook signature handling on the actual runtime, replay delivery, incorrect amount, other-app isolation, cancellation/renewal ordering, failed-provider release, Checkout double taps and annual monthly reset. Keep purchases disabled until Studio integration and beta compatibility are ready; the portal remains available for management. Turn on purchases only after the approved end-to-end test-mode review and correct production configuration.
6. **Run `node tools/smoke-live.mjs`.** No secret is required. It must pass provider settings, `/link`, CORS, read-only malformed-code rejection and unauthenticated billing status. Separately verify a valid-looking bad/expired/used pairing code in an approved disposable-account test, since those attempts write security counters. The smoke probe is intentionally insufficient as a payment or signed-in handshake test.
7. **Install `integrations/sommni-api/usage.js`.** Follow its README; wrap validated rendering + draft storage with reserve/settle, keep the receipt server-side, remove the old conflicting daily quota, and deny replays before any provider call. Point the data API at wineLENS. Preserve original-photo uploads, collection ownership and explicit approval. Validate allowance and token paths, errors, timeout release, revoked sessions and replay. Apply equivalent generic reservation accounting before enabling any wine-list importer.
8. **Rebuild beta 3.2.0.** Build from the reviewed branch with canonical API settings. Inspect manifest origins and the package. Test on physical G2 through the Even app: Google → code → companion session → private Winebrary → restart → revoke/unlink, manual add, scan review/save, Studio consent and Atlas/Study. Glasses show a short paid-limit line only; never a checkout flow. Use the separately approved store process for any later upload.

## Rollback and operations

- Disable **new purchases** with `WINELENS_BILLING_ENABLED=false`. Keep Stripe credentials and the webhook running for already-paid sessions, renewals, cancellations and reconciliation; keep the portal available. Removing `OPENAI_API_KEY` disables new scans. Coordinate disabling rendering/import in the separate provider API; the checkout switch does not revoke existing allowances or token access.
- Redeploy the previous UI if needed, but keep the additive accounting schema and webhook until all charges, holds and delayed events are reconciled. Sweep expired reservations and verify wallet totals using the documented financial-event calculation. Never truncate or modify the append-only ledger or historical rate cards.
- Do not roll back to an external rendering endpoint that bypasses the new usage wrapper while advertising paid allowances. Disable that provider path until both sides agree.
- A real schema rollback requires a separately reviewed maintenance plan after disabling provider calls/checkouts and settling/releasing pending holds. Export necessary financial records securely, remove only the new RPC grants/functions and new tables in dependency order, and preserve existing pairing, collection, catalog, Storage and Study. The deletion guard must be removed together with the entitlement schema if reverting it. No destructive rollback SQL was executed or supplied as an automatic script.
- Account deletion removes private scan results and wallets but preserves minimal financial audit rows. Ending Pro alone does not delete a wallet. Deleting an account cannot restore purchases or photos; review pending checkouts and support/refund requests before deletion. Monitor failed webhook deliveries; replay them after outages. Never log request bodies, photos, codes, JWTs, receipts or secret keys.

Implementation references verified during work: [Supabase function privileges and security definer](https://supabase.com/docs/guides/database/functions), [Stripe raw-body signatures](https://docs.stripe.com/webhooks/signature), [Checkout session creation](https://docs.stripe.com/api/checkout/sessions/create), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js). The supplied PolyGot and parked wineLENS account implementations were consulted read-only.
