import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Flag, FolderOpen, Info, Pause, Pencil, Play, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api, originalUrl, previewUrl, thumbUrl } from '../api'
import { camera, exposureParts, fmtBytes, fmtDate, fmtShutter, LABEL_COLORS, quoteValue } from '../format'
import { cullingUpdate, isTyping } from '../culling'
import { clampView, fitScale, fromSlider, MAX_SCALE, toSlider, zoomAt, type Box, type View } from '../zoom'
import { KeywordEditor } from './KeywordEditor'
import { StarRating } from './SelectionBar'
import { COLOR_LABELS } from '../../../shared/types'
import type { PhotoDetail } from '../../../shared/types'

const BROWSER_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])
const mac = navigator.userAgent.includes('Mac')
// Space kept clear around a fitted photo for the header (top) and the filmstrip (bottom).
const FIT_PAD = { x: 24, top: 64, bottom: 96 }
const ZOOM_STEP = 1.5

// Raw metadata keys shown in each info group (the rest appear under "All fields").
const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Capture', keys: ['DateTimeOriginal', 'Make', 'Model', 'LensModel', 'SerialNumber', 'BodySerialNumber', 'Software'] },
  { title: 'Exposure', keys: ['ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureProgram', 'ExposureCompensation', 'MeteringMode', 'Flash', 'WhiteBalance'] },
  { title: 'File', keys: ['FileName', 'FileType', 'FileSize', 'ExifImageWidth', 'ExifImageHeight', 'ColorSpace', 'Sidecar'] }
]

