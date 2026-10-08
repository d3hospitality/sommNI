// ═══════════════════════════════════════════════════════════════════
// Save from the glasses — a tap on a tasting-notes page adds the wine to My Winebrary.
// The Winebrary module registers the saver (it owns the account + API); the glasses only
// show the answer in the notes footer, so the page never rebuilds and the bottle stays put.
// ═══════════════════════════════════════════════════════════════════

import { TextContainerUpgrade, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { sendSerial } from './image-utils';
import { NOTES_HINT } from './pages';

export type SaveResult = 'saved' | 'exists' | 'signed-out';

let saver: ((catalogId: string) => Promise<SaveResult>) | null = null;
let saving = false;
let lastOpened = 0;

/** Registered by the Winebrary once it knows who is signed in. */
export function setCatalogSaver(fn: ((catalogId: string) => Promise<SaveResult>) | null): void { saver = fn; }

/** A notes page just opened: the click that opened it must not also save. */
export function notesOpened(): void { lastOpened = Date.now(); }

const ANSWER: Record<SaveResult, string> = {
  saved: 'Saved to My Winebrary  ·  Double tap: Back',
  exists: 'Already in My Winebrary  ·  Double tap: Back',
  'signed-out': 'Link your account on the phone to save',
};

async function hint(bridge: EvenAppBridge, content: string): Promise<void> {
  await sendSerial(() => bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: 8, containerName: 'notes-hint', content, contentOffset: 0, contentLength: 0,
  })));
}

export async function saveFromGlasses(bridge: EvenAppBridge, catalogId: string | null | undefined): Promise<SaveResult | null> {
  if (!catalogId || saving || Date.now() - lastOpened < 600) return null;
  saving = true;
  try {
    await hint(bridge, 'Saving to My Winebrary...');
    const result: SaveResult = saver ? await saver(catalogId) : 'signed-out';
    await hint(bridge, ANSWER[result]);
    return result;
  } catch (error) {
    console.warn('[wineLENS] save from glasses failed', error);
    await hint(bridge, 'Not saved. Check the connection and tap again.').catch(() => {});
    return null;
  } finally { saving = false; }
}

export { NOTES_HINT };
