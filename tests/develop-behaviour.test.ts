// How the controls feel: each one moves the picture the way its name and colour track say.
import { describe, it, expect } from 'vitest'
import { defaultSettings, type DevelopSettings } from '../src/shared/develop/settings'
import { prepare, renderReference, type Image3 } from '../src/shared/develop/pipeline'
import { cameraMultipliers, cameraTempTint, type CameraColor } from '../src/shared/develop/color'

// A grey card (sRGB 0.46) with a small bright patch in a dark surround.
function scene(): Image3 {
  const w = 64
  const h = 64
  const data = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = x < 16 ? 0.46 : x >= 40 && x < 44 && y >= 30 && y < 34 ? 0.97 : 0.08
      data.set([v, v, v], (y * w + x) * 3)
    }
  return { width: w, height: h, data }
}
const render = (s: DevelopSettings): Image3 => renderReference(prepare(s, { kind: 'display', fullWidth: 64 }), scene())
const px = (img: Image3, x: number, y: number): number[] => Array.from(img.data.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3))
const set = (f: (s: DevelopSettings) => void): DevelopSettings => {
  const s = defaultSettings('display')
  f(s)
  return s
}

describe('controls move the picture the way they say', () => {
  it('tint: positive is magenta, negative green (display files)', () => {
    const [r, g, b] = px(render(set((s) => (s.wb = { mode: 'custom', temp: 0, tint: 50 }))), 4, 4)
    expect(g).toBeLessThan(r)
    expect(g).toBeLessThan(b)
    const [r2, g2] = px(render(set((s) => (s.wb = { mode: 'custom', temp: 0, tint: -50 }))), 4, 4)
    expect(g2).toBeGreaterThan(r2)
  })

  it('temperature: positive is warmer', () => {
    const [r, , b] = px(render(set((s) => (s.wb = { mode: 'custom', temp: 50, tint: 0 }))), 4, 4)
    expect(r).toBeGreaterThan(b)
  })

  it('tint: positive is magenta for raw files too', () => {
    // A camera whose matrix is the identity on XYZ, so multipliers follow the white directly.
    const cam: CameraColor = { camXyz: [1, 0, 0, 0, 1, 0, 0, 0, 1], rgbCam: [1, 0, 0, 0, 1, 0, 0, 0, 1], asShot: [1, 1, 1] }
    const plain = cameraMultipliers(cam, 5500, 0)
    const magenta = cameraMultipliers(cam, 5500, 40)
    // More magenta: red and blue gains up relative to green.
    expect(magenta[0]).toBeGreaterThan(plain[0])
    expect(magenta[2]).toBeGreaterThan(plain[2])
    expect(cameraTempTint(cam, magenta).tint).toBeCloseTo(40, 0)
  })

  it('highlights reach a small bright patch in a dark photo; shadows lift the dark surround', () => {
    const base = render(defaultSettings('display'))
    const hi = render(set((s) => (s.highlights = -100)))
    expect(px(hi, 41, 31)[0]).toBeLessThan(px(base, 41, 31)[0] - 0.05)
    // The dark surround is left alone by Highlights.
    expect(Math.abs(px(hi, 60, 60)[0] - px(base, 60, 60)[0])).toBeLessThan(0.01)
    const sh = render(set((s) => (s.shadows = 100)))
    expect(px(sh, 60, 60)[0]).toBeGreaterThan(px(base, 60, 60)[0] + 0.05)
  })

  it('each tone slider changes the picture in its direction', () => {
    const base = render(defaultSettings('display'))
    const mean = (img: Image3): number => img.data.reduce((a, v) => a + v, 0) / img.data.length
    for (const k of ['exposure', 'whites', 'blacks', 'shadows'] as const) {
      const up = render(set((s) => (s[k] = k === 'exposure' ? 1 : 60)))
      const down = render(set((s) => (s[k] = k === 'exposure' ? -1 : -60)))
      expect(mean(up), k).toBeGreaterThan(mean(base))
      expect(mean(down), k).toBeLessThan(mean(base))
    }
  })
})

describe('highlights and shadows stay monotonic', () => {
  it('a brighter pixel never ends up darker, at full strength', () => {
    const w = 256
    const data = new Float32Array(w * 3)
    for (let x = 0; x < w; x++) data.fill(x / (w - 1), x * 3, x * 3 + 3)
    for (const f of [(s: DevelopSettings) => (s.highlights = -100), (s: DevelopSettings) => (s.shadows = 100), (s: DevelopSettings) => ((s.highlights = 100), (s.shadows = -100))]) {
      const s = defaultSettings('display')
      f(s)
      const out = renderReference(prepare(s, { kind: 'display', fullWidth: w }), { width: w, height: 1, data })
      for (let x = 1; x < w; x++) expect(out.data[x * 3 + 1]).toBeGreaterThanOrEqual(out.data[(x - 1) * 3 + 1] - 1e-4)
    }
  })
})
