import { createBrowserAtlas } from './atlas/browser-explorer';
import { allCatalogWines } from './identity';
import { bottleImageUrl } from './bottle-assets';
import { atlasCountryFor, loadAtlasRenderer } from './atlas-app';
import { DotAtlas, type DotSelection } from './atlas/dot-atlas';
import type { GlobeRenderer } from './atlas/renderer';
import { alphaBounds } from './bottle-raster';
import regionLinks from './data/atlas-region-links.json';

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const base = new URL('./', location.href).href;
const wines = allCatalogWines();
const STORAGE_KEY = 'winelens-depth-rehearsal-v1';
interface Brief { wineId: string; goal: string; food: string; budget: string; vintage: string; attempt: string }

/** Browser composition only. Does not claim the G2 display or send unsupported SDK fields. */
export function initDepthExperience(): void {
  const root = document.getElementById('depth-experience');
  if (!root || !wines.length) return;
  let selected = wines[0];
  let paintVersion = 0;
  let previewVersion = 0;
  let dots: DotAtlas | null = null;
  let dotSelection: DotSelection | null = null;
  let browserAtlas: Awaited<ReturnType<typeof createBrowserAtlas>> | null = null;
  let explorerLoading = false;
  let confirmed = false;
  let reviewed = false;
  let brief: Brief = { wineId: selected.id, goal: '', food: '', budget: '', vintage: '', attempt: '' };
  let restored = false;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const candidate = raw as Record<string, unknown>;
      if (Object.keys(brief).every(key => typeof candidate[key] === 'string') && wines.some(w => w.id === candidate.wineId)) {
        brief = candidate as unknown as Brief;
        selected = wines.find(w => w.id === brief.wineId)!;
        restored = true;
      }
    }
  } catch { /* A missing or unavailable draft leaves the editor usable. */ }
  root.innerHTML = `
    <div class="depth-heading"><div><p class="wl-kicker">THE WORLD BEHIND YOUR GLASS</p><h1>A sense of <em>place.</em></h1></div><p>Follow a wine back to its origins. <br>Bring just what matters into focus.</p></div>
    <div class="depth-toolbar"><label for="depth-wine">OUR GROWING COLLECTION <select id="depth-wine">${wines.map(w => `<option value="${w.id}" ${w.id === selected.id ? 'selected' : ''}>${escape(w.wine.name)}</option>`).join('')}</select></label><div class="depth-switch" role="group" aria-label="Scene depth"><button type="button" data-depth-mode="flat" aria-pressed="false">Flat</button><button type="button" data-depth-mode="layered" aria-pressed="true">Layered</button></div></div>
    <div class="depth-scene" data-mode="layered" role="group" aria-label="Atlas, bottle and wine details in three visual layers">
      <div class="depth-grid" aria-hidden="true"></div><div class="depth-map-layer"><canvas id="depth-map" width="720" height="720" aria-label="Dotted globe highlighting the wine region"></canvas></div>
      <span class="depth-map-label"><span>01 / THE DOT ATLAS</span><strong id="depth-country"></strong><small id="depth-region-label">A world of wine, point by point</small></span>
      <span class="depth-compass" aria-hidden="true">N<br>↑</span>
      <div class="depth-bottle-layer"><img id="depth-bottle" alt=""><span>02 / THE BOTTLE</span></div>
      <article class="depth-details"><p class="wl-kicker">03 / IN FOCUS</p><p id="depth-producer"></p><h2 id="depth-name"></h2><p id="depth-place"></p><div class="depth-rule"></div><p class="depth-note-label">FROM THE CATALOGUE</p><p id="depth-nose"></p><p id="depth-style"></p><button class="wl-outline" type="button" id="depth-notes">Read tasting notes ↗</button><button class="wl-primary" type="button" id="depth-prepare">Prepare a wine moment <span aria-hidden="true">↗</span></button></article>
      <span class="depth-scene-footer">ATLAS → BOTTLE → DETAILS</span><span class="depth-scene-hint">One wine. A wider perspective.</span>
    </div>
    <div class="depth-under"><p id="depth-map-status" role="status">Loading your wine’s place in the atlas…</p><label><input id="depth-quiet" type="checkbox" checked> Quiet map</label><button type="button" class="wl-text-button" data-browse-notes>Browse all tasting notes ↗</button><button id="dot-explore" class="wl-text-button" type="button">Explore the dots ↗</button><button id="depth-preview-open" class="wl-text-button" type="button">See the glasses view ↗</button></div>
    <section class="depth-moment" id="depth-moment" aria-labelledby="depth-moment-title"><div class="depth-moment-intro"><p class="wl-kicker">YOUR NEXT WINE MOMENT</p><h2 id="depth-moment-title">Know the wine.<br>Enjoy the conversation.</h2><p>Prepare a few details, try your introduction, then keep a short cue in view.</p><ol><li>Confirm the moment</li><li>Rehearse one introduction</li><li>Preview your cue</li></ol><p class="depth-caption">Local rehearsal prototype · no AI evaluation</p></div>
      <div class="depth-moment-editor"><form id="depth-brief"><p id="depth-brief-wine" class="wl-kicker"></p><label>The moment<input name="goal" maxlength="180" required placeholder="Introduce a bottle at dinner" value="${escape(brief.goal)}"></label><div class="depth-form-row"><label>Food or guest preference<input name="food" maxlength="120" placeholder="Confirm with your guest" value="${escape(brief.food)}"></label><label>Budget, if relevant<input name="budget" maxlength="80" placeholder="Not yet confirmed" value="${escape(brief.budget)}"></label></div><label>Vintage on your bottle<input name="vintage" maxlength="24" placeholder="Leave blank if unconfirmed" value="${escape(brief.vintage)}"></label><p class="depth-caption">Catalogue notes describe the wine generally. Bottle artwork may show a different vintage. Stock, price and suitability still need checking.</p><button class="wl-primary" type="submit">Confirm & rehearse →</button></form>
      <div id="depth-rehearsal" hidden><p class="wl-kicker">SAY IT IN YOUR OWN WORDS</p><p id="depth-confirmed"></p><label>Your short introduction<textarea id="depth-attempt" rows="3" maxlength="900" placeholder="Name the wine, mention its origin, then ask your guest a question.">${escape(brief.attempt)}</textarea></label><button id="depth-review" type="button" class="wl-outline">Check my introduction</button><p id="depth-feedback" role="status"></p><div class="depth-rehearsal-actions"><button id="depth-cue" type="button" class="wl-primary" disabled>Preview my cue →</button><button id="depth-edit" type="button" class="wl-text-button">Edit the moment</button></div></div>
      <p id="depth-save-status" role="status">${restored ? 'Saved draft restored. Confirm the details before rehearsing.' : 'Your draft stays in this browser when you save it.'}</p><button id="depth-save" type="button" class="wl-text-button">Save for later</button><button id="depth-clear" type="button" class="wl-text-button">Clear draft</button></div></section>
    <section id="dot-dialog" class="atlas-inline" aria-labelledby="dot-title"></section>
    <dialog id="depth-preview" aria-labelledby="depth-preview-title"><div class="depth-dialog-top"><p class="wl-kicker">EVEN G2 / COMPOSITION PREVIEW</p><button id="depth-close" type="button" aria-label="Close glasses preview">×</button></div><h2 id="depth-preview-title">A little room to breathe.</h2><p>Quiet atlas. Clear bottle. A few words to keep you present.</p><canvas id="depth-hud" width="576" height="288" aria-label="Simulated green glasses cue"></canvas><p id="depth-cue-context"></p><p class="depth-caption">Browser simulation at 576 × 288. Visual depth cues only; this is not stereo depth or a live glasses connection. Preview text approximates the device font.</p><button id="depth-return" type="button" class="wl-outline">Return to the wine</button></dialog>`;
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const text = (id: string, value: string) => { get(id).textContent = value; };
  const scene = root.querySelector<HTMLElement>('.depth-scene')!;
  const form = get<HTMLFormElement>('depth-brief');
  const dialog = get<HTMLDialogElement>('depth-preview');
  const dotDialog = get<HTMLElement>('dot-dialog');
  const readBrief = () => {
    const data = new FormData(form);
    brief = { wineId: selected.id, goal: String(data.get('goal') || '').trim(), food: String(data.get('food') || '').trim(), budget: String(data.get('budget') || '').trim(), vintage: String(data.get('vintage') || '').trim(), attempt: get<HTMLTextAreaElement>('depth-attempt').value.trim() };
  };
  const invalidateReview = () => { reviewed = false; get<HTMLButtonElement>('depth-cue').disabled = true; text('depth-feedback', ''); };
  const update = () => {
    const wine = selected.wine;
    const parts = wine.name.split(' – ');
    text('depth-producer', parts.length > 1 ? parts[1] : selected.country);
    get('depth-notes').dataset.wineNotes=selected.id;
    text('depth-name', parts[0]); text('depth-place', wine.region); text('depth-nose', wine.nose); text('depth-style', `${wine.grape} · ${wine.style}`);
    text('depth-country', selected.country); text('depth-brief-wine', wine.name);
    const img = get<HTMLImageElement>('depth-bottle'); img.hidden = false; img.src = bottleImageUrl(base, selected.legacyId!); img.alt = `${wine.name} catalogue bottle artwork; vintage not confirmed`;
    void drawMap();
  };
  function selectionFor(renderer: GlobeRenderer, wine = selected): DotSelection | null {
    const country = atlasCountryFor(renderer,wine.country);
    if (!country) return null;
    const link = regionLinks.links.find(l => l.region === wine.wine.region);
    const region = renderer.data.regions.find(r => r.country === country.code && link?.clusters.includes(r.name)) ?? null;
    return { country, region, label: region?.name ?? country.name };
  }
  function paintDots(): void {
    if (!dots || !dotSelection) return;
    dots.draw(get<HTMLCanvasElement>('depth-map'), dotSelection, 'globe');
    text('depth-region-label',dotSelection.region ? `${dotSelection.region.name} · region locator` : 'Country locator · region unmapped');
  }
  async function drawMap() {
    const version = ++paintVersion;
    get<HTMLCanvasElement>('depth-map').style.visibility = 'hidden';
    get<HTMLButtonElement>('dot-explore').disabled = true;
    text('depth-map-status', 'Loading the dot atlas…');
    try {
      const renderer = await loadAtlasRenderer();
      if (version !== paintVersion) return;
      dotSelection = selectionFor(renderer);
      if (!dotSelection) throw new Error('No country map');
      dots ??= new DotAtlas(renderer);
      paintDots();
      get<HTMLCanvasElement>('depth-map').style.visibility = 'visible';
      get<HTMLButtonElement>('dot-explore').disabled = false;
      text('depth-map-status', `${selected.country} highlighted · ${dotSelection.region?.name ?? 'country only'} · original sommNI dot atlas.`);
    } catch {
      if (version === paintVersion) text('depth-map-status', 'Atlas unavailable. Wine details remain available.');
    }
  }
  document.getElementById('atlas-explorer-host')?.replaceChildren(dotDialog);
  const openExplorer = async (world = false, navigate = true) => {
    if(navigate){document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();dotDialog.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
    if(explorerLoading)return;
    if(browserAtlas&&world)return;
    explorerLoading=true;
    if(!browserAtlas)dotDialog.innerHTML='<p role="status">Loading your wine atlas…</p>';
    try {
      const renderer=await loadAtlasRenderer(),country=renderer.data.countries.find(c=>c.code==='ITA')??renderer.data.countries[0];
      const selection=world?{country,region:null,label:country.name}:dotSelection??selectionFor(renderer);
      if(!selection)throw Error('Country unavailable');
      browserAtlas??=await createBrowserAtlas(dotDialog,renderer,selection);
      browserAtlas.open(selection);
    } catch {
      dotDialog.innerHTML='<p role="status">The atlas could not load. Your wine notes are still available.</p><button class="wl-outline" type="button">Retry atlas</button>';
      dotDialog.querySelector('button')!.addEventListener('click',()=>void openExplorer(true,false));
    } finally {explorerLoading=false;}
  };
  get('dot-explore').addEventListener('click',()=>void openExplorer());
  window.addEventListener('winelens-open-browser-atlas',()=>void openExplorer(true));
  void openExplorer(true,false);
  get<HTMLImageElement>('depth-bottle').addEventListener('error', () => { get('depth-bottle').hidden = true; text('depth-map-status', 'Bottle image unavailable. Wine details remain available.'); });
  get<HTMLSelectElement>('depth-wine').addEventListener('change', event => {
    selected = wines.find(w => w.id === (event.target as HTMLSelectElement).value)!;
    confirmed = false; invalidateReview(); form.hidden = false; get('depth-rehearsal').hidden = true;
    (form.elements.namedItem('vintage') as HTMLInputElement).value = '';
    get<HTMLTextAreaElement>('depth-attempt').value = '';
    text('depth-save-status', 'Wine changed. Confirm the moment again; the previous saved draft is unchanged.'); update();
  });
  root.querySelectorAll<HTMLButtonElement>('[data-depth-mode]').forEach(button => button.addEventListener('click', () => {
    scene.dataset.mode = button.dataset.depthMode;
    root.querySelectorAll<HTMLButtonElement>('[data-depth-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    scene.style.setProperty('--mx','0px'); scene.style.setProperty('--my','0px');
  }));
  get<HTMLInputElement>('depth-quiet').addEventListener('change', event => scene.classList.toggle('depth-map-full', !(event.target as HTMLInputElement).checked));
  scene.addEventListener('pointermove', event => {
    if (scene.dataset.mode !== 'layered' || !matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
    const box = scene.getBoundingClientRect();
    scene.style.setProperty('--mx', `${((event.clientX-box.left)/box.width-.5)*12}px`);
    scene.style.setProperty('--my', `${((event.clientY-box.top)/box.height-.5)*8}px`);
  });
  scene.addEventListener('pointerleave', () => { scene.style.setProperty('--mx','0px'); scene.style.setProperty('--my','0px'); });
  get('depth-prepare').addEventListener('click', () => { confirmed = false; invalidateReview(); form.hidden = false; get('depth-rehearsal').hidden = true; get('depth-moment').scrollIntoView({block:'start'}); (form.elements.namedItem('goal') as HTMLInputElement).focus({preventScroll:true}); });
  form.addEventListener('submit', event => {
    event.preventDefault(); readBrief();
    if (!brief.goal) { (form.elements.namedItem('goal') as HTMLInputElement).focus(); return; }
    confirmed = true; invalidateReview(); form.hidden = true; get('depth-rehearsal').hidden = false;
    text('depth-confirmed', `${brief.goal} · ${brief.food || 'Guest preferences unconfirmed'} · ${brief.budget || 'Budget unconfirmed'}`);
    get('depth-attempt').focus();
  });
  get('depth-edit').addEventListener('click', () => { confirmed = false; invalidateReview(); form.hidden = false; get('depth-rehearsal').hidden = true; (form.elements.namedItem('goal') as HTMLInputElement).focus(); });
  get('depth-attempt').addEventListener('input', invalidateReview);
  get('depth-review').addEventListener('click', () => {
    readBrief(); const attempt = brief.attempt.toLocaleLowerCase();
    if (!attempt) { text('depth-feedback','Write an introduction first. Nothing has been assessed.'); return; }
    const country = selected.country.toLocaleLowerCase();
    // A transparent, deterministic rehearsal prompt, never a factual or proficiency score.
    const question = /[?？]/.test(attempt);
    text('depth-feedback', !attempt.includes(country) ? `One thing to try: include ${selected.country}, the catalogue country. Then check that the rest of your introduction fits the guest. This is a keyword check, not a factual review.` : !question ? 'One thing to try: ask your guest a question before making the recommendation. This checks for a question mark, not the quality of your recommendation.' : 'Your introduction mentions the catalogue country and includes a question mark. Try again with a changed guest preference. Facts, pronunciation and suitability have not been evaluated.');
    reviewed = true; get<HTMLButtonElement>('depth-cue').disabled = false;
    get<HTMLButtonElement>('depth-review').textContent = 'Check my retry';
  });
  get('depth-save').addEventListener('click', () => {
    readBrief();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(brief)); text('depth-save-status','Draft saved in this browser. Confirm it again when you return.'); }
    catch { text('depth-save-status','This browser could not save the draft. Keep this page open to retain your work.'); }
  });
  get('depth-clear').addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { text('depth-save-status','The saved draft could not be removed. Try again when browser storage is available.'); return; }
    form.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.value = ''; });
    get<HTMLTextAreaElement>('depth-attempt').value = ''; confirmed = false; invalidateReview(); form.hidden = false; get('depth-rehearsal').hidden = true; text('depth-save-status','Draft cleared from this browser.');
  });
  async function preview() {
    readBrief(); dialog.showModal();
    const version = ++previewVersion;
    const previewWine = selected;
    const canvas = get<HTMLCanvasElement>('depth-hud'); const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#07110b'; ctx.fillRect(0,0,576,288); ctx.fillStyle = '#a9fca0'; ctx.font = '18px Arial';
    const lines = [previewWine.wine.name.split(' – ')[0], previewWine.wine.region, brief.vintage ? `Vintage: ${brief.vintage}` : 'Vintage: confirm bottle', '', previewWine.wine.nose];
    let y = 38;
    for (const line of lines) {
      let current = '';
      for (const word of line.split(' ')) {
        if (ctx.measureText(`${current} ${word}`).width > 326 && current) { ctx.fillText(current,18,y); y += 26; current = word; }
        else current += (current ? ' ' : '') + word;
      }
      if (y < 255) ctx.fillText(current,18,y); y += 26;
    }
    text('depth-cue-context', confirmed ? `Your moment: ${brief.goal}. ${reviewed ? 'Rehearsal checked locally.' : ''}` : 'Catalogue preview. Confirm your moment to carry its context into this view.');
    try {
      const renderer = await loadAtlasRenderer();
      if (version !== previewVersion || !dialog.open) return;
      const selection = selectionFor(renderer,previewWine);
      if (!selection) return;
      dots ??= new DotAtlas(renderer);
      const map = document.createElement('canvas');
      dots.draw(map,selection,'globe',0,true);
      const panel = document.createElement('canvas'); panel.width = 200; panel.height = 252;
      const panelCtx = panel.getContext('2d')!;
      panelCtx.fillStyle='#000';panelCtx.fillRect(0,0,200,252);
      panelCtx.drawImage(map,0,26,200,200);
      const response = await fetch(bottleImageUrl(base,previewWine.legacyId!));
      if(!response.ok) throw new Error('Bottle unavailable');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        const probe = document.createElement('canvas');probe.width=bitmap.width;probe.height=bitmap.height;
        const probeCtx=probe.getContext('2d')!;probeCtx.drawImage(bitmap,0,0);
        const box=alphaBounds(probeCtx.getImageData(0,0,probe.width,probe.height).data,probe.width,probe.height);
        const scale=Math.min(63/box.width,205/box.height), w=box.width*scale,h=box.height*scale;
        panelCtx.drawImage(bitmap,box.x,box.y,box.width,box.height,120-w/2,235-h,w,h);
      } finally { bitmap.close(); }
      // Match the G2's 16 levels for this browser study; no new bridge payload is sent.
      const frame=panelCtx.getImageData(0,0,200,252);
      for(let i=0;i<frame.data.length;i+=4){const level=Math.round((frame.data[i]*.2126+frame.data[i+1]*.7152+frame.data[i+2]*.0722)/17)*17;frame.data[i]=Math.round(level*.35);frame.data[i+1]=level;frame.data[i+2]=Math.round(level*.4);}
      if(version !== previewVersion || !dialog.open)return;
      ctx.putImageData(frame,376,36);
    } catch { if (version === previewVersion && dialog.open) text('depth-cue-context', 'Map preview unavailable. The wine text is still shown.'); }
  }
  dialog.addEventListener('close', () => { previewVersion++; });
  get('depth-preview-open').addEventListener('click', () => { void preview(); });
  get('depth-cue').addEventListener('click', () => { void preview(); });
  for (const id of ['depth-close','depth-return']) get(id).addEventListener('click', () => dialog.close());
  update();
}
