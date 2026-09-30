# wineLENS accounts, G2 pairing and paid Bottle Studio

Status: account, pairing and billing implementation tested locally; **pairing/billing code not deployed and not taking payments**. Google OAuth is enabled in the dedicated Supabase project and a real Google login passed on the local account preview. This branch depends on the catalog/navigation beta fixes in PR #1. Do not publish this frontend before the API and account website use the same project.

## What the audit found (30 September 2026)

The Google button called the real Supabase OAuth API. It was not a simulated login, but the ecosystem was misaligned:

| Component | Observed state |
|---|---|
| G2 account client and marketing bootstrap | `d3-shared` (`hwqovzizjoelzfulhxem`) |
| Dedicated wineLENS database | `mcmtasetompygfktzhpr`: 215 catalog wines, zero auth users and zero saved collection rows at audit time |
| Google in the wineLENS project | Disabled in the public Auth settings |
| Website | `https://sommni-beige.vercel.app`; advertises $4.99/month, $39.99/year and a 7-day trial |
| Pairing and billing | No deployed wineLENS Edge Functions; no pairing code or server billing enforcement |
| Existing API deployment | Advertises the older 0.2.0 endpoints; no Stripe variables listed in Vercel production |

A Vercel environment download returned an empty `SUPABASE_URL`, so the production API's project binding has **not** been verified. Environment-variable names alone are not proof of a working backend. The original API and marketing directories have existing local changes and have been preserved.

## User journey

1. Open the public wineLENS account page in Safari or Chrome. Sign in with Google (when configured) or a verified email link.
2. Choose **Pair my glasses**. Receive an eight-character code, formatted `ABCD-1234`, valid for ten minutes.
3. Open wineLENS in the Even Hub phone companion, choose Sign in, and enter that code. The phone companion establishes a separate Supabase session persisted through Even Hub storage.
4. The account website displays prices from Stripe and opens Stripe Checkout. Existing subscribers use Stripe's customer portal to manage or cancel.
5. Bottle Studio checks the caller's current subscription on the server before reserving quota or calling OpenAI. Linking and catalog access are free.

