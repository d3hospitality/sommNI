// Pixel widths on the G2 lens, for placing text against a fixed position (the firmware has no
// text alignment: centring is done with spaces). Ported from PolyGot (lingua-franca, glass-px.ts):
// ASCII advances measured from the firmware font; other characters use their class width.
// Good to a few pixels, which is what space-padding can place anyway.
const ASCII_PX = [5,4,6,15,13,14,16,4,7,7,8,10,5,10,5,8,12,8,12,12,13,12,12,13,12,12,4,5,10,10,10,12,17,14,12,12,12,11,11,12,12,6,9,12,10,16,12,12,12,12,12,12,12,12,14,16,14,14,13,7,8,7,10,9,4,12,11,11,11,11,10,11,11,4,7,10,4,16,11,11,11,11,8,11,8,12,12,16,12,12,10,9,4,9,16];
export const GLASS_SPACE_PX = 5;

export function glassPx(text: string): number {
  let px = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code < 127) { px += ASCII_PX[code - 32]; continue; }
    // Accented Latin letters advance like their base letter.
    const base = ch.normalize('NFD').charAt(0);
    const baseCode = base.codePointAt(0)!;
    if (base !== ch && baseCode >= 32 && baseCode < 127) { px += ASCII_PX[baseCode - 32]; continue; }
    if (/[▀-⛿]/u.test(ch)) px += 20;   // ● ○ ★ ◆ ▶ ♥ and blocks
    else px += 12;
  }
  return px;
}

/** Spaces that move the pen from `fromPx` to `toPx` (never fewer than `min`). */
export function spacesTo(fromPx: number, toPx: number, min = 0): string {
  return ' '.repeat(Math.max(min, Math.round((toPx - fromPx) / GLASS_SPACE_PX)));
}

/** Greedy word wrap at `width` px, keeping explicit newlines. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const row of text.split('\n')) {
    let line = '', used = 0;
    for (const word of row.split(' ')) {
      const w = glassPx(word), step = (line ? GLASS_SPACE_PX : 0) + w;
      if (line && used + step > width) { out.push(line); line = word; used = w; }
      else { line += (line ? ' ' : '') + word; used += step; }
    }
    out.push(line);
  }
  return out;
}

/** One line clipped to `width` px with "..." (the firmware font may lack U+2026). */
export function clipPx(text: string, width: number): string {
  if (glassPx(text) <= width) return text;
  let chars = Array.from(text);
  while (chars.length && glassPx(chars.join('') + '...') > width) chars = chars.slice(0, -1);
  return chars.join('').trimEnd() + '...';
}

/** Each line centred in a box `width` px wide (wrapped first, at most `maxLines`). */
export function centreText(text: string, width: number, maxLines = 3): string {
  const lines = wrapText(text, width - 8);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = clipPx(kept[maxLines - 1] + ' ' + lines[maxLines], width - 8);
  return kept.map(line => spacesTo(0, (width - 8 - glassPx(line)) / 2) + line).join('\n');
}
