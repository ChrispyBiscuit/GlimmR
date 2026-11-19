// Print jobs: lays photos out, renders previews for the print workspace, and produces the output (printer, PDF or
// files). The parts that need Electron (the hidden print window, dialogs) are passed in, so this is testable.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { getPhotos, type Db } from '../db'
import { editedSize } from '../../shared/edit'
import { captionText, computeLayout, parsePageRange, withDefaults, type Layout, type Placement, type PrintPhoto, type PrintSettings } from '../../shared/print'
import type { Photo } from '../../shared/types'
import { renderCell, type PrintSource, type RawImage } from './render'
import { softProof, toProfile, profileInfo } from './color'
import { composePage, encodeWithProfile, overlaySvg, pagesHtml } from './compose'
import { CHART, renderChart } from './chart'

export interface PrintRequest {
  settings: Partial<PrintSettings>
  photoIds: number[]
  placements?: Record<number, Placement>
  /** Print the calibration chart instead of photos. */
  chart?: boolean
}

/** The chart's stand-in photo id. */
export const CHART_ID = -1

interface Prepared {
  s: PrintSettings
  layout: Layout
  sources: Map<number, PrintSource>
  photos: Map<number, Photo>
}

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim())
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 0, 255]
}

/** Loads the photos (or the chart) and lays them out. */
export async function prepare(db: Db, req: PrintRequest, chartDir: string): Promise<Prepared> {
  const s = withDefaults(req.settings)
  const sources = new Map<number, PrintSource>()
  const photos = new Map<number, Photo>()
  const list: PrintPhoto[] = []
  if (req.chart) {
    const c = await renderChart(chartDir, 150)
    sources.set(CHART_ID, { id: CHART_ID, path: c.file, ext: 'png', exifOrientation: 1, edit: null, offline: false, file: c.file })
    list.push({ id: CHART_ID, w: CHART.w * 300, h: CHART.h * 300 })
  } else {
    const orient = db.prepare('SELECT exif_orientation FROM photos WHERE id = ?')
    for (const p of getPhotos(db, req.photoIds)) {
      photos.set(p.id, p)
      const o = (orient.get(p.id) as { exif_orientation: number } | undefined)?.exif_orientation ?? 1
      sources.set(p.id, { id: p.id, path: p.path, ext: p.ext, exifOrientation: o, edit: p.edit, offline: p.offline })
      const size = p.width && p.height ? editedSize(p.width, p.height, p.edit) : { w: 3000, h: 2000 }
      list.push({ id: p.id, w: size.w, h: size.h })
    }
  }
  const settings = req.chart ? { ...s, layout: 'single' as const, fit: 'fit' as const, rotateToFit: false, caption: { ...s.caption, enabled: false }, watermark: { ...s.watermark, enabled: false } } : s
  return { s: settings, layout: computeLayout(settings, list, req.placements ?? {}), sources, photos }
}

/** Renders the chart at the job's resolution when printing it (the preview uses a lighter one). */
async function chartAt(p: Prepared, chartDir: string, ppi: number): Promise<void> {
  const src = p.sources.get(CHART_ID)
  if (!src) return
  const c = await renderChart(chartDir, Math.min(600, ppi))
  src.file = c.file
}

function captionsFor(p: Prepared, page: Layout['pages'][number]): string[] {
  return page.cells.map((c) => {
    const ph = p.photos.get(c.photoId)
    return ph && p.s.caption.enabled ? captionText(ph, p.s.caption.fields, p.s.caption.custom) : ''
  })
}

/** Colour stage for output: convert to the paper profile when Glimmr manages colour. */
async function outputColour(img: RawImage, s: PrintSettings): Promise<RawImage> {
  if (s.colorMode !== 'glimmr' || !s.profile) return img
  const { data, channels } = await toProfile(img.data, s.profile, s.intent, s.bpc)
  if (channels !== 3) throw new Error('CMYK profiles can be used for soft proofing only. Choose an RGB printer profile to print with.')
  return { ...img, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }
}

export interface PreviewCell {
  src: string
  ppi: number
  lowRes: boolean
}

/** One page of the print workspace's preview: each cell rendered at screen resolution, soft-proofed if asked. */
export async function previewPage(db: Db, cacheDir: string, chartDir: string, req: PrintRequest, pageIndex: number, pxPerInch: number): Promise<{ layout: Layout; cells: PreviewCell[] }> {
  const p = await prepare(db, req, chartDir)
  const page = p.layout.pages[pageIndex]
  if (!page) return { layout: p.layout, cells: [] }
  const ppi = Math.max(24, Math.min(200, pxPerInch))
  const cells = await Promise.all(
    page.cells.map(async (c) => {
      let img = await renderCell(p.sources.get(c.photoId)!, c, p.s, ppi, cacheDir, 'preview')
      if (p.s.proof && p.s.profile) {
        const data = await softProof(img.data, p.s.profile, p.s.intent, p.s.bpc, p.s.gamutWarning ? hex(p.s.gamutColor) : null)
        img = { ...img, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }
      }
      const jpg = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer()
      return { src: `data:image/jpeg;base64,${jpg.toString('base64')}`, ppi: c.ppi, lowRes: c.photoId !== CHART_ID && c.ppi < 150 }
    })
  )
  return { layout: p.layout, cells }
}

/** Biggest page we'll render as one bitmap (pixels), to keep memory sane. */
const MAX_PAGE_PIXELS = 400e6

