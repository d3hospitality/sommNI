// ═══════════════════════════════════════════════════════════════════
// sommNI — Sync Bridge (localStorage shared between phone + glasses)
// Same storage keys as the Android APK wineStore.js
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';

// ── Storage keys — must match sommNI Android (wineStore.js) ──
export const STORAGE_KEYS = {
  INVENTORY:     'sommni_inventory',
  PAIRINGS:      'sommni_pairings',
  FAVORITES:     'sommni_favorites',
  QUIZ_STATS:    'sommni_quiz_stats',
  QUIZ_HISTORY:  'sommni_quiz_history',
  LEARNED_VAULT: 'sommni_learned_vault',
  COURSE_STATE:  'sommni_course_state',
} as const;

let _bridge: EvenAppBridge | null = null;

export function initSync(bridge: EvenAppBridge): void {
  _bridge = bridge;
}

// ── Read / Write JSON via SDK bridge ──

async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  if (!_bridge) return fallback;
  try {
    const raw = await _bridge.getLocalStorage(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

async function saveJSON(key: string, data: unknown): Promise<void> {
  if (!_bridge) return;
  try { await _bridge.setLocalStorage(key, JSON.stringify(data)); }
  catch (e) { console.error(`[sync] saveJSON(${key}) failed:`, e); }
}

// ═══════════════════════════════════════════════════════════════════
// INVENTORY — { [wineId]: stockCount }
// ═══════════════════════════════════════════════════════════════════

export async function getInventory(): Promise<Record<string, number>> {
  return loadJSON(STORAGE_KEYS.INVENTORY, {});
}

export async function getStock(wineId: string): Promise<number | null> {
  const inv = await getInventory();
  return inv[wineId] ?? null;
}

export async function setStock(wineId: string, stock: number): Promise<void> {
  const inv = await getInventory();
  inv[wineId] = Math.max(0, stock);
  await saveJSON(STORAGE_KEYS.INVENTORY, inv);
}

export async function adjustStock(wineId: string, delta: number): Promise<void> {
  const inv = await getInventory();
  inv[wineId] = Math.max(0, (inv[wineId] ?? 0) + delta);
  await saveJSON(STORAGE_KEYS.INVENTORY, inv);
}

export async function getInventoryStats(): Promise<{
  tracked: number; totalBottles: number; outOfStock: number;
}> {
  const inv = await getInventory();
  const entries = Object.values(inv);
  return {
    tracked: entries.length,
    totalBottles: entries.reduce((s, n) => s + n, 0),
    outOfStock: entries.filter(n => n === 0).length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PAIRINGS — same shape as wineStore.js
// { id, name, notes, wineIds: string[], createdAt, updatedAt }
// ═══════════════════════════════════════════════════════════════════

export interface Pairing {
  id: string;
  name: string;
  notes: string;
  wineIds: string[];
  createdAt: string;
  updatedAt: string;
}

export async function getPairings(): Promise<Pairing[]> {
  return loadJSON(STORAGE_KEYS.PAIRINGS, []);
}

export async function savePairings(pairings: Pairing[]): Promise<void> {
  await saveJSON(STORAGE_KEYS.PAIRINGS, pairings);
}

export async function createPairing(name: string): Promise<Pairing> {
  const pairings = await getPairings();
  const p: Pairing = {
    id: 'p' + Date.now(),
    name,
    notes: '',
    wineIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  pairings.unshift(p);
  await savePairings(pairings);
  return p;
}

export async function updatePairing(id: string, updates: Partial<Pick<Pairing, 'name' | 'notes' | 'wineIds'>>): Promise<void> {
  const pairings = await getPairings();
  const idx = pairings.findIndex(p => p.id === id);
  if (idx < 0) return;
  if (updates.name !== undefined) pairings[idx].name = updates.name;
  if (updates.notes !== undefined) pairings[idx].notes = updates.notes;
  if (updates.wineIds !== undefined) pairings[idx].wineIds = updates.wineIds;
  pairings[idx].updatedAt = new Date().toISOString();
  await savePairings(pairings);
}

export async function deletePairing(id: string): Promise<void> {
  const pairings = await getPairings();
  await savePairings(pairings.filter(p => p.id !== id));
}

// ═══════════════════════════════════════════════════════════════════
// QUIZ STATS — { totalAnswered, totalCorrect, byWine: { [wineId]: { answered, correct } } }
// ═══════════════════════════════════════════════════════════════════

export interface QuizStats {
  totalAnswered: number;
  totalCorrect: number;
  byWine: Record<string, { answered: number; correct: number }>;
}

export async function getQuizStats(): Promise<QuizStats> {
  return loadJSON(STORAGE_KEYS.QUIZ_STATS, { totalAnswered: 0, totalCorrect: 0, byWine: {} });
}

export async function recordQuizAnswer(wineId: string, correct: boolean): Promise<void> {
  const stats = await getQuizStats();
  stats.totalAnswered++;
  if (correct) stats.totalCorrect++;
  if (!stats.byWine[wineId]) stats.byWine[wineId] = { answered: 0, correct: 0 };
  stats.byWine[wineId].answered++;
  if (correct) stats.byWine[wineId].correct++;
  await saveJSON(STORAGE_KEYS.QUIZ_STATS, stats);
}

// ═══════════════════════════════════════════════════════════════════
// QUIZ HISTORY — dated sessions
// { id, wineId, wineName, date, score, total, pct, questions }
// ═══════════════════════════════════════════════════════════════════

export interface QuizSession {
  id: string;
  wineId: string;
  wineName: string;
  date: string;
  score: number;
  total: number;
  pct: number;
  questions: number;
}

export async function getQuizHistory(): Promise<QuizSession[]> {
  return loadJSON(STORAGE_KEYS.QUIZ_HISTORY, []);
}

export async function recordQuizSession(
  wineId: string, wineName: string, score: number, total: number, questions: number,
): Promise<void> {
  const history = await getQuizHistory();
  history.unshift({
    id: 'qh' + Date.now(),
    wineId, wineName,
    date: new Date().toISOString(),
    score, total,
    pct: Math.round((score / total) * 100),
    questions,
  });
  if (history.length > 200) history.length = 200;
  await saveJSON(STORAGE_KEYS.QUIZ_HISTORY, history);
}

// ═══════════════════════════════════════════════════════════════════
// LEARNED VAULT — mastery tracking (mirrors wineStore.js logic)
// ═══════════════════════════════════════════════════════════════════

export async function getLearnedVault(): Promise<string[]> {
  const vault: { wineId: string }[] = await loadJSON(STORAGE_KEYS.LEARNED_VAULT, []);
  return vault.map(v => v.wineId);
}

export async function checkAndUpdateLearned(wineId: string): Promise<boolean> {
  const history = (await getQuizHistory()).filter(h => h.wineId === wineId);
  if (history.length < 3) return false;
  const last3 = history.slice(0, 3);
  const recentPerfect = last3[0].pct === 100;
  const strongRecent = last3.filter(h => h.pct >= 90).length >= 2;
  return recentPerfect && strongRecent;
}

// ═══════════════════════════════════════════════════════════════════
// FAVORITES — string[] of wine IDs
// ═══════════════════════════════════════════════════════════════════

export async function getFavorites(): Promise<string[]> {
  return loadJSON(STORAGE_KEYS.FAVORITES, []);
}

export async function saveFavorites(favorites: string[]): Promise<void> {
  await saveJSON(STORAGE_KEYS.FAVORITES, favorites);
}

export async function toggleFavorite(wineId: string): Promise<boolean> {
  const favs = await getFavorites();
  const idx = favs.indexOf(wineId);
  if (idx >= 0) { favs.splice(idx, 1); } else { favs.push(wineId); }
  await saveFavorites(favs);
  return idx < 0; // returns true if now favorited
}

// ═══════════════════════════════════════════════════════════════════
// COURSE STATE — persisted course builder state
// ═══════════════════════════════════════════════════════════════════

export interface CourseSlot {
  answers: Record<string, string>;
  wineId: string | null;
  wineName: string | null;
}

export async function getCourseState(): Promise<CourseSlot[]> {
  return loadJSON(STORAGE_KEYS.COURSE_STATE, []);
}

export async function saveCourseState(courses: CourseSlot[]): Promise<void> {
  await saveJSON(STORAGE_KEYS.COURSE_STATE, courses);
}
