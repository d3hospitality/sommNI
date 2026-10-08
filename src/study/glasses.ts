// ═══════════════════════════════════════════════════════════════════
// wineLENS — "Study today" on Even G2 (PRD S-02, G-01…G-04)
//
//   Home › Study today › prompt ─tap→ answer + source + Again/Hard/Good/Easy ─select→ next prompt … › summary
//
// One decision per screen, tap reveals / selects, double tap stops (reviews
// already rated stay saved). The G2 always studies in recall mode. It renders
// the same shared session as the phone, so both show the same card and result.
// While active this module owns the display; other handlers never see its taps.
// ═══════════════════════════════════════════════════════════════════
import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import { activeSession, startSession, onSessionChange, type StudySession } from './session';
import { cardSources, type StudyCard } from './content';
import { dueLabel, type Rating } from './scheduler';
import { catalogBottleSources } from '../bottle-assets';
import { clipBytes, clipLabel, LIST_ROW_PITCH } from '../glasses-list';
import { rebuildGlassesPage, pushBottlePhoto, invalidateImages, pushLogoToGlasses } from '../image-utils';
import { claimDisplay, dropDisplay } from '../display';
import { rebuildHomePage } from '../pages';

type Screen = 'prompt' | 'reveal' | 'saved' | 'summary' | 'empty';
const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const RATING_LABEL: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const SKILL_LABEL: Record<string, string> = { 'release-identity': 'release', origin: 'origin', grape: 'grape', appellation: 'appellation' };
const NAV_SETTLE_MS = 350;

let bridge: EvenAppBridge | null = null;
let baseUrl = '';
let active = false;
let busy = false;
let screen: Screen | null = null;
let shownKey = '';
let lastNavigation = 0;

export function connectStudyGlasses(value: EvenAppBridge, url: string) {
  bridge = value; baseUrl = url;
  // A rating or reveal on the phone moves the glasses along with it.
  onSessionChange(() => { if (active && !busy) void settle(() => render(false)); });
}
export function isStudyActive() { return active; }

// ═══ PAGE BUILDERS (pure; exported for display tests) ═══
const tz = () => -new Date().getTimezoneOffset();
function textBox(id: number, name: string, x: number, y: number, w: number, h: number, content: string, capture = 0) {
  return new TextContainerProperty({ xPosition: x, yPosition: y, width: w, height: h, containerID: id, containerName: name, content: clipBytes(content), isEventCapture: capture });
}
export function buildStudyPromptPage(card: StudyCard, position: number, total: number, retry: boolean, withImage: boolean): RebuildPageContainer {
  const x = withImage ? 132 : 24, width = 560 - x;
  const header = `STUDY  ·  ${position} of ${total}  ·  ${SKILL_LABEL[card.skill] ?? card.skill}${retry ? '  ·  retry' : ''}`;
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
    listObject: [new ListContainerProperty({
      xPosition: 2, yPosition: 124, width: 572, height: RATINGS.length * LIST_ROW_PITCH, containerID: 2, containerName: 'study-rating',
      itemContainer: new ListItemContainerProperty({ itemCount: labels.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: labels }),
      isEventCapture: 1,
    })],
  });
}
export function buildStudyMessagePage(title: string, body: string, hint: string): RebuildPageContainer {
  return new RebuildPageContainer({ containerTotalNum: 2, textObject: [
    textBox(3, 'study-message', 48, 40, 480, 190, `${title}\n\n${body}`, 1),
    textBox(4, 'study-hint', 48, 238, 480, 32, hint),
  ] });
}
function summaryPage(s: StudySession): RebuildPageContainer {
  const sum = s.summary();
  const now = new Date().toISOString();
  const lines = [`${sum.reviewed} ${sum.reviewed === 1 ? 'review' : 'reviews'} saved${sum.again ? `  ·  ${sum.again} to revisit` : ''}`];
  lines.push(`Next review: ${sum.nextDue ? dueLabel(sum.nextDue, now, tz()) : 'none scheduled'}`);
  if (sum.saveErrors) lines.push('Some reviews are waiting to be written to storage.');
  if (sum.takeaway) lines.push('', `${sum.takeaway.subject}: ${sum.takeaway.answer}`);
  return buildStudyMessagePage(sum.stopped ? 'Session paused.' : 'Session complete.', lines.join('\n'), 'Tap: Home');
}

