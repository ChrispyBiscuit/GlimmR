// Layers: local adjustments, each with its own mask (brush strokes, linear and radial gradients, a luminance range)
// and opacity, as in Capture One. Each layer adds its adjustments to the photo's, weighted by its mask, before the
// tone and colour stages: exposure and white balance in the scene, contrast, highlights and shadows in the tone
// stage, saturation in the colour stage. See docs/DEVELOP_PRD.md §6.
//
// Positions are fractions of the upright, uncropped image's width and height (0–1), so masks survive any render
// size and a later crop. Sizes (brush radius, radial radii) are fractions of the long edge.

import { srgbEncode, type Vec3 } from './color'

export interface BrushStroke {
  kind: 'brush'
  erase: boolean
  /** Radius, as a fraction of the long edge. */
  size: number
  /** 0 hard edge, 1 fully soft. */
  feather: number
  /** Most the stroke adds (or removes), 0–1. */
  density: number
  /** x, y pairs (fractions of width and height). */
  points: number[]
}

export interface LinearGradient {
  kind: 'linear'
  /** Full effect at (x0, y0), none at (x1, y1). */
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface RadialGradient {
  kind: 'radial'
  cx: number
  cy: number
  /** Radii, as fractions of the long edge. */
  rx: number
  ry: number
  /** Rotation, radians. */
  angle: number
  feather: number
  /** Affect outside the ellipse instead of inside. */
  invert: boolean
}

export type MaskShape = BrushStroke | LinearGradient | RadialGradient

export interface LayerAdjust {
  /** Stops, ±4. */
  exposure: number
  /** ±100 each. */
  contrast: number
  highlights: number
  shadows: number
  temp: number
  tint: number
  saturation: number
}

export interface Layer {
  id: string
  name: string
  visible: boolean
  /** 0–1. */
  opacity: number
  adjust: LayerAdjust
  mask: {
    shapes: MaskShape[]
    invert: boolean
    /** Limits the layer to a band of brightness (0 black – 1 white), with soft edges. */
    range: { on: boolean; lo: number; hi: number; feather: number }
  }
}

export const MAX_LAYERS = 16
export const ADJUST_KEYS: (keyof LayerAdjust)[] = ['exposure', 'contrast', 'highlights', 'shadows', 'temp', 'tint', 'saturation']

export const noAdjust = (): LayerAdjust => ({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0 })

export function newLayer(name: string, shapes: MaskShape[] = []): Layer {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name,
    visible: true,
    opacity: 1,
    adjust: noAdjust(),
    mask: { shapes, invert: false, range: { on: false, lo: 0, hi: 1, feather: 0.1 } }
  }
}

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

