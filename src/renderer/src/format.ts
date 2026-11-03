import type { Photo } from '../../shared/types'

export const fmtDate = (ms: number | null, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string =>
  ms == null ? '—' : new Date(ms).toLocaleString(undefined, opts)

export const fmtShutter = (s: number | null): string | null => {
  if (s == null) return null
  if (s >= 1) return `${Number(s.toFixed(1))}s`
  return `1/${Math.round(1 / s)}`
}

export const fmtBytes = (b: number): string => {
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export const fmtNum = (n: number): string => n.toLocaleString()

export const camera = (p: Photo): string | null => {
  if (!p.model) return p.make
  // Many makers repeat the brand in the model ("Canon Canon EOS R5"); show it once.
  if (p.make && !p.model.toLowerCase().startsWith(p.make.split(' ')[0].toLowerCase())) return `${p.make} ${p.model}`
  return p.model
}

/** Exposure facts as separate parts ("23 mm", "ƒ/1.4", "1/250 s", "ISO 3200"), rendered with spacing rather than separators. */
export const exposureParts = (p: Photo): string[] =>
  [
    p.focal != null ? `${Math.round(p.focal)}\u00a0mm` : null,
    p.aperture != null ? `ƒ/${Number(p.aperture.toFixed(1))}` : null,
    p.shutter != null ? `${fmtShutter(p.shutter)}${p.shutter < 1 ? '\u00a0s' : ''}` : null,
    p.iso != null ? `ISO\u00a0${p.iso}` : null
  ].filter((x): x is string => !!x)

export const LABEL_COLORS: Record<string, string> = {
  red: '#e5534b',
  yellow: '#e6b422',
  green: '#46a758',
  blue: '#3e8ed0',
  purple: '#8e6bd8'
}

export const monthLabel = (day: string): string => {
  const [y, m] = day.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

export const quoteValue = (v: string): string => (/[\s"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v)

// ---- technical data ----

/** EXIF enumerations. exifr translates most EXIF values, but values from XMP and PNG come through as codes. */
const ENUMS: Record<string, Record<string, string>> = {
  ExposureProgram: { 0: 'Not defined', 1: 'Manual', 2: 'Program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative (slow shutter)', 6: 'Action (fast shutter)', 7: 'Portrait', 8: 'Landscape' },
  MeteringMode: { 0: 'Unknown', 1: 'Average', 2: 'Centre-weighted', 3: 'Spot', 4: 'Multi-spot', 5: 'Matrix / evaluative', 6: 'Partial', 255: 'Other' },
  WhiteBalance: { 0: 'Auto', 1: 'Manual' },
  ExposureMode: { 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' },
  SceneCaptureType: { 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' },
  ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated' },
  SensingMethod: { 1: 'Not defined', 2: 'One-chip colour area', 3: 'Two-chip colour area', 4: 'Three-chip colour area', 5: 'Colour sequential area', 7: 'Trilinear', 8: 'Colour sequential linear' },
  Contrast: { 0: 'Normal', 1: 'Low', 2: 'High' },
  Saturation: { 0: 'Normal', 1: 'Low', 2: 'High' },
  Sharpness: { 0: 'Normal', 1: 'Soft', 2: 'Hard' },
  SubjectDistRange: { 0: 'Unknown', 1: 'Macro', 2: 'Close', 3: 'Distant' },
  SubjectDistanceRange: { 0: 'Unknown', 1: 'Macro', 2: 'Close', 3: 'Distant' },
  CustomRendered: { 0: 'Normal', 1: 'Custom' },
  LightSource: { 0: 'Unknown', 1: 'Daylight', 2: 'Fluorescent', 3: 'Tungsten', 4: 'Flash', 9: 'Fine weather', 10: 'Cloudy', 11: 'Shade', 17: 'Standard light A', 20: 'D55', 21: 'D65', 255: 'Other' },
  Orientation: { 1: 'Normal', 2: 'Mirrored', 3: 'Rotated 180°', 4: 'Mirrored vertically', 5: 'Mirrored, rotated 90° anticlockwise', 6: 'Rotated 90° clockwise', 7: 'Mirrored, rotated 90° clockwise', 8: 'Rotated 90° anticlockwise' },
  ResolutionUnit: { 1: 'None', 2: 'inches', 3: 'cm' }
}

function flashText(v: number): string {
  const fired = v & 1 ? 'Fired' : 'Did not fire'
  const mode = (v >> 3) & 3
  const extras = [mode === 3 ? 'auto' : mode === 1 ? 'forced on' : mode === 2 ? 'off' : '', v & 0x40 ? 'red-eye reduction' : '', v & 0x20 ? 'no flash unit' : ''].filter(Boolean)
  return extras.length ? `${fired} (${extras.join(', ')})` : fired
}

/** A metadata value made readable: enumerations named, flash decoded. */
export function metaValue(key: string, value: string): string {
  const v = value.trim()
  if (key === 'Flash' && /^\d+$/.test(v)) return flashText(Number(v))
  return (/^\d+$/.test(v) && ENUMS[key]?.[v]) || value
}

/** A number from a metadata value: 1/6, 55/1, 8, "+0.7 EV". */
export function metaNumber(value: string | undefined): number | null {
  if (value == null) return null
  const m = /^\s*([+-]?\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/.exec(value)
  if (!m) return null
  const n = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])
  return Number.isFinite(n) ? n : null
}

const COMMON_RATIOS: [number, string][] = [
  [1, '1:1'],
  [5 / 4, '5:4'],
  [4 / 3, '4:3'],
  [3 / 2, '3:2'],
  [16 / 10, '16:10'],
  [16 / 9, '16:9'],
  [2, '2:1'],
  [21 / 9, '21:9']
]

/** "3:2", "4:5"… for a width and height, when one is close enough. */
export function ratioName(w: number, h: number): string | null {
  const r = Math.max(w, h) / Math.min(w, h)
  const hit = COMMON_RATIOS.find(([x]) => Math.abs(x - r) / x < 0.012)
  if (!hit) return null
  const [a, b] = hit[1].split(':')
  return w >= h ? `${a}:${b}` : `${b}:${a}`
}

export interface TechRow {
  label: string
  value: string
  /** A metadata key and value to search for when clicked. */
  search?: [string, string]
}

/**
 * The technical summary for the info panel: exposure value, 35 mm equivalent, field of view, flash, metering, colour,
 * serial numbers and so on, from whichever metadata keys the file uses.
 */
export function technicalRows(d: { aperture: number | null; shutter: number | null; iso: number | null; focal: number | null }, meta: Map<string, string>): TechRow[] {
  const pick = (...keys: string[]): [string, string] | null => {
    for (const k of keys) {
      const v = meta.get(k)
      if (v != null && v !== '') return [k, v]
    }
    return null
  }
  const rows: TechRow[] = []
  const add = (label: string, hit: [string, string] | null, fmt: (v: string) => string | null = (v) => metaValue(hit![0], v)): void => {
    if (!hit) return
    const value = fmt(hit[1])
    if (value) rows.push({ label, value, search: hit })
  }
  if (d.aperture && d.shutter && d.iso) {
    const ev = Math.log2((d.aperture * d.aperture) / d.shutter) - Math.log2(d.iso / 100)
    rows.push({ label: 'Exposure value', value: `EV ${ev.toFixed(1)} (at ISO 100)` })
  }
  add('Compensation', pick('ExposureCompensation', 'ExposureBiasValue'), (v) => {
    const n = metaNumber(v)
    return n == null ? v : `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1).replace(/\.0$/, '')} EV`
  })
  add('Program', pick('ExposureProgram'))
  add('Exposure mode', pick('ExposureMode'))
  add('Metering', pick('MeteringMode'))
  add('Flash', pick('Flash'))
  add('White balance', pick('WhiteBalance'))
  add('Light source', pick('LightSource'))
  const f35 = metaNumber(pick('FocalLengthIn35mmFormat', 'FocalLenIn35mmFilm', 'FocalLengthIn35mmFilm')?.[1])
  if (f35) {
    const crop = d.focal ? f35 / d.focal : null
    rows.push({ label: '35 mm equivalent', value: `${Math.round(f35)} mm${crop && Math.abs(crop - 1) > 0.05 ? ` (${crop.toFixed(1)}× crop)` : ''}` })
    const fov = (size: number): number => (2 * Math.atan(size / (2 * f35)) * 180) / Math.PI
    rows.push({ label: 'Field of view', value: `${fov(36).toFixed(0)}° × ${fov(24).toFixed(0)}° (${fov(43.27).toFixed(0)}° diagonal)` })
  }
  add('Subject distance', pick('SubjectDistance'), (v) => {
    const n = metaNumber(v)
    return n == null ? v : n > 1000 ? '∞' : `${n.toFixed(n < 10 ? 2 : 1)} m`
  })
  add('Distance range', pick('SubjectDistanceRange', 'SubjectDistRange'))
  add('Scene type', pick('SceneCaptureType'))
  add('Colour space', pick('ColorSpace'))
  add('Colour profile', pick('ProfileDescription', 'ICCProfileName', 'ProfileName'))
  add('Bit depth', pick('BitsPerSample', 'BitDepth'), (v) => `${v.split(/[ ,]+/)[0]}-bit`)
  add('Contrast', pick('Contrast'))
  add('Saturation', pick('Saturation'))
  add('Sharpness', pick('Sharpness'))
  add('Camera serial', pick('BodySerialNumber', 'SerialNumber', 'InternalSerialNumber'))
  add('Lens serial', pick('LensSerialNumber'))
  add('Software', pick('Software', 'CreatorTool'))
  add('Time zone', pick('OffsetTimeOriginal', 'OffsetTime'))
  add('Altitude', pick('GPSAltitude'), (v) => {
    const n = metaNumber(v)
    return n == null ? v : `${Math.round(n)} m`
  })
  add('Heading', pick('GPSImgDirection'), (v) => {
    const n = metaNumber(v)
    return n == null ? v : `${Math.round(n)}°`
  })
  return rows
}
