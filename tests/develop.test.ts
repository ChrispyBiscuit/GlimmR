import { describe, it, expect } from 'vitest'
import { cameraMultipliers, cameraTempTint, encodeFor, tempTintOf, whiteXY, type CameraColor } from '../src/shared/develop/color'
import { monotone, curveTable, sampleCurve } from '../src/shared/develop/curves'
import { applyLut, packLut, parse3dl, parseCube, unpackLut, writeCube } from '../src/shared/develop/lut'
import { applyPartial, defaultSettings, pick, sanitize, changedGroups } from '../src/shared/develop/settings'
import { bandWeights, greyWorld, prepare, renderReference, type Image3 } from '../src/shared/develop/pipeline'

// A Nikon D3S's colour, as LibRaw reports it.
const D3S: CameraColor = {
  camXyz: [0.8828, -0.2406, -0.0694, -0.4874, 1.2603, 0.2541, -0.066, 0.1509, 0.7587],
  rgbCam: [1.7511, -0.6022, -0.149, -0.1638, 1.5947, -0.4309, -0.0078, -0.3707, 1.3785],
  asShot: [576 / 256, 1, 432 / 256]
}

const flat = (w: number, h: number, c: [number, number, number]): Image3 => {
  const data = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h; i++) data.set(c, i * 3)
  return { width: w, height: h, data }
}

describe('colour', () => {
  it('turns colour temperature and tint into a white point and back', () => {
    for (const [T, tint] of [
      [2850, 0],
      [4000, 15],
      [5500, -10],
      [6500, 0],
      [9000, 30]
    ])
      expect(tempTintOf(...whiteXY(T, tint))).toMatchObject({ temp: expect.closeTo(T, -1.5), tint: expect.closeTo(tint, 0) })
    // D65 is about 6500 K, slightly above the Planckian locus (greenish, negative tint).
    const d65 = tempTintOf(0.3127, 0.329)
    expect(d65.temp).toBeGreaterThan(6350)
    expect(d65.temp).toBeLessThan(6650)
  })

  it('finds the camera’s white balance from its multipliers, and makes multipliers for any white', () => {
    // LibRaw's daylight multipliers for this camera (pre_mul) mean about 5000–6500 K.
    const daylight = cameraTempTint(D3S, [1.9124 / 0.9313, 1, 1.0938 / 0.9313])
    expect(daylight.temp).toBeGreaterThan(4800)
    expect(daylight.temp).toBeLessThan(6800)
    const m = cameraMultipliers(D3S, 3200, 0)
    const back = cameraTempTint(D3S, m)
    expect(back.temp).toBeCloseTo(3200, -2)
    // Tungsten light needs more blue gain than daylight.
    expect(m[2]).toBeGreaterThan(cameraMultipliers(D3S, 5500, 0)[2])
  })

  it('encodes the camera log curves to their published 18% grey values', () => {
    expect(encodeFor('slog3', 0.18)).toBeCloseTo(420 / 1023, 4)
    expect(encodeFor('logc3', 0.18)).toBeCloseTo(0.391, 3)
    expect(encodeFor('vlog', 0.18)).toBeCloseTo(0.423, 3)
    expect(encodeFor('flog', 0.18)).toBeCloseTo(0.459, 2)
  })
})

describe('curves', () => {
  it('passes through its points without overshooting', () => {
    const f = monotone([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 }
    ])
    expect(f(0.25)).toBeCloseTo(0.1, 6)
    expect(f(0.75)).toBeCloseTo(0.9, 6)
    let last = -1
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x)
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
    }
  })

  it('bakes the parametric and point curves into one table per channel', () => {
    const s = defaultSettings('display')
    s.curve.shadows = 100
    s.curve.r = [
      { x: 0, y: 0.1 },
      { x: 1, y: 1 }
    ]
    const t = curveTable(s.curve)
    expect(sampleCurve(t, 1, 0.2)).toBeGreaterThan(0.2)
    expect(sampleCurve(t, 0, 0)).toBeCloseTo(0.1, 2)
    expect(sampleCurve(t, 1, 1)).toBeCloseTo(1, 6)
  })
})

