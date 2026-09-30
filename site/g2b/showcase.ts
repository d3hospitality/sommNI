// The page half. A site writes the showcase section in its own typography (poster, feature buttons, caption,
// enlarged capture, controls) and marks it with data-g2b-* hooks; this module drives it. See README for the markup.
//
//   <div data-g2b="/g2b/tempo.json"> ... </div>
//   const { mountShowcase } = await import('./g2b/showcase')   // lazily, when the section nears the viewport
//   mountShowcase(el)
//
// It renders only while the section is on screen and something is moving, pauses when the page is hidden, never
// starts moving for a visitor who asked for reduced motion, and falls back to the recorded video when WebGL or the
// model is unavailable. The motion is the one the exports were recorded from: the config's turntable (motion.mode
// 'spin'; the page's scroll and a sideways drag turn it too) or its camera choreography.
import type { OrbitControls as OrbitControlsType } from 'three/addons/controls/OrbitControls.js'
import { Stage, loadImageCapture, type Capture } from './stage'
import { SPIN_SWAP, beatSettled, ease, frameAt, mixPose, poseOf, spinFrameAt, spinSettled } from './timeline'
import type { Frame, Pose, ShowcaseConfig } from './types'

export interface Showcase {
  /** frames drawn, the measured rate over the last second of motion, and where the turn is (spin only, in turns) */
  stats(): { frames: number; fps: number; layout: 'desktop' | 'mobile'; mode: 'webgl' | 'video'; turns: number }
  destroy(): void
}

interface Els {
  root: HTMLElement
  stage: HTMLElement
  caption: HTMLElement | null
  zoom: HTMLImageElement | null
  beats: HTMLButtonElement[]
  play: HTMLButtonElement | null
  explore: HTMLButtonElement | null
  status: HTMLElement | null
}

/** a glide of the camera (and, in the choreography, of the screen) */
interface PoseTween { kind: 'pose'; from: Pose; to: Pose; fromBeat: number; beat: number; start: number; ms: number }
/** a turn of the glasses to a chosen screen's face, in half turns (faces at whole numbers, edge-on at the halves) */
interface TurnTween { kind: 'turn'; h0: number; h1: number; edge: number; camFrom: Pose; fromBeat: number; beat: number; start: number; ms: number }
type Tween = PoseTween | TurnTween

