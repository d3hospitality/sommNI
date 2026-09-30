import { createClient } from '@supabase/supabase-js';
import { ACCOUNT_URL, ACCOUNT_PUBLIC_KEY, API_URL } from './account-config';
import { lookupWineById } from './identity';
import { useAccount, forgetAccount, unsyncedEvents } from './study/store';
import { syncStudy, setStudyAuth } from './study/sync';
import { showWineOnGlasses, canShowWine, clearPrivateGlasses, drawGlassesPreview, setLibrarySource, libraryChanged, saveLibraryCache, clearLibraryCache } from './winebrary-glasses';

export interface LibraryWine {
  id: string; wine_name: string; producer: string | null; vintage: number | null;
  region: string | null; notes: string | null; wine_id?: string; image_url?: string;
  metadata: { vintage_state?: string; country?: string; grape?: string; color?: string; image_path?: string; image_source?: string } | null;
}
interface ImageDraft { path: string; url: string; source: 'photograph' | 'generated' }
const auth = createClient(ACCOUNT_URL, ACCOUNT_PUBLIC_KEY);
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
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

export function vintageLabel(wine: LibraryWine): string {
  return wine.vintage ? String(wine.vintage) : wine.metadata?.vintage_state === 'non_vintage' ? 'Non-vintage' : 'Vintage unknown';
}
async function api(path: string, method = 'GET', body?: unknown): Promise<any> {
  const { data: { session } } = await auth.auth.getSession();
  if (!session || session.user.id !== userId) throw new Error('Sign in again to continue.');
  const response = await fetch(API_URL + path, {
    method, headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not complete this action. Try again.');
  return result;
}
function feedback(message: string) {
  const el = document.getElementById('wl-feedback');
  if (el) el.textContent = message;
}
function openDialog(html: string) {
  if (busy) return;
  dialogRevision++;
  dialog.innerHTML = `<button class="wl-close" aria-label="Close dialog">×</button>${html}<p id="wl-feedback" class="wl-feedback" role="status" aria-live="polite"></p>`;
  dialog.querySelector('.wl-close')!.addEventListener('click', () => dialog.close());
  if (!dialog.open) dialog.showModal();
}
function setBusy(value: boolean) {
  busy = value;
  dialog.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = value);
  dialog.setAttribute('aria-busy', String(value));
}
async function run(task: () => Promise<void>) {
  if (busy) return;
  const revision=dialogRevision;
  setBusy(true);
  try { await task(); } catch (error) { if(revision===dialogRevision) feedback(error instanceof Error ? error.message : 'Something went wrong. Try again.'); }
  finally { if(revision===dialogRevision) setBusy(false); }
}
function requireAccount(action: () => void) { if (userId) action(); else signIn(); }
function signIn() {
  openDialog(`<p class="wl-kicker">YOUR WINES. ONE ACCOUNT.</p><h2>Welcome to Winebrary.</h2><p class="wl-muted">Sign in with your existing wineLENS account to keep your bottles and vintages together.</p>
    <button id="wl-google" class="wl-primary">Continue with Google ↗</button>
    <div class="wl-divider">or use your email</div>
    <form id="wl-login"><label>Email<input type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
    <label>Password<input type="password" name="password" required autocomplete="current-password" minlength="6"></label><button class="wl-primary" type="submit">Sign in</button></form>
    <button id="wl-magic" class="wl-text-button">Email me a sign-in link</button><p class="wl-muted small">New here? An email link can create your account.</p>`);
  dialog.querySelector('#wl-google')!.addEventListener('click', () => run(async () => {
    const { error } = await auth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: new URL('./', location.href).href } });
    if (error) throw error;
  }));
  const form = dialog.querySelector<HTMLFormElement>('#wl-login')!;
  form.addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    const values = new FormData(form);
    const { error } = await auth.auth.signInWithPassword({ email: String(values.get('email')), password: String(values.get('password')) });
    if (error) throw error;
    dialog.close();
  }); });
  dialog.querySelector('#wl-magic')!.addEventListener('click', () => run(async () => {
    const email = form.querySelector<HTMLInputElement>('[name=email]')!;
    if (!email.reportValidity()) return;
    const { error } = await auth.auth.signInWithOtp({ email: email.value, options: { emailRedirectTo: new URL('./', location.href).href } });
    if (error) throw error;
    feedback('Check your email for a sign-in link. Open it on this device.');
  }));
}
async function refresh() {
  const epoch = ++generation;
  if (!userId) { items = []; render(); return; }
  loading = true; notice = ''; render();
  try {
    const result = await api('/api/collection?limit=500');
    if (epoch !== generation) return;
    items = result.items;
    if (items.length === 500) notice = 'Showing your 500 most recent wines.';
    if (userId) void saveLibraryCache(userId, items);
  } catch (e) { if (epoch === generation) notice = e instanceof Error ? e.message : 'Could not load your Winebrary.'; }
  finally { if (epoch === generation) { loading = false; render(); libraryChanged(); } }
}
function render() {
  const visible = items.filter(w => `${w.wine_name} ${w.producer} ${w.vintage} ${w.region} ${w.metadata?.grape}`.toLowerCase().includes(search.toLowerCase()));
  root.innerHTML = `<div class="wl-section-heading"><div><p class="wl-kicker">COLLECT A LITTLE CURIOSITY</p><h2>Your Winebrary<span>.</span></h2></div><button class="wl-primary" id="wl-add">＋ Add a wine</button></div>
    <div class="wl-library-toolbar"><p class="wl-muted">${userId ? `${items.length} saved ${items.length === 1 ? 'wine' : 'wines'} · Private to your account` : 'A home for every bottle, every vintage, every discovery.'}</p>${userId ? `<label class="wl-search-label"><span class="sr-only">Search your wines</span><input id="wl-search" type="search" value="${esc(search)}" placeholder="Search your wines…"></label><button id="wl-refresh" class="wl-text-button">Refresh</button>` : ''}</div>
    ${notice ? `<p role="status" class="wl-notice">${esc(notice)} <button id="wl-retry" class="wl-text-button">Retry</button></p>` : ''}
    ${loading ? '<p class="wl-empty" role="status">Opening your Winebrary…</p>' : !userId ? `<div class="wl-empty wl-welcome"><span class="wl-lens-mark" aria-hidden="true">◎</span><h3>Good taste has a memory.</h3><p>Save a wine you love. Add another year. Make it yours.</p><button id="wl-start" class="wl-primary">Open my Winebrary ↗</button></div>` : visible.length ? `<div class="wl-library-grid">${visible.map(w => `<article class="wl-bottle-card"><button class="wl-bottle-open" data-wine="${esc(w.id)}"><div class="wl-bottle-stage">${w.image_url ? `<img src="${esc(w.image_url)}" alt="${esc(w.wine_name)} bottle" loading="lazy">` : '<span class="wl-photo-placeholder">PHOTO<br>TO COME<span>＋</span></span>'}<span class="wl-vintage">${esc(vintageLabel(w))}</span></div><div class="wl-bottle-copy"><p class="wl-kicker">${esc(w.metadata?.color || 'WINE')} · ${esc(w.region || 'YOUR COLLECTION')}</p><h3>${esc(w.wine_name)}</h3><p>${esc(w.producer || w.metadata?.grape || 'Explore this bottle')} <span>↗</span></p>${w.metadata?.image_source === 'generated' ? '<small>Studio rendering · reviewed by you</small>' : ''}</div></button></article>`).join('')}</div>` : `<div class="wl-empty"><h3>${search ? 'No bottles found.' : 'Your first bottle starts here.'}</h3><p>${search ? 'Try a different name, region or year.' : 'Add a new wine or bring a favorite over from the catalog.'}</p><button class="wl-primary" id="wl-first">Add a wine ↗</button></div>`}`;
  root.querySelector('#wl-add')!.addEventListener('click', () => requireAccount(() => editWine()));
  root.querySelector('#wl-first')?.addEventListener('click', () => editWine());
  root.querySelector('#wl-start')?.addEventListener('click', signIn);
  root.querySelector('#wl-retry')?.addEventListener('click', refresh);
  root.querySelector('#wl-refresh')?.addEventListener('click', refresh);
  root.querySelectorAll<HTMLImageElement>('.wl-bottle-stage img').forEach(img => img.addEventListener('error', () => {
    const placeholder=document.createElement('span'); placeholder.className='wl-photo-placeholder'; placeholder.textContent='PHOTO UNAVAILABLE'; img.replaceWith(placeholder);
  }));
  root.querySelector<HTMLInputElement>('#wl-search')?.addEventListener('input', e => {
    search = (e.target as HTMLInputElement).value; render();
    const input = root.querySelector<HTMLInputElement>('#wl-search')!; input.focus();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-wine]').forEach(b => b.addEventListener('click', () => detail(items.find(w => w.id === b.dataset.wine)!)));
  const accountButton = document.getElementById('wl-account')!;
  accountButton.textContent = userId ? 'My account ↗' : 'Sign in ↗';
}
function editWine(wine?: Partial<LibraryWine>, newVintage = false) {
  const editing = !!wine?.id && !newVintage;
  const vintageState = newVintage ? 'year' : wine?.metadata?.vintage_state || (wine?.vintage ? 'year' : 'unknown');
  const field = (name: string, label: string, value: unknown = '', extra = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${extra}></label>`;
  openDialog(`<p class="wl-kicker">${editing ? 'YOUR COLLECTION' : 'MAKE ROOM FOR SOMETHING GOOD'}</p><h2>${editing ? 'Edit this wine.' : newVintage ? 'Another year. New story.' : 'Add a wine.'}</h2>
    <form id="wl-wine-form"><div class="wl-form-grid">${field('wine_name','Wine name',wine?.wine_name,'required maxlength="300"')}${field('producer','Producer',wine?.producer,'maxlength="200"')}
    <label>Vintage<select name="vintage_state" aria-label="Vintage"><option value="year" ${vintageState==='year'?'selected':''}>Known year</option><option value="non_vintage" ${vintageState==='non_vintage'?'selected':''}>Non-vintage</option><option value="unknown" ${vintageState==='unknown'?'selected':''}>I don’t know yet</option></select></label>
    ${field('vintage','Year',newVintage ? '' : wine?.vintage,'type="number" min="1800" max="'+(new Date().getFullYear()+1)+'" step="1"')}
    ${field('region','Region',wine?.region,'maxlength="200"')}${field('country','Country',wine?.metadata?.country,'maxlength="100"')}${field('grape','Grape',wine?.metadata?.grape,'maxlength="200"')}
    <label>Wine style<select name="color" aria-label="Wine style">${['Red','White','Sparkling','Rose','Orange','Dessert'].map(c=>`<option ${c===wine?.metadata?.color?'selected':''}>${c}</option>`).join('')}</select></label></div>
    <label>Your tasting notes<textarea name="notes" maxlength="2000" rows="3" placeholder="What made this bottle memorable?">${esc(newVintage ? '' : wine?.notes)}</textarea></label>
    <p class="wl-muted small">${newVintage ? 'This creates a separate entry. The previous year keeps its own notes and photo.' : 'Save now. You can add a bottle photo or studio rendering next.'}</p>
    <button class="wl-primary" type="submit">${editing ? 'Save changes' : 'Save to Winebrary'} ↗</button></form>`);
  const form = dialog.querySelector<HTMLFormElement>('form')!;
  const state = form.querySelector<HTMLSelectElement>('[name=vintage_state]')!;
  const year = form.querySelector<HTMLInputElement>('[name=vintage]')!;
  const syncYear = () => { year.disabled = state.value !== 'year'; year.required = state.value === 'year'; };
  syncYear(); state.addEventListener('change', syncYear);
  form.addEventListener('submit', e => { e.preventDefault(); void run(async () => {
    const account = userId;
    const values = Object.fromEntries(new FormData(form));
    const result = await api('/api/collection', editing ? 'PATCH' : 'POST', { ...values, ...(editing ? { id: wine!.id } : { wine_id: wine?.wine_id || null }) });
    if (account !== userId) return;
    setBusy(false); detail(result.item); await refresh();
  }); });
}
function detail(wine: LibraryWine) {
  openDialog(`<p class="wl-kicker">${esc(vintageLabel(wine))} · ${esc(wine.metadata?.color || 'WINE')}</p><h2>${esc(wine.wine_name)}</h2><p class="wl-muted">${esc([wine.producer, wine.region, wine.metadata?.country].filter(Boolean).join(' · '))}</p>
    <div class="wl-detail-grid"><div class="wl-detail-photo">${wine.image_url ? `<img src="${esc(wine.image_url)}" alt="${esc(wine.wine_name)} bottle">` : '<span class="wl-photo-placeholder">YOUR BOTTLE<br>IN FOCUS<span>＋</span></span>'}</div><div><p class="wl-kicker">YOUR NOTES</p><p class="wl-notes">${esc(wine.notes || 'Add your first impression. This is your space.')}</p><p class="wl-muted small">${esc(wine.metadata?.grape || '')}</p><button id="wl-photo" class="wl-primary">${wine.image_url ? 'Change bottle image' : 'Add bottle photo'} ↗</button><button id="wl-edit" class="wl-outline">Edit wine</button><button id="wl-vintage" class="wl-outline">＋ Add another vintage</button></div></div>
    <div class="wl-hud-label"><span>EVEN G2 · DISPLAY PREVIEW</span><span>576 × 288</span></div><canvas id="wl-g2-preview" class="wl-hud-canvas" role="img" aria-label="Preview of this wine on the Even G2 display"></canvas>
    <p class="wl-muted small">Layout preview. Glasses use the built-in G2 typeface and green display.</p><button id="wl-send" class="wl-primary">Show on glasses ↗</button>
    <button id="wl-remove" class="wl-text-button">Remove from Winebrary</button>`);
  void drawGlassesPreview(wine,dialog.querySelector<HTMLCanvasElement>('#wl-g2-preview')!);
  dialog.querySelector('#wl-edit')!.addEventListener('click', () => editWine(wine));
  dialog.querySelector('#wl-vintage')!.addEventListener('click', () => editWine(wine,true));
  dialog.querySelector('#wl-photo')!.addEventListener('click', () => photoStudio(wine));
  dialog.querySelector('#wl-send')!.addEventListener('click', () => run(async () => {
    if (!canShowWine()) throw new Error('Open wineLENS in Even Hub and connect your G2 glasses first.');
    await showWineOnGlasses(wine); feedback('Wine sent to the Even Hub bridge.');
  }));
  dialog.querySelector('#wl-remove')!.addEventListener('click', () => {
    openDialog(`<h2>Remove this wine?</h2><p>${esc(wine.wine_name)} · ${esc(vintageLabel(wine))}</p><p class="wl-muted">It will be removed from your account. Your other vintages stay in Winebrary.</p><button id="wl-confirm-remove" class="wl-primary">Remove wine</button><button id="wl-keep" class="wl-outline">Keep wine</button>`);
    dialog.querySelector('#wl-keep')!.addEventListener('click', () => detail(wine));
    dialog.querySelector('#wl-confirm-remove')!.addEventListener('click', () => run(async () => { await api(`/api/collection?id=${wine.id}`,'DELETE'); dialog.close(); await refresh(); }));
  });
}
function photoStudio(wine: LibraryWine) {
  let draft: ImageDraft | null = null;
  let original: ImageDraft | null = null;
  const account = userId;
  openDialog(`<p class="wl-kicker">BOTTLE STUDIO</p><h2>The real thing.<br>In its best light.</h2><p class="wl-muted">Start with a clear photo of this exact bottle and vintage. Use it as-is, or make a realistic studio rendering.</p>
    <label class="wl-upload">＋ Choose a bottle photo<input id="wl-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="wl-muted small">PNG, JPEG or WebP · under 2 MB. Only upload photos you can use. Generating a rendering sends this photo to OpenAI.</p>
    <div id="wl-image-review" class="wl-image-review"></div><div class="wl-studio-actions"><button id="wl-render" class="wl-primary" hidden>Create studio rendering ↗</button><button id="wl-approve" class="wl-outline" hidden>Use this image</button><button id="wl-original" class="wl-text-button" hidden>Back to original photo</button></div><p class="wl-muted small">Three studio attempts per day, including failed attempts. Check the label, producer and year before using a rendering.</p>`);
  const preview = () => {
    dialog.querySelector('#wl-image-review')!.innerHTML = `<img src="${esc(draft!.url)}" alt="Bottle image for review"><p class="wl-kicker">${draft!.source === 'generated' ? 'STUDIO RENDERING · CHECK LABEL & VINTAGE' : 'YOUR ORIGINAL PHOTO'}</p>`;
    dialog.querySelector<HTMLButtonElement>('#wl-render')!.hidden = false;
    dialog.querySelector<HTMLButtonElement>('#wl-approve')!.hidden = false;
    dialog.querySelector<HTMLButtonElement>('#wl-original')!.hidden = draft!.source !== 'generated';
  };
  dialog.querySelector<HTMLInputElement>('#wl-file')!.addEventListener('change', e => run(async () => {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    if (file.size > 2*1024*1024) throw new Error('Choose a photo under 2 MB.');
    feedback('Uploading your photo…');
    const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=reject; reader.readAsDataURL(file); });
    const result = await api('/api/bottle-image','POST',{ collection_id: wine.id, png:data });
    if (account !== userId) return;
    draft = original = result.draft; preview(); feedback('Photo ready. Use it now, or create a rendering.');
  }));
  dialog.querySelector('#wl-render')!.addEventListener('click', () => run(async () => {
    if (!original) return; feedback('Lighting your bottle… This can take up to two minutes.');
    const result = await api('/api/generate-bottle','POST',{ collection_id:wine.id, reference_path:original.path, request_id:crypto.randomUUID() });
    if (account !== userId) return;
    draft=result.draft; preview(); feedback('Compare the label and vintage with your photo before using this rendering.');
  }));
  dialog.querySelector('#wl-original')!.addEventListener('click', () => { draft=original; preview(); feedback('Original photo selected.'); });
  dialog.querySelector('#wl-approve')!.addEventListener('click', () => run(async () => {
    if (!draft) return;
    const result = await api('/api/collection','PATCH',{ id:wine.id, image_path:draft.path, image_source:draft.source });
    if (account !== userId) return;
    setBusy(false); detail(result.item); await refresh();
  }));
}
export function initWinebrary() {
  root = document.getElementById('winebrary-content')!;
  // The glasses read the same in-memory collection; an error only counts when nothing loaded.
  setLibrarySource(() => ({ userId, loading, error: items.length ? '' : notice, items }));
  dialog = document.createElement('dialog'); dialog.className='wl-dialog'; dialog.setAttribute('aria-label','Winebrary'); document.body.append(dialog);
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  document.getElementById('wl-account')!.addEventListener('click', () => {
    if (!userId) return signIn();
    const pending=unsyncedEvents().length;
    openDialog(`<p class="wl-kicker">YOUR WINELENS ACCOUNT</p><h2>A taste of your own.</h2><p class="wl-muted">Your Winebrary and study progress are private to your account. Signing out removes them from this device.</p>${pending ? `<p class="wl-notice" role="status">${pending} study ${pending === 1 ? 'review has' : 'reviews have'} not reached your account yet and will be removed from this device if you sign out now.</p>` : ''}<button id="wl-signout" class="wl-primary">Sign out</button>`);
    dialog.querySelector('#wl-signout')!.addEventListener('click', () => run(async () => { const { error } = await auth.auth.signOut(); if (error) throw error; dialog.close(); }));
  });
  document.querySelectorAll('[data-wl-add]').forEach(el=>el.addEventListener('click',()=>requireAccount(()=>editWine())));
  document.querySelectorAll<HTMLElement>('[data-open-tab]').forEach(el=>el.addEventListener('click',()=>document.querySelector<HTMLButtonElement>(`.tab[data-tab="${el.dataset.openTab}"]`)?.click()));
  document.addEventListener('click', e => {
    const button=(e.target as HTMLElement).closest<HTMLElement>('[data-save-library]'); if (!button) return;
    const found=lookupWineById(button.dataset.saveLibrary);
    if (!found) return; // unknown catalog ID: never save it as some other wine
    // Personal notes start empty: catalog tasting notes are attributed reference text, not the user's observations.
    requireAccount(()=>editWine({ wine_name:found.wine.name, wine_id:found.id, region:found.wine.region, notes:'', metadata:{color:found.type,country:found.country,grape:found.wine.grape,vintage_state:'unknown'} }));
  });
  auth.auth.onAuthStateChange((_event, session) => {
    const next=session?.user.id || null;
    if (next === userId) return;
    const previous=userId;
    if (previous) { void clearPrivateGlasses().catch(console.error); void clearLibraryCache(); void forgetAccount(previous).catch(console.error); }
    // Study progress follows the account: the previous owner's reviews leave memory before the next log loads.
    setStudyAuth(session ? { userId: session.user.id, token: () => auth.auth.getSession().then(r => r.data.session?.access_token ?? null) } : null);
    void useAccount(next).then(() => { if (next) setTimeout(() => void syncStudy(), 0); });
    dialogRevision++;
    userId=next; items=[]; search=''; generation++; loading=false;
    // Do not await Supabase requests inside its auth callback.
    dialog.close(); setBusy(false); render(); setTimeout(()=>void refresh(),0);
  });
  render();
  void auth.auth.getSession().then(({data:{session}})=> {
    if (!session || session.user.id === userId) return;
    userId=session.user.id; void refresh();
    setStudyAuth({ userId: session.user.id, token: () => auth.auth.getSession().then(r => r.data.session?.access_token ?? null) });
    void useAccount(session.user.id).then(() => void syncStudy());
  });
}
