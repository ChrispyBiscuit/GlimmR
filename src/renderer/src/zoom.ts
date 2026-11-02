// Pan and zoom maths for the viewer. A view is the image's scale (1 = the original's pixels, 100%) and its
// centre's offset from the stage centre in screen pixels.

export interface View {
  scale: number
  x: number
  y: number
}

export interface Box {
  w: number
  h: number
}

export const MAX_SCALE = 4

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The scale that fits the image inside the area, never enlarging past 100%. */
export function fitScale(img: Box, area: Box): number {
  if (img.w <= 0 || img.h <= 0 || area.w <= 0 || area.h <= 0) return 1
  return Math.min(1, area.w / img.w, area.h / img.h)
}

/** Keeps a larger-than-stage image covering the stage, and a smaller one inside it. */
export function clampView(v: View, img: Box, stage: Box): View {
  const mx = Math.abs(img.w * v.scale - stage.w) / 2
  const my = Math.abs(img.h * v.scale - stage.h) / 2
  return { scale: v.scale, x: clamp(v.x, -mx, mx), y: clamp(v.y, -my, my) }
}

/** Zooms to `scale` keeping the image point under (px, py), measured from the stage centre, where it is. */
export function zoomAt(v: View, scale: number, px: number, py: number, img: Box, stage: Box): View {
  const k = scale / v.scale
  return clampView({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k }, img, stage)
}

/** Slider position (0–100) for a scale, on a log scale so each step feels the same size. */
export function toSlider(scale: number, min: number): number {
  if (min >= MAX_SCALE) return 0
  return (Math.log(scale / min) / Math.log(MAX_SCALE / min)) * 100
}

export function fromSlider(pos: number, min: number): number {
  if (min >= MAX_SCALE) return min
  return min * Math.pow(MAX_SCALE / min, clamp(pos, 0, 100) / 100)
}
