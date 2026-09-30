import type { RebuildPageContainer } from '@evenrealities/even_hub_sdk';

/** Hardware limits are stricter than the simulator. Reject invalid payloads before sending. */
export function validateGlassesPage(page: RebuildPageContainer): void {
  const images = page.imageObject ?? [], texts = page.textObject ?? [], lists = page.listObject ?? [];
  const all = [...images, ...texts, ...lists];
  const fail = (reason: string): never => { throw new Error(`Invalid G2 page: ${reason}`); };
  if (images.length > 4 || texts.length + lists.length > 8 || page.containerTotalNum !== all.length) fail('container count');
  if ([...texts, ...lists].filter(c => c.isEventCapture === 1).length !== 1) fail('exactly one input container required');
  if (new Set(all.map(c => c.containerID)).size !== all.length) fail('duplicate container ID');
  for (const c of all) {
    const { xPosition: x = 0, yPosition: y = 0, width: w = 0, height: h = 0 } = c;
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 576 || y + h > 288) fail(`${c.containerName} outside screen`);
    if ((c.containerName?.length ?? 0) > 16) fail('container name too long');
  }
  for (const c of images) {
    if (c.width! < 20 || c.width! > 288 || c.height! < 20 || c.height! > 144) fail(`${c.containerName} image must be 20–288 × 20–144`);
  }
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  for (const c of texts) if (bytes(c.content ?? '') > 999) fail(`${c.containerName} text too long`);
  for (const c of lists) {
    const labels = c.itemContainer?.itemName ?? [];
    if (labels.length > 20 || labels.some(s => bytes(s) > 63)) fail(`${c.containerName} list too long`);
  }
}
