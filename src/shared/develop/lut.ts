// LUTs: .cube (Adobe/Resolve Cube: 1D, 3D, or a 1D shaper followed by a 3D table) and .3dl (Lustre/Flame: integer
// tables after a row of input mesh points). Parsed into float tables; applied with tetrahedral interpolation, as
// colour tools commonly do (the GPU does the same).

export interface Lut {
  title: string
  /** 3D table size N (N³ entries), or 0 when there's only a 1D table. */
  size: number
  /** 3D entries, RGB, red changing fastest: index = r + g·N + b·N². */
  data: Float32Array
  domainMin: [number, number, number]
  domainMax: [number, number, number]
  /** A 1D table applied first (a "shaper", or the whole LUT when there's no 3D table). */
  shaper: { size: number; data: Float32Array; min: number; max: number } | null
  /** Notes for the import report, e.g. what the file contained. */
  notes: string[]
}

const nums = (line: string): number[] => line.trim().split(/\s+/).map(Number)

export function parseCube(text: string): Lut {
  let title = ''
  let size3 = 0
  let size1 = 0
  let min: [number, number, number] = [0, 0, 0]
  let max: [number, number, number] = [1, 1, 1]
  let range1: [number, number] | null = null
  const rows: number[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) continue
    const key = line.split(/\s+/)[0].toUpperCase()
    if (key === 'TITLE') title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '')
    else if (key === 'LUT_3D_SIZE') size3 = Number(line.split(/\s+/)[1])
    else if (key === 'LUT_1D_SIZE') size1 = Number(line.split(/\s+/)[1])
    else if (key === 'DOMAIN_MIN') min = nums(line.slice(10)).slice(0, 3) as [number, number, number]
    else if (key === 'DOMAIN_MAX') max = nums(line.slice(10)).slice(0, 3) as [number, number, number]
    else if (key === 'LUT_1D_INPUT_RANGE') range1 = nums(line.slice(18)).slice(0, 2) as [number, number]
    else if (key === 'LUT_3D_INPUT_RANGE') {
      const r = nums(line.slice(18))
      min = [r[0], r[0], r[0]]
      max = [r[1], r[1], r[1]]
    } else if (/^[-+.\deE]/.test(line)) {
      const v = nums(line)
      if (v.length >= 3 && v.every((x) => Number.isFinite(x))) rows.push(v.slice(0, 3))
    }
  }
  if (!size3 && !size1) throw new Error('This .cube file has no LUT_3D_SIZE or LUT_1D_SIZE.')
  if (size3 && (size3 < 2 || size3 > 256)) throw new Error(`Unsupported 3D LUT size ${size3}.`)
  const want = size1 + size3 ** 3
  if (rows.length < want) throw new Error(`This .cube file is incomplete: ${rows.length} of ${want} rows.`)
  const notes: string[] = []
  let shaper: Lut['shaper'] = null
  if (size1) {
    const d = new Float32Array(size1 * 3)
    rows.slice(0, size1).forEach((r, i) => d.set(r, i * 3))
    const [lo, hi] = range1 ?? (size3 ? [0, 1] : [min[0], max[0]])
    shaper = { size: size1, data: d, min: lo, max: hi }
    notes.push(size3 ? `1D shaper (${size1} entries) and a ${size3}³ table` : `1D LUT (${size1} entries)`)
  } else notes.push(`3D LUT, ${size3}³`)
  const data = new Float32Array(size3 ** 3 * 3)
  rows.slice(size1, size1 + size3 ** 3).forEach((r, i) => data.set(r, i * 3))
  return { title, size: size3, data, domainMin: size3 ? min : [0, 0, 0], domainMax: size3 ? max : [1, 1, 1], shaper, notes }
}

export function parse3dl(text: string): Lut {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l && /^[-+\d.]/.test(l))
  if (lines.length < 2) throw new Error('This .3dl file is empty.')
  // The first row lists the input mesh points (e.g. 0 64 128 … 1023), which gives the table size.
  const mesh = nums(lines[0])
  const n = mesh.length
  if (n < 2 || lines.length - 1 < n ** 3) throw new Error(`This .3dl file is incomplete: ${lines.length - 1} of ${n ** 3} rows.`)
  const rows = lines.slice(1, 1 + n ** 3).map(nums)
  const peak = rows.reduce((m, r) => Math.max(m, r[0], r[1], r[2]), 0)
  const scale = peak > 4095 ? 65535 : peak > 1023 ? 4095 : 1023
  // .3dl lists blue fastest (r, then g, then b): reorder to red fastest.
  const data = new Float32Array(n ** 3 * 3)
  let i = 0
  for (let r = 0; r < n; r++)
    for (let g = 0; g < n; g++)
      for (let b = 0; b < n; b++) {
        const v = rows[i++]
        data.set([v[0] / scale, v[1] / scale, v[2] / scale], (r + g * n + b * n * n) * 3)
      }
  const bits = scale === 65535 ? 16 : scale === 4095 ? 12 : 10
  return { title: '', size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1], shaper: null, notes: [`3D LUT, ${n}³, ${bits}-bit`] }
}

export function parseLut(name: string, text: string): Lut {
  if (/\.3dl$/i.test(name)) return parse3dl(text)
  if (/\.cube$/i.test(name)) return parseCube(text)
  throw new Error('Glimmr reads .cube and .3dl LUTs.')
}

