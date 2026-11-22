// Colour maths for the develop pipeline: 3×3 matrices, colour spaces from their primaries, white points from colour
// temperature and tint, camera white balance, Oklab, and the transfer curves LUTs may expect (sRGB, Rec.709 and the
// common camera log curves). Shared by the CPU reference and the GPU pipeline, so both use the same numbers.

export type Vec3 = [number, number, number]
/** Row-major 3×3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const mul3 = (m: Mat3, v: Vec3): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]

export function mulM(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return r
}

export function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Singular matrix')
  const s = 1 / det
  return [A * s, -(b * i - c * h) * s, (b * f - c * e) * s, B * s, (a * i - c * g) * s, -(a * f - c * d) * s, C * s, -(a * h - b * g) * s, (a * e - b * d) * s]
}

export const diag = (v: Vec3): Mat3 => [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]

export const xyToXYZ = (x: number, y: number): Vec3 => [x / y, 1, (1 - x - y) / y]

export const D65: [number, number] = [0.3127, 0.329]

/** RGB → XYZ for a space given by its primaries and white point. */
export function rgbToXYZ(r: [number, number], g: [number, number], b: [number, number], w: [number, number] = D65): Mat3 {
  const P: Mat3 = [r[0] / r[1], g[0] / g[1], b[0] / b[1], 1, 1, 1, (1 - r[0] - r[1]) / r[1], (1 - g[0] - g[1]) / g[1], (1 - b[0] - b[1]) / b[1]]
  const S = mul3(inv3(P), xyToXYZ(w[0], w[1]))
  return mulM(P, diag(S))
}

/** Colour spaces by their primaries (all D65). */
export const SPACES = {
  srgb: rgbToXYZ([0.64, 0.33], [0.3, 0.6], [0.15, 0.06]),
  p3: rgbToXYZ([0.68, 0.32], [0.265, 0.69], [0.15, 0.06]),
  rec2020: rgbToXYZ([0.708, 0.292], [0.17, 0.797], [0.131, 0.046]),
  adobergb: rgbToXYZ([0.64, 0.33], [0.21, 0.71], [0.15, 0.06]),
  sgamut3cine: rgbToXYZ([0.766, 0.275], [0.225, 0.8], [0.089, -0.087]),
  awg3: rgbToXYZ([0.684, 0.313], [0.221, 0.848], [0.0861, -0.102]),
  vgamut: rgbToXYZ([0.73, 0.28], [0.165, 0.84], [0.1, -0.03])
} as const
export type SpaceName = keyof typeof SPACES

/** A → B for two RGB spaces sharing a white point. */
export const convert = (a: SpaceName, b: SpaceName): Mat3 => mulM(inv3(SPACES[b]), SPACES[a])

export const REC2020_LUMA: Vec3 = [0.2627, 0.678, 0.0593]
export const luma = (c: Vec3): number => REC2020_LUMA[0] * c[0] + REC2020_LUMA[1] * c[1] + REC2020_LUMA[2] * c[2]

// ---- white points from colour temperature and tint ----

