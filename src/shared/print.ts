import type { Photo } from './types'

// Print layout: paper, margins, cells and how each photo sits in its cell, all in inches. Pure geometry shared by
// the live preview (renderer) and every output (printer, PDF, files) in the main process, so they always agree.

export type Units = 'in' | 'mm' | 'cm'
export type LayoutKind = 'single' | 'grid' | 'package'
export type CaptionField = 'title' | 'filename' | 'date' | 'exposure' | 'caption' | 'rating' | 'custom'
export type Intent = 'perceptual' | 'relative' | 'saturation' | 'absolute'
export type Output = 'printer' | 'pdf' | 'jpeg' | 'tiff'

export interface Paper {
  id: string
  label: string
  /** Portrait size in inches. */
  w: number
  h: number
}

const mm = (v: number): number => v / 25.4

export const PAPERS: Paper[] = [
  { id: 'letter', label: 'Letter (8.5 × 11 in)', w: 8.5, h: 11 },
  { id: 'legal', label: 'Legal (8.5 × 14 in)', w: 8.5, h: 14 },
  { id: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 11, h: 17 },
  { id: 'superb', label: 'Super B (13 × 19 in)', w: 13, h: 19 },
  { id: '4x6', label: '4 × 6 in', w: 4, h: 6 },
  { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: '11x14', label: '11 × 14 in', w: 11, h: 14 },
  { id: '12x18', label: '12 × 18 in', w: 12, h: 18 },
  { id: 'a6', label: 'A6 (105 × 148 mm)', w: mm(105), h: mm(148) },
  { id: 'a5', label: 'A5 (148 × 210 mm)', w: mm(148), h: mm(210) },
  { id: 'a4', label: 'A4 (210 × 297 mm)', w: mm(210), h: mm(297) },
  { id: 'a3', label: 'A3 (297 × 420 mm)', w: mm(297), h: mm(420) },
  { id: 'a3plus', label: 'A3+ (329 × 483 mm)', w: mm(329), h: mm(483) },
  { id: 'a2', label: 'A2 (420 × 594 mm)', w: mm(420), h: mm(594) }
]

/** Print sizes for picture packages (portrait, inches). */
export const PRINT_SIZES: Paper[] = [
  { id: 'wallet', label: 'Wallet (2.5 × 3.5 in)', w: 2.5, h: 3.5 },
  { id: '3.5x5', label: '3.5 × 5 in', w: 3.5, h: 5 },
  { id: '4x6', label: '4 × 6 in', w: 4, h: 6 },
  { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: '10x15cm', label: '10 × 15 cm', w: mm(100), h: mm(150) },
  { id: '13x18cm', label: '13 × 18 cm', w: mm(130), h: mm(180) }
]

export const PPI_CHOICES = [180, 240, 300, 360, 600, 720]
/** Below this a photo is flagged as likely to print soft. */
export const LOW_PPI = 150

export interface PrintSettings {
  printer: string | null
  paper: string
  /** Custom paper size, inches (portrait). */
  customW: number
  customH: number
  orientation: 'auto' | 'portrait' | 'landscape'
  margins: { top: number; right: number; bottom: number; left: number }
  units: Units
  layout: LayoutKind
  grid: { rows: number; cols: number; hGap: number; vGap: number }
  pkg: { size: string; customW: number; customH: number; repeat: number; gap: number }
  fit: 'fit' | 'fill'
  rotateToFit: boolean
  /** Fill each page with copies of one photo. */
  repeatOnPage: boolean
  /** White mat inside each cell, inches. */
  border: number
  stroke: { width: number; color: string }
  background: string
  cropMarks: boolean
  caption: { enabled: boolean; fields: CaptionField[]; custom: string; size: number; color: string }
  header: string
  footer: string
  pageNumbers: boolean
  textSize: number
  watermark: { enabled: boolean; text: string; position: 'tl' | 'tr' | 'bl' | 'br' | 'c'; size: number; opacity: number }
  ppi: number
  sharpen: 'off' | 'low' | 'standard' | 'high'
  media: 'glossy' | 'matte'
  adjust: { brightness: number; contrast: number }
  colorMode: 'printer' | 'glimmr'
  profile: string | null
  intent: Intent
  bpc: boolean
  proof: boolean
  gamutWarning: boolean
  gamutColor: string
  grayscale: boolean
  copies: number
  collate: boolean
  duplex: 'simplex' | 'longEdge' | 'shortEdge'
  pageRange: string
  output: Output
  /** Print through the system dialog, for driver settings such as paper type and quality. */
  systemDialog: boolean
}

