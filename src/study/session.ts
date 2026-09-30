// ═══════════════════════════════════════════════════════════════════
// wineLENS — one study session shared by the phone and G2 (PRD S-01, S-02, S-07)
//
// Both adapters render the same session object, so they always show the same
// card version, the same result and the same next due date. A presentation is:
//   attempt → reveal → one rating  (recall)   or   one option  (recognition)
// and produces exactly one review event, whichever device finishes it.
// ═══════════════════════════════════════════════════════════════════
import { STUDY_CARDS, getCard, answerMatches, type StudyCard } from './content';
import { isDue, previewRatings, dueLabel, statusOf, dayKey, type Rating, type ReviewMode } from './scheduler';
import { recordReview, stateFor, isFlagged, eventsFor, allStates } from './store';

export const DEFAULT_LIMITS = { newPerDay: 5, duePerDay: 15 };
const RETRY_GAP = 3; // an "Again" card returns after at least three other cards

export interface Presentation {
  card: StudyCard;
  eventId: string;          // created when the card is shown; retries reuse it
  shownAt: number;
  mode: ReviewMode;
  revealed: boolean;
  typed: string;
  typedMatches: boolean | null;
  chosen: string | null;    // recognition option
  done: boolean;            // rated / answered — no second review for this presentation
  retry: boolean;           // same-session retry after "Again"
  saveError: string;
}
export interface SessionSummary { stopped: boolean; reviewed: number; again: number; nextDue: string | null; takeaway: StudyCard | null; saveErrors: number }

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const tz = () => -new Date().getTimezoneOffset();

/** Cards to study now: overdue first, then recent lapses, then up to `newPerDay` new cards. */
export function buildQueue(nowIso = new Date().toISOString(), limits = DEFAULT_LIMITS, tzOffsetMin = tz()): StudyCard[] {
  const today = dayKey(nowIso, tzOffsetMin);
  const rows = STUDY_CARDS.filter(c => !isFlagged(c.id, c.version)).map(card => ({ card, state: stateFor(card.id, card.version) }));
  const due = rows.filter(r => r.state.step >= 0 && isDue(r.state, nowIso))
    .sort((a, b) => (statusOf(b.state) === 'needs-review' ? 1 : 0) - (statusOf(a.state) === 'needs-review' ? 1 : 0) || (a.state.due_at! < b.state.due_at! ? -1 : 1))
    .slice(0, limits.duePerDay).map(r => r.card);
  // New cards introduced earlier today count against today's allowance.
  const introducedToday = rows.filter(r => r.state.first_learned_day === today).length;
  const fresh = rows.filter(r => r.state.step < 0).slice(0, Math.max(0, limits.newPerDay - introducedToday)).map(r => r.card);
  return [...due, ...fresh];
}

/** When the next card becomes due, if nothing is due now. */
export function nextDueAt(): string | null {
  const dates = allStates().filter(s => !s.flagged && s.state.due_at).map(s => s.state.due_at!).sort();
  return dates[0] ?? null;
}

type Listener = () => void;
export class StudySession {
  queue: StudyCard[];
  index = 0;
  current: Presentation | null = null;
  reviewed = 0;
  again = 0;
  saveErrors = 0;
  stopped = false;
  private lastMissed: StudyCard | null = null;
  private busy = false;
  private listeners = new Set<Listener>();