function sanitizeShape(s: unknown): MaskShape | null {
  const o = (s ?? {}) as Record<string, unknown>
  if (o.kind === 'brush') {
    const pts = Array.isArray(o.points) ? (o.points as unknown[]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : []
    if (pts.length < 2) return null
    return { kind: 'brush', erase: !!o.erase, size: num(o.size, 0.0005, 0.5, 0.03), feather: num(o.feather, 0, 1, 0.5), density: num(o.density, 0, 1, 1), points: pts.slice(0, pts.length - (pts.length % 2)) }
  }
  if (o.kind === 'linear') return { kind: 'linear', x0: num(o.x0, -2, 3, 0.5), y0: num(o.y0, -2, 3, 0), x1: num(o.x1, -2, 3, 0.5), y1: num(o.y1, -2, 3, 0.5) }
  if (o.kind === 'radial')
    return { kind: 'radial', cx: num(o.cx, -2, 3, 0.5), cy: num(o.cy, -2, 3, 0.5), rx: num(o.rx, 0.001, 3, 0.2), ry: num(o.ry, 0.001, 3, 0.2), angle: num(o.angle, -10, 10, 0), feather: num(o.feather, 0, 1, 0.5), invert: !!o.invert }
  return null
}

export function sanitizeLayers(input: unknown): Layer[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, MAX_LAYERS).map((l, i) => {
    const o = (l ?? {}) as Record<string, unknown>
    const a = (o.adjust ?? {}) as Record<string, unknown>
    const m = (o.mask ?? {}) as Record<string, unknown>
    const r = (m.range ?? {}) as Record<string, unknown>
    return {
      id: typeof o.id === 'string' && o.id ? o.id.slice(0, 32) : `layer${i}`,
      name: typeof o.name === 'string' ? o.name.slice(0, 80) : `Layer ${i + 1}`,
      visible: o.visible !== false,
      opacity: num(o.opacity, 0, 1, 1),
      adjust: {
        exposure: num(a.exposure, -4, 4, 0),
        contrast: num(a.contrast, -100, 100, 0),
        highlights: num(a.highlights, -100, 100, 0),
        shadows: num(a.shadows, -100, 100, 0),
        temp: num(a.temp, -100, 100, 0),
        tint: num(a.tint, -100, 100, 0),
        saturation: num(a.saturation, -100, 100, 0)
      },
      mask: {
        shapes: (Array.isArray(m.shapes) ? (m.shapes as unknown[]) : []).map(sanitizeShape).filter((x): x is MaskShape => !!x).slice(0, 2000),
        invert: !!m.invert,
        range: { on: !!r.on, lo: num(r.lo, 0, 1, 0), hi: num(r.hi, 0, 1, 1), feather: num(r.feather, 0, 0.5, 0.1) }
      }
    }
  })
}

// ---- prepared for rendering ----

/** A layer in render units: what the pipeline adds per pixel, times the layer's mask and opacity. */
export interface PreparedLayer {
  opacity: number
  /** Stops. */
  exposure: number
  /** Added to the pipeline's contrast, highlights and shadows parameters. */
  contrast: number
  highlights: number
  shadows: number
  /** Relative warm/cool and green/magenta shifts, ±1. */
  temp: number
  tint: number
  /** Added to saturation (×(1 + s) on chroma). */
  saturation: number
  invert: boolean
  range: Layer['mask']['range']
  shapes: MaskShape[]
}

export function prepareLayer(l: Layer): PreparedLayer {
  return {
    opacity: l.opacity,
    exposure: l.adjust.exposure,
    contrast: (l.adjust.contrast / 100) * 0.35,
    highlights: l.adjust.highlights / 100,
    shadows: l.adjust.shadows / 100,
    temp: l.adjust.temp / 100,
    tint: l.adjust.tint / 100,
    saturation: l.adjust.saturation / 100,
    invert: l.mask.invert,
    range: l.mask.range,
    shapes: l.mask.shapes
  }
}

export function prepareLayers(layers: Layer[]): PreparedLayer[] {
  return layers.filter((l) => l.visible && l.opacity > 0 && ADJUST_KEYS.some((k) => l.adjust[k] !== 0)).map(prepareLayer)
}

/** Per-pixel local parameters (the sums over layers), as the GPU's two parameter textures hold them. */
export interface Local {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  temp: number
  tint: number
  saturation: number
}

export const ZERO_LOCAL: Local = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temp: 0, tint: 0, saturation: 0 }

/** White balance shift as RGB multipliers (linear Rec.2020), keeping brightness. */
export function wbShift(temp: number, tint: number): Vec3 {
  const m: Vec3 = [Math.pow(2, 0.3 * temp + 0.15 * tint), Math.pow(2, -0.3 * tint), Math.pow(2, -0.3 * temp + 0.15 * tint)]
  const y = 0.2627 * m[0] + 0.678 * m[1] + 0.0593 * m[2]
  return [m[0] / y, m[1] / y, m[2] / y]
}

