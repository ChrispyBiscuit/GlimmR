import { describe, it, expect } from 'vitest'
import { clampView, fitScale, fromSlider, MAX_SCALE, toSlider, zoomAt } from '../src/renderer/src/zoom'

const img = { w: 6000, h: 4000 }
const stage = { w: 1200, h: 800 }

describe('viewer zoom', () => {
  it('fits without enlarging small images', () => {
    expect(fitScale(img, stage)).toBeCloseTo(0.2)
    expect(fitScale({ w: 300, h: 200 }, stage)).toBe(1)
  })

  it('keeps the point under the cursor fixed while zooming', () => {
    const v = { scale: 0.2, x: 0, y: 0 }
    const next = zoomAt(v, 1, 300, -100, img, stage)
    // Image point under the cursor before and after: (p - offset) / scale.
    expect((300 - next.x) / next.scale).toBeCloseTo((300 - v.x) / v.scale)
    expect((-100 - next.y) / next.scale).toBeCloseTo((-100 - v.y) / v.scale)
  })

  it('stops panning at the image edges', () => {
    expect(clampView({ scale: 1, x: 99999, y: -99999 }, img, stage)).toEqual({ scale: 1, x: 2400, y: -1600 })
    // Smaller than the stage: stays inside it.
    expect(clampView({ scale: 0.1, x: 500, y: 0 }, img, stage).x).toBe(300)
  })

  it('maps the slider both ways on a log scale', () => {
    expect(toSlider(0.2, 0.2)).toBe(0)
    expect(toSlider(MAX_SCALE, 0.2)).toBeCloseTo(100)
    expect(fromSlider(toSlider(1, 0.2), 0.2)).toBeCloseTo(1)
  })
})
