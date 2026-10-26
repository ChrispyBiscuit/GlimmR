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
