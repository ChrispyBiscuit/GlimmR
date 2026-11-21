// Develop panel controls: collapsible sections, slider rows (double-click to reset, type a value) and the tone curve.

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import { Slider as SliderPrimitive } from 'radix-ui'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { monotone, parametric } from '../../../../shared/develop/curves'
import type { CurvePoint } from '../../../../shared/develop/settings'

export function Section({ title, open, onOpenChange, onReset, changed, children }: { title: string; open: boolean; onOpenChange: (o: boolean) => void; onReset?: () => void; changed?: boolean; children: ReactNode }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b border-white/10">
      <div className="flex items-center pr-2">
        <CollapsibleTrigger className="flex h-9 flex-1 items-center gap-1.5 px-3 text-left text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <ChevronRight className={cn('size-3.5 text-ink-muted transition-transform', open && 'rotate-90')} aria-hidden />
          {title}
          {changed && <span className="ml-1 size-1.5 rounded-full bg-ink/70" aria-label="(changed)" />}
        </CollapsibleTrigger>
        {onReset && changed && (
          <button type="button" className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink" onClick={onReset} aria-label={`Reset ${title}`} title={`Reset ${title}`}>
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** The value double-clicking resets to. */
  def?: number
  onChange: (v: number) => void
  /** End of a gesture (pointer up, key up): one history step. */
  onCommit: () => void
  format?: (v: number) => string
  /** Parses typed text back to a value (defaults to a number). */
  parse?: (t: string) => number
  /** Track background, e.g. a gradient for colour sliders. */
  track?: string
  disabled?: boolean
}

const defaultFormat = (v: number): string => (Math.abs(v) < 0.005 ? '0' : v > 0 ? `+${Number.isInteger(v) ? v : v.toFixed(2)}` : `${Number.isInteger(v) ? v : v.toFixed(2)}`)

export function SliderRow({ label, value, min, max, step = 1, def = 0, onChange, onCommit, format = defaultFormat, parse = Number, track, disabled }: SliderRowProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const origin = Math.min(max, Math.max(min, def))
  const pos = (v: number): number => ((v - min) / (max - min)) * 100
  const lo = Math.min(pos(origin), pos(value))
  const hi = Math.max(pos(origin), pos(value))
  const reset = (): void => {
    onChange(def)
    onCommit()
  }
  return (
    <div className={cn('grid grid-cols-[88px_minmax(0,1fr)_52px] items-center gap-2', disabled && 'opacity-50')}>
      <button type="button" className="truncate text-left text-[12px] text-ink-muted hover:text-ink" onDoubleClick={reset} title="Double-click to reset" disabled={disabled}>
        {label}
      </button>
      <SliderPrimitive.Root
        className="relative flex h-5 w-full touch-none items-center select-none"
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={() => onCommit()}
        onDoubleClick={reset}
      >
        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-white/15" style={track ? ({ background: track } as CSSProperties) : undefined}>
          {!track && <span className="absolute inset-y-0 bg-white/60" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb aria-label={label} className="block size-3 rounded-full border border-black/40 bg-white shadow outline-none focus-visible:ring-4 focus-visible:ring-ring/50" />
      </SliderPrimitive.Root>
      {editing != null ? (
        <input
          autoFocus
          className="tnum h-5 w-full rounded border border-white/20 bg-black/40 px-1 text-right text-[12px] outline-none"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => {
            const v = parse(editing)
            if (Number.isFinite(v)) {
              onChange(Math.min(max, Math.max(min, v)))
              onCommit()
            }
            setEditing(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(null)
            e.stopPropagation()
          }}
        />
      ) : (
        <button type="button" className="tnum truncate text-right text-[12px] text-ink-muted hover:text-ink" onClick={() => !disabled && setEditing(format(value).replace(/^\+/, '').replace(/[^\d.\-]/g, ''))} title="Click to type a value">
          {format(value)}
        </button>
      )}
    </div>
  )
}

// ---- tone curve ----

const SIZE = 220
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b'
const STROKE: Record<CurveChannel, string> = { rgb: 'rgb(255 255 255 / 0.9)', r: 'rgb(255 90 90)', g: 'rgb(90 220 120)', b: 'rgb(100 150 255)' }

/**
 * The point curve for one channel: click to add a point, drag to move it, double-click or drag it out to remove it.
 * The parametric curve is drawn faintly behind (it applies first).
 */
export function CurveEditor({
  points,
  channel,
  param,
  histogram,
  onChange,
  onCommit
}: {
  points: CurvePoint[]
  channel: CurveChannel
  param: Parameters<typeof parametric>[0]
  histogram?: number[] | null
  onChange: (p: CurvePoint[]) => void
  onCommit: () => void
}) {
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const pts = points.length ? points : []
  const toXY = (e: { clientX: number; clientY: number }): CurvePoint => {
    const r = ref.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) }
  }
  const path = (f: (x: number) => number): string => {
    let d = ''
    for (let i = 0; i <= 64; i++) {
      const x = i / 64
      d += `${i ? 'L' : 'M'}${(x * SIZE).toFixed(1)} ${((1 - f(x)) * SIZE).toFixed(1)}`
    }
    return d
  }
  const all = [{ x: 0, y: 0 }, ...pts, { x: 1, y: 1 }]
  const withEnds = pts.length ? pts : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  const curve = monotone(withEnds)
  const par = parametric(param)
  const peak = histogram ? Math.max(1, ...histogram.slice(2, 254)) : 1
  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="aspect-square w-full cursor-crosshair touch-none rounded-md bg-black/40"
      role="img"
      aria-label={`${channel === 'rgb' ? 'RGB' : channel.toUpperCase()} tone curve, ${pts.length} points`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const p = toXY(e)
        // Grab the nearest point, or add one on the curve.
        let best = -1
        let dist = 0.05
        withEnds.forEach((q, i) => {
          const d = Math.hypot(q.x - p.x, q.y - p.y)
          if (d < dist) {
            dist = d
            best = i
          }
        })
        let next = [...withEnds]
        if (best < 0) {
          next.push({ x: p.x, y: curve(p.x) })
          next.sort((a, b) => a.x - b.x)
          best = next.findIndex((q) => q.x === p.x)
        }
        if (e.detail === 2 && best > 0 && best < next.length - 1) {
          next = next.filter((_, i) => i !== best)
          onChange(next.length <= 2 && next.every((q) => q.x === q.y) ? [] : next)
          onCommit()
          return
        }
        drag.current = best
        ;(e.target as Element).setPointerCapture(e.pointerId)
        onChange(next)
      }}
      onPointerMove={(e) => {
        const i = drag.current
        if (i == null) return
        const p = toXY(e)
        const next = [...withEnds]
        const lo = i > 0 ? next[i - 1].x + 0.01 : 0
        const hi = i < next.length - 1 ? next[i + 1].x - 0.01 : 1
        // End points move only up and down.
        const x = i === 0 ? next[0].x : i === next.length - 1 ? next[i].x : Math.min(hi, Math.max(lo, p.x))
        next[i] = { x, y: p.y }
        onChange(next)
      }}
      onPointerUp={(e) => {
        const i = drag.current
        drag.current = null
        if (i == null) return
        // Dragged far outside: remove it.
        const r = ref.current!.getBoundingClientRect()
        const out = e.clientY < r.top - 24 || e.clientY > r.bottom + 24
        if (out && i > 0 && i < withEnds.length - 1) onChange(withEnds.filter((_, k) => k !== i))
        onCommit()
      }}
    >
      {histogram && (
        <path
          d={`M0 ${SIZE} ${histogram.map((v, i) => `L${((i / 255) * SIZE).toFixed(1)} ${(SIZE - Math.min(1, v / peak) * SIZE * 0.9).toFixed(1)}`).join(' ')} L${SIZE} ${SIZE} Z`}
          fill="rgb(255 255 255 / 0.08)"
        />
      )}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} stroke="rgb(255 255 255 / 0.08)">
          <line x1={g * SIZE} x2={g * SIZE} y1={0} y2={SIZE} />
          <line y1={g * SIZE} y2={g * SIZE} x1={0} x2={SIZE} />
        </g>
      ))}
      <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="rgb(255 255 255 / 0.15)" strokeDasharray="3 3" />
      {channel === 'rgb' && <path d={path(par)} fill="none" stroke="rgb(255 255 255 / 0.3)" />}
      <path d={path(curve)} fill="none" stroke={STROKE[channel]} strokeWidth={1.5} />
      {(pts.length ? withEnds : all).map((q, i) => (
        <circle key={i} cx={q.x * SIZE} cy={(1 - q.y) * SIZE} r={3.5} fill="black" stroke={STROKE[channel]} strokeWidth={1.5} />
      ))}
    </svg>
  )
}
