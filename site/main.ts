const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
const nav = document.getElementById('nav-links');
toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open)); nav?.classList.toggle('open', open);
});
nav?.addEventListener('click', e => { if ((e.target as HTMLElement).closest('a')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && nav?.classList.contains('open')) { nav.classList.remove('open'); toggle?.setAttribute('aria-expanded', 'false'); toggle?.focus(); } });