Google OAuth must run in the external browser; the G2 companion accepts a code. [Google's OAuth user-agent policy](https://developers.google.com/identity/protocols/oauth2/policies) explains the embedded-browser restriction. The code exchange uses Supabase [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) and [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp); this is a custom linking flow, not an implementation of the OAuth device authorization RFC.

## Implemented

- `account.html` and `src/account-page.*`: Chroma/Atelier account page, provider availability check, email verification, code countdown, billing status, server-supplied prices and Stripe redirects. Unconfigured billing shows an honest unavailable state.
- `src/account-client.ts`, `src/account-storage.ts`: shared dedicated-project auth, serialized durable G2 storage, authenticated function calls and token exchange. Sign-out affects the current session; it does not revoke every other linked device.
- `supabase/functions/winelens-link`: verified account minting, HMAC-hashed codes, single-use atomic database consumption, replacement/expiry, global and per-IP rate limits. Rate-limit storage failures deny the exchange. Codes and tokens are not logged.
- `supabase/functions/winelens-billing`: verified-user Checkout, customer portal, status and `require_pro`. User/customer/price/trial/redirect values come from the server; the client supplies only `monthly` or `annual`.
- The migration creates four server-only tables. RLS is enabled; client roles have no access. RPCs use SECURITY INVOKER and are executable only by service_role. No client can edit entitlements or billing ownership.
- Checkout reservation plus Stripe idempotency prevents parallel checkout creation for an account. Selecting another plan while a checkout is active returns a clear conflict; reservations expire after 31 minutes.
- A trial, when enabled, is offered only if the mapped Stripe customer has no subscription history, including canceled/incomplete subscriptions. This is once per account/customer, not fraud prevention across multiple accounts.
- Paid authorization reads Stripe on every protected request. `active`/`trialing` requires a configured price, correct live/test mode and an unexpired period. Canceled, unpaid, past-due, paused, wrong-price and expired subscriptions are denied. Cancellation at period end preserves access until expiry.
- No webhook cache is used in this initial version, so stale/out-of-order events cannot grant access. Stripe outages deny paid work. This adds a Stripe round trip per protected request. Before scaling, implement signed webhooks plus an idempotent entitlement cache/reconciliation job.
- The server gate for the existing Vercel API is in `integrations/sommni-api`. It must be installed and deployed before paid checkout is activated; it is not deployed by building this frontend.

## Launch configuration

The existing advertised pricing is a proposal awaiting the owner's response; it is not hardcoded in the checkout or live UI. Only test fixtures use $4.99/$39.99. Do not create live prices or take payments until pricing and the included rendering allowance are settled. The current three-attempt daily image limit is an abuse guard, not a commercial cost budget. Existing marketing claims about unlimited services are not implemented by this branch.

### 1. One account backend

Use the dedicated project `mcmtasetompygfktzhpr` for the website, G2 package and Vercel API. The publishable key in `src/account-project.ts` is public; no server secret belongs in a Vite variable. Both G2 manifests whitelist only this project. The Vite build and account client reject another Supabase URL or a non-publishable key before creating an auth client.

Review and deploy the API's existing pending collection, bottle storage/quota and study migrations before allowing new users into Winebrary. Configure `SUPABASE_URL` and `SUPABASE_ANON_KEY` on Vercel for this project, then verify with an actual authenticated request. Do not rely on the legacy default URL in the API source.

### 2. Public website and Google

Setup progress on 30 September 2026:

- Confirmed the dedicated **wineLENS** Supabase project is healthy and accessible in the dashboard.
- Created a separate Google Cloud project **wineLENS**, ID `winelens-510218`, under `d3hospitality.com`. No billing services were enabled.
- The owner completed Google consent creation. App name **wineLENS**, external audience, and support/developer contact `ops@d3hospitality.com` are configured.
- Created **wineLENS Web**, client ID `167445156252-6lol2bq8tj7l8qbrdqkh31qj3k85vnjb.apps.googleusercontent.com`. Its sole callback is `https://mcmtasetompygfktzhpr.supabase.co/auth/v1/callback`. Authorized JavaScript origins are `http://localhost:5188` and `https://sommni-beige.vercel.app`.
- Saved the client secret directly in the dedicated Supabase Google provider, enabled Google, and left nonce checks and email requirements intact. No client secret was put in the repository or exported to a file.
- Saved only the standard `openid`, `userinfo.email`, and `userinfo.profile` scopes. No sensitive or restricted Google scopes are configured.
- Google audience is still **Testing**, with `ops@d3hospitality.com` registered as the test user. The current public homepage and authorized domain are `https://sommni-beige.vercel.app` / `sommni-beige.vercel.app`. Privacy policy and terms links remain unset; the live homepage does not expose either link.
- Supabase originally had Site URL `http://localhost:3000` and no redirect allowlist. Added only the exact development account return URL `http://localhost:5188/sommNI/account.html`. Set the final Site URL when the account site is published.
- **Live acceptance passed:** public Supabase Auth settings returned `google: true`; the actual Google flow returned to the account page signed in as `ops@d3hospitality.com`; reloading retained the session. A read-only database query confirmed a verified Google identity in `mcmtasetompygfktzhpr`.
- Google still displays the Supabase hostname on its consent screen. The configured wineLENS name is not a verified public brand yet. [Supabase's Google guide](https://supabase.com/docs/guides/auth/social-login/auth-google#setup-consent-screen-branding) explains brand verification/custom domains. Publish the account site and public policy pages, complete brand/domain verification, then move the audience out of Testing. Do not describe this as a public production launch.
- Pairing and billing functions remain undeployed. A real signed-in page therefore displays membership unavailable; Google login success does not prove pairing, Winebrary API alignment, or payments are ready.


Select the final public account URL. The current provisional build default is `https://sommni-beige.vercel.app/sommNI/account.html`, which is **not published yet**. A custom wineLENS domain can replace it without changing the pairing protocol.

- Set `VITE_WL_ACCOUNT_URL` to the exact deployed account page.
- Build and publish `account.html` with its generated JS/CSS assets. This Vite project uses `/sommNI/` as its asset base; hosting at the site root requires placing assets at `/sommNI/assets/` or building with an appropriate base. The relative Winebrary return link assumes the companion is served in the same directory as the account page. Prefer hosting both at `/sommNI/` and set the account URL accordingly.
- Update the marketing site's CSP `connect-src` to allow `https://mcmtasetompygfktzhpr.supabase.co` and the API. The current CSP only allows the older shared Supabase host. Keep existing assets/marketing pages intact.
- The dedicated Google provider and callback above are configured. Keep the public account build bound to that same project; update only exact site/redirect URLs when publishing it.
- Set the Supabase Site URL and redirect allowlist to the exact account page, plus explicit local/test URLs. Avoid wildcard production redirects. Configure and test email delivery for verified-email links.
- Never paste OAuth client secrets, Stripe secret keys or Supabase service keys into chat or frontend files.

### 3. Pairing database and functions

Review/apply `supabase/migrations/20260930063621_account_linking_billing.sql` through the project's migration workflow. No migration or function has been applied remotely by this branch.

Deploy `winelens-link` and `winelens-billing` with the included configuration. Both disable the gateway's legacy JWT check and perform their own authorization: mint/billing validate the user's token; claim consumes a bounded, single-use secret.

The platform supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Set these additional function secrets:

| Setting | Meaning |
|---|---|
| `WINELENS_ALLOWED_ORIGINS` | Exact comma-separated website, companion and approved dev origins; no wildcard. Inspect the actual G2 host origin during device acceptance. CORS is not the authentication control. |
| `WINELENS_ACCOUNT_URL` | Exact HTTPS return page used for Checkout and billing portal |
| `WINELENS_CHECKOUT_ENABLED` | Leave false/unset until checkout AND the API gate are ready; enable only in the intended test/live environment |
| `STRIPE_SECRET_KEY` | Test key first; live key only after acceptance |
| `STRIPE_PRICE_MONTHLY` | Server-owned recurring monthly price ID |
| `STRIPE_PRICE_ANNUAL` | Server-owned recurring annual price ID |
| `WINELENS_TRIAL_DAYS` | `7` only if the advertised trial is approved; otherwise leave unset (no trial) |

The initial plans use USD; price amount and interval are fetched server-side. Disabling new checkout does not disable existing customers’ status, access checks or billing portal. Both configured prices must belong to the selected test/live mode and have standard recurring intervals. Configure the Stripe customer portal, branding and cancellation options. Do not silently reuse a different application's Stripe customers or price IDs.

### 4. Install the API guard

Run this against the existing API checkout after reviewing its current local changes:

```sh
node integrations/sommni-api/install.mjs /absolute/path/to/sommni-api
```

The installer adds `api/_lib/billing.js` and inserts a two-line guard in `api/generate-bottle.js`. It refuses an unexpected handler shape or a conflicting existing helper. It preserves all other local changes. It must be deployed alongside the dedicated Supabase environment. This branch has only tested installation in a temporary copy, not modified or deployed the original API.

When the check returns 402/503, no rendering quota or OpenAI work begins. This release monetizes Bottle Studio only. Course Builder, local study, local pairings and the rest of the legacy UI are not claimed as subscription-enforced features. Decide any expanded paid scope explicitly and enforce it at the service/data boundary before advertising it.

### 5. Acceptance before launch

- Real Google login and reload persistence passed locally against live Auth. Still verify the published account URL → private Winebrary create/read/update → refreshed session after the API rollout.
- A second account cannot read the first account's collection/photos/reviews.
- Website code → actual Even Hub companion → same account; expired/reused/wrong codes rejected; app restart retains session; sign-out clears private glasses content.
- Stripe **test-mode** subscribe, trial, repeat checkout, portal cancellation and failed renewal; status/paid work reflect actual Stripe state. Test with the real API route, not only the mocked suite.
- A free/unpaid account cannot invoke rendering directly. API timeout/config failure performs no paid work. Existing daily quota still applies to Pro.
- Check actual device CORS/origin and durable storage failures. Native G2 acceptance remains required.
- Review database advisors after applying migrations. The existing project audit includes publicly callable import/update SECURITY DEFINER functions that accept a token argument and a public-schema extension; review these separately before broad launch. Do not loosen those functions to make client access work.
- Confirm production website/API/Edge Functions all target this project, then release the new G2 package. Keep the previous beta package available for rollback.

## Verification completed locally

- TypeScript frontend and Deno function type checks; production build and canonical IDs.
- Actual PostgreSQL via PGlite: client-role denial, RLS, code replacement/expiry/replay, atomic delete, rate counters and checkout reservations. The test harness serializes one database connection; live multi-worker acceptance is still required.
- Edge handler tests through the real Supabase and Stripe SDKs with mocked network responses: forged tokens, server prices/customer IDs, fixed redirects, trial history, canceled/past-due denial, disabled billing and infrastructure failures.
- Browser tests: disabled Google, email verification state, no Pro from redirects, expiry, SDK token exchange, local sign-out cleanup, responsive layout. These are fixtures, not evidence of live OAuth or Stripe transactions.
- API gate tests: rejects string booleans, unpaid status, outages and wrong-project configuration.
- Winebrary, glasses navigation and study regression suites.
- `npm audit`: zero reported vulnerabilities after compatible lockfile updates.

Reference: [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [subscriptions](https://docs.stripe.com/api/subscriptions/object), [Google OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies), [Supabase Auth](https://supabase.com/docs/reference/javascript/auth-verifyotp).
