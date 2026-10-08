// ═══════════════════════════════════════════════════════════════════
// The default wines (the 215-wine wineLENS catalog): shown, hidden as a whole, or removed one by
// one, so the person can keep only their own wines. Per device, in companion storage.
// Hidden: the glasses Home drops the catalog's wine types, the Atlas and Find My Wine use only
// the Winebrary, and the Wines tab says so. Removed wines disappear from every catalog list.
// Study seasons still teach from the whole catalog.
// ═══════════════════════════════════════════════════════════════════
import { getCatalogView, changeCatalogView, type CatalogView } from './sync';
import { setRemovedCatalogKeys } from './constants';
import { lookupWineById } from './identity';

let view: CatalogView = { hidden: false, removed: [] };
let removed = new Set<string>();

function apply(next: CatalogView) {
  view = next; removed = new Set(next.removed);
  const keys: string[] = [];
  for (const id of next.removed) { const w = lookupWineById(id); if (w) keys.push(`${w.type}|${w.country}|${w.wine.name}`); }
  setRemovedCatalogKeys(keys);
  window.dispatchEvent(new Event('winelens-catalog-view'));
}
/** Read the saved choice (call once the storage backend is chosen). */
export async function loadCatalogView(): Promise<CatalogView> { apply(await getCatalogView()); return view; }
export function catalogHidden(): boolean { return view.hidden; }
export function removedCount(): number { return removed.size; }
/** False when the catalog is hidden or this wine was removed. */
export function catalogWineShown(id: string | null | undefined): boolean { return !!id && !view.hidden && !removed.has(id); }
export function catalogWineRemoved(id: string | null | undefined): boolean { return !!id && removed.has(id); }
export async function setCatalogHidden(hidden: boolean): Promise<void> { apply(await changeCatalogView(v => ({ ...v, hidden }))); }
export async function removeCatalogWine(id: string): Promise<void> { apply(await changeCatalogView(v => ({ ...v, removed: [...new Set([...v.removed, id])] }))); }
export async function restoreCatalogWine(id: string): Promise<void> { apply(await changeCatalogView(v => ({ ...v, removed: v.removed.filter(x => x !== id) }))); }
export async function restoreAllCatalogWines(): Promise<void> { apply(await changeCatalogView(v => ({ ...v, removed: [] }))); }
