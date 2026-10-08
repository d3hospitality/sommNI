// ═══════════════════════════════════════════════════════════════════
// wineLENS — Study on Even G2 (PolyGot model + the sourced daily review)
//
//   Home › Study (map) ─┬─ Daily review › prompt ─tap→ answer + source + Again/Hard/Good/Easy › … › summary
//                       └─ Season › stage ─▶ meet → flash (tap flips, Knew it / Not yet) → pick / spot → … › stage summary
//                                   └─ Boss (8 cards, three hearts)
//
// Every card centres one glyph (288×128) on the lens with its text below.
// One decision per screen; tap acts, double tap goes back a level (answers
// already given stay saved). While active this module owns the display.
// ═══════════════════════════════════════════════════════════════════
import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import { activeSession, startSession, onSessionChange, buildQueue, nextDueAt, type StudySession } from './session';
import { cardSources, type StudyCard } from './content';
import { dueLabel, type Rating } from './scheduler';
import { seasons, season as seasonById, fold, type Glyph, type Season, type Stage, type SeasonId } from './seasons';
import { PracticeRun, progress, seasonStats, stageStats, stageUnlocked, bossUnlocked, studyTotals, nextStage, bossId, answerLine, type Turn } from './practice';
import { renderGlyph, GLYPH } from './glyph';
import { catalogBottleSources } from '../bottle-assets';
import { clipBytes, clipLabel, LIST_ROW_PITCH, wholeRowHeight } from '../glasses-list';
import { centreText, wrapText } from '../glass-px';
import { rebuildGlassesPage, pushBottlePhoto, invalidateImages, pushLogoToGlasses, pushGrayImage, currentImageEpoch } from '../image-utils';
import { claimDisplay, dropDisplay } from '../display';
import { rebuildHomePage } from '../pages';

type DailyScreen = 'prompt' | 'reveal' | 'saved' | 'summary' | 'empty';
type Screen = 'map' | 'season' | 'run' | 'run-summary' | DailyScreen;
const DAILY: Screen[] = ['prompt', 'reveal', 'saved', 'summary', 'empty'];
const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const RATING_LABEL: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const SKILL_LABEL: Record<string, string> = { 'release-identity': 'release', origin: 'origin', grape: 'grape', appellation: 'appellation' };
const NAV_SETTLE_MS = 350;
const TEXT_W = 560;

let bridge: EvenAppBridge | null = null;
let baseUrl = '';
let active = false;
let busy = false;
let screen: Screen | null = null;
let shownKey = '';
let lastNavigation = 0;
let seasonId: SeasonId | null = null;
let run: PracticeRun | null = null;
let notice = '';

export function connectStudyGlasses(value: EvenAppBridge, url: string) {
  bridge = value; baseUrl = url;
  // A rating or reveal on the phone moves the glasses along with it (daily review only).
  onSessionChange(() => { if (active && !busy && screen && DAILY.includes(screen)) void settle(() => renderDaily(false)); });
}
export function isStudyActive() { return active; }
/** The practice run on the glasses, if any (tests, and the phone's "playing on glasses" note). */
export function currentRun(): PracticeRun | null { return run; }

