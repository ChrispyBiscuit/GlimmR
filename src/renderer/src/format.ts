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

export const exposure = (p: Photo): string =>
  [p.focal != null ? `${Math.round(p.focal)}mm` : null, p.aperture != null ? `ƒ/${Number(p.aperture.toFixed(1))}` : null, fmtShutter(p.shutter), p.iso != null ? `ISO ${p.iso}` : null]
    .filter(Boolean)
    .join('  ·  ')

export const LABEL_COLORS: Record<string, string> = {
  red: '#ff5a5f',
  yellow: '#ffc53d',
  green: '#52c41a',
  blue: '#4096ff',
  purple: '#b37feb'
}

export const quoteValue = (v: string): string => (/[\s"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v)
