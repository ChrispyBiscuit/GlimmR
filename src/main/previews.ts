// Thumbnail and preview generation. RAW files are never decoded: the largest embedded JPEG is used.

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import sharp, { type Sharp } from 'sharp'
import { RAW_EXTS, readExifThumbnail } from './metadata'

sharp.concurrency(Math.max(1, Math.min(4, os.cpus().length - 1)))

export const THUMB_SIZE = 480
export const PREVIEW_SIZE = 2560

export interface PreviewPaths {
  thumb: string
  preview: string
}

export function previewPaths(cacheDir: string, id: number): PreviewPaths {
  const bucket = String(Math.floor(id / 1000))
  return {
    thumb: path.join(cacheDir, 'thumbs', bucket, `${id}.jpg`),
    preview: path.join(cacheDir, 'previews', bucket, `${id}.jpg`)
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
    const end = jpegEnd(buf, i)
    if (end > 0) {
      if (!best || end - i > best[1] - best[0]) best = [i, end]
      i = end
    } else i += 2
  }
  return best ? buf.subarray(best[0], best[1]) : null
}

/** Returns the offset just past EOI for a JPEG starting at `start`, or -1 if it is not well-formed. */
function jpegEnd(buf: Buffer, start: number): number {
  let p = start + 2
  let sawFrame = false
  while (p < buf.length - 1) {
    if (buf[p] !== 0xff) return -1
    let marker = buf[p + 1]
    while (marker === 0xff && p < buf.length - 2) {
      p++
      marker = buf[p + 1]
    }
    if (marker === 0xd9) return sawFrame ? p + 2 : -1
    if (marker >= 0xd0 && marker <= 0xd7) {
      p += 2
      continue
    }
    if (p + 3 >= buf.length) return -1
    const len = buf.readUInt16BE(p + 2)
    if (len < 2) return -1
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) sawFrame = true
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
  return -1
}

// Cameras only produce rotated orientations; mirrored ones (2, 4, 5, 7) are left as stored.
const ORIENT_ROTATION: Record<number, number> = { 3: 180, 6: 90, 8: 270 }

const execFileP = promisify(execFile)

/** Produces a decodable source buffer for a file, plus the orientation still to apply. */
async function sourceFor(file: string, ext: string, exifOrientation: number): Promise<{ input: Buffer | string; orientation: number | 'auto' }> {
  if (RAW_EXTS.has(ext)) {
    const buf = await fs.promises.readFile(file)
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
  try {
    await sharp(file).metadata()
    return { input: file, orientation: 'auto' }
  } catch (e) {
    if ((ext === 'heic' || ext === 'heif') && process.platform === 'darwin') {
      const out = path.join(os.tmpdir(), `glimmr-${process.pid}-${Date.now()}.jpg`)
      await execFileP('sips', ['-s', 'format', 'jpeg', file, '--out', out])
      const data = await fs.promises.readFile(out)
      fs.promises.rm(out, { force: true })
      return { input: data, orientation: 'auto' }
    }
    const thumb = await readExifThumbnail(file)
    if (thumb) return { input: thumb, orientation: exifOrientation }
    throw e
  }
}

function pipeline(input: Buffer | string, orientation: number | 'auto'): Sharp {
  let img = sharp(input, { failOn: 'none', limitInputPixels: false })
  if (orientation === 'auto') img = img.rotate()
  else if (ORIENT_ROTATION[orientation]) img = img.rotate(ORIENT_ROTATION[orientation])
  return img
}

const inflight = new Map<string, Promise<void>>()

/** Generates thumbnail and preview for a photo. Concurrent calls for the same photo share one job. */
export function generatePreviews(file: string, ext: string, exifOrientation: number, out: PreviewPaths): Promise<void> {
  const existing = inflight.get(out.thumb)
  if (existing) return existing
  const job = (async () => {
    const { input, orientation } = await sourceFor(file, ext, exifOrientation)
    await fs.promises.mkdir(path.dirname(out.thumb), { recursive: true })
    await fs.promises.mkdir(path.dirname(out.preview), { recursive: true })
    // Render the preview once, then derive the thumbnail from it.
    const preview = await pipeline(input, orientation)
      .resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#111' })
      .jpeg({ quality: 85, mozjpeg: false })
      .toBuffer()
    await fs.promises.writeFile(out.preview, preview)
    await sharp(preview).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out.thumb)
  })().finally(() => inflight.delete(out.thumb))
  inflight.set(out.thumb, job)
  return job
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
