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

/**
 * Standard names for the papers, so the driver recognises the size (and picks the tray it's loaded in) rather than
 * getting an anonymous custom size. `ppd` lists the keywords drivers use, in order of preference; `pwg` is the
 * PWG 5101.1 name, which CUPS matches to a driver size by its dimensions; `electron` is Chromium's own name.
 */
export const PAPER_NAMES: Record<string, { ppd: string[]; pwg: string; electron?: 'Letter' | 'Legal' | 'Tabloid' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' }> = {
  letter: { ppd: ['Letter', 'na_letter_8.5x11in'], pwg: 'na_letter_8.5x11in', electron: 'Letter' },
  legal: { ppd: ['Legal', 'na_legal_8.5x14in'], pwg: 'na_legal_8.5x14in', electron: 'Legal' },
  tabloid: { ppd: ['Tabloid', '11x17', 'na_ledger_11x17in'], pwg: 'na_ledger_11x17in', electron: 'Tabloid' },
  superb: { ppd: ['13x19', 'SuperB', 'A3+', 'w936h1368', 'na_super-b_13x19in'], pwg: 'na_super-b_13x19in' },
  a3plus: { ppd: ['A3+', '13x19', 'SuperB', 'w936h1368', 'na_super-b_13x19in'], pwg: 'na_super-b_13x19in' },
  '4x6': { ppd: ['4x6', '4x6in', 'w288h432', 'Postcard4x6', 'na_index-4x6_4x6in'], pwg: 'na_index-4x6_4x6in' },
  '5x7': { ppd: ['5x7', '5x7in', 'w360h504', 'na_5x7_5x7in'], pwg: 'na_5x7_5x7in' },
  '8x10': { ppd: ['8x10', '8x10in', 'w576h720', 'na_govt-letter_8x10in'], pwg: 'na_govt-letter_8x10in' },
  '11x14': { ppd: ['11x14', 'w792h1008', 'na_edp_11x14in'], pwg: 'na_edp_11x14in' },
  '12x18': { ppd: ['12x18', 'w864h1296', 'na_arch-b_12x18in'], pwg: 'na_arch-b_12x18in' },
  a6: { ppd: ['A6', 'iso_a6_105x148mm'], pwg: 'iso_a6_105x148mm', electron: 'A6' },
  a5: { ppd: ['A5', 'iso_a5_148x210mm'], pwg: 'iso_a5_148x210mm', electron: 'A5' },
  a4: { ppd: ['A4', 'iso_a4_210x297mm'], pwg: 'iso_a4_210x297mm', electron: 'A4' },
  a3: { ppd: ['A3', 'iso_a3_297x420mm'], pwg: 'iso_a3_297x420mm', electron: 'A3' },
  a2: { ppd: ['A2', 'iso_a2_420x594mm'], pwg: 'iso_a2_420x594mm', electron: 'A2' }
}

/** Print sizes for picture packages (portrait, inches). */
export const PRINT_SIZES: Paper[] = [
  { id: 'passport', label: 'Passport (2 × 2 in)', w: 2, h: 2 },
  { id: 'passport-eu', label: 'Passport (35 × 45 mm)', w: mm(35), h: mm(45) },
  { id: 'wallet-small', label: 'Wallet (2 × 3 in)', w: 2, h: 3 },
  { id: 'wallet', label: 'Wallet (2.5 × 3.5 in)', w: 2.5, h: 3.5 },
  { id: '3x4', label: '3 × 4 in', w: 3, h: 4 },
  { id: '3.5x5', label: '3.5 × 5 in', w: 3.5, h: 5 },
  { id: '4x5', label: '4 × 5 in', w: 4, h: 5 },
  { id: '4x6', label: '4 × 6 in', w: 4, h: 6 },
  { id: '5x7', label: '5 × 7 in', w: 5, h: 7 },
  { id: '8x10', label: '8 × 10 in', w: 8, h: 10 },
  { id: '10x15cm', label: '10 × 15 cm', w: mm(100), h: mm(150) },
  { id: '13x18cm', label: '13 × 18 cm', w: mm(130), h: mm(180) }
]

