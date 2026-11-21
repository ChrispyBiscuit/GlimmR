// Small live previews of styles and LUTs on the photo being edited, rendered with their own engine so they don't
// disturb the main view.

import { DevelopGL } from './gl'
import { prepare } from '../../../shared/develop/pipeline'
import { unpackLut, type Lut } from '../../../shared/develop/lut'
import type { DevelopSettings } from '../../../shared/develop/settings'
import { api } from '../api'
import type { EditSource } from './source'

const LONG = 168

/** Area-average downscale of 16-bit RGB. */
export function shrink(src: EditSource, long: number): { data: Uint16Array; width: number; height: number } {
  const s = Math.min(1, long / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * s))
  const h = Math.max(1, Math.round(src.height * s))
  const out = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * src.height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * src.height) / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * src.width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * src.width) / w))
      let r = 0
      let g = 0
      let b = 0
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 3
          r += src.data[i]
          g += src.data[i + 1]
          b += src.data[i + 2]
        }
      const n = (y1 - y0) * (x1 - x0)
      const o = (y * w + x) * 3
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = b / n
    }
  }
  return { data: out, width: w, height: h }
}

const luts = new Map<string, Promise<Lut | null>>()
/** A LUT from the catalog, cached for the session. */
export function lutFor(sha: string): Promise<Lut | null> {
  let p = luts.get(sha)
  if (!p) {
    p = api.lutData(sha).then((b) => (b ? unpackLut(new Uint8Array(b)) : null))
    luts.set(sha, p)
  }
  return p
}

export class LookThumbs {
  private eng: DevelopGL | null = null
  private canvas = new OffscreenCanvas(LONG, LONG)
  private src: EditSource | null = null
  private small: { width: number; height: number } = { width: 1, height: 1 }

  setSource(src: EditSource): void {
    this.eng ??= new DevelopGL(new OffscreenCanvas(16, 16))
    const s = shrink(src, LONG)
    this.eng.setSource(s.data, s.width, s.height)
    this.small = s
    this.src = src
  }

  /** Renders settings to an image URL (revoke it when done). */
  async render(settings: DevelopSettings): Promise<string | null> {
    const e = this.eng
    const src = this.src
    if (!e || !src) return null
    const lut = settings.look.lut ? await lutFor(settings.look.lut) : null
    e.setLut(lut, settings.look.lut ?? '')
    e.setLutRange(lut)
    const p = prepare(settings, { kind: src.kind, fullWidth: src.fullWidth, camera: src.camera, autoMul: src.autoMul }, this.small.width / src.fullWidth)
    const t = e.render(p)
    const px = e.read(t) as Uint8Array
    this.canvas.width = t.w
    this.canvas.height = t.h
    const ctx = this.canvas.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.byteLength), t.w, t.h), 0, 0)
    return URL.createObjectURL(await this.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }))
  }

  dispose(): void {
    this.eng?.dispose()
    this.eng = null
  }
}
