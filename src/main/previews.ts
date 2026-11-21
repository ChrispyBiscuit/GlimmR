// Thumbnail and preview generation. RAW files are never decoded: the largest embedded JPEG is used. Formats sharp
// can't read (HEIC, JPEG XL, Photoshop, BMP) go through Glimmr's own decoders on worker threads.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import sharp, { type OutputInfo, type Sharp } from 'sharp'
import { RAW_EXTS, readExifThumbnail } from './metadata'
import { decodeFile, hasDecoder, type Decoded } from './decode'
import { x3fPreview } from './decode/x3f'
import { attachIccToPng } from './print/compose'
import { effectiveCrop, fitCrop, frameSize, isEdited, type PhotoEdit } from '../shared/edit'

sharp.concurrency(Math.max(1, Math.min(4, os.cpus().length - 1)))

export const THUMB_SIZE = 480
export const PREVIEW_SIZE = 2560

export interface PreviewPaths {
  /** Grid thumbnail, with any edit applied. */
  thumb: string
  /** Upright preview without the edit: what the crop tool works on. */
  preview: string
  /** Preview with the edit applied (only for edited photos). */
  view: string
  /** Full-resolution render of the edit, made on demand for 100% zoom (only for edited photos). */
  full: string
  /** A RAW + JPEG pair's RAW preview, made on demand to compare with the camera JPEG. */
  raw: string
}

export function previewPaths(cacheDir: string, id: number): PreviewPaths {
  const bucket = String(Math.floor(id / 1000))
  return {
    thumb: path.join(cacheDir, 'thumbs', bucket, `${id}.jpg`),
    preview: path.join(cacheDir, 'previews', bucket, `${id}.jpg`),
    view: path.join(cacheDir, 'edited', bucket, `${id}.jpg`),
    full: path.join(cacheDir, 'edited', bucket, `${id}-full.jpg`),
    raw: path.join(cacheDir, 'previews', bucket, `${id}-raw.jpg`)
  }
}

/**
 * Finds every complete JPEG stream inside a buffer by walking its marker segments, and returns the largest.
 * RAW containers (CR2, NEF, ARW, RAF, ORF, DNG…) all embed one or more JPEG previews.
 */
export function largestEmbeddedJpeg(buf: Buffer): Buffer | null {
  let best: [number, number] | null = null
  let i = 0
  while ((i = buf.indexOf(0xff, i)) !== -1 && i < buf.length - 4) {
    if (buf[i + 1] !== 0xd8 || buf[i + 2] !== 0xff) {
      i++
      continue
    }
    const { end, decodable } = jpegEnd(buf, i)
    if (end > 0) {
      // Raw sensor data is often lossless JPEG (Canon CR2, many DNGs): bigger than the preview, but not a picture.
      if (decodable && (!best || end - i > best[1] - best[0])) best = [i, end]
      i = end
    } else i += 2
  }
  return best ? buf.subarray(best[0], best[1]) : null
}

/**
 * Finds the end of a JPEG starting at `start`: the offset just past EOI, or -1 if it is not well-formed. `decodable`
 * is false for frame types libjpeg can't read, such as lossless (SOF3), which cameras use for sensor data.
 */
function jpegEnd(buf: Buffer, start: number): { end: number; decodable: boolean } {
  let p = start + 2
  let frame = -1
  const done = (end: number): { end: number; decodable: boolean } => ({ end, decodable: frame >= 0xc0 && frame <= 0xc2 })
  while (p < buf.length - 1) {
    if (buf[p] !== 0xff) return done(-1)
    let marker = buf[p + 1]
    while (marker === 0xff && p < buf.length - 2) {
      p++
      marker = buf[p + 1]
    }
    if (marker === 0xd9) return done(frame >= 0 ? p + 2 : -1)
    if (marker >= 0xd0 && marker <= 0xd7) {
      p += 2
      continue
    }
    if (p + 3 >= buf.length) return done(-1)
    const len = buf.readUInt16BE(p + 2)
    if (len < 2) return done(-1)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && frame < 0) frame = marker
    p += 2 + len
    if (marker === 0xda) {
      // Entropy-coded data: runs until a marker that is not a stuffed byte or restart marker.
      while (p < buf.length - 1) {
        if (buf[p] === 0xff) {
          const n = buf[p + 1]
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) {
            p += n === 0xff ? 1 : 2
            continue
          }
          break
        }
        p++
      }
    }
  }
  return done(-1)
}

// Cameras only produce rotated orientations; mirrored ones (2, 4, 5, 7) are left as stored.
const ORIENT_ROTATION: Record<number, number> = { 3: 180, 6: 90, 8: 270 }

const execFileP = promisify(execFile)