/** One line of a print package: `count` prints of a size, for each photo. */
export interface PackageItem {
  size: string
  /** Custom size in inches, when `size` is 'custom'. */
  w: number
  h: number
  count: number
}

/** Ready-made packages, like a portrait studio's, each designed for a paper with quarter-inch margins. */
export const PACKAGE_TEMPLATES: { name: string; paper: string; items: [string, number][] }[] = [
  { name: '1 × 5×7 + 2 × 3.5×5', paper: 'letter', items: [['5x7', 1], ['3.5x5', 2]] },
  { name: '1 × 5×7 + 4 wallets', paper: 'letter', items: [['5x7', 1], ['wallet', 4]] },
  { name: '2 × 3.5×5 + 4 wallets', paper: 'letter', items: [['3.5x5', 2], ['wallet', 4]] },
  { name: '8 wallets', paper: 'letter', items: [['wallet', 8]] },
  { name: '1 × 8×10 + 4 wallets', paper: 'superb', items: [['8x10', 1], ['wallet', 4]] },
  { name: '4 × 4×6', paper: 'superb', items: [['4x6', 4]] },
  { name: '6 passport photos', paper: '4x6', items: [['passport', 6]] }
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
  /** Print sizes packed on sheets: what each photo gets, how far apart, and whether photos share sheets. */
  pkg: { items: PackageItem[]; gap: number; separate: boolean }
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
  /** Driver settings chosen per printer (printer name, or '' for the default printer): keyword → choice. */
  driver: Record<string, Record<string, string>>
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
  pkg: { items: [{ size: '4x6', w: 4, h: 6, count: 1 }], gap: 0.1, separate: false },
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
  systemDialog: false,
  driver: {}
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
  { name: '5×7 prints, two per Letter sheet', builtIn: true, settings: { paper: 'letter', layout: 'package', pkg: { items: [{ size: '5x7', w: 5, h: 7, count: 1 }], gap: 0.25, separate: false }, margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }, fit: 'fill' } },
  { name: 'Portrait package (5×7 + 4 wallets)', builtIn: true, settings: { paper: 'letter', layout: 'package', pkg: { items: [{ size: '5x7', w: 5, h: 7, count: 1 }, { size: 'wallet', w: 2.5, h: 3.5, count: 4 }], gap: 0.1, separate: true }, margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }, fit: 'fill', cropMarks: true } },
  { name: 'A4 with white border', builtIn: true, settings: { paper: 'a4', layout: 'single', margins: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 }, border: 0.4, stroke: { width: 0.5, color: '#000000' }, fit: 'fit' } }
]

/** Package settings, converting the single-size form saved by Glimmr 1.0.7. */
function migratePkg(pkg: unknown): PrintSettings['pkg'] {
  const o = (pkg ?? {}) as Partial<PrintSettings['pkg']> & { size?: string; customW?: number; customH?: number; repeat?: number }
  const items = Array.isArray(o.items) && o.items.length ? o.items : o.size ? [{ size: o.size, w: o.customW ?? 4, h: o.customH ?? 6, count: o.repeat ?? 1 }] : DEFAULT_PRINT.pkg.items
  return { items: items.map((i) => ({ size: i.size, w: i.w ?? 4, h: i.h ?? 6, count: Math.max(1, Math.round(i.count ?? 1)) })), gap: o.gap ?? DEFAULT_PRINT.pkg.gap, separate: !!o.separate }
}

