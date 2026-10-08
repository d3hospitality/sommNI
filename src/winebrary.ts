// ═══════════════════════════════════════════════════════════════════
// wineLENS — Winebrary on the phone: your private wines, their notes and photos.
// Everything goes through the one wineLENS account API (billing.ts).
// Paid help (label scan, tasting notes, Studio) shares one cost/consent panel:
// allowance first, then Pro tokens with explicit consent. Drafts are always
// reviewed before they are saved.
// ═══════════════════════════════════════════════════════════════════
import { accountRequest, billingStatus, costOf, requestIds, ACCOUNT_PAGE, type BillingStatus, type Feature } from './billing';
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { accountClient, redeemLinkCode, formatLinkCode, unlinkDevice, checkDeviceSession, linkedAccessToken } from './device-link';
import { lookupWineById } from './identity';
import { placeLabel } from './constants';
import { catalogPhotoUrl } from './bottle-assets';
import { splitWineName } from './pages';
import { libraryNotes, parseSections, SOURCE_LABEL, type NoteSection } from './notes-format';
import { useAccount, forgetAccount, unsyncedEvents } from './study/store';
import { syncStudy, setStudyAuth } from './study/sync';
import { wineListFlow } from './wine-list';
import { showWineOnGlasses, canShowWine, clearPrivateGlasses, drawGlassesPreview, setLibrarySource, libraryChanged, saveLibraryCache, clearLibraryCache } from './winebrary-glasses';

export interface LibraryWine {
  id: string; wine_name: string; producer: string | null; vintage: number | null;
  region: string | null; notes: string | null; wine_id?: string | null; image_url?: string;
  metadata: { vintage_state?: string; country?: string; grape?: string; color?: string; image_path?: string; image_source?: string; notes_source?: string } | null;
}
interface ImageDraft { path: string; url: string; source: 'photograph' | 'generated' }
interface NotesDraft { appearance: string; nose: string; palate: string; finish: string; story: string; confidence: number; text: string }
let auth: SupabaseClient;
let accountEmail = '';
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
let userId: string | null = null;
let items: LibraryWine[] = [];
let loading = false;
let notice = '';
let search = '';
let generation = 0;
let dialog: HTMLDialogElement;
let root: HTMLElement;
let busy = false;
let dialogRevision = 0;
let idleHook: (() => void) | null = null; // re-checks cost-gated buttons once a request finishes
let wineList: ReturnType<typeof wineListFlow>;

