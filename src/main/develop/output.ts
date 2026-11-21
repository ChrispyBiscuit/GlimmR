// Developed images out of the render service: previews and thumbnails for the grid and viewer, the full-size image for
// 100% zoom and print, and exported files.

import fs from 'node:fs'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { type Db, getPhotos } from '../db'
import { applyEdit, previewPaths, THUMB_SIZE, PREVIEW_SIZE, pipeline, sourceFor } from '../previews'
import { displayFile } from '../files'
import { uniqueName } from '../fileops'
import { decodeSource, deserialize, proxyBytes, type DevelopSource } from './source'
import { getDevelop, kindOf, lutBytes } from './catalog'
import type { RenderService } from './renderService'
import { isEdited } from '../../shared/edit'
import type { OutputSpace } from '../../shared/develop/pipeline'
import type { RenderResult } from '../../shared/develop/render'
import type { DevelopSettings } from '../../shared/develop/settings'
import type { ExportOptions, Photo } from '../../shared/types'

export interface OutputDeps {
  db: Db
  cacheDir: string
  renderer: RenderService
}

const orientationOf = (db: Db, id: number): number => (db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id) as { exif_orientation: number } | undefined)?.exif_orientation ?? 1

/** The editing copy and its header. */
export async function editingCopy(deps: OutputDeps, p: Photo): Promise<DevelopSource> {
  const src = deserialize(await proxyBytes(deps.cacheDir, p.id, p, orientationOf(deps.db, p.id)))
  if (!src) throw new Error('The editing copy couldn’t be read.')
  return src
}

async function renderWith(deps: OutputDeps, src: DevelopSource, settings: DevelopSettings, opts: { full?: DevelopSource; float?: boolean; output?: OutputSpace } = {}): Promise<RenderResult> {
  const lutKey = settings.look.lut
  return deps.renderer.render({
    settings,
    source: { kind: src.kind, width: src.width, height: src.height, fullWidth: src.fullWidth, camera: src.camera, autoMul: src.autoMul },
    proxy: src.data,
    full: opts.full ? { data: opts.full.data, width: opts.full.width, height: opts.full.height } : undefined,
    lut: lutKey ? lutBytes(deps.db, lutKey) : null,
    lutKey: lutKey ?? '',
    output: opts.output,
    float: opts.float
  })
}

/** A render as a sharp image (RGB). Float renders become 16-bit. */
function toSharp(r: RenderResult): Sharp {
  if (r.float) {
    const f = r.data as Float32Array
    const u = new Uint16Array(r.width * r.height * 3)
    for (let i = 0, j = 0; i < f.length; i += 4, j += 3) {
      u[j] = Math.round(Math.min(1, Math.max(0, f[i])) * 65535)
      u[j + 1] = Math.round(Math.min(1, Math.max(0, f[i + 1])) * 65535)
      u[j + 2] = Math.round(Math.min(1, Math.max(0, f[i + 2])) * 65535)
    }
    return sharp(u, { raw: { width: r.width, height: r.height, channels: 3 }, limitInputPixels: false }).toColourspace('rgb16')
  }
  return sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), { raw: { width: r.width, height: r.height, channels: 4 }, limitInputPixels: false }).removeAlpha()
}

