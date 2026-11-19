// Sigma X3F (Foveon) raw files keep their previews in the file's own section directory rather than as a plain
// JPEG: uncompressed RGB in older cameras (SD9, SD10), JPEG in later ones. This reads the largest one.

import type { Decoded } from './types'

const PREVIEW = 2
const RGB8 = 3
const JPEG = 18

export function x3fPreview(b: Buffer): Decoded | null {
  if (b.length < 64 || b.toString('latin1', 0, 4) !== 'FOVb') return null
  const dir = b.readUInt32LE(b.length - 4)
  if (dir + 12 > b.length || b.toString('latin1', dir, dir + 4) !== 'SECd') return null
  const n = b.readUInt32LE(dir + 8)
  let best: {
    off: number
    len: number
    fmt: number
    w: number
    h: number
    stride: number
  } | null = null
  for (let i = 0; i < n; i++) {
    const e = dir + 12 + i * 12
    if (e + 12 > b.length) break
    const off = b.readUInt32LE(e)
    const len = b.readUInt32LE(e + 4)
    const type = b.toString('latin1', e + 8, e + 12)
    if ((type !== 'IMA2' && type !== 'IMAG') || off + 28 > b.length || b.toString('latin1', off, off + 4) !== 'SECi') continue
    const kind = b.readUInt32LE(off + 8)
    const fmt = b.readUInt32LE(off + 12)
    const w = b.readUInt32LE(off + 16)
    const h = b.readUInt32LE(off + 20)
    if (kind !== PREVIEW || (fmt !== RGB8 && fmt !== JPEG)) continue
    if (!best || w * h > best.w * best.h) best = { off, len, fmt, w, h, stride: b.readUInt32LE(off + 24) }
  }
  if (!best) return null
  const data = b.subarray(best.off + 28, Math.min(b.length, best.off + best.len))
  if (best.fmt === JPEG) return { encoded: new Uint8Array(data) }
  const stride = best.stride || best.w * 3
  if (stride * (best.h - 1) + best.w * 3 > data.length) return null
  const out = new Uint8Array(best.w * best.h * 3)
  for (let y = 0; y < best.h; y++) out.set(data.subarray(y * stride, y * stride + best.w * 3), y * best.w * 3)
  return { data: out, width: best.w, height: best.h, channels: 3 }
}