const STYLE_LABEL: Record<string, string> = { Rose: 'Rosé', Unknown: 'Wine' };
const styleOf = (wine: LibraryWine) => wine.metadata?.color ? STYLE_LABEL[wine.metadata.color] ?? wine.metadata.color : 'Wine';
export function vintageLabel(wine: LibraryWine): string {
  return wine.vintage ? String(wine.vintage) : wine.metadata?.vintage_state === 'non_vintage' ? 'Non-vintage' : 'Vintage unknown';
}
const wb = (action: string, body: Record<string, unknown> = {}) => accountRequest('winebrary', { action, ...body });
function feedback(message: string) { const el = dialog.querySelector('#wl-feedback'); if (el) el.textContent = message; }
function openDialog(html: string) {
  if (busy) return;
  dialogRevision++; idleHook = null;
  dialog.innerHTML = `<button class="wl-close" aria-label="Close dialog">×</button>${html}<p id="wl-feedback" class="wl-feedback" role="status" aria-live="polite"></p>`;
  dialog.querySelector('.wl-close')!.addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
function setBusy(value: boolean) {
  busy = value;
  dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b => { if (value) { b.dataset.wasDisabled = String(b.disabled); b.disabled = true; } else { b.disabled = b.dataset.wasDisabled === 'true'; delete b.dataset.wasDisabled; } });
  dialog.setAttribute('aria-busy', String(value));
  if (!value) idleHook?.();
}
async function run(task: () => Promise<void>) {
  if (busy) return;
  const revision = dialogRevision;
  setBusy(true);
  try { await task(); } catch (error) { if (revision === dialogRevision) feedback(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
  finally { if (revision === dialogRevision) setBusy(false); }
}
function requireAccount(action: () => void) { if (userId) action(); else signIn(); }
const notesHTML = (sections: NoteSection[] | null, text: string) => sections
  ? `<dl class="wl-notes-dl">${sections.map(s => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.text)}</dd></div>`).join('')}</dl>`
  : `<p class="wl-notes">${esc(text)}</p>`;

// ── One cost panel for every paid action ─────────────────────────────
export interface Gate { ready: () => boolean; consent: () => boolean; refresh: () => Promise<void>; recompute: () => void; beforeSpend: () => Promise<void>; free: (line: string | null) => void }
const costHTML = `<div class="wl-cost" role="status" aria-live="polite"><p class="wl-cost-line">Checking your plan…</p>
  <label class="wl-consent" hidden><input type="checkbox" class="wl-consent-once"> <span></span></label>
  <label class="wl-consent wl-consent-always-row" hidden><input type="checkbox" class="wl-consent-always"> Always allow token use for wineLENS help</label>
  <a class="wl-text-button wl-cost-link" href="${ACCOUNT_PAGE}" target="_blank" rel="noopener noreferrer" hidden></a></div>`;
/** quantity: how many uses one request is (pages of a wine list); the panel follows it via recompute(). */
function costGate(feature: Feature, onChange: () => void, quantity: () => number = () => 1): Gate {
  const box = dialog.querySelector<HTMLElement>('.wl-cost')!, revision = dialogRevision, account = userId;
  const line = box.querySelector('.wl-cost-line')!, once = box.querySelector<HTMLInputElement>('.wl-consent-once')!, always = box.querySelector<HTMLInputElement>('.wl-consent-always')!;
  const link = box.querySelector<HTMLAnchorElement>('.wl-cost-link')!;
  let state: BillingStatus | null = null, allowed = false, needsConsent = false, freeLine: string | null = null, shownTokens = -1;
  once.addEventListener('change', onChange); always.addEventListener('change', () => { if (always.checked) once.checked = true; onChange(); });
  const apply = () => {
    if (!state || revision !== dialogRevision) return;
    if (freeLine) return gate.free(freeLine);
    const cost = costOf(state, feature, Math.max(1, quantity()));
    allowed = cost.allowed && state.scan_available; needsConsent = cost.needsConsent;
    line.textContent = state.scan_available ? cost.line : 'Not available yet. You have not been charged.';
    (once.parentElement as HTMLElement).hidden = (always.parentElement as HTMLElement).hidden = !(allowed && needsConsent);
    if (cost.tokens !== shownTokens) { once.checked = false; always.checked = false; shownTokens = cost.tokens; } // consent is for one amount
    box.querySelector('.wl-consent span')!.textContent = `Use ${cost.tokens} ${cost.tokens === 1 ? 'token' : 'tokens'} for this`;
    link.hidden = !(cost.upgrade || cost.short); link.textContent = cost.upgrade ? 'See wineLENS Pro ↗' : 'Buy tokens ↗';
    onChange();
  };
  const gate: Gate = {
    ready: () => allowed && (!needsConsent || once.checked),
    consent: () => needsConsent && once.checked,
    async refresh() {
      try { state = await billingStatus(); } catch (e) { if (revision === dialogRevision) { line.textContent = e instanceof Error ? e.message : 'Plan unavailable.'; allowed = false; onChange(); } return; }
      if (revision !== dialogRevision || account !== userId) return;
      shownTokens = -1; apply();
    },
    recompute: apply,
    async beforeSpend() { if (!freeLine && always.checked && state && !state.auto_spend) await accountRequest('billing', { action: 'auto-spend', enabled: true }); },
    /** Nothing will be charged (e.g. notes already exist for this bottle): no consent, no upsell. null restores the real cost. */
    free(lineText) {
      freeLine = lineText;
      if (!lineText) { void gate.refresh(); return; }
      allowed = true; needsConsent = false; line.textContent = lineText; link.hidden = true;
      (once.parentElement as HTMLElement).hidden = (always.parentElement as HTMLElement).hidden = true;
      onChange();
    },
  };
  idleHook = onChange;
  void gate.refresh();
  return gate;
}

// ── Linking ───────────────────────────────────────────────────────────
function signIn() {
  openDialog(`<p class="wl-kicker">YOUR WINES. ONE ACCOUNT.</p><h2>Link your account.</h2>
    <ol class="wl-link-steps"><li>Open the link page in your phone’s browser.</li><li>Continue with Google to get a code.</li><li>Enter that code here to open your private Winebrary.</li></ol>
    <a class="wl-primary" href="${ACCOUNT_PAGE}" target="_blank" rel="noopener noreferrer">Open link page ↗</a>
    <p class="wl-muted small">${esc(ACCOUNT_PAGE)}</p>
    <form id="wl-login"><label>Link code<input id="wl-link-code" name="code" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX"></label>
    <button class="wl-primary" type="submit">Link this device</button></form><p class="wl-muted small">Codes last 10 minutes and work once. The catalog and your own notes are free; Pro adds more AI help.</p>`);
  const form = dialog.querySelector<HTMLFormElement>('#wl-login')!;
  const code = form.querySelector<HTMLInputElement>('[name=code]')!;
  code.addEventListener('blur', () => { code.value = formatLinkCode(code.value); });
  form.addEventListener('submit', e => { e.preventDefault(); void run(async () => { await redeemLinkCode(code.value); dialog.close(); }); });
}

// ── Library ───────────────────────────────────────────────────────────
async function refresh() {
  const epoch = ++generation;
  if (!userId) { items = []; render(); return; }
  loading = true; notice = ''; render();
  try {
    const result = await wb('list');
    if (epoch !== generation) return;
    items = result.items;
    if (items.length === 500) notice = 'Showing your 500 most recent wines.';
    if (userId) void saveLibraryCache(userId, items);
  } catch (e) { if (epoch === generation) notice = e instanceof Error ? e.message : 'Could not load your Winebrary.'; }
  finally { if (epoch === generation) { loading = false; render(); libraryChanged(); } }
}
function render() {
  const visible = items.filter(w => `${w.wine_name} ${w.producer} ${w.vintage} ${w.region} ${w.metadata?.grape} ${w.metadata?.country}`.toLowerCase().includes(search.toLowerCase()));
  const count = document.getElementById('home-library'); if (count) count.textContent = userId ? String(items.length) : '—';
  root.innerHTML = `<div class="wl-section-heading"><div><p class="wl-kicker">YOUR WINES. YOUR NOTES.</p><h2>Your Winebrary<span>.</span></h2></div><div class="wl-heading-actions"><button class="wl-outline" id="wl-list">Upload a wine list ✦</button><button class="wl-primary" id="wl-add">＋ Add a wine</button></div></div>
    <div class="wl-library-toolbar"><p class="wl-muted">${userId ? `${items.length} saved ${items.length === 1 ? 'wine' : 'wines'} · Private to your account` : 'Save bottles you love, add each vintage, keep your notes and photos.'}</p>${userId ? `<label class="wl-search-label"><span class="sr-only">Search your wines</span><input id="wl-search" type="search" value="${esc(search)}" placeholder="Search your wines…"></label><button id="wl-refresh" class="wl-text-button">Refresh</button>` : ''}</div>
    ${notice ? `<p role="status" class="wl-notice">${esc(notice)} <button id="wl-retry" class="wl-text-button">Retry</button></p>` : ''}
    ${loading ? '<p class="wl-empty" role="status">Opening your Winebrary…</p>' : !userId ? `<div class="wl-empty wl-welcome"><span class="wl-lens-mark" aria-hidden="true">◎</span><h3>Good taste has a memory.</h3><p>Link your wineLENS account to save wines, notes and bottle photos, and see them on your glasses.</p><button id="wl-start" class="wl-primary">Link my account ↗</button></div>` : visible.length ? `<div class="wl-library-grid">${visible.map(card).join('')}</div>` : `<div class="wl-empty"><h3>${search ? 'No bottles found.' : 'Your first bottle starts here.'}</h3><p>${search ? 'Try a different name, region or year.' : 'Add a wine, scan a label, upload a wine list, or save one from the Wines catalog.'}</p><button class="wl-primary" id="wl-first">Add a wine ↗</button></div>`}`;
  root.querySelector('#wl-add')!.addEventListener('click', () => requireAccount(() => editWine()));
  root.querySelector('#wl-list')!.addEventListener('click', () => requireAccount(() => wineList.open()));
  root.querySelector('#wl-first')?.addEventListener('click', () => editWine());
  root.querySelector('#wl-start')?.addEventListener('click', signIn);
  root.querySelector('#wl-retry')?.addEventListener('click', refresh);
  root.querySelector('#wl-refresh')?.addEventListener('click', refresh);
  root.querySelectorAll<HTMLImageElement>('.wl-bottle-stage img').forEach(img => img.addEventListener('error', () => {
    const placeholder = document.createElement('span'); placeholder.className = 'wl-photo-placeholder'; placeholder.textContent = 'PHOTO UNAVAILABLE'; img.replaceWith(placeholder);
  }));
  root.querySelector<HTMLInputElement>('#wl-search')?.addEventListener('input', e => {
    search = (e.target as HTMLInputElement).value; render();
    root.querySelector<HTMLInputElement>('#wl-search')!.focus();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-wine]').forEach(b => b.addEventListener('click', () => detail(items.find(w => w.id === b.dataset.wine)!)));
  document.getElementById('wl-account')!.textContent = userId ? 'My account ↗' : 'Link account ↗';
}
/** Your own bottle photo, else the catalog photograph of the wine it was saved from. */
function photoOf(w: LibraryWine): { url: string; own: boolean } | null {
  if (w.image_url) return { url: w.image_url, own: true };
  const url = catalogPhotoUrl(import.meta.env.BASE_URL || './', w.wine_id);
  return url ? { url, own: false } : null;
}
function card(w: LibraryWine): string {
  const photo = photoOf(w);
  const notes = libraryNotes(w);
  const tag = notes.source === 'generated' ? 'wineLENS notes' : notes.source === 'catalog' ? 'Catalog notes' : notes.source === 'scan' ? 'Scan draft' : notes.source ? 'Your notes' : 'No notes yet';
  return `<article class="wl-bottle-card"><button class="wl-bottle-open" data-wine="${esc(w.id)}"><div class="wl-bottle-stage">${photo ? `<img src="${esc(photo.url)}" alt="${esc(w.wine_name)} bottle${photo.own ? '' : ' (catalog photograph)'}" loading="lazy">` : '<span class="wl-photo-placeholder">PHOTO<br>TO COME<span>＋</span></span>'}<span class="wl-vintage">${esc(vintageLabel(w))}</span></div><div class="wl-bottle-copy"><p class="wl-kicker">${esc(styleOf(w))} · ${esc(w.region || w.metadata?.country || 'YOUR COLLECTION')}</p><h3>${esc(w.wine_name)}</h3><p>${esc(w.producer || w.metadata?.grape || 'Explore this bottle')} <span>↗</span></p><small>${esc(tag)}${w.metadata?.image_source === 'generated' ? ' · Studio image' : photo && !photo.own ? ' · Catalog photo' : ''}</small></div></button></article>`;
}

// ── Add / edit ────────────────────────────────────────────────────────
function editWine(wine?: Partial<LibraryWine>, newVintage = false) {
  const editing = !!wine?.id && !newVintage;
  const vintageState = newVintage ? 'year' : wine?.metadata?.vintage_state || (wine?.vintage ? 'year' : 'unknown');
  const originalNotes = newVintage ? '' : wine?.notes ?? '', originalSource = newVintage ? undefined : wine?.metadata?.notes_source;
  const field = (name: string, label: string, value: unknown = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  openDialog(`<p class="wl-kicker">${editing ? 'YOUR COLLECTION' : 'MAKE ROOM FOR SOMETHING GOOD'}</p><h2>${editing ? 'Edit this wine.' : newVintage ? 'Another year. New story.' : 'Add a wine.'}</h2>
    ${!editing && !newVintage && !wine?.wine_name ? '<div class="wl-choice"><button id="wl-scan-label" class="wl-outline" type="button">Scan the label ✦</button><button id="wl-add-list" class="wl-text-button" type="button">Upload a wine list ✦</button><span class="wl-muted small">or fill in what you know. Manual entry is always free.</span></div>' : ''}<form id="wl-wine-form"><div class="wl-form-grid">${field('wine_name', 'Wine name', wine?.wine_name, 'required maxlength="300"')}${field('producer', 'Producer', wine?.producer, 'maxlength="200"')}
    <label>Vintage<select name="vintage_state" aria-label="Vintage"><option value="year" ${vintageState === 'year' ? 'selected' : ''}>Known year</option><option value="non_vintage" ${vintageState === 'non_vintage' ? 'selected' : ''}>Non-vintage</option><option value="unknown" ${vintageState === 'unknown' ? 'selected' : ''}>I don’t know yet</option></select></label>
    ${field('vintage', 'Year', newVintage ? '' : wine?.vintage, 'type="number" min="1800" max="' + (new Date().getFullYear() + 1) + '" step="1"')}
    ${field('region', 'Region', wine?.region, 'maxlength="200"')}${field('country', 'Country', wine?.metadata?.country, 'maxlength="100"')}${field('grape', 'Grape', wine?.metadata?.grape, 'maxlength="200"')}
    <label>Wine style<select name="color" aria-label="Wine style">${['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert', 'Unknown'].map(c => `<option value="${c}" ${c === (wine?.metadata?.color || 'Red') ? 'selected' : ''}>${c === 'Rose' ? 'Rosé' : c === 'Unknown' ? 'Not sure' : c}</option>`).join('')}</select></label></div>
    <label>Your tasting notes<textarea name="notes" maxlength="2000" rows="4" placeholder="What made this bottle memorable? Leave empty to use catalog notes, or draft them later.">${esc(originalNotes)}</textarea></label>
    <p class="wl-muted small">${newVintage ? 'This creates a separate entry. The previous year keeps its own notes and photo.' : originalSource === 'scan' ? 'The notes above are a draft from the label. Edit them freely.' : 'Save now. You can add a bottle photo, draft tasting notes or a studio image next.'}</p>
    <button class="wl-primary" type="submit">${editing ? 'Save changes' : 'Save to Winebrary'} ↗</button></form>`);
  dialog.querySelector('#wl-scan-label')?.addEventListener('click', () => scanLabel());
  dialog.querySelector('#wl-add-list')?.addEventListener('click', () => wineList.open());
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const state = form.querySelector<HTMLSelectElement>('[name=vintage_state]')!;
  const year = form.querySelector<HTMLInputElement>('[name=vintage]')!;
  const syncYear = () => { year.disabled = state.value !== 'year'; year.required = state.value === 'year'; };
  syncYear(); state.addEventListener('change', syncYear);
  form.addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    const account = userId;
    const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const notes = (values.notes || '').trim();
    const notes_source = !notes ? undefined : notes === originalNotes.trim() && originalSource ? originalSource : 'user';
    const result = editing
      ? await wb('update', { ...values, id: wine!.id, ...(notes_source ? { notes_source } : {}) })
      : await wb('add', { ...values, wine_id: wine?.wine_id || null, ...(notes_source ? { notes_source } : {}) });
    if (account !== userId) return;
    setBusy(false); detail(result.item);
    if (result.image_detached) feedback('The name, producer or year changed, so the old bottle photo was detached. Add a photo of this bottle.');
    await refresh();
  }); });
}

// ── Label scan (paid help) ────────────────────────────────────────────
function scanLabel() {
  const account = userId, ids = requestIds();
  openDialog(`<p class="wl-kicker">LABEL SCAN ✦</p><h2>Start with the label.</h2><p class="wl-muted">Take or choose a clear photo of the front label. wineLENS fills in the details and a draft note. You check every field before saving.</p>
    <label class="wl-upload">Pick or take a label photo<input id="wl-label-file" type="file" accept="image/png,image/jpeg,image/webp" capture="environment"></label><p class="wl-muted small">PNG, JPEG or WebP · up to 2 MB · sent to OpenAI to read the label.</p>
    ${costHTML}<button id="wl-scan-submit" class="wl-primary" disabled>Scan and review ↗</button><button id="wl-scan-manual" class="wl-text-button">Enter manually instead</button>`);
  const revision = dialogRevision;
  let photo = '';
  const send = dialog.querySelector<HTMLButtonElement>('#wl-scan-submit')!;
  const gate = costGate('label_scan', () => { send.disabled = busy || !photo || !gate.ready(); });
  const file = dialog.querySelector<HTMLInputElement>('#wl-label-file')!;
  dialog.querySelector('#wl-scan-manual')!.addEventListener('click', () => editWine());
  file.addEventListener('change', () => {
    photo = ''; send.disabled = true; const selected = file.files?.[0]; if (!selected) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 2 * 1024 * 1024) { feedback('Choose a PNG, JPEG or WebP under 2 MB.'); return; }
    const reader = new FileReader(); reader.onload = () => { if (revision !== dialogRevision) return; photo = String(reader.result); feedback('Photo ready.'); send.disabled = !gate.ready(); }; reader.readAsDataURL(selected);
  });
  send.addEventListener('click', () => void run(async () => {
    await gate.beforeSpend();
    let result;
    try { result = await accountRequest('wine-scan', { photo, request_id: ids.current, spend_consent: gate.consent() }); ids.settle(); }
    catch (e) { ids.settle(e); void gate.refresh(); throw e; }
    if (account !== userId || revision !== dialogRevision) return;
    setBusy(false);
    editWine({ wine_name: result.wine_name, producer: result.producer, vintage: typeof result.vintage === 'number' ? result.vintage : null, region: result.region,
      notes: String(result.draft_tasting_note || '').replace(/^Draft\s*[—:-]?\s*/i, ''),
      metadata: { vintage_state: result.vintage === 'non-vintage' ? 'non_vintage' : typeof result.vintage === 'number' ? 'year' : 'unknown', country: result.country, grape: result.grape, color: result.color, notes_source: 'scan' } });
    feedback(`Check every field before saving. Label confidence: ${Math.round(result.confidence * 100)}%.`);
  }));
}

// ── Wine page ─────────────────────────────────────────────────────────
function detail(wine: LibraryWine) {
  const notes = libraryNotes(wine), twin = lookupWineById(wine.wine_id), photo = photoOf(wine);
  const hasOwn = !!wine.notes?.trim();
  openDialog(`<p class="wl-kicker">${esc(vintageLabel(wine))} · ${esc(styleOf(wine))}${wine.metadata?.grape ? ' · ' + esc(wine.metadata.grape) : ''}</p><h2>${esc(wine.wine_name)}</h2><p class="wl-muted">${esc([wine.producer, placeLabel(wine.region, wine.metadata?.country), placeLabel(wine.region, wine.metadata?.country).includes(wine.metadata?.country || '\u0000') ? '' : wine.metadata?.country].filter(Boolean).join(' · '))}</p>
    <div class="wl-detail-grid"><div class="wl-detail-photo">${photo ? `<img src="${esc(photo.url)}" alt="${esc(wine.wine_name)} bottle${photo.own ? '' : ' (catalog photograph)'}">${photo.own ? '' : '<span class="wl-muted small">Catalog photograph · label year may differ</span>'}` : '<span class="wl-photo-placeholder">YOUR BOTTLE<br>IN FOCUS<span>＋</span></span>'}<button id="wl-photo" class="wl-outline">${wine.image_url ? 'Change bottle image' : 'Add bottle photo'} ↗</button></div>
    <section class="wl-notes-block" aria-labelledby="wl-notes-title"><div class="wl-notes-head"><p class="wl-kicker" id="wl-notes-title">TASTING NOTES</p>${notes.source ? `<span class="wl-source wl-source-${notes.source}">${esc(SOURCE_LABEL[notes.source])}</span>` : ''}</div>
    ${notes.source ? notesHTML(notes.sections, notes.text) : '<p class="wl-muted">No notes yet. Write your own, or get wineLENS notes for this bottle and vintage.</p>'}
    <div class="wl-notes-actions">${notes.source === 'generated' ? '' : '<button id="wl-draft-notes" class="wl-primary">✦ Get tasting notes</button>'}<button id="wl-edit" class="wl-outline">${hasOwn ? 'Edit wine & notes' : 'Write my own notes'}</button></div>
    ${twin && hasOwn ? '<button id="wl-catalog-notes" class="wl-text-button">Read the catalog notes for this wine</button>' : ''}</section></div>
    <div class="wl-hud-label"><span>EVEN G2 · DISPLAY PREVIEW</span><span>576 × 288</span></div><canvas id="wl-g2-preview" class="wl-hud-canvas" role="img" aria-label="Preview of this wine on the Even G2 display"></canvas>
    <p class="wl-muted small">Layout preview. Glasses use the built-in G2 typeface and green display. Your Winebrary is also under My Winebrary on the glasses.</p>
    <div class="wl-detail-actions"><button id="wl-send" class="wl-primary">Show on glasses ↗</button><button id="wl-vintage" class="wl-outline">＋ Add another vintage</button><button id="wl-remove" class="wl-text-button">Remove from Winebrary</button></div>`);
  void drawGlassesPreview(wine, dialog.querySelector<HTMLCanvasElement>('#wl-g2-preview')!);
  dialog.querySelector('#wl-edit')!.addEventListener('click', () => editWine(wine));
  dialog.querySelector('#wl-vintage')!.addEventListener('click', () => editWine(wine, true));
  dialog.querySelector('#wl-photo')!.addEventListener('click', () => photoStudio(wine));
  dialog.querySelector('#wl-draft-notes')?.addEventListener('click', () => notesStudio(wine));
  dialog.querySelector('#wl-catalog-notes')?.addEventListener('click', () => {
    const block = dialog.querySelector('.wl-notes-block')!, sections = libraryNotes({ ...wine, notes: null });
    block.insertAdjacentHTML('beforeend', `<div class="wl-notes-twin"><p class="wl-source wl-source-catalog">${esc(SOURCE_LABEL.catalog)}</p>${notesHTML(sections.sections, sections.text)}</div>`);
    dialog.querySelector('#wl-catalog-notes')!.remove();
  });
  dialog.querySelector('#wl-send')!.addEventListener('click', () => run(async () => {
    if (!canShowWine()) throw new Error('Open wineLENS in Even Hub and connect your G2 glasses first.');
    await showWineOnGlasses(wine); feedback('Sent to your glasses.');
  }));
  dialog.querySelector('#wl-remove')!.addEventListener('click', () => {
    openDialog(`<h2>Remove this wine?</h2><p>${esc(wine.wine_name)} · ${esc(vintageLabel(wine))}</p><p class="wl-muted">It will be removed from your account with its photos and notes. Your other vintages stay in Winebrary.</p><button id="wl-confirm-remove" class="wl-primary">Remove wine</button><button id="wl-keep" class="wl-outline">Keep wine</button>`);
    dialog.querySelector('#wl-keep')!.addEventListener('click', () => detail(wine));
    dialog.querySelector('#wl-confirm-remove')!.addEventListener('click', () => run(async () => { await wb('remove', { id: wine.id }); dialog.close(); await refresh(); }));
  });
}

// ── Tasting notes (paid help, drafted once per bottle + vintage) ──────
function notesStudio(wine: LibraryWine) {
  const account = userId, ids = requestIds(), own = wine.notes?.trim() && wine.metadata?.notes_source !== 'generated';
  openDialog(`<p class="wl-kicker">TASTING NOTES ✦</p><h2>The expected profile.<br>In the house style.</h2>
    <p class="wl-muted">wineLENS drafts look, nose, palate, finish and a short story for <strong>${esc(wine.wine_name)}${wine.vintage ? ' ' + wine.vintage : ''}</strong> from what is known about its producer, place, grape and vintage. It is not a tasting. You read it before anything is saved.</p>
    <p class="wl-muted small">Notes are drafted once per bottle and vintage. If anyone has already drafted this one, you get them free.</p>
    ${own ? '<p class="wl-notice">Saving the draft replaces the notes you wrote. Copy anything you want to keep first.</p>' : ''}
    ${costHTML}<button id="wl-notes-go" class="wl-primary" disabled>Get tasting notes ✦</button><div id="wl-notes-review" class="wl-notes-review"></div>`);
  const revision = dialogRevision, go = dialog.querySelector<HTMLButtonElement>('#wl-notes-go')!;
  const gate = costGate('tasting_notes', () => { go.disabled = busy || !gate.ready(); });
  // Free look-up first: already drafted for this bottle + vintage means no charge and no consent.
  void accountRequest('wine-notes', { collection_id: wine.id, check: true }).then(r => {
    if (revision === dialogRevision && r.available) gate.free('Already in wineLENS for this bottle and vintage · free');
  }).catch(() => {});
  go.addEventListener('click', () => void run(async () => {
    feedback('Getting notes… this usually takes a few seconds.');
    await gate.beforeSpend();
    let result: { draft: NotesDraft; shared?: boolean };
    try { result = await accountRequest('wine-notes', { collection_id: wine.id, request_id: ids.current, spend_consent: gate.consent() }); ids.settle(); }
    catch (e) { ids.settle(e); gate.free(null); throw e; }
    if (account !== userId || revision !== dialogRevision) return;
    const draft = result.draft;
    dialog.querySelector('#wl-notes-review')!.innerHTML = `<p class="wl-source wl-source-generated">${esc(SOURCE_LABEL.generated)}${draft.confidence < 0.5 ? ' · less-known wine: read as a style guide' : ''}</p>${notesHTML(parseSections(draft.text), draft.text)}
      <div class="wl-notes-actions"><button id="wl-notes-save" class="wl-primary">Save to my notes ↗</button><button id="wl-notes-discard" class="wl-text-button">Discard</button></div>`;
    feedback(result.shared ? 'These notes were already in wineLENS for this bottle and vintage. Nothing was charged.' : 'Read the draft, then save or discard it. This bottle and vintage now has notes for anyone who asks.');
    dialog.querySelector('#wl-notes-discard')!.addEventListener('click', () => detail(wine));
    dialog.querySelector('#wl-notes-save')!.addEventListener('click', () => run(async () => {
      const saved = await wb('set-notes', { id: wine.id, notes: draft.text, notes_source: 'generated' });
      if (account !== userId) return;
      setBusy(false); detail(saved.item); await refresh();
    }));
    gate.free('Already in wineLENS for this bottle and vintage · free');
  }));
}

// ── Bottle Studio (photo is free; the studio rendering is paid help) ──
function photoStudio(wine: LibraryWine) {
  let draft: ImageDraft | null = null, original: ImageDraft | null = null;
  const account = userId, ids = requestIds();
  openDialog(`<p class="wl-kicker">BOTTLE STUDIO</p><h2>The real thing.<br>In its best light.</h2><p class="wl-muted">1 · Add a clear photo of this exact bottle and vintage. Using your own photo is free.<br>2 · Optionally, turn it into a clean studio image ✦. It keeps your label as photographed; check it before using it.</p>
    <label class="wl-upload">＋ Choose a bottle photo<input id="wl-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="wl-muted small">PNG, JPEG or WebP · under 2 MB. Only upload photos you can use. A studio image sends this photo to OpenAI.</p>
    <div id="wl-image-review" class="wl-image-review"></div>
    <div class="wl-studio-step"><p class="wl-kicker">STUDIO IMAGE ✦</p>${costHTML}</div>
    <div class="wl-studio-actions"><button id="wl-render" class="wl-primary" disabled>Create studio image ✦</button><button id="wl-approve" class="wl-outline" hidden>Use this image</button><button id="wl-original" class="wl-text-button" hidden>Back to my photo</button></div>`);
  const revision = dialogRevision, renderButton = dialog.querySelector<HTMLButtonElement>('#wl-render')!;
  const gate = costGate('studio_render', () => { renderButton.disabled = busy || !original || !gate.ready(); });
  const preview = () => {
    dialog.querySelector('#wl-image-review')!.innerHTML = `<img src="${esc(draft!.url)}" alt="Bottle image for review"><p class="wl-kicker">${draft!.source === 'generated' ? 'STUDIO IMAGE · CHECK LABEL & VINTAGE' : 'YOUR PHOTO'}</p>`;
    dialog.querySelector<HTMLButtonElement>('#wl-approve')!.hidden = false;
    dialog.querySelector<HTMLButtonElement>('#wl-original')!.hidden = draft!.source !== 'generated';
  };
  dialog.querySelector<HTMLInputElement>('#wl-file')!.addEventListener('change', e => run(async () => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw new Error('Choose a photo under 2 MB.');
    feedback('Uploading your photo…');
    const photo = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await wb('upload-photo', { id: wine.id, photo });
    if (account !== userId || revision !== dialogRevision) return;
    draft = original = result.draft; preview(); feedback('Photo ready. Use it as it is, or create a studio image.');
  }));
  renderButton.addEventListener('click', () => run(async () => {
    if (!original) return;
    feedback('Lighting your bottle… this can take up to two minutes.');
    await gate.beforeSpend();
    let result: { draft: ImageDraft };
    try { result = await accountRequest('bottle-render', { collection_id: wine.id, reference_path: original.path, request_id: ids.current, spend_consent: gate.consent() }); ids.settle(); }
    catch (e) { ids.settle(e); void gate.refresh(); throw e; }
    if (account !== userId || revision !== dialogRevision) return;
    draft = result.draft; preview(); void gate.refresh();
    feedback('Compare the label and vintage with your photo before using this image.');
  }));
  dialog.querySelector('#wl-original')!.addEventListener('click', () => { draft = original; preview(); feedback('Your photo is selected.'); });
  dialog.querySelector('#wl-approve')!.addEventListener('click', () => run(async () => {
    if (!draft) return;
    const result = await wb('attach-image', { id: wine.id, image_path: draft.path, image_source: draft.source });
    if (account !== userId) return;
    setBusy(false); detail(result.item); await refresh();
  }));
}

// ── Account ───────────────────────────────────────────────────────────
function accountDialog() {
  const pending = unsyncedEvents().length;
  openDialog(`<p class="wl-kicker">YOUR WINELENS ACCOUNT</p><h2>A taste of your own.</h2><p class="wl-muted">${esc(accountEmail)}<br>Your Winebrary and study progress are private. Unlinking removes them from this device.</p>${pending ? `<p class="wl-notice" role="status">${pending} study ${pending === 1 ? 'review has' : 'reviews have'} not reached your account yet and will be removed from this device if you unlink now.</p>` : ''}
    <div class="wl-plan-chip" role="status"><strong id="wl-plan">Checking plan…</strong><span id="wl-plan-detail"></span></div>
    <a class="wl-outline" href="${ACCOUNT_PAGE}" target="_blank" rel="noopener noreferrer">Plan, tokens & devices ↗</a><button id="wl-review" class="wl-outline" hidden>Review catalog suggestions</button><button id="wl-signout" class="wl-text-button">Unlink this device</button>`);
  dialog.querySelector('#wl-review')!.addEventListener('click', catalogReview);
  const revision = dialogRevision;
  void billingStatus().then(state => {
    if (revision !== dialogRevision) return;
    dialog.querySelector('#wl-plan')!.textContent = `${state.plan === 'owner' ? 'wineLENS owner' : state.pro ? 'wineLENS Pro' : 'Free'} · ${state.tokens} ${state.tokens === 1 ? 'token' : 'tokens'}`;
    dialog.querySelector<HTMLElement>('#wl-review')!.hidden = state.plan !== 'owner';
    const card = state.rate_card?.features || {};
    dialog.querySelector('#wl-plan-detail')!.textContent = Object.entries(state.allowances).map(([k, a]) => `${(card as Record<string, { label: string }>)[k]?.label || k}: ${a!.remaining}/${a!.limit} left`).join(' · ');
  }).catch(() => { if (revision === dialogRevision) dialog.querySelector('#wl-plan')!.textContent = 'Plan and tokens unavailable right now.'; });
  dialog.querySelector('#wl-signout')!.addEventListener('click', () => run(async () => { const warning = await unlinkDevice(); dialog.close(); if (warning) { notice = warning; render(); } }));
}

// ── Catalog suggestions (owner only; the API checks too) ──────────────
interface Suggestion { wine_key: string; seen: number; wine: { producer?: string; wine_name?: string; region?: string; country?: string; grape?: string; color?: string }; place: { status: string; region: string; country: string | null } }
function catalogReview() {
  openDialog(`<p class="wl-kicker">OWNER · CATALOG</p><h2>Suggested wines.</h2>
    <p class="wl-muted">New wines people saved from wine lists, most-saved first. Approving adds the wine to the wineLENS catalog table with its source recorded in the ingest history; it reaches the app catalog with the next catalog release.</p>
    <div id="wl-review-list"><p class="wl-muted" role="status">Loading suggestions…</p></div>`);
  const revision = dialogRevision;
  const colors = ['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert', 'Unknown'];
  const field = (name: string, label: string, value: unknown) => `<label>${label}<input data-field="${name}" value="${esc(value ?? '')}" maxlength="300"></label>`;
  const row = (p: Suggestion) => `<li class="wl-list-row wl-review-row" data-key="${esc(p.wine_key)}"><div class="wl-list-copy">
    <strong>${esc([p.wine.producer, p.wine.wine_name].filter(Boolean).join(' · '))}</strong><span class="wl-muted">${esc([p.wine.region, p.wine.country, p.wine.grape].filter(Boolean).join(' · ') || 'No place given')}</span>
    <div class="wl-list-chips"><span class="wl-list-chip ${p.place.status === 'mapped' ? 'wl-list-chip-good' : ''}">${p.place.status === 'mapped' ? 'On the globe · ' + esc(p.place.region) : p.place.status === 'unknown' ? 'Place not on the globe yet' : esc(p.place.region || 'Country only')}</span><span class="wl-list-chip">Saved ${p.seen}×</span></div>
    <div class="wl-list-form wl-form-grid">${field('wine_name', 'Wine name', p.wine.wine_name)}${field('producer', 'Producer', p.wine.producer)}${field('region', 'Region', p.wine.region)}${field('country', 'Country', p.wine.country)}${field('grape', 'Grape', p.wine.grape)}
      <label>Wine style<select data-field="color">${colors.map(c => `<option value="${c}" ${c === (p.wine.color || 'Unknown') ? 'selected' : ''}>${c === 'Rose' ? 'Rosé' : c === 'Unknown' ? 'Not sure' : c}</option>`).join('')}</select></label></div>
    <div class="wl-notes-actions"><button class="wl-primary" data-decide="approved">Add to catalog</button><button class="wl-text-button" data-decide="rejected">Reject</button></div></div></li>`;
  void accountRequest('catalog-review', { action: 'list' }).then((r: { proposals: Suggestion[]; unknown_places: { region: string; country: string | null; wines: number; seen: number }[] }) => {
    if (revision !== dialogRevision) return;
    const box = dialog.querySelector('#wl-review-list')!;
    box.innerHTML = `${r.unknown_places.length ? `<section class="wl-list-group"><h3>Places not on the globe yet <span>${r.unknown_places.length}</span></h3><p class="wl-muted small">Add each to shared/region-aliases.json (then rebuild the wine index) so lists place them automatically.</p><ul class="wl-list-summary">${r.unknown_places.map(p => `<li>${esc(p.region)}${p.country ? ' · ' + esc(p.country) : ''} <span class="wl-muted">· ${p.wines} ${p.wines === 1 ? 'wine' : 'wines'}, saved ${p.seen}×</span></li>`).join('')}</ul></section>` : ''}
      <section class="wl-list-group"><h3>Waiting for review <span>${r.proposals.length}</span></h3>${r.proposals.length ? `<ul>${r.proposals.map(row).join('')}</ul>` : '<p class="wl-muted">Nothing waiting. New wines from wine lists appear here.</p>'}</section>`;
    box.querySelectorAll<HTMLButtonElement>('[data-decide]').forEach(b => b.addEventListener('click', () => void run(async () => {
      const li = b.closest<HTMLElement>('[data-key]')!, value = (n: string) => li.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${n}"]`)!.value.trim();
      const wine = b.dataset.decide === 'approved' ? { wine_name: value('wine_name'), producer: value('producer'), region: value('region'), country: value('country'), grape: value('grape'), color: value('color') } : undefined;
      const result = await accountRequest('catalog-review', { action: 'decide', wine_key: li.dataset.key, decision: b.dataset.decide, ...(wine ? { wine } : {}) });
      if (revision !== dialogRevision) return;
      const list = li.parentElement!; li.remove();
      const left = list.querySelectorAll('[data-key]').length, count = list.closest('section')!.querySelector('h3 span');
      if (count) count.textContent = String(left);
      if (!left) list.outerHTML = '<p class="wl-muted">All reviewed. New wines from wine lists appear here.</p>';
      feedback(result.status === 'approved' ? `Added to the catalog as ${result.catalog_id}.` : 'Rejected. It will not be suggested again.');
    })));
  }).catch(e => { if (revision === dialogRevision) dialog.querySelector('#wl-review-list')!.innerHTML = `<p class="wl-notice">${esc(e instanceof Error ? e.message : 'Suggestions are unavailable.')}</p>`; });
}