const TWEEN_MS = 950
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function els(root: HTMLElement): Els {
  const stage = root.querySelector<HTMLElement>('[data-g2b-stage]')
  if (!stage) throw new Error('the showcase needs a [data-g2b-stage] element')
  return {
    root, stage,
    caption: root.querySelector('[data-g2b-caption]'),
    zoom: root.querySelector('[data-g2b-zoom]'),
    beats: [...root.querySelectorAll<HTMLButtonElement>('[data-g2b-beat]')],
    play: root.querySelector('[data-g2b-play]'),
    explore: root.querySelector('[data-g2b-explore]'),
    status: root.querySelector('[data-g2b-status]'),
  }
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

async function build(canvas: HTMLCanvasElement, config: ShowcaseConfig, url: (rel: string) => string, shadows: boolean): Promise<{ stage: Stage; captures: Capture[] }> {
  const stage = new Stage(canvas, { background: config.background, tone: config.tone, shadows, look: config.look })
  try {
    await stage.load(url(config.model), config.assetAdapter)
    stage.setDisplay(config.displaySettings, config.eye)
    const captures = await Promise.all(config.timeline.map((b) => loadImageCapture(url(b.src), stage.renderer)))
    return { stage, captures }
  } catch (err) {
    stage.dispose()
    throw err
  }
}

export async function mountShowcase(root: HTMLElement): Promise<Showcase> {
  const e = els(root)
  const base = new URL(root.dataset.g2b || '', location.href)
  const config = (await (await fetch(base)).json()) as ShowcaseConfig
  const beats = config.timeline
  const spin = config.motion?.mode === 'spin' ? config.motion : null
  const url = (rel: string) => new URL(rel, base).href
  const layoutOf = (): 'desktop' | 'mobile' => (e.stage.clientWidth < e.stage.clientHeight * 1.05 ? 'mobile' : 'desktop')
  let layout = layoutOf()
  let shown = -1
  let playing = !reduceMotion()
  // the loop's clock: ms into the choreography, or (spin) ms of turning, which drags and features move as well
  let t = spin ? 0 : beatSettled(beats, 0)
  let inView = false
  let visible = false
  const settledAt = (i: number) => (spin ? spinSettled(i, spin) : beatSettled(beats, i))

  const ac = new AbortController()
  const on = (el: EventTarget | null, type: string, fn: (ev: Event) => void, opts: AddEventListenerOptions = {}) =>
    el?.addEventListener(type, fn, { ...opts, signal: ac.signal })

  // the words and the enlarged capture follow the screen on show, outside the canvas, for everyone
  const show = (i: number) => {
    if (i === shown) return
    shown = i
    const b = beats[i]
    if (e.caption) e.caption.textContent = b.caption
    if (e.zoom) { e.zoom.src = url(b.src); e.zoom.alt = b.alt }
    for (const btn of e.beats) btn.setAttribute('aria-pressed', String(btn.dataset.g2bBeat === b.id))
  }
  const labelPlay = () => {
    if (!e.play) return
    e.play.textContent = playing ? 'Pause' : 'Play'
    e.play.setAttribute('aria-label', playing ? 'Pause the demo' : 'Play the demo')
  }
  const beatIndex = (id: string | undefined) => Math.max(0, beats.findIndex((b) => b.id === id))
  show(0)
  labelPlay()

  // ── fallback: the recorded video of the same loop, seeked to the same screens ───────────────────────
  const fallback = (why: string): Showcase => {
    const media = layout === 'mobile' ? config.videoFallback.mobile : config.videoFallback.landscape
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.preload = 'metadata'
    video.poster = url(layout === 'mobile' ? config.poster.mobile : config.poster.desktop)
    video.setAttribute('aria-label', beats.map((b) => b.caption).join(' '))
    for (const [src, type] of [[media.webm, 'video/webm'], [media.mp4, 'video/mp4']] as const) {
      const s = document.createElement('source')
      s.src = url(src)
      s.type = type
      video.append(s)
    }
    e.stage.append(video)
    root.classList.add('is-video')
    if (e.explore) e.explore.hidden = true
    if (e.status) e.status.textContent = why
    // the caption follows the screen on show: the spin changes it edge-on (the nearest face), the choreography as it lands
    const settle = () => {
      const now = video.currentTime * 1000
      let i = 0
      if (spin) i = ((Math.round((2 * now) / spin.revolutionMs) % beats.length) + beats.length) % beats.length
      else for (let k = 0; k < beats.length; k++) if (now >= settledAt(k) - 600) i = k
      show(i)
    }
    on(video, 'timeupdate', settle)
    for (const btn of e.beats) on(btn, 'click', () => { video.currentTime = settledAt(beatIndex(btn.dataset.g2bBeat)) / 1000; settle() })
    on(e.play, 'click', () => { playing = !playing; labelPlay(); if (playing) void video.play().catch(() => {}); else video.pause() })
    if (playing) void video.play().catch(() => { playing = false; labelPlay() })
    return { stats: () => ({ frames: 0, fps: 0, layout, mode: 'video', turns: 0 }), destroy: () => { ac.abort(); video.remove(); root.classList.remove('is-video') } }
  }

  if (!webglAvailable()) return fallback('3D is not available in this browser; showing the recorded demo.')

  // ── the 3D stage ───────────────────────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'The app on G2 glasses, in 3D. The buttons change the screen; drag to turn the glasses.')
  e.stage.append(canvas)
  let built: { stage: Stage; captures: Capture[] }
  try {
    built = await build(canvas, config, url, layout === 'desktop')
  } catch (err) {
    canvas.remove()
    console.warn('[g2b] 3D unavailable, using the video', err)
    return fallback('The 3D view could not load; showing the recorded demo.')
  }
  const { stage, captures } = built
  stage.spinFit = !!spin

  const presets = () => config.cameraPresets[layout]
  const spinCamera = (): Pose => poseOf(spin?.camera[layout])
  let tween: Tween | null = null
  let controls: OrbitControlsType | null = null
  let raf = 0
  let ticking = false
  let last = 0
  let frames = 0
  let fps = 0
  let fpsFrames = 0
  let fpsFrom = 0
  let dirty = true

  // ── the turn's other inputs: the page's scroll (smoothed), a sideways drag and its coast, the float's own clock ──
  const scrollProgress = () => {
    const r = e.stage.getBoundingClientRect()
    return Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)))
  }
  let scrollTarget = spin ? spin.scrollTurns * (scrollProgress() - 0.5) : 0
  let scrollNow = scrollTarget
  // the first frame is the first screen, square on, as on the poster; the scroll turns it from there
  if (spin) t = -scrollNow * spin.revolutionMs
  let floatClock = 0
  let drag: { id: number; x: number; at: number; v: number } | null = null
  let coast = 0
  const turnsNow = () => (spin ? t / spin.revolutionMs + scrollNow : 0)
  const frameNow = (): Frame =>
    spin ? spinFrameAt(beats, spin, spin.camera[layout], t, scrollNow, floatClock) : frameAt(beats, presets(), t, config.holdDrift ?? 0)

  const apply = (f: Frame) => {
    stage.setPose(f.pose)
    stage.setSpin(f.spin, f.bob)
    stage.setCaptures(captures[f.beat], f.from >= 0 ? captures[f.from] : null, f.mix)
    show(f.mix >= 0.5 || f.from < 0 ? f.beat : f.from)
  }

  const tick = (now: number) => {
    raf = 0
    ticking = true
    const wasDirty = dirty
    dirty = false
    const dt = last ? Math.min(100, now - last) : 16
    last = now
    let moving = false
    if (controls) {
      moving = controls.update(dt / 1000)
    } else if (tween?.kind === 'pose') {
      const tw = tween
      const u = Math.min(1, (now - tw.start) / tw.ms)
      const fade = tw.fromBeat === tw.beat ? 1 : Math.min(1, Math.max(0, (u - 0.2) / 0.5))
      stage.setPose(mixPose(tw.from, tw.to, u))
      stage.setCaptures(captures[tw.beat], tw.fromBeat !== tw.beat ? captures[tw.fromBeat] : null, fade)
      show(fade >= 0.5 ? tw.beat : tw.fromBeat)
      moving = true
      if (u >= 1) {
        if (!spin) t = beatSettled(beats, tw.beat)
        tween = null
      }
    } else if (tween?.kind === 'turn' && spin) {
      const tw = tween
      const u = Math.min(1, (now - tw.start) / tw.ms)
      const h = tw.h0 + (tw.h1 - tw.h0) * ease(u)
      if (playing) floatClock += dt
      const f = spinFrameAt(beats, spin, spin.camera[layout], 0, h / 2, floatClock)
      f.pose = mixPose(tw.camFrom, spinCamera(), u)
      // the screen we left until the first edge-on moment on the way, then the chosen one; none flash past between
      const past = tw.h1 >= tw.h0 ? h - tw.edge : tw.edge - h
      if (tw.fromBeat === tw.beat || past > SPIN_SWAP) { f.beat = tw.beat; f.from = -1; f.mix = 1 }
      else if (past < -SPIN_SWAP) { f.beat = tw.fromBeat; f.from = -1; f.mix = 1 }
      else { f.beat = tw.beat; f.from = tw.fromBeat; f.mix = (past + SPIN_SWAP) / (2 * SPIN_SWAP) }
      apply(f)
      moving = true
      if (u >= 1) {
        t = (tw.h1 / 2 - scrollNow) * spin.revolutionMs
        tween = null
      }
    } else if (spin) {
      if (playing && !drag) t += dt
      if (coast) {
        t += coast * dt * spin.revolutionMs
        coast *= Math.exp(-dt / 650)
        if (Math.abs(coast) < 2e-6) coast = 0
      }
      if (playing) {
        scrollNow += (scrollTarget - scrollNow) * (1 - Math.exp(-dt / 260))
        floatClock += dt
      }
      moving = playing || drag !== null || coast !== 0
      if (moving || wasDirty) apply(frameNow())
    } else if (playing) {
      t += dt
      apply(frameNow())
      moving = true
    } else if (wasDirty) {
      apply(frameNow())
    }
    {
      stage.render()
      frames++
      fpsFrames++
      if (now - fpsFrom >= 1000) { fps = (fpsFrames * 1000) / (now - fpsFrom); fpsFrames = 0; fpsFrom = now }
    }
    ticking = false
    // one loop only: a wake() during this frame (the controls' change event) is carried by `dirty`, not a second loop
    if (visible && (moving || dirty || tween !== null || controls !== null)) raf = requestAnimationFrame(tick)
    else last = 0
  }
  const wake = () => {
    dirty = true
    if (visible && !raf && !ticking) raf = requestAnimationFrame(tick)
  }

  const resize = () => {
    const w = e.stage.clientWidth
    const h = e.stage.clientHeight
    if (!w || !h) return
    layout = layoutOf()
    stage.setSize(w, h, Math.min(window.devicePixelRatio || 1, layout === 'mobile' ? 1.75 : 2))
    if (!controls && !tween) apply(frameNow())
    wake()
  }

  // a turn in progress stops where it is (a drag or a new choice takes over from there, without a jump back)
  const holdTurn = () => {
    if (tween?.kind !== 'turn' || !spin) return
    const u = Math.min(1, (performance.now() - tween.start) / tween.ms)
    t = ((tween.h0 + (tween.h1 - tween.h0) * ease(u)) / 2 - scrollNow) * spin.revolutionMs
    tween = null
  }

  // a feature: turn to the nearest face that shows it (the choreography glides to its composition); a cut for reduced motion
  const goTo = (i: number) => {
    if (controls) leaveExplore(false)
    const fromBeat = shown < 0 ? 0 : shown
    if (spin) {
      holdTurn()
      drag = null
      coast = 0
      const n = beats.length
      const h0 = 2 * turnsNow()
      let h1 = Math.round(h0)
      let best = Infinity
      for (let f = Math.round(h0) - n; f <= Math.round(h0) + n; f++) {
        if (((f % n) + n) % n !== i) continue
        if (Math.abs(f - h0) < best - 1e-9) { best = Math.abs(f - h0); h1 = f }
      }
      if (reduceMotion()) {
        t = (h1 / 2 - scrollNow) * spin.revolutionMs
        apply(frameNow())
        wake()
        return
      }
      const edge = h1 >= h0 ? Math.floor(h0 + 0.5) + 0.5 : Math.ceil(h0 - 0.5) - 0.5
      tween = { kind: 'turn', h0, h1, edge, camFrom: stage.poseNow(stage.aim), fromBeat, beat: i, start: performance.now(), ms: Math.min(2600, 700 + 650 * Math.abs(h1 - h0)) }
      wake()
      return
    }
    if (reduceMotion()) {
      t = beatSettled(beats, i)
      tween = null
      apply(frameNow())
      wake()
      return
    }
    tween = { kind: 'pose', from: stage.poseNow(stage.aim), to: poseOf(presets()[beats[i].preset]), fromBeat, beat: i, start: performance.now(), ms: TWEEN_MS }
    wake()
  }

  const enterExplore = async () => {
    if (controls) return
    const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
    if (controls) return
    holdTurn()
    tween = null
    drag = null
    coast = 0
    playing = false
    labelPlay()
    const c = new OrbitControls(stage.camera, canvas)
    c.target.copy(stage.aim)
    c.enableDamping = true
    c.dampingFactor = 0.08
    c.enablePan = false
    // the wheel keeps scrolling the page; Ctrl (or ⌘) + wheel and a pinch zoom (see the listeners below)
    c.enableZoom = false
    const d = stage.camera.position.distanceTo(stage.aim)
    c.minDistance = d * 0.45
    c.maxDistance = d * 2.2
    c.addEventListener('change', wake)
    controls = c
    root.classList.add('is-exploring')
    if (e.explore) { e.explore.textContent = 'Resume demo'; e.explore.setAttribute('aria-pressed', 'true') }
    if (e.status) e.status.textContent = 'Drag to turn. Pinch, or Ctrl + scroll, to zoom.'
    wake()
  }
  const leaveExplore = (resume: boolean) => {
    if (!controls) return
    const from = stage.poseNow(controls.target)
    controls.dispose()
    controls = null
    root.classList.remove('is-exploring')
    if (e.explore) { e.explore.textContent = 'Explore in 3D'; e.explore.setAttribute('aria-pressed', 'false') }
    if (e.status) e.status.textContent = ''
    const i = shown < 0 ? 0 : shown
    if (resume) {
      playing = !reduceMotion()
      // pick the scroll up where the page is now, without a lurch toward where it scrolled in the meantime
      if (playing && spin) { t += (scrollNow - scrollTarget) * spin.revolutionMs; scrollNow = scrollTarget }
      labelPlay()
      tween = { kind: 'pose', from, to: spin ? spinCamera() : poseOf(presets()[beats[i].preset]), fromBeat: i, beat: i, start: performance.now(), ms: TWEEN_MS * 1.2 }
    }
    wake()
  }

  for (const btn of e.beats) on(btn, 'click', () => goTo(beatIndex(btn.dataset.g2bBeat)))
  on(e.play, 'click', () => {
    if (controls) { leaveExplore(true); return }
    playing = !playing
    if (playing && spin) { t += (scrollNow - scrollTarget) * spin.revolutionMs; scrollNow = scrollTarget }
    // Pause means still: a flick that is still coasting stops too
    if (!playing) coast = 0
    labelPlay()
    wake()
  })
  on(e.explore, 'click', () => { if (controls) leaveExplore(true); else void enterExplore() })
  // the wheel always scrolls the page over the glasses; in Explore it zooms only with Ctrl (or ⌘), and a pinch zooms
  on(e.stage, 'wheel', (ev) => { if (controls) controls.enableZoom = (ev as WheelEvent).ctrlKey || (ev as WheelEvent).metaKey }, { capture: true, passive: true })
  on(e.stage, 'pointerdown', (ev) => { if (controls && (ev as PointerEvent).pointerType === 'touch') controls.enableZoom = true }, { capture: true })

  if (spin) {
    // scrolling the page turns the glasses (while the demo plays), up to spin.scrollTurns over the section's pass
    if (spin.scrollTurns) {
      on(window, 'scroll', () => {
        scrollTarget = spin.scrollTurns * (scrollProgress() - 0.5)
        if (playing) wake()
      }, { passive: true })
    }
    // a sideways drag turns them by hand (half a turn across the stage) and a flick coasts; vertical swipes on
    // touch still scroll the page (touch-action: pan-y), and Explore is the button
    on(canvas, 'pointerdown', (ev) => {
      const p = ev as PointerEvent
      if (controls || (p.pointerType === 'mouse' && p.button !== 0)) return
      holdTurn()
      coast = 0
      drag = { id: p.pointerId, x: p.clientX, at: performance.now(), v: 0 }
      try { canvas.setPointerCapture(p.pointerId) } catch { /* the pointer is already gone */ }
      wake()
    })
    on(canvas, 'pointermove', (ev) => {
      const p = ev as PointerEvent
      if (!drag || p.pointerId !== drag.id) return
      const now = performance.now()
      const turns = ((p.clientX - drag.x) / Math.max(240, e.stage.clientWidth)) * 0.5
      drag.v = turns / Math.max(8, now - drag.at)
      drag.x = p.clientX
      drag.at = now
      t += turns * spin.revolutionMs
      wake()
    })
    const release = (ev: Event) => {
      const p = ev as PointerEvent
      if (!drag || p.pointerId !== drag.id) return
      coast = performance.now() - drag.at < 120 ? drag.v : 0
      drag = null
      wake()
    }
    on(canvas, 'pointerup', release)
    on(canvas, 'pointercancel', release)
  } else {
    // taking hold of the glasses with a mouse or pen pauses the demo; on touch, Explore turns them (the page must scroll)
    on(canvas, 'pointerdown', (ev) => { if ((ev as PointerEvent).pointerType !== 'touch' && !controls) void enterExplore() })
  }
  on(document, 'visibilitychange', () => { visible = !document.hidden && inView; if (visible) wake() })

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting
    visible = inView && !document.hidden
    if (visible) wake()
  }, { threshold: 0.05 })
  io.observe(e.stage)
  const ro = new ResizeObserver(resize)
  ro.observe(e.stage)
  resize()
  apply(frameNow())
  stage.render()
  root.classList.add('is-live')

  return {
    stats: () => ({ frames, fps: Math.round(fps * 10) / 10, layout, mode: 'webgl', turns: turnsNow() }),
    destroy() {
      ac.abort()
      io.disconnect()
      ro.disconnect()
      if (raf) cancelAnimationFrame(raf)
      controls?.dispose()
      for (const c of captures) c.texture.dispose()
      stage.dispose()
      canvas.remove()
      root.classList.remove('is-live', 'is-exploring')
    },
  }
}
