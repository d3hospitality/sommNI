// ═══════════════════════════════════════════════════════════════════
// wineLENS — the 215-wine catalog on the phone.
// Search everything at once, filter by style, and every wine opens its
// full tasting notes (the same notes the glasses show). Replaces the old
// four-level drill-down with restaurant stock counters.
// ═══════════════════════════════════════════════════════════════════
import { WINE_TYPES, TYPE_DISPLAY, getGrapesForCountry, getWinesForGrape, placeLabel, type WineType } from './constants';
import { allCatalogWines, type CatalogWine } from './identity';
import { wineReferences } from './study/content';
import { catalogSections, SOURCE_LABEL } from './notes-format';
import { catalogPhotoUrl } from './bottle-assets';
import { getFavorites, toggleFavorite } from './sync';
import { splitWineName } from './pages';

type Filter = WineType | 'All' | 'Favorites';
let filter: Filter = 'All';
let query = '';
let favorites: string[] = [];
let root: HTMLElement | null = null;
let dialog: HTMLDialogElement | null = null;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const base = () => import.meta.env.BASE_URL || './';
const bottle = (w: CatalogWine) => catalogPhotoUrl(base(), w.id) ?? '';
const style = (w: CatalogWine) => (w.wine.style || '').replace(/\s*[–-]\s*/g, ', ');
const haystack = new Map<string, string>();
function searchText(w: CatalogWine): string {
  let text = haystack.get(w.id);
  if (!text) { text = [w.wine.name, w.wine.grape, w.wine.region, w.country, TYPE_DISPLAY[w.type], w.wine.style, w.wine.nose].join(' ').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, ''); haystack.set(w.id, text); }
  return text;
}
/** Where this wine lives in the glasses menus (Type › Country › Grape › Wine). */
function glassesPath(w: CatalogWine): string {
  const grape = getGrapesForCountry(w.type, w.country).find(g => getWinesForGrape(w.type, w.country, g).some(x => x.name === w.wine.name));
  return [TYPE_DISPLAY[w.type], w.country, grape, splitWineName(w.wine.name).title].filter(Boolean).join(' › ');
}
function visible(): CatalogWine[] {
  const q = query.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = q.split(/\s+/).filter(Boolean);
  return allCatalogWines().filter(w => (q ? words.every(word => searchText(w).includes(word)) : filter === 'All' || (filter === 'Favorites' ? favorites.includes(w.id) : w.type === filter)));
}
function card(w: CatalogWine): string {
  const { title, producer } = splitWineName(w.wine.name);
  const img = bottle(w), nose = w.wine.nose ? w.wine.nose.split(',').slice(0, 3).map(s => s.trim()).join(', ') : '';
  return `<button class="wl-cat-card" data-cat-open="${esc(w.id)}">${img ? `<img class="wl-cat-bottle" src="${esc(img)}" alt="" loading="lazy">` : '<span class="wl-cat-bottle"></span>'}
    <span class="wl-cat-copy"><span class="wl-kicker">${esc([w.wine.grape, style(w)].filter(Boolean).join(' · '))}</span><strong>${esc(title)}</strong><span class="wl-muted">${esc([producer, placeLabel(w.wine.region, w.country)].filter(Boolean).join(' · '))}</span>${nose ? `<span class="wl-cat-nose">${esc(nose)}…</span>` : ''}</span>${favorites.includes(w.id) ? '<span class="wl-cat-fav" aria-label="Favorite">★</span>' : ''}</button>`;
}

