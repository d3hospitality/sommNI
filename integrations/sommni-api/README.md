# Bottle Studio usage client (ready to install; not installed by this task)

Copy `usage.js` into the server-only library of sommni-api. Apply the reviewed wineLENS migrations first. Use the existing validated caller JWT and the wineLENS publishable key. No service-role key is needed.

```js
import { studioUsage } from './usage.js';
const usage = studioUsage({ supabaseUrl, publishableKey, jwt });
const draft = await usage.run(body.request_id, body.spend_consent === true, async () => {
  // Existing OpenAI render + private draft storage. Abort provider work at 90 seconds.
  return await generateAndStoreDraft();
});
// Return the draft only; approval remains a separate collection update.
```

Install around the provider call, after validating image ownership and all input, and before returning the generated image. Replace the old three-attempts-per-day render check with this reservation (retain independent abuse/concurrency controls). Keep caller request IDs stable on retries; repeated IDs never run the provider again. A failed provider/storage operation releases the allowance or tokens. Settlement errors after provider success must be retried with the same hold; do not release a possibly committed charge. Unsettled holds expire in five minutes and are swept on subsequent status/reserve calls; an approved scheduler may also call the service-only sweeper.

The RPC derives the user from `auth.uid()`, validates the live Auth session, accepts only one Studio rendering and enforces allowance-first, Pro, consent and limits. Settlement also requires a random receipt available **only on the first successful reserve**. Keep the hold/receipt entirely server-side: never return or log it, including in error objects. A caller cannot release the server's hold by replaying the public request ID or reading their ledger. A malicious caller can reserve their own holds but cannot make the renderer run for a replayed reservation. The server must not accept caller-supplied reservation IDs or receipts.

Do not install this in browser or glasses code. Phone requests may pass `spend_consent`; glasses show only “Rendering allowance reached. Check your account on the phone.” No glasses purchase UI. Wine-list import should use the service-only generic `wine_list_page` RPC per validated page; no importer is introduced here.
