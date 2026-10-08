// ═══════════════════════════════════════════════════════════════════
// wineLENS — study review sync with the account API (PRD S-08)
//
// POST /api/study {action:'push', events}  → { accepted: string[], duplicates: string[] }
// POST /api/study {action:'pull'}          → { events: ReviewEvent[] }
// (the wineLENS account API — the same backend as Winebrary and billing)
//
// The server takes ownership from the verified token and stores each
// (user, event_id) once. Retries resend the same event IDs, so an offline
// replay or a double submit can never count twice. Events are only sent for
// the signed-in owner of the local log.
// ═══════════════════════════════════════════════════════════════════
import { accountRequest } from '../billing';
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
    // The server answers at most 1000 events per pull, oldest first: page by time (duplicates merge once).
    let since: string | undefined;
    for (let page = 0; page < 20; page++) {
      const remote = await call('GET', token, undefined, since);
      if (auth !== who || currentOwner() !== who.userId) return state;
      const events = (remote.events ?? []) as ReviewEvent[];
      await mergeEvents(events);
      if (events.length < 1000 || events[events.length - 1].occurred_at === since) break;
      since = events[events.length - 1].occurred_at;
    }
    return (state = unsyncedEvents().length ? 'error' : 'synced');
  } catch (error) {
    const status = (error as { status?: number }).status;
    state = status === 404 ? 'unavailable' : status ? 'error' : 'offline';
    return state;
  }
}
async function call(method: 'GET' | 'POST', _token: string, body?: { events: unknown[] }, since?: string): Promise<{ accepted?: string[]; duplicates?: string[]; events?: unknown[] }> {
  try { return await accountRequest('study', method === 'POST' ? { action: 'push', events: body!.events } : { action: 'pull', ...(since ? { since } : {}) }); }
  catch (error) { throw Object.assign(new Error('Study sync failed'), { status: (error as { status?: number }).status }); }
}

// Try again shortly after new reviews and whenever the connection returns.
onStudyChange(() => {
  if (!auth || !unsyncedEvents().length) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncStudy(); }, 1500);
});
if (typeof window !== 'undefined') window.addEventListener('online', () => { void syncStudy(); });
