// The develop pipeline: settings and source → the parameters every stage uses (prepare), and a CPU reference
// implementation of every stage (renderReference). The GPU pipeline (src/renderer/src/develop/gl.ts) runs the same
// stages with the same parameters; tests compare the two.
//
// Order of operations (docs/DEVELOP_PRD.md PL-4):
//   source → white balance and camera colour (linear Rec.2020, scene-referred) → exposure → highlights / shadows
//   (judged on local brightness) → contrast → [log LUTs here, replacing the tone map] → tone map (whites, blacks) →
//   display-referred → tone curve → colour (HSL, vibrance, saturation, B&W) → display LUT → noise reduction and
//   sharpening → output colour space.

import {
  bradford,
  cameraMultipliers,
  cameraTempTint,
  convert,
  D65,
  decodeFrom,
  encodeFor,
  fromOklab,
  inv3,
  LUT_SPACES,
  luma,
  mul3,
  mulM,
  SPACES,
  srgbDecode,
  srgbEncode,
  toOklab,
  whiteXY,
  type CameraColor,
  type Mat3,
  type Vec3
} from './color'
import { curveIsIdentity, curveTable, sampleCurve } from './curves'
import { applyLut, type Lut } from './lut'
import { WB_PRESETS, type DevelopSettings, type SourceKind } from './settings'

/** What the pipeline needs to know about a source image. */
export interface SourceInfo {
  kind: SourceKind
  /** Full-resolution size, for scaling neighbourhood effects (sharpening radius etc.) at other sizes. */
  fullWidth: number
  /** Raw files: the camera's colour (LibRaw). */
  camera?: CameraColor
  /** Grey-world multipliers measured on the image, for Auto white balance (camera RGB for raw, linear sRGB otherwise). */
  autoMul?: Vec3
}

export type OutputSpace = 'srgb' | 'p3' | 'adobergb'

export interface Params {
  /** Raw: per-channel white balance multipliers (camera RGB). Others: 1. */
  preMul: Vec3
  /** Raw: clip level after white balance (keeps clipped highlights neutral); Infinity for others. */
  clip: number
  /** Source → linear Rec.2020: camera matrix (raw) or white balance adaptation (others). */
  inputMatrix: Mat3
  /** The source is sRGB-encoded and must be decoded first. */
  decodeSrgb: boolean
  exposure: number
  shadows: number
  highlights: number
  contrast: number
  /** Stretch of the tone curve above grey (whites) and below it (blacks). */
  white: number
  blacks: number
  curve: Float32Array | null
  vibrance: number
  saturation: number
  hue: number[]
  sat: number[]
  lum: number[]
  bw: boolean
  bwMix: number[]
  lut: { amount: number; log: boolean; space: number; toLut: Mat3; fromLut: Mat3 } | null
  /** Neighbourhood effects, with radii in pixels at the render's scale. */
  detail: { sharpen: number; sharpenSigma: number; limit: number; masking: number; lumNr: number; lumSigma: number; colorNr: number; colorSigma: number }
  outputMatrix: Mat3
  /** The white balance actually used (kelvin and tint for raw), for the interface. */
  wb: { temp: number; tint: number }
}

/** Middle grey in the scene; the tone map puts it at display 0.18 (sRGB 0.46). */
export const GREY = 0.18
/** Local brightness grid: cells along the long edge. */
export const GRID_CELLS = 96
export const HUE_CENTERS = [29, 60, 105, 142, 195, 264, 300, 330]

