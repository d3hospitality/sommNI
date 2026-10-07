# Local account and token database proof

`npm run test:sql` is the required native PostgreSQL proof. It creates a throwaway cluster on an ephemeral loopback port and deletes it afterward. It never reads a database URL, Supabase key or `.env` file. `WL_PG_BIN` may override `/opt/homebrew/bin` on another machine. All migrations in `supabase/migrations` are discovered and applied in filename order.

`bootstrap.sql` supplies minimal Supabase Auth roles/tables/GUC functions and Storage objects. `baseline/0001*`, `0002*`, and the bottle/study files are read-only snapshots from the specified sommni-api reference checkout on 2026-09-30. The two absent ingest migrations are represented in `0003_0004_minimal.sql` by the hosted project's `ingest_batches` / `ingest_wines_raw` columns (read 2026-10-07) and a stub RPC. They do not substitute for checking the managed hosted schema before launch.

`assertions.sql` exercises real account, usage, consent, expiry, RLS, immutable-ledger, subscription-ordering, scan-cache and scoped Studio RPC behavior. The native runner adds independent-process reserve/grant/claim races. A failed assertion or SQL error fails the command; no fallback silently turns a blocked native run into PASS.

Supplemental `npm run test:sql:embedded` executes the same bootstrap, migrations and assertions in real PostgreSQL/WASM via PGlite. `npm run test:sql:api` runs production scan and webhook handlers against that database, using fake provider responses and locally generated Stripe test signatures. Neither replaces native multi-connection concurrency validation.