// ═══ PAGE BUILDERS (pure; exported for display tests) ═══
const tz = () => -new Date().getTimezoneOffset();
function textBox(id: number, name: string, x: number, y: number, w: number, h: number, content: string, capture = 0) {
  return new TextContainerProperty({ xPosition: x, yPosition: y, width: w, height: h, containerID: id, containerName: name, content: clipBytes(content || ' '), isEventCapture: capture });
}
function listBox(name: string, y: number, height: number, labels: string[]) {
  return new ListContainerProperty({ xPosition: 2, yPosition: y, width: 572, height, containerID: 2, containerName: name,
    itemContainer: new ListItemContainerProperty({ itemCount: labels.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: labels.map(l => clipLabel(l)) }), isEventCapture: 1 });
}
const glyphBox = (h: number) => new ImageContainerProperty({ xPosition: (576 - GLYPH.w) / 2, yPosition: 30, width: GLYPH.w, height: h, containerID: 1, containerName: 'study-glyph' });
function page(text: TextContainerProperty[], list: ListContainerProperty[] = [], images: ImageContainerProperty[] = []) {
  return new RebuildPageContainer({ containerTotalNum: text.length + list.length + images.length, textObject: text, ...(list.length ? { listObject: list } : {}), ...(images.length ? { imageObject: images } : {}) });
}
const starRow = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** Home › Study: the daily review, then the four seasons. */
export function buildStudyMapPage(header: string, rows: string[]): RebuildPageContainer {
  return page([textBox(3, 'study-head', 16, 4, 544, 36, header)], [listBox('study-map', 44, wholeRowHeight(240), [...rows, 'Back'])]);
}
export function buildSeasonPage(header: string, blurb: string, rows: string[]): RebuildPageContainer {
  return page([textBox(3, 'study-head', 16, 4, 544, 58, `${header}\n${blurb}`)], [listBox('study-stages', 66, wholeRowHeight(220), [...rows, 'Back'])]);
}
function hud(r: PracticeRun): string {
  const where = r.boss ? 'BOSS' : String(r.stage.index + 1);
  return clipLabel(`${r.season.short} ${where}  ·  ${Math.min(r.index + 1, r.total)}/${r.total}  ·  ${progress().xp} XP${r.combo >= 2 ? `  ·  x${r.combo}` : ''}${r.hearts !== null ? `  ·  ${'♥'.repeat(r.hearts)}${'○'.repeat(3 - r.hearts)}` : ''}`, 60);
}
/** Lines the prompt takes at full width. */
// Measured widths run a little short of the firmware's wrapping: plan with a margin.
const linesOf = (text: string) => wrapText(text, TEXT_W - 60).length;
export interface CardLayout { page: RebuildPageContainer; glyph: Glyph | null; glyphH: number }
/** One card of a practice run, for its current phase. */
export function buildRunCardPage(r: PracticeRun, t: Turn): CardLayout {
  const c = t.card, head = textBox(3, 'study-hud', 8, 0, 560, 28, hud(r));
  const hint = (text: string) => textBox(5, 'study-hint', 8, 254, 560, 30, centreText(text, 560, 1));
  if (t.mode === 'meet') {
    return { glyph: c.front, glyphH: GLYPH.h, page: page([head, textBox(4, 'study-cue', 8, 160, 560, 92, centreText(`${c.prompt}\n${c.detail}`, 560, 3), 1), hint('Tap: next  ·  Double tap: stop')], [], [glyphBox(GLYPH.h)]) };
  }
  if (t.phase === 'answered') {
    const verdict = t.correct ? `★ Right  ·  +${t.gained} XP` : `Not quite  ·  +${t.gained} XP${r.hearts !== null ? '  ·  -1 ♥' : ''}`;
    const body = centreText([verdict, answerLine(t), c.detail].filter(Boolean).join('\n'), 560, 4);
    return { glyph: c.back, glyphH: 112, page: page([head, textBox(4, 'study-cue', 8, 144, 560, 110, body, 1), hint(r.hearts === 0 ? 'Tap: see how you did' : 'Tap: next  ·  Double tap: stop')], [], [glyphBox(112)]) };
  }
  if (t.mode === 'flash') {
    if (t.phase === 'front') return { glyph: c.front, glyphH: GLYPH.h, page: page([head, textBox(4, 'study-cue', 8, 162, 560, 88, centreText(c.prompt, 560, 3), 1), hint('Tap: flip  ·  Double tap: stop')], [], [glyphBox(GLYPH.h)]) };
    const back = fold(c.back.word) === fold(c.answer) ? c.detail : `${c.answer}\n${c.detail}`;
    return { glyph: c.back, glyphH: 112, page: page([head, textBox(4, 'study-cue', 8, 144, 560, 62, centreText(back, 560, 2))], [listBox('study-grade', 208, 80, ['Knew it', 'Not yet'])], [glyphBox(112)]) };
  }
  // pick / spot
  const rows = t.options.length, listY = 288 - rows * LIST_ROW_PITCH;
  const long = linesOf(c.prompt) > 2 || c.front.icon === 'book' || !c.front.word.trim() && c.front.icon !== 'globe' && c.front.icon !== 'bottle';
  if (long) return { glyph: null, glyphH: 0, page: page([head, textBox(4, 'study-cue', 8, 32, 560, listY - 34, centreText(c.prompt, 560, Math.floor((listY - 34) / 26)))], [listBox('study-choices', listY, rows * LIST_ROW_PITCH, t.options)]) };
  const glyphH = Math.min(GLYPH.h, listY - 30 - 50);
  return { glyph: c.front, glyphH, page: page([head, textBox(4, 'study-cue', 8, 30 + glyphH, 560, listY - 30 - glyphH, centreText(c.prompt, 560, 2))], [listBox('study-choices', listY, rows * LIST_ROW_PITCH, t.options)], [glyphBox(glyphH)]) };
}
export function buildRunSummaryPage(r: PracticeRun, upNext: Stage | null): RebuildPageContainer {
  const s = r.summary();
  const title = r.boss ? (s.cleared ? 'BOSS DEFEATED' : s.stopped ? 'BOSS PAUSED' : 'OUT OF HEARTS') : s.stopped ? 'PAUSED' : s.cleared ? 'STAGE CLEAR' : 'KEEP GOING';
  const lines = [title, r.boss ? (s.cleared ? '◆ ◆ ◆' : '') : starRow(s.stars), `${s.right} of ${s.total} right  ·  +${s.xp} XP${s.bestCombo >= 2 ? `  ·  best combo x${s.bestCombo}` : ''}`,
    !r.boss && !s.cleared && !s.stopped ? 'Get 60% to unlock the next stage.' : upNext ? `Up next: ${upNext.boss ? 'the boss' : upNext.title}` : ''].filter(Boolean);
  const rows = [upNext ? (upNext.boss ? 'Face the boss' : `Next: ${upNext.title}`) : 'Play again', ...(upNext ? ['Play again'] : []), 'Season map'];
  return page([textBox(3, 'study-head', 8, 16, 560, 140, centreText(lines.join('\n'), 560, 5))], [listBox('study-after', 288 - rows.length * LIST_ROW_PITCH, rows.length * LIST_ROW_PITCH, rows)]);
}