/** Produces a decodable source buffer for a file, plus the orientation still to apply. */
export async function sourceFor(file: string, ext: string, exifOrientation: number): Promise<{ input: Buffer | string; orientation: number | 'auto' }> {
  if (RAW_EXTS.has(ext)) {
    const buf = await fs.promises.readFile(file)
    if (ext === 'x3f') {
      const x = x3fPreview(buf)
      if (x) return { input: await decodedInput(x), orientation: x.encoded ? 'auto' : exifOrientation }
    }
    const jpeg = largestEmbeddedJpeg(buf)
    const meta = jpeg ? await sharp(jpeg).metadata().catch(() => null) : null
    // Tiny EXIF thumbnails look bad scaled up; prefer decoding the file when that is all there is.
    if (jpeg && meta && (meta.width ?? 0) >= 320) {
      return { input: jpeg, orientation: meta.orientation && meta.orientation > 1 ? 'auto' : exifOrientation }
    }
    // DNG and some others may be decodable directly (libvips via libtiff).
    try {
      await sharp(buf).metadata()
      return { input: buf, orientation: 'auto' }
    } catch {
      /* fall through */
    }
    const thumb = await readExifThumbnail(file)
    if (thumb) return { input: thumb, orientation: exifOrientation }
    if (jpeg && meta) return { input: jpeg, orientation: exifOrientation }
    throw new Error('No preview available in RAW file')
  }
  if (hasDecoder(ext)) {
    try {
      // Decoders return upright pixels (libheif applies the file's rotation), so no further turn.
      const d = await decodeFile(file, ext)
      return { input: await decodedInput(d), orientation: d.encoded ? 'auto' : 1 }
    } catch (e) {
      if (!/^(heic|heif|hif)$/.test(ext) || process.platform !== 'darwin') {
        const thumb = await readExifThumbnail(file).catch(() => null)
        if (thumb) return { input: thumb, orientation: exifOrientation }
        throw e
      }
      // macOS can always convert HEIC itself.
      return { input: await sipsJpeg(file), orientation: 'auto' }
    }
  }
  try {
    await sharp(file).metadata()
    return { input: file, orientation: 'auto' }
  } catch (e) {
    const thumb = await readExifThumbnail(file)
    if (thumb) return { input: thumb, orientation: exifOrientation }
    throw e
  }
}

async function sipsJpeg(file: string): Promise<Buffer> {
  const out = path.join(os.tmpdir(), `glimmr-${process.pid}-${Date.now()}.jpg`)
  await execFileP('sips', ['-s', 'format', 'jpeg', file, '--out', out])
  const data = await fs.promises.readFile(out)
  void fs.promises.rm(out, { force: true })
  return data
}

/** Decoded pixels as an image sharp reads with its colour profile: an uncompressed PNG tagged with the ICC. */
async function decodedInput(d: Decoded): Promise<Buffer> {
  if (d.encoded) return Buffer.from(d.encoded.buffer, d.encoded.byteOffset, d.encoded.byteLength)
  const png = await sharp(Buffer.from(d.data.buffer, d.data.byteOffset, d.data.byteLength), { raw: { width: d.width, height: d.height, channels: d.channels }, limitInputPixels: false })
    .png({ compressionLevel: 0 })
    .toBuffer()
  return d.icc ? attachIccToPng(png, Buffer.from(d.icc)) : png
}

/** Pixel size after the pipeline's rotation. */
async function uprightSize(input: Buffer | string, orientation: number | 'auto'): Promise<{ width: number; height: number } | null> {
  const m = await sharp(input, { limitInputPixels: false }).metadata().catch(() => null)
  if (!m?.width || !m.height) return null
  const quarter = orientation === 'auto' ? (m.orientation ?? 1) >= 5 : ORIENT_ROTATION[orientation] === 90 || ORIENT_ROTATION[orientation] === 270
  return quarter ? { width: m.height, height: m.width } : { width: m.width, height: m.height }
}

export function pipeline(input: Buffer | string, orientation: number | 'auto'): Sharp {
  let img = sharp(input, { failOn: 'none', limitInputPixels: false })
  if (orientation === 'auto') img = img.rotate()
  else if (ORIENT_ROTATION[orientation]) img = img.rotate(ORIENT_ROTATION[orientation])
  return img
}

/**
 * Applies an edit to an upright image: turns and straightens it in one rotation, then cuts out the crop. The crop
 * is in the quarter-turned frame, which sits centred in the rotated image's bounding box.
 */