export async function renderCatalog(el: HTMLElement): Promise<void> {
  root = el; favorites = await getFavorites();
  const all = allCatalogWines(), list = visible();
  const count = (f: Filter) => f === 'All' ? all.length : f === 'Favorites' ? favorites.length : all.filter(w => w.type === f).length;
  const chips: Filter[] = ['All', ...WINE_TYPES.filter(t => count(t) > 0), 'Favorites'];
  // Group by country (search results stay flat, best matches first by name).
  const groups = new Map<string, CatalogWine[]>();
  // One style: group by country. All or favorites: group by style (fewer, larger groups).
  if (!query.trim()) for (const w of list) { const k = filter === 'All' || filter === 'Favorites' ? TYPE_DISPLAY[w.type] : w.country; groups.set(k, [...(groups.get(k) || []), w]); }
  el.innerHTML = `<div class="wl-section-heading"><div><p class="wl-kicker">THE CATALOG</p><h2>${all.length} wines<span>.</span> Every note.</h2></div></div>
    <div class="wl-cat-tools"><label class="wl-search-label"><span class="sr-only">Search the catalog</span><input id="cat-search" type="search" value="${esc(query)}" placeholder="Search wine, producer, grape, region or aroma…" autocomplete="off"></label>
    <div class="wl-chips" role="group" aria-label="Filter by style">${chips.map(c => `<button class="chip ${!query && filter === c ? 'active' : ''}" data-cat-filter="${c}" aria-pressed="${!query && filter === c}">${c === 'Favorites' ? '★ Favorites' : c === 'All' ? 'All' : TYPE_DISPLAY[c]} <span class="chip-count">${count(c)}</span></button>`).join('')}</div></div>
    <p class="wl-muted small" role="status">${query.trim() ? `${list.length} ${list.length === 1 ? 'match' : 'matches'} for “${esc(query.trim())}”` : filter === 'Favorites' && !list.length ? 'No favorites yet. Open a wine and tap ☆ Favorite.' : `${list.length} wines`} · tap a wine for its tasting notes</p>
    ${query.trim() ? `<div class="wl-cat-list">${list.slice(0, 120).map(card).join('')}</div>` : [...groups].map(([name, wines]) => `<h3 class="wl-cat-group">${esc(name)} <span>${wines.length}</span></h3><div class="wl-cat-list">${wines.map(card).join('')}</div>`).join('')}
    ${query.trim() && !list.length ? '<div class="wl-empty"><h3>No wines found.</h3><p>Try a grape, a region or a producer. Not in the catalog? Add it to your Winebrary.</p><button class="wl-primary" data-wl-add-catalog>＋ Add it to my Winebrary</button></div>' : ''}`;
  el.querySelector<HTMLInputElement>('#cat-search')!.addEventListener('input', e => {
    const input = e.target as HTMLInputElement, at = input.selectionStart; query = input.value; void renderCatalog(el).then(() => {
      const again = el.querySelector<HTMLInputElement>('#cat-search'); if (again) { again.focus(); if (at !== null) again.setSelectionRange(at, at); }
    });
  });
  el.querySelectorAll<HTMLButtonElement>('[data-cat-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.catFilter as Filter; query = ''; void renderCatalog(el); }));
  el.querySelectorAll<HTMLButtonElement>('[data-cat-open]').forEach(b => b.addEventListener('click', () => openWine(b.dataset.catOpen!)));
  el.querySelector('[data-wl-add-catalog]')?.addEventListener('click', () => (document.querySelector('[data-wl-add]') as HTMLElement | null)?.click());
  el.querySelectorAll<HTMLImageElement>('img.wl-cat-bottle').forEach(img => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }));
}
/** Open the catalog on one style (used by the Home "By style" chips). */
export function showCatalogType(type: Filter) { filter = type; query = ''; if (root) void renderCatalog(root); }

function openWine(id: string) {
  const w = allCatalogWines().find(x => x.id === id); if (!w) return;
  dialog ??= Object.assign(document.body.appendChild(document.createElement('dialog')), { className: 'wl-dialog wl-catalog-dialog' });
  dialog.setAttribute('aria-label', 'Tasting notes');
  const { title, producer } = splitWineName(w.wine.name), sections = catalogSections(w.wine), refs = wineReferences(w.id), img = bottle(w);
  const ref = refs.claims.length ? `Producer-sourced facts · ${[...new Set(refs.claims.map(c => c.source.publisher))].map(esc).join(', ')} · checked ${esc(refs.claims[0].reviewed_at)}`
    : refs.open.length ? `Reference under review: ${esc(refs.open[0].note)}` : 'Catalog details not yet verified against the producer.';
  const fav = () => favorites.includes(w.id) ? '★ Favorite' : '☆ Favorite';
  dialog.innerHTML = `<button class="wl-close" aria-label="Close dialog">×</button>
    <p class="wl-kicker">${esc([TYPE_DISPLAY[w.type], w.wine.grape, style(w)].filter(Boolean).join(' · ').toUpperCase())}</p><h2>${esc(title)}</h2><p class="wl-muted">${esc([producer, placeLabel(w.wine.region, w.country), placeLabel(w.wine.region, w.country).includes(w.country) ? '' : w.country].filter(Boolean).join(' · '))}</p>
    <div class="wl-detail-grid"><div class="wl-detail-photo">${img ? `<img src="${esc(img)}" alt="${esc(title)} bottle">` : '<span class="wl-photo-placeholder">NO PHOTO</span>'}</div>
    <section class="wl-notes-block" aria-label="Tasting notes"><div class="wl-notes-head"><p class="wl-kicker">TASTING NOTES</p><span class="wl-source wl-source-catalog">${esc(SOURCE_LABEL.catalog)}</span></div>
    <dl class="wl-notes-dl">${sections.map(s => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.text)}</dd></div>`).join('')}</dl><p class="ref-chip">${ref}</p></section></div>
    <p class="wl-muted small">On your glasses: ${esc(glassesPath(w))}</p>
    <div class="wl-detail-actions"><button class="wl-primary" data-save-library="${esc(w.id)}">＋ Save to my Winebrary</button><button class="wl-outline" id="cat-fav" aria-pressed="${favorites.includes(w.id)}">${fav()}</button></div>`;
  dialog.querySelector('.wl-close')!.addEventListener('click', () => dialog!.close());
  // Winebrary opens its own dialog for the save; close this one first.
  dialog.querySelector('[data-save-library]')!.addEventListener('click', () => dialog!.close());
  dialog.querySelector('#cat-fav')!.addEventListener('click', async e => {
    const button = e.currentTarget as HTMLButtonElement, now = await toggleFavorite(w.id);
    favorites = now ? [...favorites, w.id] : favorites.filter(x => x !== w.id);
    button.textContent = fav(); button.setAttribute('aria-pressed', String(now));
    if (root) void renderCatalog(root);
  });
  if (!dialog.open) dialog.showModal();
}