export const DEFAULT_PRINT: PrintSettings = {
  printer: null,
  paper: 'letter',
  customW: 8.5,
  customH: 11,
  orientation: 'auto',
  margins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
  units: 'in',
  layout: 'single',
  grid: { rows: 2, cols: 2, hGap: 0.2, vGap: 0.2 },
  pkg: { size: '4x6', customW: 4, customH: 6, repeat: 1, gap: 0.1 },
  fit: 'fit',
  rotateToFit: false,
  repeatOnPage: false,
  border: 0,
  stroke: { width: 0, color: '#000000' },
  background: '#ffffff',
  cropMarks: false,
  caption: { enabled: false, fields: ['title', 'date'], custom: '', size: 9, color: '#333333' },
  header: '',
  footer: '',
  pageNumbers: false,
  textSize: 9,
  watermark: { enabled: false, text: '', position: 'br', size: 10, opacity: 0.6 },
  ppi: 300,
  sharpen: 'standard',
  media: 'glossy',
  adjust: { brightness: 0, contrast: 0 },
  colorMode: 'printer',
  profile: null,
  intent: 'relative',
  bpc: true,
  proof: false,
  gamutWarning: false,
  gamutColor: '#ff00ff',
  grayscale: false,
  copies: 1,
  collate: true,
  duplex: 'simplex',
  pageRange: '',
  output: 'printer',
  systemDialog: false
}

export interface PrintPreset {
  name: string
  builtIn?: boolean
  settings: Partial<PrintSettings>
}

export const BUILT_IN_PRESETS: PrintPreset[] = [
  { name: 'Single 8×10 on Letter', builtIn: true, settings: { paper: 'letter', layout: 'single', margins: { top: 0.5, right: 0.25, bottom: 0.5, left: 0.25 }, fit: 'fit' } },
  { name: 'Contact sheet 5×6', builtIn: true, settings: { paper: 'letter', orientation: 'portrait', layout: 'grid', grid: { rows: 6, cols: 5, hGap: 0.1, vGap: 0.1 }, fit: 'fit', caption: { ...DEFAULT_PRINT.caption, enabled: true, fields: ['filename'], size: 6 }, pageNumbers: true, ppi: 240 } },
  { name: '4×6 borderless', builtIn: true, settings: { paper: '4x6', layout: 'single', margins: { top: 0, right: 0, bottom: 0, left: 0 }, fit: 'fill' } },
  { name: 'Two 5×7 on Letter', builtIn: true, settings: { paper: 'letter', layout: 'package', pkg: { size: '5x7', customW: 5, customH: 7, repeat: 1, gap: 0.25 }, margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }, fit: 'fill' } },
  { name: 'A4 with white border', builtIn: true, settings: { paper: 'a4', layout: 'single', margins: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 }, border: 0.4, stroke: { width: 0.5, color: '#000000' }, fit: 'fit' } }
]

/** Merges saved settings over the defaults, so settings saved by older versions gain new fields. */
export function withDefaults(s: Partial<PrintSettings> | null | undefined): PrintSettings {
  const p = s ?? {}
  return {
    ...DEFAULT_PRINT,
    ...p,
    margins: { ...DEFAULT_PRINT.margins, ...p.margins },
    grid: { ...DEFAULT_PRINT.grid, ...p.grid },
    pkg: { ...DEFAULT_PRINT.pkg, ...p.pkg },
    stroke: { ...DEFAULT_PRINT.stroke, ...p.stroke },
    caption: { ...DEFAULT_PRINT.caption, ...p.caption },
    watermark: { ...DEFAULT_PRINT.watermark, ...p.watermark },
    adjust: { ...DEFAULT_PRINT.adjust, ...p.adjust }
  }
}

// ---- units ----

