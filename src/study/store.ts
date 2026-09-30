// ═══════════════════════════════════════════════════════════════════
// wineLENS — durable, account-isolated review log (PRD S-08, S-09, G-05, I-04)
//
// The log of immutable review events is the source of truth. Card state is a
// deterministic replay of that log (scheduler.ts), so replays, merges from the
// server and duplicate submissions converge on the same state.
//
//  - One log per account ("guest" when signed out). Events carry their owner;
//    a log never accepts, merges or syncs another owner's events.
//  - Every write is serialized and awaited. A failed write is reported as
//    `error` and retried with the same event IDs; nothing is silently dropped.
//  - Sync sends only unacknowledged events of the signed-in owner; the server
//    answers with the IDs it holds, duplicates included, so retries are safe.
// ═══════════════════════════════════════════════════════════════════
import { applyReview, initialState, statusOf, SCHEDULER_VERSION, type CardState, type Rating, type ReviewMode } from './scheduler';
import { getCard, STUDY_CARDS } from './content';

export interface ReviewEvent {
  event_id: string;
  user_id: string;            // account ID, or "guest"
  card_id: string;
  card_version: number;
  mode: ReviewMode;
  rating: Rating | null;      // recall: self-rating after reveal
  correct: boolean | null;    // recognition: option result; recall: typed-answer match, null if not typed
  occurred_at: string;
  tz_offset_min: number;
  duration_ms: number;
  device: 'phone' | 'g2';
  scheduler_version: string;
}
interface StudyLog {
  format: 1;
  owner: string;
  events: ReviewEvent[];
  acked: string[];            // event IDs the server confirmed
  flagged: { card_id: string; card_version: number; at: string }[];
}
export interface KeyValueStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
export type SaveStatus = { state: 'idle' | 'saving' | 'saved' | 'error'; pending: number; message: string };

const KEY_PREFIX = 'winelens_study_v1:';
export const GUEST = 'guest';

// ── Storage backends ──
export function browserStore(): KeyValueStore {
  return {
    async get(k) { return window.localStorage.getItem(k); },
    async set(k, v) { window.localStorage.setItem(k, v); },
    async remove(k) { window.localStorage.removeItem(k); },
  };
}
type BridgeLike = { getLocalStorage(k: string): Promise<string>; setLocalStorage(k: string, v: string): Promise<boolean> };
export function bridgeStore(bridge: BridgeLike): KeyValueStore {
  return {
    async get(k) { return (await bridge.getLocalStorage(k)) || null; },
    async set(k, v) { if (!(await bridge.setLocalStorage(k, v))) throw new Error('Even Hub storage refused the write'); },
    async remove(k) { if (!(await bridge.setLocalStorage(k, ''))) throw new Error('Even Hub storage refused removal'); },
  };
}

let store: KeyValueStore = browserStore();
let log: StudyLog = emptyLog(''); // nothing loaded until useAccount() runs
let loaded: Promise<void> = Promise.resolve();
let writeChain: Promise<void> = Promise.resolve();
let status: SaveStatus = { state: 'idle', pending: 0, message: '' };
const listeners = new Set<() => void>();

