import { atlasStatus, openAtlasOnGlasses, type AtlasStatus } from './atlas-app';
import { inEvenHubHost } from './sync';
const $ = <T extends HTMLElement>(id:string)=>document.getElementById(id) as T|null;
function statusLine(s: AtlasStatus): string {
  if (s.error) return s.error;
  if (!s.active) return inEvenHubHost() ? 'Regions with wines come first. Scroll up to Search by voice.' : 'Glasses open inside the Even app with G2 connected.';
  const place = s.region ? `${s.country} › ${s.region}` : s.country;
  return `On your glasses: ${place}${s.mode === 'detail' ? ' (wines & history)' : ''}`;
}

export function initAtlasCard(): void {
  $('home-open-atlas')?.addEventListener('click',()=>window.dispatchEvent(new Event('winelens-open-browser-atlas')));
  const card = $('atlas-card');
  if (!card) return;
  const button = $<HTMLButtonElement>('atlas-open-glasses');
  const status = $('atlas-status');
  const host = inEvenHubHost();
  // Plain browsers never claim a glasses connection; inside the Even app the standalone
  // preview would compete for the display, so the phone view stays in this page.
  if (button) { button.disabled = !host; if (!host) button.title = 'Available inside the Even app with G2 connected'; }
  const update = () => { if (status) status.textContent = statusLine(atlasStatus()); };
  window.addEventListener('winelens-atlas-change', update);
  update();

  button?.addEventListener('click', async () => {
    button.disabled = true;
    if (status) status.textContent = 'Opening the Atlas on your glasses…';
    try { await openAtlasOnGlasses(); }
    catch (error) { if (status) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { button.disabled = !host; }
  });

}