// Daily review (sourced recall cards, spaced repetition): unchanged screens.
export function buildStudyPromptPage(card: StudyCard, position: number, total: number, retry: boolean, withImage: boolean): RebuildPageContainer {
  const x = withImage ? 132 : 24, width = 560 - x;
  const header = `DAILY REVIEW  ·  ${position} of ${total}  ·  ${SKILL_LABEL[card.skill] ?? card.skill}${retry ? '  ·  retry' : ''}`;
  const textObject = [
    textBox(3, 'study-header', x, 6, width, 30, clipLabel(header, 60)),
    textBox(4, 'study-prompt', x, 44, width, 200, `${card.subject}\n\n${card.prompt}`, 1),
    textBox(5, 'study-hint', x, 254, width, 30, 'Think, then tap to reveal  ·  Double tap: stop'),
  ];
  const imageObject = withImage ? [
    new ImageContainerProperty({ xPosition: 16, yPosition: 24, width: 100, height: 120, containerID: 1, containerName: 'bottle-top' }),
    new ImageContainerProperty({ xPosition: 16, yPosition: 144, width: 100, height: 120, containerID: 2, containerName: 'bottle-bot' }),
  ] : [];
  return new RebuildPageContainer({ containerTotalNum: textObject.length + imageObject.length, textObject, imageObject });
}
export function buildStudyRevealPage(card: StudyCard, preview: Record<Rating, string>): RebuildPageContainer {
  const cite = cardSources(card)[0];
  const source = cite ? `Source: ${cite.source.publisher} · ${cite.scope}` : '';
  const labels = RATINGS.map(r => clipLabel(`${RATING_LABEL[r]}  ·  ${preview[r]}`));
  return new RebuildPageContainer({
    containerTotalNum: 2,
    textObject: [textBox(3, 'study-answer', 24, 6, 528, 112, `${card.answer}\n${source}`)],
    listObject: [listBox('study-rating', 124, RATINGS.length * LIST_ROW_PITCH, labels)],
  });
}
export function buildStudyMessagePage(title: string, body: string, hint: string): RebuildPageContainer {
  return new RebuildPageContainer({ containerTotalNum: 2, textObject: [
    textBox(3, 'study-message', 48, 40, 480, 190, `${title}\n\n${body}`, 1),
    textBox(4, 'study-hint', 48, 238, 480, 32, hint),
  ] });
}
function dailySummaryPage(s: StudySession): RebuildPageContainer {
  const sum = s.summary();
  const now = new Date().toISOString();
  const lines = [`${sum.reviewed} ${sum.reviewed === 1 ? 'review' : 'reviews'} saved${sum.again ? `  ·  ${sum.again} to revisit` : ''}`];
  lines.push(`Next review: ${sum.nextDue ? dueLabel(sum.nextDue, now, tz()) : 'none scheduled'}`);
  if (sum.saveErrors) lines.push('Some reviews are waiting to be written to storage.');
  if (sum.takeaway) lines.push('', `${sum.takeaway.subject}: ${sum.takeaway.answer}`);
  return buildStudyMessagePage(sum.stopped ? 'Session paused.' : 'Session complete.', lines.join('\n'), 'Tap: Study map');
}

