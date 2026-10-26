// Reads EXIF / IPTC / XMP (embedded and sidecar) with exifr and normalizes it.

import * as exifr from 'exifr'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeKeyword } from './db'
import type { ColorLabel, Flag } from '../shared/types'

export const RAW_EXTS = new Set([
  'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'dng', 'srw', '3fr', 'iiq', 'erf', 'x3f', 'mrw', 'kdc', 'dcr', 'rwl'
])
export const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'avif', 'bmp'])
/** Formats Chromium can show directly; others are viewed through generated previews. */
export const BROWSER_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])

export const isSupported = (ext: string): boolean => RAW_EXTS.has(ext) || IMAGE_EXTS.has(ext)

export interface MetaEntry {
  key: string
  value: string
  num: number | null
}

export interface ExtractedMeta {
  takenAt: number | null
  width: number | null
  height: number | null
  exifOrientation: number
  make: string | null
  model: string | null
  lens: string | null
  focal: number | null
  aperture: number | null
  shutter: number | null
  iso: number | null
  lat: number | null
  lon: number | null
  rating: number
  flag: Flag
  label: ColorLabel
  title: string | null
  caption: string | null
  creator: string | null
  keywords: string[]
  entries: MetaEntry[]
  sidecar: string | null
}

const ORIENTATIONS: Record<string, number> = {
  'horizontal (normal)': 1,
  'mirror horizontal': 2,
  'rotate 180': 3,
  'mirror vertical': 4,
  'mirror horizontal and rotate 270 cw': 5,
  'rotate 90 cw': 6,
  'mirror horizontal and rotate 90 cw': 7,
  'rotate 270 cw': 8
}

const PARSE_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  interop: false,
  ifd1: false,
  xmp: true,
  iptc: true,
  icc: false,
  jfif: false,
  ihdr: true,
  makerNote: false,
  userComment: true,
  mergeOutput: false,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
  multiSegment: true
}

// Long binary-ish or noisy keys that are not useful to search.
const SKIP_KEYS = new Set(['ComponentsConfiguration', 'FileSource', 'SceneType', 'CFAPattern', 'ThumbnailOffset', 'ThumbnailLength', 'StripOffsets', 'StripByteCounts', 'PrintIM', 'DNGPrivateData', 'ApplicationNotes', 'XMLPacket', 'History'])

/** Finds a sidecar XMP: photo.xmp (Lightroom/Capture One) or photo.ext.xmp (darktable). */
export function findSidecar(file: string): string | null {
  const dir = path.dirname(file)
  const base = path.basename(file, path.extname(file))
  for (const c of [`${base}.xmp`, `${base}.XMP`, `${path.basename(file)}.xmp`, `${path.basename(file)}.XMP`]) {
    const p = path.join(dir, c)
    if (fs.existsSync(p)) return p
  }
  return null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** exifr leaves XML entities in XMP text as-is. */
const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)
  )

function toText(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'string') return decodeEntities(v).trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(', ') || null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('value' in o) return toText(o.value)
    return null
  }
  return null
}

const toArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v])

function flatten(groups: Record<string, any>, into: MetaEntry[], seen: Map<string, string>): void {
  for (const data of Object.values(groups)) {
    if (!data || typeof data !== 'object' || data instanceof Uint8Array) continue
    for (const [k, raw] of Object.entries(data)) {
      if (SKIP_KEYS.has(k) || raw instanceof Uint8Array || ArrayBuffer.isView(raw)) continue
      const key = k
      const values = Array.isArray(raw) && raw.every((x) => typeof x === 'string') ? raw : [raw]
      for (const v of values) {
        const text = toText(v)
        if (text == null || text.length > 2000) continue
        const prior = seen.get(key)
        if (prior === text) continue
        if (prior !== undefined && !Array.isArray(raw)) continue // first segment wins (sidecar is read first)
        seen.set(key, text)
        const num = typeof v === 'number' && Number.isFinite(v) ? v : v instanceof Date ? v.getTime() : null
        into.push({ key, value: text, num })
      }
    }
  }
}

const first = (groups: Record<string, any>[], ...keys: string[]): unknown => {
  for (const g of groups) {
    if (!g) continue
    for (const k of keys) if (g[k] != null && g[k] !== '') return g[k]
  }
  return undefined
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const f = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(v)
    if (f) return Number(f[1]) / Number(f[2])
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : null
  }
  if (Array.isArray(v)) return num(v[0])
  return null
}