export const UNIT_FACTOR: Record<Units, number> = { in: 1, mm: 25.4, cm: 2.54 }
export const toUnits = (inches: number, u: Units): number => inches * UNIT_FACTOR[u]
export const fromUnits = (v: number, u: Units): number => v / UNIT_FACTOR[u]
export function fmtLength(inches: number, u: Units): string {
  const v = toUnits(inches, u)
  return `${Number(v.toFixed(u === 'mm' ? 0 : 2))}${u === 'in' ? '″' : ` ${u}`}`
}

// ---- layout ----

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Per-photo adjustments made in the print preview: crop position (−1…1) and zoom (≥ 1) for filled cells. */
export interface Placement {
  ox: number
  oy: number
  zoom: number
}

export interface PrintPhoto {
  id: number
  /** Pixel size as shown (after the photo's non-destructive edit). */
  w: number
  h: number
}

export interface Cell {
  photoId: number
  /** Cell, in page inches. */
  cell: Rect
  /** Where the photo's image goes, in page inches. */
  box: Rect
  /** The part of the photo shown, normalised to the photo (before the print rotation). */
  crop: Rect
  /** Turned a quarter clockwise to fit the cell. */
  rotate: boolean
  /** Caption band under the photo, if captions are on. */
  caption: Rect | null
  /** Effective resolution of this photo at this size. */
  ppi: number
}

export interface Page {
  index: number
  cells: Cell[]
}

export interface Layout {
  /** Page size in inches, as oriented. */
  width: number
  height: number
  landscape: boolean
  /** The printable area inside the margins (and header/footer bands). */
  area: Rect
  header: Rect | null
  footer: Rect | null
  pages: Page[]
  /** Photos that couldn't be placed (e.g. a print size larger than the paper). */
  problem: string | null
}

export function paperSize(s: PrintSettings): { w: number; h: number } {
  if (s.paper === 'custom') return { w: Math.max(1, s.customW), h: Math.max(1, s.customH) }
  const p = PAPERS.find((x) => x.id === s.paper) ?? PAPERS[0]
  return { w: p.w, h: p.h }
}

export function printSize(s: PrintSettings): { w: number; h: number } {
  if (s.pkg.size === 'custom') return { w: Math.max(0.5, s.pkg.customW), h: Math.max(0.5, s.pkg.customH) }
  const p = PRINT_SIZES.find((x) => x.id === s.pkg.size) ?? PRINT_SIZES[2]
  return { w: p.w, h: p.h }
}

const textBand = (pt: number): number => (pt / 72) * 2

/** Cells for one page of the chosen layout, in page inches, before photos are assigned. */
function cellRects(s: PrintSettings, area: Rect): { rects: Rect[]; problem: string | null } {
  if (s.layout === 'single') return { rects: [area], problem: null }
  if (s.layout === 'grid') {
    const cols = Math.max(1, Math.round(s.grid.cols))
    const rows = Math.max(1, Math.round(s.grid.rows))
    const w = (area.w - (cols - 1) * s.grid.hGap) / cols
    const h = (area.h - (rows - 1) * s.grid.vGap) / rows
    if (w <= 0.1 || h <= 0.1) return { rects: [], problem: 'The grid is too dense for this paper and margins.' }
    const rects: Rect[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ x: area.x + c * (w + s.grid.hGap), y: area.y + r * (h + s.grid.vGap), w, h })
    return { rects, problem: null }
  }
  // Picture package: as many prints of a fixed size as fit, in whichever orientation fits more, centred.
  const size = printSize(s)
  const g = s.pkg.gap
  const fit = (w: number, h: number): { cols: number; rows: number } => ({ cols: Math.floor((area.w + g + 1e-9) / (w + g)), rows: Math.floor((area.h + g + 1e-9) / (h + g)) })
  const a = fit(size.w, size.h)
  const b = fit(size.h, size.w)
  const [w, h, n] = a.cols * a.rows >= b.cols * b.rows ? [size.w, size.h, a] : [size.h, size.w, b]
  if (!n.cols || !n.rows) return { rects: [], problem: 'That print size doesn’t fit on this paper with these margins.' }
  const totalW = n.cols * w + (n.cols - 1) * g
  const totalH = n.rows * h + (n.rows - 1) * g
  const x0 = area.x + (area.w - totalW) / 2
  const y0 = area.y + (area.h - totalH) / 2
  const rects: Rect[] = []
  for (let r = 0; r < n.rows; r++) for (let c = 0; c < n.cols; c++) rects.push({ x: x0 + c * (w + g), y: y0 + r * (h + g), w, h })
  return { rects, problem: null }
}

