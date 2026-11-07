import { clipLabel } from './glasses-list';

/** Native list hover is firmware-dependent. Text cursors emit every swipe. */
export function cursorRows(labels: string[], index: number, width: number, visible = 7): string {
  const start = Math.max(0, Math.min(index - 2, labels.length - visible));
  const budget = Math.max(8, Math.floor(width / 9.5) - 3);
  return labels.slice(start, start + visible)
    .map((label, offset) => `${start + offset === index ? '>' : ' '} ${clipLabel(label, budget)}`).join('\n');
}
export function moveCursor(index: number, count: number, direction: number, nativeIndex?: number): number {
  return Math.max(0, Math.min(count - 1, nativeIndex ?? index + (direction === 2 ? 1 : -1)));
}
