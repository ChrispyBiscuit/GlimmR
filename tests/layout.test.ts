import { describe, it, expect } from 'vitest'
import { buildLayout, packRows, GAP } from '../src/renderer/src/layout'

describe('justified layout', () => {
  it('fills full rows exactly and keeps aspect ratios', () => {
    const aspects = [1.5, 0.667, 1.5, 1, 1.78, 1.5, 0.75, 1.5, 1.5]
    const rows = packRows(aspects, 0, aspects.length, 1000, 200)
    for (const r of rows.slice(0, -1)) {
      const used = r.items.reduce((s, it) => s + it.width, 0) + (r.items.length - 1) * GAP
      expect(used).toBeCloseTo(1000, 3)
      for (const it of r.items) expect(it.width / r.height).toBeCloseTo(aspects[it.index], 3)
    }
    expect(rows.flatMap((r) => r.items.map((i) => i.index))).toEqual(aspects.map((_, i) => i))
  })

  it('leaves a short last row at the target height', () => {
    const rows = packRows([1.5, 1.5, 1.5, 1.5, 1.5], 0, 5, 1000, 200)
    expect(rows.at(-1)!.height).toBe(200)
  })

  it('groups by month with headers', () => {
    const layout = buildLayout({
      aspects: [1.5, 1.5, 1.5],
      days: ['2023-10-26', '2023-10-01', '2019-05-14'],
      width: 1000,
      target: 200,
      groupByMonth: true,
      monthLabel: (d) => d.slice(0, 7)
    })
    expect(layout.filter((r) => r.kind === 'header').map((r) => (r as { label: string }).label)).toEqual(['2023-10', '2019-05'])
    expect(layout.map((r) => r.kind)).toEqual(['header', 'row', 'header', 'row'])
  })
})
