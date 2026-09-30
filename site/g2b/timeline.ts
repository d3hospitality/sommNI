// The loop, as pure arithmetic: for any instant, which pose the camera holds and which capture shows at what mix.
// The page, the preview and the exporter all call frameAt(), so a recorded frame is exactly what a visitor sees.
import type { Beat, CameraPreset, Frame, Pose, SpinMotion } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** ease in and out: a move starts and lands without a jolt */
export const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

export function loopMs(beats: Beat[]): number {
  return beats.reduce((sum, b) => sum + b.moveMs + b.holdMs, 0)
}

/** when beat i starts moving, on the loop */
export function beatStart(beats: Beat[], i: number): number {
  let t = 0
  for (let k = 0; k < i; k++) t += beats[k].moveMs + beats[k].holdMs
  return t
}

/** when beat i's capture is fully shown and the camera has landed: the start of its hold */
export function beatSettled(beats: Beat[], i: number): number {
  return beatStart(beats, i) + beats[i].moveMs
}

export function poseOf(p: CameraPreset | undefined): Pose {
  return { yaw: p?.yaw ?? 0, pitch: p?.pitch ?? 8, zoom: p?.zoom ?? 1, lift: p?.lift ?? 0, truck: p?.truck ?? 0 }
}

export function mixPose(a: Pose, b: Pose, u: number): Pose {
  const e = ease(clamp(u, 0, 1))
  const lerp = (x: number, y: number) => x + (y - x) * e
  return { yaw: lerp(a.yaw, b.yaw), pitch: lerp(a.pitch, b.pitch), zoom: lerp(a.zoom, b.zoom), lift: lerp(a.lift, b.lift), truck: lerp(a.truck, b.truck) }
}

// The new capture arrives in the second half of a move: the camera settles as the screen changes, and nothing
// changes while the visitor is reading (PRD §5: change content during a hold or a quiet transition).
const FADE_FROM = 0.5
const FADE_TO = 0.8

export function frameAt(beats: Beat[], presets: Record<string, CameraPreset>, tMs: number, holdDrift = 0): Frame {
  const total = loopMs(beats)
  if (!beats.length || total <= 0) return { pose: poseOf(undefined), beat: 0, from: -1, mix: 1, holding: true, spin: 0, bob: 0 }
  let t = ((tMs % total) + total) % total
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i]
    const prev = (i - 1 + beats.length) % beats.length
    const from = poseOf(presets[beats[prev].preset])
    const to = poseOf(presets[b.preset])
    if (t < b.moveMs) {
      const u = t / b.moveMs
      const fade = clamp((u - FADE_FROM) / (FADE_TO - FADE_FROM), 0, 1)
      return { pose: mixPose(from, to, u), beat: i, from: fade < 1 && prev !== i ? prev : -1, mix: fade, holding: false, spin: 0, bob: 0 }
    }
    t -= b.moveMs
    if (t < b.holdMs) {
      const pose = { ...to }
      // a slow sway that leaves and returns to the preset with zero speed at both ends, so holds read as still
      if (holdDrift) pose.yaw += holdDrift * (1 - Math.cos((2 * Math.PI * t) / b.holdMs)) / 2
      return { pose, beat: i, from: -1, mix: 1, holding: true, spin: 0, bob: 0 }
    }
    t -= b.holdMs
  }
  return { pose: poseOf(presets[beats[0].preset]), beat: 0, from: -1, mix: 1, holding: true, spin: 0, bob: 0 }
}

// ── the spin (motion.mode 'spin') ─────────────────────────────────────────────────────────────────────
// The glasses turn on their own axis. Positions are in turns: a face looks at the camera at every half turn (the
// outside at whole turns, the wearer's side at the halves) and the glasses are edge-on at the quarters, which is
// where one screen gives way to the next, out of sight. Face k shows screen k mod n.

/** the model's angle in degrees at a position in turns; linger slows the faces and speeds the edges (0 = even) */
export function spinAngle(turns: number, linger: number): number {
  return 360 * turns - (linger * Math.sin(4 * Math.PI * turns) * 180) / Math.PI
}

/** a loop shows every screen once on a face, two faces a turn, and ends where it began */
export function spinLoopMs(beats: Beat[], m: SpinMotion): number {
  const n = Math.max(1, beats.length)
  return (n % 2 === 0 ? n / 2 : n) * m.revolutionMs
}

/** when screen i faces the camera, from the start of the loop */
export function spinSettled(i: number, m: SpinMotion): number {
  return (i * m.revolutionMs) / 2
}

/** half turns either side of an edge-on moment over which the screen changes (nearly out of sight there) */
export const SPIN_SWAP = 0.07

/**
 * The spin at tMs of its clock, plus `extraTurns` (the page's scroll). The float runs on its own clock (floatMs,
 * default tMs) so a page can move the turn without jolting the float.
 */
export function spinFrameAt(beats: Beat[], m: SpinMotion, camera: CameraPreset | undefined, tMs: number, extraTurns = 0, floatClockMs = tMs): Frame {
  const n = Math.max(1, beats.length)
  const turns = tMs / m.revolutionMs + extraTurns
  const h = turns * 2
  const face = Math.round(h)
  const between = h - Math.floor(h)
  const lo = ((Math.floor(h) % n) + n) % n
  let beat = ((face % n) + n) % n
  let from = -1
  let mix = 1
  if (Math.abs(between - 0.5) < SPIN_SWAP) {
    from = lo
    beat = (lo + 1) % n
    mix = (between - (0.5 - SPIN_SWAP)) / (2 * SPIN_SWAP)
  }
  const bob = (m.float ?? 0) * Math.sin((2 * Math.PI * floatClockMs) / (m.floatMs ?? 8000))
  return { pose: poseOf(camera), beat, from: from === beat ? -1 : from, mix, holding: Math.abs(h - face) < 0.2, spin: spinAngle(turns, m.linger), bob }
}
