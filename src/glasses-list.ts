// G2 content limits shared by every page. Measured against Even simulator 0.9.5 with SDK 0.0.9
// (dev-probe, 2026-09-29): a rebuild is REJECTED when any list row is over 63 UTF-8 bytes or any
// text container is over 999 UTF-8 bytes. The docs' "64 / 1000 characters" are exclusive byte caps.
// Lists hold at most 20 rows: long lists become pages of 18 entries + "More" + "Back".
export const LIST_MAX_ROWS = 20;
export const LIST_LABEL_MAX = 63;   // bytes
export const TEXT_MAX_BYTES = 999;  // bytes, per text container
export const LIST_ROW_PITCH = 40;   // px per list row in simulator 0.9.5

export type ListRow = { kind: 'item'; index: number } | { kind: 'more' } | { kind: 'back' };
export interface ListPage { labels: string[]; rows: ListRow[]; page: number; pageCount: number }

const utf8 = new TextEncoder();
const bytes = (text: string) => utf8.encode(text).length;
export function labelBytes(label: string): number { return bytes(label); }
/** Trim to a UTF-8 byte budget ("Romanée" and "·" cost 2 bytes), keeping line breaks. */
export function clipBytes(text: string, max = TEXT_MAX_BYTES): string {
  if (bytes(text) <= max) return text;
  // ASCII ellipsis: the G2 firmware font is not guaranteed to carry U+2026.
  const chars = [...text];
  let used = 0, end = 0;
  while (end < chars.length && used + bytes(chars[end]) <= max - 3) used += bytes(chars[end++]);
  return chars.slice(0, end).join('').trimEnd() + '...';
}
/** One-line label: collapse whitespace, then trim to the byte budget. */
export function clipLabel(label: string, max = LIST_LABEL_MAX): string {
  return clipBytes(label.replace(/\s+/g, ' ').trim(), max);
}

/** Rows map list indexes back to entries, so handlers never do index arithmetic. */
export function pageList(entries: string[], page = 0, withBack = true): ListPage {
  const reserved = withBack ? 2 : 1;
  const fitsOnePage = entries.length + (withBack ? 1 : 0) <= LIST_MAX_ROWS;
  const size = fitsOnePage ? Math.max(entries.length, 1) : LIST_MAX_ROWS - reserved;
  const pageCount = fitsOnePage ? 1 : Math.ceil(entries.length / size);
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  const start = current * size;
  const slice = entries.slice(start, start + size);
  const labels = slice.map(l => clipLabel(l));
  const rows: ListRow[] = slice.map((_, i) => ({ kind: 'item', index: start + i }));
  if (current < pageCount - 1) {
    const nextEnd = Math.min(start + size * 2, entries.length);
    labels.push(clipLabel(`More · ${start + size + 1}-${nextEnd} of ${entries.length}`));
    rows.push({ kind: 'more' });
  }
  if (withBack) { labels.push('Back'); rows.push({ kind: 'back' }); }
  return { labels, rows, page: current, pageCount };
}

/** Height that shows whole rows only, so the last visible row is never cut in half. */
export function wholeRowHeight(maxHeight: number): number {
  return Math.max(LIST_ROW_PITCH, Math.floor(maxHeight / LIST_ROW_PITCH) * LIST_ROW_PITCH);
}
