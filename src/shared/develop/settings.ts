// Develop settings: everything the develop pipeline does to a photo, stored per photo in the catalog (photos.develop)
// as JSON. Additive to the existing crop/rotation edit (photos.edit). See docs/DEVELOP_PRD.md.

import type { LutSpace } from './color'

export type WbMode = 'asShot' | 'auto' | 'daylight' | 'cloudy' | 'shade' | 'tungsten' | 'fluorescent' | 'flash' | 'custom'

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type HslBand = (typeof HSL_BANDS)[number]
const eight = (): number[] => [0, 0, 0, 0, 0, 0, 0, 0]

export interface CurvePoint {
  x: number
  y: number
}

export interface DevelopSettings {
  v: 1
  /**
   * White balance. For raw files temp is in kelvin and tint ±150; for other files both are relative (±100), 0 meaning
   * as shot. In asShot and auto modes temp/tint hold the resolved values.
   */
  wb: { mode: WbMode; temp: number; tint: number }
  /** Stops, ±5. */
  exposure: number
  /** ±100 each. */
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  curve: {
    /** Parametric regions, ±100. */
    highlights: number
    lights: number
    darks: number
    shadows: number
    /** Point curves (0–1), for RGB together and each channel. Empty means straight. */
    rgb: CurvePoint[]
    r: CurvePoint[]
    g: CurvePoint[]
    b: CurvePoint[]
  }
  vibrance: number
  saturation: number
  hsl: { hue: number[]; sat: number[]; lum: number[] }
  bw: { on: boolean; mix: number[] }
  sharpen: { amount: number; radius: number; detail: number; masking: number }
  noise: { luminance: number; color: number }
  /** The creative look: a LUT (by content hash, stored in the catalog) with its amount and input space. */
  look: { lut: string | null; name: string; amount: number; space: LutSpace }
  /** Names of styles applied, for search. */
  styles: string[]
}

export type SourceKind = 'raw' | 'display'

export function defaultSettings(kind: SourceKind): DevelopSettings {
  return {
    v: 1,
    wb: { mode: 'asShot', temp: kind === 'raw' ? 5500 : 0, tint: 0 },
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    curve: { highlights: 0, lights: 0, darks: 0, shadows: 0, rgb: [], r: [], g: [], b: [] },
    vibrance: 0,
    saturation: 0,
    hsl: { hue: eight(), sat: eight(), lum: eight() },
    bw: { on: false, mix: eight() },
    // Raw files need capture sharpening and some colour noise reduction, as other raw developers default to.
    sharpen: kind === 'raw' ? { amount: 40, radius: 1, detail: 25, masking: 0 } : { amount: 0, radius: 1, detail: 25, masking: 0 },
    noise: kind === 'raw' ? { luminance: 0, color: 25 } : { luminance: 0, color: 0 },
    look: { lut: null, name: '', amount: 1, space: 'srgb' },
    styles: []
  }
}

