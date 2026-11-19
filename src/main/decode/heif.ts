// HEIC/HEIF (iPhone, and Canon, Fujifilm and Sony's 10-bit .hif). sharp's prebuilt libvips only decodes AVIF, so
// HEVC images are decoded by libheif compiled to WebAssembly, which runs the same on Windows, macOS and Linux.

import type { Decoded } from './types'

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  has_alpha_channel(): boolean
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (d: unknown) => void): void
  free(): void
}
interface LibHeif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
}

let lib: LibHeif | undefined
function libheif(): LibHeif {
  // The bundle embeds its WebAssembly, so nothing else has to be found at run time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (lib ??= require('libheif-js/wasm-bundle') as LibHeif)
}

/** The ICC profile from the file's `colr` box (iPhones embed Display P3), if any. */
export function heifIcc(b: Uint8Array): Uint8Array | undefined {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  // The colr property sits in the meta box near the start; don't scan the image data.
  const limit = Math.min(buf.length, 1 << 20)
  let i = buf.indexOf('colr', 4, 'latin1')
  while (i >= 4 && i < limit) {
    const size = buf.readUInt32BE(i - 4)
    if (buf.toString('latin1', i + 4, i + 8) === 'prof' && size > 140 && i - 4 + size <= buf.length) return new Uint8Array(buf.subarray(i + 8, i - 4 + size))
    i = buf.indexOf('colr', i + 4, 'latin1')
  }
  return undefined
}

export async function decodeHeif(b: Uint8Array): Promise<Decoded> {
  const images = new (libheif().HeifDecoder)().decode(b)
  if (!images.length) throw new Error('This HEIC file has no image libheif can decode.')
  try {
    const img = images.find((i) => i.is_primary()) ?? images[0]
    const width = img.get_width()
    const height = img.get_height()
    const rgba = new Uint8ClampedArray(width * height * 4)
    // libheif applies the file's rotation and mirroring, so the pixels come back upright.
    await new Promise<void>((resolve, reject) => img.display({ data: rgba, width, height }, (d) => (d ? resolve() : reject(new Error('libheif couldn’t decode this HEIC file.')))))
    const icc = heifIcc(b)
    if (img.has_alpha_channel())
      return {
        data: new Uint8Array(rgba.buffer),
        width,
        height,
        channels: 4,
        icc
      }
    const rgb = new Uint8Array(width * height * 3)
    for (let p = 0, q = 0; p < rgba.length; p += 4, q += 3) {
      rgb[q] = rgba[p]
      rgb[q + 1] = rgba[p + 1]
      rgb[q + 2] = rgba[p + 2]
    }
    return { data: rgb, width, height, channels: 3, icc }
  } finally {
    for (const i of images) i.free()
  }
}
