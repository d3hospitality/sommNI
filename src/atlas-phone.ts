// Discover › Wine Atlas card on the phone companion.
// A small globe (painted lazily, once the card is on screen), an "Open on glasses" action
// that hands the G2 display to the Atlas, and a live line showing where the glasses are.
import { paintFrame } from './atlas/renderer';
import { atlasStatus, loadAtlasRenderer, openAtlasOnGlasses, type AtlasStatus } from './atlas-app';
import { inEvenHubHost } from './sync';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function statusLine(s: AtlasStatus): string {
  if (s.error) return s.error;
  if (!s.active) return inEvenHubHost() ? 'Scroll countries on the glasses; tap to see mapped winery clusters.' : 'Glasses open inside the Even app with G2 connected.';
  const place = s.region ? `${s.country} › ${s.region}` : s.country;
  return `On your glasses: ${place}${s.mode === 'detail' ? ' (winery locations)' : ''}`;
}

export function initAtlasCard(): void {
  const card = $('atlas-card');
  if (!card) return;
  const button = $<HTMLButtonElement>('atlas-open-glasses');
  const phoneLink = $<HTMLAnchorElement>('atlas-open-phone');
  const status = $('atlas-status');
  const canvas = $<HTMLCanvasElement>('atlas-mini');
  const host = inEvenHubHost();
  // Plain browsers never claim a glasses connection; inside the Even app the standalone
  // preview would compete for the display, so the phone view stays in this page.
  if (button) { button.disabled = !host; if (!host) button.title = 'Available inside the Even app with G2 connected'; }
  if (phoneLink) phoneLink.hidden = host;
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

  if (!canvas) return;
  const paint = async () => {
    try {
      const renderer = await loadAtlasRenderer();
      const france = renderer.data.countries.find(c => c.code === 'FRA') ?? renderer.data.countries[0];
      paintFrame(canvas, renderer.render({ country: france, center: [8, 30], radius: 90 }, 360), 'atelier');
      canvas.classList.add('ready');
    } catch { canvas.hidden = true; }
  };
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { seen.disconnect(); void paint(); } });
    seen.observe(canvas);
  } else void paint();
}
