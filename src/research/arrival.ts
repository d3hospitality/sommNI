/** A single, non-flashing cue when research or a saved wine arrives. */
export function highlightArrival(element: HTMLElement, focus = false) {
  element.classList.remove('sommni-arrived');
  void element.offsetWidth;
  element.classList.add('sommni-arrived');
  setTimeout(() => element.classList.remove('sommni-arrived'), 2500);
  element.addEventListener('animationend', () => element.classList.remove('sommni-arrived'), { once: true });
  if (focus) {
    element.tabIndex = -1;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
}
