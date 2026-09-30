const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.getElementById('nav-links');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open)); nav?.classList.toggle('open', open);
});
nav?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('a')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav?.classList.contains('open')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); toggle?.focus(); } });
const load = document.querySelector<HTMLButtonElement>('#load-model');
load?.addEventListener('click', async () => {
  load.disabled = true; load.textContent = 'Loading the frame…';
  try { await (await import('./glasses-3d')).mountGlasses(); load.hidden = true; }
  catch { load.disabled = false; load.textContent = 'Try 3D again ↗'; document.getElementById('model-status')!.textContent = '3D is unavailable in this browser. The real simulator captures are still shown on this page.'; }
});