/** xy on the Planckian locus (Kim et al. cubic approximation, 1667–25000 K). */
export function planckXY(T: number): [number, number] {
  const t = Math.min(25000, Math.max(1667, T))
  const x =
    t <= 4000
      ? -0.2661239e9 / t ** 3 - 0.234358e6 / t ** 2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

const xyToUV = (x: number, y: number): [number, number] => {
  const d = -2 * x + 12 * y + 3
  return [(4 * x) / d, (6 * y) / d]
}
const uvToXY = (u: number, v: number): [number, number] => {
  const d = 2 * u - 8 * v + 4
  return [(3 * u) / d, (2 * v) / d]
}

/**
 * Tint is the distance from the Planckian locus, signed as in Lightroom and the DNG SDK: positive tint makes the photo
 * more magenta, so it names a light that is greener (above the locus). 150 is 0.05 Δuv.
 */
const TINT_SCALE = 3000

/** The white point (xy) for a colour temperature (K) and tint. */
export function whiteXY(T: number, tint: number): [number, number] {
  const [u, v] = xyToUV(...planckXY(T))
  const [u2, v2] = xyToUV(...planckXY(T + 1))
  // Normal to the locus, pointing below it (towards magenta).
  let nx = v2 - v
  let ny = -(u2 - u)
  const len = Math.hypot(nx, ny)
  nx /= len
  ny /= len
  if (ny > 0) {
    nx = -nx
    ny = -ny
  }
  // (nx, ny) points below the locus (magenta light); positive tint is a greener light.
  const d = -tint / TINT_SCALE
  return uvToXY(u + nx * d, v + ny * d)
}

/** The colour temperature and tint closest to a white point. */
export function tempTintOf(x: number, y: number): { temp: number; tint: number } {
  const [u, v] = xyToUV(x, y)
  // Search temperatures in mired steps, then refine.
  let best = 6500
  let bestD = Infinity
  for (let m = 40; m <= 600; m += 2) {
    const T = 1e6 / m
    const [lu, lv] = xyToUV(...planckXY(T))
    const dd = (lu - u) ** 2 + (lv - v) ** 2
    if (dd < bestD) {
      bestD = dd
      best = T
    }
  }
  let lo = 1e6 / (1e6 / best + 2)
  let hi = 1e6 / (1e6 / best - 2)
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    const da = (() => {
      const [lu, lv] = xyToUV(...planckXY(a))
      return (lu - u) ** 2 + (lv - v) ** 2
    })()
    const db = (() => {
      const [lu, lv] = xyToUV(...planckXY(b))
      return (lu - u) ** 2 + (lv - v) ** 2
    })()
    if (da < db) hi = b
    else lo = a
  }
  const T = (lo + hi) / 2
  // Tint: signed distance from the locus, in the direction whiteXY uses.
  const [w0, w1] = whiteXY(T, 0)
  const [pu, pv] = xyToUV(w0, w1)
  const [qu, qv] = xyToUV(...whiteXY(T, 1))
  const dir = [qu - pu, qv - pv]
  const dlen = Math.hypot(dir[0], dir[1])
  const tint = ((u - pu) * dir[0] + (v - pv) * dir[1]) / (dlen * dlen)
  return { temp: Math.round(T), tint: Math.round(tint * 10) / 10 }
}

/** Bradford chromatic adaptation from one white point to another (XYZ → XYZ). */
export function bradford(from: [number, number], to: [number, number]): Mat3 {
  const M: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
  const s = mul3(M, xyToXYZ(...from))
  const d = mul3(M, xyToXYZ(...to))
  return mulM(inv3(M), mulM(diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), M))
}

// ---- camera white balance (raw files) ----

/** What LibRaw reports about a raw file's colour. */
export interface CameraColor {
  /** XYZ (D65) → camera RGB, rows R, G, B (LibRaw's cam_xyz). */
  camXyz: Mat3
  /** Camera RGB (white balanced) → linear sRGB (LibRaw's rgb_cam). */
  rgbCam: Mat3
  /** As-shot multipliers R, G, B (LibRaw's cam_mul). */
  asShot: Vec3
}

/** Camera multipliers (G = 1) that make a white of this temperature and tint neutral. */
export function cameraMultipliers(cam: CameraColor, temp: number, tint: number): Vec3 {
  const [x, y] = whiteXY(temp, tint)
  const r = mul3(cam.camXyz, xyToXYZ(x, y))
  return [r[1] / r[0], 1, r[1] / r[2]]
}

/** The temperature and tint the camera's own multipliers stand for. */
export function cameraTempTint(cam: CameraColor, mul: Vec3 = cam.asShot): { temp: number; tint: number } {
  const resp: Vec3 = [1 / mul[0], 1 / mul[1], 1 / mul[2]]
  const XYZ = mul3(inv3(cam.camXyz), resp)
  const s = XYZ[0] + XYZ[1] + XYZ[2]
  return tempTintOf(XYZ[0] / s, XYZ[1] / s)
}

