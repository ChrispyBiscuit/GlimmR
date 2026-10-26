// Search syntax → parameterized SQL over the catalog.
//
//   sunset beach                 free text (full-text, prefix match) over every text field
//   camera:"X-T5" lens:23        field contains value
//   camera:="Canon EOS R5"       exact value
//   iso:>1600 f:<=2.8            numeric comparison
//   focal:24..70 date:2019..2021 ranges
//   -raw -keyword:test           exclusion
//   has:gps is:offline           presence / state
//   ExposureProgram:Manual       any raw EXIF/IPTC/XMP key

import type { Db } from './db'
import type { Facets, FacetValue, Scope, SortSpec, Suggestion } from '../shared/types'
import { tokenize } from '../shared/tokenize'

export { tokenize }

export interface Term {
  neg: boolean
  field: string | null
  op: '' | '=' | '>' | '>=' | '<' | '<=' | 'range'
  value: string
  value2?: string
}

const unquote = (s: string): string => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s.replace(/^"/, ''))

export function parseQuery(input: string): Term[] {
  const terms: Term[] = []
  for (let tok of tokenize(input)) {
    let neg = false
    if (tok.startsWith('-') && tok.length > 1) {
      neg = true
      tok = tok.slice(1)
    }
    const m = /^([A-Za-z][\w.-]*):(.*)$/.exec(tok)
    if (!m) {
      const value = unquote(tok)
      if (value) terms.push({ neg, field: null, op: '', value })
      continue
    }
    const field = m[1] // case kept for raw metadata keys; built-in fields match case-insensitively
    let rest = m[2]
    let op: Term['op'] = ''
    const opm = /^(>=|<=|>|<|=)/.exec(rest)
    if (opm) {
      op = opm[1] as Term['op']
      rest = rest.slice(opm[1].length)
    }
    const quoted = rest.startsWith('"')
    rest = unquote(rest)
    if (!op && !quoted) {
      const range = /^(.+?)\.\.(.+)$/.exec(rest)
      if (range) {
        terms.push({ neg, field, op: 'range', value: range[1], value2: range[2] })
        continue
      }
    }
    if (rest === '') continue
    terms.push({ neg, field, op, value: rest })
  }
  return terms
}

// ---- field definitions ----

type NumField = { kind: 'num'; expr: string; parse?: (v: string) => number | null }
type TextField = { kind: 'text'; expr: string }
type FieldDef = NumField | TextField | { kind: 'special' }

const parseShutter = (v: string): number | null => {
  const f = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(v.trim())
  if (f) return Number(f[1]) / Number(f[2])
  const n = Number(v.replace(/s$/i, ''))
  return Number.isFinite(n) ? n : null
}
const parseSize = (v: string): number | null => {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(v.trim())
  if (!m) return null
  const mult = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[(m[2] || 'b').toLowerCase() as 'b']
  return Number(m[1]) * mult
}
const parseAperture = (v: string): number | null => {
  const n = Number(v.replace(/^f\/?/i, ''))
  return Number.isFinite(n) ? n : null
}
const parseFocal = (v: string): number | null => {
  const n = Number(v.replace(/mm$/i, ''))
  return Number.isFinite(n) ? n : null
}

const CAMERA_EXPR = "TRIM(COALESCE(p.make,'') || ' ' || COALESCE(p.model,''))"

export const FIELDS: Record<string, FieldDef> = {
  iso: { kind: 'num', expr: 'p.iso' },
  f: { kind: 'num', expr: 'p.aperture', parse: parseAperture },
  aperture: { kind: 'num', expr: 'p.aperture', parse: parseAperture },
  focal: { kind: 'num', expr: 'p.focal', parse: parseFocal },
  shutter: { kind: 'num', expr: 'p.shutter', parse: parseShutter },
  rating: { kind: 'num', expr: 'p.rating' },
  width: { kind: 'num', expr: 'p.width' },
  height: { kind: 'num', expr: 'p.height' },
  mp: { kind: 'num', expr: '(p.width * p.height / 1000000.0)' },
  size: { kind: 'num', expr: 'p.size', parse: parseSize },
  year: { kind: 'num', expr: 'CAST(substr(p.taken_day, 1, 4) AS INTEGER)' },
  month: { kind: 'num', expr: 'CAST(substr(p.taken_day, 6, 2) AS INTEGER)', parse: (v) => parseMonth(v) },
  lat: { kind: 'num', expr: 'p.lat' },
  lon: { kind: 'num', expr: 'p.lon' },
  camera: { kind: 'text', expr: CAMERA_EXPR },
  make: { kind: 'text', expr: 'p.make' },
  model: { kind: 'text', expr: 'p.model' },
  lens: { kind: 'text', expr: 'p.lens' },
  title: { kind: 'text', expr: 'p.title' },
  caption: { kind: 'text', expr: 'p.caption' },
  creator: { kind: 'text', expr: 'p.creator' },
  file: { kind: 'text', expr: 'p.filename' },
  name: { kind: 'text', expr: 'p.filename' },
  filename: { kind: 'text', expr: 'p.filename' },
  path: { kind: 'text', expr: 'p.rel_path' },
  folder: { kind: 'special' },
  ext: { kind: 'special' },
  type: { kind: 'special' },
  flag: { kind: 'special' },
  label: { kind: 'special' },
  orientation: { kind: 'special' },
  keyword: { kind: 'special' },
  tag: { kind: 'special' },
  album: { kind: 'special' },
  date: { kind: 'special' },
  has: { kind: 'special' },
  is: { kind: 'special' }
}

export const FIELD_HELP: Record<string, string> = {
  camera: 'Camera make and model',
  lens: 'Lens model',
  iso: 'ISO, e.g. iso:>1600',
  f: 'Aperture, e.g. f:<=2.8',
  shutter: 'Shutter in seconds, e.g. shutter:<1/500',
  focal: 'Focal length mm, e.g. focal:24..70',
  rating: 'Stars 0–5, e.g. rating:>=4',
  flag: 'pick, reject or none',
  label: 'red, yellow, green, blue, purple or none',
  keyword: 'Keyword (hierarchical)',
  album: 'Album name',
  folder: 'Folder path',
  date: 'Date taken: 2023, 2023-05, 2023-05-14 or ranges',
  year: 'Year taken',
  month: 'Month taken (1–12 or name)',
  type: 'raw, jpeg, heic, png, tiff…',
  orientation: 'landscape, portrait or square',
  file: 'File name',
  title: 'Title',
  caption: 'Caption / description',
  creator: 'Creator / artist',
  mp: 'Megapixels',
  width: 'Pixel width',
  height: 'Pixel height',
  size: 'File size, e.g. size:>20mb',
  has: 'gps, keywords, title, caption, rating, label, flag',
  is: 'offline, online, raw, pick, reject, unrated'
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function parseMonth(v: string): number | null {
  const n = Number(v)
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n
  const i = MONTHS.indexOf(v.slice(0, 3).toLowerCase())
  return i >= 0 ? i + 1 : null
}

const RAW_EXTS = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'pef', 'dng', 'srw', '3fr', 'iiq', 'erf', 'x3f', 'mrw', 'kdc', 'dcr', 'raw', 'rwl']
const TYPE_ALIASES: Record<string, string[]> = {
  jpeg: ['jpg', 'jpeg'],
  jpg: ['jpg', 'jpeg'],
  heic: ['heic', 'heif'],
  heif: ['heic', 'heif'],
  tiff: ['tif', 'tiff'],
  tif: ['tif', 'tiff']
}

/** Parses 2023 / 2023-05 / 2023-05-14 into a local-time [start, end) epoch-ms range. */
export function parseDateRange(v: string): [number, number] | null {
  const m = /^(\d{4})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?$/.exec(v.trim())
  if (!m) return null
  const y = Number(m[1])
  if (m[3]) {
    const s = new Date(y, Number(m[2]) - 1, Number(m[3]))
    return [s.getTime(), new Date(y, Number(m[2]) - 1, Number(m[3]) + 1).getTime()]
  }
  if (m[2]) return [new Date(y, Number(m[2]) - 1, 1).getTime(), new Date(y, Number(m[2]), 1).getTime()]
  return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]
}