// ═══ RENDER ═══
function desired(s: StudySession | null): Screen {
  if (!s) return 'empty';
  if (s.finished || !s.current) return s.total === 0 ? 'empty' : 'summary';
  if (s.current.done) return 'saved';
  return s.current.revealed ? 'reveal' : 'prompt';
}
/** Rebuild only when the visible state changed. A refused page leaves state untouched. */
async function render(force = true): Promise<void> {
  if (!bridge) throw new Error('Glasses are not connected.');
  const s = activeSession();
  const next = desired(s);
  const key = `${next}:${s?.index ?? -1}:${s?.current?.eventId ?? ''}`;
  if (!force && key === shownKey) return;
  const p = s?.current ?? null;
  const bottle = p && !p.card.hide_image ? catalogBottleSources(baseUrl, p.card.wine_id) : [];
  const asset = bottle.length > 0;
  let page: RebuildPageContainer;
  if (next === 'prompt') page = buildStudyPromptPage(p!.card, s!.index + 1, s!.total, p!.retry, !!asset);
  else if (next === 'reveal') page = buildStudyRevealPage(p!.card, s!.ratingPreview()!);
  else if (next === 'saved') page = buildStudyMessagePage('Saved.', p!.saveError || 'Answered on your phone.', 'Tap: next card  ·  Double tap: stop');
  else if (next === 'summary') page = summaryPage(s!);
  else page = buildStudyMessagePage('Nothing due right now.', emptyBody(), 'Tap: Home');
  await claimDisplay('study', relinquish);
  invalidateImages();
  if (!await rebuildGlassesPage(bridge, page)) throw new Error('The glasses did not accept this page.');
  active = true; screen = next; shownKey = key; lastNavigation = Date.now();
  if (next === 'prompt' && asset) {
    try { await pushBottlePhoto(bridge, bottle, 100, 120); }
    catch (error) { console.warn('[study] bottle image unavailable; the prompt stays readable', error); }
  }
}
function emptyBody(): string {
  const s = activeSession();
  const next = s?.summary().nextDue;
  return next ? `Next review: ${dueLabel(next, new Date().toISOString(), tz())}.` : 'Study cards appear here when researched wines have approved facts.';
}
async function goHome(): Promise<void> {
  if (!bridge) return;
  invalidateImages();
  if (!await rebuildGlassesPage(bridge, rebuildHomePage())) throw new Error('The glasses did not accept the home page.');
  active = false; screen = null; shownKey = ''; lastNavigation = Date.now();
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

/** Entry from the glasses home menu. Continues an unfinished phone session, else starts one. */
export async function openStudyOnGlasses(): Promise<void> {
  await settle(async () => {
    let s = activeSession();
    if (!s || s.finished) s = startSession('recall');
    if (s.current && !s.current.revealed) s.setMode('recall');
    await render(true);
  });
}

// ═══ INPUT ═══
export function handleStudyGlassesEvent(event: EvenHubEvent): boolean {
  if (!active) return false;
  const type = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return true;
  const s = activeSession();
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void settle(async () => {
      if (screen === 'summary' || screen === 'empty' || !s) return goHome();
      s.stop(); await render(true);
    });
    return true;
  }
  const isClick = type === undefined || type === OsEventTypeList.CLICK_EVENT;
  if (!isClick || Date.now() - lastNavigation < NAV_SETTLE_MS) return true;
  void settle(async () => {
    if (screen === 'summary' || screen === 'empty' || !s) return goHome();
    if (screen === 'prompt') { s.reveal(''); return render(true); }
    if (screen === 'saved') { s.next(); return render(true); }
    if (screen === 'reveal' && event.listEvent) {
      const rating = RATINGS[event.listEvent.currentSelectItemIndex ?? 0];
      if (!rating) return;
      await s.rate(rating, 'g2');
      if (s.current?.done) s.next();
      return render(true);
    }
  });
  return true;
}