function emptyLog(owner: string): StudyLog { return { format: 1, owner, events: [], acked: [], flagged: [] }; }
function notify() { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } }
export function onStudyChange(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function saveStatus(): SaveStatus { return { ...status, pending: unsyncedEvents().length }; }
export function currentOwner(): string { return log.owner; }

/** Choose where logs live (Even Hub storage inside the host, localStorage in a browser). */
export function useStorage(next: KeyValueStore): Promise<void> {
  if (next === store) return loaded;
  store = next;
  const owner = log.owner || GUEST;
  log = emptyLog('');
  return useAccount(owner === GUEST ? null : owner);
}

/** Switch account. The previous owner's events leave memory before the next log loads. */
export function useAccount(userId: string | null): Promise<void> {
  const owner = userId || GUEST;
  if (owner === log.owner) return loaded;
  log = emptyLog(owner);
  notify();
  loaded = (async () => {
    try {
      const raw = await store.get(KEY_PREFIX + owner);
      const parsed = raw ? JSON.parse(raw) as StudyLog : null;
      if (log.owner !== owner) return; // switched again while loading
      // Never adopt events that belong to someone else, even if a stored log was tampered with or mis-keyed.
      if (parsed && parsed.format === 1 && parsed.owner === owner) {
        log = { ...parsed, events: parsed.events.filter(e => e.user_id === owner) };
      }
      status = { state: 'idle', pending: 0, message: '' };
    } catch (error) {
      status = { state: 'error', pending: 0, message: 'Could not read saved study progress.' };
      console.error('[study] load failed', error);
    }
    notify();
  })();
  return loaded;
}

/** Remove an account's local study data (sign-out / account switch). */
export async function forgetAccount(userId: string): Promise<void> {
  if (log.owner === userId) { log = emptyLog(GUEST); notify(); }
  await enqueueWrite(() => store.remove(KEY_PREFIX + userId));
}

function persist(): Promise<void> {
  const snapshot = JSON.stringify(log);
  const key = KEY_PREFIX + log.owner;
  return enqueueWrite(() => store.set(key, snapshot));
}
function enqueueWrite(task: () => Promise<void>): Promise<void> {
  status = { ...status, state: 'saving' }; notify();
  const run = writeChain.catch(() => {}).then(task);
  writeChain = run.then(() => { status = { state: 'saved', pending: 0, message: '' }; notify(); },
    (error) => { status = { state: 'error', pending: 0, message: 'Not saved on this device yet. It will retry.' }; console.error('[study] write failed', error); notify(); throw error; });
  return writeChain;
}
/** Retry the last failed write (same events, same IDs). */
export function retrySave(): Promise<void> { return persist(); }
/** Lifecycle flush: finish pending device writes; retry a reported save failure. */
export async function flushStudyWrites(): Promise<void> {
  await writeChain.catch(() => {});
  if (status.state === 'error' && log.owner) await persist();
}

// ── Reviews ──
export interface ReviewInput {
  event_id: string; card_id: string; mode: ReviewMode; rating: Rating | null; correct: boolean | null;
  occurred_at?: string; duration_ms?: number; device: 'phone' | 'g2';
}
/**
 * Record one review. The same event_id is accepted once: a double tap, a retried
 * save or an offline replay returns the original event and changes nothing.
 */
export async function recordReview(input: ReviewInput): Promise<{ event: ReviewEvent; duplicate: boolean; saved: boolean }> {
  await loaded;
  const existing = log.events.find(e => e.event_id === input.event_id);
  if (existing) return { event: existing, duplicate: true, saved: status.state !== 'error' };
  const card = getCard(input.card_id);
  if (!card) throw new Error('This card is not available for review.');
  if (isFlagged(card.id, card.version)) throw new Error('This card is paused for review.');
  if (input.mode === 'recall' && !input.rating) throw new Error('Rate your recall after revealing the answer.');
  const occurred = input.occurred_at ?? new Date().toISOString();
  const event: ReviewEvent = {
    event_id: input.event_id, user_id: log.owner, card_id: card.id, card_version: card.version,
    mode: input.mode, rating: input.mode === 'recall' ? input.rating : null, correct: input.correct,
    occurred_at: occurred, tz_offset_min: -new Date(occurred).getTimezoneOffset(),
    duration_ms: Math.max(0, Math.round(input.duration_ms ?? 0)), device: input.device, scheduler_version: SCHEDULER_VERSION,
  };
  log.events.push(event);
  notify();
  let saved = true;
  try { await persist(); } catch { saved = false; }
  return { event, duplicate: false, saved };
}

/** Merge events from another copy of the same account's log (e.g. the server). */
export async function mergeEvents(events: ReviewEvent[]): Promise<number> {
  await loaded;
  const known = new Set(log.events.map(e => e.event_id));
  const fresh = events.filter(e => e.user_id === log.owner && !known.has(e.event_id));
  if (!fresh.length) return 0;
  log.events.push(...fresh);
  for (const e of fresh) if (!log.acked.includes(e.event_id)) log.acked.push(e.event_id);
  notify();
  await persist();
  return fresh.length;
}

export function unsyncedEvents(): ReviewEvent[] {
  if (log.owner === GUEST) return [];
  const acked = new Set(log.acked);
  return log.events.filter(e => !acked.has(e.event_id));
}
export async function markSynced(ids: string[]): Promise<void> {
  const set = new Set(log.acked);
  for (const id of ids) set.add(id);
  log.acked = [...set];
  notify();
  await persist();
}

// ── Flags (S-05) ──
export function isFlagged(cardId: string, version: number): boolean {
  return log.flagged.some(f => f.card_id === cardId && f.card_version === version);
}
export async function flagCard(cardId: string): Promise<void> {
  const card = getCard(cardId);
  if (!card || isFlagged(card.id, card.version)) return;
  log.flagged.push({ card_id: card.id, card_version: card.version, at: new Date().toISOString() });
  notify();
  await persist();
}

// ── Derived state ──
const byOrder = (a: ReviewEvent, b: ReviewEvent) => a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;

/** Replay the log for one card version. Deterministic: order is (occurred_at, event_id). */
export function stateFor(cardId: string, version: number, events: ReviewEvent[] = log.events): CardState {
  let state = initialState(cardId, version);
  for (const e of events.filter(e => e.card_id === cardId && e.card_version === version).sort(byOrder)) {
    state = applyReview(state, { mode: e.mode, rating: e.rating, correct: e.correct, occurred_at: e.occurred_at, tz_offset_min: e.tz_offset_min });
  }
  return state;
}
export function allStates(): { cardId: string; state: CardState; status: ReturnType<typeof statusOf>; flagged: boolean }[] {
  return STUDY_CARDS.map(card => {
    const state = stateFor(card.id, card.version);
    return { cardId: card.id, state, status: statusOf(state), flagged: isFlagged(card.id, card.version) };
  });
}
export function eventsFor(cardId: string): ReviewEvent[] { return log.events.filter(e => e.card_id === cardId).sort(byOrder); }
export function eventCount(): number { return log.events.length; }