const ftsPhrase = (w: string): string => `"${w.replace(/"/g, '""')}"*`
const like = (v: string): string => `%${v.replace(/[\\%_]/g, (c) => '\\' + c)}%`
const LIKE = "LIKE ? ESCAPE '\\'"

interface Built {
  sql: string
  params: (string | number | null)[]
}

function numCompare(expr: string, t: Term, parse: (v: string) => number | null): Built | string {
  if (t.op === 'range') {
    const a = parse(t.value)
    const b = parse(t.value2!)
    if (a == null || b == null) return `"${t.value}..${t.value2}" is not a number range`
    return { sql: `(${expr} BETWEEN ? AND ?)`, params: [Math.min(a, b), Math.max(a, b)] }
  }
  const n = parse(t.value)
  if (n == null) return `"${t.value}" is not a number for ${t.field}`
  const op = t.op === '' || t.op === '=' ? '=' : t.op
  if (op === '=' && !Number.isInteger(n)) return { sql: `(ABS(${expr} - ?) < 0.0001)`, params: [n] }
  return { sql: `(${expr} ${op} ?)`, params: [n] }
}

function textCompare(expr: string, t: Term): Built {
  if (t.op === '=') return { sql: `(${expr} = ? COLLATE NOCASE)`, params: [t.value] }
  return { sql: `(${expr} ${LIKE})`, params: [like(t.value)] }
}