// ---- Oklab ----

const XYZ_TO_LMS: Mat3 = [0.8189330101, 0.3618667424, -0.1288597137, 0.0329845436, 0.9293118715, 0.0361456387, 0.0482003018, 0.2643662691, 0.633851707]
const LMS_TO_LAB: Mat3 = [0.2104542553, 0.793617785, -0.0040720468, 1.9779984951, -2.428592205, 0.4505937099, 0.0259040371, 0.7827717662, -0.808675766]
export const REC2020_TO_LMS = mulM(XYZ_TO_LMS, SPACES.rec2020)
export const LMS_TO_REC2020 = inv3(REC2020_TO_LMS)
export const LAB_TO_LMS = inv3(LMS_TO_LAB)
export { LMS_TO_LAB }

export function toOklab(c: Vec3): Vec3 {
  const l = mul3(REC2020_TO_LMS, c).map((v) => Math.cbrt(v)) as Vec3
  return mul3(LMS_TO_LAB, l)
}
export function fromOklab(lab: Vec3): Vec3 {
  const l = mul3(LAB_TO_LMS, lab).map((v) => v * v * v) as Vec3
  return mul3(LMS_TO_REC2020, l)
}

// ---- transfer curves ----

export const srgbEncode = (x: number): number => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055)
export const srgbDecode = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/** Spaces a LUT may expect its input in, with the transfer curve and gamut. */
export type LutSpace = 'srgb' | 'rec709' | 'slog3' | 'logc3' | 'vlog' | 'flog'

export const LUT_SPACES: { id: LutSpace; label: string; gamut: SpaceName; log: boolean }[] = [
  { id: 'srgb', label: 'sRGB (photo LUTs)', gamut: 'srgb', log: false },
  { id: 'rec709', label: 'Rec.709 (video)', gamut: 'srgb', log: false },
  { id: 'slog3', label: 'Sony S-Log3 / S-Gamut3.Cine', gamut: 'sgamut3cine', log: true },
  { id: 'logc3', label: 'ARRI LogC3 / Wide Gamut 3', gamut: 'awg3', log: true },
  { id: 'vlog', label: 'Panasonic V-Log / V-Gamut', gamut: 'vgamut', log: true },
  { id: 'flog', label: 'Fujifilm F-Log / F-Gamut', gamut: 'rec2020', log: true }
]

/** Linear (scene or display) → the LUT's input encoding. */
export function encodeFor(space: LutSpace, x: number): number {
  switch (space) {
    case 'srgb':
      return srgbEncode(Math.min(1, Math.max(0, x)))
    case 'rec709':
      // BT.1886 display: V = L^(1/2.4)
      return Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.4)
    case 'slog3':
      return x >= 0.01125 ? (420 + Math.log10((x + 0.01) / (0.18 + 0.01)) * 261.5) / 1023 : (x * (171.2102946929 - 95)) / 0.01125 / 1023 + 95 / 1023
    case 'logc3':
      return x > 0.010591 ? 0.24719 * Math.log10(5.555556 * x + 0.052272) + 0.385537 : 5.367655 * x + 0.092809
    case 'vlog':
      return x < 0.01 ? 5.6 * x + 0.125 : 0.241514 * Math.log10(x + 0.00873) + 0.598206
    case 'flog':
      return x >= 0.00089 ? 0.344676 * Math.log10(0.555556 * x + 0.009468) + 0.790453 : 8.735631 * x + 0.092864
  }
}

/** A LUT's output (always display-referred) back to linear: sRGB LUTs give sRGB, everything else Rec.709 / BT.1886. */
export function decodeFrom(space: LutSpace, v: number): number {
  return space === 'srgb' ? srgbDecode(Math.min(1, Math.max(0, v))) : Math.pow(Math.min(1, Math.max(0, v)), 2.4)
}