// ═══ MAP + SEASON CONTENT ═══
function mapRows(): { header: string; rows: string[] } {
  const totals = studyTotals(), due = buildQueue().length;
  const header = `STUDY  ·  ${totals.xp} XP${totals.streak ? `  ·  ${totals.streak}-day streak` : ''}  ·  ★ ${totals.stars}/${totals.maxStars}`;
  const rows = [due ? `Daily review  ·  ${due} ready` : 'Daily review  ·  nothing due',
    ...seasons().map(s => { const st = seasonStats(s); return `${s.title}  ·  ★ ${st.stars}/${st.maxStars}${st.boss ? '  ·  ◆' : ''}`; })];
  return { header: clipLabel(header, 60), rows };
}
function seasonRows(s: Season): string[] {
  const p = progress();
  const rows = s.stages.map((st, i) => stageUnlocked(s, i, p) ? `${starRow(stageStats(st, p).stars)}  ${i + 1} · ${st.title}` : `□  ${i + 1} · ${st.title}`);
  rows.push(p.bossCleared.has(bossId(s.id)) ? '◆  Boss · defeated' : bossUnlocked(s, p) ? '◆  Boss · 8 cards, 3 hearts' : '□  Boss · clear every stage');
  return rows;
}

// ═══ RENDER ═══
const glyphCache = new Map<string, Promise<Uint8Array>>();
function glyphGray(g: Glyph, h: number): Promise<Uint8Array> {
  const key = JSON.stringify([g, h]);
  if (!glyphCache.has(key)) {
    const job = renderGlyph(g, baseUrl, GLYPH.w, h);
    job.catch(() => glyphCache.delete(key));
    if (glyphCache.size > 60) glyphCache.delete(glyphCache.keys().next().value!);
    glyphCache.set(key, job);
  }
  return glyphCache.get(key)!;
}
async function show(next: Screen, built: RebuildPageContainer, key: string, glyph: Glyph | null = null, glyphH = 0): Promise<void> {
  if (!bridge) throw new Error('Glasses are not connected.');
  const pending = glyph ? glyphGray(glyph, glyphH) : null;   // render while the page goes out
  await claimDisplay('study', relinquish);
  invalidateImages();
  if (!await rebuildGlassesPage(bridge, built)) throw new Error('The glasses did not accept this page.');
  active = true; screen = next; shownKey = key; lastNavigation = Date.now();
  if (pending) {
    const epoch = currentImageEpoch();
    try { await pushGrayImage(bridge, 1, 'study-glyph', GLYPH.w, glyphH, await pending, epoch); }
    catch (error) { console.warn('[study] glyph unavailable; the card stays readable', error); }
  }
}
async function renderMap(): Promise<void> {
  const { header, rows } = mapRows();
  run = null; seasonId = null;
  await show('map', buildStudyMapPage(notice ? clipLabel(notice, 60) : header, rows), 'map'); notice = '';
}
async function renderSeason(): Promise<void> {
  const s = seasonById(seasonId!);
  const st = seasonStats(s);
  await show('season', buildSeasonPage(clipLabel(`${s.title.toUpperCase()}  ·  ★ ${st.stars}/${st.maxStars}`, 60), clipLabel(notice || s.blurb, 60), seasonRows(s)), `season:${s.id}`); notice = '';
}
async function renderRun(): Promise<void> {
  if (!run) return renderSeason();
  if (run.finished || !run.current) {
    return show('run-summary', buildRunSummaryPage(run, run.boss ? null : nextStage(run.season, run.stage)), `summary:${run.stage.id}`);
  }
  const t = run.current;
  const layout = buildRunCardPage(run, t);
  await show('run', layout.page, `run:${t.eventId}:${t.phase}`, layout.glyph, layout.glyphH);
}
function desiredDaily(s: StudySession | null): DailyScreen {
  if (!s) return 'empty';
  if (s.finished || !s.current) return s.total === 0 ? 'empty' : 'summary';
  if (s.current.done) return 'saved';
  return s.current.revealed ? 'reveal' : 'prompt';
}
/** Daily review: rebuild only when the visible state changed. A refused page leaves state untouched. */
async function renderDaily(force = true): Promise<void> {
  if (!bridge) throw new Error('Glasses are not connected.');
  const s = activeSession();
  const next = desiredDaily(s);
  const key = `${next}:${s?.index ?? -1}:${s?.current?.eventId ?? ''}`;
  if (!force && key === shownKey) return;
  const p = s?.current ?? null;
  const bottle = p && !p.card.hide_image ? catalogBottleSources(baseUrl, p.card.wine_id) : [];
  const asset = bottle.length > 0;
  let built: RebuildPageContainer;
  if (next === 'prompt') built = buildStudyPromptPage(p!.card, s!.index + 1, s!.total, p!.retry, !!asset);
  else if (next === 'reveal') built = buildStudyRevealPage(p!.card, s!.ratingPreview()!);
  else if (next === 'saved') built = buildStudyMessagePage('Saved.', p!.saveError || 'Answered on your phone.', 'Tap: next card  ·  Double tap: stop');
  else if (next === 'summary') built = dailySummaryPage(s!);
  else built = buildStudyMessagePage('Nothing due right now.', emptyBody(), 'Tap: Study map');
  await show(next, built, key);
  if (next === 'prompt' && asset) {
    try { await pushBottlePhoto(bridge, bottle, 100, 120); }
    catch (error) { console.warn('[study] bottle image unavailable; the prompt stays readable', error); }
  }
}
function emptyBody(): string {
  const next = nextDueAt();
  return next ? `Next review: ${dueLabel(next, new Date().toISOString(), tz())}. Meanwhile, play a season.` : 'Daily review cards appear when researched wines have approved facts. Meanwhile, play a season.';
}
async function goHome(): Promise<void> {
  if (!bridge) return;
  invalidateImages();
  if (!await rebuildGlassesPage(bridge, rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  active = false; screen = null; shownKey = ''; run = null; seasonId = null; lastNavigation = Date.now();
  dropDisplay('study');
  window.dispatchEvent(new Event('winelens-glasses-home'));
  await pushLogoToGlasses(bridge, baseUrl);
}
/** Another module took the display (e.g. the Wine Atlas from the phone): stop consuming events. */
function relinquish(): void { active = false; screen = null; shownKey = ''; }
async function settle(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  try { await task(); } catch (error) { console.error('[study] glasses: ' + (error instanceof Error ? error.message : String(error))); }
  finally { busy = false; }
}

/** Entry from the glasses home menu: the Study map. */
export async function openStudyOnGlasses(): Promise<void> { await settle(renderMap); }
/** Straight into a season (phone "Play on glasses"). */
export async function openSeasonOnGlasses(id: SeasonId): Promise<void> { await settle(async () => { seasonId = id; await renderSeason(); }); }
async function startRun(s: Season, stage: Stage) { run = new PracticeRun(s, stage, 'g2'); await renderRun(); }

// ═══ INPUT ═══
export function handleStudyGlassesEvent(event: EvenHubEvent): boolean {
  if (!active) return false;
  const type = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return true;
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void settle(async () => {
      if (screen === 'map') return goHome();
      if (screen === 'season') return renderMap();
      if (screen === 'run') { run?.stop(); return renderRun(); }
      if (screen === 'run-summary') { run = null; return renderSeason(); }
      const s = activeSession();
      if (screen === 'summary' || screen === 'empty' || !s) return renderMap();
      s.stop(); await renderDaily(true);
    });
    return true;
  }
  const isClick = type === undefined || type === OsEventTypeList.CLICK_EVENT;
  if (!isClick || Date.now() - lastNavigation < NAV_SETTLE_MS) return true;
  const index = event.listEvent ? event.listEvent.currentSelectItemIndex ?? 0 : -1;
  void settle(async () => {
    if (screen === 'map') {
      if (index < 0) return;
      if (index === 0) {
        let s = activeSession();
        if (!s || s.finished) s = startSession('recall');
        if (s.current && !s.current.revealed) s.setMode('recall');
        return renderDaily(true);
      }
      const all = seasons();
      if (index <= all.length) { seasonId = all[index - 1].id; return renderSeason(); }
      return goHome();
    }
    if (screen === 'season') {
      if (index < 0) return;
      const s = seasonById(seasonId!);
      if (index < s.stages.length) {
        if (!stageUnlocked(s, index)) { notice = `Get ★ on stage ${index} to unlock stage ${index + 1}.`; return renderSeason(); }
        return startRun(s, s.stages[index]);
      }
      if (index === s.stages.length) {
        if (!bossUnlocked(s)) { notice = 'Earn ★ on every stage to face the boss.'; return renderSeason(); }
        return startRun(s, s.boss);
      }
      return renderMap();
    }
    if (screen === 'run' && run?.current) {
      const t = run.current;
      if (t.mode === 'meet' || t.phase === 'answered') { await run.next(); return renderRun(); }
      if (t.mode === 'flash' && t.phase === 'front') { run.flip(); return renderRun(); }
      if (index < 0) return;
      if (t.mode === 'flash') { await run.grade(index === 0); return renderRun(); }
      const option = t.options[index];
      if (option) { await run.choose(option); return renderRun(); }
      return;
    }
    if (screen === 'run-summary' && run) {
      if (index < 0) return;
      const up = run.boss ? null : nextStage(run.season, run.stage);
      const rows = up ? ['next', 'again', 'map'] : ['again', 'map'];
      const pick = rows[index];
      if (pick === 'next' && up) return startRun(run.season, up);
      if (pick === 'again') return startRun(run.season, run.stage);
      run = null; return renderSeason();
    }
    // Daily review
    const s = activeSession();
    if (screen === 'summary' || screen === 'empty' || !s) return renderMap();
    if (screen === 'prompt') { s.reveal(''); return renderDaily(true); }
    if (screen === 'saved') { s.next(); return renderDaily(true); }
    if (screen === 'reveal' && event.listEvent) {
      const rating = RATINGS[index];
      if (!rating) return;
      await s.rate(rating, 'g2');
      if (s.current?.done) s.next();
      return renderDaily(true);
    }
  });
  return true;
}