function buildTerm(t: Term): Built | string {
  const field = t.field!
  const key = field.toLowerCase()
  const def = FIELDS[key]
  const v = t.value.toLowerCase()
  if (def?.kind === 'num') return numCompare(def.expr, t, def.parse ?? ((s) => (Number.isFinite(Number(s)) ? Number(s) : null)))
  if (def?.kind === 'text') return textCompare(def.expr, t)
  switch (key) {
    case 'folder':
      return t.op === '='
        ? { sql: '(p.folder = ?)', params: [t.value] }
        : { sql: `(p.folder ${LIKE} OR p.root_id IN (SELECT id FROM roots WHERE name ${LIKE}))`, params: [like(t.value), like(t.value)] }
    case 'ext':
    case 'type': {
      if (v === 'raw') return { sql: "(p.kind = 'raw')", params: [] }
      if (v === 'image' || v === 'nonraw') return { sql: "(p.kind = 'image')", params: [] }
      const exts = TYPE_ALIASES[v] ?? [v.replace(/^\./, '')]
      return { sql: `(p.ext IN (${exts.map(() => '?').join(',')}))`, params: exts }
    }
    case 'flag':
      if (v === 'none' || v === 'unflagged') return { sql: '(p.flag IS NULL)', params: [] }
      if (v === 'pick' || v === 'picked') return { sql: "(p.flag = 'pick')", params: [] }
      if (v === 'reject' || v === 'rejected') return { sql: "(p.flag = 'reject')", params: [] }
      return `flag must be pick, reject or none`
    case 'label':
      if (v === 'none') return { sql: '(p.label IS NULL)', params: [] }
      return { sql: '(p.label = ?)', params: [v] }
    case 'orientation':
      return { sql: '(p.orientation = ?)', params: [v.startsWith('l') ? 'landscape' : v.startsWith('p') ? 'portrait' : 'square'] }
    case 'keyword':
    case 'tag': {
      const cond = t.op === '=' ? "(k.path = ? COLLATE NOCASE OR k.path LIKE ? ESCAPE '\\')" : `(k.path ${LIKE})`
      const params = t.op === '=' ? [t.value, `${t.value.replace(/[\\%_]/g, (c) => '\\' + c)}>%`] : [like(t.value)]
      return { sql: `p.id IN (SELECT pk.photo_id FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE ${cond})`, params }
    }
    case 'album':
      return {
        sql: `p.id IN (SELECT ap.photo_id FROM album_photos ap JOIN albums a ON a.id = ap.album_id WHERE ${t.op === '=' ? 'a.name = ? COLLATE NOCASE' : `a.name ${LIKE}`})`,
        params: [t.op === '=' ? t.value : like(t.value)]
      }
    case 'date': {
      let range: [number, number] | null = null
      if (t.op === 'range') {
        const a = parseDateRange(t.value)
        const b = parseDateRange(t.value2!)
        if (a && b) range = [Math.min(a[0], b[0]), Math.max(a[1], b[1])]
      } else {
        const r = parseDateRange(t.value)
        if (r) {
          if (t.op === '>') range = [r[1], 8.64e15]
          else if (t.op === '>=') range = [r[0], 8.64e15]
          else if (t.op === '<') range = [-8.64e15, r[0]]
          else if (t.op === '<=') range = [-8.64e15, r[1]]
          else range = r
        }
      }
      if (!range) return `"${t.value}" is not a date (use 2023, 2023-05 or 2023-05-14)`
      return { sql: '(p.taken_at >= ? AND p.taken_at < ?)', params: range }
    }
    case 'has':
      switch (v) {
        case 'gps':
        case 'location':
          return { sql: '(p.lat IS NOT NULL)', params: [] }
        case 'keywords':
        case 'keyword':
          return { sql: 'p.id IN (SELECT photo_id FROM photo_keywords)', params: [] }
        case 'title':
          return { sql: "(COALESCE(p.title,'') <> '')", params: [] }
        case 'caption':
          return { sql: "(COALESCE(p.caption,'') <> '')", params: [] }
        case 'rating':
          return { sql: '(p.rating > 0)', params: [] }
        case 'label':
          return { sql: '(p.label IS NOT NULL)', params: [] }
        case 'flag':
          return { sql: '(p.flag IS NOT NULL)', params: [] }
        case 'album':
          return { sql: 'p.id IN (SELECT photo_id FROM album_photos)', params: [] }
        default:
          return { sql: 'p.id IN (SELECT photo_id FROM metadata WHERE key = ?)', params: [t.value] }
      }
    case 'is':
      switch (v) {
        case 'offline':
        case 'missing':
          return { sql: '(p.offline = 1)', params: [] }
        case 'online':
          return { sql: '(p.offline = 0)', params: [] }
        case 'raw':
          return { sql: "(p.kind = 'raw')", params: [] }
        case 'pick':
        case 'picked':
          return { sql: "(p.flag = 'pick')", params: [] }
        case 'reject':
        case 'rejected':
          return { sql: "(p.flag = 'reject')", params: [] }
        case 'unrated':
          return { sql: '(p.rating = 0)', params: [] }
        default:
          return `unknown is:${t.value}`
      }
  }
  // Any other field name is a raw metadata key.
  if (t.op !== '' && t.op !== '=') {
    const c = numCompare('m.num', t, (s) => (Number.isFinite(Number(s)) ? Number(s) : null))
    if (typeof c === 'string') return c
    return { sql: `p.id IN (SELECT m.photo_id FROM metadata m WHERE m.key = ? AND ${c.sql})`, params: [field, ...c.params] }
  }
  const c = t.op === '=' ? { sql: '(m.value = ? COLLATE NOCASE)', params: [t.value] } : { sql: `(m.value ${LIKE})`, params: [like(t.value)] }
  return { sql: `p.id IN (SELECT m.photo_id FROM metadata m WHERE m.key = ? AND ${c.sql})`, params: [field, ...c.params] }
}

