// ═══════════════════════════════════════════════════════════════════
// wineLENS — catalog wine identity (PRD I-01)
//
// Canonical IDs (`wl_…`) are immutable and stored in data/catalog-identity.json.
// They are matched by catalog key "Type|Country|Name", never by position, so
// reordering the seed catalog cannot re-point a favorite, pairing or review.
//
// Legacy positional IDs (w0…w214) are a frozen, one-way bridge for data saved
// before canonical IDs. Bottle image files are still named by that frozen legacy
// ID; `assetIdFor` resolves them.
//
// Unknown IDs resolve to null. There is no fallback wine.
// ═══════════════════════════════════════════════════════════════════
import identity from './data/catalog-identity.json';
import { WINE_TYPES, COUNTRIES, WINES, type Wine, type WineType } from './constants';

export interface CatalogWine { id: string; legacyId: string | null; wine: Wine; type: WineType; country: string }
interface IdentityEntry { id: string; key: string; legacy_id: string | null; status: string }

const entries = (identity as { entries: IdentityEntry[] }).entries;
const byKey = new Map(entries.filter(e => e.status === 'active').map(e => [e.key, e]));
const byLegacy = new Map(entries.filter(e => e.legacy_id).map(e => [e.legacy_id as string, e]));
let byId: Map<string, CatalogWine> | null = null;

function index(): Map<string, CatalogWine> {
  if (byId) return byId;
  byId = new Map();
  for (const type of WINE_TYPES) for (const country of COUNTRIES[type]) for (const wine of WINES[type]?.[country] || []) {
    const entry = byKey.get(`${type}|${country}|${wine.name}`);
    if (entry) byId.set(entry.id, { id: entry.id, legacyId: entry.legacy_id, wine, type, country });
  }
  return byId;
}

export const LEGACY_ID = /^w\d+$/;

/** Canonical ID for a catalog wine, or null if the catalog key has no assigned identity. */
export function getWineId(type: WineType, country: string, wineName: string): string | null {
  return byKey.get(`${type}|${country}|${wineName}`)?.id ?? null;
}

/** Canonical or legacy ID → canonical ID of an active catalog wine, else null. */
export function resolveWineId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (LEGACY_ID.test(id)) { const e = byLegacy.get(id); return e && index().has(e.id) ? e.id : null; }
  return index().has(id) ? id : null;
}

/** Look up a catalog wine by canonical or legacy ID. Unknown → null (never another wine). */
export function lookupWineById(id: string | null | undefined): CatalogWine | null {
  const canonical = resolveWineId(id);
  return canonical ? index().get(canonical) ?? null : null;
}

/** Filename stem of the bundled bottle image (frozen legacy ID), or null. */
export function assetIdFor(id: string | null | undefined): string | null {
  return lookupWineById(id)?.legacyId ?? null;
}

export function allCatalogWines(): CatalogWine[] { return [...index().values()]; }
