// Justified-row layout: every photo keeps its aspect ratio, and each full row exactly fills the width.

export const GAP = 4

export interface RowItem {
  index: number
  width: number
}

export type LayoutRow =
  | { kind: 'header'; key: string; label: string; day: string; count: number; height: number; firstIndex: number }
  | { kind: 'row'; key: string; items: RowItem[]; height: number; firstIndex: number }

/** Packs aspect ratios into rows of roughly `target` height. The last row keeps the target height (left-aligned). */
export function packRows(aspects: number[], start: number, end: number, width: number, target: number): { items: RowItem[]; height: number }[] {
  const rows: { items: RowItem[]; height: number }[] = []
  let i = start
  while (i < end) {
    let sum = 0
    let j = i
    // Add photos until the row at target height would overflow the width.
    while (j < end) {
      const a = clampAspect(aspects[j])
      const gaps = (j - i) * GAP
      if (j > i && (sum + a) * target + gaps > width) break
      sum += a
      j++
    }
    const gaps = (j - i - 1) * GAP
    const full = j < end || (sum * target + gaps) / width > 0.8
    const height = full ? Math.min((width - gaps) / sum, target * 1.6) : target
    rows.push({ items: Array.from({ length: j - i }, (_, k) => ({ index: i + k, width: clampAspect(aspects[i + k]) * height })), height })
    i = j
  }
  return rows
}

/** Very wide panoramas and slivers are clamped so they don't produce unusable rows. */
const clampAspect = (a: number): number => Math.min(4, Math.max(0.4, a || 1.5))

export function buildLayout(opts: {
  aspects: number[]
  days: (string | null)[]
  width: number
  target: number
  groupByMonth: boolean
  monthLabel: (day: string) => string
}): LayoutRow[] {
  const { aspects, days, width, target } = opts
  const out: LayoutRow[] = []
  if (width <= 0 || !aspects.length) return out
  if (!opts.groupByMonth) {
    for (const [k, r] of packRows(aspects, 0, aspects.length, width, target).entries())
      out.push({ kind: 'row', key: `r${k}`, items: r.items, height: r.height, firstIndex: r.items[0].index })
    return out
  }
  let start = 0
  while (start < aspects.length) {
    const month = days[start]?.slice(0, 7) ?? ''
    let end = start + 1
    while (end < aspects.length && (days[end]?.slice(0, 7) ?? '') === month) end++
    out.push({
      kind: 'header',
      key: `h${start}`,
      label: month ? opts.monthLabel(`${month}-01`) : 'Date unknown',
      day: month,
      count: end - start,
      height: 64,
      firstIndex: start
    })
    for (const r of packRows(aspects, start, end, width, target)) out.push({ kind: 'row', key: `r${r.items[0].index}`, items: r.items, height: r.height, firstIndex: r.items[0].index })
    start = end
  }
  return out
}
