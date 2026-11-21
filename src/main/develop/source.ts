// A photo's develop source: what the develop pipeline starts from. Raw files (including the RAW of a RAW + JPEG
// pair) are developed by LibRaw to linear camera RGB with their colour data; other files, and raw files LibRaw can't
// read, are decoded to 16-bit sRGB. The 2560 px editing copy is cached on disk; full resolution is decoded on demand.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { decodeRaw } from '../decode'
import { pipeline, sourceFor } from '../previews'
import { displayFile } from '../files'
import { RAW_EXTS } from '../../shared/formats'
import { greyWorld } from '../../shared/develop/pipeline'
import type { CameraColor, Vec3 } from '../../shared/develop/color'
import type { SourceKind } from '../../shared/develop/settings'
import type { Photo } from '../../shared/types'

export const PROXY_SIZE = 2560

export interface DevelopSource {
  kind: SourceKind
  width: number
  height: number
  /** The photo's full width, so effects measured in pixels scale with the render. */
  fullWidth: number
  camera?: CameraColor
  autoMul?: Vec3
  /** RGB, 16 bits: linear camera RGB for raw, sRGB-encoded otherwise. */
  data: Uint16Array
}

/** Just the header, for the renderer and the catalog. */
export type SourceHeader = Omit<DevelopSource, 'data'>

/** Decodes a photo for developing: at most `max` pixels on the long edge (0 for full size). */
export async function decodeSource(p: Pick<Photo, 'path' | 'ext' | 'companion'>, max: number, exifOrientation = 1): Promise<DevelopSource> {
  if (RAW_EXTS.has(p.ext)) {
    try {
      // Half-size decoding is 4× faster and still sharper than the editing copy needs.
      let r = await decodeRaw(p.path, max > 0)
      if (max > 0 && Math.max(r.width, r.height) < max * 0.9) r = await decodeRaw(p.path, false)
      let { data, width, height } = r
      if (max > 0 && Math.max(width, height) > max) {
        const small = downscale(data, width, height, max)
        data = small.data
        width = small.width
        height = small.height
      }
      const src: DevelopSource = { kind: 'raw', width, height, fullWidth: r.fullWidth, camera: r.camera, data }
      src.autoMul = greyWorld(toFloat(src), 'raw')
      return src
    } catch {
      // LibRaw can't read it (damaged, or a format it doesn't support): develop the displayed image instead.
    }
  }
  const shown = displayFile(p)
  const { input, orientation } = await sourceFor(shown.path, shown.ext, exifOrientation)
  let img = pipeline(input, orientation).removeAlpha().toColourspace('rgb16')
  const meta = await sharp(input as Buffer | string, { limitInputPixels: false }).metadata()
  if (max > 0) img = img.resize(max, max, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
  const out = await img.raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true })
  const data = new Uint16Array(out.data.buffer, out.data.byteOffset, out.data.byteLength / 2)
  const quarter = orientation === 'auto' ? (meta.orientation ?? 1) >= 5 : orientation === 6 || orientation === 8
  const fullWidth = (quarter ? meta.height : meta.width) ?? out.info.width
  const src: DevelopSource = { kind: 'display', width: out.info.width, height: out.info.height, fullWidth, data }
  src.autoMul = greyWorld(toFloat(src), 'display')
  return src
}

/**
 * Shrinks 16-bit RGB so the long edge is at most `max`, averaging the source pixels each output pixel covers (an
 * exact area average, right for linear raw data).
 */
export function downscale(src: Uint16Array, w: number, h: number, max: number): { data: Uint16Array; width: number; height: number } {
  const s = max / Math.max(w, h)
  const W = Math.max(1, Math.round(w * s))
  const H = Math.max(1, Math.round(h * s))
  const out = new Uint16Array(W * H * 3)
  const fx = w / W
  const fy = h / H
  const acc = new Float64Array(W * 3)
  const wsum = new Float64Array(W)
  for (let Y = 0; Y < H; Y++) {
    acc.fill(0)
    wsum.fill(0)
    const y0 = Y * fy
    const y1 = (Y + 1) * fy
    for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
      const wy = Math.min(y + 1, y1) - Math.max(y, y0)
      for (let X = 0; X < W; X++) {
        const x0 = X * fx
        const x1 = (X + 1) * fx
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const wgt = wy * (Math.min(x + 1, x1) - Math.max(x, x0))
          const i = (y * w + x) * 3
          acc[X * 3] += src[i] * wgt
          acc[X * 3 + 1] += src[i + 1] * wgt
          acc[X * 3 + 2] += src[i + 2] * wgt
          wsum[X] += wgt
        }
      }
    }
    for (let X = 0; X < W; X++) for (let c = 0; c < 3; c++) out[(Y * W + X) * 3 + c] = Math.round(acc[X * 3 + c] / wsum[X])
  }
  return { data: out, width: W, height: H }
}

export function toFloat(s: DevelopSource): { width: number; height: number; data: Float32Array } {
  const f = new Float32Array(s.data.length)
  for (let i = 0; i < s.data.length; i++) f[i] = s.data[i] / 65535
  return { width: s.width, height: s.height, data: f }
}

// ---- the editing copy, cached on disk ----

const MAGIC = 'GLDS1'

export function proxyPath(cacheDir: string, id: number): string {
  return path.join(cacheDir, 'develop', String(Math.floor(id / 1000)), `${id}.src`)
}

export function serialize(s: DevelopSource, key: string): Buffer {
  const { data, ...head } = s
  const h = Buffer.from(JSON.stringify({ ...head, key }))
  const out = Buffer.alloc(MAGIC.length + 4 + h.length + data.byteLength)
  out.write(MAGIC, 0, 'latin1')
  out.writeUInt32LE(h.length, MAGIC.length)
  h.copy(out, MAGIC.length + 4)
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(out, MAGIC.length + 4 + h.length)
  return out
}

export function deserialize(b: Buffer): (DevelopSource & { key: string }) | null {
  if (b.toString('latin1', 0, MAGIC.length) !== MAGIC) return null
  const n = b.readUInt32LE(MAGIC.length)
  const head = JSON.parse(b.toString('utf8', MAGIC.length + 4, MAGIC.length + 4 + n)) as SourceHeader & { key: string }
  const start = MAGIC.length + 4 + n
  const copy = new Uint8Array(b.byteLength - start)
  copy.set(b.subarray(start))
  return { ...head, data: new Uint16Array(copy.buffer) }
}

const inflight = new Map<string, Promise<Buffer>>()

/**
 * The photo's editing copy as bytes (header + 16-bit pixels), from the cache when the file hasn't changed. `key`
 * identifies the file version (path, size and modified time).
 */
export function proxyBytes(cacheDir: string, id: number, p: Pick<Photo, 'path' | 'ext' | 'companion' | 'mtime' | 'size'>, exifOrientation: number): Promise<Buffer> {
  const file = proxyPath(cacheDir, id)
  const key = `${p.path}|${p.size}|${p.mtime}`
  const running = inflight.get(file)
  if (running) return running
  const job = (async () => {
    try {
      const cached = await fs.promises.readFile(file)
      const head = deserialize(cached)
      if (head?.key === key) return cached
    } catch {
      /* not cached */
    }
    const src = await decodeSource(p, PROXY_SIZE, exifOrientation)
    const bytes = serialize(src, key)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(`${file}.tmp`, bytes)
    await fs.promises.rename(`${file}.tmp`, file)
    return bytes
  })().finally(() => inflight.delete(file))
  inflight.set(file, job)
  return job
}
