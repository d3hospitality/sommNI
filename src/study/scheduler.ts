// ═══════════════════════════════════════════════════════════════════
// wineLENS study scheduler — wl-steps-v1 (PRD S-06, S-07, S-09)
//
// Pure and deterministic: the same ordered event log always yields the same
// state, on the phone, on G2 and (later) on the server.
//
//   Steps: 1, 3, 7, 14, 30, 60 days. Due dates fall at the start of a local day.
//   New card     Again/Hard/Good → step 0 (tomorrow) · Easy → step 1 (3 days)
//   Due review   Good → +1 step · Easy → +2 steps · Hard → same step from today
//                Again → lapse: step 0 (tomorrow), successes cleared
//   Not yet due  (review ahead / same-session retry) Hard/Good/Easy change nothing;
//                Again still counts as a lapse — forgetting is informative.
//   Recognition  (multiple choice) is counted separately and never schedules.
//   Stable       ≥ 2 correct delayed recall reviews on different days, the latest
//                ≥ 7 days after first learning, no lapse since.   (pilot heuristic)
// ═══════════════════════════════════════════════════════════════════

export const SCHEDULER_VERSION = 'wl-steps-v1';
export const STEPS_DAYS = [1, 3, 7, 14, 30, 60] as const;
const DAY_MS = 86_400_000;

export type Rating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewMode = 'recall' | 'recognition';
export type CardStatus = 'new' | 'learning' | 'needs-review' | 'stable';

export interface CardState {
  card_id: string;
  card_version: number;
  step: number;               // -1 = never recalled
  due_at: string | null;      // ISO; null while new
  lapses: number;
  recall_reviews: number;
  recognition_reviews: number;
  recognition_correct: number;
  success_days: string[];     // local day keys of correct delayed recall reviews since the last lapse
  first_learned_at: string | null;
  first_learned_day: string | null; // local day key of the first recall
  last_reviewed_at: string | null;
  last_rating: Rating | null;
}

/** Input the scheduler needs from a review event. */
export interface ScheduleInput {
  mode: ReviewMode;
  rating: Rating | null;      // recall only
  correct: boolean | null;    // recognition only
  occurred_at: string;        // ISO
  tz_offset_min: number;      // minutes east of UTC at the time of review (e.g. +60 for BST)
}

export function initialState(cardId: string, version: number): CardState {
  return { card_id: cardId, card_version: version, step: -1, due_at: null, lapses: 0, recall_reviews: 0,
    recognition_reviews: 0, recognition_correct: 0, success_days: [], first_learned_at: null, first_learned_day: null, last_reviewed_at: null, last_rating: null };
}

/** Local calendar day ("2026-09-29") of an instant, for a fixed UTC offset. */
export function dayKey(iso: string, tzOffsetMin: number): string {
  return new Date(Date.parse(iso) + tzOffsetMin * 60_000).toISOString().slice(0, 10);
}
/** Start of the local day `days` after the day containing `iso`, as a UTC ISO instant. */
export function localDayStart(iso: string, tzOffsetMin: number, days: number): string {
  const local = Date.parse(dayKey(iso, tzOffsetMin) + 'T00:00:00.000Z') + days * DAY_MS;
  return new Date(local - tzOffsetMin * 60_000).toISOString();
}

export function isDue(state: CardState, nowIso: string): boolean {
  return state.step < 0 || (state.due_at !== null && Date.parse(state.due_at) <= Date.parse(nowIso));
}

export function statusOf(state: CardState): CardStatus {
  if (state.step < 0) return 'new';
  if (state.last_rating === 'again') return 'needs-review';
  if (state.first_learned_day && state.success_days.length >= 2) {
    const latest = state.success_days[state.success_days.length - 1];
    if ((Date.parse(latest) - Date.parse(state.first_learned_day)) / DAY_MS >= 7) return 'stable';
  }
  return 'learning';
}

/** Apply one review. Returns a new state; never mutates the input. */
export function applyReview(prev: CardState, input: ScheduleInput): CardState {
  const s: CardState = { ...prev, success_days: [...prev.success_days] };
  s.last_reviewed_at = input.occurred_at;
  if (input.mode === 'recognition') {
    s.recognition_reviews++;
    if (input.correct) s.recognition_correct++;
    return s; // recognition is evidence of familiarity, not delayed recall: no scheduling change
  }
  const rating = input.rating;
  if (!rating) return s;
  const now = input.occurred_at, tz = input.tz_offset_min;
  const wasNew = s.step < 0;
  const due = isDue(prev, now);
  s.recall_reviews++;
  s.last_rating = rating;
  if (wasNew) {
    s.first_learned_at = now;
    s.first_learned_day = dayKey(now, tz);
    s.step = rating === 'easy' ? 1 : 0;
    s.due_at = localDayStart(now, tz, STEPS_DAYS[s.step]);
    return s;
  }
  if (rating === 'again') {
    if (s.step > 0 || s.success_days.length) s.lapses++;
    s.step = 0;
    s.success_days = [];
    s.due_at = localDayStart(now, tz, 1);
    return s;
  }
  if (!due) return s; // review ahead: no interval or mastery inflation
  const max = STEPS_DAYS.length - 1;
  if (rating === 'good') s.step = Math.min(max, s.step + 1);
  if (rating === 'easy') s.step = Math.min(max, s.step + 2);
  // 'hard' keeps the current step; overdue cards are rescheduled from today, not from the old due date.
  s.due_at = localDayStart(now, tz, STEPS_DAYS[s.step]);
  if (rating === 'good' || rating === 'easy') {
    const day = dayKey(now, tz);
    if (!s.success_days.includes(day)) s.success_days.push(day);
  }
  return s;
}

/** What each rating would schedule right now — used to label the rating buttons. */
export function previewRatings(state: CardState, nowIso: string, tzOffsetMin: number): Record<Rating, string | null> {
  const out = {} as Record<Rating, string | null>;
  for (const r of ['again', 'hard', 'good', 'easy'] as Rating[]) {
    out[r] = applyReview(state, { mode: 'recall', rating: r, correct: null, occurred_at: nowIso, tz_offset_min: tzOffsetMin }).due_at;
  }
  return out;
}

/** Human label for a due instant relative to now: "today", "tomorrow", "in 3 days". */
export function dueLabel(dueIso: string | null, nowIso: string, tzOffsetMin: number): string {
  if (!dueIso) return 'new';
  const days = Math.round((Date.parse(dayKey(dueIso, tzOffsetMin)) - Date.parse(dayKey(nowIso, tzOffsetMin))) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
