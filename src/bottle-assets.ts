// Bundled catalog bottle images keep their old file names (w0.png … w214.png), which
// the pixel-art sprites used before. Web views and GitHub Pages cache those names,
// so a device that saw the old sprites could keep showing them after the photographs
// shipped. The version query makes every client fetch the current set.
// Bump it whenever public/bottles/ is regenerated (see public/bottles/manifest.json "pipeline").
import { LINK_API_URL } from './account-config';
import { assetIdFor } from './identity';

export const BOTTLE_ASSET_VERSION = 'photographic-v2'; // v2: cut-out edge trimmed 3px (scripts/trim-bottle-edges.py)

export function bottleImageUrl(baseUrl: string, assetId: string): string {
  return `${baseUrl}bottles/${assetId}.png?v=${BOTTLE_ASSET_VERSION}`;
}

// ── Glasses bottles from the wineLENS backend ─────────────────────────
// The glasses pull each catalog wine's bottle from the backend (site/public/g2/bottles, made by
// scripts/build-g2-bottles.py): greyscale, trimmed, 420 px tall, ~22 KB instead of ~160 KB.
// Named by catalog ID, so a wine added to the catalog gets its bottle without an app update.
// The photograph bundled with the app is the fallback; if the backend is unreachable it is
// skipped for a minute so the glasses never wait on it twice.
export const G2_BOTTLE_VERSION = 'g2-v1';
export const G2_BOTTLE_BASE = `${LINK_API_URL}/g2/bottles/`;
const BACKEND_PAUSE_MS = 60_000;
let backendPausedUntil = 0;

export function g2BottleUrl(catalogId: string): string {
  return `${G2_BOTTLE_BASE}${encodeURIComponent(catalogId)}.png?v=${G2_BOTTLE_VERSION}`;
}
export const isBackendBottle = (url: string) => url.startsWith(G2_BOTTLE_BASE);
/** A backend answer (even 404) means it is reachable; only network failures and 5xx pause it. */
export function reportBottleSource(url: string, status: number | null): void {
  if (!isBackendBottle(url)) return;
  backendPausedUntil = status === null || status >= 500 ? Date.now() + BACKEND_PAUSE_MS : 0;
}
/** Where the glasses get a catalog wine's bottle, in order. Unknown wines get none (never another wine's bottle). */
/** Photographs held back in public/bottles/manifest.json "issues" (identity not confirmed). Kept in step by tests/catalog-bottles.cjs. */
export const BOTTLES_HELD_FOR_REVIEW: ReadonlySet<string> = new Set(['w105']);
/** The reviewed colour photograph of a catalog wine for the phone, or null (unknown or held for review). */
export function catalogPhotoUrl(baseUrl: string, catalogId: string | null | undefined): string | null {
  const asset = assetIdFor(catalogId);
  return asset && !BOTTLES_HELD_FOR_REVIEW.has(asset) ? bottleImageUrl(baseUrl, asset) : null;
}
export function catalogBottleSources(baseUrl: string, catalogId: string | null | undefined): string[] {
  const asset = assetIdFor(catalogId);
  if (!asset || !catalogId || BOTTLES_HELD_FOR_REVIEW.has(asset)) return [];
  const bundled = bottleImageUrl(baseUrl, asset);
  return Date.now() < backendPausedUntil ? [bundled] : [g2BottleUrl(catalogId), bundled];
}