/** Groups of settings, for copy/paste, sync and styles. */
export const GROUPS = {
  wb: { label: 'White balance', keys: ['wb'] },
  tone: { label: 'Tone', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  curve: { label: 'Tone curve', keys: ['curve'] },
  presence: { label: 'Vibrance and saturation', keys: ['vibrance', 'saturation'] },
  hsl: { label: 'Colour (HSL)', keys: ['hsl'] },
  bw: { label: 'Black and white', keys: ['bw'] },
  detail: { label: 'Sharpening and noise', keys: ['sharpen', 'noise'] },
  look: { label: 'Look (LUT)', keys: ['look'] }
} as const satisfies Record<string, { label: string; keys: (keyof DevelopSettings)[] }>
export type Group = keyof typeof GROUPS
export const ALL_GROUPS = Object.keys(GROUPS) as Group[]

/** Some groups of settings, e.g. for a style. Missing groups are left alone when applied. */
export type PartialSettings = Partial<Omit<DevelopSettings, 'v' | 'styles'>>

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function pick(s: DevelopSettings, groups: Group[]): PartialSettings {
  const out: Record<string, unknown> = {}
  for (const g of groups) for (const k of GROUPS[g].keys) out[k] = clone(s[k])
  return out as PartialSettings
}

/** Applies a partial set of settings over a photo's settings. */
export function applyPartial(s: DevelopSettings, p: PartialSettings, amount = 1): DevelopSettings {
  const out = clone(s)
  const blend = (a: number, b: number): number => a + (b - a) * amount
  for (const [k, v] of Object.entries(p) as [keyof PartialSettings, unknown][]) {
    if (v == null) continue
    // Numbers blend with the style's amount; structured settings are replaced (their numbers blended too).
    const cur = (out as unknown as Record<string, unknown>)[k]
    ;(out as unknown as Record<string, unknown>)[k] = mergeValue(cur, clone(v), blend)
  }
  return out
}

function mergeValue(cur: unknown, next: unknown, blend: (a: number, b: number) => number): unknown {
  if (typeof next === 'number' && typeof cur === 'number') return blend(cur, next)
  if (Array.isArray(next) && Array.isArray(cur) && next.every((x) => typeof x === 'number') && next.length === cur.length) return next.map((x, i) => blend(cur[i] as number, x as number))
  if (next && typeof next === 'object' && !Array.isArray(next) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    const o = { ...(cur as Record<string, unknown>) }
    for (const [k, v] of Object.entries(next)) o[k] = mergeValue(o[k], v, blend)
    return o
  }
  return next
}

/** Fills in anything missing (settings saved by an older version) and clamps values to their ranges. */
export function sanitize(input: unknown, kind: SourceKind): DevelopSettings {
  const d = defaultSettings(kind)
  if (!input || typeof input !== 'object') return d
  const s = mergeValue(d, input, (_a, b) => b) as DevelopSettings
  const c = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)
  s.v = 1
  s.exposure = c(s.exposure, -5, 5, 0)
  for (const k of ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation'] as const) s[k] = c(s[k], -100, 100, 0)
  for (const k of ['highlights', 'lights', 'darks', 'shadows'] as const) s.curve[k] = c(s.curve[k], -100, 100, 0)
  for (const k of ['rgb', 'r', 'g', 'b'] as const)
    s.curve[k] = (Array.isArray(s.curve[k]) ? s.curve[k] : [])
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: c(p.x, 0, 1, 0), y: c(p.y, 0, 1, 0) }))
      .sort((a, b) => a.x - b.x)
  for (const k of ['hue', 'sat', 'lum'] as const) s.hsl[k] = Array.from({ length: 8 }, (_, i) => c(s.hsl[k]?.[i], -100, 100, 0))
  s.bw.on = !!s.bw.on
  s.bw.mix = Array.from({ length: 8 }, (_, i) => c(s.bw.mix?.[i], -100, 100, 0))
  s.sharpen = { amount: c(s.sharpen.amount, 0, 150, d.sharpen.amount), radius: c(s.sharpen.radius, 0.5, 3, 1), detail: c(s.sharpen.detail, 0, 100, 25), masking: c(s.sharpen.masking, 0, 100, 0) }
  s.noise = { luminance: c(s.noise.luminance, 0, 100, 0), color: c(s.noise.color, 0, 100, d.noise.color) }
  s.look = {
    lut: typeof s.look.lut === 'string' ? s.look.lut : null,
    name: String(s.look.name ?? ''),
    amount: c(s.look.amount, 0, 2, 1),
    space: (['srgb', 'rec709', 'slog3', 'logc3', 'vlog', 'flog'] as LutSpace[]).includes(s.look.space) ? s.look.space : 'srgb'
  }
  s.wb = {
    mode: (['asShot', 'auto', 'daylight', 'cloudy', 'shade', 'tungsten', 'fluorescent', 'flash', 'custom'] as WbMode[]).includes(s.wb.mode) ? s.wb.mode : 'asShot',
    temp: kind === 'raw' ? c(s.wb.temp, 2000, 50000, 5500) : c(s.wb.temp, -100, 100, 0),
    tint: kind === 'raw' ? c(s.wb.tint, -150, 150, 0) : c(s.wb.tint, -100, 100, 0)
  }
  s.styles = Array.isArray(s.styles) ? s.styles.filter((x) => typeof x === 'string').slice(0, 20) : []
  return s
}

/** Whether any group differs from the defaults (a photo is "developed"). */
export function changedGroups(s: DevelopSettings, kind: SourceKind): Group[] {
  const d = defaultSettings(kind)
  return ALL_GROUPS.filter((g) =>
    GROUPS[g].keys.some((k) => {
      if (k === 'wb') return s.wb.mode !== 'asShot'
      return JSON.stringify(s[k]) !== JSON.stringify(d[k])
    })
  )
}

/** White balance presets for raw files (kelvin, tint), as other raw developers name them. */
export const WB_PRESETS: Partial<Record<WbMode, { temp: number; tint: number; label: string }>> = {
  daylight: { temp: 5500, tint: 10, label: 'Daylight' },
  cloudy: { temp: 6500, tint: 10, label: 'Cloudy' },
  shade: { temp: 7500, tint: 10, label: 'Shade' },
  tungsten: { temp: 2850, tint: 0, label: 'Tungsten' },
  fluorescent: { temp: 3800, tint: 21, label: 'Fluorescent' },
  flash: { temp: 5500, tint: 0, label: 'Flash' }
}
