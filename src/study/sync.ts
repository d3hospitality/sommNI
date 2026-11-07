// ═══════════════════════════════════════════════════════════════════
// sommNI — study review sync with the account API (PRD S-08)
//
// POST /api/study/reviews  { events: ReviewEvent[] } → { accepted: string[], duplicates: string[] }
// GET  /api/study/reviews                            → { events: ReviewEvent[] }
//
// The server takes ownership from the verified token and stores each
// (user, event_id) once. Retries resend the same event IDs, so an offline
// replay or a double submit can never count twice. Events are only sent for
// the signed-in owner of the local log.
// ═══════════════════════════════════════════════════════════════════
import { account } from '../account-client';
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
  const session=(await account.auth.getSession()).data.session;
  if(!session||session.access_token!==token)throw Error('Account changed.');
  const owner=session.user.id;
  if(method==='POST'){
    const events=(body as {events:ReviewEvent[]}).events;
    if(events.some(e=>e.user_id!==owner))throw Error('Review owner mismatch.');
    const {error}=await account.from('study_review_events').upsert(events.map(e=>({...e,user_id:owner,scheduler_version:String(e.scheduler_version)})),{onConflict:'user_id,event_id',ignoreDuplicates:true});
    if(error)throw error;return {accepted:events.map(e=>e.event_id)};
  }
  const {data,error}=await account.from('study_review_events').select('*').eq('user_id',owner).order('occurred_at');
  if(error)throw error;return {events:(data||[]).map(e=>({...e,scheduler_version:e.scheduler_version}))};
}

// Try again shortly after new reviews and whenever the connection returns.
onStudyChange(() => {
  if (!auth || !unsyncedEvents().length) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncStudy(); }, 1500);
});
if (typeof window !== 'undefined') window.addEventListener('online', () => { void syncStudy(); });
