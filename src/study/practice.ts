// ═══════════════════════════════════════════════════════════════════
// wineLENS Study — practice runs and progress (PolyGot model)
//
// A run plays one stage: meet cards introduce, flash cards flip and are
// self-graded, pick/spot cards are answered. A boss draws 8 cards from the
// whole season, asks flash cards as picks, and has three hearts.
// Every answer is one practice event in the account's study log (recorded
// once per presentation, synced like reviews). XP, combos, stars, unlocks
// and the day streak are replays of that log, so every device agrees.
// ═══════════════════════════════════════════════════════════════════
import { seasons, shuffle, BOSS_SIZE, type Season, type Stage, type PracticeCard, type CardKind, type SeasonId } from './seasons';
import { recordPractice, practiceEvents, allEvents, onStudyChange } from './store';

export const XP_RIGHT = 10, XP_TRY = 2, HEARTS = 3;
const COMBO_GAP_MS = 15 * 60_000;
/** x3 earns +2, rising to +10 at x7 and beyond. */
export const comboBonus = (combo: number) => Math.min(Math.max(combo - 2, 0), 5) * 2;
export const starsFor = (pct: number): 0 | 1 | 2 | 3 => pct >= 1 ? 3 : pct >= 0.8 ? 2 : pct >= 0.6 ? 1 : 0;
export const bossId = (season: SeasonId) => `p.${season}.boss`;
/** Boss answers live under the boss ("p.grapes.boss.<stage>.<card>.<kind>"): they never change a stage's stars. */
export const bossCardId = (cardId: string, season: SeasonId) => cardId.replace(`p.${season}.`, `p.${season}.boss.`);
/** Combos run within one stage (or one boss) and break after a 15-minute pause. */
const segmentOf = (cardId: string) => cardId.split('.').slice(0, 3).join('.');

// ── progress (replayed from the log) ──
export interface Progress { xp: number; latest: Map<string, boolean>; bossCleared: Set<string>; streak: number; combo: number; lastAt: number; lastSegment: string }
let cache: { key: string; value: Progress } | null = null;
const dayKey = (iso: string, tz: number) => new Date(Date.parse(iso) + tz * 60_000).toISOString().slice(0, 10);
export function progress(now = Date.now()): Progress {
  const events = practiceEvents();
  const key = `${events.length}:${events.length ? events[events.length - 1].event_id : ''}:${allEvents().length}:${new Date(now).toDateString()}`;
  if (cache?.key === key) return cache.value;
  let xp = 0, combo = 0, lastAt = 0, lastSegment = '';
  const latest = new Map<string, boolean>(), bossCleared = new Set<string>();
  for (const e of events) {
    if (e.card_id.endsWith('.boss')) { if (e.correct) bossCleared.add(e.card_id); continue; }
    const at = Date.parse(e.occurred_at), segment = segmentOf(e.card_id);
    if (at - lastAt > COMBO_GAP_MS || segment !== lastSegment) combo = 0;
    combo = e.correct ? combo + 1 : 0;
    xp += e.correct ? XP_RIGHT + comboBonus(combo) : XP_TRY;
    latest.set(e.card_id, e.correct === true);
    lastAt = at; lastSegment = segment;
  }
  // Day streak: consecutive local days with any study (review or practice), ending today or yesterday.
  const tz = -new Date(now).getTimezoneOffset();
  const days = new Set(allEvents().map(e => dayKey(e.occurred_at, e.tz_offset_min)));
  let streak = 0;
  const today = dayKey(new Date(now).toISOString(), tz);
  let cursor = Date.parse(today + 'T12:00:00Z');
  if (!days.has(today)) cursor -= 86_400_000;
  while (days.has(new Date(cursor).toISOString().slice(0, 10))) { streak++; cursor -= 86_400_000; }
  const value = { xp, latest, bossCleared, streak, combo: now - lastAt > COMBO_GAP_MS ? 0 : combo, lastAt, lastSegment };
  cache = { key, value };
  return value;
}