function Row({ k, v, onClick }: { k: string; v: ReactNode; onClick?: () => void }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-3 py-1 text-[13px]">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="min-w-0 break-words">
        {onClick ? (
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={onClick} title="Find photos with this value">
            {v}
          </button>
        ) : (
          v
        )}
      </dd>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-white/10 py-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-medium text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

export function Viewer() {
  const s = useStore()
  const v = s.viewer!
  const id = v.ids[v.index]
  const photo = s.cache.get(id)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [showInfo, setShowInfo] = useState(true)
  const [view, setView] = useState<View | null>(null) // null means fitted to the window
  const [dims, setDims] = useState<(Box & { id: number }) | null>(null)
  const [stageBox, setStageBox] = useState<Box>({ w: 0, h: 0 })
  const [animate, setAnimate] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hiRes, setHiRes] = useState(false)
  const [idle, setIdle] = useState(false)
  const [metaFilter, setMetaFilter] = useState('')
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const go = (delta: number): void => {
    const index = Math.max(0, Math.min(v.ids.length - 1, v.index + delta))
    if (index !== v.index) s.setViewer({ ...v, index })
  }
  const close = (): void => {
    const i = s.ids.indexOf(id)
    if (i >= 0) {
      s.setFocusIndex(i)
      s.setSelected(new Set([id]))
    }
    s.setViewer(null)
  }
  const wake = (): void => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 2200)
  }
  useEffect(() => {
    wake()
    return () => clearTimeout(idleTimer.current)
  }, [])

  useEffect(() => void s.ensurePhotos(v.ids.slice(Math.max(0, v.index - 40), v.index + 40)), [v.index, v.ids, s])

  useEffect(() => {
    let live = true
    void api.detail(id).then((d) => live && setDetail(d))
    return () => {
      live = false
    }
  }, [id, photo])

  // Show the fast preview first, then swap in the original when the browser can display it.
  useEffect(() => {
    setHiRes(false)
    setView(null)
    if (!photo || !BROWSER_EXTS.has(photo.ext) || photo.offline) return
    const img = new Image()
    img.onload = () => setHiRes(true)
    img.src = originalUrl(photo.id, photo.mtime)
    for (const n of [v.ids[v.index + 1], v.ids[v.index - 1]]) if (n != null) new Image().src = previewUrl(n)
    return () => {
      img.onload = null
    }
  }, [photo?.id, photo?.mtime, photo?.ext, photo?.offline, v.ids, v.index])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStageBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Images are laid out at the original's pixel size (so 100% means real pixels, even while the smaller
  // preview is showing) and scaled with a transform.
  const img: Box = dims && dims.id === photo?.id ? dims : { w: 0, h: 0 }
  const ready = img.w > 0 && stageBox.w > 0
  const fit = fitScale(img, {
    w: stageBox.w - FIT_PAD.x * 2,
    h: stageBox.h - FIT_PAD.top - FIT_PAD.bottom
  })
  const ev = view ? clampView(view, img, stageBox) : { scale: fit, x: 0, y: (FIT_PAD.top - FIT_PAD.bottom) / 2 }
  // The wheel listener and rapid events read the latest geometry from here rather than a stale render.
  const live = useRef({ ev, fit, img, stageBox })
  live.current = { ev, fit, img, stageBox }

  /** Zooms to `scale` around a point given relative to the stage centre; at or below fit it snaps back to fit. */
  const zoomTo = (scale: number, px = 0, py = 0, smooth = false): void => {
    const g = live.current
    if (!g.img.w) return
    setAnimate(smooth)
    const next = Math.min(MAX_SCALE, scale)
    if (next <= g.fit * 1.001) {
      g.ev = { scale: g.fit, x: 0, y: (FIT_PAD.top - FIT_PAD.bottom) / 2 }
      return setView(null)
    }
    g.ev = zoomAt(g.ev, next, px, py, g.img, g.stageBox)
    setView(g.ev)
  }
  const zoomIn = (): number => (fit < 1 ? 1 : fit * 2)
  const fromCentre = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = stage.current!.getBoundingClientRect()
    return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]
  }

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      zoomTo(live.current.ev.scale * Math.exp(-e.deltaY * lines * 0.0015), ...fromCentre(e))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    strip.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [v.index])

  useEffect(() => {
    if (!v.slideshow) return
    const t = setInterval(() => (v.index >= v.ids.length - 1 ? s.setViewer({ ...v, slideshow: false }) : s.setViewer({ ...v, index: v.index + 1 })), 4000)
    return () => clearInterval(t)
  }, [v, s])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || document.querySelector('[role="menu"], [data-slot="dialog-content"]')) return
      // The zoom slider uses the arrow keys itself.
      if ((e.target as HTMLElement)?.closest?.('[role="slider"]') && /^(Arrow|Home|End|Page)/.test(e.key)) return
      const mod = e.metaKey || e.ctrlKey
      wake()
      if (e.key === 'Escape') return v.slideshow ? s.setViewer({ ...v, slideshow: false }) : close()
      if (e.key === 'ArrowRight') return go(1)
      if (e.key === 'ArrowLeft') return go(-1)
      if (e.key === 'Home') return s.setViewer({ ...v, index: 0 })
      if (e.key === 'End') return s.setViewer({ ...v, index: v.ids.length - 1 })
      if (e.key.toLowerCase() === 'i' && !mod) return setShowInfo((x) => !x)
      if (e.key.toLowerCase() === 'z' || e.key === ' ') {
        e.preventDefault()
        return zoomTo(view ? 0 : zoomIn(), 0, 0, true)
      }
      if (!mod && (e.key === '=' || e.key === '+')) return zoomTo(ev.scale * ZOOM_STEP, 0, 0, true)
      if (!mod && e.key === '-') return zoomTo(ev.scale / ZOOM_STEP, 0, 0, true)
      if (e.key.toLowerCase() === 's' && !mod) return s.setViewer({ ...v, slideshow: !v.slideshow })
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        return void s.trashPhotos([id]).then((removed) => {
          if (!removed) return
          const ids = v.ids.filter((x) => x !== id)
          s.setViewer(ids.length ? { ...v, ids, index: Math.min(v.index, ids.length - 1) } : null)
        })
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        return void s.openEditor([id])
      }
      const u = cullingUpdate(e, photo?.label)
      if (u) {
        e.preventDefault()
        void s.updatePhotos([id], u)
        if (s.settings?.autoAdvance) go(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onImageClick = (e: React.MouseEvent<HTMLImageElement>): void => {
    if (!view) zoomTo(zoomIn(), ...fromCentre(e), true)
  }
  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    const { naturalWidth: nw, naturalHeight: nh } = e.currentTarget
    if (!photo || !nw || !nh) return
    const full = Math.max(photo.width ?? 0, photo.height ?? 0)
    const k = full > 0 ? full / Math.max(nw, nh) : 1
    setDims((d) => (d && d.id === photo.id && Math.abs(d.w - nw * k) < 2 ? d : { id: photo.id, w: nw * k, h: nh * k }))
  }

  const src = photo ? (hiRes ? originalUrl(photo.id, photo.mtime) : previewUrl(photo.id, photo.mtime)) : undefined
  const editors = s.settings?.editors.editors ?? []
  const defaultEditor = editors.find((e) => e.id === s.settings?.editors.defaultEditor)
  const searchFor = (q: string): void => {
    s.setViewer(null)
    s.navigate({ type: 'all' }, 'Photos', q)
  }
  const meta = detail?.metadata ?? []
  const metaMap = new Map(meta.map((m) => [m.key, m.value]))
  const chromeHidden = idle && !view
  const chrome = cn('transition-opacity duration-300', (chromeHidden || v.slideshow) && 'pointer-events-none opacity-0')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Viewing ${photo?.filename ?? 'photo'}`}
      className={cn('dark fixed inset-0 z-40 flex bg-canvas text-ink', chromeHidden && 'cursor-none')}
      onMouseMove={wake}
    >
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className={cn('app-drag titlebar-inset absolute inset-x-0 top-0 z-10 flex h-12 items-center gap-2 bg-panel/95 pl-3', mac && 'pl-20', chrome)}>
          <Button variant="ghost" size="sm" onClick={close}>
            <ArrowLeft data-icon="inline-start" />
            Photos
          </Button>
          <div className="min-w-0 flex-1 px-2">
            <p className="truncate text-[13px] font-medium">{photo?.title || photo?.filename}</p>
            <p className="tnum text-xs text-ink-muted">
              {v.index + 1} of {v.ids.length.toLocaleString()}
            </p>
          </div>
          {photo && (
            <>
              <StarRating value={photo.rating} onChange={(r) => void s.updatePhotos([id], { rating: r })} />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Pick"
                    aria-pressed={photo.flag === 'pick'}
                    onClick={() =>
                      void s.updatePhotos([id], {
                        flag: photo.flag === 'pick' ? null : 'pick'
                      })
                    }
                  >
                    <Flag className={cn(photo.flag === 'pick' && 'fill-pick text-pick')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Pick (P)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reject"
                    aria-pressed={photo.flag === 'reject'}
                    onClick={() =>
                      void s.updatePhotos([id], {
                        flag: photo.flag === 'reject' ? null : 'reject'
                      })
                    }
                  >
                    <X className={cn(photo.flag === 'reject' && 'text-reject')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reject (X)</TooltipContent>
              </Tooltip>
              <div className="mx-1 flex items-center gap-0.5" role="radiogroup" aria-label="Color label">
                {COLOR_LABELS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={photo.label === l}
                    aria-label={`${l} label`}
                    onClick={() =>
                      void s.updatePhotos([id], {
                        label: photo.label === l ? null : l
                      })
                    }
                    className="flex size-6 items-center justify-center rounded-sm"
                  >
                    <span className={cn('size-3 rounded-full transition-opacity', photo.label === l ? 'opacity-100 ring-2 ring-ink ring-offset-1 ring-offset-black' : 'opacity-35 hover:opacity-80')} style={{ background: LABEL_COLORS[l] }} />
                  </button>
                ))}
              </div>
              <div className="flex">
                <Button size="sm" className="rounded-r-none" onClick={() => void s.openEditor([id])}>
                  <Pencil data-icon="inline-start" />
                  {defaultEditor ? `Edit in ${defaultEditor.name}` : 'Edit'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" className="rounded-l-none border-l border-black/20" aria-label="Choose an editor">
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {editors.map((e) => (
                      <DropdownMenuItem key={e.id} onSelect={() => void s.openEditor([id], e.id)}>
                        Open in {e.name}
                      </DropdownMenuItem>
                    ))}
                    {editors.length > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={() => void api.openWithDefault(id)}>System Default App</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void api.reveal(id)}>{mac ? 'Show in Finder' : 'Show in Explorer'}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Show in folder" onClick={() => void api.reveal(id)}>
                    <FolderOpen />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{mac ? 'Show in Finder' : 'Show in Explorer'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Start slideshow" onClick={() => s.setViewer({ ...v, slideshow: true })}>
                    <Play />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Slideshow (S)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Photo info" aria-pressed={showInfo} onClick={() => setShowInfo(!showInfo)}>
                    <Info className={cn(showInfo && 'text-ink')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Info (I)</TooltipContent>
              </Tooltip>
            </>
          )}
        </header>

        <div
          ref={stage}
          className={cn('relative min-h-0 flex-1 touch-none overflow-hidden', view && (dragging ? 'cursor-grabbing' : 'cursor-grab'))}
          onPointerDown={(e) => {
            if (!view || e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = {
              px: e.clientX,
              py: e.clientY,
              x: ev.x,
              y: ev.y,
              moved: false
            }
            setAnimate(false)
            setDragging(true)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 3) d.moved = true
            live.current.ev = clampView(
              {
                scale: ev.scale,
                x: d.x + e.clientX - d.px,
                y: d.y + e.clientY - d.py
              },
              img,
              stageBox
            )
            setView(live.current.ev)
          }}
          onPointerUp={() => {
            // A click without a drag while zoomed goes back to fit.
            if (drag.current && !drag.current.moved) zoomTo(0, 0, 0, true)
            drag.current = null
            setDragging(false)
          }}
          onPointerCancel={() => {
            drag.current = null
            setDragging(false)
          }}
        >
          {src && (
            <img
              key={photo?.id}
              src={src}
              alt={photo?.title || photo?.filename || ''}
              draggable={false}
              onClick={onImageClick}
              onLoad={onImageLoad}
              style={{
                width: img.w || undefined,
                height: img.h || undefined,
                transform: `translate(-50%, -50%) translate(${ev.x}px, ${ev.y}px) scale(${ev.scale})`
              }}
              className={cn('absolute top-1/2 left-1/2 max-w-none select-none', !view && 'cursor-zoom-in', !ready && 'invisible', animate && !dragging && 'transition-transform duration-200 ease-out')}
            />
          )}
          {photo?.offline && <p className="absolute top-16 left-4 rounded-sm bg-reject/90 px-2 py-1 text-xs text-white">The original is offline. Showing the saved preview.</p>}
        </div>

        {!view && v.index > 0 && (
          <Button variant="ghost" size="icon-lg" aria-label="Previous photo" className={cn('absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-black/40', chrome)} onClick={() => go(-1)}>
            <ChevronLeft />
          </Button>
        )}
        {!view && v.index < v.ids.length - 1 && (
          <Button variant="ghost" size="icon-lg" aria-label="Next photo" className={cn('absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-black/40', chrome)} onClick={() => go(1)}>
            <ChevronRight />
          </Button>
        )}
        {v.slideshow && (
          <Button variant="ghost" size="sm" className="absolute right-4 bottom-4 bg-black/50" onClick={() => s.setViewer({ ...v, slideshow: false })}>
            <Pause data-icon="inline-start" />
            Stop Slideshow
          </Button>
        )}

        <div className={cn('absolute inset-x-0 bottom-0 flex h-20 items-center gap-3 bg-gradient-to-t from-black/70 to-transparent pr-3', chrome)}>
          <div ref={strip} className="scroll-thin flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto px-3">
            {v.ids.slice(Math.max(0, v.index - 30), v.index + 31).map((fid, k) => {
              const idx = Math.max(0, v.index - 30) + k
              const current = idx === v.index
              return (
                <button
                  key={fid}
                  type="button"
                  aria-label={`Photo ${idx + 1}`}
                  aria-current={current}
                  onClick={() => s.setViewer({ ...v, index: idx })}
                  className={cn('h-14 shrink-0 overflow-hidden rounded-sm transition-opacity', current ? 'opacity-100 ring-2 ring-ink' : 'opacity-50 hover:opacity-90')}
                >
                  <img src={thumbUrl(fid, s.cache.get(fid)?.mtime ?? 0)} alt="" className="h-full w-auto" draggable={false} />
                </button>
              )
            })}
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/55 px-1.5 py-1 backdrop-blur-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Zoom out" disabled={!view} onClick={() => zoomTo(ev.scale / ZOOM_STEP, 0, 0, true)}>
                  <ZoomOut />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom out (−)</TooltipContent>
            </Tooltip>
            <Slider aria-label="Zoom" className="w-28" min={0} max={100} step={0.5} disabled={!ready} value={[toSlider(ev.scale, fit)]} onValueChange={([p]) => zoomTo(fromSlider(p, fit))} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Zoom in" disabled={!ready || ev.scale >= MAX_SCALE} onClick={() => zoomTo(ev.scale * ZOOM_STEP, 0, 0, true)}>
                  <ZoomIn />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Zoom in (+)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="tnum w-14 rounded-full px-0 text-xs" disabled={!ready} onClick={() => zoomTo(view ? 0 : zoomIn(), 0, 0, true)}>
                  {view ? `${Math.round(ev.scale * 100)}%` : 'Fit'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{view ? 'Fit to window (Z)' : 'Zoom to 100% (Z)'}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {showInfo && !v.slideshow && detail && (
        <aside aria-label="Photo info" className={cn('scroll-thin w-[340px] shrink-0 overflow-y-auto border-l border-white/10 bg-panel px-5 py-5', !mac && 'pt-16')}>
          <h2 className="display text-[19px] leading-tight text-pretty">{fmtDate(detail.takenAt, { dateStyle: 'long' })}</h2>
          <p className="tnum mt-1 text-[13px] text-ink-muted">
            {fmtDate(detail.takenAt, {
              weekday: 'long',
              hour: 'numeric',
              minute: '2-digit'
            })}
          </p>
          {exposureParts(detail).length > 0 && (
            <p className="tnum mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {exposureParts(detail).map((p) => (
                <span key={p}>{p}</span>
              ))}
            </p>
          )}

          <div className="mt-6">
            <Group title="Description">
              <Input
                key={`t-${detail.id}`}
                aria-label="Title"
                placeholder="Add a title…"
                defaultValue={detail.title ?? ''}
                autoComplete="off"
                className="mb-2 h-8 text-[13px]"
                onBlur={(e) => e.target.value !== (detail.title ?? '') && void s.updatePhotos([id], { title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <Textarea
                key={`c-${detail.id}`}
                aria-label="Caption"
                placeholder="Add a caption…"
                defaultValue={detail.caption ?? ''}
                className="mb-3 min-h-16 text-[13px]"
                onBlur={(e) => e.target.value !== (detail.caption ?? '') && void s.updatePhotos([id], { caption: e.target.value })}
              />
              <KeywordEditor key={`k-${detail.id}-${detail.keywords.join('|')}`} ids={[id]} current={detail.keywords} />
              {detail.albums.length > 0 && (
                <p className="mt-3 text-[13px] text-ink-muted">
                  In{' '}
                  {detail.albums.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && ', '}
                      <button type="button" className="text-ink underline-offset-2 hover:underline" onClick={() => (s.setViewer(null), s.navigate({ type: 'album', id: a.id }, a.name))}>
                        {a.name}
                      </button>
                    </span>
                  ))}
                </p>
              )}
            </Group>
            {detail.smartTags.length > 0 && (
              <Group title="Smart tags">
                <ul className="flex flex-wrap gap-1.5" aria-label="Smart tags">
                  {detail.smartTags.map((t) => (
                    <li key={t.tag} className="inline-flex h-6 items-center gap-0.5 rounded-full border bg-raised pr-1 pl-2.5 text-xs">
                      <button type="button" className="underline-offset-2 hover:underline" title={`Find photos tagged ${t.tag}`} onClick={() => searchFor(`auto:=${quoteValue(t.tag)}`)}>
                        {t.tag}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove smart tag ${t.tag}`}
                        title="Not right? Remove it"
                        className="rounded-full p-0.5 text-ink-muted hover:bg-accent hover:text-ink"
                        onClick={async () => {
                          await api.hideSmartTag(id, t.tag)
                          setDetail(await api.detail(id))
                        }}
                      >
                        <X className="size-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Group>
            )}
            <Group title="Capture">
              <dl>
                {camera(detail) && <Row k="Camera" v={camera(detail)} onClick={() => searchFor(`camera:=${quoteValue(`${detail.make ?? ''} ${detail.model ?? ''}`.trim())}`)} />}
                {detail.lens && <Row k="Lens" v={detail.lens} onClick={() => searchFor(`lens:=${quoteValue(detail.lens!)}`)} />}
                {detail.creator && <Row k="Creator" v={detail.creator} onClick={() => searchFor(`creator:=${quoteValue(detail.creator!)}`)} />}
                {GROUPS[0].keys.slice(4).map((k) => metaMap.get(k) && <Row key={k} k={k} v={metaMap.get(k)} />)}
              </dl>
            </Group>
            <Group title="Exposure">
              <dl>
                {detail.shutter != null && <Row k="Shutter" v={<span className="tnum">{`${fmtShutter(detail.shutter)}${detail.shutter < 1 ? '\u00a0s' : ''}`}</span>} onClick={() => searchFor(`shutter:${fmtShutter(detail.shutter)?.replace(/s$/, '')}`)} />}
                {detail.aperture != null && <Row k="Aperture" v={<span className="tnum">{`ƒ/${Number(detail.aperture.toFixed(1))}`}</span>} onClick={() => searchFor(`f:${detail.aperture}`)} />}
                {detail.iso != null && <Row k="ISO" v={<span className="tnum">{detail.iso}</span>} onClick={() => searchFor(`iso:${detail.iso}`)} />}
                {detail.focal != null && <Row k="Focal length" v={<span className="tnum">{`${Math.round(detail.focal)}\u00a0mm`}</span>} onClick={() => searchFor(`focal:${detail.focal}`)} />}
                {GROUPS[1].keys.slice(4).map((k) => metaMap.get(k) && <Row key={k} k={k.replace(/([a-z])([A-Z])/g, '$1 $2')} v={metaMap.get(k)} onClick={() => searchFor(`${k}:=${quoteValue(metaMap.get(k)!)}`)} />)}
              </dl>
            </Group>
            {detail.lat != null && detail.lon != null && (
              <Group title="Location">
                <dl>
                  <Row k="Coordinates" v={<span className="tnum">{`${detail.lat.toFixed(5)}, ${detail.lon.toFixed(5)}`}</span>} />
                </dl>
              </Group>
            )}
            <Group title="File">
              <dl>
                <Row k="Name" v={detail.filename} />
                <Row k="Size" v={<span className="tnum">{fmtBytes(detail.size)}</span>} />
                {detail.width && detail.height && <Row k="Dimensions" v={<span className="tnum">{`${detail.width} × ${detail.height} (${((detail.width * detail.height) / 1e6).toFixed(1)} MP)`}</span>} />}
                <Row k="Location" v={<span className="selectable text-xs break-all text-ink-muted">{detail.path}</span>} />
              </dl>
            </Group>
            <Group title={`All fields (${meta.length})`}>
              <Input aria-label="Filter fields" placeholder="Filter fields…" value={metaFilter} onChange={(e) => setMetaFilter(e.target.value)} autoComplete="off" spellCheck={false} className="mb-2 h-7 text-xs" />
              <dl>
                {meta
                  .filter((m) => !metaFilter || `${m.key} ${m.value}`.toLowerCase().includes(metaFilter.toLowerCase()))
                  .map((m, i) => (
                    <Row key={`${m.key}-${i}`} k={m.key} v={m.value} onClick={() => searchFor(`${m.key}:=${quoteValue(m.value)}`)} />
                  ))}
              </dl>
            </Group>
          </div>
        </aside>
      )}
    </div>
  )
}
