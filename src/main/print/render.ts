// Renders photos for print: the photo (with its non-destructive edit) cropped to its cell, turned to fit, resampled
// to the exact print size, then the print adjustment, print sharpening and greyscale. Colour conversion is separate
// (color.ts) so preview and output share everything else.

import fs from 'node:fs'
import sharp, { type Sharp } from 'sharp'
import { applyEdit, generatePreviews, pipeline as pipelineFor, previewPaths, sourceFor } from '../previews'
import { isEdited, type PhotoEdit } from '../../shared/edit'
import { sharpenParams, type Cell, type PrintSettings } from '../../shared/print'

/** What the renderer needs to find a photo's pixels. A chart or other generated image uses `file`. */
export interface PrintSource {
  id: number
  path: string
  ext: string
  exifOrientation: number
  edit: PhotoEdit | null
  offline: boolean
  /** A ready image to print instead of the photo (the calibration chart). */
  file?: string
  /** A developed photo: its developed image, upright (preview size, or full size for output). */
  developed?: (quality: 'preview' | 'final') => Promise<string>
}

export interface RawImage {
  data: Buffer
  width: number
  height: number
}

/** The photo upright and edited. Previews start from the cached 2560 px preview; output from the original. */
async function upright(src: PrintSource, cacheDir: string, quality: 'preview' | 'final'): Promise<Sharp> {
  if (src.file) return sharp(src.file)
  if (src.developed) {
    const dev = sharp(await src.developed(quality))
    return isEdited(src.edit) ? applyEdit(dev, src.edit) : dev
  }
  const paths = previewPaths(cacheDir, src.id)
  let img: Sharp
  if (quality === 'preview' || src.offline) {
    if (!fs.existsSync(paths.preview)) {
      if (src.offline) throw new Error('The original is offline and has no preview.')
      await generatePreviews(src.path, src.ext, src.exifOrientation, paths, src.edit)
    }
    img = sharp(paths.preview)
  } else {
    const { input, orientation } = await sourceFor(src.path, src.ext, src.exifOrientation)
    img = pipelineFor(input, orientation)
  }
  return isEdited(src.edit) ? applyEdit(img, src.edit) : img
}

/** Brightness and contrast for print, as a lookup table: brightness bends the midtones, contrast is an S around mid-grey. */
export function adjustmentLut(brightness: number, contrast: number): Uint8Array | null {
  if (!brightness && !contrast) return null
  const gamma = Math.pow(2, -brightness / 50)
  const k = contrast / 50
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let y = Math.pow(i / 255, gamma)
    // Smooth S-curve: steepens (or flattens) the middle while keeping black and white fixed.
    y = y - k * 0.3 * Math.sin(2 * Math.PI * y) * 0.5
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)))
  }
  return lut
}

const cache = new Map<string, RawImage>()

/**
 * Renders one cell's photo as raw sRGB at `ppi`. For previews, results are cached so moving other settings is
 * instant.
 */
export async function renderCell(src: PrintSource, cell: Cell, s: PrintSettings, ppi: number, cacheDir: string, quality: 'preview' | 'final'): Promise<RawImage> {
  const width = Math.max(1, Math.round(cell.box.w * ppi))
  const height = Math.max(1, Math.round(cell.box.h * ppi))
  const key = quality === 'preview' ? JSON.stringify([src.id, src.edit, src.file, cell.crop, cell.rotate, width, height, s.adjust, s.grayscale]) : ''
  const hit = key && cache.get(key)
  if (hit) return hit

  const base = await (await upright(src, cacheDir, quality)).flatten({ background: '#ffffff' }).toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const W = base.info.width
  const H = base.info.height
  const left = Math.min(W - 1, Math.max(0, Math.round(cell.crop.x * W)))
  const top = Math.min(H - 1, Math.max(0, Math.round(cell.crop.y * H)))
  const cw = Math.max(1, Math.min(W - left, Math.round(cell.crop.w * W)))
  const ch = Math.max(1, Math.min(H - top, Math.round(cell.crop.h * H)))
  let img = sharp(base.data, { raw: { width: W, height: H, channels: base.info.channels } }).extract({ left, top, width: cw, height: ch })
  if (cell.rotate) img = sharp(await img.rotate(90).raw().toBuffer(), { raw: { width: ch, height: cw, channels: base.info.channels } })
  img = img.resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
  if (quality === 'final') {
    const sh = sharpenParams(s)
    if (sh) img = img.sharpen({ sigma: sh.sigma, m1: 0.5 * sh.amount, m2: 2.5 * sh.amount })
  }
  if (s.grayscale) img = img.grayscale().toColourspace('srgb')
  const out = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const data = out.data
  const lut = adjustmentLut(s.adjust.brightness, s.adjust.contrast)
  if (lut) for (let i = 0; i < data.length; i++) data[i] = lut[data[i]]
  const result = { data, width: out.info.width, height: out.info.height }
  if (key) {
    cache.set(key, result)
    if (cache.size > 120) cache.delete(cache.keys().next().value!)
  }
  return result
}
