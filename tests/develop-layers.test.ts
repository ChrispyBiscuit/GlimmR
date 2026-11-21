import { describe, it, expect } from 'vitest'
import { dabsOf, linearAlpha, localAt, maskAt, newLayer, prepareLayer, prepareLayers, radialAlpha, sanitizeLayers, wbShift, type BrushStroke } from '../src/shared/develop/layers'
import { defaultSettings, sanitize } from '../src/shared/develop/settings'
import { prepare, renderReference } from '../src/shared/develop/pipeline'

const luma = (m: number[]): number => 0.2627 * m[0] + 0.678 * m[1] + 0.0593 * m[2]

describe('layers', () => {
  it('sanitizes stored layers', () => {
    const s = sanitize({ layers: [{ name: 'Sky', opacity: 3, adjust: { exposure: 9 }, mask: { shapes: [{ kind: 'linear', x0: 0.5, y0: 0, x1: 0.5, y1: 1 }, { kind: 'bogus' }, { kind: 'brush', points: [0.1] }] } }] }, 'display')
    expect(s.layers).toHaveLength(1)
    expect(s.layers[0].opacity).toBe(1)
    expect(s.layers[0].adjust.exposure).toBe(4)
    expect(s.layers[0].mask.shapes).toHaveLength(1)
    expect(sanitizeLayers('nope')).toEqual([])
    expect(defaultSettings('raw').layers).toEqual([])
  })

  it('evaluates gradients', () => {
    const lin = { kind: 'linear' as const, x0: 0.5, y0: 0, x1: 0.5, y1: 0.5 }
    expect(linearAlpha(lin, 1, 1, 0.3, 0)).toBeCloseTo(1)
    expect(linearAlpha(lin, 1, 1, 0.3, 0.25)).toBeCloseTo(0.5)
    expect(linearAlpha(lin, 1, 1, 0.3, 0.8)).toBe(0)
    const rad = { kind: 'radial' as const, cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1, angle: 0, feather: 0, invert: false }
    expect(radialAlpha(rad, 1, 1, 0.5, 0.5)).toBe(1)
    expect(radialAlpha(rad, 1, 1, 0.65, 0.5)).toBe(1)
    expect(radialAlpha(rad, 1, 1, 0.5, 0.65)).toBe(0)
    expect(radialAlpha({ ...rad, invert: true }, 1, 1, 0.5, 0.65)).toBe(1)
  })

  it('spaces brush dabs evenly and erases in order', () => {
    const st: BrushStroke = { kind: 'brush', erase: false, size: 0.04, feather: 0, density: 1, points: [0.1, 0.5, 0.5, 0.5] }
    const d = dabsOf(st, 1, 1)
    expect(d.length / 2).toBeGreaterThan(35)
    for (let i = 2; i < d.length; i += 2) expect(d[i] - d[i - 2]).toBeCloseTo(0.01, 5)
    const l = newLayer('B', [st, { ...st, erase: true, points: [0.3, 0.5] }])
    l.adjust.exposure = 1
    const p = prepareLayer(l)
    expect(maskAt(p, 1, 1, 0.2, 0.5, 0.5)).toBe(1)
    expect(maskAt(p, 1, 1, 0.3, 0.5, 0.5)).toBe(0)
    // Painting again after erasing adds back.
    const again = prepareLayer({ ...l, mask: { ...l.mask, shapes: [...l.mask.shapes, { ...st, points: [0.3, 0.5] }] } })
    expect(maskAt(again, 1, 1, 0.3, 0.5, 0.5)).toBe(1)
  })

  it('applies range, invert and opacity, and sums layers', () => {
    const a = newLayer('A', [{ kind: 'linear', x0: 0, y0: 0, x1: 0, y1: 0.001 }])
    a.adjust = { ...a.adjust, exposure: 1, saturation: 50 }
    a.mask.invert = true
    a.opacity = 0.5
    a.mask.range = { on: true, lo: 0.5, hi: 1, feather: 0.05 }
    const b = newLayer('B', [{ kind: 'radial', cx: 0.5, cy: 0.5, rx: 1, ry: 1, angle: 0, feather: 0, invert: false }])
    b.adjust.exposure = -0.5
    const hidden = { ...newLayer('C'), visible: false, adjust: { ...b.adjust, exposure: 2 } }
    const empty = newLayer('D')
    const layers = prepareLayers([a, b, hidden, empty])
    expect(layers).toHaveLength(2)
    // Bright pixel at the bottom: A (inverted, so fully on) at half opacity, plus B.
    expect(localAt(layers, 1, 1, 0.5, 0.5, 0.9).exposure).toBeCloseTo(0.5 * 1 - 0.5)
    // Dark pixel: A's range excludes it, then the inversion turns it on.
    expect(localAt(layers, 1, 1, 0.5, 0.5, 0.1).exposure).toBeCloseTo(0.5 - 0.5)
  })

  it('keeps brightness when shifting white balance', () => {
    expect(luma(wbShift(0.7, -0.4))).toBeCloseTo(1)
    const warm = wbShift(1, 0)
    expect(warm[0]).toBeGreaterThan(warm[2])
  })

  it('renders a layer only where its mask is', () => {
    const w = 40
    const h = 20
    const data = new Float32Array(w * h * 3).fill(0.4)
    const s = defaultSettings('display')
    const l = newLayer('Right', [{ kind: 'linear', x0: 1, y0: 0.5, x1: 0.9, y1: 0.5 }])
    l.adjust.exposure = 1
    s.layers = [l]
    const out = renderReference(prepare(s, { kind: 'display', fullWidth: w }), { width: w, height: h, data })
    const base = renderReference(prepare(defaultSettings('display'), { kind: 'display', fullWidth: w }), { width: w, height: h, data })
    const at = (img: { data: Float32Array }, x: number): number => img.data[(10 * w + x) * 3]
    expect(at(out, 2)).toBeCloseTo(at(base, 2), 3)
    expect(at(out, 39)).toBeGreaterThan(at(base, 39) + 0.1)
  })
})