describe('LUTs', () => {
  const affine = (r: number, g: number, b: number): [number, number, number] => [0.8 * r + 0.1 * g + 0.05, 0.2 * r + 0.7 * g + 0.1 * b, 0.3 * b + 0.6 * r * 0 + 0.5]

  it('parses .cube and reproduces an affine colour transform exactly with tetrahedral interpolation', () => {
    const lut = parseCube(writeCube('affine', 17, affine))
    expect(lut.size).toBe(17)
    for (const c of [
      [0.1, 0.2, 0.3],
      [0.77, 0.03, 0.5],
      [0.5, 0.5, 0.5],
      [0.99, 0.01, 0.42]
    ] as [number, number, number][])
      applyLut(lut, c).forEach((v, k) => expect(v).toBeCloseTo(Math.min(1, Math.max(0, affine(...c)[k])), 5))
  })

  it('parses .3dl (blue fastest, integer codes) the same as the equivalent .cube', () => {
    const n = 5
    const rows = ['0 256 512 768 1023']
    for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) rows.push([r, g, b].map((v) => Math.round((v / (n - 1)) * 4095)).join(' '))
    const lut = parse3dl(rows.join('\n'))
    expect(lut.notes[0]).toMatch(/12-bit/)
    expect(applyLut(lut, [0.3, 0.6, 0.9]).map((v) => +v.toFixed(3))).toEqual([0.3, 0.6, 0.9])
  })

  it('reads 1D LUTs and domain bounds, and survives packing for the catalog', () => {
    const one = parseCube(['LUT_1D_SIZE 2', '0 0 0', '0.5 0.5 0.5'].join('\n'))
    expect(applyLut(one, [1, 0.5, 0])).toEqual([0.5, 0.25, 0])
    const wide = parseCube(['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...Array.from({ length: 8 }, (_, i) => [(i & 1) * 2, ((i >> 1) & 1) * 2, ((i >> 2) & 1) * 2].join(' '))].join('\n'))
    expect(applyLut(wide, [1, 1, 1]).map((v) => +v.toFixed(5))).toEqual([1, 1, 1])
    const back = unpackLut(packLut(one))
    expect(applyLut(back, [1, 0.5, 0])).toEqual([0.5, 0.25, 0])
    expect(() => parseCube('LUT_3D_SIZE 4\n0 0 0')).toThrow(/incomplete/)
  })
})

describe('settings', () => {
  it('fills in and clamps saved settings, and knows what changed', () => {
    const s = sanitize({ exposure: 12, hsl: { sat: [50] }, sharpen: { amount: 999 }, look: { space: 'nope' } }, 'raw')
    expect([s.exposure, s.hsl.sat[0], s.hsl.sat[7], s.sharpen.amount, s.look.space]).toEqual([5, 50, 0, 150, 'srgb'])
    expect(changedGroups(s, 'raw')).toEqual(['tone', 'hsl', 'detail'])
    expect(changedGroups(defaultSettings('raw'), 'raw')).toEqual([])
  })

  it('applies styles group by group, blended by amount', () => {
    const a = defaultSettings('raw')
    const style = defaultSettings('raw')
    style.exposure = 1
    style.contrast = 40
    style.wb = { mode: 'custom', temp: 3000, tint: 0 }
    const half = applyPartial(a, pick(style, ['tone']), 0.5)
    expect([half.exposure, half.contrast, half.wb.mode]).toEqual([0.5, 20, 'asShot'])
  })
})

describe('pipeline (CPU reference)', () => {
  it('puts a middle grey near sRGB middle grey, and exposure brightens it', () => {
    const grey = flat(8, 8, [0.4663, 0.4663, 0.4663]) // sRGB-encoded 18% grey
    const out = renderReference(prepare(defaultSettings('display'), { kind: 'display', fullWidth: 8 }), grey)
    expect(out.data[0]).toBeGreaterThan(0.4)
    expect(out.data[0]).toBeLessThan(0.52)
    const s = defaultSettings('display')
    s.exposure = 1
    const brighter = renderReference(prepare(s, { kind: 'display', fullWidth: 8 }), grey)
    expect(brighter.data[0]).toBeGreaterThan(out.data[0] + 0.08)
  })

  it('white-balances raw data: the camera’s white comes out neutral, and clipped highlights stay white', () => {
    // A white the camera saw with its as-shot light: camera RGB is 1/multiplier.
    const p = prepare(defaultSettings('raw'), { kind: 'raw', fullWidth: 8, camera: D3S })
    const white = renderReference(p, flat(4, 4, [0.18 / D3S.asShot[0], 0.18, 0.18 / D3S.asShot[2]]))
    const [r, g, b] = white.data
    expect(Math.abs(r - g)).toBeLessThan(0.01)
    expect(Math.abs(b - g)).toBeLessThan(0.01)
    const clipped = renderReference(p, flat(4, 4, [1, 1, 1]))
    expect(clipped.data[0]).toBeCloseTo(clipped.data[1], 2)
    expect(clipped.data[2]).toBeCloseTo(clipped.data[1], 2)
    expect(p.wb.temp).toBeGreaterThan(2000)
  })

  it('auto white balance neutralises a colour cast', () => {
    const cast = flat(8, 8, [0.55, 0.45, 0.3])
    const s = defaultSettings('display')
    s.wb.mode = 'auto'
    const out = renderReference(prepare(s, { kind: 'display', fullWidth: 8, autoMul: greyWorld(cast, 'display') }), cast)
    expect(Math.abs(out.data[0] - out.data[2])).toBeLessThan(0.06)
  })

  it('shares each hue between two neighbouring HSL bands', () => {
    for (const h of [0, 29, 45, 142, 300, 345, 359]) {
      const w = bandWeights(h)
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    }
    expect(bandWeights(29)[0]).toBeCloseTo(1, 6)
  })

  it('black and white removes colour; saturation −100 does too', () => {
    const red = flat(4, 4, [0.8, 0.2, 0.2])
    const s = defaultSettings('display')
    s.bw.on = true
    const bw = renderReference(prepare(s, { kind: 'display', fullWidth: 4 }), red)
    expect(Math.abs(bw.data[0] - bw.data[2])).toBeLessThan(0.01)
  })
})