export interface Where {
  sql: string
  params: (string | number | null)[]
  error?: string
  /** Extra JOIN needed for the scope (album ordering). */
  join: string
}

export function buildWhere(db: Db, scope: Scope, query: string): Where {
  const clauses: string[] = []
  const params: (string | number | null)[] = []
  const errors: string[] = []
  let join = ''
  let q = query

  switch (scope.type) {
    case 'album':
      join = 'JOIN album_photos sa ON sa.photo_id = p.id AND sa.album_id = ' + Number(scope.id)
      break
    case 'smart': {
      const s = db.prepare('SELECT query FROM smart_albums WHERE id = ?').get(scope.id) as { query: string } | undefined
      if (s) q = `${s.query} ${q}`
      break
    }
    case 'folder':
      clauses.push("(p.root_id = ? AND (? = '' OR p.folder = ? OR p.folder LIKE ? ESCAPE '\\'))")
      params.push(scope.rootId, scope.relPath, scope.relPath, scope.relPath.replace(/[\\%_]/g, (c) => '\\' + c) + '/%')
      break
    case 'keyword':
      clauses.push("p.id IN (SELECT pk.photo_id FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE k.path = ? OR k.path LIKE ? ESCAPE '\\')")
      params.push(scope.path, scope.path.replace(/[\\%_]/g, (c) => '\\' + c) + '>%')
      break
    case 'picks':
      clauses.push("(p.flag = 'pick')")
      break
    case 'recent':
      clauses.push('(p.added_at >= (SELECT MAX(added_at) FROM photos) - 30 * 86400000)')
      break
  }

  const positive: string[] = []
  for (const t of parseQuery(q)) {
    if (t.field === null) {
      if (t.neg) {
        clauses.push('p.id NOT IN (SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?)')
        params.push(ftsPhrase(t.value))
      } else positive.push(ftsPhrase(t.value))
      continue
    }
    const b = buildTerm(t)
    if (typeof b === 'string') {
      errors.push(b)
      continue
    }
    clauses.push(t.neg ? `NOT COALESCE(${b.sql}, 0)` : b.sql)
    params.push(...b.params)
  }
  if (positive.length) {
    clauses.push('p.id IN (SELECT rowid FROM photos_fts WHERE photos_fts MATCH ?)')
    params.push(positive.join(' AND '))
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1', params, error: errors.join('; ') || undefined, join }
}

// ---- sorting ----

export const SORT_FIELDS: Record<string, { label: string; expr: string }> = {
  taken: { label: 'Date taken', expr: 'p.taken_at' },
  added: { label: 'Date added', expr: 'p.added_at' },
  filename: { label: 'File name', expr: 'p.filename COLLATE NOCASE' },
  size: { label: 'File size', expr: 'p.size' },
  rating: { label: 'Rating', expr: 'p.rating' },
  camera: { label: 'Camera', expr: CAMERA_EXPR },
  lens: { label: 'Lens', expr: 'p.lens' },
  iso: { label: 'ISO', expr: 'p.iso' },
  aperture: { label: 'Aperture', expr: 'p.aperture' },
  shutter: { label: 'Shutter speed', expr: 'p.shutter' },
  focal: { label: 'Focal length', expr: 'p.focal' },
  mp: { label: 'Megapixels', expr: '(p.width * p.height)' },
  folder: { label: 'Folder', expr: 'p.folder' },
  label: { label: 'Color label', expr: 'p.label' },
  random: { label: 'Shuffle', expr: 'random()' }
}

export function orderBy(sort: SortSpec, scope: Scope): { sql: string; params: string[] } {
  const dir = sort.dir === 'asc' ? 'ASC' : 'DESC'
  if (sort.field === 'random') return { sql: 'ORDER BY random()', params: [] }
  if (sort.field === 'albumOrder' && scope.type === 'album') return { sql: `ORDER BY sa.added_at ${dir}, p.id`, params: [] }
  const known = SORT_FIELDS[sort.field]
  // NULLS LAST keeps photos without the value at the end and lets SQLite walk an index for plain columns.
  if (known) return { sql: `ORDER BY ${known.expr} ${dir} NULLS LAST, p.id ${dir}`, params: [] }
  // Sort by any raw metadata key: numbers numerically, otherwise by text.
  const sub = '(SELECT COALESCE(m.num, m.value) FROM metadata m WHERE m.photo_id = p.id AND m.key = ? LIMIT 1)'
  return { sql: `ORDER BY ${sub} ${dir} NULLS LAST, p.id ${dir}`, params: [sort.field] }
}

// ---- facets ----

export function computeFacets(db: Db, where: Where): Facets {
  const base = `SELECT p.id FROM photos p ${where.join} WHERE ${where.sql}`
  db.exec('DROP TABLE IF EXISTS temp.facet_ids')
  db.exec('CREATE TEMP TABLE facet_ids (id INTEGER PRIMARY KEY)')
  db.prepare(`INSERT OR IGNORE INTO temp.facet_ids ${base}`).run(...where.params)
  const group = (expr: string, limit = 50, order = 'c DESC'): FacetValue[] =>
    (
      db
        .prepare(
          `SELECT ${expr} AS v, COUNT(*) AS c FROM photos p JOIN temp.facet_ids f ON f.id = p.id
           WHERE ${expr} IS NOT NULL AND ${expr} <> '' GROUP BY v ORDER BY ${order} LIMIT ${limit}`
        )
        .all() as { v: string | number; c: number }[]
    ).map((r) => ({ value: String(r.v), label: String(r.v), count: r.c }))

  const keyword = (
    db
      .prepare(
        `SELECT k.path AS v, COUNT(*) AS c FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id
         JOIN temp.facet_ids f ON f.id = pk.photo_id GROUP BY k.id ORDER BY c DESC LIMIT 60`
      )
      .all() as { v: string; c: number }[]
  ).map((r) => ({ value: r.v, label: r.v.split('>').pop()!, count: r.c }))

  const range = (expr: string): [number, number] | null => {
    const r = db.prepare(`SELECT MIN(${expr}) AS a, MAX(${expr}) AS b FROM photos p JOIN temp.facet_ids f ON f.id = p.id`).get() as {
      a: number | null
      b: number | null
    }
    return r.a == null || r.b == null ? null : [r.a, r.b]
  }

  const rating = group('p.rating', 6, 'v DESC').map((f) => ({ ...f, label: f.value === '0' ? 'Unrated' : '★'.repeat(Number(f.value)) }))
  const flagRows = db
    .prepare(`SELECT COALESCE(p.flag, 'none') AS v, COUNT(*) AS c FROM photos p JOIN temp.facet_ids f ON f.id = p.id GROUP BY v`)
    .all() as { v: string; c: number }[]
  const type = group("CASE WHEN p.kind = 'raw' THEN 'raw' WHEN p.ext IN ('jpg','jpeg') THEN 'jpeg' WHEN p.ext IN ('heic','heif') THEN 'heic' WHEN p.ext IN ('tif','tiff') THEN 'tiff' ELSE p.ext END")
  const result: Facets = {
    year: group('substr(p.taken_day, 1, 4)', 100, 'v DESC'),
    camera: group(CAMERA_EXPR),
    lens: group('p.lens'),
    keyword,
    type: type.map((t) => ({ ...t, label: t.value.toUpperCase() })),
    rating,
    flag: flagRows.map((r) => ({ value: r.v, label: r.v === 'pick' ? 'Picked' : r.v === 'reject' ? 'Rejected' : 'Unflagged', count: r.c })),
    label: group('p.label'),
    orientation: group('p.orientation'),
    ranges: { iso: range('p.iso'), focal: range('p.focal'), aperture: range('p.aperture') }
  }
  db.exec('DROP TABLE IF EXISTS temp.facet_ids')
  return result
}

// ---- autocomplete ----

const VALUE_SOURCES: Record<string, string> = {
  camera: CAMERA_EXPR,
  make: 'p.make',
  model: 'p.model',
  lens: 'p.lens',
  creator: 'p.creator',
  ext: 'p.ext',
  iso: 'p.iso',
  focal: 'p.focal',
  f: 'p.aperture',
  aperture: 'p.aperture'
}

export function suggest(db: Db, input: string): Suggestion[] {
  const tokens = tokenize(input)
  const last = input.endsWith(' ') ? '' : (tokens[tokens.length - 1] ?? '')
  const neg = last.startsWith('-') ? '-' : ''
  const tok = last.replace(/^-/, '')
  const m = /^([A-Za-z][\w.-]*):(=?)(.*)$/.exec(tok)
  if (!m) {
    if (!tok) return []
    const lower = tok.toLowerCase()
    const fields: Suggestion[] = Object.keys(FIELD_HELP)
      .filter((f) => f.startsWith(lower))
      .map((f) => ({ value: `${neg}${f}:`, label: FIELD_HELP[f], kind: 'field' }))
    const keys = (
      db
        .prepare(`SELECT key, COUNT(DISTINCT photo_id) AS c FROM metadata WHERE key LIKE ? GROUP BY key COLLATE NOCASE ORDER BY c DESC LIMIT 8`)
        .all(tok.replace(/[%_]/g, '') + '%') as { key: string; c: number }[]
    )
      .filter((k) => !FIELDS[k.key.toLowerCase()])
      .map((k): Suggestion => ({ value: `${neg}${k.key}:`, label: 'Metadata field', count: k.c, kind: 'field' }))
    return [...fields, ...keys].slice(0, 12)
  }
  const field = m[1]
  const typed = unquote(m[3])
  const key = field.toLowerCase()
  const quote = (v: string): string => (/\s/.test(v) ? `"${v}"` : v)
  const mk = (rows: { v: string | number; c: number }[], label?: (v: string) => string): Suggestion[] =>
    rows.map((r) => ({ value: `${neg}${field}:=${quote(String(r.v))}`, label: label ? label(String(r.v)) : String(r.v), count: r.c, kind: 'value' }))
  const likeTyped = like(typed)
  if (VALUE_SOURCES[key]) {
    const e = VALUE_SOURCES[key]
    return mk(
      db.prepare(`SELECT ${e} AS v, COUNT(*) AS c FROM photos p WHERE ${e} IS NOT NULL AND CAST(${e} AS TEXT) LIKE ? ESCAPE '\\' GROUP BY v ORDER BY c DESC LIMIT 12`).all(likeTyped) as {
        v: string
        c: number
      }[]
    )
  }
  if (key === 'keyword' || key === 'tag')
    return mk(
      db
        .prepare(`SELECT k.path AS v, COUNT(*) AS c FROM keywords k JOIN photo_keywords pk ON pk.keyword_id = k.id WHERE k.path LIKE ? ESCAPE '\\' GROUP BY k.id ORDER BY c DESC LIMIT 12`)
        .all(likeTyped) as { v: string; c: number }[]
    )
  if (key === 'album')
    return mk(
      db
        .prepare(`SELECT a.name AS v, COUNT(ap.photo_id) AS c FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id WHERE a.name LIKE ? ESCAPE '\\' GROUP BY a.id ORDER BY a.name LIMIT 12`)
        .all(likeTyped) as { v: string; c: number }[]
    )
  if (key === 'folder')
    return mk(
      db.prepare(`SELECT folder AS v, COUNT(*) AS c FROM photos WHERE folder <> '' AND folder LIKE ? ESCAPE '\\' GROUP BY folder ORDER BY c DESC LIMIT 12`).all(likeTyped) as {
        v: string
        c: number
      }[]
    )
  const fixed: Record<string, string[]> = {
    flag: ['pick', 'reject', 'none'],
    label: ['red', 'yellow', 'green', 'blue', 'purple', 'none'],
    orientation: ['landscape', 'portrait', 'square'],
    type: ['raw', 'jpeg', 'heic', 'png', 'tiff', 'dng', 'webp'],
    has: ['gps', 'keywords', 'title', 'caption', 'rating', 'label', 'flag', 'album'],
    is: ['offline', 'online', 'raw', 'pick', 'reject', 'unrated'],
    rating: ['>=1', '>=2', '>=3', '>=4', '5', '0']
  }
  if (fixed[key])
    return fixed[key].filter((v) => v.startsWith(typed.toLowerCase())).map((v) => ({ value: `${neg}${field}:${v}`, label: v, kind: 'value' }))
  if (key === 'year' || key === 'date')
    return mk(
      db.prepare(`SELECT substr(taken_day, 1, 4) AS v, COUNT(*) AS c FROM photos WHERE taken_day IS NOT NULL GROUP BY v ORDER BY v DESC LIMIT 30`).all() as {
        v: string
        c: number
      }[]
    ).filter((s) => String(s.label).startsWith(typed))
  if (FIELDS[key]) return []
  return mk(
    db
      .prepare(`SELECT value AS v, COUNT(*) AS c FROM metadata WHERE key = ? AND value LIKE ? ESCAPE '\\' GROUP BY value ORDER BY c DESC LIMIT 12`)
      .all(field, likeTyped) as { v: string; c: number }[]
  )
}