const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Brush dabs along a stroke: centres (fractions of width/height) every quarter radius. */
export function dabsOf(s: BrushStroke, ax: number, ay: number): number[] {
  const out: number[] = []
  const step = s.size * 0.25
  const p = s.points
  out.push(p[0], p[1])
  let carry = 0
  for (let i = 2; i + 1 < p.length; i += 2) {
    // Distance in long-edge units.
    const dx = (p[i] - p[i - 2]) * ax
    const dy = (p[i + 1] - p[i - 1]) * ay
    const d = Math.hypot(dx, dy)
    let t = step - carry
    while (t <= d) {
      const f = t / d
      out.push(p[i - 2] + (p[i] - p[i - 2]) * f, p[i - 1] + (p[i + 1] - p[i - 1]) * f)
      t += step
    }
    carry = d - (t - step)
  }
  return out
}

/** One dab's coverage at a distance (long-edge units). */
export const dabAlpha = (s: BrushStroke, dist: number): number => s.density * (1 - sstep(1 - s.feather, 1.0001, dist / s.size))

export function linearAlpha(g: LinearGradient, ax: number, ay: number, u: number, v: number): number {
  const dx = (g.x1 - g.x0) * ax
  const dy = (g.y1 - g.y0) * ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return 0
  const t = (((u - g.x0) * ax) * dx + ((v - g.y0) * ay) * dy) / len2
  return 1 - sstep(0, 1, t)
}

export function radialAlpha(g: RadialGradient, ax: number, ay: number, u: number, v: number): number {
  const px = (u - g.cx) * ax
  const py = (v - g.cy) * ay
  const c = Math.cos(g.angle)
  const s = Math.sin(g.angle)
  const qx = (px * c + py * s) / g.rx
  const qy = (-px * s + py * c) / g.ry
  const d = Math.hypot(qx, qy)
  const a = 1 - sstep(1 - g.feather, 1.0001, d)
  return g.invert ? 1 - a : a
}

/** Brightness used by the luminance range: the base scene's luminance, sRGB-encoded. */
export const rangeLum = (sceneLuma: number): number => srgbEncode(Math.min(1, Math.max(0, sceneLuma)))

/**
 * The mask of a layer at a point (CPU reference; the GPU draws the same shapes in the same order). Shapes combine in
 * order: gradients and brush strokes add (the larger value wins), erasing strokes remove.
 */
export function maskAt(l: PreparedLayer, ax: number, ay: number, u: number, v: number, lum: number, dabs?: number[][]): number {
  let m = 0
  l.shapes.forEach((s, i) => {
    if (s.kind === 'linear') m = Math.max(m, linearAlpha(s, ax, ay, u, v))
    else if (s.kind === 'radial') m = Math.max(m, radialAlpha(s, ax, ay, u, v))
    else {
      const d = dabs?.[i] ?? dabsOf(s, ax, ay)
      for (let k = 0; k < d.length; k += 2) {
        const a = dabAlpha(s, Math.hypot((u - d[k]) * ax, (v - d[k + 1]) * ay))
        if (a <= 0) continue
        m = s.erase ? m * (1 - a) : Math.max(m, a)
      }
    }
  })
  return finishMask(l, m, lum)
}

/** Range, invert and opacity, after the shapes. */
export function finishMask(l: PreparedLayer, m: number, lum: number): number {
  let x = m
  if (l.range.on) {
    const f = Math.max(1e-4, l.range.feather)
    x *= sstep(l.range.lo - f, l.range.lo, lum) * (1 - sstep(l.range.hi, l.range.hi + f, lum))
  }
  if (l.invert) x = 1 - x
  return x * l.opacity
}

/** Sums the layers' adjustments at a point. */
export function localAt(layers: PreparedLayer[], ax: number, ay: number, u: number, v: number, lum: number, dabs?: number[][][]): Local {
  const o = { ...ZERO_LOCAL }
  layers.forEach((l, i) => {
    const m = maskAt(l, ax, ay, u, v, lum, dabs?.[i])
    if (!m) return
    o.exposure += l.exposure * m
    o.contrast += l.contrast * m
    o.highlights += l.highlights * m
    o.shadows += l.shadows * m
    o.temp += l.temp * m
    o.tint += l.tint * m
    o.saturation += l.saturation * m
  })
  return o
}
