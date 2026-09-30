import { Stage, loadImageCapture, type Capture } from './g2b/stage';
export async function mountGlasses() {
  const canvas = document.querySelector<HTMLCanvasElement>('#g2-viewer canvas')!;
  const stage = new Stage(canvas, { background: '#231C19', tone: 'dark', pixelRatio: Math.min(devicePixelRatio, 1.5), look: { glass: .03, environment: .4, key: 2.8, frame: .7 } });
  try {
    await stage.load('/g2b/ERG2B.web.glb', 'erg2b');
    const captures = new Map<string, Capture>();
    const select = async (screen: string) => {
      let capture = captures.get(screen);
      if (!capture) { capture = await loadImageCapture(`/media/g2-${screen}.webp`, stage.renderer); captures.set(screen, capture); }
      stage.setCaptures(capture, null, 1); stage.render();
    };
    stage.setDisplay({ mode: 'black', scale: .88, x: 0, y: .02, opacity: .96, brightness: 1.7 }, 'both');
    await select('notes');
    canvas.hidden = false; document.getElementById('model-poster')!.hidden = true;
    document.querySelector<HTMLElement>('.model-controls')!.hidden = false;
    let angle = 0;
    const draw = () => { const r = canvas.parentElement!.getBoundingClientRect(); stage.setSize(r.width, r.height); stage.setSpin(angle); stage.setPose({ yaw: 0, pitch: 9, zoom: 1, lift: 0, truck: 0 }); stage.render(); };
    new ResizeObserver(draw).observe(canvas.parentElement!); draw();
    document.getElementById('model-angle')!.addEventListener('input', e => { angle = Number((e.target as HTMLInputElement).value); draw(); });
    // Deliberately user-driven: no autoplay, offscreen animation or reduced-motion exception.
    let selection = 0;
    document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(button => button.addEventListener('click', async () => {
      const revision = ++selection;
      document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(b => b.disabled = true);
      try { await select(button.dataset.screen!); if (revision === selection) document.querySelectorAll('[data-screen]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); }
      catch { document.getElementById('model-status')!.textContent = 'This screen could not load. Choose another or try again.'; }
      finally { document.querySelectorAll<HTMLButtonElement>('[data-screen]').forEach(b => b.disabled = false); }
    }));
  } catch (error) { stage.dispose(); throw error; }
}
