// Photoshop documents (PSD and large-document PSB): reads the flattened composite Photoshop saves with the file
// ("Maximize compatibility"), plus its ICC profile. Layers aren't composited; when the composite is missing, the
// embedded JPEG thumbnail is used instead.

import type { Decoded } from './types'

const MODE = {
  bitmap: 0,
  gray: 1,
  indexed: 2,
  rgb: 3,
  cmyk: 4,
  multichannel: 7,
  duotone: 8,
  lab: 9
}

class Reader {
  constructor(
    readonly b: Buffer,
    public p = 0
  ) {}
  u8 = (): number => this.b[this.p++]
  u16 = (): number => ((this.p += 2), this.b.readUInt16BE(this.p - 2))
  u32 = (): number => ((this.p += 4), this.b.readUInt32BE(this.p - 4))
  u64 = (): number => ((this.p += 8), Number(this.b.readBigUInt64BE(this.p - 8)))
  need(n: number): void {
    if (this.p + n > this.b.length) throw new Error('This Photoshop file is truncated.')
  }
}

export interface PsdHeader {
  version: 1 | 2
  channels: number
  width: number
  height: number
  depth: number
  mode: number
}

export function psdHeader(b: Buffer): PsdHeader {
  if (b.toString('latin1', 0, 4) !== '8BPS') throw new Error('Not a Photoshop file.')
  const r = new Reader(b, 4)
  const version = r.u16()
  if (version !== 1 && version !== 2) throw new Error('Unknown Photoshop file version.')
  r.p += 6
  const channels = r.u16()
  const height = r.u32()
  const width = r.u32()
  const depth = r.u16()
  const mode = r.u16()
  return { version, channels, width, height, depth, mode }
}

/** PackBits rows into one plane. */
function unpackBits(src: Buffer, at: number, len: number, out: Uint8Array, o: number, max: number): void {
  let p = at
  const end = at + len
  let q = o
  const stop = o + max
  while (p < end && q < stop) {
    const n = src[p++]
    if (n < 128) {
      const c = Math.min(n + 1, stop - q, end - p)
      out.set(src.subarray(p, p + c), q)
      p += n + 1
      q += c
    } else if (n > 128) {
      const c = Math.min(257 - n, stop - q)
      out.fill(src[p++], q, q + c)
      q += c
    }
  }
}

/** Linear light to sRGB, for 32-bit documents. */
const toSrgb = (v: number): number => {
  const c = Math.max(0, Math.min(1, v))
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
}

/** CIE L*a*b* (D50) to sRGB. */
function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - bb / 200
  const inv = (t: number): number => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29))
  const X = 0.9642 * inv(fx)
  const Y = inv(fy)
  const Z = 0.8249 * inv(fz)
  // Bradford-adapted D50 → linear sRGB.
  const r = 3.1338561 * X - 1.6168667 * Y - 0.4906146 * Z
  const g = -0.9787684 * X + 1.9161415 * Y + 0.033454 * Z
  const b = 0.0719453 * X - 0.2289914 * Y + 1.4052427 * Z
  return [toSrgb(r), toSrgb(g), toSrgb(b)]
}

