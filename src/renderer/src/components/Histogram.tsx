import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { api } from '../api'
import type { Histogram as HistogramData } from '../../../shared/types'

const W = 256
const H = 80

/** An area path for 256 bins, scaled so the tallest bin (ignoring the clipped ends, which can dwarf the rest) fills it. */
function area(bins: number[], peak: number): string {
  let d = `M0 ${H}`
  for (let i = 0; i < 256; i++) d += ` L${i} ${(H - Math.min(1, bins[i] / peak) * H).toFixed(1)}`
  return `${d} L${W - 1} ${H} Z`
}

const pct = (x: number): string => (x < 0.001 ? '0%' : x < 0.01 ? '<1%' : `${Math.round(x * 100)}%`)

/** RGB histogram of the photo as shown, with luminance behind it and clipping warnings, like an editor's. */
export function Histogram({ id, rev }: { id: number; rev: number }) {
  const [h, setH] = useState<HistogramData | null>(null)
  useEffect(() => {
    let live = true
    void api.histogram(id).then((r) => live && setH(r))
    return () => {
      live = false
    }
  }, [id, rev])
  if (!h) return <div className="h-[104px] rounded-md bg-black/30" aria-hidden />
  const inner = (b: number[]): number => Math.max(...b.slice(1, 255))
  const peak = Math.max(inner(h.r), inner(h.g), inner(h.b), inner(h.l)) || 1
  const clipWarn = 0.005
  return (
    <figure aria-label="Histogram" className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-md bg-black/40">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full" role="img" aria-label={`Histogram, average brightness ${Math.round((h.mean / 255) * 100)}%`}>
          <path d={area(h.l, peak)} fill="rgb(255 255 255 / 0.16)" />
          <g style={{ mixBlendMode: 'screen' }}>
            <path d={area(h.r, peak)} fill="rgb(255 70 70 / 0.55)" />
            <path d={area(h.g, peak)} fill="rgb(70 230 110 / 0.55)" />
            <path d={area(h.b, peak)} fill="rgb(80 140 255 / 0.55)" />
          </g>
          {[64, 128, 192].map((x) => (
            <line key={x} x1={x} x2={x} y1={0} y2={H} stroke="rgb(255 255 255 / 0.08)" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span
          className={cn('absolute top-1 left-1 size-2 rounded-full', h.shadowClip > clipWarn ? 'bg-sky-400' : 'bg-white/15')}
          title={`Shadow clipping: ${pct(h.shadowClip)} of pixels`}
          aria-hidden
        />
        <span
          className={cn('absolute top-1 right-1 size-2 rounded-full', h.highlightClip > clipWarn ? 'bg-red-400' : 'bg-white/15')}
          title={`Highlight clipping: ${pct(h.highlightClip)} of pixels`}
          aria-hidden
        />
      </div>
      <figcaption className="tnum flex justify-between text-[11px] text-ink-muted">
        <span className={cn(h.shadowClip > clipWarn && 'text-sky-300')}>Shadows clipped {pct(h.shadowClip)}</span>
        <span>Average {Math.round((h.mean / 255) * 100)}%</span>
        <span className={cn(h.highlightClip > clipWarn && 'text-red-300')}>Highlights clipped {pct(h.highlightClip)}</span>
      </figcaption>
    </figure>
  )
}