function apply1D(s: NonNullable<Lut['shaper']>, c: [number, number, number]): [number, number, number] {
  return c.map((v, k) => {
    const f = Math.min(1, Math.max(0, (v - s.min) / (s.max - s.min))) * (s.size - 1)
    const i = Math.floor(f)
    const j = Math.min(s.size - 1, i + 1)
    const t = f - i
    return s.data[i * 3 + k] * (1 - t) + s.data[j * 3 + k] * t
  }) as [number, number, number]
}

/** Applies a LUT to one colour (in the LUT's input encoding), with tetrahedral interpolation. */
export function applyLut(lut: Lut, input: [number, number, number]): [number, number, number] {
  let c = input
  if (lut.shaper) c = apply1D(lut.shaper, c)
  if (!lut.size) return c
  const N = lut.size
  const at = (r: number, g: number, b: number): [number, number, number] => {
    const o = (r + g * N + b * N * N) * 3
    return [lut.data[o], lut.data[o + 1], lut.data[o + 2]]
  }
  const f = c.map((v, k) => Math.min(1, Math.max(0, (v - lut.domainMin[k]) / (lut.domainMax[k] - lut.domainMin[k]))) * (N - 1))
  const i = f.map((v) => Math.min(N - 2, Math.floor(v)))
  const [fr, fg, fb] = f.map((v, k) => v - i[k])
  const [r0, g0, b0] = i
  const c000 = at(r0, g0, b0)
  const c111 = at(r0 + 1, g0 + 1, b0 + 1)
  // The cube is split into six tetrahedra by the order of the fractions.
  const mix = (a: [number, number, number], b: [number, number, number], cc: [number, number, number], d: [number, number, number], wa: number, wb: number, wc: number, wd: number): [number, number, number] =>
    [0, 1, 2].map((k) => a[k] * wa + b[k] * wb + cc[k] * wc + d[k] * wd) as [number, number, number]
  if (fr > fg) {
    if (fg > fb) return mix(c000, at(r0 + 1, g0, b0), at(r0 + 1, g0 + 1, b0), c111, 1 - fr, fr - fg, fg - fb, fb)
    if (fr > fb) return mix(c000, at(r0 + 1, g0, b0), at(r0 + 1, g0, b0 + 1), c111, 1 - fr, fr - fb, fb - fg, fg)
    return mix(c000, at(r0, g0, b0 + 1), at(r0 + 1, g0, b0 + 1), c111, 1 - fb, fb - fr, fr - fg, fg)
  }
  if (fb > fg) return mix(c000, at(r0, g0, b0 + 1), at(r0, g0 + 1, b0 + 1), c111, 1 - fb, fb - fg, fg - fr, fr)
  if (fb > fr) return mix(c000, at(r0, g0 + 1, b0), at(r0, g0 + 1, b0 + 1), c111, 1 - fg, fg - fb, fb - fr, fr)
  return mix(c000, at(r0, g0 + 1, b0), at(r0 + 1, g0 + 1, b0), c111, 1 - fg, fg - fr, fr - fb, fb)
}

/** Writes a 3D LUT as .cube text. */
export function writeCube(title: string, size: number, fn: (r: number, g: number, b: number) => [number, number, number]): string {
  const out = [`TITLE "${title.replace(/"/g, "'")}"`, '# Made with Glimmr', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1']
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const v = fn(r / (size - 1), g / (size - 1), b / (size - 1))
        out.push(v.map((x) => Math.min(1, Math.max(0, x)).toFixed(6)).join(' '))
      }
  return out.join('\n') + '\n'
}

/** LUT bytes for the catalog: a small header and the tables, so it can be stored as a blob and loaded without parsing. */
export function packLut(l: Lut): Uint8Array {
  const head = JSON.stringify({ title: l.title, size: l.size, domainMin: l.domainMin, domainMax: l.domainMax, shaper: l.shaper ? { size: l.shaper.size, min: l.shaper.min, max: l.shaper.max } : null, notes: l.notes })
  const h = new TextEncoder().encode(head)
  const sh = l.shaper?.data ?? new Float32Array(0)
  const buf = new Uint8Array(4 + h.length + sh.byteLength + l.data.byteLength)
  new DataView(buf.buffer).setUint32(0, h.length, true)
  buf.set(h, 4)
  buf.set(new Uint8Array(sh.buffer, sh.byteOffset, sh.byteLength), 4 + h.length)
  buf.set(new Uint8Array(l.data.buffer, l.data.byteOffset, l.data.byteLength), 4 + h.length + sh.byteLength)
  return buf
}

export function unpackLut(buf: Uint8Array): Lut {
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n))) as Omit<Lut, 'data' | 'shaper'> & { shaper: { size: number; min: number; max: number } | null }
  const rest = buf.slice(4 + n)
  const floats = new Float32Array(rest.buffer, rest.byteOffset, rest.byteLength / 4)
  const shLen = head.shaper ? head.shaper.size * 3 : 0
  return {
    ...head,
    shaper: head.shaper ? { ...head.shaper, data: floats.slice(0, shLen) } : null,
    data: floats.slice(shLen)
  }
}
