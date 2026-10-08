# wineLENS Study

Two loops, on the phone and on Even G2, from one Study map (Home › Study):

1. **Seasons** (practice, PolyGot model): map → season → stages → boss.
2. **Daily review** (sourced facts, spaced repetition): sourced wine/release → approved recall card → attempt → reveal with source → one rating → one persisted review → next due date.

## Seasons

| Season | Stages (generated from the catalog) |
|---|---|
| Grapes & styles | Meet the styles · Burgundy & bubbles · Italian icons · Bordeaux & friends · Sun & spice · Crisp whites · Off the beaten path |
| Regions & countries | The big four · France / Italy / United States up close · Spain & Portugal · New frontiers |
| Tasting notes | Classic reds / whites / Old World reds (textbook markers) · Read the glass · Nose to wine · Palate to grape (catalog notes) |
| Producers & stories | Tuscan houses · Piedmont families · California dreamers · French estates · Around the world |

- **Cards** (`src/study/seasons.ts`): *meet* introduces, *flash* flips and is self-graded (Knew it / Not yet), *pick* has three options, *spot* is true/false. IDs are stable (`p.<season>.<stage>.<subject>.<kind>`) and option order is seeded, so every device builds the same cards. `cardProblems()` rejects a card whose prompt gives the answer, whose answer is not exactly one option, or whose options repeat (checked for every card in `npm run test:study`). Ambiguous style questions (a "Brut Rosé" label, a sweet sparkling wine) are never generated.
- **Glyphs** (`src/study/glyph.ts`): every card side is one centred 288×128 picture: a pictogram (the grape sprites, a wine glass filled by style, the Atlas globe zoomed onto the lit country, a map pin, a nose, an eye, a book, or the real catalog bottle) with one big word. On G2 it sits at the lens centre (x 144, y 30) with centred text below (spaces, measured with `src/glass-px.ts` from PolyGot). The phone shows the same 16-level picture, pixel-crisp, on a dark "lens" card.
- **Runs** (`src/study/practice.ts`): XP 10 per right answer (+2 per combo step from x3, up to +10), 2 per miss. A combo runs within one stage or boss and breaks after 15 minutes. Stars: 60% ★, 80% ★★, 100% ★★★ (latest answer per card). A stage unlocks with ★ on the previous one; the boss (8 cards from the whole season, flash cards asked as picks, three hearts) unlocks with ★ on every stage.
- **Storage**: each answer is one recognition event (`scheduler_version: practice-v1`) in the same account-isolated log as reviews, synced through `/api/study` like any review. Boss answers are filed under `p.<season>.boss.…` and a run ends with a `p.<season>.boss` marker (cleared or not). XP, combos, stars, unlocks and the day streak are replays of the log, so they agree across devices. Practice never schedules a review card.
- **Glasses**: Study map (Daily review + four seasons) › season (☆☆☆ per stage, □ locked, ◆ boss) › cards › stage summary (next stage / play again / season map). Tap acts; double tap goes back a level; answers already given stay saved.

## Daily review

## Content

| File | What it is |
|---|---|
| `src/data/catalog-identity.json` | Immutable canonical wine IDs (`wl_…`), matched by `Type\|Country\|Name`, plus the frozen legacy map `w0…w214`. `npm run check:ids` fails if a catalog change leaves a wine without an ID; `--write` adds IDs for new wines and never changes existing ones. |
| `src/data/references.json` | Sources, releases and approved claims imported verbatim from `wine-reference-register.json` (`scripts/import-reference-register.mjs`). Only `approved-pilot` claims are imported. Unknown stays `null`. Open questions (Pahlmeyer label, Brochard release) are kept as unresolved items. |
| `src/data/study-cards.json` | Five hand-written recall cards for Cain NV14, IXSIR Grande Réserve Rosé 2023 and Pater Patriae. Each cites claim IDs. |

A card is studied only if every cited claim is approved, belongs to the card's wine (and release, when scoped), and its source is available. Recognition options must contain the answer exactly once and no distractor may match the answer key (`src/study/content.ts`). Tasting notes are never scored. The legacy multiple-choice quiz (tasting-note wording over unverified catalog data) was removed. Its history stays visible as "earlier quiz results", not counted as recall.

## Engine

- `src/study/scheduler.ts`: `wl-steps-v1`, which is pure and deterministic.
  - **Steps:** 1 / 3 / 7 / 14 / 30 / 60 days, due at the start of a local day.
  - **Ratings on a due review:** Good +1 step, Easy +2, Hard keeps the step, Again lapses to tomorrow.
  - **Review ahead:** never inflates the step or mastery.
  - **Recognition (multiple choice):** counted separately and never schedules.
  - **Stable:** at least 2 correct delayed recalls on different days, the latest at least 7 days after first learning (pilot heuristic).
- `src/study/store.ts`: an append-only review log per account (`guest` when signed out). Card state is a replay of the log ordered by `(occurred_at, event_id)`.
  - **Idempotency:** one `event_id` is stored once.
  - **Writes:** serialized, with failures surfaced (`saveStatus`) and retried under the same IDs.
  - **Account isolation:** events owned by another account are never loaded or merged. Signing out removes that account's log from the device; the account dialog warns if reviews are not yet synced.
- `src/study/session.ts`: the single session shared by both adapters.
  - **One review per presentation:** attempt → reveal → one rating.
  - **Again:** re-inserts the card after three other cards when that many remain.
  - **Daily limits:** 5 new and 15 due cards per day.
  - **Quick session:** 3 cards.
- `src/study/sync.ts`: posts unsynced events to `POST /api/study/reviews` and merges the account's events from `GET`. Retries resend the same event IDs.
- **Adapters:**
  - `src/study/phone.ts`: typed or unspoken attempt, reveal, source link, rating buttons that show the next due date, flagging.
  - `src/study/glasses.ts`: tap reveals, a four-row rating list shows next due dates, double tap pauses. The bottle is hidden when the label would give the answer away.

Server side (moved to this repo's `/api/study` on 7 Oct 2026; see docs/winelens/AUDIT-2026-10-07.md. Original sommni-api contract, for reference):

- `api/study/reviews.js`
- `db/migrations/20260930090000_winelens_study_reviews.sql`: RLS, unique `(user_id, event_id)`, no update/delete.
- Tests: `npm run test:study` there.

## Legacy data

`migrateLegacyWineIds()` (`src/sync.ts`) runs once per storage backend:

1. Copies raw values to `sommni_legacy_backup_v1`.
2. Converts `w…` IDs in favorites, stock, pairings, courses, quiz stats/history and the learned vault through the frozen map.
3. Keeps IDs it cannot resolve unchanged and lists them.

Unknown IDs never fall back to another wine (the old `w0` fallback is gone). Bottle images are still named by legacy ID and resolved with `assetIdFor`.

## Checks

```sh
npm run test:study   # engine, G2 adapter (mock bridge), phone flow in the real app with a fixed clock
npm run check:ids
```

**Simulator 0.9.5 (checked 8 Oct 2026):** Home › Study › Daily review › prompt › tap › reveal › Good › summary works, and full stages of Grapes & styles (1–2), Regions & countries (1) and Producers & stories (1) play through: meet, flash front/back, pick, spot, answered and stage-clear screens, with globe, grape, glass, book and bottle glyphs. Even Hub storage survives a web view reload but not a simulator restart, so persistence across app restarts still has to be checked in the Even app on a real phone.
