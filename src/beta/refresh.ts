import {revealHomeTask} from '../home-task';
/** Companion-only actions. The beta's library, research and G2 controllers stay unchanged. */
export function initBetaRefresh(): void {
  const research = document.getElementById('wine-research');
  const slot = document.getElementById('beta-research-slot');
  if (research && slot) slot.append(research);

  document.querySelectorAll<HTMLElement>('[data-beta-research],[data-beta-scan]').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelector<HTMLButtonElement>('.tab[data-tab="home"]')?.click();
      research?.querySelector<HTMLButtonElement>('[data-mode="research"]')?.click();
      revealHomeTask(research);research?.scrollIntoView({ block: 'start' });
      research?.querySelector<HTMLInputElement>(button.hasAttribute('data-beta-scan') ? '#research-photo' : '[name="query"]')?.focus({ preventScroll: true });
    });
  });
  document.querySelectorAll('[data-beta-account]').forEach(button => button.addEventListener('click', () => {
    document.getElementById('wl-account')?.click();
  }));
}