export function prepare(s: DevelopSettings, src: SourceInfo, scale = 1, out: OutputSpace = 'srgb'): Params {
  let preMul: Vec3 = [1, 1, 1]
  let clip = Infinity
  let inputMatrix: Mat3
  let wb = { temp: s.wb.temp, tint: s.wb.tint }
  const srgbToRec2020 = convert('srgb', 'rec2020')
  if (src.kind === 'raw' && src.camera) {
    const cam = src.camera
    let mul: Vec3
    if (s.wb.mode === 'asShot') {
      mul = normalizeG(cam.asShot)
      wb = cameraTempTint(cam, mul)
    } else if (s.wb.mode === 'auto' && src.autoMul) {
      mul = normalizeG(src.autoMul)
      wb = cameraTempTint(cam, mul)
    } else {
      const p = WB_PRESETS[s.wb.mode]
      wb = p ? { temp: p.temp, tint: p.tint } : { temp: s.wb.temp, tint: s.wb.tint }
      mul = cameraMultipliers(cam, wb.temp, wb.tint)
    }
    preMul = mul
    // A clipped sensor channel, scaled by its multiplier, would turn highlights pink: clip all at the lowest.
    clip = Math.min(mul[0], mul[1], mul[2])
    inputMatrix = mulM(srgbToRec2020, cam.rgbCam)
  } else {
    // Other files: white balance is a relative shift, adapting from a white that's warmer/cooler and greener/pinker.
    let temp = s.wb.temp
    let tint = s.wb.tint
    // Kelvin settings from a raw file whose raw data couldn't be read (developed from its preview instead): as shot.
    if (Math.abs(temp) > 200) {
      temp = 0
      tint = 0
    }
    if (s.wb.mode === 'auto' && src.autoMul) {
      const t = relativeFromMul(src.autoMul)
      temp = t.temp
      tint = t.tint
    }
    wb = { temp, tint }
    const from = whiteXY(6500 * Math.pow(2, temp / 100), tint * 0.6)
    const cat = bradford(from, D65)
    inputMatrix = mulM(inv3(SPACES.rec2020), mulM(cat, SPACES.srgb))
  }
  const space = LUT_SPACES.find((x) => x.id === s.look.space) ?? LUT_SPACES[0]
  return {
    preMul,
    clip,
    inputMatrix,
    decodeSrgb: src.kind !== 'raw',
    exposure: Math.pow(2, s.exposure),
    shadows: s.shadows / 100,
    highlights: s.highlights / 100,
    contrast: (s.contrast / 100) * 0.35 + 0.08,
    // Stretch of the curve above grey (whites +: brighter, clips sooner) and below it (blacks +: lifted shadows).
    white: 1 + (s.whites / 100) * 0.35,
    blacks: 1 - (s.blacks / 100) * 0.3,
    curve: curveIsIdentity(s.curve) ? null : curveTable(s.curve),
    vibrance: s.vibrance / 100,
    saturation: s.saturation / 100,
    hue: s.hsl.hue.map((v) => v / 100),
    sat: s.hsl.sat.map((v) => v / 100),
    lum: s.hsl.lum.map((v) => v / 100),
    bw: s.bw.on,
    bwMix: s.bw.mix.map((v) => v / 100),
    lut: s.look.lut
      ? {
          amount: s.look.amount,
          log: space.log,
          space: LUT_SPACES.indexOf(space),
          toLut: convert('rec2020', space.gamut),
          // LUT outputs are display-referred: sRGB for photo LUTs, Rec.709 otherwise (same primaries).
          fromLut: convert('srgb', 'rec2020')
        }
      : null,
    detail: {
      sharpen: (s.sharpen.amount / 100) * 1.2,
      sharpenSigma: Math.max(0.35, s.sharpen.radius * scale),
      limit: 0.03 + (0.12 * s.sharpen.detail) / 100,
      masking: (s.sharpen.masking / 100) * 0.03,
      lumNr: s.noise.luminance / 100,
      lumSigma: Math.max(0.35, (0.6 + (s.noise.luminance / 100) * 2.4) * scale),
      colorNr: Math.min(1, s.noise.color / 40),
      colorSigma: Math.max(0.35, (1 + (s.noise.color / 100) * 5) * scale)
    },
    outputMatrix: convert('rec2020', out),
    wb
  }
}