/** Places a photo in a cell: fit (whole photo) or fill (cropped), with border, caption band and rotate-to-fit. */
export function placePhoto(s: PrintSettings, photo: PrintPhoto, cell: Rect, placement?: Placement): Cell {
  const inset = Math.max(0, Math.min(s.border, Math.min(cell.w, cell.h) / 2 - 0.05))
  const capH = s.caption.enabled ? textBand(s.caption.size) : 0
  const avail: Rect = { x: cell.x + inset, y: cell.y + inset, w: Math.max(0.05, cell.w - inset * 2), h: Math.max(0.05, cell.h - inset * 2 - capH) }
  const pa = photo.w > 0 && photo.h > 0 ? photo.w / photo.h : 1.5
  const ca = avail.w / avail.h
  const rotate = s.rotateToFit && (pa > 1) !== (ca > 1) && Math.abs(pa - 1) > 0.02 && Math.abs(ca - 1) > 0.02
  // Aspect of the photo as it will sit on the page.
  const shown = rotate ? 1 / pa : pa
  let box: Rect
  let crop: Rect = { x: 0, y: 0, w: 1, h: 1 }
  if (s.fit === 'fit') {
    const w = shown > ca ? avail.w : avail.h * shown
    const h = shown > ca ? avail.w / shown : avail.h
    box = { x: avail.x + (avail.w - w) / 2, y: avail.y + (avail.h - h) / 2, w, h }
  } else {
    box = avail
    // The box's shape in the photo's own orientation.
    const target = rotate ? 1 / ca : ca
    let cw = 1
    let ch = 1
    if (pa > target) cw = target / pa
    else ch = pa / target
    const z = Math.max(1, placement?.zoom ?? 1)
    cw /= z
    ch /= z
    const ox = Math.max(-1, Math.min(1, placement?.ox ?? 0))
    const oy = Math.max(-1, Math.min(1, placement?.oy ?? 0))
    crop = { x: ((1 - cw) * (1 + ox)) / 2, y: ((1 - ch) * (1 + oy)) / 2, w: cw, h: ch }
  }
  const caption = capH ? { x: cell.x + inset, y: s.fit === 'fit' ? box.y + box.h : avail.y + avail.h, w: cell.w - inset * 2, h: capH } : null
  // Source pixels across the shown width, per inch of print.
  const srcAcross = (rotate ? photo.h : photo.w) * (rotate ? crop.h : crop.w)
  const ppi = photo.w > 0 ? srcAcross / box.w : Infinity
  return { photoId: photo.id, cell, box, crop, rotate, caption, ppi }
}

function pageGeometry(s: PrintSettings, landscape: boolean): { width: number; height: number; area: Rect; header: Rect | null; footer: Rect | null } {
  const p = paperSize(s)
  const width = landscape ? Math.max(p.w, p.h) : Math.min(p.w, p.h)
  const height = landscape ? Math.min(p.w, p.h) : Math.max(p.w, p.h)
  const m = s.margins
  const band = textBand(s.textSize)
  const header = s.header.trim() ? { x: m.left, y: m.top, w: width - m.left - m.right, h: band } : null
  const footer = s.footer.trim() || s.pageNumbers ? { x: m.left, y: height - m.bottom - band, w: width - m.left - m.right, h: band } : null
  const top = m.top + (header ? band : 0)
  const bottom = m.bottom + (footer ? band : 0)
  return { width, height, area: { x: m.left, y: top, w: Math.max(0.1, width - m.left - m.right), h: Math.max(0.1, height - top - bottom) }, header, footer }
}