export interface OutputDeps {
  db: Db
  cacheDir: string
  chartDir: string
  report: (done: number, total: number, message?: string) => void
  signal: AbortSignal
  /** Prints an HTML file; resolves when the job is handed to the system, with a note such as the job id. */
  printHtml: (file: string, layout: Layout, s: PrintSettings, title: string) => Promise<string | void>
  /** Renders an HTML file to PDF bytes. */
  pdfHtml: (file: string, layout: Layout) => Promise<Buffer>
  /** Asks where to save: a file for PDF, a folder for images. Null when cancelled. */
  chooseTarget: (kind: 'pdf' | 'folder', suggested: string) => Promise<string | null>
  fontCss?: string
}

export interface OutputResult {
  ok: boolean
  message: string
  files?: string[]
}

/** Produces the job: printer, PDF, or JPEG/TIFF files. */
export async function runOutput(req: PrintRequest, deps: OutputDeps): Promise<OutputResult> {
  const p = await prepare(deps.db, req, deps.chartDir)
  const { s, layout } = p
  if (layout.problem) return { ok: false, message: layout.problem }
  if (!layout.pages.length) return { ok: false, message: 'There’s nothing to print.' }
  if (s.colorMode === 'glimmr') {
    if (!s.profile) return { ok: false, message: 'Choose a printer profile, or let the printer manage colours.' }
    if ((await profileInfo(s.profile)).space !== 'RGB') return { ok: false, message: 'CMYK profiles can be used for soft proofing only. Choose an RGB printer profile to print with.' }
  }
  const pageIdx = parsePageRange(s.pageRange, layout.pages.length)
  const base = req.chart ? 'Glimmr calibration chart' : (p.photos.get(req.photoIds[0])?.filename.replace(/\.[^.]+$/, '') ?? 'Glimmr print')
  const ppi = s.ppi
  if (layout.width * ppi * layout.height * ppi > MAX_PAGE_PIXELS && (s.output === 'jpeg' || s.output === 'tiff'))
    return { ok: false, message: `A ${layout.width.toFixed(1)} × ${layout.height.toFixed(1)} in page at ${ppi} ppi is too large to render as one image. Lower the resolution.` }
  await chartAt(p, deps.chartDir, ppi)

  let target: string | null = null
  if (s.output === 'pdf') {
    target = await deps.chooseTarget('pdf', `${base}.pdf`)
    if (!target) return { ok: false, message: 'Cancelled.' }
  } else if (s.output === 'jpeg' || s.output === 'tiff') {
    target = await deps.chooseTarget('folder', base)
    if (!target) return { ok: false, message: 'Cancelled.' }
  }

  const total = pageIdx.reduce((n, i) => n + layout.pages[i].cells.length, 0)
  let done = 0
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glimmr-print-'))
  try {
    if (s.output === 'jpeg' || s.output === 'tiff') {
      const files: string[] = []
      const profileName = s.colorMode === 'glimmr' && s.profile ? (await profileInfo(s.profile)).description : undefined
      for (const i of pageIdx) {
        const page = layout.pages[i]
        const cells: RawImage[] = []
        for (const c of page.cells) {
          if (deps.signal.aborted) return { ok: false, message: 'Cancelled.' }
          cells.push(await renderCell(p.sources.get(c.photoId)!, c, s, ppi, deps.cacheDir, 'final'))
          deps.report(++done, total, `Rendering page ${i + 1}`)
        }
        const composed = await outputColour(await composePage(layout, page, cells, overlaySvg(layout, page, s, captionsFor(p, page), layout.pages.length), s, ppi), s)
        const file = path.join(target!, `${base}${layout.pages.length > 1 ? `-${String(i + 1).padStart(2, '0')}` : ''}.${s.output === 'jpeg' ? 'jpg' : 'tif'}`)
        await fs.promises.writeFile(file, await encodeWithProfile(composed, s.output, ppi, s.colorMode === 'glimmr' ? s.profile : null, profileName))
        files.push(file)
      }
      return { ok: true, message: `Saved ${files.length === 1 ? '1 file' : `${files.length} files`} to ${target}`, files }
    }

    // Printer and PDF: photos rendered at print resolution into an exact-size HTML page.
    const pages: { page: Layout['pages'][number]; images: string[]; overlay: string }[] = []
    for (const i of pageIdx) {
      const page = layout.pages[i]
      const images: string[] = []
      for (const [k, c] of page.cells.entries()) {
        if (deps.signal.aborted) return { ok: false, message: 'Cancelled.' }
        const img = await outputColour(await renderCell(p.sources.get(c.photoId)!, c, s, ppi, deps.cacheDir, 'final'), s)
        const file = path.join(tmp, `p${i}-${k}.jpg`)
        await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(file)
        images.push(`file://${file.replace(/\\/g, '/')}`)
        deps.report(++done, total, `Rendering page ${i + 1}`)
      }
      pages.push({ page, images, overlay: overlaySvg(layout, page, s, captionsFor(p, page), layout.pages.length) })
    }
    const html = path.join(tmp, 'print.html')
    fs.writeFileSync(html, pagesHtml(layout, pages, s, deps.fontCss, base))
    if (s.output === 'pdf') {
      fs.writeFileSync(target!, await deps.pdfHtml(html, layout))
      return { ok: true, message: `Saved ${target}`, files: [target!] }
    }
    deps.report(total, total, 'Sending to the printer…')
    const note = await deps.printHtml(html, layout, s, base)
    const n = pages.length * Math.max(1, s.copies)
    return { ok: true, message: `Sent ${n === 1 ? '1 page' : `${n} pages`} to ${s.printer ?? 'the default printer'}${note ? ` (${note})` : ''}` }
  } finally {
    // The print window has already read the files.
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
