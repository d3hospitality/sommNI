# wineLENS
## Product requirements: Know the bottle. Remember the wine.

Version 1.0 · 29 September 2026 · Product owner: Romario · Implementation handoff: Claude

**Decision:** build wineLENS around real bottles, trustworthy wine information, a private Winebrary, and short, effective learning sessions. Keep the selected Chroma composition and Atelier palette. Remove the robot. Use the phone for exploration and editing, and Even G2 for concise recall and service assistance.

**Document status:** build-ready specification, with a tested local foundation. Requirements below are proposed work unless explicitly marked implemented. No production release, live database migration, physical-glasses certification, or complete 215-wine fact verification is claimed.

## 1. Problem and product promise

The current app has useful catalog, collection and quiz features, but finding a bottle can take several steps and the information has little field-level provenance. Quizzes sometimes reward recognizing stored tasting-note wording, while the app does not reliably persist mastery or schedule future reviews. Attractive bottle images improve recognition, but their visible label year can accidentally imply the wrong release.

wineLENS should help a wine enthusiast or hospitality professional answer three questions: **What is this bottle? What can I confidently say about it? What should I practice next?** The product should make missing evidence visible without making normal use feel like database administration.

Initial audience: individual hospitality professionals and engaged wine drinkers. Team training is a later extension. The core learning experience must work without opening or drinking a bottle.

### Outcomes and measurement

Targets below are product hypotheses, not existing baselines or research promises. Collect baseline data during the first pilot week.

| Outcome | Pilot target | Measurement |
|---|---|---|
| Reach a known saved wine quickly | Median under 7 seconds; p90 under 15 seconds from the home screen | Timed service lookup on G2 and phone; report each separately |
| Save a new wine and distinguish its release | At least 90% of observed pilot attempts succeed without assistance | Ten or more moderated tasks including NV, unknown year and two vintages |
| Learn rather than repeatedly recognize | At least 15 percentage-point improvement on equivalent, unprompted seven-day recall items versus baseline | Within-person held-out questions; report sample size and missing follow-ups |
| Keep study sustainable | At least 60% of activated pilot users complete three sessions in week one | A session requires five valid reviews or all due cards if fewer |
| Earn trust in published facts | 100% of scored factual answers have an approved claim and a resolvable source record | Automated content gate; unresolved records remain available with clear status |

## 2. Verified starting point

Inspected local code and artifacts on 29 September 2026:

| Area | Current state | Remaining work |
|---|---|---|
| Brand and companion | wineLENS name, Chroma/Atelier UI, Vite/TypeScript | Consolidate remaining legacy copy and simplify navigation |
| Catalog bottles | 214 isolated photographs installed; 215 image IDs resolve | Pahlmeyer identity; source-detail quality; image-use permissions for wider publication |
| Winebrary | Account UI, manual/catalog add, separate vintage records, photo review | Live deployment and real-account validation; add release codes and canonical identity |
| G2 collection | Library, vintage groups, detail pages, account-bound offline text cache | Physical G2/R1, OAuth and photo-picker testing |
| G2 navigation | Pagination and return-to-origin fixes from Claude | Complete next study/service flows and hardware timing checks |
| Robot removal | Implemented in this handoff: six builders reflowed; image requests and 12 bundled images removed | Validate final interaction layout on hardware |
| Study | Phone/G2 question generators, favorite-based decks, quiz history | Shared learning engine, sourced cards, recall, spaced reviews and durable progress |
| Mastery | `checkAndUpdateLearned` returns a boolean; it does not write the learned vault | Replace with persistent, evidence-based per-card state |
| Catalog identity | Positional `w0…w214`; unknown lookup can fall back to `w0` | Immutable IDs and a verified migration map |
| Sync | Some legacy read/modify/write operations can race; failures are swallowed | Serialized updates, explicit save failures and account isolation |
| Backend | Shared Supabase/Vercel routes and private-photo migration exist locally | Apply migrations and deploy in dependency order after release checks |

Primary app: `/Users/d3hospitality/Desktop/d3-apps/sommni 2`.
Shared API: `/Users/d3hospitality/Desktop/d3-web/sommni-api`.
Marketing/discovery: `/Users/d3hospitality/Desktop/d3-web/sommni-web`.
Photo pipeline: `/Users/d3hospitality/Desktop/d3-apps/sommNI - Sprite Bottle Maker`.
Other local consumers: WineLens Studio, sommni-processor, Sprite System and Android. Audit their API contracts before changing shared endpoints.

