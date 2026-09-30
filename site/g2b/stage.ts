// The Three.js half: the G2B model, the display on its lenses, the light and the camera. No page, no timeline,
// no controls: the showcase (a page) and the exporter (fixed-size frames) both drive it through setPose,
// setCaptures and render, so both draw exactly the same thing.
//
// The lens mapping is the local studio's (Documents/Codex/2026-09-23/oka/outputs/3d/main.js): the display is a
// copy of each lens's outside surface, so it follows the model, is clipped by the real aperture, and sits
// behind the frame through the ordinary depth test.
//
// Rear-view policy (PRD §6): never mirrored. The outside surface carries the screen as a presentation, readable
// from the front; the inside surface carries it as the wearer reads it, readable from behind. Each is hidden
// from its other side, so a turning pair shows one readable screen per face.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { DisplaySettings, Eye, Look, Pose } from './types'

export interface StageOptions {
  background: string
  tone: 'dark' | 'light'
  /** a transparent canvas, with the lens glass approximated (a still cannot refract a background added later) */
  transparent?: boolean
  shadows?: boolean
  preserveDrawingBuffer?: boolean
  pixelRatio?: number
  /** the site's levels; anything left out keeps the tone's default */
  look?: Look
}

// ── asset adapters: how a model's lenses are found and where its display sits ─────────────────────────
interface AssetAdapter {
  isLens(node: THREE.Object3D): boolean
  /** the outward direction of the lens front in model space, and how squarely a triangle must face it */
  front: THREE.Vector3
  minFacing: number
  /** how far the display rides above the glass, in model units: enough to never z-fight */
  lift: number
}