/** Renders a developed photo's previews: the upright developed image, the edited view (crop) and the thumbnail. */
export async function renderDevelopedPreviews(deps: OutputDeps, id: number): Promise<boolean> {
  const [p] = getPhotos(deps.db, [id])
  if (!p || p.offline) return false
  const settings = getDevelop(deps.db, id)
  const paths = previewPaths(deps.cacheDir, id)
  if (!settings) {
    // No longer developed: drop the developed images so the original shows.
    for (const f of [paths.devPreview, paths.devFull]) fs.rmSync(f, { force: true })
    return false
  }
  const src = await editingCopy(deps, p)
  const r = await renderWith(deps, src, settings)
  fs.mkdirSync(path.dirname(paths.devPreview), { recursive: true })
  const upright = await toSharp(r).jpeg({ quality: 88 }).toBuffer()
  await fs.promises.writeFile(paths.devPreview, upright)
  for (const f of [paths.devFull, paths.full]) fs.rmSync(f, { force: true })
  let shown = upright
  if (isEdited(p.edit)) shown = await (await applyEdit(sharp(upright), p.edit!)).resize(PREVIEW_SIZE, PREVIEW_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer()
  fs.mkdirSync(path.dirname(paths.view), { recursive: true })
  await fs.promises.writeFile(paths.view, shown)
  fs.mkdirSync(path.dirname(paths.thumb), { recursive: true })
  await sharp(shown).resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(paths.thumb)
  return true
}

/** The developed photo at full resolution (upright, uncropped), cached as a JPEG. */
export async function renderDevelopedFull(deps: OutputDeps, id: number): Promise<string> {
  const paths = previewPaths(deps.cacheDir, id)
  if (fs.existsSync(paths.devFull)) return paths.devFull
  const [p] = getPhotos(deps.db, [id])
  const settings = getDevelop(deps.db, id)
  if (!p || !settings) throw new Error('This photo isn’t developed.')
  const src = await editingCopy(deps, p)
  const full = await decodeSource(p, 0, orientationOf(deps.db, id))
  const r = await renderWith(deps, src, settings, { full })
  fs.mkdirSync(path.dirname(paths.devFull), { recursive: true })
  await toSharp(r).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(`${paths.devFull}.tmp`)
  await fs.promises.rename(`${paths.devFull}.tmp`, paths.devFull)
  return paths.devFull
}

// ---- export ----

const SCREEN_SHARPEN = { off: 0, low: 0.5, standard: 0.8, high: 1.2 } as const

/** Metadata from the catalog (works for raw sources too, which sharp can't read). */
function exifFor(p: Photo, mode: ExportOptions['metadata']): Record<string, Record<string, string>> | null {
  if (mode === 'none') return null
  const ifd0: Record<string, string> = { Software: 'Glimmr' }
  if (p.creator) {
    ifd0.Artist = p.creator
    ifd0.Copyright = p.creator
  }
  if (mode === 'copyright') return { IFD0: ifd0 }
  if (p.make) ifd0.Make = p.make
  if (p.model) ifd0.Model = p.model
  if (p.title) ifd0.ImageDescription = p.title
  const exif: Record<string, string> = {}
  if (p.takenAt) {
    const d = new Date(p.takenAt)
    const pad = (n: number): string => String(n).padStart(2, '0')
    exif.DateTimeOriginal = `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  if (p.iso) exif.ISOSpeedRatings = String(Math.round(p.iso))
  if (p.aperture) exif.FNumber = `${Math.round(p.aperture * 10)}/10`
  if (p.shutter) exif.ExposureTime = p.shutter >= 1 ? `${Math.round(p.shutter)}/1` : `1/${Math.round(1 / p.shutter)}`
  if (p.focal) exif.FocalLength = `${Math.round(p.focal * 10)}/10`
  if (p.lens) exif.LensModel = p.lens
  return { IFD0: ifd0, IFD2: exif }
}

function targetSize(w: number, h: number, size: ExportOptions['size']): { w: number; h: number } | null {
  if (size.mode === 'full') return null
  if (size.mode === 'long') return w >= h ? { w: size.value, h: 0 } : { w: 0, h: size.value }
  if (size.mode === 'short') return w <= h ? { w: size.value, h: 0 } : { w: 0, h: size.value }
  const s = Math.sqrt((size.value * 1e6) / (w * h))
  return s >= 1 ? null : { w: Math.round(w * s), h: 0 }
}

export async function exportPhotos(deps: OutputDeps, ids: number[], o: ExportOptions, report: (done: number, total: number, msg?: string) => void, signal?: AbortSignal): Promise<{ files: string[]; failed: { name: string; error: string }[] }> {
  const files: string[] = []
  const failed: { name: string; error: string }[] = []
  fs.mkdirSync(o.folder, { recursive: true })
  const photos = getPhotos(deps.db, ids)
  let n = 0
  for (const p of photos) {
    if (signal?.aborted) break
    report(n++, photos.length, `Exporting ${p.filename}`)
    try {
      const settings = getDevelop(deps.db, p.id)
      const sixteen = o.format !== 'jpeg' && o.bits === 16
      let img: Sharp
      if (settings) {
        const src = await editingCopy(deps, p)
        // The editing copy is enough for exports no bigger than it; anything bigger is rendered at full size.
        const want = targetSize(src.fullWidth, Math.round((src.fullWidth * src.height) / src.width), o.size)
        const fromProxy = !sixteen && want && Math.max(want.w, want.h) <= Math.max(src.width, src.height)
        const full = fromProxy ? undefined : await decodeSource(p, 0, orientationOf(deps.db, p.id))
        img = toSharp(await renderWith(deps, src, settings, { full, float: sixteen, output: o.space }))
      } else {
        const shown = displayFile(p)
        const { input, orientation } = await sourceFor(shown.path, shown.ext, orientationOf(deps.db, p.id))
        img = pipeline(input, orientation)
        if (sixteen) img = img.toColourspace('rgb16')
      }
      if (isEdited(p.edit)) img = await applyEdit(img, p.edit!)
      // Raw pixels from the last stage, so the size includes any crop.
      const buf = await img.raw().toBuffer({ resolveWithObject: true })
      let out = sharp(buf.data, { raw: { width: buf.info.width, height: buf.info.height, channels: buf.info.channels as 3 }, limitInputPixels: false })
      if (sixteen) out = sharp(new Uint16Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength / 2), { raw: { width: buf.info.width, height: buf.info.height, channels: buf.info.channels as 3 }, limitInputPixels: false }).toColourspace('rgb16')
      const want = targetSize(buf.info.width, buf.info.height, o.size)
      if (want) out = out.resize(want.w || null, want.h || null, { kernel: 'lanczos3', withoutEnlargement: true })
      const sigma = SCREEN_SHARPEN[o.sharpen]
      if (sigma && !sixteen) out = out.sharpen({ sigma })
      out = out.withIccProfile(o.space === 'p3' ? 'p3' : 'srgb')
      const exif = exifFor(p, o.metadata)
      if (exif) out = out.withExif(exif)
      const ext = o.format === 'jpeg' ? 'jpg' : o.format === 'png' ? 'png' : 'tif'
      if (o.format === 'jpeg') out = out.jpeg({ quality: o.quality, chromaSubsampling: o.quality >= 90 ? '4:4:4' : '4:2:0', mozjpeg: true })
      else if (o.format === 'png') out = out.png({ compressionLevel: 6 })
      else out = out.tiff({ compression: 'lzw', predictor: 'horizontal' })
      const base = p.filename.replace(/\.[^.]+$/, '') + (o.suffix ?? '')
      const taken = new Set(fs.readdirSync(o.folder).map((x) => x.toLowerCase()))
      const name = uniqueName(`${base}.${ext}`, (c) => !taken.has(c.toLowerCase()))
      const file = path.join(o.folder, name)
      await out.toFile(file)
      files.push(file)
    } catch (e) {
      failed.push({ name: p.filename, error: (e as Error).message })
    }
  }
  report(photos.length, photos.length)
  return { files, failed }
}

export { kindOf }