/** Merges saved settings over the defaults, so settings saved by older versions gain new fields. */
export function withDefaults(s: Partial<PrintSettings> | null | undefined): PrintSettings {
  const p = s ?? {}
  return {
    ...DEFAULT_PRINT,
    ...p,
    margins: { ...DEFAULT_PRINT.margins, ...p.margins },
    grid: { ...DEFAULT_PRINT.grid, ...p.grid },
    pkg: migratePkg(p.pkg),
    stroke: { ...DEFAULT_PRINT.stroke, ...p.stroke },
    caption: { ...DEFAULT_PRINT.caption, ...p.caption },
    watermark: { ...DEFAULT_PRINT.watermark, ...p.watermark },
    adjust: { ...DEFAULT_PRINT.adjust, ...p.adjust },
    driver: { ...p.driver }
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

/** A package line's print size in inches (portrait). */
export function itemSize(i: PackageItem): { w: number; h: number } {
  if (i.size === 'custom') return { w: Math.max(0.5, Math.min(i.w, i.h)), h: Math.max(0.5, Math.max(i.w, i.h)) }
  const p = PRINT_SIZES.find((x) => x.id === i.size) ?? PRINT_SIZES.find((x) => x.id === '4x6')!
  return { w: p.w, h: p.h }
}

export const itemLabel = (i: PackageItem): string => (i.size === 'custom' ? `${Number(i.w.toFixed(2))} × ${Number(i.h.toFixed(2))} in` : (PRINT_SIZES.find((x) => x.id === i.size)?.label ?? i.size))

export interface Tile {
  /** Index into the list of tiles, so callers can carry data along. */
  key: number
  w: number
  h: number
  /** Prefer the tile landscape (the photo is). */
  landscape: boolean
}

type Packed = { sheets: { key: number; rect: Rect }[][]; tooBig: number[] }

/** One guillotine packing pass with a given orientation preference, split rule and order. */
function packOnce(tiles: Tile[], area: Rect, gap: number, prefer: 'photo' | 'turned' | 'portrait' | 'landscape', split: 'short' | 'long', order: 'area' | 'side'): Packed {
  const sorted = [...tiles].sort((a, b) =>
    order === 'area' ? b.w * b.h - a.w * a.h || Math.max(b.w, b.h) - Math.max(a.w, a.h) || a.key - b.key : Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.key - b.key
  )
  const tooBig: number[] = []
  const sheets: { key: number; rect: Rect }[][] = []
  // Free space per sheet, each rectangle inflated by the gap so neighbours stay `gap` apart.
  const free: Rect[][] = []
  const fits = (t: { w: number; h: number }, f: Rect): boolean => t.w + gap <= f.w + 1e-9 && t.h + gap <= f.h + 1e-9
  for (const t of sorted) {
    const want = prefer === 'photo' ? t.landscape : prefer === 'turned' ? !t.landscape : prefer === 'landscape'
    const shapes = [
      { w: t.w, h: t.h },
      { w: t.h, h: t.w }
    ].sort((a, b) => Number(b.w >= b.h === want) - Number(a.w >= a.h === want))
    if (!shapes.some((sh) => sh.w <= area.w + 1e-9 && sh.h <= area.h + 1e-9)) {
      tooBig.push(t.key)
      continue
    }
    for (let si = 0; ; si++) {
      if (si === sheets.length) {
        sheets.push([])
        free.push([{ x: 0, y: 0, w: area.w + gap, h: area.h + gap }])
      }
      // Best area fit; the preferred orientation wins ties.
      let best: { fi: number; sh: { w: number; h: number }; waste: number } | null = null
      free[si].forEach((f, fi) => {
        for (const sh of shapes) {
          if (!fits(sh, f)) continue
          const waste = f.w * f.h - (sh.w + gap) * (sh.h + gap)
          if (!best || waste < best.waste - 1e-9) best = { fi, sh, waste }
        }
      })
      if (!best) continue
      const { fi, sh } = best as { fi: number; sh: { w: number; h: number } }
      const f = free[si][fi]
      const w = sh.w + gap
      const h = sh.h + gap
      sheets[si].push({ key: t.key, rect: { x: f.x, y: f.y, w: sh.w, h: sh.h } })
      // Split what's left with one straight cut, so the sheet stays cuttable edge to edge.
      const right = f.w - w
      const below = f.h - h
      const horizontal = split === 'short' ? right < below : right >= below
      const parts: Rect[] = horizontal ? [{ x: f.x + w, y: f.y, w: right, h }, { x: f.x, y: f.y + h, w: f.w, h: below }] : [{ x: f.x + w, y: f.y, w: right, h: f.h }, { x: f.x, y: f.y + h, w, h: below }]
      free[si].splice(fi, 1, ...parts.filter((r) => r.w > 1e-6 && r.h > 1e-6))
      break
    }
  }
  return { sheets, tooBig }
}

/**
 * Packs print tiles onto as few sheets as possible with guillotine packing: every sheet can be cut apart with
 * straight cuts edge to edge, as on a paper trimmer. Tiles may turn a quarter. Several strategies are tried and the
 * one with the fewest sheets wins (then the most prints in their photo's orientation). Each sheet is centred.
 */
export function packTiles(tiles: Tile[], area: Rect, gap: number): Packed {
  let best: Packed | null = null
  let bestScore = [Infinity, -Infinity]
  for (const prefer of ['photo', 'turned', 'portrait', 'landscape'] as const)
    for (const split of ['short', 'long'] as const)
      for (const order of ['area', 'side'] as const) {
        const r = packOnce(tiles, area, gap, prefer, split, order)
        const matching = r.sheets.flat().filter((p) => (p.rect.w >= p.rect.h) === tiles.find((t) => t.key === p.key)!.landscape).length
        const score = [r.sheets.length, matching]
        if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
          best = r
          bestScore = score
        }
      }
  const result = best ?? { sheets: [], tooBig: [] }
  for (const sheet of result.sheets) {
    const right = Math.max(...sheet.map((p) => p.rect.x + p.rect.w))
    const bottom = Math.max(...sheet.map((p) => p.rect.y + p.rect.h))
    const dx = area.x + (area.w - right) / 2
    const dy = area.y + (area.h - bottom) / 2
    for (const p of sheet) p.rect = { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy }
  }
  return result
}

const textBand = (pt: number): number => (pt / 72) * 2

/** Cells for one page of a single or grid layout, in page inches, before photos are assigned. */
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
  return { rects: [], problem: null }
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

/** Package sheets: each photo's prints (per the package), packed onto sheets, all photos together or each apart. */
function packagePages(s: PrintSettings, photos: PrintPhoto[], area: Rect, placements: Record<number, Placement>): { pages: Page[]; problem: string | null } {
  const tiles: (Tile & { photo: PrintPhoto })[] = []
  for (const photo of photos)
    for (const item of s.pkg.items) {
      const size = itemSize(item)
      for (let n = 0; n < Math.max(1, Math.round(item.count)); n++) tiles.push({ key: tiles.length, w: size.w, h: size.h, landscape: photo.w > photo.h, photo })
    }
  const groups = s.pkg.separate ? photos.map((p) => tiles.filter((t) => t.photo === p)) : [tiles]
  const pages: Page[] = []
  let problem: string | null = null
  // A print is cut out and turned, so photos always turn to match their print.
  const sp = { ...s, rotateToFit: true }
  for (const group of groups) {
    const { sheets, tooBig } = packTiles(group, area, s.pkg.gap)
    if (tooBig.length) {
      const t = tiles[tooBig[0]]
      problem = `A ${Number(t.w.toFixed(2))} × ${Number(t.h.toFixed(2))} in print doesn’t fit on this paper with these margins.`
    }
    for (const sheet of sheets) pages.push({ index: pages.length, cells: sheet.map(({ key, rect }) => placePhoto(sp, tiles[key].photo, rect, placements[tiles[key].photo.id])) })
  }
  return { pages, problem }
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
      // Whichever orientation needs fewer sheets.
      const sheets = (l: boolean): number => packagePages(s, photos.length ? photos : [{ id: 0, w: 3, h: 2 }], pageGeometry(s, l).area, {}).pages.length || Infinity
      landscape = sheets(true) < sheets(false)
    }
  }
  const g = pageGeometry(s, landscape)
  if (s.layout === 'package') {
    const { pages, problem } = packagePages(s, photos, g.area, placements)
    return { ...g, landscape, pages, problem }
  }
  const { rects, problem } = cellRects(s, g.area)
  const pages: Page[] = []
  if (rects.length && photos.length) {
    if (s.repeatOnPage && s.layout !== 'single') {
      photos.forEach((p, i) => pages.push({ index: i, cells: rects.map((r) => placePhoto(s, p, r, placements[p.id])) }))
    } else {
      for (let i = 0; i < photos.length; i += rects.length) {
        const chunk = photos.slice(i, i + rects.length)
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