The working app uses SDK 0.0.9 and simulator 0.9.5. Current official SDK guidance lists 0.0.12 and image compression support; this is an upgrade investigation, not an instruction to replace the tested version immediately. See [Even's SDK reference](https://github.com/even-realities/everything-evenhub/blob/main/plugins/everything-evenhub/skills/sdk-reference/SKILL.md).

## 3. Product boundaries and experience

### Phone navigation

Four primary destinations: **Winebrary**, **Discover**, **Study**, **Account**. Place pairings and tasting sessions within wine details. Keep venue inventory and course planning accessible as secondary tools until real usage establishes their value.

Winebrary defaults to the user's saved wines. Discover contains the shared catalog and research. Study defaults to today's due work. The account area contains data export, privacy, connected glasses and preferences. A new account should see an obvious add action and three optional sample cards clearly identified as examples.

### Glasses home

Proposed order: **My Winebrary**, **Find a wine**, **Study today**, **Recent wines**, **Browse catalog**. Preserve current home indexes until routing and regression tests migrate together. Display one active task at a time. The glasses should never require typing or managing source records.

### Core user stories

1. As a server preparing for a shift, I want a five-minute review of wines I struggle with so I can explain them accurately without reading a script.
2. As a collector, I want 2017, 2019, NV and unknown releases to stay separate so notes and bottle images remain attached to the correct wine.
3. As a curious drinker, I want to open the source behind a fact so I can distinguish producer information from an AI explanation or a personal impression.
4. As a G2 wearer, I want to find and read a saved bottle in a few gestures, including when the phone temporarily loses its connection.
5. As a learner, I want to attempt an answer before seeing it and revisit difficult material later, without a long overdue queue becoming punitive.
6. As a user adding a missing wine, I want to save what I know now, then improve its metadata and image without losing my entry.
7. As a user with a failed upload or expired image link, I want my wine and study progress to remain usable.
8. As someone switching accounts on a shared device, I want the previous person's wines, photos and study answers removed from view and cache.

### Scope for the first release

P0 is a small complete loop: save a wine; understand its identity and cited facts; study approved cards; review them later; see the result on G2. P1 adds import/OCR, richer comparison and service exercises. P2 includes team curricula, venue integrations and adaptive optimization.

Deferred: certification claims, a comprehensive marketplace, universal automated bottle authentication, automatic producer-data scraping at internet scale, social feeds, 3D bottle reconstruction and real-time point-of-sale stock. These would add distinct data, rights or operational dependencies before the individual learning loop is proven.

## 4. Design requirements

Retain the existing tokens: ivory `#FBF7EF`, oxblood `#772B39`, ink `#302822`, muted brown `#766254`, border `#DFD4C5`. Use blush as a supporting surface. Keep Space Grotesk for the current typographic identity. Strong type, generous space and carefully lit bottles carry the visual character.

**D-01 · P0 · No mascot.** No robot images, emotion states, robot downloads or robot-shaped empty states in web, G2, packaged assets or newly generated screenshots. Feedback uses specific language: “Correct”, “Review this”, “Saved” and “Try again”. Wine identity and progress occupy the reclaimed display area.

**D-02 · P0 · Accessible companion.** All controls are keyboard reachable with visible focus; dialogs restore focus; labels persist outside placeholders; errors announce their meaning; color never carries status alone. Test 360, 390, 768 and 1440 px layouts, 200% text zoom, reduced motion, and WCAG AA contrast. Phone controls have at least a 44 px target where layout permits.

**D-03 · P0 · Photo presentation.** Preserve alpha bounds and uniform scaling. Keep actual neck, shoulders and base intact. Provide a neutral fallback when an image is missing. A representative image must say so in details; users can replace it with their own release photo. Do not silently stretch bottles or generate label text to improve apparent sharpness.

**D-04 · P1 · Physical scale.** Support `height_mm`, `diameter_mm`, `volume_ml`, source and measurement method. Show a scale comparison only when measurements are verified; otherwise normalize display size. Volume alone must not determine height. Current 768 × 1536 masters and 384 × 768 web assets preserve proportions, not verified centimeters.

## 5. Wine identity and private collection

**I-01 · P0 · Stable identity.** Introduce immutable canonical wine IDs and keep an explicit unique map from each legacy ID. Preserve catalog ordering during migration. Never fall back to `w0` on a failed lookup: show an unavailable record and disable identity-bound writes. Acceptance: reorder the source catalog and every existing favorite, photo, pairing, inventory entry and study event still references the original wine.

**I-02 · P0 · Separate wine, release and owned entry.** A wine describes producer/cuvée. A release describes vintage or NV bottling code and relevant format. A collection entry is a user's saved instance with its own UUID, notes and approved photo. Preserve explicit year / non-vintage / unknown states. A year is never inferred from a product name alone. NV14 and Krug edition numbers remain release identifiers, not harvest years.

**I-03 · P0 · Save-first editing.** Required manual field: wine name. Producer, region and year can be unknown. A successful wine save survives photo/OCR/render failures. Add-another-vintage creates a new entry and clears vintage-specific notes and image. If identity changes, ask the user to re-confirm image association instead of retaining it silently.

**I-04 · P0 · Private by default.** Authenticated collection access uses caller identity and row ownership. Never accept caller-supplied ownership as authoritative. Private image URLs expire; refresh them without deleting wine information. Account switch clears private in-memory state, cached images and offline study data for the previous user. No signed URLs or tokens in telemetry.

**I-05 · P1 · Assisted intake.** Phone camera/album and list/PDF import produce editable proposals. Show the matched producer, cuvée, release and source before saving. Ambiguous matches remain unresolved; duplicates can be linked deliberately. The G2 glasses do not have a camera; scan intake happens on the phone.

## 6. Reference system: every fact has a scope

A bottle image is evidence of packaging, not a complete technical sheet. The 214 reviewed photos do not mean 214 wines have verified production facts.

**R-01 · P0 · Claim-level records.** Store each factual claim with field, value, unit, canonical wine/release/format scope, source ID, retrieval time, locator such as page/section, short supporting excerpt or extracted value, review status and reviewer. Track source content hash and extraction version. Unknown remains null. Review states: unreviewed, approved, conflicting, superseded and unavailable-source.

**R-02 · P0 · Source hierarchy.** Prefer producer technical sheets for the exact release, producer product pages, official regional/appellation bodies, then authorized importers. Retailer listings and label OCR are discovery evidence until confirmed. A model's output is an interpretation or candidate extraction, never a source. Record image-use permission separately from factual-source quality.

**R-03 · P0 · Release-aware facts.** Grape percentages, alcohol, residual sugar, aging, dosage and disgorgement are release-sensitive. Never copy a 2023 sheet into 2024 facts without support. Producer location and wine appellation are separate fields. Historical certifications are not current certifications. Store critic, scale, year and review date if a rating is used; do not flatten a producer's award list into the current bottle's rating.

**R-04 · P0 · Conflicts and stale references.** Preserve competing claims with their scopes; do not average or choose the newest webpage automatically. A broken URL does not erase previously captured evidence, but its availability status changes. Unresolved claims cannot generate scored questions. Recheck released records on a scheduled content-maintenance process owned by the product team; define cadence by source volatility, not a universal expiry.

**R-05 · P0 · Explain the evidence.** Wine details offer compact source chips with publisher, release and verification date. AI explanations cite the specific supporting claims and distinguish a factual statement from a pairing suggestion or tasting interpretation. If evidence is insufficient, say what is missing and offer manual entry or a source submission.

**R-06 · P0 · Safe ingestion.** Treat uploaded PDFs, source pages and OCR as untrusted content. Parse data without executing instructions embedded in documents. Validate file type/size, outbound retrieval destinations and redirect limits; reject private-network URL fetches. Store credentials server-side. Avoid silently purchasing image-generation retries.

### Initial researched examples

- **Cain Cuvée NV14:** the producer sheet identifies 48% 2013 and 52% 2014, from Napa Valley. This is a useful release-identity teaching card; NV14 must not become a single-vintage 2014 entry. [Producer fact sheet](https://www.cainfive.com/wp-content/uploads/2021/08/NV14_Cain_Cuvee_factsheet.pdf).
- **IXSIR Grande Réserve Rosé 2023:** the producer's 2023 sheet lists Mourvèdre, Cinsault and Syrah without blend percentages. Store the varieties and leave percentages unknown. Do not transfer older ratings listed on that sheet to 2023. [Producer technical sheet](https://ixsir.com/wp-content/uploads/2024/09/GR-Rose-2023.pdf).
- **Pater Patriae:** the producer identifies it as IGT Toscana Pinot Nero. That supports identity and grape/appellation questions; the page's general production description does not prove an individual user's vintage. [Producer product page](https://tenuta-cafaggiolo.com/it/wine/pater-patriae/).
- **Hubert Brochard Les Monts Damnés:** current producer material and an older indexed technical sheet describe different maturation details. Keep these as version-sensitive research until the intended release is resolved. The older PDF URL returned 404 during direct retrieval. [Current producer page](https://www.hubert-brochard.fr/vins/les-monts-damnes/).
- **Pahlmeyer w105:** the seed label “Cabernet Sauvignon” remains ambiguous between Pahlmeyer Proprietary Red and Jayson Cabernet Sauvignon. Resolve with Romario; do not choose based on a generic bottle photo.

The companion `wine-reference-register.json` covers all 215 records and separates photo review from fact review. Only the three directly retrieved examples above start with approved pilot claims. Additional facts require editorial review before quiz generation.

## 7. Study system

### Evidence and intended application

Retrieval practice improved delayed retention compared with repeated study in Roediger and Karpicke's prose-learning experiments. Use an attempted answer before revealing the explanation, and assess delayed recall rather than only immediate accuracy. This is a product application of the research, not a proven wineLENS outcome. [Primary study](https://learninglab.psych.purdue.edu/downloads/2006/2006_Roediger_Karpicke_PsychSci.pdf).

Cepeda and colleagues found that useful spacing depends on the intended retention interval. Use spaced return sessions with transparent due dates; do not market one fixed schedule as universally optimal. [Primary spacing study](https://www.yorku.ca/ncepeda/publications/CVRWP2008.pdf).

Use original tasting prompts and link to recognized educational references. WSET's SAT is a useful external reference; do not copy its protected chart or imply WSET endorsement. [WSET SAT reference](https://wsetglobal.com/knowledge-centre/wset-systematic-approach-to-tasting-sat/).

### The daily loop

**Choose time → attempt recall → reveal evidence → rate effort → receive a due date → finish with one useful takeaway.** Offer a default five-minute session, a two-minute quick session, and an optional longer session. A user can stop at any point without losing completed reviews.

**S-01 · P0 · One shared engine.** Replace the separate phone and G2 question-generation paths with common card, scoring and scheduling logic. UI adapters render the same card differently. Questions have stable IDs, content version, skill and supporting claim IDs.

**S-02 · P0 · Recall before recognition.** Phone supports short answers and self-assessed reveal cards. G2 presents a short prompt, waits for a tap to reveal, then offers Again / Hard / Good / Easy. Multiple choice is a supported training mode; record it as recognition, not equivalent to unaided recall. Require an explicit attempt/reveal sequence before a review can advance scheduling.

**S-03 · P0 · Valid questions.** Only approved objective claims create scored factual cards. Exactly one defensible correct answer; normalized unique options; distractors from the same category; accepted spelling and accent variants. Skip a card if quality constraints cannot be met. Hide bottle label text and other answer cues while asking grape/producer/region facts when the label would reveal the answer.

**S-04 · P0 · Tasting as observation.** Record appearance, aroma, structure, finish and the user's explanation with date/context. Compare observations with attributed producer notes after the user responds. Never mark “I smell cherry” wrong solely because stored notes say blackberry. Separate knowledge accuracy, recognition, sensory calibration and self-confidence in progress displays.

**S-05 · P0 · Explain feedback.** Show the correct fact, one concise reason, scope and source. “The producer's 2023 sheet lists…” is preferable to generic praise. Use calm feedback and an action to flag a bad question. Flagged/source-conflicted cards stop contributing to scores until reviewed.

**S-06 · P0 · Deterministic first scheduler.** Ship a small auditable scheduler before optimization. Proposed learning steps: one, three, seven, fourteen, thirty and sixty days. Again schedules one same-session retry after at least three other cards, plus next-day review; it does not count as delayed success. Good advances one step only after a due review; Hard repeats the current interval; Easy advances at most one additional step. Review ahead does not repeatedly inflate interval or mastery. These are starting rules to evaluate in the pilot.

**S-07 · P0 · Manageable workload.** Default to five new cards and up to fifteen due cards per day, with visible user controls. Prioritize overdue, recent errors and selected wines; give an honest remaining count. Overdue cards reschedule from actual completion, avoiding an automatic overdue spiral. Completing a session never falsely says the whole collection is mastered.

**S-08 · P0 · Durable events.** Every review has an immutable event ID, user ID, card/version, response mode, outcome, self-rating, timestamp and duration. Server-side idempotency prevents duplicate taps or offline retries from double-counting. Serialize local updates and merge events deterministically. A save failure visibly marks pending sync; retries preserve the same event ID. Account changes cannot replay events into another account.

**S-09 · P0 · Honest progress.** Show due / learning / stable / needs review per skill and card. Proposed “stable” threshold: two correct unaided due reviews on separate days, with the latest at least seven days after first learning. This is a pilot heuristic. A lapse reopens review. An old perfect multiple-choice session is not proof of durable mastery. Migrate old history as legacy evidence without inventing past recall events.

**S-10 · P1 · Comparisons.** Pair likely-confused wines or regions. Ask for one meaningful difference, then show a compact comparison grounded in approved facts. Use alternating cases rather than only repeating one wine. Treat the benefit as a hypothesis to test in this product.

**S-11 · P1 · Service rehearsal.** Prompt a twenty-second explanation, a guest preference, or a food pairing. Grade factual claims against sources; assess a proposed explanation with a transparent rubric, not a single supposedly correct script. Label pairings as suggestions and keep inventory availability separate from learning score.

**S-12 · P1 · Palate and pronunciation practice.** Offer optional side-by-side tasting journals and pronunciation references. Phone audio may help; do not promise audio playback from G2, which has no speaker. Taste exercises are optional and never required to maintain a streak or finish a deck.

### Example five-minute session

1. Recall the grape/appellation of a saved wine without the label visible.
2. Explain why Cain NV14 is not a single-vintage 2014 wine.
3. Revisit yesterday's missed region card.
4. Compare two commonly confused wines using one sourced difference.
5. Deliver a short service explanation; reveal a reference example, then mark the effort and next review.

## 8. Even G2 requirements

The official platform specifies 576 × 288 pixels per eye, monochrome green with sixteen levels, and phone-hosted web apps. There is no glasses camera or speaker. [Official hardware overview](https://hub.evenrealities.com/docs/get-started/overview).

**G-01 · P0 · Readability first.** One prompt or decision per screen. Prefer a service summary to long tasting prose: identity/release, one sourced anchor fact, a short style description with attribution, then optional detail. Use the bottle image for identification; omit it on a study question when it gives away the answer.

**G-02 · P0 · Consistent input.** Tap selects/reveals; double-tap returns one level; scroll navigates or scrolls the active text. Keep the return origin, page and selected row. Long press or microphone behavior requires explicit SDK/hardware validation before being exposed.

**G-03 · P0 · Display invariants.** Every container stays within 576 × 288; exactly one event-capturing container; page totals match actual containers; lists contain at most twenty rows. Preserve the local tested limits of 63 UTF-8 bytes per list label and 999 bytes per text container until reverified against the chosen SDK/firmware. These byte limits were measured in simulator 0.9.5, not claimed as universal vendor guarantees.

**G-04 · P0 · Transfer lifecycle.** Render text first. Queue image transfers, reject stale page updates, and handle a refused page without advancing navigation state. Split catalog/private images only within tested image-container limits. Retain sixteen-level conversion and uniform aspect ratio. Reconnect without duplicate event listeners.

**G-05 · P0 · Offline behavior.** Save an account-bound text snapshot and approved study cards with content versions. Show when an offline copy is in use. Never cache expiring signed image links as durable identifiers. Session reviews queue locally and sync once when connectivity returns; signing out clears sensitive state.

**G-06 · P1 · Service access.** Recent and pinned wines can be reached from home within two selection actions. Search on the phone can open the matching glasses detail. Voice search is opt-in and must disclose listening; API failure leaves navigation usable.

**G-07 · P0 · Hardware gate.** Validate actual G2 and R1 navigation, BLE image timing, startup/resume, disconnected state, OAuth return, file picker and long-session memory. A simulator screenshot does not satisfy this gate.

## 9. Proposed data and service contracts

Extend the existing stack; do not rewrite this Vite app into a different framework to implement this PRD. Supabase remains identity/data/storage; the existing API mediates privileged retrieval and generation.

| Entity | Essential fields and relationship |
|---|---|
| `wine` | immutable ID, producer, cuvée, aliases, identity status, legacy map |
| `wine_release` | wine ID, vintage state/year, NV or edition code, volume, optional measured dimensions |
| `collection_entry` | existing user-owned UUID, optional canonical/release links, private notes and approved image |
| `reference_source` | publisher, canonical URL, kind, retrieved time, content hash, availability, rights metadata |
| `wine_claim` | wine/release/format scope, field/value/unit, source locator, status, reviewer and revision |
| `bottle_asset` | source/owner, wine/release/format, photo/generated status, crop/aspect metadata, approval and usage permission |
| `study_card` | immutable ID, version, skill, prompt, answer/rubric, supporting claim IDs and eligibility |
| `review_event` | immutable idempotency ID, user/card/version, mode, outcome, rating, occurred/received times |
| `study_state` | user/card, due time, interval/step, lapses, review counts, scheduler version |
| `tasting_session` | user/release, observation fields, context, date and separate reference comparison |

Proposed endpoints, to be reconciled with existing routes: `GET /api/wines/:id`, `GET /api/wines/:id/references`, `POST /api/reference-submissions`, `GET /api/study/today`, `POST /api/study/reviews` and existing `/api/collection` CRUD. A review request includes `event_id`, `card_id`, `card_version`, response mode, outcome and occurrence time; the server determines ownership and scheduling policy. Duplicate event IDs return the original result. Do not expose arbitrary URL retrieval or model tools directly to a browser caller.

Version published content so a corrected answer can invalidate affected cards without silently changing historical responses. Use additive migrations first, a reversible legacy-ID mapping second, and reader/writer cutover last. Export legacy storage before migration; dry-run all 215 mappings and verify counts and sample histories.

## 10. Intelligence and content quality

AI helps extract candidate facts, explain approved claims, propose questions, suggest comparisons and polish user-requested bottle images. It does not create authoritative facts, assign an unconfirmed vintage, certify authenticity or silently override user observations.

Use structured outputs, bounded source context, claim IDs and explicit abstention. Keep prompts in the repository's top-level `prompts/` using the required XML structure. Evaluate at least: wrong cuvée, same producer/different year, NV release codes, two bottles in one image, inaccessible sources, conflicting production details, missing dimensions, and prompt injection inside uploaded material.

Start with three researched wine examples as a gold set, then expand to twenty diverse wines for the pilot: red, white, rosé, sparkling, NV/edition-coded and multiple formats. An editor approves facts and cards before broader catalog coverage. Full 215-wine research is a tracked content project, not a checkbox inferred from photo completion.

## 11. Release and implementation sequence

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0: foundation | Robot-free app, photographic catalog, reviewed source snapshot and PR | Typecheck/build, browser, navigation and all-bottle raster checks; current files preserved |
| 1: trusted Winebrary | Stable identity map, release-aware claims, private save/photo flow | Migration dry-run; zero cross-account leakage; three pilot reference cases represented correctly |
| 2: daily learning | Shared engine, recall/reveal, scheduler and review persistence | Deterministic scheduling tests, offline replay, distinct mastery modes and seven-day evaluation instrument |
| 3: pilot release | Staging API/database, relative-path Even package, twenty researched wines | Real account round trip, hardware matrix and rollback rehearsal |
| 4: enrichment | Wider source coverage, import/OCR, comparisons and service practice | Measured pilot outcome, editorial review capacity and content-quality gate |

Planning estimates should be supplied by Claude after dependency and hardware review; no committed delivery date exists. Report blockers with an exact owner and reproducible evidence, not a generic “needs deployment”.

### Concrete release checklist

- Confirm revocation of the historically exposed provider key before provisioning a fresh server-only key. Revocation has not been verified in this task.
- Review current API changes and apply the collection/storage/quota migrations in staging first; validate ownership, quota and idempotency with a real test account.
- Reconcile older Android/import clients with the changed authenticated reference-image endpoint before API rollout.
- Configure exact Supabase OAuth/email return URLs and allowed staging/Even origins; verify in the actual host app.
- Replace use of the legacy `deploy.sh`: it deletes a generated checkout and kills every Vite process. Use scoped build/deploy commands for this repository. Never stop PolyGot on port 5173.
- Build the web app with `/sommNI/`; build the Even package separately with `--base=./`. Exclude review galleries, backups, master photos and unused artwork from the shipping package when measured size warrants it. Measure the actual packaged size and image-transfer timing.
- Run dependency/security review for the concrete release, check current files for provider secrets, and confirm image-use permission for publicly distributed reference photos. Source facts and image-use rights are separate records.
- Verify old bookmarks/package identity and legacy data migration. Keep package ID `com.d3hospitality.sommni` unless a separately approved migration requires otherwise.
- Keep the previous deployed build and additive-schema rollback plan. Database cleanup waits until old readers are retired.
- Merge and production/store release only after review and the live/hardware gates. A pushed draft PR is not a deployment.

## 12. Acceptance matrix

| Scenario | Expected result |
|---|---|
| Unknown catalog lookup | No w0 fallback; no write to the wrong wine |
| Reordered seed catalog | Legacy links retain exact wine identity |
| Add NV14 | NV release code preserved; not converted to 2014 |
| Add another year | Separate entry; prior notes and photo remain intact |
| Edit identity with attached image | Image association requires reconfirmation |
| Reference conflicts or has no exact release | Status shown; no scored factual card generated |
| User aroma differs from producer note | Both remain attributed; no automatic wrong-answer mark |
| Double submit, offline replay or fast tap | Exactly one review event and one scheduling update |
| Review ahead repeatedly | Due date and mastery do not inflate |
| Sign out/account switch offline | Previous private wines and reviews become inaccessible |
| Failed storage/write/render | Wine preserved; pending/failed state is explicit and recoverable |
| Robot removal | No mascot containers, requests or bundled robot assets |
| Long labels and accented names | Valid byte lengths and in-bounds layouts; full identity available in detail |
| Refused page or stale image transfer | Navigation stays on the actual displayed page; old image is discarded |
| Desktop/mobile/G2 study adapters | Same card version, scoring result and next due time |
| Source correction | Affected card paused/versioned; history remains auditable |

## 13. Analytics and pilot

Track `wine_saved`, `source_opened`, `reference_flagged`, `study_started`, `card_attempted`, `answer_revealed`, `review_saved`, `review_sync_failed`, `session_completed` and `glasses_lookup_completed`. Include opaque IDs, content/scheduler version, modality and coarse latency. Exclude names, private tasting text, image URLs, authentication tokens and raw audio by default.

Use a small consented pilot with baseline recall, matched seven-day follow-up and brief interviews. Measure correctness separately from confidence, recognition and subjective tasting. Compare time spent as well as scores. Do not claim a learning benefit from streaks or session count alone.

## 14. Decisions and ownership

| Decision | Owner | Blocking scope |
|---|---|---|
| Pahlmeyer intended label | Romario | That one photo/reference; not the rest of the app |
| First pilot audience and twenty wines | Romario + content editor | Pilot recruitment/content set; default to personal hospitality study |
| Source and image-use approval | Content owner | Publication of affected records/assets |
| Historical key revocation and production access | Account owner | Live paid rendering/release |
| SDK 0.0.12 upgrade value and regressions | Claude | Upgrade only; current 0.0.9 work can continue |
| Availability of physical G2/R1 | Romario + Claude | Hardware certification/release, not local implementation |
| Final scheduler and mastery thresholds | Product + engineering | Tune after pilot; initial rules above are explicit defaults |

**Claude's first implementation milestone:** review the foundation PR, preserve the photo work and navigation fixes, then deliver one complete sourced-wine → recall-card → persisted review → next-day due-card flow on phone and G2. Use the three researched examples to prove identity and citation behavior before expanding the catalog.