const normalizeG = (m: Vec3): Vec3 => [m[0] / m[1], 1, m[2] / m[1]]

/** Relative temperature/tint (±100) that neutralises grey-world multipliers on a non-raw image. */
export function relativeFromMul(mul: Vec3): { temp: number; tint: number } {
  // Search the relative controls for the adaptation that maps the image's average to grey.
  let best = { temp: 0, tint: 0 }
  let bestErr = Infinity
  const avg: Vec3 = [1 / mul[0], 1 / mul[1], 1 / mul[2]]
  for (let t = -100; t <= 100; t += 4)
    for (let n = -100; n <= 100; n += 4) {
      const m = mulM(inv3(SPACES.rec2020), mulM(bradford(whiteXY(6500 * Math.pow(2, t / 100), n * 0.6), D65), SPACES.srgb))
      const c = mul3(m, avg)
      const err = (c[0] / c[1] - 1) ** 2 + (c[2] / c[1] - 1) ** 2
      if (err < bestErr) {
        bestErr = err
        best = { temp: t, tint: n }
      }
    }
  return best
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Stage 1: source pixel → linear Rec.2020 scene value (white balance, camera colour, exposure). */
export function sceneOf(p: Params, c: Vec3): Vec3 {
  let x: Vec3 = p.decodeSrgb ? [srgbDecode(c[0]), srgbDecode(c[1]), srgbDecode(c[2])] : c
  x = [Math.min(x[0] * p.preMul[0], p.clip), Math.min(x[1] * p.preMul[1], p.clip), Math.min(x[2] * p.preMul[2], p.clip)]
  const r = mul3(p.inputMatrix, x)
  return [r[0] * p.exposure, r[1] * p.exposure, r[2] * p.exposure]
}

/** Log brightness relative to grey, what the local grid averages. */
export const logLum = (c: Vec3): number => Math.log2(Math.max(luma(c), 1e-5) / GREY)

/** Stage 2: highlights and shadows (from local brightness), contrast. Scene-referred in and out. */
export function toneScene(p: Params, c: Vec3, local: number): Vec3 {
  const ws = 1 - smoothstep(-4, 0, local)
  const wh = smoothstep(0, 3, local)
  const g = Math.pow(2, p.shadows * 1.6 * ws + p.highlights * 1.6 * wh)
  let x: Vec3 = [c[0] * g, c[1] * g, c[2] * g]
  const l = Math.log2(Math.max(luma(x), 1e-6) / GREY)
  const gc = Math.pow(2, l * p.contrast)
  x = [x[0] * gc, x[1] * gc, x[2] * gc]
  return x
}

/**
 * Stage 3: tone map to display-referred. A logistic curve in stops around middle grey, as film and camera curves are
 * shaped: grey lands on sRGB 0.46, shadows get a toe, highlights roll off and desaturate to white. Whites stretch the
 * top of the curve, blacks the bottom.
 */
export function toneMap(p: Params, c: Vec3): Vec3 {
  const x: Vec3 = [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]
  const Y = luma(x)
  const Yd = toneCurve(p, Y)
  const k = Y > 1e-10 ? Yd / Y : 0
  let d: Vec3 = [x[0] * k, x[1] * k, x[2] * k]
  const m = Math.max(d[0], d[1], d[2])
  if (m > 1) {
    const yd = Math.min(Yd, 1)
    const tt = m - yd > 1e-6 ? (1 - yd) / (m - yd) : 0
    d = [yd + (d[0] - yd) * tt, yd + (d[1] - yd) * tt, yd + (d[2] - yd) * tt]
  }
  return [Math.min(1, Math.max(0, d[0])), Math.min(1, Math.max(0, d[1])), Math.min(1, Math.max(0, d[2]))]
}

/** Slope of the tone curve at grey (in stops); 0.845 would leave mid-tones linear. */
export const TONE_SLOPE = 1.05
const TONE_OFFSET = Math.log(1 / GREY - 1) / TONE_SLOPE

/** Scene luminance → display luminance (see toneMap). */
export function toneCurve(p: Params, Y: number): number {
  let st = Math.log2(Math.max(Y, 1e-10) / GREY)
  st = st > 0 ? st * p.white : st * p.blacks
  // Logistic in stops, centred so that grey (st = 0) gives exactly GREY.
  return 1 / (1 + Math.exp(-TONE_SLOPE * (st - TONE_OFFSET)))
}

/** Stage 4: tone curve, in the sRGB-encoded domain. */
export function curveStage(p: Params, c: Vec3): Vec3 {
  if (!p.curve) return c
  return [0, 1, 2].map((k) => srgbDecode(sampleCurve(p.curve!, k, srgbEncode(c[k])))) as Vec3
}

/** Hue weights for the 8 HSL bands: each hue is shared by the two band centres it falls between, smoothly. */
export function bandWeights(hueDeg: number): number[] {
  const w = new Array(8).fill(0)
  let h = ((hueDeg % 360) + 360) % 360
  if (h < HUE_CENTERS[0]) h += 360
  for (let i = 0; i < 8; i++) {
    const a = HUE_CENTERS[i]
    const b = i === 7 ? HUE_CENTERS[0] + 360 : HUE_CENTERS[i + 1]
    if (h >= a && h < b) {
      const t = (h - a) / (b - a)
      const s = t * t * (3 - 2 * t)
      w[i] = 1 - s
      w[(i + 1) % 8] = s
      break
    }
  }
  return w
}

/** Stage 5: colour, in Oklab: HSL bands, vibrance, saturation, black and white. */
export function colorStage(p: Params, c: Vec3): Vec3 {
  const touched = p.vibrance || p.saturation || p.bw || p.hue.some(Boolean) || p.sat.some(Boolean) || p.lum.some(Boolean)
  if (!touched) return c
  const [L0, a, b] = toOklab(c)
  let L = L0
  let C = Math.hypot(a, b)
  let h = (Math.atan2(b, a) * 180) / Math.PI
  const w = bandWeights(h)
  const sum = (arr: number[]): number => arr.reduce((acc, v, i) => acc + v * w[i], 0)
  const cw = Math.min(1, C / 0.08)
  h += sum(p.hue) * 30
  C *= Math.max(0, 1 + sum(p.sat))
  L += sum(p.lum) * 0.2 * cw
  const hn = (((h % 360) + 360) % 360 - 50) / 25
  const skin = Math.exp(-(hn * hn))
  C *= 1 + p.vibrance * (1 - smoothstep(0, 0.22, C)) * (1 - 0.5 * skin)
  C *= Math.max(0, 1 + p.saturation)
  if (p.bw) {
    L += sum(p.bwMix) * 0.25 * cw
    C = 0
  }
  const hr = (h * Math.PI) / 180
  const r = fromOklab([L, C * Math.cos(hr), C * Math.sin(hr)])
  return [Math.min(1, Math.max(0, r[0])), Math.min(1, Math.max(0, r[1])), Math.min(1, Math.max(0, r[2]))]
}

/** A LUT applied to a linear Rec.2020 value: into the LUT's space and encoding, through it, and back. */
export function lutStage(p: Params, lut: Lut, c: Vec3): Vec3 {
  if (!p.lut) return c
  const space = LUT_SPACES[p.lut.space].id
  const g = mul3(p.lut.toLut, c)
  const e: Vec3 = [encodeFor(space, g[0]), encodeFor(space, g[1]), encodeFor(space, g[2])]
  const o = applyLut(lut, e)
  const lin = mul3(p.lut.fromLut, [decodeFrom(space, o[0]), decodeFrom(space, o[1]), decodeFrom(space, o[2])])
  return lin.map((v) => Math.min(1, Math.max(0, v))) as Vec3
}

const mixV = (a: Vec3, b: Vec3, t: number): Vec3 => [0, 1, 2].map((k) => Math.min(1, Math.max(0, a[k] + (b[k] - a[k]) * t))) as Vec3

// ---- whole-image helpers (CPU reference) ----

export interface Image3 {
  width: number
  height: number
  /** RGB floats. */
  data: Float32Array
}

/** Separable Gaussian blur of selected channels (clamped edges), radius 3σ. */
export function gaussian(src: Float32Array, w: number, h: number, ch: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3))
  const k: number[] = []
  let sum = 0
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k.push(v)
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0
        for (let i = -r; i <= r; i++) acc += src[(y * w + Math.min(w - 1, Math.max(0, x + i))) * ch + c] * k[i + r]
        tmp[(y * w + x) * ch + c] = acc
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++) {
        let acc = 0
        for (let i = -r; i <= r; i++) acc += tmp[(Math.min(h - 1, Math.max(0, y + i)) * w + x) * ch + c] * k[i + r]
        out[(y * w + x) * ch + c] = acc
      }
  return out
}

