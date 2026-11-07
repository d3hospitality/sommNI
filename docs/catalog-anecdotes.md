# Catalog anecdotes

The 215-wine catalog has one sourced, two-paragraph maker anecdote per immutable catalog ID. This is shared editorial reference content, separate from a person's tasting observations or saved vintage. `wine` scope concerns the named wine; `producer` scope is explicitly estate context. Unknown vintages and identity discrepancies are not filled in with invented claims.

## Stored in the sommNI Supabase project

- `wl_wine_anecdotes`: current title, text, wine/producer scope, identity note, cited URLs, model, prompt version, generation date and status.
- `wl_anecdote_attempts`: input identity, full research memo, actual provider citation metadata, draft, token usage, completion status and errors for every attempt. Rejected drafts remain in the audit trail. A formatting retry can reuse the previous research and records its originating attempt.
- `wl_anecdote_runs`: a short-lived catalog-only editorial credential is stored as a SHA-256 hash, never plaintext. An active run can claim only pre-seeded wines, with leases and at most four attempts per wine. Close the run after generation.

All three tables have RLS and no anon/authenticated grants. The claim RPC uses invoker security and is service-role only. `sommni-anecdotes` validates the run credential itself; it never receives an OpenAI key from a browser. The existing server secret is used for web research and structured editing with `gpt-6.1-sol`. Prompts are versioned in `prompts/wine-anecdotes.ts`.

## Read and display

`winelens-beta` action `catalog_anecdotes` returns ready editorial records only. During a refresh, the offline bundle supplies previous stories until each replacement is ready. Run credentials, audit inputs and personal data are excluded. Opening notes never generates another anecdote or invokes the paid model.

`scripts/sync-anecdotes.py` reads that feed and refuses an incomplete or duplicate catalog. It updates the offline JSON and the catalog's anecdote fields without changing wine identities. The phone notes, saved catalog Winebrary entries, G2 catalog and G2 Winebrary/Atlas routes all read the same content. Phone notes include source links, scope, generation date, identity cautions and export citations. Translations use the existing text-hash cache. Personal notes remain separate.

The app refreshes public editorial content in the background, with an eight-second timeout and a last-version check. The bundled content is immediately available offline. A refresh cannot overwrite a newer bundled record with an older one.

## Editorial run

Create a short-lived run and pre-seed canonical IDs using authorized administrative access. Put the plaintext run token only in a private local JSON file, outside the source tree. Do not put an OpenAI or service-role key in that file.

```
python3 scripts/generate-anecdotes.py --run-file /private/path/run.json --output /private/path/results.jsonl
```

Optional canonical/legacy wine IDs select retries. The server returns existing ready records without generating again. Review failures, identity cautions, citations and duplicated themes. `needs_review` records are never served as published anecdotes. After all records pass, close the run, remove the temporary credential, run the sync script, and validate all 215 G2 text budgets with `qa-anecdotes.html` and `qa-reading-detail.html` before packaging.

The content is AI-researched and source-backed, not represented as individually human-certified or as a sensory assessment of a particular bottle. Source documents can change; corrections should retain the audit trail and update the current record.

## Maker revision · 3.7.2

Prompt version 3 researches the actual winemaker, grower, founding family or estate team behind each entry. It prefers a documented decision, setback, experiment or collaboration, with an outcome. A wine label’s namesake alone is not the maker’s story. Current and historic roles stay explicit; no invented first-person quotes or generic regional filler. Producer-scope stories do not imply an unverified link to a cuvée or vintage.

Two ambiguous producer abbreviations were checked visually against existing representative photographs before retry: `w8.png` reads Maison Louis Latour / Nuits-Saint-Georges; `w35.png` reads Giacomo Borgogno & Figli / Barolo. These checks identify the catalog producer, not a user's bottle vintage. The evidence and retry hints are recorded in `wl_anecdote_attempts.input`.

## Small-buffer host compatibility

A native simulator probe rejected upgrades at 1,000 bytes even though the SDK documentation describes a 2,000-character limit. Appending a chunk replaced the text instead of extending it. The app therefore attempts the full reading, then falls back to an overlapping, one-line scrolling window in the same container on a rejecting host. Paragraph gaps and the entire story remain available; no numbered pages are introduced. Native long-buffer hosts keep native scrolling. Bridge writes and fallback scrolling remain serialized, and page ownership prevents stale updates.


## Quiet notes · 3.7.3

All note and story screens are text-only. The web app no longer creates or plays tasting narration, exposes device read-aloud, or starts microphone practice. G2 note taps never activate the microphone. The retired voice reader and its page/display hooks were removed. Paragraphs, source links, translations, text downloads and continuous G2 scrolling remain. Wine-search microphone permission is separate. Existing stored audio was not deleted.