const date = (v: unknown): number | null => {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime()
  if (typeof v === 'string') {
    const m = /^(\d{4})[:-](\d\d)[:-](\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/.exec(v)
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime()
  }
  return null
}

const LABELS: Record<string, ColorLabel> = { red: 'red', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple', violet: 'purple' }

export async function readMetadata(file: string): Promise<ExtractedMeta> {
  const sidecar = findSidecar(file)
  let side: Record<string, any> = {}
  if (sidecar) {
    try {
      side = ((await exifr.sidecar(sidecar, { mergeOutput: false } as any)) as Record<string, any>) ?? {}
    } catch {
      side = {}
    }
  }
  let emb: Record<string, any> = {}
  try {
    emb = ((await exifr.parse(file, PARSE_OPTIONS as any)) as Record<string, any>) ?? {}
  } catch {
    emb = {}
  }

  const entries: MetaEntry[] = []
  const seen = new Map<string, string>()
  flatten(side, entries, seen)
  flatten(emb, entries, seen)

  const xmpGroups = [side.xmp, emb.xmp, side.photoshop, emb.photoshop]
  const dcGroups = [side.dc, emb.dc]
  const all = [side.exif, emb.exif, emb.ifd0, side.tiff, side.ifd0, emb.ihdr, side.xmp, emb.xmp, side.aux, emb.aux, side.exifEX, emb.exifEX, emb.iptc]

  const orientRaw = first([emb.ifd0, side.tiff], 'Orientation')
  const exifOrientation = typeof orientRaw === 'number' ? orientRaw : (ORIENTATIONS[String(orientRaw ?? '').toLowerCase()] ?? 1)

  const gps = emb.gps ?? {}
  let lat = num(gps.latitude)
  let lon = num(gps.longitude)
  if (lat == null && side.exif?.GPSLatitude != null) {
    lat = num(side.exif.latitude ?? null)
    lon = num(side.exif.longitude ?? null)
  }

  // Keywords: Lightroom hierarchy wins; flat dc:subject / IPTC keywords added when not part of a hierarchy.
  const hier = [...toArray(side.lr?.hierarchicalSubject), ...toArray(emb.lr?.hierarchicalSubject)].map((k) => normalizeKeyword(toText(k) ?? ''))
  const leaves = new Set(hier.flatMap((h) => h.split('>').map((s) => s.toLowerCase())))
  const flat = [...toArray(side.dc?.subject), ...toArray(emb.dc?.subject), ...toArray(emb.iptc?.Keywords)]
    .map((k) => normalizeKeyword(String(toText(k) ?? '')))
    .filter((k) => k && !leaves.has(k.toLowerCase()))
  const keywords = [...new Set([...hier, ...flat].filter(Boolean))]

  let rating = num(first(xmpGroups, 'Rating')) ?? num(first([emb.ifd0], 'Rating')) ?? 0
  let flag: Flag = null
  if (rating < 0) {
    flag = 'reject'
    rating = 0
  }
  const pick = num(first([side.xmpDM, emb.xmpDM, side.lr, emb.lr], 'pick', 'Pick'))
  if (pick === 1) flag = 'pick'
  else if (pick === -1) flag = 'reject'
  const labelText = String(toText(first(xmpGroups, 'Label')) ?? '').toLowerCase()

  let width = num(first([emb.exif, side.exif, side.tiff, emb.ihdr], 'ExifImageWidth', 'PixelXDimension', 'ImageWidth'))
  let height = num(first([emb.exif, side.exif, side.tiff, emb.ihdr], 'ExifImageHeight', 'PixelYDimension', 'ImageHeight'))
  if (width == null) width = num(first([emb.ifd0], 'ImageWidth'))
  if (height == null) height = num(first([emb.ifd0], 'ImageHeight'))
  if (exifOrientation >= 5 && width && height) [width, height] = [height, width]

  return {
    takenAt: date(first(all, 'DateTimeOriginal', 'CreateDate', 'DateCreated', 'DateTimeDigitized', 'ModifyDate', 'DateTime')),
    width,
    height,
    exifOrientation,
    make: toText(first([emb.ifd0, side.tiff, side.ifd0], 'Make')),
    model: toText(first([emb.ifd0, side.tiff, side.ifd0], 'Model')),
    lens: toText(first([emb.exif, side.exifEX, side.aux, emb.aux, side.exif], 'LensModel', 'Lens', 'LensInfo')),
    focal: num(first(all, 'FocalLength')),
    aperture: num(first(all, 'FNumber', 'ApertureValue')),
    shutter: num(first(all, 'ExposureTime')),
    iso: num(first(all, 'ISO', 'ISOSpeedRatings', 'PhotographicSensitivity', 'RecommendedExposureIndex')),
    lat,
    lon,
    rating: Math.max(0, Math.min(5, Math.round(rating))),
    flag,
    label: LABELS[labelText] ?? null,
    title: toText(first(dcGroups, 'title')) ?? toText(first([emb.iptc], 'ObjectName', 'Headline')),
    caption: toText(first(dcGroups, 'description')) ?? toText(first([emb.iptc, emb.ifd0], 'Caption', 'ImageDescription')),
    creator: toText(first(dcGroups, 'creator')) ?? toText(first([emb.ifd0, emb.iptc], 'Artist', 'Byline')),
    keywords,
    entries,
    sidecar
  }
}

/** Embedded EXIF thumbnail, used when no larger preview can be produced. */
export async function readExifThumbnail(file: string): Promise<Buffer | null> {
  try {
    const t = await exifr.thumbnail(file)
    return t ? Buffer.from(t) : null
  } catch {
    return null
  }
}
