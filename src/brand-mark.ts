import identity from '../brand/identity.json';
import wordmark from '../brand/wordmark.json';

/** Vector geometry only: no font, network fetch, animation, or extra bridge calls. */
export function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color = '#ffffff') {
  const p = size <= 32 ? identity.micro : identity.mark;
  ctx.save(); ctx.translate(x, y); ctx.scale(size / p.size, size / p.size);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = p.stroke;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(p.frame)); ctx.stroke(new Path2D(p.glass)); ctx.fill(new Path2D(p.wine));
  ctx.restore();
}

/** Actual 190×190 home/finder panel, sent through the existing two-image queue. */
export function brandGlassesCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = 190; canvas.height = 190;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 190, 190);
  drawBrandMark(ctx, 35, 5, 120);
  const scale = 168 / wordmark.width;
  ctx.save(); ctx.translate(11 - wordmark.x * scale, 145 - wordmark.y * scale); ctx.scale(scale, scale);
  ctx.fillStyle = '#fff'; for (const path of wordmark.paths) ctx.fill(new Path2D(path)); ctx.restore();
  // Quantized before transfer: 0 = off, 255 = full light, 16 levels exactly.
  const pixels = ctx.getImageData(0, 0, 190, 190);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = Math.round(pixels.data[i] / 17) * 17;
    pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = value;
  }
  ctx.putImageData(pixels, 0, 0); return canvas;
}
