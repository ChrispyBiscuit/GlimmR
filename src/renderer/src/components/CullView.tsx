import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Flag, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { cullingUpdate, isTyping } from '../culling'
import { fmtNum, LABEL_COLORS } from '../format'
import type { ColorLabel, Flag as FlagValue, PhotoUpdate } from '../../../shared/types'

/** One photo in the cull view: a library photo or a photo on a card. */
export interface CullItem {
  key: string
  name: string
  thumb: string
  preview: string
  /** Full resolution, for 100% zoom (falls back to the preview). */
  full?: string
  badge?: string
  flag: FlagValue
  rating: number
  label: ColorLabel
}

type Filter = 'all' | 'unflagged' | 'pick' | 'reject'

const mac = navigator.platform.toLowerCase().includes('mac')
const matches = (it: CullItem, f: Filter): boolean => f === 'all' || (f === 'unflagged' ? !it.flag : it.flag === f)

/**
 * Full-window culling: a loupe with a filmstrip, Lightroom's keys (P pick, X reject, U unflag, 0–5 stars, 6–9 labels)
 * with auto-advance, and 100% zoom that stays on the same spot from photo to photo to compare focus across a burst.
 */
export function CullView({
  title,
  items,
  start = 0,
  onMark,
  onClose,
  actions
}: {
  title: string
  items: CullItem[]
  start?: number
  onMark: (index: number, update: PhotoUpdate) => void
  onClose: (index: number) => void
  /** Extra header actions, e.g. Delete Rejects. */
  actions?: ReactNode
}) {
  const [index, setIndex] = useState(Math.min(Math.max(0, start), Math.max(0, items.length - 1)))
  const [filter, setFilter] = useState<Filter>('all')
  const [auto, setAuto] = useState(true)
  // 100% zoom and where it's centred, as fractions of the photo, kept from photo to photo.
  const [zoom, setZoom] = useState<{ fx: number; fy: number } | null>(null)
  const [natural, setNatural] = useState<{ key: string; w: number; h: number } | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; fx: number; fy: number; moved: boolean } | null>(null)
  const item = items[index]

  const counts = useMemo(() => {
    let pick = 0
    let reject = 0
    for (const it of items) {
      if (it.flag === 'pick') pick++
      else if (it.flag === 'reject') reject++
    }
    return { pick, reject, unflagged: items.length - pick - reject }
  }, [items])

  /** The next photo in the filter, in a direction. */
  const step = (from: number, dir: 1 | -1, f = filter): number => {
    for (let i = from + dir; i >= 0 && i < items.length; i += dir) if (matches(items[i], f)) return i
    return from
  }
  const go = (dir: 1 | -1): void => setIndex((i) => step(i, dir))

  // Switching filter jumps to the nearest photo in it.
  const pickFilter = (f: Filter): void => {
    setFilter(f)
    if (item && !matches(item, f)) {
      const next = step(index, 1, f)
      setIndex(next !== index ? next : step(index, -1, f))
    }
  }

  useEffect(() => {
    strip.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || document.querySelector('[role="alertdialog"], [data-slot="dialog-content"]')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        return zoom ? setZoom(null) : onClose(index)
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') return void (e.preventDefault(), go(1))
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') return void (e.preventDefault(), go(-1))
      if (e.key === 'Home') return setIndex(step(-1, 1))
      if (e.key === 'End') return setIndex(step(items.length, -1))
      if ((e.key === 'z' || e.key === 'Z' || e.key === ' ') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        return setZoom(zoom ? null : { fx: 0.5, fy: 0.5 })
      }
      if (!item) return
      // Shift advances once; Caps Lock on means always advance, as in Lightroom.
      const k = e.key.length === 1 && e.shiftKey ? new KeyboardEvent('keydown', { key: e.key.toLowerCase() }) : e
      const u = cullingUpdate(k, item.label)
      if (!u) return
      e.preventDefault()
      onMark(index, u)
      const advance = auto || e.shiftKey || e.getModifierState('CapsLock')
      if (advance) {
        // The marked photo may drop out of the filter, so look from where it is.
        const next = step(index, 1)
        setIndex(next !== index ? next : step(index, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const src = item ? (zoom ? (item.full ?? item.preview) : item.preview) : undefined
  const box = stage.current?.getBoundingClientRect()
  const nat = natural && natural.key === src ? natural : null
  const z = zoom && nat && box ? { w: nat.w / devicePixelRatio, h: nat.h / devicePixelRatio } : null

  return (
    <div role="dialog" aria-modal="true" aria-label={`Cull ${title}`} className="dark fixed inset-0 z-50 flex flex-col bg-canvas text-ink">
      <header className={cn('app-drag titlebar-inset flex h-12 shrink-0 items-center gap-3 border-b bg-panel pl-3', mac && 'pl-20')}>
        <Button variant="ghost" size="sm" onClick={() => onClose(index)}>
          <ArrowLeft data-icon="inline-start" />
          Done
        </Button>
        <h1 className="truncate text-[13px] font-medium">Cull {title}</h1>
        <div className="mx-auto flex items-center gap-1" role="group" aria-label="Show">
          {(
            [
              ['all', `All ${fmtNum(items.length)}`],
              ['unflagged', `Unflagged ${fmtNum(counts.unflagged)}`],
              ['pick', `Picked ${fmtNum(counts.pick)}`],
              ['reject', `Rejected ${fmtNum(counts.reject)}`]
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <Button key={f} variant="ghost" size="sm" aria-pressed={filter === f} className={cn('tnum h-7 text-xs', filter === f && 'bg-accent text-ink')} onClick={() => pickFilter(f)}>
              {label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <Switch checked={auto} onCheckedChange={setAuto} aria-label="Auto-advance" />
          Auto-advance
        </label>
        <div className="flex items-center gap-1 pr-3">{actions}</div>
      </header>

      <div
        ref={stage}
        className={cn('relative min-h-0 flex-1 overflow-hidden', zoom ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in')}
        onPointerDown={(e) => {
          if (!zoom) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, fx: zoom.fx, fy: zoom.fy, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || !z) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          setZoom({ fx: Math.min(1, Math.max(0, d.fx - dx / z.w)), fy: Math.min(1, Math.max(0, d.fy - dy / z.h)) })
        }}
        onPointerUp={() => {
          const d = drag.current
          drag.current = null
          if (d && !d.moved) setZoom(null)
        }}
      >
        {item && src && (
          <img
            key={`${item.key}-${zoom ? 'z' : 'f'}`}
            src={src}
            alt={item.name}
            draggable={false}
            onLoad={(e) => setNatural({ key: src, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onClick={(e) => {
              if (zoom) return
              // Zoom to 100% at the spot clicked.
              const r = e.currentTarget.getBoundingClientRect()
              setZoom({ fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height })
            }}
            className={cn('absolute max-w-none select-none', !zoom && 'inset-0 m-auto max-h-full max-w-full object-contain p-4')}
            style={
              zoom && z && box
                ? { width: z.w, height: z.h, left: Math.min(0, Math.max(box.width - z.w, box.width / 2 - zoom.fx * z.w)), top: Math.min(0, Math.max(box.height - z.h, box.height / 2 - zoom.fy * z.h)) }
                : zoom
                  ? { visibility: 'hidden' }
                  : undefined
            }
          />
        )}
        {!item && <p className="absolute inset-0 m-auto h-fit text-center text-sm text-ink-muted">No photos to cull.</p>}
        {item && (
          <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs text-white">
            <span className="tnum">
              {fmtNum(index + 1)} / {fmtNum(items.length)}
            </span>
            <span className="max-w-72 truncate">{item.name}</span>
            {item.badge && <span className="rounded-sm bg-white/15 px-1 text-[10px]">{item.badge}</span>}
            {zoom && <span>100%</span>}
          </div>
        )}
        {item && <Marks item={item} className="absolute top-3 right-3" />}
        <Button variant="ghost" size="icon-lg" aria-label="Previous photo" className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-black/40" onClick={() => go(-1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon-lg" aria-label="Next photo" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-black/40" onClick={() => go(1)}>
          <ChevronRight />
        </Button>
      </div>

      <footer className="flex shrink-0 flex-col border-t bg-panel">
        <div className="flex items-center gap-3 px-4 pt-2 text-[11px] text-ink-muted">
          <span>
            <Kbd>P</Kbd> pick · <Kbd>X</Kbd> reject · <Kbd>U</Kbd> unflag · <Kbd>0–5</Kbd> stars · <Kbd>6–9</Kbd> labels · <Kbd>Z</Kbd> 100% · <Kbd>Shift</Kbd> + key moves on
          </span>
        </div>
        <div ref={strip} className="scroll-thin flex h-24 items-center gap-1.5 overflow-x-auto px-4 py-2" aria-label="Filmstrip">
          {items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              data-i={i}
              aria-label={it.name}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn('relative h-full shrink-0 overflow-hidden rounded-sm bg-ink/5 outline-none', i === index && 'ring-2 ring-ink', !matches(it, filter) && 'opacity-25', it.flag === 'reject' && 'opacity-40')}
              style={{ aspectRatio: '3 / 2' }}
            >
              <img src={it.thumb} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
              <Marks item={it} small className="absolute right-0.5 bottom-0.5" />
            </button>
          ))}
        </div>
      </footer>
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-ink/15 px-1 font-sans text-[10px] text-ink">{children}</kbd>
}

function Marks({ item, small, className }: { item: CullItem; small?: boolean; className?: string }) {
  if (!item.flag && !item.rating && !item.label) return null
  return (
    <div className={cn('pointer-events-none flex items-center gap-1 rounded-full bg-black/60 text-white', small ? 'px-1 py-px text-[9px]' : 'px-2.5 py-1 text-xs', className)}>
      {item.flag === 'pick' && <Flag className={cn('fill-current text-pick', small ? 'size-2.5' : 'size-3.5')} aria-label="Picked" />}
      {item.flag === 'reject' && <X className={cn('text-reject', small ? 'size-2.5' : 'size-3.5')} aria-label="Rejected" />}
      {item.rating > 0 && <span className="text-marker">{'★'.repeat(item.rating)}</span>}
      {item.label && <span className={cn('rounded-full', small ? 'size-1.5' : 'size-2.5')} style={{ background: LABEL_COLORS[item.label] }} aria-label={`${item.label} label`} />}
    </div>
  )
}

/** Tooltip-wrapped header button, for actions passed to the cull view. */
export function CullAction({ label, hint, onClick, destructive }: { label: string; hint: string; onClick: () => void; destructive?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={destructive ? 'destructive' : 'outline'} size="sm" className="h-7 text-xs" onClick={onClick}>
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