export interface StageStats { total: number; right: number; pct: number; stars: 0 | 1 | 2 | 3; played: boolean }
export function stageStats(stage: Stage, p = progress()): StageStats {
  const scored = stage.cards.filter(c => c.kind !== 'meet');
  const right = scored.filter(c => p.latest.get(c.id) === true).length;
  const pct = scored.length ? right / scored.length : 0;
  return { total: scored.length, right, pct, stars: starsFor(pct), played: scored.some(c => p.latest.has(c.id)) };
}
export function stageUnlocked(s: Season, index: number, p = progress()): boolean {
  return index === 0 || stageStats(s.stages[index - 1], p).stars >= 1;
}
export function bossUnlocked(s: Season, p = progress()): boolean { return s.stages.every(st => stageStats(st, p).stars >= 1); }
export interface SeasonStats { stars: number; maxStars: number; cleared: number; stages: number; boss: boolean; next: Stage | null }
export function seasonStats(s: Season, p = progress()): SeasonStats {
  const stats = s.stages.map(st => stageStats(st, p));
  const next = s.stages.find((st, i) => stageUnlocked(s, i, p) && stats[i].stars < 3) ?? null;
  return { stars: stats.reduce((n, x) => n + x.stars, 0), maxStars: s.stages.length * 3, cleared: stats.filter(x => x.stars >= 1).length, stages: s.stages.length, boss: p.bossCleared.has(bossId(s.id)), next };
}
export function studyTotals(p = progress()) {
  const all = seasons().map(s => seasonStats(s, p));
  return { xp: p.xp, streak: p.streak, stars: all.reduce((n, x) => n + x.stars, 0), maxStars: all.reduce((n, x) => n + x.maxStars, 0) };
}

// ── runs ──
export type Mode = CardKind;
export type Phase = 'front' | 'back' | 'answered';
export interface Turn { card: PracticeCard; mode: Mode; options: string[]; eventId: string; shownAt: number; phase: Phase; chosen: string | null; correct: boolean | null; gained: number; saveError: string }
export interface RunSummary { right: number; answered: number; total: number; pct: number; stars: 0 | 1 | 2 | 3; xp: number; bestCombo: number; cleared: boolean; failed: boolean; stopped: boolean; boss: boolean }
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `ev-${Date.now()}-${Math.random().toString(36).slice(2)}`);

type Listener = () => void;
export class PracticeRun {
  readonly cards: PracticeCard[];
  readonly boss: boolean;
  readonly segment: string;
  index = 0;
  current: Turn | null = null;
  combo: number;
  bestCombo = 0;
  xp = 0;
  right = 0;
  answered = 0;
  hearts: number | null;
  failed = false;
  stopped = false;
  private busy = false;
  private markerSaved = false;
  private listeners = new Set<Listener>();

  constructor(readonly season: Season, readonly stage: Stage, readonly device: 'phone' | 'g2', seed = String(Date.now())) {
    this.boss = stage.boss;
    this.cards = stage.boss ? shuffle(stage.cards, `boss:${seed}`).slice(0, BOSS_SIZE) : [...stage.cards];
    this.hearts = stage.boss ? HEARTS : null;
    this.segment = stage.boss ? bossId(season.id) : `p.${season.id}.${stage.id}`;
    const p = progress();
    this.combo = p.lastSegment === this.segment ? p.combo : 0;
    this.present();
  }
  on(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(); }
  get total(): number { return this.cards.length; }
  get scoredTotal(): number { return this.cards.filter(c => c.kind !== 'meet').length; }
  get finished(): boolean { return this.index >= this.cards.length; }