/** The local brightness grid: block averages of log brightness, blurred, sized so the long edge has GRID_CELLS. */
export function localGrid(logL: Float32Array, w: number, h: number): { gw: number; gh: number; data: Float32Array } {
  const cell = Math.max(1, Math.ceil(Math.max(w, h) / GRID_CELLS))
  const gw = Math.ceil(w / cell)
  const gh = Math.ceil(h / cell)
  const g = new Float32Array(gw * gh)
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let acc = 0
      let n = 0
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y++)
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x++) {
          acc += logL[y * w + x]
          n++
        }
      g[gy * gw + gx] = n ? acc / n : 0
    }
  return { gw, gh, data: gaussian(g, gw, gh, 1, 2) }
}

/** Bilinear sample of the grid at a pixel (cell centres, clamped), as the GPU's linear filtering does. */
export function sampleGrid(grid: { gw: number; gh: number; data: Float32Array }, u: number, v: number): number {
  const x = Math.min(grid.gw - 1, Math.max(0, u * grid.gw - 0.5))
  const y = Math.min(grid.gh - 1, Math.max(0, v * grid.gh - 0.5))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(grid.gw - 1, x0 + 1)
  const y1 = Math.min(grid.gh - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const at = (a: number, b: number): number => grid.data[b * grid.gw + a]
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
}

/** Stage 6: noise reduction and sharpening on Oklab lightness (and colour noise on a/b). */
export function detailStage(p: Params, img: Image3): Image3 {
  const d = p.detail
  if (!d.sharpen && !d.lumNr && !d.colorNr) return img
  const { width: w, height: h } = img
  const lab = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) lab.set(toOklab([img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]]), i * 3)
  const L = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) L[i] = lab[i * 3]
  const ab = new Float32Array(w * h * 2)
  for (let i = 0; i < w * h; i++) {
    ab[i * 2] = lab[i * 3 + 1]
    ab[i * 2 + 1] = lab[i * 3 + 2]
  }
  const abB = d.colorNr ? gaussian(ab, w, h, 2, d.colorSigma) : ab
  const Ln = d.lumNr ? gaussian(L, w, h, 1, d.lumSigma) : L
  const Ls = d.sharpen ? gaussian(L, w, h, 1, d.sharpenSigma) : L
  const out = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const r = finishDetail(d, L[i], Ln[i], Ls[i], ab[i * 2], ab[i * 2 + 1], abB[i * 2], abB[i * 2 + 1])
    out.set(r, i * 3)
  }
  return { width: w, height: h, data: out }
}

