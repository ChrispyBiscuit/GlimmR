import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, RotateCcw, RotateCw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { cropFits, defaultCrop, fitCrop, frameSize, MAX_ANGLE, NO_EDIT, rotateEdit, sanitizeEdit, type PhotoEdit, type Rect } from '../../../shared/edit'
import { sourceUrl } from '../api'
import type { Photo } from '../../../shared/types'

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const ASPECTS: { key: string; label: string; ratio?: number }[] = [
  { key: 'free', label: 'Free' },
  { key: 'original', label: 'Original' },
  { key: '1:1', label: '1 : 1', ratio: 1 },
  { key: '5:4', label: '5 : 4', ratio: 5 / 4 },
  { key: '4:3', label: '4 : 3', ratio: 4 / 3 },
  { key: '3:2', label: '3 : 2', ratio: 3 / 2 },
  { key: '16:9', label: '16 : 9', ratio: 16 / 9 }
]
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
const MIN = 0.04
const PAD = 40
const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** The largest step from `from` towards `to` that still fits: a drag stops at the image's edge instead of jumping. */
function furthestFit(from: Rect, to: Rect, W: number, H: number, angle: number): Rect {
  if (cropFits(to, W, H, angle)) return to
  let lo = 0
  let hi = 1
  const at = (t: number): Rect => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t })
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2
    if (cropFits(at(t), W, H, angle)) lo = t
    else hi = t
  }
  return at(lo)
}

/**
 * Non-destructive crop, quarter-turn and straighten for one photo. Works on the unedited preview; nothing is saved
 * until Done. Enter saves, Esc cancels, [ and ] turn.
 */
