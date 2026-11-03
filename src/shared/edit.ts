// Non-destructive edits: a quarter-turn rotation, a straighten angle and a crop, stored in the catalog and applied
// when previews are rendered. Originals are never touched.
//
// Geometry: the upright image (EXIF orientation applied) is turned by `rotate`, giving the "frame" (W×H). The
// straighten `angle` rotates the image about the frame's centre (positive is clockwise). `crop` is a rectangle in
// the frame, normalised to 0–1, and must lie inside the straightened image so no empty corners show.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PhotoEdit {
  rotate: 0 | 90 | 180 | 270
  /** Straighten, in degrees (−45 to 45). */
  angle: number
  crop: Rect | null
}

export const NO_EDIT: PhotoEdit = { rotate: 0, angle: 0, crop: null }
export const MAX_ANGLE = 45

const EPS = 1e-6
const rad = (deg: number): number => (deg * Math.PI) / 180

export const isEdited = (e: PhotoEdit | null | undefined): e is PhotoEdit => !!e && (e.rotate !== 0 || Math.abs(e.angle) > EPS || !!e.crop)

/** Size of the frame after the quarter-turn rotation. */
export function frameSize(width: number, height: number, rotate: number): { w: number; h: number } {
  return rotate % 180 === 0 ? { w: width, h: height } : { w: height, h: width }
}

/** Scale of the largest centred rectangle, of the frame's own shape, that fits inside the straightened image. */
export function inscribedScale(W: number, H: number, angle: number): number {
  const c = Math.abs(Math.cos(rad(angle)))
  const s = Math.abs(Math.sin(rad(angle)))
  return Math.min(W / (W * c + H * s), H / (W * s + H * c))
}

/** True when every corner of the crop lies inside the image straightened by `angle` within a W×H frame. */
export function cropFits(r: Rect, W: number, H: number, angle: number): boolean {
  if (r.w <= 0 || r.h <= 0 || r.x < -EPS || r.y < -EPS || r.x + r.w > 1 + EPS || r.y + r.h > 1 + EPS) return false
  const c = Math.cos(rad(angle))
  const s = Math.sin(rad(angle))
  for (const [px, py] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h]
  ]) {
    // Corner relative to the centre, in pixels, turned back by the angle into the image's own axes.
    const dx = (px - 0.5) * W
    const dy = (py - 0.5) * H
    const u = dx * c + dy * s
    const v = -dx * s + dy * c
    if (Math.abs(u) > W / 2 + 1e-6 * W || Math.abs(v) > H / 2 + 1e-6 * H) return false
  }
  return true
}

/** The largest centred crop that fits at this angle, optionally with a fixed aspect ratio (width / height, in pixels). */
export function defaultCrop(W: number, H: number, angle: number, aspect?: number): Rect {
  let w = 1
  let h = 1
  if (aspect && aspect > 0) {
    // Start from the largest rectangle of that shape inside the frame.
    if (aspect >= W / H) h = W / aspect / H
    else w = (H * aspect) / W
  }
  // Shrink about the centre until it fits.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    if (cropFits({ x: 0.5 - (w * k) / 2, y: 0.5 - (h * k) / 2, w: w * k, h: h * k }, W, H, angle)) lo = k
    else hi = k
  }
  return { x: 0.5 - (w * lo) / 2, y: 0.5 - (h * lo) / 2, w: w * lo, h: h * lo }
}

/**
 * Moves and, if it must, shrinks a crop about its centre so it fits at this angle, keeping its shape. Used while
 * dragging and when the angle changes.
 */
export function fitCrop(r: Rect, W: number, H: number, angle: number): Rect {
  if (cropFits(r, W, H, angle)) return r
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  // Pull the centre towards the middle, then shrink, whichever fits first.
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const x = cx + (0.5 - cx) * t
    const y = cy + (0.5 - cy) * t
    const moved = { x: x - r.w / 2, y: y - r.h / 2, w: r.w, h: r.h }
    if (cropFits(moved, W, H, angle)) return moved
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const k = (lo + hi) / 2
    const w = r.w * k
    const h = r.h * k
    if (cropFits({ x: 0.5 - w / 2, y: 0.5 - h / 2, w, h }, W, H, angle)) lo = k
    else hi = k
  }
  return { x: 0.5 - (r.w * lo) / 2, y: 0.5 - (r.h * lo) / 2, w: r.w * lo, h: r.h * lo }
}

/** The crop actually applied: the stored one, or the largest fitting one when only straightened. */
export function effectiveCrop(e: PhotoEdit, W: number, H: number): Rect | null {
  if (e.crop) return e.crop
  return Math.abs(e.angle) > EPS ? defaultCrop(W, H, e.angle) : null
}

/** Pixel size of the edited image, for layout. */
export function editedSize(width: number, height: number, e: PhotoEdit | null): { w: number; h: number } {
  if (!isEdited(e)) return { w: width, h: height }
  const f = frameSize(width, height, e.rotate)
  const c = effectiveCrop(e, f.w, f.h)
  return c ? { w: f.w * c.w, h: f.h * c.h } : f
}

/** Validates an edit from the renderer. */
export function sanitizeEdit(e: unknown): PhotoEdit | null {
  if (!e || typeof e !== 'object') return null
  const o = e as Partial<PhotoEdit>
  const rotate = ([0, 90, 180, 270] as const).find((r) => r === o.rotate) ?? 0
  const angle = Number.isFinite(o.angle) ? Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Number(o.angle))) : 0
  const c = o.crop
  const clamp = (n: unknown): number => Math.max(0, Math.min(1, Number(n) || 0))
  const crop = c && typeof c === 'object' ? { x: clamp(c.x), y: clamp(c.y), w: clamp(c.w), h: clamp(c.h) } : null
  const full = crop && crop.x < EPS && crop.y < EPS && crop.w > 1 - EPS && crop.h > 1 - EPS
  const out: PhotoEdit = { rotate, angle, crop: crop && crop.w > 0.01 && crop.h > 0.01 && !full ? crop : null }
  return isEdited(out) ? out : null
}

/** Turns an edit a quarter clockwise (1) or anticlockwise (-1), carrying the crop round with the frame. */
export function rotateEdit(e: PhotoEdit | null, dir: 1 | -1): PhotoEdit | null {
  const base = e ?? NO_EDIT
  const rotate = (((base.rotate + dir * 90) % 360) + 360) % 360 as PhotoEdit['rotate']
  const c = base.crop
  const crop = c ? (dir === 1 ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w }) : null
  return sanitizeEdit({ rotate, angle: base.angle, crop })
}