/** The per-pixel part of the detail stage (shared with the GPU's final pass). */
export function finishDetail(d: Params['detail'], L: number, Lnr: number, Lsharp: number, a: number, b: number, aBlur: number, bBlur: number): Vec3 {
  let l = L
  if (d.lumNr) {
    const q = (L - Lnr) / 0.04
    const e = Math.exp(-(q * q))
    l = L + (Lnr - L) * d.lumNr * e
  }
  if (d.sharpen) {
    const diff = Math.min(d.limit, Math.max(-d.limit, L - Lsharp))
    const mask = d.masking ? smoothstep(d.masking * 0.5, d.masking, Math.abs(L - Lsharp)) : 1
    l += diff * d.sharpen * mask
  }
  const A = a + (aBlur - a) * d.colorNr
  const B = b + (bBlur - b) * d.colorNr
  const r = fromOklab([l, A, B])
  return [Math.min(1, Math.max(0, r[0])), Math.min(1, Math.max(0, r[1])), Math.min(1, Math.max(0, r[2]))]
}

/**
 * The whole pipeline on the CPU, for tests and as the reference the GPU must match. Input: source pixels as floats
 * (raw: linear camera RGB 0–1; others: sRGB-encoded 0–1). Output: display-encoded RGB 0–1 in the output space.
 */
