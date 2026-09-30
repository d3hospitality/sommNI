// ═══════════════════════════════════════════════════════════════════
// wineLENS — study review sync with the account API (PRD S-08)
//
// POST /api/study/reviews  { events: ReviewEvent[] } → { accepted: string[], duplicates: string[] }
// GET  /api/study/reviews                            → { events: ReviewEvent[] }
//
// The server takes ownership from the verified token and stores each
// (user, event_id) once. Retries resend the same event IDs, so an offline
// replay or a double submit can never count twice. Events are only sent for
// the signed-in owner of the local log.
// ═══════════════════════════════════════════════════════════════════
import { API_URL } from '../account-config';
import { currentOwner, unsyncedEvents, markSynced, mergeEvents, onStudyChange, type ReviewEvent } from './store';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'unavailable' | 'error' | 'signed-out';
interface StudyAuth { userId: string; token: () => Promise<string | null> }

let auth: StudyAuth | null = null;
let state: SyncState = 'signed-out';
let running: Promise<SyncState> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const BATCH = 200;

export function studySyncState(): SyncState { return state; }
export function setStudyAuth(next: StudyAuth | null) { auth = next; state = next ? 'idle' : 'signed-out'; }

/** Send pending reviews, then merge the account's reviews from other devices. */
export function syncStudy(): Promise<SyncState> {
  if (running) return running;
  running = run().finally(() => { running = null; });
  return running;
}
async function run(): Promise<SyncState> {
  const who = auth;
  if (!who || currentOwner() !== who.userId) return (state = 'signed-out');
  const token = await who.token();
  if (!token) return (state = 'signed-out');
  state = 'syncing';
  try {
    const pending = unsyncedEvents();
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      const res = await call('POST', token, { events: batch });
      if (auth !== who) return state; // account changed mid-flight: do not touch the new log
      await markSynced([...(res.accepted ?? []), ...(res.duplicates ?? [])]);
    }
    const remote = await call('GET', token);
    if (auth !== who || currentOwner() !== who.userId) return state;
    await mergeEvents((remote.events ?? []) as ReviewEvent[]);
    return (state = unsyncedEvents().length ? 'error' : 'synced');
  } catch (error) {
    const status = (error as { status?: number }).status;
    state = status === 404 ? 'unavailable' : status ? 'error' : 'offline';
    return state;
  }
}
async function call(method: 'GET' | 'POST', token: string, body?: unknown): Promise<{ accepted?: string[]; duplicates?: string[]; events?: unknown[] }> {
  const response = await fetch(`${API_URL}/api/study/reviews`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw Object.assign(new Error(`Study sync failed (${response.status})`), { status: response.status });
  return response.json();
}

// Try again shortly after new reviews and whenever the connection returns.
onStudyChange(() => {
  if (!auth || !unsyncedEvents().length) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncStudy(); }, 1500);
});
if (typeof window !== 'undefined') window.addEventListener('online', () => { void syncStudy(); });