export function CropEditor({ photo, saving, onDone, onCancel }: { photo: Photo; saving: boolean; onDone: (edit: PhotoEdit | null) => void; onCancel: () => void }) {
  const [edit, setEdit] = useState<PhotoEdit>(() => photo.edit ?? NO_EDIT)
  // Until the crop is changed by hand it follows the angle and aspect ratio.
  const [manual, setManual] = useState(!!photo.edit?.crop)
  const [aspectKey, setAspectKey] = useState('free')
  const [portrait, setPortrait] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: Handle; x: number; y: number; start: Rect } | null>(null)

  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const frame = natural ? frameSize(natural.w, natural.h, edit.rotate) : null
  /** Pixel aspect ratio (width / height) the crop is locked to, if any. */
  const ratioFor = (key: string, f = frame, turned = portrait): number | null => {
    const a = ASPECTS.find((x) => x.key === key)
    if (!a || key === 'free' || !f) return null
    const r = key === 'original' ? Math.max(f.w, f.h) / Math.min(f.w, f.h) : a.ratio!
    return turned ? 1 / r : r
  }
  const ratio = ratioFor(aspectKey)
  const crop = frame ? (manual && edit.crop ? edit.crop : defaultCrop(frame.w, frame.h, edit.angle, ratio ?? undefined)) : FULL

  const scale = frame ? Math.max(0, Math.min((box.w - PAD * 2) / frame.w, (box.h - PAD * 2) / frame.h)) : 0
  const fw = frame ? frame.w * scale : 0
  const fh = frame ? frame.h * scale : 0

  const done = (): void => {
    if (!frame) return
    // An untouched crop is left to follow the angle (the largest fitting one), so it isn't stored.
    onDone(sanitizeEdit({ ...edit, crop: manual || ratio ? crop : null }))
  }
  const turn = (dir: 1 | -1): void => {
    setEdit((e) => rotateEdit({ ...e, crop: manual ? crop : e.crop }, dir) ?? NO_EDIT)
    setPortrait((p) => !p)
  }
  const setAngle = (angle: number): void => {
    setEdit((e) => ({ ...e, angle, crop: manual && frame ? fitCrop(crop, frame.w, frame.h, angle) : e.crop }))
  }
  const chooseAspect = (key: string, turned = portrait): void => {
    setAspectKey(key)
    setPortrait(turned)
    // A new shape starts from the largest crop of that shape.
    setManual(false)
    setEdit((e) => ({ ...e, crop: null }))
  }
  const reset = (): void => {
    setEdit(NO_EDIT)
    setManual(false)
    setAspectKey('free')
    setPortrait(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.querySelector('[role="listbox"]')) return
      const handled = e.key === 'Enter' || e.key === 'Escape' || e.key === '[' || e.key === ']'
      if (!handled) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Enter') done()
      else if (e.key === 'Escape') onCancel()
      else turn(e.key === ']' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const startDrag = (handle: Handle, e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    area.current?.setPointerCapture(e.pointerId)
    drag.current = { handle, x: e.clientX, y: e.clientY, start: crop }
    setDragging(true)
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d || !frame || !fw || !fh) return
    const dx = (e.clientX - d.x) / fw
    const dy = (e.clientY - d.y) / fh
    const s = d.start
    let next: Rect
    if (d.handle === 'move') {
      next = { ...s, x: Math.min(1 - s.w, Math.max(0, s.x + dx)), y: Math.min(1 - s.h, Math.max(0, s.y + dy)) }
    } else {
      let l = s.x
      let t = s.y
      let r = s.x + s.w
      let b = s.y + s.h
      if (d.handle.includes('w')) l = Math.min(r - MIN, Math.max(0, l + dx))
      if (d.handle.includes('e')) r = Math.max(l + MIN, Math.min(1, r + dx))
      if (d.handle.includes('n')) t = Math.min(b - MIN, Math.max(0, t + dy))
      if (d.handle.includes('s')) b = Math.max(t + MIN, Math.min(1, b + dy))
      if (ratio) {
        // Width / height in normalised units for this pixel ratio.
        const rn = (ratio * frame.h) / frame.w
        if (d.handle === 'n' || d.handle === 's') {
          const w = (b - t) * rn
          const cx = s.x + s.w / 2
          l = cx - w / 2
          r = cx + w / 2
        } else if (d.handle === 'e' || d.handle === 'w') {
          const h = (r - l) / rn
          const cy = s.y + s.h / 2
          t = cy - h / 2
          b = cy + h / 2
        } else {
          const h = (r - l) / rn
          if (d.handle.includes('n')) t = b - h
          else b = t + h
        }
      }
      next = { x: l, y: t, w: r - l, h: b - t }
    }
    setManual(true)
    setEdit((ed) => ({ ...ed, crop: furthestFit(s, next, frame.w, frame.h, edit.angle) }))
  }
  const endDrag = (): void => {
    drag.current = null
    setDragging(false)
  }

  const aspectChoice = ASPECTS.find((a) => a.key === aspectKey)!

  return (
    <div className="relative flex min-h-0 flex-1 flex-col pt-12">
      <div ref={area} className="relative min-h-0 flex-1 touch-none overflow-hidden select-none" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <img
          src={sourceUrl(photo.id, photo.mtime)}
          alt=""
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          className={cn('pointer-events-none absolute max-w-none', !frame && 'invisible')}
          style={
            natural && frame
              ? {
                  width: natural.w * scale,
                  height: natural.h * scale,
                  left: box.w / 2,
                  top: box.h / 2,
                  transform: `translate(-50%, -50%) rotate(${edit.rotate + edit.angle}deg)`,
                  transition: dragging ? undefined : 'transform 150ms ease-out'
                }
              : undefined
          }
        />
        {frame && (
          <div className="absolute" style={{ left: (box.w - fw) / 2, top: (box.h - fh) / 2, width: fw, height: fh }}>
            <div
              role="group"
              aria-label="Crop area"
              className="absolute cursor-move outline outline-1 outline-white/90"
              style={{ left: crop.x * fw, top: crop.y * fh, width: crop.w * fw, height: crop.h * fh, boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.62)' }}
              onPointerDown={(e) => startDrag('move', e)}
            >
              {/* Rule of thirds; finer while straightening. */}
              <div className={cn('pointer-events-none absolute inset-0 transition-opacity', dragging || edit.angle ? 'opacity-100' : 'opacity-40')}>
                {[1, 2].map((k) => (
                  <div key={`v${k}`} className="absolute inset-y-0 w-px bg-white/45" style={{ left: `${(k * 100) / 3}%` }} />
                ))}
                {[1, 2].map((k) => (
                  <div key={`h${k}`} className="absolute inset-x-0 h-px bg-white/45" style={{ top: `${(k * 100) / 3}%` }} />
                ))}
              </div>
              {HANDLES.map((h) => (
                <div
                  key={h}
                  aria-hidden
                  onPointerDown={(e) => startDrag(h, e)}
                  className={cn(
                    'absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border-2 border-white bg-black/30',
                    h === 'n' || h === 's' ? 'cursor-ns-resize' : h === 'e' || h === 'w' ? 'cursor-ew-resize' : h === 'ne' || h === 'sw' ? 'cursor-nesw-resize' : 'cursor-nwse-resize'
                  )}
                  style={{ left: h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%', top: h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%' }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/10 bg-panel px-4 py-2.5">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Rotate left" onClick={() => turn(-1)}>
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate left ([)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Rotate right" onClick={() => turn(1)}>
                <RotateCw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Rotate right (])</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-xs text-ink-muted">Straighten</span>
          <Slider aria-label="Straighten" className="w-44" min={-MAX_ANGLE} max={MAX_ANGLE} step={0.1} value={[edit.angle]} onValueChange={([a]) => setAngle(Math.round(a * 10) / 10)} />
          <button type="button" className="tnum w-12 text-left text-xs hover:underline" title="Reset to 0°" onClick={() => setAngle(0)}>
            {edit.angle > 0 ? '+' : ''}
            {edit.angle.toFixed(1)}°
          </button>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1.5 text-xs text-ink-muted">Aspect</span>
          <Select value={aspectKey} onValueChange={(k) => chooseAspect(k)}>
            <SelectTrigger size="sm" className="w-28" aria-label="Aspect ratio">
              <SelectValue>{aspectChoice.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ASPECTS.map((a) => (
                <SelectItem key={a.key} value={a.key}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Swap portrait and landscape" disabled={!ratio || ratio === 1} onClick={() => chooseAspect(aspectKey, !portrait)}>
                <ArrowLeftRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Portrait / landscape</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={reset}>
            <Undo2 data-icon="inline-start" />
            Reset
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || !frame} onClick={done}>
            {saving ? 'Saving…' : 'Done'}
          </Button>
        </div>
      </div>
    </div>
  )
}
