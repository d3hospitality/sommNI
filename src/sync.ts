// ═══════════════════════════════════════════════════════════════════
// wineLENS — local companion data (favorites, stock, pairings, courses)
//
// Storage: Even Hub storage inside the host app, browser localStorage elsewhere
// (the study log uses the same backend, see study/store.ts).
//
// Every read-modify-write for a key runs through one serialized queue, so two
// quick "+1 bottle" taps save 2, not 1. A failed write is reported (the
// `winelens-save-error` event and a false return), never swallowed.
//
// Wine references are canonical IDs (identity.ts). Data written before
// canonical IDs used positional w0…w214; `migrateLegacyWineIds` converts it once,
// losslessly, keeping a raw backup and any ID it cannot resolve.
// Note: the key names were shared with the separate Android app's wineStore.js.
// ═══════════════════════════════════════════════════════════════════
import { resolveWineId, LEGACY_ID } from './identity';
import { browserStore, bridgeStore, type KeyValueStore } from './study/store';

export const STORAGE_KEYS = {
  INVENTORY:     'sommni_inventory',
  PAIRINGS:      'sommni_pairings',
  FAVORITES:     'sommni_favorites',
  QUIZ_STATS:    'sommni_quiz_stats',
  QUIZ_HISTORY:  'sommni_quiz_history',
  LEARNED_VAULT: 'sommni_learned_vault',
  COURSE_STATE:  'sommni_course_state',
  CATALOG_VIEW:  'winelens_catalog_view',
} as const;
const MIGRATION_KEY = 'winelens_id_migration_v1';
const BACKUP_KEY = 'sommni_legacy_backup_v1';

let store: KeyValueStore = browserStore();
const chains = new Map<string, Promise<unknown>>();
export async function flushCompanionWrites(): Promise<void> { await Promise.allSettled([...chains.values()]); }

type BridgeLike = Parameters<typeof bridgeStore>[0];
/** True inside the Even Hub host (the SDK bridge only answers there). */
export function inEvenHubHost(): boolean {
  return typeof (window as unknown as { flutter_inappwebview?: { callHandler?: unknown } }).flutter_inappwebview?.callHandler === 'function';
}
/** Pick the storage backend. Called once the SDK bridge exists. */
export function initSync(bridge: BridgeLike | null): KeyValueStore {
  store = bridge && inEvenHubHost() ? bridgeStore(bridge) : browserStore();
  return store;
}
export function companionStore(): KeyValueStore { return store; }

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch (error) {
    console.error(`[sync] read ${key} failed`, error);
    return fallback;
  }
}
function reportSaveError(key: string, error: unknown) {
  console.error(`[sync] write ${key} failed`, error);
  window.dispatchEvent(new CustomEvent('winelens-save-error', { detail: { key } }));
}
/** Serialized read-modify-write for one key. Resolves true when the write landed. */
function update<T>(key: string, fallback: T, change: (value: T) => T | void): Promise<boolean> {
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const current = await loadJSON(key, fallback);
    const next = change(current);
    try { await store.set(key, JSON.stringify(next === undefined ? current : next)); return true; }
    catch (error) { reportSaveError(key, error); return false; }
  });
  chains.set(key, run);
  return run;
}
/** Waits for queued writes on a key, then reads it. */
async function read<T>(key: string, fallback: T): Promise<T> {
  await (chains.get(key) ?? Promise.resolve()).catch(() => {});
  return loadJSON(key, fallback);
}

// ═══ INVENTORY — { [wineId]: bottles } ═══
export async function getInventory(): Promise<Record<string, number>> { return read(STORAGE_KEYS.INVENTORY, {}); }
export async function getStock(wineId: string): Promise<number | null> { return (await getInventory())[wineId] ?? null; }
export function setStock(wineId: string, stock: number): Promise<boolean> {
  return update<Record<string, number>>(STORAGE_KEYS.INVENTORY, {}, inv => { inv[wineId] = Math.max(0, stock); });
}
export function adjustStock(wineId: string, delta: number): Promise<boolean> {
  return update<Record<string, number>>(STORAGE_KEYS.INVENTORY, {}, inv => { inv[wineId] = Math.max(0, (inv[wineId] ?? 0) + delta); });
}
export async function getInventoryStats(): Promise<{ tracked: number; totalBottles: number; outOfStock: number }> {
  const entries = Object.values(await getInventory());
  return { tracked: entries.length, totalBottles: entries.reduce((s, n) => s + n, 0), outOfStock: entries.filter(n => n === 0).length };
}

// ═══ PAIRINGS ═══
export interface Pairing { id: string; name: string; notes: string; wineIds: string[]; createdAt: string; updatedAt: string }
export async function getPairings(): Promise<Pairing[]> { return read(STORAGE_KEYS.PAIRINGS, []); }
export async function createPairing(name: string): Promise<Pairing> {
  const now = new Date().toISOString();
  const p: Pairing = { id: 'p' + Date.now(), name, notes: '', wineIds: [], createdAt: now, updatedAt: now };
  await update<Pairing[]>(STORAGE_KEYS.PAIRINGS, [], list => { list.unshift(p); });
  return p;
}
export function updatePairing(id: string, updates: Partial<Pick<Pairing, 'name' | 'notes' | 'wineIds'>>): Promise<boolean> {
  return update<Pairing[]>(STORAGE_KEYS.PAIRINGS, [], list => {
    const p = list.find(x => x.id === id);
    if (!p) return;
    if (updates.name !== undefined) p.name = updates.name;
    if (updates.notes !== undefined) p.notes = updates.notes;
    if (updates.wineIds !== undefined) p.wineIds = updates.wineIds;
    p.updatedAt = new Date().toISOString();
  });
}
export function deletePairing(id: string): Promise<boolean> {
  return update<Pairing[]>(STORAGE_KEYS.PAIRINGS, [], list => list.filter(p => p.id !== id));
}