export function initWinebrary() {
  auth = accountClient();
  root = document.getElementById('winebrary-content')!;
  // The glasses read the same in-memory collection; an error only counts when nothing loaded.
  setLibrarySource(() => ({ userId, loading, error: items.length ? '' : notice, items }));
  dialog = document.createElement('dialog'); dialog.className = 'wl-dialog'; dialog.setAttribute('aria-label', 'Winebrary'); document.body.append(dialog);
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  wineList = wineListFlow({ dialog, costHTML, openDialog, feedback, run, setBusy, isBusy: () => busy, revision: () => dialogRevision, userId: () => userId, refresh, esc, costGate });
  document.getElementById('wl-account')!.addEventListener('click', () => { if (!userId) signIn(); else accountDialog(); });
  document.querySelectorAll('[data-wl-add]').forEach(el => el.addEventListener('click', () => requireAccount(() => editWine())));
  document.querySelectorAll('[data-open-account]').forEach(el => el.addEventListener('click', () => document.getElementById('wl-account')!.click()));
  document.querySelectorAll('[data-wl-scan]').forEach(el => el.addEventListener('click', () => requireAccount(() => scanLabel())));
  document.querySelectorAll('[data-wl-list]').forEach(el => el.addEventListener('click', () => requireAccount(() => wineList.open())));
  document.querySelectorAll<HTMLElement>('[data-open-tab]').forEach(el => el.addEventListener('click', () => document.querySelector<HTMLButtonElement>(`.tab[data-tab="${el.dataset.openTab}"]`)?.click()));
  document.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-save-library]'); if (!button) return;
    const found = lookupWineById(button.dataset.saveLibrary);
    if (!found) return; // unknown catalog ID: never save it as some other wine
    // Personal notes start empty; the catalog notes still show for this wine via its catalog ID.
    const { title, producer } = splitWineName(found.wine.name);
    requireAccount(() => editWine({ wine_name: title, producer: producer || null, wine_id: found.id, region: found.wine.region, notes: '', metadata: { color: found.type, country: found.country, grape: found.wine.grape, vintage_state: 'unknown' } }));
  });
  let authRevision = 0;
  const applySession = async (session: Session | null) => {
    const revision = ++authRevision;
    const valid = session ? await checkDeviceSession(session) : false;
    if (revision !== authRevision) return;
    const next = valid ? session!.user.id : null;
    if (next === userId) {
      if (!valid && session) { void clearPrivateGlasses().catch(console.error); void clearLibraryCache(); void forgetAccount(session.user.id).catch(console.error); }
      return;
    }
    const previous = userId || (!valid ? session?.user.id : null);
    if (previous) { void clearPrivateGlasses().catch(console.error); void clearLibraryCache(); void forgetAccount(previous).catch(console.error); }
    setStudyAuth(next ? { userId: next, token: linkedAccessToken } : null);
    void useAccount(next).then(() => { if (next) setTimeout(() => void syncStudy(), 0); });
    dialogRevision++;
    userId = next; accountEmail = valid ? session!.user.email || '' : ''; items = []; search = ''; generation++; loading = false;
    dialog.close();
    setBusy(false); render(); setTimeout(() => void refresh(), 0);
  };
  // Supabase callbacks must not await auth operations while its session lock is held.
  auth.auth.onAuthStateChange((_event, session) => { setTimeout(() => void applySession(session), 0); });
  const recheck = () => { void auth.auth.getSession().then(({ data }) => applySession(data.session)); };
  window.addEventListener('online', recheck);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) recheck(); });
  setInterval(() => { if (!document.hidden && userId) recheck(); }, 60000);
  render();
}
