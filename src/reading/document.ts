import type { RebuildPageContainer } from '@evenrealities/even_hub_sdk';
import { clipBytes, labelBytes } from '../glasses-list';

// Rebuilds accept 999 bytes; in-place updates allow a larger native scroll buffer.
// Keep complete text outside the wire model, then upgrade after layout acceptance.
export const READING_MAX_BYTES = 1999;
const documents = new WeakMap<RebuildPageContainer, Map<number, string>>();
export function readableText(page: RebuildPageContainer, id: number, text: string) {
  if (labelBytes(text) > READING_MAX_BYTES) throw new Error('Reading exceeds the G2 text buffer. Split at a chapter boundary.');
  const box = page.textObject?.find(b => b.containerID === id);
  if (!box) throw new Error('Reading container missing.');
  const entries = documents.get(page) ?? new Map<number, string>();
  entries.set(id, text); documents.set(page, entries);
  box.content = clipBytes(text);
  return page;
}
export function readingText(page: RebuildPageContainer, id: number) { return documents.get(page)?.get(id); }