// ═══ LEGACY QUIZ HISTORY — read-only evidence ═══
// Old multiple-choice results are shown as legacy recognition history. They are
// never converted into recall reviews (PRD S-09).
export interface QuizSession { id: string; wineId: string; wineName: string; date: string; score: number; total: number; pct: number; questions: number }
export async function getQuizHistory(): Promise<QuizSession[]> { return read(STORAGE_KEYS.QUIZ_HISTORY, []); }

// ═══ DEFAULT CATALOG: shown, hidden, or wines removed one by one ═══
export interface CatalogView { hidden: boolean; removed: string[] }
export async function getCatalogView(): Promise<CatalogView> {
  const v = await read<Partial<CatalogView>>(STORAGE_KEYS.CATALOG_VIEW, {});
  return { hidden: v.hidden === true, removed: Array.isArray(v.removed) ? v.removed.filter(x => typeof x === 'string') : [] };
}
export async function changeCatalogView(change: (view: CatalogView) => CatalogView): Promise<CatalogView> {
  let next: CatalogView = { hidden: false, removed: [] };
  await update<Partial<CatalogView>>(STORAGE_KEYS.CATALOG_VIEW, {}, v => { next = change({ hidden: v.hidden === true, removed: Array.isArray(v.removed) ? v.removed : [] }); return next; });
  return next;
}

// ═══ FAVORITES ═══
export async function getFavorites(): Promise<string[]> { return read(STORAGE_KEYS.FAVORITES, []); }
/** Toggle a favorite; resolves to the new state (true = favorited). */
export async function toggleFavorite(wineId: string): Promise<boolean> {
  let nowFavorite = false;
  await update<string[]>(STORAGE_KEYS.FAVORITES, [], favs => {
    const i = favs.indexOf(wineId);
    if (i >= 0) favs.splice(i, 1); else favs.push(wineId);
    nowFavorite = i < 0;
  });
  return nowFavorite;
}

// ═══ COURSES ═══
export interface CourseSlot { answers: Record<string, string>; wineId: string | null; wineName: string | null }
export async function getCourseState(): Promise<CourseSlot[]> { return read(STORAGE_KEYS.COURSE_STATE, []); }
export function saveCourseState(courses: CourseSlot[]): Promise<boolean> {
  return update<CourseSlot[]>(STORAGE_KEYS.COURSE_STATE, [], () => courses);
}

// ═══ LEGACY ID MIGRATION (PRD I-01) ═══
export interface MigrationReport { version: 1; at: string; converted: number; unresolved: string[]; keys: string[] }

/**
 * Convert stored positional IDs (w0…) to canonical IDs, once.
 * Lossless: the raw values are copied to a backup key first, IDs that cannot be
 * resolved are kept exactly as they were and listed, and nothing is deleted.
 */
export async function migrateLegacyWineIds(): Promise<MigrationReport> {
  const done = await loadJSON<MigrationReport | null>(MIGRATION_KEY, null);
  if (done) return done;
  const report: MigrationReport = { version: 1, at: new Date().toISOString(), converted: 0, unresolved: [], keys: [] };
  const convert = (id: unknown): unknown => {
    if (typeof id !== 'string' || !LEGACY_ID.test(id)) return id;
    const canonical = resolveWineId(id);
    if (!canonical) { if (!report.unresolved.includes(id)) report.unresolved.push(id); return id; }
    report.converted++;
    return canonical;
  };
  const backup: Record<string, string | null> = {};
  for (const key of Object.values(STORAGE_KEYS)) backup[key] = await store.get(key).catch(() => null);
  if (!(await store.get(BACKUP_KEY).catch(() => null))) await store.set(BACKUP_KEY, JSON.stringify({ at: report.at, values: backup }));

  const plans: [string, unknown, (v: any) => unknown][] = [
    [STORAGE_KEYS.FAVORITES, [], (v: string[]) => [...new Set(v.map(convert))]],
    [STORAGE_KEYS.INVENTORY, {}, (v: Record<string, number>) => {
      const out: Record<string, number> = {};
      for (const [id, n] of Object.entries(v)) { const k = convert(id) as string; out[k] = (out[k] ?? 0) + n; }
      return out;
    }],
    [STORAGE_KEYS.PAIRINGS, [], (v: Pairing[]) => v.map(p => ({ ...p, wineIds: p.wineIds.map(convert) }))],
    [STORAGE_KEYS.QUIZ_STATS, null, (v: { byWine?: Record<string, unknown> } | null) => {
      if (!v?.byWine) return v;
      return { ...v, byWine: Object.fromEntries(Object.entries(v.byWine).map(([id, s]) => [convert(id), s])) };
    }],
    [STORAGE_KEYS.QUIZ_HISTORY, [], (v: QuizSession[]) => v.map(h => ({ ...h, wineId: convert(h.wineId) }))],
    [STORAGE_KEYS.LEARNED_VAULT, [], (v: { wineId: string }[]) => v.map(x => ({ ...x, wineId: convert(x.wineId) }))],
    [STORAGE_KEYS.COURSE_STATE, [], (v: CourseSlot[]) => v.map(c => ({ ...c, wineId: convert(c.wineId) }))],
  ];
  for (const [key, fallback, fn] of plans) {
    if (!backup[key]) continue;
    const before = report.converted;
    const ok = await update(key, fallback, fn);
    if (!ok) throw new Error(`Migration could not write ${key}; nothing was marked complete.`);
    if (report.converted !== before) report.keys.push(key);
  }
  await store.set(MIGRATION_KEY, JSON.stringify(report));
  return report;
}
