import { openLabelGlasses } from './label-glasses';
import type { LibraryWine } from '../winebrary';
import { type EvenAppBridge, type EvenHubEvent, RebuildPageContainer, TextContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import { WineAddSession, type WineDraft } from './add-session';
import { AtlasVoiceCapture } from '../atlas/voice-capture';
import { claimDisplay, dropDisplay } from '../display';
import { rebuildGlassesPage, imageIdle, queueBridgeControl } from '../image-utils';
import { readableText } from '../reading/document';
import { clipBytes, clipLabel } from '../glasses-list';
import { researchAction } from './client';
import { betaProvider } from '../beta/client';
import { getLocale } from '../intelligence/client';
import { readLibrary, openLibraryOnGlasses } from '../winebrary-glasses';
import { finishWineArtwork } from '../wine-contributions';
import { artworkOwner } from '../artwork-store';
import { referenceNotes } from '../reference-notes';

let bridge: EvenAppBridge | null = null, active = false, paused = false, last = 0;
let capture: AtlasVoiceCapture | null = null, traffic = Promise.resolve();
let savedWine:LibraryWine|null=null;
let starting = false, scopeAtOpen: string | null = null;
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = traffic.catch(() => {}).then(task); traffic = next.then(() => {}); return next;
}
export function buildAddWinePage(title: string, body: string, hint: string) {
  const page = new RebuildPageContainer({ containerTotalNum: 3, textObject: [
    new TextContainerProperty({ containerID: 1, containerName: 'add-title', xPosition: 16, yPosition: 4, width: 544, height: 32, content: clipLabel(title), isEventCapture: 0 }),
    new TextContainerProperty({ containerID: 2, containerName: 'add-body', xPosition: 16, yPosition: 42, width: 544, height: 200, content: ' ', isEventCapture: 1 }),
    new TextContainerProperty({ containerID: 3, containerName: 'add-hint', xPosition: 16, yPosition: 252, width: 544, height: 32, content: clipLabel(hint), isEventCapture: 0 }),
  ] });
  return readableText(page, 2, clipBytes(body, 1950));
}
const OPTIONS = ['Save to Winebrary', 'Review wine again', 'Say a different wine', 'Edit / add photo on phone', 'Back to Winebrary'];
export function buildAddWineOptions() {
  return new RebuildPageContainer({ containerTotalNum: 2, textObject: [new TextContainerProperty({ containerID: 1, containerName: 'add-title', xPosition: 16, yPosition: 4, width: 544, height: 32, content: 'IS THIS YOUR WINE?', isEventCapture: 0 })], listObject: [new ListContainerProperty({ containerID: 2, containerName: 'add-options', xPosition: 2, yPosition: 42, width: 572, height: 200, isEventCapture: 1, itemContainer: new ListItemContainerProperty({ itemCount: OPTIONS.length, itemWidth: 0, isItemSelectBorderEn: 1, itemName: OPTIONS }) })] });
}
export function addWineReview(draft: WineDraft) {
  const wine = draft.result;
  const vintage = wine.vintage_state === 'year' ? String(wine.vintage) : wine.vintage_state === 'non_vintage' ? 'Non-vintage' : 'Vintage unknown';
  const identity = [clipLabel(wine.wine_name, 120), clipLabel(wine.producer || 'Producer unconfirmed', 120), [vintage, wine.region, wine.country].filter(Boolean).join(' · ')].join('\n');
  return [identity, 'AI MATCH · Check the name and year.', wine.uncertainty || '', 'TASTING NOTES', referenceNotes(wine.tasting_notes || 'No reference notes returned.'), 'Saving sends wine details and artwork to sommNI for review. Personal notes stay private.'].filter(Boolean).join('\n\n');
}
const session = new WineAddSession({
  research: (query, signal) => researchAction({ action: 'research', query, request_id: crypto.randomUUID() }, signal),
  save: async draft => {
    const scope = artworkOwner();
    if (!scope || scope !== scopeAtOpen || readLibrary().userId !== scope) throw Error('Your account changed. Open Winebrary again.');
    const result = await researchAction({ action: 'confirm', draft_id: draft.id, confirmed: true, review: draft.result }, AbortSignal.timeout(45000));
    savedWine=result.item;
    await finishWineArtwork(result.item, scope, true, false).catch(() => {});
    window.dispatchEvent(new CustomEvent('winelens-research-saved', { detail: { id: result.item.id } }));
    return result;
  },
  changed: render,
});
async function render() {
  if (!active || paused || !bridge) return;
  const phase = session.phase;
  let page: RebuildPageContainer;
  if (phase === 'options') page = buildAddWineOptions();
  else {
    const content: Record<string, [string, string, string]> = {
      ready: ['ADD A WINE', 'Say the wine name, producer and year.\n\nFor example: “Vasse Felix Cabernet 2019”.\n\nAudio goes to AI for research. You review before saving.', 'Tap: speak · 2x: Winebrary'],
      opening: ['ADD A WINE', 'Opening the microphone…', '2x: cancel'],
      listening: ['LISTENING', 'Say the name, producer and year.\n\nTap when finished. Stops after 6 seconds.', 'Tap: finish · 2x: cancel'],
      transcribing: ['HEARD YOU', 'Turning your speech into a wine name…', '2x: cancel'],
      researching: ['FINDING YOUR WINE', `${session.query}\n\nChecking the identity and reference notes…`, '2x: cancel'],
      review: ['REVIEW YOUR WINE', session.draft ? addWineReview(session.draft) : '', 'Scroll: read · Tap: options · 2x: retry'],
      saving: ['SAVING WINE', 'Saving your reviewed wine and reference notes…\n\nNo need to tap again.', 'Please wait'],
      saved: [session.duplicate ? 'ALREADY IN WINEBRARY' : 'SAVED TO WINEBRARY', `${session.item?.wine_name}\n\n${session.duplicate ? 'Your notes and current photo are preserved. Tap to compare up to three photos.' : 'Notes saved. Tap to find up to three bottle photos and choose your match here on glasses.'}`, 'Tap: choose bottle · 2x: Winebrary'],
      error: ['LET’S TRY AGAIN', session.error, 'Tap: speak again · 2x: Winebrary'],
    };
    page = buildAddWinePage(...content[phase]);
  }
  await serial(async () => {
    if (!active || paused || phase !== session.phase || !bridge) return;
    if (!await rebuildGlassesPage(bridge, page)) throw Error('The glasses could not show this step.');
    last = Date.now();
  });
}
async function stopCapture() { const old = capture; capture = null; await old?.cancel(); }
async function release() { active = false; session.cancel(); await stopCapture(); await traffic.catch(() => {}); await imageIdle(); }
async function backToLibrary() { await release(); dropDisplay('wine-add'); await openLibraryOnGlasses(); }
async function speak() {
  if(starting)return;starting=true;
  try {
  await stopCapture(); await session.reset();
  if (!active || paused || !bridge) return;
  const b = bridge;
  const current = new AtlasVoiceCapture({
    control: open => serial(() => queueBridgeControl(() => open && (!active || paused) ? Promise.resolve(false) : b.audioControl(open))),
    state: state => session.setPhase(state === 'idle' ? 'ready' : state),
    transcribe: async (pcm, signal) => {
      let binary = ''; for (const byte of pcm) binary += String.fromCharCode(byte);
      const result = await betaProvider({ action: 'transcribe', pcm: btoa(binary), sample_rate: 16000, locale: getLocale() }, signal);
      return typeof result.text === 'string' ? result.text : '';
    },
    result: async text => { if (capture !== current || !active || paused) return; capture = null; await session.lookup(text); },
    error: async error => { if (capture !== current || !active || paused) return; capture = null; await session.fail(error); },
  });
  capture = current; await current.start();
  } finally { starting=false; }
}
export async function openAddWineGlasses() {
  if (!bridge) throw Error('Connect your G2 glasses first.');
  await claimDisplay('wine-add', release); active = true; paused = false;scopeAtOpen=readLibrary().userId;
  await session.reset();
  if (!readLibrary().userId) await session.fail(Error('Link your sommNI account on your phone, then try again.'));
}
export async function pauseAddWineGlasses() {
  if (!active) return; paused = true; session.cancel(); await stopCapture();
}
export async function resumeAddWineGlasses() { if (!active) return; paused = false; await session.reset(); }
export function connectAddWineGlasses(value: EvenAppBridge) {
  bridge = value;
  window.addEventListener('pagehide', () => { void pauseAddWineGlasses(); });
  window.addEventListener('sommni-library-account-changing', () => { void pauseAddWineGlasses(); });
  window.addEventListener('winelens-library-changed', () => { if (active && readLibrary().userId!==scopeAtOpen) void backToLibrary(); });
}
export function handleAddWineGlasses(event: EvenHubEvent): boolean {
  if (!active) return false;
  if (paused) return true;
  if (event.audioEvent) { capture?.feed(event.audioEvent.audioPcm); return true; }
  const type = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType ?? 0;
  const action = async () => {
    if (session.phase === 'saving') return;
    if (type === 3) {
      if (['opening', 'listening', 'transcribing', 'researching', 'review', 'options'].includes(session.phase)) { session.cancel(); await stopCapture(); await session.reset(); }
      else await backToLibrary();
      return;
    }
    if (type !== 0 || Date.now() - last < 350) return;
    if (session.phase === 'ready' || session.phase === 'error') { if (!readLibrary().userId) return backToLibrary(); return speak(); }
    if (session.phase === 'listening') return capture?.finish();
    if (session.phase === 'review') return session.setPhase('options');
    if (session.phase === 'saved') {
      const wine=savedWine;if(!wine||artworkOwner()!==scopeAtOpen)return backToLibrary();
      await release();dropDisplay('wine-add');
      try{await openLabelGlasses([wine]);}catch(error){await openLibraryOnGlasses();console.warn('[sommNI] Bottle review unavailable',error);}
      return;
    }
    if (session.phase !== 'options' || !event.listEvent) return;
    const index = event.listEvent.currentSelectItemIndex ?? 0;
    if (index === 0) return session.save();
    if (index === 1) return session.setPhase('review');
    if (index === 2) return speak();
    if (index === 3) {
      const request=new CustomEvent('sommni-review-draft', { cancelable: true, detail: { draft: session.draft } });
      window.dispatchEvent(request);
      if(!request.defaultPrevented){await session.fail(Error('Your phone is busy. Resume this draft in Add a wine on your phone.'));return;}
      await backToLibrary(); return;
    }
    if (index === 4) return backToLibrary();
  };
  void action().catch(error => { if (active && !paused) void session.fail(error).catch(console.warn); });
  return true;
}
