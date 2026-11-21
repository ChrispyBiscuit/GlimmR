// Tone curves: the parametric curve (shadows, darks, lights, highlights regions) and point curves for RGB and each
// channel, baked into lookup tables in the display (sRGB-encoded) domain. The GPU samples the same tables.

import type { CurvePoint, DevelopSettings } from './settings'

export const CURVE_SIZE = 1024

/** Monotone cubic interpolation (Fritsch–Carlson) through points, so curves never overshoot or fold back. */
export function monotone(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a.x - b.x)
  if (!pts.length || pts[0].x > 0) pts.unshift({ x: 0, y: pts[0]?.x === 0 ? pts[0].y : 0 })
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, y: 1 })
  // Drop points with the same x, keeping the last.
  const p = pts.filter((q, i) => i === pts.length - 1 || pts[i + 1].x > q.x)
  const n = p.length
  if (n < 2) return (x) => x
  const d: number[] = []
  const m: number[] = new Array(n).fill(0)
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x))
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const h = a * a + b * b
    if (h > 9) {
      const t = 3 / Math.sqrt(h)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x) => {
    if (x <= p[0].x) return p[0].y
    if (x >= p[n - 1].x) return p[n - 1].y
    let i = 0
    while (i < n - 2 && x > p[i + 1].x) i++
    const h = p[i + 1].x - p[i].x
    const t = (x - p[i].x) / h
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1]
  }
}

/** A smooth bump over [a, b], peaking in the middle. */
const bump = (x: number, a: number, b: number): number => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)) ** 2)

/** The parametric curve: each region lifts or lowers its part of the tonal range by up to a quarter. */
export function parametric(c: DevelopSettings['curve']): (x: number) => number {
  const amt = (v: number): number => (v / 100) * 0.12
  return (x) => {
    const y = x + amt(c.shadows) * bump(x, 0, 0.5) + amt(c.darks) * bump(x, 0.1, 0.75) + amt(c.lights) * bump(x, 0.25, 0.9) + amt(c.highlights) * bump(x, 0.5, 1)
    return Math.min(1, Math.max(0, y))
  }
}

/**
 * The curve table: CURVE_SIZE entries per channel (R, G, B, unused), each the parametric curve, then the RGB point
 * curve, then the channel's own point curve.
 */
export function curveTable(c: DevelopSettings['curve']): Float32Array {
  const par = parametric(c)
  const rgb = c.rgb.length ? monotone(c.rgb) : (x: number) => x
  const ch = [c.r, c.g, c.b].map((p) => (p.length ? monotone(p) : (x: number) => x))
  const out = new Float32Array(CURVE_SIZE * 4)
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = i / (CURVE_SIZE - 1)
    const base = rgb(par(x))
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.min(1, Math.max(0, ch[k](base)))
    out[i * 4 + 3] = 1
  }
  return out
}

/** Whether the curve does anything (so the stage can be skipped). */
export const curveIsIdentity = (c: DevelopSettings['curve']): boolean =>
  !c.highlights && !c.lights && !c.darks && !c.shadows && !c.rgb.length && !c.r.length && !c.g.length && !c.b.length

/** Linear interpolation into a curve table, for one channel. */
export function sampleCurve(table: Float32Array, k: number, x: number): number {
  const f = Math.min(1, Math.max(0, x)) * (CURVE_SIZE - 1)
  const i = Math.floor(f)
  const j = Math.min(CURVE_SIZE - 1, i + 1)
  const t = f - i
  return table[i * 4 + k] * (1 - t) + table[j * 4 + k] * t
}