/** Lays photos out on pages. */
export function computeLayout(s: PrintSettings, photos: PrintPhoto[], placements: Record<number, Placement> = {}): Layout {
  let landscape = s.orientation === 'landscape'
  if (s.orientation === 'auto') {
    if (s.layout === 'single') {
      const p = photos[0]
      landscape = !!p && p.w > p.h
    } else if (s.layout === 'grid') landscape = s.grid.cols > s.grid.rows
    else {
      // Whichever orientation fits more prints.
      const count = (l: boolean): number => cellRects(s, pageGeometry(s, l).area).rects.length
      landscape = count(true) > count(false)
    }
  }
  const g = pageGeometry(s, landscape)
  const { rects, problem } = cellRects(s, g.area)
  const pages: Page[] = []
  if (rects.length && photos.length) {
    // The sequence of photos to place: each repeated for packages, or one photo per page when repeating on the page.
    const seq: PrintPhoto[] = s.layout === 'package' ? photos.flatMap((p) => Array.from({ length: Math.max(1, Math.round(s.pkg.repeat)) }, () => p)) : photos
    if (s.repeatOnPage && s.layout !== 'single') {
      seq.forEach((p, i) => pages.push({ index: i, cells: rects.map((r) => placePhoto(s, p, r, placements[p.id])) }))
    } else {
      for (let i = 0; i < seq.length; i += rects.length) {
        const chunk = seq.slice(i, i + rects.length)
        pages.push({ index: pages.length, cells: chunk.map((p, k) => placePhoto(s, p, rects[k], placements[p.id])) })
      }
    }
  }
  return { ...g, landscape, pages, problem }
}

/** Parses "1-3, 5" into zero-based page indexes within `count`; empty means all. */
export function parsePageRange(range: string, count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i)
  if (!range.trim()) return all
  const out = new Set<number>()
  for (const part of range.split(',')) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part)
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let p = Math.min(a, b); p <= Math.max(a, b); p++) if (p >= 1 && p <= count) out.add(p - 1)
  }
  return out.size ? [...out].sort((x, y) => x - y) : all
}

/** Unsharp-mask parameters for print sharpening, scaled to the output resolution (higher ppi, wider radius). */
export function sharpenParams(s: Pick<PrintSettings, 'sharpen' | 'media' | 'ppi'>): { sigma: number; amount: number } | null {
  if (s.sharpen === 'off') return null
  const strength = { low: 0.6, standard: 1, high: 1.5 }[s.sharpen]
  // Matte paper softens detail more, so it gets more.
  const media = s.media === 'matte' ? 1.35 : 1
  return { sigma: Math.max(0.5, (s.ppi / 300) * 0.8), amount: strength * media }
}

// ---- text ----

const shutterText = (s: number): string => (s >= 1 ? `${Number(s.toFixed(1))} s` : `1/${Math.round(1 / s)} s`)

/** A photo's caption from the chosen fields, joined with a middle dot. */
export function captionText(p: Pick<Photo, 'title' | 'filename' | 'takenAt' | 'shutter' | 'aperture' | 'iso' | 'focal' | 'caption' | 'rating'>, fields: CaptionField[], custom: string): string {
  const parts: string[] = []
  for (const f of fields) {
    if (f === 'title' && p.title) parts.push(p.title)
    if (f === 'filename') parts.push(p.filename)
    if (f === 'date' && p.takenAt) parts.push(new Date(p.takenAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))
    if (f === 'exposure') {
      const e = [p.shutter ? shutterText(p.shutter) : '', p.aperture ? `ƒ/${Number(p.aperture.toFixed(1))}` : '', p.iso ? `ISO ${p.iso}` : '', p.focal ? `${Math.round(p.focal)} mm` : ''].filter(Boolean)
      if (e.length) parts.push(e.join('  '))
    }
    if (f === 'caption' && p.caption) parts.push(p.caption)
    if (f === 'rating' && p.rating) parts.push('★'.repeat(p.rating))
    if (f === 'custom' && custom.trim()) parts.push(custom.trim())
  }
  return parts.join('  ·  ')
}

/** Header or footer text with {page} and {pages} filled in, and the page number appended when asked for. */
export function pageText(template: string, page: number, pages: number, withNumber: boolean): string {
  const t = template.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages)).trim()
  if (!withNumber) return t
  const n = `Page ${page} of ${pages}`
  return t ? `${t}    ${n}` : n
}