export function decodePsd(b: Buffer): Decoded {
  const h = psdHeader(b)
  const { width: w, height: ht, depth, mode, version } = h
  if (!w || !ht) throw new Error('This Photoshop file has no image.')
  const r = new Reader(b, 26)
  const paletteLen = r.u32()
  const palette = b.subarray(r.p, r.p + paletteLen)
  r.p += paletteLen
  const resLen = r.u32()
  const resEnd = r.p + resLen
  let icc: Uint8Array | undefined
  let thumb: Buffer | undefined
  while (r.p + 12 <= resEnd) {
    if (b.toString('latin1', r.p, r.p + 4) !== '8BIM') break
    r.p += 4
    const id = r.u16()
    const nameLen = r.u8()
    r.p += nameLen + ((nameLen + 1) % 2)
    const size = r.u32()
    const data = b.subarray(r.p, r.p + size)
    if (id === 1039) icc = new Uint8Array(data)
    else if ((id === 1036 || id === 1033) && data.length > 28 && data.readUInt32BE(0) === 1) thumb = data.subarray(28)
    r.p += size + (size % 2)
  }
  r.p = resEnd
  const layerLen = version === 2 ? r.u64() : r.u32()
  r.p += layerLen

  const fromThumb = (why: string): Decoded => {
    if (thumb) return { encoded: new Uint8Array(thumb), thumbnailOnly: true }
    throw new Error(why)
  }
  if (r.p + 2 > b.length) return fromThumb('This Photoshop file has no flattened image. Save it with “Maximize compatibility” on.')
  const compression = r.u16()
  const colour = mode === MODE.rgb ? 3 : mode === MODE.cmyk ? 4 : mode === MODE.lab ? 3 : 1
  const planes = Math.min(h.channels, colour)
  if (h.channels < colour) throw new Error('This Photoshop file is missing colour channels.')
  const rowBytes = depth === 1 ? Math.ceil(w / 8) : (w * depth) / 8
  const plane = rowBytes * ht
  const raw = new Uint8Array(plane * planes)
  if (compression === 0) {
    r.need(plane * planes)
    raw.set(b.subarray(r.p, r.p + plane * planes))
  } else if (compression === 1) {
    // Row byte counts for every channel, then the rows.
    const countSize = version === 2 ? 4 : 2
    const counts: number[] = []
    for (let i = 0; i < h.channels * ht; i++) counts.push(countSize === 4 ? r.u32() : r.u16())
    let p = r.p
    for (let c = 0; c < planes; c++)
      for (let y = 0; y < ht; y++) {
        const n = counts[c * ht + y]
        unpackBits(b, p, n, raw, c * plane + y * rowBytes, rowBytes)
        p += n
      }
  } else return fromThumb('This Photoshop file’s image is ZIP-compressed, which Glimmr can’t read yet.')

  // One 8-bit sample per channel.
  const sample = (c: number, i: number): number => {
    if (depth === 8) return raw[c * plane + i]
    if (depth === 16) return raw[c * plane + i * 2]
    if (depth === 32) {
      const o = c * plane + i * 4
      return toSrgb(new DataView(raw.buffer, raw.byteOffset + o, 4).getFloat32(0))
    }
    // 1-bit: set bits are black.
    const y = Math.floor(i / w)
    const x = i % w
    return raw[c * plane + y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255
  }

  const n = w * ht
  if (mode === MODE.gray || mode === MODE.bitmap || mode === MODE.duotone || mode === MODE.multichannel) {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = sample(0, i)
    return {
      data: out,
      width: w,
      height: ht,
      channels: 1,
      icc: mode === MODE.gray ? icc : undefined
    }
  }
  const out = new Uint8Array(n * 3)
  if (mode === MODE.rgb) {
    for (let i = 0; i < n; i++) {
      out[i * 3] = sample(0, i)
      out[i * 3 + 1] = sample(1, i)
      out[i * 3 + 2] = sample(2, i)
    }
    return { data: out, width: w, height: ht, channels: 3, icc }
  }
  if (mode === MODE.indexed) {
    for (let i = 0; i < n; i++) {
      const k = sample(0, i)
      out[i * 3] = palette[k] ?? 0
      out[i * 3 + 1] = palette[256 + k] ?? 0
      out[i * 3 + 2] = palette[512 + k] ?? 0
    }
    return { data: out, width: w, height: ht, channels: 3 }
  }
  if (mode === MODE.cmyk) {
    // Stored inverted (0 = full ink). A simple conversion; CMYK documents are rare in photo libraries.
    for (let i = 0; i < n; i++) {
      const k = sample(3, i) / 255
      out[i * 3] = Math.round(sample(0, i) * k)
      out[i * 3 + 1] = Math.round(sample(1, i) * k)
      out[i * 3 + 2] = Math.round(sample(2, i) * k)
    }
    return { data: out, width: w, height: ht, channels: 3 }
  }
  if (mode === MODE.lab) {
    for (let i = 0; i < n; i++) {
      const [R, G, B] = labToRgb((sample(0, i) * 100) / 255, sample(1, i) - 128, sample(2, i) - 128)
      out[i * 3] = R
      out[i * 3 + 1] = G
      out[i * 3 + 2] = B
    }
    return { data: out, width: w, height: ht, channels: 3 }
  }
  return fromThumb('This Photoshop colour mode isn’t supported.')
}