  private present() {
    const card = this.cards[this.index];
    if (!card) { this.current = null; return; }
    // A boss never asks for self-grading: flash cards become picks.
    const mode: Mode = this.boss && card.kind === 'flash' ? 'pick' : card.kind;
    this.current = { card, mode, options: mode === 'pick' || mode === 'spot' ? card.options : [], eventId: uuid(), shownAt: Date.now(),
      phase: 'front', chosen: null, correct: null, gained: 0, saveError: '' };
  }
  /** Flash card: show the back. */
  flip() { const t = this.current; if (!t || t.mode !== 'flash' || t.phase !== 'front') return; t.phase = 'back'; this.emit(); }
  /** Flash card back: self-grade. */
  async grade(knew: boolean) { const t = this.current; if (!t || t.mode !== 'flash' || t.phase !== 'back') return; await this.answer(t, knew, knew ? t.card.answer : null); }
  /** Pick / spot: choose an option. */
  async choose(option: string) {
    const t = this.current;
    if (!t || (t.mode !== 'pick' && t.mode !== 'spot') || t.phase !== 'front' || !t.options.includes(option)) return;
    await this.answer(t, option === t.card.answer, option);
  }
  private async answer(t: Turn, correct: boolean, chosen: string | null) {
    if (this.busy || t.phase === 'answered') return;
    this.busy = true;
    t.phase = 'answered'; t.chosen = chosen; t.correct = correct;
    // Same rule as the replay in progress(): a pause of 15 minutes ends a combo.
    const p = progress();
    if (Date.now() - p.lastAt > COMBO_GAP_MS || p.lastSegment !== this.segment) this.combo = 0;
    this.combo = correct ? this.combo + 1 : 0;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    t.gained = correct ? XP_RIGHT + comboBonus(this.combo) : XP_TRY;
    this.xp += t.gained; this.answered++;
    if (correct) this.right++;
    else if (this.hearts !== null) this.hearts = Math.max(0, this.hearts - 1);
    this.emit();
    try {
      const r = await recordPractice({ event_id: t.eventId, card_id: this.boss ? bossCardId(t.card.id, this.season.id) : t.card.id, correct, device: this.device, duration_ms: Date.now() - t.shownAt });
      if (!r.saved) t.saveError = 'Saved in this session; storage is retrying.';
    } catch (error) { t.saveError = error instanceof Error ? error.message : 'Could not save this answer.'; }
    finally { this.busy = false; this.emit(); }
  }
  /** Move on after a meet card or an answer. A boss with no hearts left ends here. */
  async next() {
    const t = this.current;
    if (!t || this.busy || (t.mode !== 'meet' && t.phase !== 'answered')) return;
    if (this.hearts === 0) { this.failed = true; this.index = this.cards.length; }
    else this.index++;
    this.present();
    if (this.finished) await this.saveBoss();
    this.emit();
  }
  /** Stop early: answers already given stay saved. */
  stop() { if (this.finished) return; this.stopped = true; this.index = this.cards.length; this.current = null; this.emit(); }
  private async saveBoss() {
    if (!this.boss || this.markerSaved || this.stopped) return;
    this.markerSaved = true;
    await recordPractice({ event_id: uuid(), card_id: bossId(this.season.id), correct: !this.failed, device: this.device }).catch(() => {});
  }
  summary(): RunSummary {
    const total = this.scoredTotal, pct = total ? this.right / total : 0;
    const cleared = this.boss ? !this.failed && !this.stopped && this.finished : pct >= 0.6 && !this.stopped;
    return { right: this.right, answered: this.answered, total, pct, stars: this.boss ? (cleared ? 3 : 0) : starsFor(pct), xp: this.xp, bestCombo: this.bestCombo, cleared, failed: this.failed, stopped: this.stopped, boss: this.boss };
  }
}

/** The answer line after answering: only when it adds something the glyph and the detail don't already say. */
export function answerLine(t: Turn): string {
  const c = t.card, f = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (t.correct === false) return t.mode === 'flash' ? c.answer : `Answer: ${c.answer}`;
  if (t.mode === 'spot' || f(c.detail).includes(f(c.answer)) || f(c.back.word) === f(c.answer)) return '';
  return c.answer;
}
/** The stage to play after this one (next unlocked with stars to earn, else the boss when open). */
export function nextStage(s: Season, after: Stage): Stage | null {
  const p = progress();
  if (after.boss) return null;
  const following = s.stages[after.index + 1];
  if (following && stageUnlocked(s, following.index, p)) return following;
  return bossUnlocked(s, p) && !p.bossCleared.has(bossId(s.id)) ? s.boss : null;
}
export { onStudyChange as onProgressChange };