const ADAPTERS: Record<string, AssetAdapter> = {
  // ERG2B: two meshes named "Left | optical lens" / "Right | optical lens"; model +X is the wearer's left
  erg2b: {
    isLens: (n) => /optical lens/i.test(String(n.userData.name || n.name)),
    front: new THREE.Vector3(0, 0, 1),
    minFacing: 0.55,
    lift: 0.00012,
  },
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Two captures change like a page turn (out, then in); black becomes clear glass (the studio's "Remove black": alpha rises from level 8 to 32
// of 255, so dim text survives); the capture keeps its aspect ratio and anything outside it is clear.
const FRAGMENT = /* glsl */ `
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uHasCur;
uniform float uHasPrev;
uniform float uMix;
uniform vec2 uScaleCur;
uniform vec2 uScalePrev;
uniform vec2 uOffset;
uniform float uOpacity;
uniform float uBrightness;
uniform float uKey;
varying vec2 vUv;

vec4 capture(sampler2D tex, vec2 scale) {
  vec2 c = (vUv - 0.5 - uOffset) / scale + 0.5;
  if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) return vec4(0.0);
  vec4 s = texture2D(tex, c);
  float level = max(s.r, max(s.g, s.b)) * 255.0;
  float a = uKey > 0.5 ? clamp((level - 8.0) / 24.0, 0.0, 1.0) * s.a : s.a;
  return vec4(min(s.rgb * uBrightness, vec3(1.0)), a);
}

void main() {
  vec4 cur = uHasCur > 0.5 ? capture(uCur, uScaleCur) : vec4(0.0);
  vec4 prev = uHasPrev > 0.5 ? capture(uPrev, uScalePrev) : vec4(0.0);
  // a page change, as the glasses do it: the old screen is gone before the new one appears (never both at once)
  float wc = cur.a * clamp(2.0 * uMix - 1.0, 0.0, 1.0);
  float wp = prev.a * clamp(1.0 - 2.0 * uMix, 0.0, 1.0);
  float a = wc + wp;
  if (a < 0.002) discard;
  gl_FragColor = vec4((cur.rgb * wc + prev.rgb * wp) / a, a * uOpacity);
}`

interface LensDisplay { mesh: THREE.Mesh; material: THREE.ShaderMaterial; eye: 'left' | 'right'; side: 'outside' | 'inside'; wShare: number; hShare: number }

/** a capture on the GPU: raw sRGB bytes (the display shader writes them as captured), with its aspect ratio */
export interface Capture { texture: THREE.Texture; aspect: number; video?: HTMLVideoElement }

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.001, 20)
  /** where the camera aims: the product's centre plus the pose's lift and truck */
  readonly aim = new THREE.Vector3()
  private home = new THREE.Vector3()
  private size = new THREE.Vector3()
  private bounds = new THREE.Box3()
  private model: THREE.Object3D | null = null
  /** the turntable: the model turns on this group's vertical axis, through the product's centre, and floats with it */
  private pivot = new THREE.Group()
  /** the farthest any part of the model gets from that axis */
  private spinRadius = 0
  /** fit the camera to every angle of a turn, not only the current one, so a spinning product never breathes */
  spinFit = false
  private displays: LensDisplay[] = []
  private env: THREE.Texture | null = null
  private ground: THREE.Mesh
  private look: Required<Look>

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: !!opts.transparent,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer, powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    const dark = opts.tone === 'dark'
    // on a dark section the studio's bright room reflected in the glass reads as a milky veil over the display:
    // less room light, and much less of it in the lenses (their key-light highlights stay, so they still read as glass)
    const L = (this.look = {
      exposure: dark ? 1.12 : 1.08, environment: dark ? 0.85 : 1.15, fill: dark ? 0.4 : 0.7, key: 3.2, rim: 1.7,
      reflections: 1.1, glass: dark ? 0.22 : 0.9, frame: 1, shadow: dark ? 0.42 : 0.16,
      ...Object.fromEntries(Object.entries(opts.look ?? {}).filter(([, v]) => typeof v === 'number')),
    })
    this.renderer.toneMappingExposure = L.exposure
    this.renderer.shadowMap.enabled = opts.shadows !== false
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const room = new RoomEnvironment()
    this.env = pmrem.fromScene(room, 0.035).texture
    room.dispose()
    pmrem.dispose()
    this.scene.environment = this.env
    this.scene.environmentIntensity = L.environment
    if (opts.transparent) this.renderer.setClearColor(0x000000, 0)
    else this.scene.background = new THREE.Color(opts.background)

    this.scene.add(new THREE.HemisphereLight(0xf7fbff, 0xbeb7a9, L.fill))
    const key = new THREE.DirectionalLight(0xfff6e9, L.key)
    key.position.set(-0.25, 0.4, 0.35)
    key.castShadow = opts.shadows !== false
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -0.25, right: 0.25, top: 0.25, bottom: -0.25, near: 0.01, far: 1.5 })
    key.shadow.bias = -0.00003
    key.shadow.normalBias = 0.00003
    key.shadow.radius = 3
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0xe1ebff, L.rim)
    rim.position.set(0.3, 0.18, -0.2)
    this.scene.add(rim)
    // a shadow catcher: the product rests on the section's own colour instead of a studio floor
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: L.shadow }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = -0.0005
    this.ground.receiveShadow = true
    this.scene.add(this.ground)
    this.scene.add(this.pivot)
  }

  /** load the model once; throws if the adapter cannot find exactly two lenses */
  async load(url: string, adapterName: string): Promise<void> {
    const adapter = ADAPTERS[adapterName]
    if (!adapter) throw new Error(`unknown asset adapter "${adapterName}"`)
    const loader = new GLTFLoader()
    loader.setMeshoptDecoder(MeshoptDecoder)
    const gltf = await loader.loadAsync(url)
    const model = gltf.scene
    // materials are shared between meshes: set each one once (a colour multiplied twice would darken twice)
    const seen = new Set<THREE.Material>()
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const name = String(mesh.userData.name || mesh.name)
      mesh.castShadow = !/lens|pad|silicone/i.test(name)
      mesh.receiveShadow = true
      const glass = adapter.isLens(mesh)
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        if (!m || seen.has(m)) continue
        seen.add(m)
        const s = m as THREE.MeshStandardMaterial
        if ('envMapIntensity' in s) s.envMapIntensity = glass ? this.look.glass : this.look.reflections
        if (!glass && this.look.frame !== 1 && s.color) s.color.multiplyScalar(this.look.frame)
      }
    })
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    box.getSize(this.size)
    model.position.set(-center.x, -box.min.y + 0.0008, -center.z)
    this.pivot.add(model)
    model.updateMatrixWorld(true)
    this.bounds.setFromObject(model)
    // the turntable's reach, from the real vertices (the bounding box's corners overstate it)
    const v = new THREE.Vector3()
    model.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const pos = mesh.geometry.attributes.position
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
        this.spinRadius = Math.max(this.spinRadius, Math.hypot(v.x, v.z))
      }
    })
    this.home.set(0, this.size.y * 0.44, 0)
    this.aim.copy(this.home)
    this.model = model

    const lenses: THREE.Mesh[] = []
    model.traverse((n) => { if ((n as THREE.Mesh).isMesh && adapter.isLens(n)) lenses.push(n as THREE.Mesh) })
    if (lenses.length !== 2) throw new Error(`expected two lenses, found ${lenses.length}`)
    const toRoot = new THREE.Matrix4().copy(model.matrixWorld).invert()
    for (const lens of lenses) for (const side of ['outside', 'inside'] as const) this.displays.push(this.lensDisplay(model, lens, toRoot, adapter, side))
  }

  private lensDisplay(model: THREE.Object3D, lens: THREE.Mesh, toRoot: THREE.Matrix4, adapter: AssetAdapter, side: 'outside' | 'inside'): LensDisplay {
    const m = new THREE.Matrix4().multiplyMatrices(toRoot, lens.matrixWorld)
    const pos = lens.geometry.attributes.position
    const index = lens.geometry.index
    const pts: THREE.Vector3[] = []
    const bounds = new THREE.Box3()
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m)
      pts.push(v)
      bounds.expandByPoint(v)
    }
    const w = bounds.max.x - bounds.min.x
    const h = bounds.max.y - bounds.min.y
    const span = Math.max(w, h)
    const cx = (bounds.min.x + bounds.max.x) / 2
    const cy = (bounds.min.y + bounds.max.y) / 2
    const positions: number[] = []
    const uvs: number[] = []
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const n = new THREE.Vector3()
    // the inside faces the wearer: its triangles face the other way, it rides the glass on the wearer's side, and
    // its u runs toward the wearer's right, so the capture reads the right way round from behind
    const sign = side === 'outside' ? 1 : -1
    const lift = adapter.front.clone().multiplyScalar(adapter.lift * sign)
    const count = index ? index.count : pos.count
    for (let i = 0; i < count; i += 3) {
      const tri = [0, 1, 2].map((j) => pts[index ? index.getX(i + j) : i + j])
      a.subVectors(tri[1], tri[0])
      b.subVectors(tri[2], tri[0])
      n.crossVectors(a, b).normalize()
      // one optical surface only (this side's), never the lens's edge wall
      if (sign * n.dot(adapter.front) < adapter.minFacing) continue
      for (const v of tri) {
        positions.push(v.x + lift.x, v.y + lift.y, v.z + lift.z)
        uvs.push(0.5 + (sign * (v.x - cx)) / span, 0.5 + (v.y - cy) / span)
      }
    }
    if (!positions.length) throw new Error('lens surface mapping failed')
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCur: { value: null }, uPrev: { value: null }, uHasCur: { value: 0 }, uHasPrev: { value: 0 }, uMix: { value: 1 },
        uScaleCur: { value: new THREE.Vector2(0.8, 0.4) }, uScalePrev: { value: new THREE.Vector2(0.8, 0.4) },
        uOffset: { value: new THREE.Vector2() }, uOpacity: { value: 0.92 }, uBrightness: { value: 1.8 }, uKey: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      // FrontSide: each surface is seen only from its own side, so neither is ever seen mirrored
      side: THREE.FrontSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 20
    mesh.name = `G2B display (${side})`
    model.add(mesh)
    // model +X is the wearer's left (PRD §6)
    return { mesh, material, eye: cx > 0 ? 'left' : 'right', side, wShare: w / span, hShare: h / span }
  }

  /** placement, keying and which eye; the capture keeps its aspect ratio */
  setDisplay(s: DisplaySettings, eye: Eye): void {
    for (const d of this.displays) {
      d.mesh.visible = eye === 'both' || eye === d.eye
      const u = d.material.uniforms
      u.uOpacity.value = s.opacity
      u.uBrightness.value = s.brightness
      u.uKey.value = s.mode === 'black' ? 1 : 0
      // x is toward the wearer's left, which is the inside surface's -u
      u.uOffset.value.set(s.x * d.wShare * (d.side === 'inside' ? -1 : 1), s.y * d.hShare)
      d.mesh.userData.scale = s.scale * d.wShare
    }
  }

  /** the capture that is (becoming) current, the one fading out, and the mix between them */
  setCaptures(cur: Capture | null, prev: Capture | null, mix: number): void {
    for (const d of this.displays) {
      const u = d.material.uniforms
      const width = d.mesh.userData.scale ?? 0.8 * d.wShare
      u.uCur.value = cur?.texture ?? null
      u.uHasCur.value = cur ? 1 : 0
      if (cur) u.uScaleCur.value.set(width, width / cur.aspect)
      u.uPrev.value = prev?.texture ?? null
      u.uHasPrev.value = prev ? 1 : 0
      if (prev) u.uScalePrev.value.set(width, width / prev.aspect)
      u.uMix.value = prev ? mix : 1
    }
  }

  /** the turntable: the model's turn about its vertical axis in degrees (0 = the outside faces front) and its float */
  setSpin(degrees: number, bob = 0): void {
    this.pivot.rotation.y = THREE.MathUtils.degToRad(degrees)
    this.pivot.position.y = bob * this.size.y
  }

  /** the camera for a pose: the whole product fitted to this viewport, then brought closer by zoom */
  setPose(p: Pose): void {
    const dir = direction(p.yaw, p.pitch)
    this.aim.copy(this.home).add(new THREE.Vector3(p.truck * this.size.x, p.lift * this.size.y, 0))
    const distance = this.fit(dir, this.aim) / Math.max(0.2, p.zoom)
    this.camera.position.copy(this.aim).addScaledVector(dir, distance)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.aim)
  }

  /** the pose the camera is in now (after free exploration), so a resumed demo can glide back from it */
  poseNow(target: THREE.Vector3): Pose {
    const offset = new THREE.Vector3().subVectors(this.camera.position, target)
    const distance = offset.length() || 1
    const dir = offset.divideScalar(distance)
    const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)))
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(dir.x, dir.z))
    return {
      yaw, pitch, zoom: this.fit(dir, target) / distance,
      lift: this.size.y ? (target.y - this.home.y) / this.size.y : 0,
      truck: this.size.x ? (target.x - this.home.x) / this.size.x : 0,
    }
  }

  /**
   * The distance at which the product fits this viewport, padded: every corner of its bounds, or for a spinning
   * product the rim of the cylinder it sweeps (so no angle of the turn ever leaves the frame).
   */
  private fit(dir: THREE.Vector3, target: THREE.Vector3): number {
    if (this.bounds.isEmpty()) return 0.45
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize()
    const up = new THREE.Vector3().crossVectors(dir, right).normalize()
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const tanH = tanV * Math.max(this.camera.aspect, 0.05)
    const points: THREE.Vector3[] = []
    if (this.spinFit) {
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2
        for (const y of [this.bounds.min.y, this.bounds.max.y]) points.push(new THREE.Vector3(Math.cos(a) * this.spinRadius, y, Math.sin(a) * this.spinRadius))
      }
    } else {
      for (const x of [this.bounds.min.x, this.bounds.max.x]) for (const y of [this.bounds.min.y, this.bounds.max.y]) for (const z of [this.bounds.min.z, this.bounds.max.z]) points.push(new THREE.Vector3(x, y, z))
    }
    // the cylinder is already roomier than the glasses at any one angle, so it needs less padding than the box
    const pad = this.spinFit ? 1.06 : 1.16
    let d = 0
    for (const p of points) {
      const c = p.sub(target)
      const depth = c.dot(dir)
      d = Math.max(d, depth + (pad * Math.abs(c.dot(right))) / tanH, depth + (pad * Math.abs(c.dot(up))) / tanV, depth + this.camera.near * 4)
    }
    return d
  }

  setSize(width: number, height: number, pixelRatio?: number): void {
    if (pixelRatio) this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  dispose(): void {
    for (const d of this.displays) { d.mesh.geometry.dispose(); d.material.dispose() }
    this.displays = []
    this.model?.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material])) {
        for (const value of Object.values(m)) if ((value as THREE.Texture)?.isTexture) (value as THREE.Texture).dispose()
        m.dispose()
      }
    })
    this.ground.geometry.dispose()
    ;(this.ground.material as THREE.Material).dispose()
    this.env?.dispose()
    this.renderer.dispose()
  }
}

/** yaw 0 looks at the front of the glasses (+Z); positive yaw swings toward the wearer's left (+X) */
export function direction(yaw: number, pitch: number): THREE.Vector3 {
  const y = THREE.MathUtils.degToRad(yaw)
  const p = THREE.MathUtils.degToRad(pitch)
  return new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p))
}

/** a still capture, decoded before it is ever shown, uploaded as raw sRGB with mipmaps for oblique angles */
export async function loadImageCapture(url: string, renderer: THREE.WebGLRenderer): Promise<Capture> {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  const texture = new THREE.Texture(img)
  texture.colorSpace = THREE.NoColorSpace
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.needsUpdate = true
  renderer.initTexture(texture)
  return { texture, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) }
}
