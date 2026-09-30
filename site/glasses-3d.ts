// ═══════════════════════════════════════════════════════════════════
// The glasses in 3D: four wineLENS simulator captures on a 3D model
// of Even G2 that turns from one to the next. Visitors can pick a
// screen, pause, or take the model and turn it themselves.
//
// The component is vendored from g2b-showcase (site/g2b, with its
// files in site/public/g2b): change it there and sync, so the page and
// the exported video, GIF and poster keep drawing the same loop.
//
// Without this module the block still shows its poster, captions and
// the enlarged screen. three.js, the model and the captures load only
// as the block comes near, and the showcase pauses itself offscreen.
// ═══════════════════════════════════════════════════════════════════

const root = document.querySelector<HTMLElement>('[data-g2b]');

if (root) {
  const mount = () =>
    import('./g2b/showcase').then(async ({ mountShowcase }) => {
      const showcase = await mountShowcase(root);
      // the behaviour checks in g2b-showcase (tools/check-review.mjs) read this in dev
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__g2b = { winelens: showcase };
    });

  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        near.disconnect();
        void mount();
      },
      { rootMargin: '300px 0px' },
    );
    near.observe(root);
  } else {
    void mount();
  }
}
