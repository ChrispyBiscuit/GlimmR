// Windows bitmaps (BMP/DIB), which sharp can't read: 1, 4 and 8-bit palettes, 16, 24 and 32-bit colour, bit
// fields, RLE4 and RLE8 compression, bottom-up and top-down rows, and alpha.

import type { Decoded } from './types'

const BI_RGB = 0
const BI_RLE8 = 1
const BI_RLE4 = 2
const BI_BITFIELDS = 3
const BI_ALPHABITFIELDS = 6

/** Reads a channel through its mask, scaled to 0–255. */
function maskReader(mask: number): (v: number) => number {
  if (!mask) return () => 255
  let shift = 0
  while (!((mask >>> shift) & 1)) shift++
  const max = mask >>> shift
  return (v) => Math.round((((v & mask) >>> shift) * 255) / max)
}

export function bmpSize(b: Buffer): { width: number; height: number } {
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('Not a BMP file.')
  const core = b.readUInt32LE(14) === 12
  return core ? { width: b.readUInt16LE(18), height: b.readUInt16LE(20) } : { width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) }
}

export function decodeBmp(b: Buffer): Decoded {
  if (b.toString('latin1', 0, 2) !== 'BM') throw new Error('Not a BMP file.')
  const dataAt = b.readUInt32LE(10)
  const hdr = b.readUInt32LE(14)
  const core = hdr === 12
  const width = core ? b.readUInt16LE(18) : b.readInt32LE(18)
  const rawH = core ? b.readUInt16LE(20) : b.readInt32LE(22)
  const bpp = core ? b.readUInt16LE(24) : b.readUInt16LE(28)
  const comp = core ? BI_RGB : b.readUInt32LE(30)
  const used = core ? 0 : b.readUInt32LE(46)
  const topDown = rawH < 0
  const height = Math.abs(rawH)
  if (width <= 0 || height <= 0 || width * height > 400e6) throw new Error('This BMP has an invalid size.')

  // Palette.
  const palAt = 14 + hdr + (!core && hdr === 40 && (comp === BI_BITFIELDS || comp === BI_ALPHABITFIELDS) ? (comp === BI_ALPHABITFIELDS ? 16 : 12) : 0)
  const entry = core ? 3 : 4
  const count = bpp <= 8 ? used || 1 << bpp : 0
  const pal: [number, number, number][] = []
  for (let i = 0; i < count; i++) {
    const o = palAt + i * entry
    pal.push(o + 2 < b.length ? [b[o + 2], b[o + 1], b[o]] : [0, 0, 0])
  }

  // Masks for 16 and 32-bit.
  let masks = bpp === 16 ? [0x7c00, 0x03e0, 0x001f, 0] : [0xff0000, 0x00ff00, 0x0000ff, 0]
  let hasAlpha = false
  if (!core && (comp === BI_BITFIELDS || comp === BI_ALPHABITFIELDS)) {
    masks = [b.readUInt32LE(54), b.readUInt32LE(58), b.readUInt32LE(62), hdr >= 56 || comp === BI_ALPHABITFIELDS ? b.readUInt32LE(66) : 0]
    hasAlpha = masks[3] !== 0
  } else if (!core && hdr >= 56 && bpp === 32) {
    masks[3] = b.readUInt32LE(66)
    hasAlpha = masks[3] !== 0
  }
  const [rm, gm, bm, am] = masks.map(maskReader)

  const ch = hasAlpha ? 4 : 3
  const out = new Uint8Array(width * height * ch)
  const put = (x: number, y: number, r: number, g: number, bl: number, a = 255): void => {
    if (x >= width || y >= height) return
    const row = topDown ? y : height - 1 - y
    const o = (row * width + x) * ch
    out[o] = r
    out[o + 1] = g
    out[o + 2] = bl
    if (ch === 4) out[o + 3] = a
  }
  const putIndex = (x: number, y: number, k: number): void => {
    const c = pal[k] ?? [0, 0, 0]
    put(x, y, c[0], c[1], c[2])
  }

  if (comp === BI_RLE8 || comp === BI_RLE4) {
    // Rows are listed bottom-up; y counts from the first stored row.
    let p = dataAt
    let x = 0
    let y = 0
    while (p + 1 < b.length && y < height) {
      const n = b[p++]
      const v = b[p++]
      if (n > 0) {
        for (let i = 0; i < n; i++) putIndex(x++, y, comp === BI_RLE8 ? v : i % 2 ? v & 15 : v >> 4)
      } else if (v === 0) {
        x = 0
        y++
      } else if (v === 1) break
      else if (v === 2) {
        x += b[p++]
        y += b[p++]
      } else {
        // Absolute run of v pixels, padded to 16 bits.
        const bytes = comp === BI_RLE8 ? v : Math.ceil(v / 2)
        for (let i = 0; i < v; i++) putIndex(x++, y, comp === BI_RLE8 ? b[p + i] : i % 2 ? b[p + (i >> 1)] & 15 : b[p + (i >> 1)] >> 4)
        p += bytes + (bytes % 2)
      }
    }
  } else {
    const stride = Math.ceil((width * bpp) / 32) * 4
    if (dataAt + stride * (height - 1) + Math.ceil((width * bpp) / 8) > b.length) throw new Error('This BMP is truncated.')
    for (let y = 0; y < height; y++) {
      const row = dataAt + y * stride
      for (let x = 0; x < width; x++) {
        if (bpp === 24) put(x, y, b[row + x * 3 + 2], b[row + x * 3 + 1], b[row + x * 3])
        else if (bpp === 32) {
          const v = b.readUInt32LE(row + x * 4)
          put(x, y, rm(v), gm(v), bm(v), am(v))
        } else if (bpp === 16) {
          const v = b.readUInt16LE(row + x * 2)
          put(x, y, rm(v), gm(v), bm(v), am(v))
        } else if (bpp === 8) putIndex(x, y, b[row + x])
        else if (bpp === 4) putIndex(x, y, (b[row + (x >> 1)] >> (x % 2 ? 0 : 4)) & 15)
        else if (bpp === 1) putIndex(x, y, (b[row + (x >> 3)] >> (7 - (x & 7))) & 1)
        else throw new Error(`${bpp}-bit BMP files aren’t supported.`)
      }
    }
  }
  // Many 32-bit BMPs carry an alpha channel that's all zero: treat them as opaque.
  if (ch === 4) {
    let any = false
    for (let i = 3; i < out.length; i += 4)
      if (out[i]) {
        any = true
        break
      }
    if (!any) for (let i = 3; i < out.length; i += 4) out[i] = 255
  }
  return { data: out, width, height, channels: ch }
}