export function renderReference(p: Params, src: Image3, lut: Lut | null = null): Image3 {
  const { width: w, height: h } = src
  const scene = new Float32Array(w * h * 3)
  const logL = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const c = sceneOf(p, [src.data[i * 3], src.data[i * 3 + 1], src.data[i * 3 + 2]])
    scene.set(c, i * 3)
    logL[i] = logLum(c)
  }
  const grid = localGrid(logL, w, h)
  const disp = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const c: Vec3 = [scene[i * 3], scene[i * 3 + 1], scene[i * 3 + 2]]
      disp.set(displayOf(p, c, sampleGrid(grid, (x + 0.5) / w, (y + 0.5) / h), lut), i * 3)
    }
  const det = detailStage(p, { width: w, height: h, data: disp })
  const out = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) out.set(outputOf(p, [det.data[i * 3], det.data[i * 3 + 1], det.data[i * 3 + 2]]), i * 3)
  return { width: w, height: h, data: out }
}

/** Scene value and its local brightness → display-referred value (stages 2–5 and the display LUT). */
export function displayOf(p: Params, c: Vec3, local: number, lut: Lut | null): Vec3 {
  const t = toneScene(p, c, local)
  let d = toneMap(p, t)
  if (lut && p.lut?.log) d = mixV(d, lutStage(p, lut, t), p.lut.amount)
  d = curveStage(p, d)
  d = colorStage(p, d)
  if (lut && p.lut && !p.lut.log) d = mixV(d, lutStage(p, lut, d), p.lut.amount)
  return d
}

export function outputOf(p: Params, c: Vec3): Vec3 {
  const o = mul3(p.outputMatrix, c)
  return [srgbEncode(Math.min(1, Math.max(0, o[0]))), srgbEncode(Math.min(1, Math.max(0, o[1]))), srgbEncode(Math.min(1, Math.max(0, o[2])))]
}

/** Grey-world multipliers for Auto white balance, from source pixels (skipping clipped and very dark ones). */
export function greyWorld(src: Image3, kind: SourceKind): Vec3 {
  const acc = [0, 0, 0]
  let n = 0
  const step = Math.max(1, Math.floor((src.width * src.height) / 200000))
  for (let i = 0; i < src.width * src.height; i += step) {
    let c: Vec3 = [src.data[i * 3], src.data[i * 3 + 1], src.data[i * 3 + 2]]
    if (kind !== 'raw') c = [srgbDecode(c[0]), srgbDecode(c[1]), srgbDecode(c[2])]
    const m = Math.max(c[0], c[1], c[2])
    if (m > 0.95 || m < 0.02) continue
    acc[0] += c[0]
    acc[1] += c[1]
    acc[2] += c[2]
    n++
  }
  if (!n || !acc[0] || !acc[2]) return [1, 1, 1]
  return [acc[1] / acc[0], 1, acc[1] / acc[2]]
}
