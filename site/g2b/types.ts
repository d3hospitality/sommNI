// The showcase's one configuration per site (G2B-Site-Showcase-PRD §7). The page, the preview and every export
// read the same file, so what a visitor sees and what the video shows cannot drift apart.

/** Which lens shows the display. On the ERG2B asset, model +X is the wearer's LEFT and -X the wearer's RIGHT. */
export type Eye = 'both' | 'left' | 'right'

/** How a capture sits on the lens. The capture's aspect ratio is always preserved. */
export interface DisplaySettings {
  /** 'black': black pixels become clear glass, dim text survives; 'original': the capture's own alpha */
  mode: 'black' | 'original'
  /** capture width as a share of the lens surface's width, 0..1 */
  scale: number
  /** centre offset as a share of the lens surface, x to the wearer's left, y up */
  x: number
  y: number
  /** 0..1 */
  opacity: number
  /** a multiplier on the capture's colour; 1 = as captured */
  brightness: number
}

/**
 * A camera composition, relative to the product: yaw 0 looks at the front (the side the display text reads
 * from), positive yaw swings toward the wearer's left temple; pitch is elevation. zoom 1 frames the whole
 * product for the viewport; above 1 is closer. lift and truck move the aim point in product widths.
 */
export interface CameraPreset {
  yaw: number
  pitch: number
  zoom: number
  lift?: number
  truck?: number
}

/** One content beat: the camera moves to `preset` over moveMs, then holds for holdMs with this capture. */
export interface Beat {
  id: string
  /** a real capture, relative to the config file */
  src: string
  kind?: 'image' | 'video'
  moveMs: number
  holdMs: number
  preset: string
  /** what the capture actually shows, for the caption outside the canvas */
  caption: string
  /** alt text for the enlarged capture */
  alt: string
}

/**
 * The spin: the glasses turn on their own axis like a product on a turntable, lingering while a face looks at
 * the camera (the outside, then the wearer's side) and gliding through the edge-on moments, where the screen
 * changes out of sight. Each face shows the next screen, so a turn shows two. Scrolling the page turns them too.
 * Without it the loop is the choreography of `cameraPresets` and the beats' moveMs / holdMs.
 */
export interface SpinMotion {
  mode: 'spin'
  /** one whole turn, in ms, while playing */
  revolutionMs: number
  /** 0 to 0.49: how much the turn slows while a face looks at the camera (0 = a constant speed) */
  linger: number
  /** turns added as the section scrolls from entering the viewport to leaving it (0 = scrolling does not turn) */
  scrollTurns: number
  /** how high the glasses float while they turn, as a share of their height, and its period (keep the loop a whole number of periods) */
  float?: number
  floatMs?: number
  /** the camera for each layout; zoom 1 = every angle of the turn fits the frame */
  camera: { desktop: CameraPreset; mobile: CameraPreset }
}

/**
 * The render's levels, per site: every field is optional and falls back to the stage's tone defaults (shown), so
 * a site without a `look` renders exactly as before.
 */
export interface Look {
  /** tone-mapping exposure (dark 1.12, light 1.08) */
  exposure?: number
  /** light from the studio room around the product (dark 0.85, light 1.15) */
  environment?: number
  /** sky-and-ground fill (dark 0.4, light 0.7), the key light (3.2) and the rim light behind (1.7) */
  fill?: number
  key?: number
  rim?: number
  /** how much of the room the frame, temples and pads reflect (1.1), and the lens glass (dark 0.22, light 0.9) */
  reflections?: number
  glass?: number
  /** a multiplier on the colour of everything but the lenses: 1 = as modelled, lower is darker */
  frame?: number
  /** the shadow's strength on the section colour (dark 0.42, light 0.16) */
  shadow?: number
}

export interface MediaPair { webm: string; mp4: string }

export interface ShowcaseConfig {
  site: string
  /** the derived web model, relative to the config file */
  model: string
  /** how lenses are found and how the display is placed on this model; swap the model by swapping the adapter */
  assetAdapter: 'erg2b'
  eye: Eye
  /** the section colour behind the product; the canvas renders on it, the exports use it too */
  background: string
  /** 'dark' or 'light' studio lighting for that background */
  tone: 'dark' | 'light'
  displaySettings: DisplaySettings
  cameraPresets: { desktop: Record<string, CameraPreset>; mobile: Record<string, CameraPreset> }
  /** the loop, in order; its last beat returns to the first */
  timeline: Beat[]
  poster: { desktop: string; mobile: string }
  videoFallback: { landscape: MediaPair; mobile: MediaPair }
  /** the short label on each feature button, by beat id */
  featureCaptions: Record<string, string>
  /** degrees of slow drift during a hold (0 = perfectly still while reading) */
  holdDrift?: number
  /** the turntable (see SpinMotion); absent = the camera choreography */
  motion?: SpinMotion
  /** the render's levels (see Look); absent = the tone's defaults */
  look?: Look
}

/** A resolved camera pose at an instant of the loop. */
export interface Pose { yaw: number; pitch: number; zoom: number; lift: number; truck: number }

/** Everything the stage needs to draw one instant: the pose, and which capture(s) show at what mix. */
export interface Frame {
  pose: Pose
  /** index of the beat whose capture is (becoming) current */
  beat: number
  /** index of the capture fading out, or -1 */
  from: number
  /** 0..1 share of the current capture; 1 when settled */
  mix: number
  /** true while holding (reading), false while moving */
  holding: boolean
  /** the model's turn about its vertical axis, in degrees (0 = the outside faces the camera) */
  spin: number
  /** how high it floats, as a share of its height */
  bob: number
}