export async function applyEdit(upright: Sharp, e: PhotoEdit): Promise<Sharp> {
  const src = await upright.flatten({ background: '#111' }).raw().toBuffer({ resolveWithObject: true })
  const raw = (i: OutputInfo): { raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 } } => ({ raw: { width: i.width, height: i.height, channels: i.channels } })
  const frame = frameSize(src.info.width, src.info.height, e.rotate)
  let crop = effectiveCrop(e, frame.w, frame.h)
  if (crop) crop = fitCrop(crop, frame.w, frame.h, e.angle)
  const turn = e.rotate + e.angle
  if (turn % 360 === 0 && !crop) return sharp(src.data, raw(src.info))
  const turned = turn % 360 === 0 ? src : await sharp(src.data, raw(src.info)).rotate(turn, { background: '#111' }).raw().toBuffer({ resolveWithObject: true })
  if (!crop) return sharp(turned.data, raw(turned.info))
  const ox = (turned.info.width - frame.w) / 2
  const oy = (turned.info.height - frame.h) / 2
  // Round inwards, and when straightened keep off the antialiased edge, so no background shows.
  const inset = e.angle ? 1 : 0
  const left = Math.max(0, Math.ceil(ox + crop.x * frame.w - 1e-6) + inset)
  const top = Math.max(0, Math.ceil(oy + crop.y * frame.h - 1e-6) + inset)
  const right = Math.min(turned.info.width, Math.floor(ox + (crop.x + crop.w) * frame.w + 1e-6) - inset)
  const bottom = Math.min(turned.info.height, Math.floor(oy + (crop.y + crop.h) * frame.h + 1e-6) - inset)
  const width = Math.max(1, right - left)
  const height = Math.max(1, bottom - top)
  return sharp(turned.data, raw(turned.info)).extract({ left, top, width, height })
}

const inflight = new Map<string, Promise<{ width: number; height: number } | null>>()

/**
 * Generates a photo's previews: the upright preview, plus the edited one when there's an edit, and the thumbnail
 * from whichever is shown. Concurrent calls for the same photo share one job.
 */
export function generatePreviews(file: string, ext: string, exifOrientation: number, out: PreviewPaths, edit: PhotoEdit | null = null): Promise<{ width: number; height: number } | null> {
  const existing = inflight.get(out.thumb)
  if (existing) return existing
  const job = (async () => {
    const { input, orientation } = await sourceFor(file, ext, exifOrientation)
    for (const f of [out.thumb, out.preview, out.view]) await fs.promises.mkdir(path.dirname(f), { recursive: true })
    const toPreview = (img: Sharp): Promise<Buffer> =>
      img.resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#111' }).jpeg({ quality: 85, mozjpeg: false }).toBuffer()
    // The upright size of what was decoded, for files whose metadata has none.
    const size = await uprightSize(input, orientation)
    const preview = await toPreview(pipeline(input, orientation))
    await fs.promises.writeFile(out.preview, preview)
    await fs.promises.rm(out.full, { force: true })
    let shown = preview
    if (isEdited(edit)) {
      // Edit at source resolution so crops stay sharp.
      shown = await toPreview(await applyEdit(pipeline(input, orientation), edit))
      await fs.promises.writeFile(out.view, shown)
    } else await fs.promises.rm(out.view, { force: true })
    await sharp(shown).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out.thumb)
    return size
  })().finally(() => inflight.delete(out.thumb))
  inflight.set(out.thumb, job)
  return job
}

/** A plain upright preview of a file (no edit), e.g. a pair's RAW. */
export async function renderPreviewOf(file: string, ext: string, exifOrientation: number, out: string): Promise<void> {
  const { input, orientation } = await sourceFor(file, ext, exifOrientation)
  await fs.promises.mkdir(path.dirname(out), { recursive: true })
  await pipeline(input, orientation).resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#111' }).jpeg({ quality: 85 }).toFile(`${out}.tmp`)
  await fs.promises.rename(`${out}.tmp`, out)
}

/** Renders an edited original at full resolution, for viewing at 100%. Only for formats the viewer shows directly. */
export async function renderFullEdit(file: string, edit: PhotoEdit, out: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(out), { recursive: true })
  const img = await applyEdit(sharp(file, { failOn: 'none', limitInputPixels: false }).rotate(), edit)
  await img.jpeg({ quality: 92 }).toFile(`${out}.tmp`)
  await fs.promises.rename(`${out}.tmp`, out)
}

/** Pixel size of the decodable image, for files whose metadata lacks dimensions. */
export async function imageSize(file: string): Promise<{ width: number; height: number } | null> {
  try {
    const m = await sharp(file).metadata()
    if (!m.width || !m.height) return null
    return (m.orientation ?? 1) >= 5 ? { width: m.height, height: m.width } : { width: m.width, height: m.height }
  } catch {
    return null
  }
}