  constructor(queue: StudyCard[], private preferredMode: ReviewMode = 'recall') {
    this.queue = [...queue];
    this.present();
  }
  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }
  get finished(): boolean { return this.index >= this.queue.length; }
  get total(): number { return this.queue.length; }

  private present(retry = false) {
    const card = this.queue[this.index];
    this.current = card ? {
      card, eventId: uuid(), shownAt: Date.now(), mode: card.options && this.preferredMode === 'recognition' ? 'recognition' : 'recall',
      revealed: false, typed: '', typedMatches: null, chosen: null, done: false, retry, saveError: '',
    } : null;
  }
  /** Switch the current, unanswered card between recall and multiple choice (phone). */
  setMode(mode: ReviewMode) {
    const p = this.current;
    if (!p || p.done || p.revealed || (mode === 'recognition' && !p.card.options)) return;
    this.preferredMode = mode; p.mode = mode; this.emit();
  }
  /** Reveal after an attempt. Typing is optional; the attempt is the pause before revealing. */
  reveal(typed = '') {
    const p = this.current;
    if (!p || p.revealed || p.mode !== 'recall') return;
    p.typed = typed.trim();
    p.typedMatches = p.typed ? answerMatches(p.card, p.typed) : null;
    p.revealed = true;
    this.emit();
  }
  /** Next-due label for each rating, from the card's real state. */
  ratingPreview(): Record<Rating, string> | null {
    const p = this.current;
    if (!p) return null;
    const now = new Date().toISOString();
    const preview = previewRatings(stateFor(p.card.id, p.card.version), now, tz());
    return Object.fromEntries(Object.entries(preview).map(([r, due]) => [r, dueLabel(due, now, tz())])) as Record<Rating, string>;
  }
  /** Save the self-rating for a revealed recall card. Exactly one event per presentation. */
  async rate(rating: Rating, device: 'phone' | 'g2'): Promise<void> {
    const p = this.current;
    if (!p || p.done || !p.revealed || p.mode !== 'recall' || this.busy) return;
    await this.save(p, device, { mode: 'recall', rating, correct: p.typedMatches });
    if (rating === 'again') {
      this.again++;
      this.lastMissed = p.card;
      // Same-session retry after ≥ 3 other cards, if that many remain. The next-day review is scheduled either way.
      if (this.queue.length - this.index - 1 >= RETRY_GAP) this.queue.splice(this.index + 1 + RETRY_GAP, 0, p.card);
    }
  }
  /** Answer a recognition (multiple-choice) card. Recorded as recognition; never schedules. */
  async choose(option: string, device: 'phone' | 'g2'): Promise<void> {
    const p = this.current;
    if (!p || p.done || p.mode !== 'recognition' || this.busy) return;
    p.chosen = option;
    p.revealed = true;
    const correct = option === p.card.answer;
    if (!correct) this.lastMissed = p.card;
    await this.save(p, device, { mode: 'recognition', rating: null, correct });
  }
  private async save(p: Presentation, device: 'phone' | 'g2', fields: { mode: ReviewMode; rating: Rating | null; correct: boolean | null }) {
    this.busy = true;
    try {
      const result = await recordReview({ event_id: p.eventId, card_id: p.card.id, device, duration_ms: Date.now() - p.shownAt, ...fields });
      p.done = true;
      if (!result.duplicate) this.reviewed++;
      if (!result.saved) { this.saveErrors++; p.saveError = 'Saved in this session; storage is retrying.'; }
    } catch (error) {
      p.saveError = error instanceof Error ? error.message : 'Could not save this review.';
    } finally { this.busy = false; this.emit(); }
  }
  /** Move on after a rated/answered card. */
  next() {
    if (!this.current?.done) return;
    this.index++;
    const retry = this.index > 0 && this.queue.slice(0, this.index).some(c => c.id === this.queue[this.index]?.id);
    this.present(retry);
    this.emit();
  }
  /** Stop early; completed reviews are already saved. */
  stop() { this.stopped = this.index < this.queue.length; this.index = this.queue.length; this.current = null; this.emit(); }
  summary(): SessionSummary {
    return { stopped: this.stopped, reviewed: this.reviewed, again: this.again, nextDue: nextDueAt(), takeaway: this.lastMissed ?? this.queue[0] ?? null, saveErrors: this.saveErrors };
  }
}

// ── The single active session, shared by the phone UI and the G2 adapter ──
let active: StudySession | null = null;
const activeListeners = new Set<Listener>();
export function activeSession(): StudySession | null { return active; }
/** Start today's session. `maxCards` shortens it (quick session); the order is unchanged. */
export function startSession(preferredMode: ReviewMode = 'recall', nowIso?: string, maxCards = Infinity): StudySession {
  active = new StudySession(buildQueue(nowIso).slice(0, maxCards), preferredMode);
  active.on(() => { for (const fn of activeListeners) fn(); });
  for (const fn of activeListeners) fn();
  return active;
}
export function endSession() { active = null; for (const fn of activeListeners) fn(); }
export function onSessionChange(fn: Listener): () => void { activeListeners.add(fn); return () => activeListeners.delete(fn); }

/** Recent history for a card, for "why is this due?" explanations. */
export function cardHistory(cardId: string) { return eventsFor(cardId); }
export { getCard };
