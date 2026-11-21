// The Develop view: edits a photo's look (white balance, tone, curves, colour, detail, styles and LUTs) on the GPU,
// live, from its editing copy. Settings are saved to the catalog as you go, one history step per gesture; the original
// file is never changed. See docs/DEVELOP_PRD.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ClipboardCopy, ClipboardPaste, Columns2, Download, Loader2, RotateCcw, SquareSplitHorizontal, TriangleAlert, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../../store'
import { api, thumbUrl } from '../../api'
import { isTyping } from '../../culling'
import { confirmDialog, promptDialog } from '../../dialogs'
import { DevelopGL, type Target } from '../../develop/gl'
import { loadSource, neutralAt, type EditSource } from '../../develop/source'
import { LookThumbs, lutFor, shrink } from '../../develop/thumbs'
import { Adjustments, type HslTab } from './panels'
import { HistoryPanel, LooksPanel, lookSettings, type Look } from './looks'
import { ExportDialog } from './ExportDialog'
import { LayerList, LayerPanel, updateLayer, type BrushOptions, type MaskTool } from './layers-ui'
import { MAX_LAYERS, newLayer, prepareLayer, type BrushStroke, type Layer, type MaskShape } from '../../../../shared/develop/layers'
import { convert, mul3, srgbDecode, toOklab } from '../../../../shared/develop/color'
import { bandWeights, prepare } from '../../../../shared/develop/pipeline'
import { ALL_GROUPS, applyPartial, changedGroups, defaultSettings, GROUPS, pick, type DevelopSettings, type Group, type SourceKind } from '../../../../shared/develop/settings'
import type { LutInfo, StyleInfo } from '../../../../shared/types'

const mac = navigator.userAgent.includes('Mac')
const MOD = mac ? '⌘' : 'Ctrl+'
const BG: [number, number, number] = [0.07, 0.07, 0.07]
const FIT_PAD = 16
const OPEN_KEY = 'glimmr.develop.open'

interface Hist {
  r: number[]
  g: number[]
  b: number[]
  l: number[]
  low: number
  high: number
}

function histogramOf(px: Uint8Array): Hist {
  const r = new Array(256).fill(0)
  const g = new Array(256).fill(0)
  const b = new Array(256).fill(0)
  const l = new Array(256).fill(0)
  let low = 0
  let high = 0
  let n = 0
  // Every third pixel is plenty.
  for (let i = 0; i < px.length; i += 12) {
    const R = px[i]
    const G = px[i + 1]
    const B = px[i + 2]
    r[R]++
    g[G]++
    b[B]++
    l[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++
    if (R >= 254 || G >= 254 || B >= 254) high++
    if (R <= 1 && G <= 1 && B <= 1) low++
    n++
  }
  return { r, g, b, l, low: low / Math.max(1, n), high: high / Math.max(1, n) }
}

function HistogramView({ h, clipping, onToggleClipping }: { h: Hist | null; clipping: boolean; onToggleClipping: () => void }) {
  const W = 256
  const H = 80
  if (!h) return <div className="h-20 rounded-md bg-black/40" aria-hidden />
  const peak = Math.max(1, ...h.r.slice(2, 254), ...h.g.slice(2, 254), ...h.b.slice(2, 254))
  const area = (bins: number[]): string => `M0 ${H} ${bins.map((v, i) => `L${i} ${(H - Math.min(1, v / peak) * H).toFixed(1)}`).join(' ')} L255 ${H} Z`
  const warn = 0.002
  return (
    <div className="relative overflow-hidden rounded-md bg-black/40">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full" role="img" aria-label="Histogram">
        <path d={area(h.l)} fill="rgb(255 255 255 / 0.16)" />
        <g style={{ mixBlendMode: 'screen' }}>
          <path d={area(h.r)} fill="rgb(255 70 70 / 0.55)" />
          <path d={area(h.g)} fill="rgb(70 230 110 / 0.55)" />
          <path d={area(h.b)} fill="rgb(80 140 255 / 0.55)" />
        </g>
      </svg>
      <button
        type="button"
        onClick={onToggleClipping}
        aria-pressed={clipping}
        className={cn('absolute top-1 left-1 size-3 rounded-full border border-white/30', h.low > warn ? 'bg-sky-400' : 'bg-white/10', clipping && 'ring-2 ring-white')}
        title={`Shadow clipping ${(h.low * 100).toFixed(1)}%. Show clipping (J)`}
        aria-label="Show clipping"
      />
      <button
        type="button"
        onClick={onToggleClipping}
        aria-pressed={clipping}
        className={cn('absolute top-1 right-1 size-3 rounded-full border border-white/30', h.high > warn ? 'bg-red-400' : 'bg-white/10', clipping && 'ring-2 ring-white')}
        title={`Highlight clipping ${(h.high * 100).toFixed(1)}%. Show clipping (J)`}
        aria-label="Show clipping"
      />
    </div>
  )
}

/** Chooses groups of settings, for copy and for saving a style. */
function GroupsDialog({
  title,
  description,
  confirmLabel,
  initial,
  withName,
  onDone
}: {
  title: string
  description: string
  confirmLabel: string
  initial: Group[]
  withName?: boolean
  onDone: (r: { groups: Group[]; name: string } | null) => void
}) {
  const [groups, setGroups] = useState<Set<Group>>(new Set(initial))
  const [name, setName] = useState('')
  const ok = groups.size > 0 && (!withName || name.trim())
  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (ok) onDone({ groups: [...groups], name: name.trim() })
          }}
        >
          {withName && <Input autoFocus placeholder="Style name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Style name" />}
          <div className="grid grid-cols-2 gap-2">
            {ALL_GROUPS.map((g) => (
              <label key={g} className="flex items-center gap-2 text-[13px]">
                <Checkbox
                  checked={groups.has(g)}
                  onCheckedChange={(c) =>
                    setGroups((x) => {
                      const n = new Set(x)
                      if (c) n.add(g)
                      else n.delete(g)
                      return n
                    })
                  }
                />
                {GROUPS[g].label}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Zoom = { scale: number; cx: number; cy: number } | null

export function DevelopView() {
  const s = useStore()
  const d = s.develop!
  const id = d.ids[d.index]
  const photo = s.cache.get(id)
  const { ensurePhotos, putPhotos } = s

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const eng = useRef<DevelopGL | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const thumbs = useMemo(() => new LookThumbs(), [])
  const [thumbsReady, setThumbsReady] = useState(0)

  const [src, setSrc] = useState<EditSource | null>(null)
  const [catalogKind, setCatalogKind] = useState<SourceKind>('display')
  const [settings, setSettingsState] = useState<DevelopSettings | null>(null)
  const settingsRef = useRef<DevelopSettings | null>(null)
  const committedRef = useRef<DevelopSettings | null>(null)
  const [committed, setCommitted] = useState<DevelopSettings | null>(null)
  const pendingLabel = useRef<string | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const undoStack = useRef<DevelopSettings[]>([])
  const redoStack = useRef<DevelopSettings[]>([])
  const lastStep = useRef<{ label: string; at: number }>({ label: '', at: 0 })
  const idRef = useRef(id)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [hover, setHover] = useState<Look | null>(null)
  const [before, setBefore] = useState<'off' | 'full' | 'split'>('off')
  const [splitAt, setSplitAt] = useState(0.5)
  const [clipping, setClipping] = useState(false)
  const [zoom, setZoom] = useState<Zoom>(null)
  const [eyedropper, setEyedropper] = useState(false)
  const [targeted, setTargeted] = useState<HslTab | 'bw' | null>(null)
  const [hist, setHist] = useState<Hist | null>(null)
  const [wbShown, setWbShown] = useState({ temp: 5500, tint: 0 })
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [luts, setLuts] = useState<LutInfo[]>([])
  const [history, setHistory] = useState<{ seq: number; label: string; at: number; settings: DevelopSettings }[]>([])
  const [leftTab, setLeftTab] = useState<'looks' | 'history'>('looks')
  const [styleAmt, setStyleAmt] = useState<{ style: StyleInfo; base: DevelopSettings; amount: number } | null>(null)
  const [exportIds, setExportIds] = useState<number[] | null>(null)
  const [groupsAsk, setGroupsAsk] = useState<'copy' | 'style' | null>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 1, h: 1 })
  // Layers: the selected one (null: Background, the photo's own settings), the mask tool and brush.
  const [activeLayer, setActiveLayer] = useState<string | null>(null)
  const [tool, setTool] = useState<MaskTool>(null)
  const [showMask, setShowMask] = useState(false)
  const [brush, setBrushState] = useState<BrushOptions>(() => {
    try {
      return { size: 0.03, feather: 0.5, density: 1, ...(JSON.parse(localStorage.getItem('glimmr.develop.brush') ?? '{}') as Partial<BrushOptions>) }
    } catch {
      return { size: 0.03, feather: 0.5, density: 1 }
    }
  })
  const setBrush = (b: BrushOptions): void => {
    setBrushState(b)
    try {
      localStorage.setItem('glimmr.develop.brush', JSON.stringify(b))
    } catch {
      // Not remembered.
    }
  }
  const [hoverPt, setHoverPt] = useState<{ x: number; y: number } | null>(null)
  const [lutVersion, setLutVersion] = useState(0)
  const loadedLut = useRef<string | null>(null)
  const [open, setOpenState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const setOpen = (k: string, o: boolean): void =>
    setOpenState((x) => {
      const n = { ...x, [k]: o }
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(n))
      } catch {
        // Not remembered.
      }
      return n
    })

  const kind: SourceKind = src?.kind ?? catalogKind
  const shown = settings && hover ? lookSettings(settings, hover) : settings

  // ---- saving ----

  const save = useCallback(
    async (pid: number, next: DevelopSettings, label: string): Promise<void> => {
      try {
        const p = await api.developSave(pid, next, label)
        if (p) putPhotos([p])
        if (pid === idRef.current) setHistory(await api.developHistory(pid))
      } catch (e) {
        toast.error('The edit couldn’t be saved', { description: (e as Error).message })
      }
    },
    [putPhotos]
  )

  /** Ends a gesture: saves the settings as one history step. */
  const commit = useCallback((): void => {
    clearTimeout(commitTimer.current)
    const label = pendingLabel.current
    pendingLabel.current = null
    const next = settingsRef.current
    const prev = committedRef.current
    if (!label || !next || !prev || JSON.stringify(next) === JSON.stringify(prev)) return
    // Repeats of the same change (as the catalog's history merges them) undo together.
    const now = Date.now()
    if (!(lastStep.current.label === label && now - lastStep.current.at < 3000)) undoStack.current.push(prev)
    lastStep.current = { label, at: now }
    if (undoStack.current.length > 200) undoStack.current.shift()
    redoStack.current = []
    committedRef.current = next
    setCommitted(next)
    void save(idRef.current, next, label)
  }, [save])

  /** A live change; saved when the gesture ends (or shortly after, for changes with no gesture). */
  const change = useCallback(
    (label: string, f: (x: DevelopSettings) => DevelopSettings, keepStyle = false): void => {
      const cur = settingsRef.current
      if (!cur) return
      const next = f(cur)
      settingsRef.current = next
      setSettingsState(next)
      pendingLabel.current = label
      clearTimeout(commitTimer.current)
      commitTimer.current = setTimeout(commit, 1500)
      if (!keepStyle) setStyleAmt(null)
    },
    [commit]
  )

  const jump = useCallback(
    (next: DevelopSettings, label: string): void => {
      settingsRef.current = next
      setSettingsState(next)
      committedRef.current = next
      setCommitted(next)
      pendingLabel.current = null
      lastStep.current = { label: '', at: 0 }
      setStyleAmt(null)
      void save(idRef.current, next, label)
    },
    [save]
  )

  const undo = (): void => {
    commit()
    const prev = undoStack.current.pop()
    if (!prev || !settingsRef.current) return
    redoStack.current.push(settingsRef.current)
    jump(prev, 'Undo')
  }
  const redo = (): void => {
    const next = redoStack.current.pop()
    if (!next || !settingsRef.current) return
    undoStack.current.push(settingsRef.current)
    jump(next, 'Redo')
  }

  // ---- loading ----

  useEffect(() => {
    void ensurePhotos(d.ids)
  }, [d.ids, ensurePhotos])

  const refreshLooks = useCallback(async () => {
    const [st, lt] = await Promise.all([api.styles(), api.luts()])
    setStyles(st)
    setLuts(lt)
  }, [])
  useEffect(() => {
    void refreshLooks()
  }, [refreshLooks])

  const rev = photo?.rev ?? 0
  const photoReady = !!photo
  useEffect(() => {
    if (!photoReady) return
    idRef.current = id
    let live = true
    setError(null)
    setLoading(true)
    setStyleAmt(null)
    setHover(null)
    setEyedropper(false)
    setTargeted(null)
    undoStack.current = []
    redoStack.current = []
    void (async () => {
      try {
        const [{ settings: st, kind: k }, h] = await Promise.all([api.developGet(id), api.developHistory(id)])
        const source = await loadSource(id, rev)
        if (!live) return
        const initial = st ?? defaultSettings(k)
        settingsRef.current = initial
        committedRef.current = initial
        setCatalogKind(k)
        setSettingsState(initial)
        setCommitted(initial)
        setHistory(h)
        setSrc(source)
      } catch (e) {
        if (live) setError((e as Error).message.replace(/^Error invoking remote method 'api': Error: /, ''))
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
      // Save anything still pending for the photo being left.
      commit()
    }
    // Reload only for another photo, not for this photo's new revisions (which our own saves cause).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, photoReady])

  // ---- engine ----

  useEffect(() => {
    // The canvas is made here (not in JSX) so a remount gets a fresh WebGL context.
    const c = document.createElement('canvas')
    c.className = 'absolute inset-0 size-full'
    wrapRef.current!.prepend(c)
    canvasRef.current = c
    try {
      eng.current = new DevelopGL(c)
    } catch (e) {
      setGlError((e as Error).message)
    }
    const ro = new ResizeObserver(([entry]) => {
      const dpr = window.devicePixelRatio || 1
      setCanvasSize({ w: Math.max(1, Math.round(entry.contentRect.width * dpr)), h: Math.max(1, Math.round(entry.contentRect.height * dpr)) })
    })
    ro.observe(wrapRef.current!)
    return () => {
      ro.disconnect()
      eng.current?.dispose()
      eng.current = null
      c.remove()
      thumbs.dispose()
    }
  }, [thumbs])

  const beforeRef = useRef<Target | null>(null)
  const lastOut = useRef<Target | null>(null)
  useEffect(() => {
    if (!src) return
    beforeRef.current = null
    setZoom(null)
    try {
      thumbs.setSource(src)
      setThumbsReady((n) => n + 1)
    } catch {
      // No previews of looks.
    }
  }, [src, thumbs])

  // What the GPU renders: fitted, the editing copy shrunk to the size it's shown at (much faster, and what's seen is
  // the same); zoomed in, the whole editing copy.
  const [uploaded, setUploaded] = useState<{ width: number; height: number; for: EditSource } | null>(null)
  const fitLong = src ? Math.ceil(Math.min((canvasSize.w - 2 * FIT_PAD * (window.devicePixelRatio || 1)) / src.width, (canvasSize.h - 2 * FIT_PAD * (window.devicePixelRatio || 1)) / src.height) * Math.max(src.width, src.height)) : 0
  const wantLong = !src ? 0 : zoom || fitLong >= Math.max(src.width, src.height) * 0.8 ? Math.max(src.width, src.height) : Math.max(256, Math.ceil(fitLong / 64) * 64)
  useEffect(() => {
    const e = eng.current
    if (!e || !src || !wantLong) return
    const t = setTimeout(
      () => {
        const full = wantLong >= Math.max(src.width, src.height)
        const img = full ? src : shrink(src, wantLong)
        e.setSource(img.data, img.width, img.height)
        e.resetGrid()
        beforeRef.current = null
        setUploaded({ width: img.width, height: img.height, for: src })
      },
      // Window resizes settle first; zooming and new photos go at once.
      uploaded?.for === src && !zoom ? 150 : 0
    )
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, wantLong])

  // The LUT for what's shown.
  const lutKey = shown?.look.lut ?? null
  useEffect(() => {
    const e = eng.current
    if (!e) return
    if (!lutKey) {
      loadedLut.current = null
      return
    }
    let live = true
    void lutFor(lutKey).then((l) => {
      if (!live || !eng.current) return
      eng.current.setLut(l, lutKey)
      eng.current.setLutRange(l)
      loadedLut.current = lutKey
      setLutVersion((v) => v + 1)
    })
    return () => {
      live = false
    }
  }, [lutKey])

  // ---- drawing ----

  /** Where the photo sits on the canvas (device pixels). */
  const geometry = useCallback(
    (z: Zoom = zoom) => {
      const W = canvasSize.w
      const H = canvasSize.h
      if (!src) return { scale: 1, left: 0, top: 0, W, H, fit: 1 }
      const pad = FIT_PAD * (window.devicePixelRatio || 1)
      const fit = Math.min((W - 2 * pad) / src.width, (H - 2 * pad) / src.height)
      const scale = z ? z.scale : fit
      const cx = z ? z.cx : src.width / 2
      const cy = z ? z.cy : src.height / 2
      return { scale, left: W / 2 - cx * scale, top: H / 2 - cy * scale, W, H, fit }
    },
    [canvasSize, src, zoom]
  )

  const histTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastParams = useRef<ReturnType<typeof prepare> | null>(null)

  useEffect(() => {
    const e = eng.current
    const c = canvasRef.current
    if (!e || !c || !src || !shown || !uploaded || uploaded.for !== src) return
    const raf = requestAnimationFrame(() => {
      try {
        if (c.width !== canvasSize.w || c.height !== canvasSize.h) {
          c.width = canvasSize.w
          c.height = canvasSize.h
        }
        const info = { kind: src.kind, fullWidth: src.fullWidth, camera: src.camera, autoMul: src.autoMul }
        const scale = uploaded.width / src.fullWidth
        // Until a LUT has loaded, show without it rather than with the previous one.
        const use = shown.look.lut && loadedLut.current !== shown.look.lut ? { ...shown, look: { ...shown.look, lut: null } } : shown
        if (before !== 'off' && !beforeRef.current) beforeRef.current = e.keep(e.render(prepare(defaultSettings(catalogKind), info, scale)), 'before')
        const p = prepare(use, info, scale)
        const wb = { temp: Math.round(p.wb.temp), tint: Math.round(p.wb.tint) }
        if (wb.temp !== wbShown.temp || wb.tint !== wbShown.tint) setWbShown(wb)
        const sel = activeLayer ? shown.layers.find((l) => l.id === activeLayer) : null
        const out = e.render(p, { clipping, overlay: showMask && sel ? prepareLayer(sel) : null })
        const overlay = e.overlayMask
        lastOut.current = out
        lastParams.current = p
        // The histogram follows once changes pause (reading pixels back stalls the GPU).
        clearTimeout(histTimer.current)
        histTimer.current = setTimeout(() => {
          const eng2 = eng.current
          const lp = lastParams.current
          if (!eng2 || !lp || !lastOut.current) return
          try {
            // With the clipping overlay on, render once more without it (into the same target; the screen keeps
            // the overlay).
            const plain = clipping ? eng2.render(lp) : lastOut.current
            lastOut.current = plain
            setHist(histogramOf(eng2.read(plain) as Uint8Array))
          } catch {
            // No histogram this time.
          }
        }, 200)
        const g = geometry()
        const w = src.width * g.scale
        const h = src.height * g.scale
        const view: [number, number, number, number] = [g.left / g.W, 1 - (g.top + h) / g.H, w / g.W, h / g.H]
        if (before === 'full' && beforeRef.current) e.present(beforeRef.current, view, { bg: BG })
        else e.present(out, view, { before: before === 'split' ? beforeRef.current : null, splitAt, bg: BG, overlay })
      } catch (err) {
        setGlError((err as Error).message)
      }
    })
    return () => cancelAnimationFrame(raf)
    // wbShown is only compared, to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, uploaded, shown, before, splitAt, clipping, canvasSize, geometry, lutVersion, catalogKind, activeLayer, showMask])

  // ---- pointer ----

  const toImage = (e: { clientX: number; clientY: number }): { x: number; y: number; inside: boolean } => {
    const r = wrapRef.current!.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const g = geometry()
    const x = ((e.clientX - r.left) * dpr - g.left) / g.scale
    const y = ((e.clientY - r.top) * dpr - g.top) / g.scale
    return { x, y, inside: !!src && x >= 0 && y >= 0 && x < src.width && y < src.height }
  }

  const gesture = useRef<{
    kind: 'pan' | 'target' | 'split' | 'click' | 'paint' | 'linear' | 'radial' | 'handle'
    x0: number
    y0: number
    z?: Zoom
    base?: DevelopSettings
    weights?: number[]
    moved: boolean
    layer?: string
    index?: number
    handle?: string
  } | null>(null)

  const layerObj: Layer | null = (activeLayer && settings?.layers.find((l) => l.id === activeLayer)) || null
  const longEdge = src ? Math.max(src.width, src.height) : 1
  /** Changes one shape of a layer's mask. */
  const updateShape = (layerId: string, index: number, label: string, f: (sh: MaskShape) => MaskShape): void =>
    updateLayer(change, layerId, label, (l) => ({ ...l, mask: { ...l.mask, shapes: l.mask.shapes.map((sh, i) => (i === index ? f(sh) : sh)) } }))

  const addLayer = (kind: 'brush' | 'linear' | 'radial'): void => {
    if (!settingsRef.current || settingsRef.current.layers.length >= MAX_LAYERS) return
    const n = settingsRef.current.layers.length + 1
    const l = newLayer(kind === 'brush' ? `Brush ${n}` : kind === 'linear' ? `Gradient ${n}` : `Radial ${n}`)
    change('Add layer', (x) => ({ ...x, layers: [...x.layers, l] }))
    commit()
    setActiveLayer(l.id)
    setTool(kind)
  }

  const clampZoom = (z: Zoom): Zoom => {
    if (!z || !src) return z
    const g = geometry(null)
    if (z.scale <= g.fit * 1.001) return null
    const halfW = g.W / 2 / z.scale
    const halfH = g.H / 2 / z.scale
    const cx = src.width <= 2 * halfW ? src.width / 2 : Math.min(src.width - halfW, Math.max(halfW, z.cx))
    const cy = src.height <= 2 * halfH ? src.height / 2 : Math.min(src.height - halfH, Math.max(halfH, z.cy))
    return { scale: Math.min(8, z.scale), cx, cy }
  }

  /** Zooms to a scale keeping a canvas point (client coordinates) still. */
  const zoomAround = (scale: number, clientX?: number, clientY?: number): void => {
    if (!src) return
    const g = geometry()
    const r = wrapRef.current!.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const px = clientX == null ? g.W / 2 : (clientX - r.left) * dpr
    const py = clientY == null ? g.H / 2 : (clientY - r.top) * dpr
    const ix = (px - g.left) / g.scale
    const iy = (py - g.top) / g.scale
    const cx = ix - (px - g.W / 2) / scale
    const cy = iy - (py - g.H / 2) / scale
    setZoom(clampZoom({ scale, cx, cy }))
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0 || !src || !settings) return
    const p = toImage(e)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (before === 'split') {
      const r = wrapRef.current!.getBoundingClientRect()
      const at = (e.clientX - r.left) / r.width
      if (Math.abs(at - splitAt) < 0.02) {
        gesture.current = { kind: 'split', x0: e.clientX, y0: e.clientY, moved: false }
        return
      }
    }
    if (layerObj && tool) {
      const u = p.x / src.width
      const v = p.y / src.height
      const index = layerObj.mask.shapes.length
      const base = { x0: e.clientX, y0: e.clientY, moved: false, layer: layerObj.id, index }
      if (tool === 'brush' || tool === 'erase') {
        const erase = tool === 'erase' || e.altKey
        const stroke: BrushStroke = { kind: 'brush', erase, size: brush.size, feather: brush.feather, density: brush.density, points: [+u.toFixed(5), +v.toFixed(5)] }
        updateLayer(change, layerObj.id, erase ? 'Erase' : 'Brush', (l) => ({ ...l, mask: { ...l.mask, shapes: [...l.mask.shapes, stroke] } }))
        gesture.current = { ...base, kind: 'paint' }
      } else if (tool === 'linear') {
        updateLayer(change, layerObj.id, 'Linear gradient', (l) => ({ ...l, mask: { ...l.mask, shapes: [...l.mask.shapes, { kind: 'linear', x0: u, y0: v, x1: u, y1: v }] } }))
        gesture.current = { ...base, kind: 'linear' }
      } else {
        updateLayer(change, layerObj.id, 'Radial gradient', (l) => ({ ...l, mask: { ...l.mask, shapes: [...l.mask.shapes, { kind: 'radial', cx: u, cy: v, rx: 0.002, ry: 0.002, angle: 0, feather: 0.5, invert: false }] } }))
        gesture.current = { ...base, kind: 'radial' }
      }
      return
    }
    if (eyedropper) {
      if (!p.inside) return
      const wb = neutralAt(src, p.x, p.y)
      change('White balance picker', (x) => ({ ...x, wb: { mode: 'custom', temp: Math.round(wb.temp / (kind === 'raw' ? 10 : 1)) * (kind === 'raw' ? 10 : 1), tint: Math.round(wb.tint) } }))
      commit()
      setEyedropper(false)
      return
    }
    if (targeted && p.inside && lastOut.current && eng.current) {
      // The colour under the pointer, as shown, decides which bands move.
      const k = lastOut.current.w / src.width
      const c = eng.current.pixel(lastOut.current, p.x * k, p.y * k)
      const lin = mul3(convert('srgb', 'rec2020'), [srgbDecode(c[0]), srgbDecode(c[1]), srgbDecode(c[2])])
      const lab = toOklab(lin)
      const hue = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI
      gesture.current = { kind: 'target', x0: e.clientX, y0: e.clientY, base: settings, weights: bandWeights(hue), moved: false }
      return
    }
    gesture.current = { kind: zoom ? 'pan' : 'click', x0: e.clientX, y0: e.clientY, z: zoom, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const g0 = gesture.current
    if (!g0) return
    const dx = e.clientX - g0.x0
    const dy = e.clientY - g0.y0
    if (Math.abs(dx) + Math.abs(dy) > 3) g0.moved = true
    if ((g0.kind === 'paint' || g0.kind === 'linear' || g0.kind === 'radial' || g0.kind === 'handle') && src && g0.layer != null && g0.index != null) {
      const p = toImage(e)
      const u = p.x / src.width
      const v = p.y / src.height
      const ax = src.width / longEdge
      const ay = src.height / longEdge
      const painted = g0.kind === 'paint' ? settingsRef.current?.layers.find((l) => l.id === g0.layer)?.mask.shapes[g0.index] : null
      const label = g0.kind === 'paint' ? (painted?.kind === 'brush' && painted.erase ? 'Erase' : 'Brush') : g0.kind === 'linear' ? 'Linear gradient' : g0.kind === 'radial' ? 'Radial gradient' : 'Move mask'
      updateShape(g0.layer, g0.index, label, (sh) => {
        if (sh.kind === 'brush') {
          const pts = sh.points
          const lx = pts[pts.length - 2]
          const ly = pts[pts.length - 1]
          // Points every tenth of a radius are plenty: dabs are spaced along the line between them.
          if (Math.hypot((u - lx) * ax, (v - ly) * ay) < sh.size * 0.1) return sh
          return { ...sh, points: [...pts, +u.toFixed(5), +v.toFixed(5)] }
        }
        if (sh.kind === 'linear') {
          if (g0.kind === 'linear' || g0.handle === 'b') return { ...sh, x1: u, y1: v }
          if (g0.handle === 'a') return { ...sh, x0: u, y0: v }
          // Move the whole gradient.
          const du = u - (sh.x0 + sh.x1) / 2
          const dv = v - (sh.y0 + sh.y1) / 2
          return { ...sh, x0: sh.x0 + du, y0: sh.y0 + dv, x1: sh.x1 + du, y1: sh.y1 + dv }
        }
        const dx = (u - sh.cx) * ax
        const dy = (v - sh.cy) * ay
        if (g0.kind === 'radial') {
          const r = Math.max(0.002, Math.hypot(dx, dy))
          return { ...sh, rx: r, ry: r }
        }
        if (g0.handle === 'c') return { ...sh, cx: u, cy: v }
        // Radius handles: along the ellipse's own axes.
        const c = Math.cos(sh.angle)
        const sn = Math.sin(sh.angle)
        if (g0.handle === 'rx') return { ...sh, rx: Math.max(0.002, Math.abs(dx * c + dy * sn)), angle: e.shiftKey ? Math.atan2(dy, dx) : sh.angle }
        return { ...sh, ry: Math.max(0.002, Math.abs(-dx * sn + dy * c)) }
      })
      return
    }
    if (g0.kind === 'split') {
      const r = wrapRef.current!.getBoundingClientRect()
      setSplitAt(Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width)))
    } else if (g0.kind === 'pan' && g0.z) {
      const dpr = window.devicePixelRatio || 1
      setZoom(clampZoom({ ...g0.z, cx: g0.z.cx - (dx * dpr) / g0.z.scale, cy: g0.z.cy - (dy * dpr) / g0.z.scale }))
    } else if (g0.kind === 'target' && g0.base && g0.weights && targeted) {
      const amt = -dy * 0.4
      const w = g0.weights
      const base = g0.base
      const bump = (arr: number[]): number[] => arr.map((v, i) => Math.round(Math.min(100, Math.max(-100, v + amt * w[i]))))
      if (targeted === 'bw') change('Black and white mix', () => ({ ...base, bw: { ...base.bw, mix: bump(base.bw.mix) } }))
      else change(targeted === 'hue' ? 'Hue' : targeted === 'sat' ? 'Saturation' : 'Luminance', () => ({ ...base, hsl: { ...base.hsl, [targeted]: bump(base.hsl[targeted]) } }))
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const g0 = gesture.current
    gesture.current = null
    if (!g0) return
    if (g0.kind === 'target' || g0.kind === 'paint' || g0.kind === 'linear' || g0.kind === 'radial' || g0.kind === 'handle') commit()
    else if (!g0.moved && (g0.kind === 'click' || g0.kind === 'pan')) {
      // Click: 100% at the point, or back to fit.
      if (zoom) setZoom(null)
      else zoomAround(1, e.clientX, e.clientY)
    }
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (!src) return
    const g = geometry()
    zoomAround(Math.max(g.fit, Math.min(8, g.scale * Math.exp(-e.deltaY * 0.0015))), e.clientX, e.clientY)
  }

  // ---- actions ----

  const close = useCallback(() => {
    commit()
    s.closeDevelop()
  }, [commit, s])

  const go = (delta: number): void => {
    const i = d.index + delta
    if (i < 0 || i >= d.ids.length) return
    commit()
    s.setDevelop({ ...d, index: i })
  }

  const reset = (): void => {
    change('Reset', () => ({ ...defaultSettings(catalogKind) }))
    commit()
  }

  const paste = (): void => {
    const clip = s.developClip
    if (!clip || !settings) return
    // White balance in kelvin doesn't carry to other kinds of file.
    const p = { ...clip }
    if (p.wb && p.wb.mode === 'custom' && (kind === 'raw') !== p.wb.temp > 200) delete p.wb
    change('Paste settings', (x) => applyPartial(x, p))
    commit()
    toast('Settings pasted', { duration: 1500 })
  }

  const applyLook = (l: Look): void => {
    if (!settings) return
    const base = settingsRef.current!
    change(l.kind === 'style' ? l.style.name : `LUT ${l.lut.name}`, (x) => lookSettings(x, l))
    commit()
    setHover(null)
    if (l.kind === 'style') setStyleAmt({ style: l.style, base, amount: 100 })
  }

  const saveStyle = async (groups: Group[], name: string): Promise<void> => {
    if (!settings) return
    await api.saveStyle(name, pick(settings, groups))
    await refreshLooks()
    toast.success(`Saved the style “${name}”`)
  }

  // ---- keys ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e) || document.querySelector('[role="menu"], [data-slot="dialog-content"], [data-slot="select-content"]')) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const inSlider = !!(e.target as HTMLElement)?.closest?.('[role="slider"]')
      if (e.key === 'Escape') {
        if (eyedropper || targeted) {
          setEyedropper(false)
          setTargeted(null)
        } else if (tool) setTool(null)
        else if (activeLayer) setActiveLayer(null)
        else close()
        return
      }
      if (mod && k === 'z') {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (mod && k === 'y') {
        e.preventDefault()
        return redo()
      }
      if (mod && e.shiftKey && k === 'c') {
        e.preventDefault()
        return setGroupsAsk('copy')
      }
      if (mod && e.shiftKey && k === 'v') {
        e.preventDefault()
        return paste()
      }
      if (mod && e.shiftKey && k === 'e') {
        e.preventDefault()
        return setExportIds([id])
      }
      if (mod || e.altKey) return
      if (!inSlider && e.key === 'ArrowRight') return go(1)
      if (!inSlider && e.key === 'ArrowLeft') return go(-1)
      if (e.key === '\\') return setBefore((b) => (b === 'full' ? 'off' : 'full'))
      if (k === 'y') return setBefore((b) => (b === 'split' ? 'off' : 'split'))
      if (k === 'j') return setClipping((c) => !c)
      if (k === 'w') return setEyedropper((x) => !x)
      // Layers: B brush, E erase, G linear gradient, R radial gradient (a new layer when Background is selected), O mask.
      if (k === 'b' || k === 'g' || k === 'r') {
        const t = k === 'b' ? 'brush' : k === 'g' ? 'linear' : 'radial'
        if (!layerObj) return addLayer(t)
        return setTool((x) => (x === t ? null : t))
      }
      if (k === 'e' && layerObj) return setTool((x) => (x === 'erase' ? null : 'erase'))
      if (k === 'o' && layerObj) return setShowMask((x) => !x)
      if ((e.key === '[' || e.key === ']') && (tool === 'brush' || tool === 'erase')) return setBrush({ ...brush, size: Math.min(0.3, Math.max(0.002, brush.size * (e.key === ']' ? 1.25 : 0.8))) })
      if (k === 'z') {
        e.preventDefault()
        return zoom ? setZoom(null) : zoomAround(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A fresh split starts in the middle.
  useEffect(() => {
    if (before !== 'split') setSplitAt(0.5)
  }, [before])

  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    stripRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [d.index])

  const iconButton = (label: string, hint: string, icon: React.ReactNode, onClick: () => void, opts: { pressed?: boolean; disabled?: boolean } = {}) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={opts.pressed} disabled={opts.disabled} onClick={onClick} className={cn(opts.pressed && 'bg-white/15 text-ink')}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )

  /** Gradient handles and the brush cursor, drawn over the photo (CSS pixels). */
  const MaskHandles = (): React.ReactElement | null => {
    if (!src || !layerObj) return null
    const g = geometry()
    const dpr = window.devicePixelRatio || 1
    const at = (u: number, v: number): [number, number] => [(g.left + u * src.width * g.scale) / dpr, (g.top + v * src.height * g.scale) / dpr]
    const px = (r: number): number => (r * longEdge * g.scale) / dpr
    const grab = (index: number, handle: string) => (e: React.PointerEvent): void => {
      if (e.button !== 0) return
      e.stopPropagation()
      wrapRef.current!.setPointerCapture(e.pointerId)
      gesture.current = { kind: 'handle', x0: e.clientX, y0: e.clientY, moved: false, layer: layerObj.id, index, handle }
    }
    const dot = (x: number, y: number, index: number, handle: string, label: string) => (
      <circle key={`${index}${handle}`} cx={x} cy={y} r={6} className="cursor-move fill-white stroke-black/60" strokeWidth={1.5} style={{ pointerEvents: 'auto' }} onPointerDown={grab(index, handle)} aria-label={label} />
    )
    const painting = tool === 'brush' || tool === 'erase'
    return (
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        {!painting &&
          layerObj.mask.shapes.map((sh, i) => {
            if (sh.kind === 'linear') {
              const a = at(sh.x0, sh.y0)
              const b = at(sh.x1, sh.y1)
              const dx = b[0] - a[0]
              const dy = b[1] - a[1]
              const len = Math.hypot(dx, dy) || 1
              const nx = (-dy / len) * 2000
              const ny = (dx / len) * 2000
              const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
              return (
                <g key={i}>
                  <line x1={a[0] - nx} y1={a[1] - ny} x2={a[0] + nx} y2={a[1] + ny} className="stroke-white/80" strokeWidth={1} />
                  <line x1={b[0] - nx} y1={b[1] - ny} x2={b[0] + nx} y2={b[1] + ny} className="stroke-white/50" strokeDasharray="4 4" strokeWidth={1} />
                  <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="stroke-white/80" strokeWidth={1} />
                  {dot(a[0], a[1], i, 'a', 'Gradient start')}
                  {dot(b[0], b[1], i, 'b', 'Gradient end')}
                  <rect x={m[0] - 5} y={m[1] - 5} width={10} height={10} className="cursor-move fill-white stroke-black/60" style={{ pointerEvents: 'auto' }} onPointerDown={grab(i, 'm')} aria-label="Move gradient" />
                </g>
              )
            }
            if (sh.kind === 'radial') {
              const c = at(sh.cx, sh.cy)
              const deg = (sh.angle * 180) / Math.PI
              const rx = px(sh.rx)
              const ry = px(sh.ry)
              const co = Math.cos(sh.angle)
              const sn = Math.sin(sh.angle)
              return (
                <g key={i}>
                  <ellipse cx={c[0]} cy={c[1]} rx={rx} ry={ry} transform={`rotate(${deg} ${c[0]} ${c[1]})`} className="fill-none stroke-white/80" strokeWidth={1} />
                  <ellipse cx={c[0]} cy={c[1]} rx={rx * (1 - sh.feather)} ry={ry * (1 - sh.feather)} transform={`rotate(${deg} ${c[0]} ${c[1]})`} className="fill-none stroke-white/40" strokeDasharray="4 4" strokeWidth={1} />
                  {dot(c[0], c[1], i, 'c', 'Move')}
                  {dot(c[0] + rx * co, c[1] + rx * sn, i, 'rx', 'Width (Shift to rotate)')}
                  {dot(c[0] - ry * sn, c[1] + ry * co, i, 'ry', 'Height')}
                </g>
              )
            }
            return null
          })}
        {painting && hoverPt && <circle cx={hoverPt.x} cy={hoverPt.y} r={Math.max(2, px(brush.size))} className={cn('fill-none', tool === 'erase' ? 'stroke-red-300' : 'stroke-white')} strokeWidth={1.5} />}
        {painting && hoverPt && <circle cx={hoverPt.x} cy={hoverPt.y} r={Math.max(1, px(brush.size) * (1 - brush.feather))} className="fill-none stroke-white/40" strokeWidth={1} />}
      </svg>
    )
  }

  const edited = !!settings && (changedGroups(settings, catalogKind).length > 0 || settings.styles.length > 0)
  const cursor = layerObj && (tool === 'brush' || tool === 'erase') ? 'none' : (layerObj && tool) || eyedropper || targeted ? 'crosshair' : zoom ? 'grab' : 'zoom-in'
  const currentSeq = history.length && committed ? (history.findLast((h) => JSON.stringify(h.settings) === JSON.stringify(committed))?.seq ?? null) : null

  return (
    <div className="fixed inset-0 z-50 grid grid-cols-[248px_minmax(0,1fr)_300px] grid-rows-[48px_minmax(0,1fr)_84px] bg-[#111] text-ink" role="dialog" aria-modal="true" aria-label="Develop">
      <header className="app-drag titlebar-inset col-span-3 flex items-center gap-2 border-b border-white/10 bg-panel px-2">
        <div className={cn('flex items-center gap-1', mac && 'pl-[76px]')}>
          {iconButton('Back to library', 'Back to library (Esc)', <ArrowLeft />, close)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{photo?.filename ?? ''}</div>
          <div className="tnum text-[11px] text-ink-muted">
            {d.index + 1} of {d.ids.length}
            {src && src.kind !== catalogKind && ' · The raw data couldn’t be read, so this is developed from its preview'}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          {iconButton('Before and after', 'Before (\\)', <Columns2 />, () => setBefore((b) => (b === 'full' ? 'off' : 'full')), { pressed: before === 'full' })}
          {iconButton('Split before and after', 'Split before and after (Y)', <SquareSplitHorizontal />, () => setBefore((b) => (b === 'split' ? 'off' : 'split')), { pressed: before === 'split' })}
          {iconButton('Show clipping', 'Show clipping (J)', <TriangleAlert />, () => setClipping((c) => !c), { pressed: clipping })}
          {iconButton('Zoom in', 'Zoom in (Z, or click the photo)', <ZoomIn />, () => (zoom ? setZoom(null) : zoomAround(1)), { pressed: !!zoom })}
          <div className="mx-1 h-5 w-px bg-white/10" />
          {iconButton('Copy settings', `Copy settings (${MOD}Shift+C)`, <ClipboardCopy />, () => setGroupsAsk('copy'), { disabled: !settings })}
          {iconButton('Paste settings', `Paste settings (${MOD}Shift+V)`, <ClipboardPaste />, paste, { disabled: !s.developClip })}
          {iconButton('Reset all', 'Reset all settings', <RotateCcw />, () => void confirmDialog({ title: 'Reset all develop settings?', description: 'The photo goes back to how Glimmr shows it unedited. You can undo this, or pick an earlier step in History.', confirmLabel: 'Reset' }).then((ok) => ok && reset()), { disabled: !edited })}
          <Button size="sm" className="ml-1" onClick={() => setExportIds([id])}>
            <Download data-icon="inline-start" />
            Export
          </Button>
        </div>
      </header>

      <aside className="row-span-2 flex min-h-0 flex-col border-r border-white/10 bg-panel">
        <div className="flex gap-1 border-b border-white/10 p-1.5" role="tablist">
          {(
            [
              ['looks', 'Styles'],
              ['history', 'History']
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={leftTab === k} onClick={() => setLeftTab(k)} className={cn('h-7 flex-1 rounded text-[12px] text-ink-muted hover:bg-white/10', leftTab === k && 'bg-white/15 text-ink')}>
              {l}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {leftTab === 'looks' ? (
            <LooksPanel
              styles={styles}
              luts={luts}
              base={committed}
              thumbs={glError ? null : thumbs}
              thumbsReady={thumbsReady}
              onHover={setHover}
              onApply={applyLook}
              onImport={async () => {
                const r = await api.importLooks()
                await refreshLooks()
                const n = r.luts.length + r.styles.length
                if (n) toast.success(`Added ${r.luts.length ? `${r.luts.length} LUT${r.luts.length === 1 ? '' : 's'}` : ''}${r.luts.length && r.styles.length ? ' and ' : ''}${r.styles.length ? `${r.styles.length} style${r.styles.length === 1 ? '' : 's'}` : ''}`)
                if (r.failed.length) toast.error(`${r.failed.length} file${r.failed.length === 1 ? '' : 's'} couldn’t be added`, { description: r.failed.slice(0, 4).map((f) => `${f.file}: ${f.error}`).join('\n'), duration: 10000 })
              }}
              onSaveStyle={() => setGroupsAsk('style')}
              onRenameStyle={async (st) => {
                const name = await promptDialog({ title: 'Rename style', confirmLabel: 'Rename', initial: st.name })
                if (name?.trim()) {
                  await api.renameStyle(st.id, name)
                  await refreshLooks()
                }
              }}
              onDeleteStyle={async (st) => {
                if (await confirmDialog({ title: `Delete the style “${st.name}”?`, description: 'Photos it was applied to keep their settings.', confirmLabel: 'Delete', destructive: true })) {
                  await api.deleteStyle(st.id)
                  await refreshLooks()
                }
              }}
              onExportStyle={(st) => void api.exportStyle(st.id)}
              onRemoveLut={async (l) => {
                await api.removeLut(l.sha)
                await refreshLooks()
              }}
            />
          ) : (
            <HistoryPanel
              steps={history}
              current={currentSeq}
              onPick={(seq) => {
                const h = history.find((x) => x.seq === seq)
                if (!h || !settingsRef.current) return
                commit()
                undoStack.current.push(settingsRef.current)
                redoStack.current = []
                jump(h.settings, `Back to “${h.label}”`)
              }}
            />
          )}
        </div>
      </aside>

      <main
        ref={wrapRef}
        className="relative min-h-0 min-w-0 overflow-hidden"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => {
          if (tool === 'brush' || tool === 'erase') {
            const r = wrapRef.current!.getBoundingClientRect()
            setHoverPt({ x: e.clientX - r.left, y: e.clientY - r.top })
          }
          onPointerMove(e)
        }}
        onPointerLeave={() => setHoverPt(null)}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        {before === 'split' && (
          <>
            <div className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: `${splitAt * 100}%` }} aria-hidden />
            <div className="pointer-events-none absolute top-0 bottom-0 w-4 -translate-x-1/2 cursor-col-resize" style={{ left: `${splitAt * 100}%` }} aria-hidden />
            <span className="pointer-events-none absolute top-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px]" style={{ right: `${(1 - splitAt) * 100 + 1}%` }}>
              Before
            </span>
            <span className="pointer-events-none absolute top-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px]" style={{ left: `${splitAt * 100 + 1}%` }}>
              After
            </span>
          </>
        )}
        {before === 'full' && <span className="pointer-events-none absolute top-3 left-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px]">Before</span>}
        {src && layerObj && <MaskHandles />}
        {hover && <span className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px]">Previewing {hover.kind === 'style' ? hover.style.name : hover.lut.name}</span>}
        {zoom && src && (
          <span className="tnum pointer-events-none absolute right-3 bottom-3 rounded bg-black/60 px-1.5 py-0.5 text-[11px]" title="Of the original’s full size">
            {Math.round(((zoom.scale * src.width) / src.fullWidth) * 100)}%
          </span>
        )}
        {(loading || error || glError) && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            {glError ? (
              <p className="max-w-sm text-[13px] text-ink-muted">Develop needs WebGL 2 with float textures, which this computer’s graphics don’t offer ({glError}).</p>
            ) : error ? (
              <p className="max-w-sm text-[13px] text-ink-muted">This photo couldn’t be opened for editing: {error}</p>
            ) : (
              <Loader2 className="size-6 animate-spin text-ink-muted" aria-label="Loading" />
            )}
          </div>
        )}
      </main>

      <aside className="row-span-2 flex min-h-0 flex-col border-l border-white/10 bg-panel">
        <div className="border-b border-white/10 p-3">
          <HistogramView h={hist} clipping={clipping} onToggleClipping={() => setClipping((c) => !c)} />
          {photo && (
            <div className="tnum mt-1.5 flex justify-between text-[11px] text-ink-muted">
              <span>{photo.iso ? `ISO ${photo.iso}` : ''}</span>
              <span>{photo.focal ? `${Math.round(photo.focal)} mm` : ''}</span>
              <span>{photo.aperture ? `f/${photo.aperture}` : ''}</span>
              <span>{photo.shutter ? (photo.shutter >= 1 ? `${photo.shutter}s` : `1/${Math.round(1 / photo.shutter)}s`) : ''}</span>
            </div>
          )}
        </div>
        {settings && (
          <LayerList
            s={settings}
            active={activeLayer}
            setActive={(id) => {
              setActiveLayer(id)
              if (!id) setTool(null)
            }}
            change={change}
            commit={commit}
            setTool={setTool}
          />
        )}
        {styleAmt && settings && !layerObj && (
          <div className="flex flex-col gap-1.5 border-b border-white/10 p-3">
            <div className="flex justify-between text-[12px]">
              <span className="truncate">{styleAmt.style.name}</span>
              <span className="tnum text-ink-muted">{styleAmt.amount}%</span>
            </div>
            <Slider
              min={0}
              max={150}
              step={1}
              value={[styleAmt.amount]}
              aria-label={`${styleAmt.style.name} amount`}
              onValueChange={([a]) => {
                setStyleAmt({ ...styleAmt, amount: a })
                change(`${styleAmt.style.name} amount`, (x) => ({ ...applyPartial(styleAmt.base, styleAmt.style.settings, a / 100), styles: x.styles }), true)
              }}
              onValueCommit={commit}
            />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {settings && layerObj && (
            <LayerPanel
              layer={layerObj}
              change={change}
              commit={commit}
              tool={tool}
              setTool={setTool}
              brush={brush}
              setBrush={setBrush}
              showMask={showMask}
              setShowMask={setShowMask}
              open={open}
              setOpen={setOpen}
            />
          )}
          {settings && !layerObj && (
            <Adjustments
              s={settings}
              kind={kind}
              wb={wbShown}
              change={change}
              commit={commit}
              histogram={hist?.l ?? null}
              luts={luts}
              eyedropper={eyedropper}
              setEyedropper={(on) => {
                setEyedropper(on)
                if (on) setTargeted(null)
              }}
              targeted={targeted}
              setTargeted={(t) => {
                setTargeted(t)
                if (t) setEyedropper(false)
              }}
              open={open}
              setOpen={setOpen}
            />
          )}
        </div>
      </aside>

      <div ref={stripRef} className="col-start-2 row-start-3 flex items-center gap-1.5 overflow-x-auto border-t border-white/10 bg-panel px-2" aria-label="Filmstrip">
        {d.ids.map((pid, i) => {
          const p = s.cache.get(pid)
          return (
            <button
              key={pid}
              type="button"
              aria-current={i === d.index}
              aria-label={p?.filename ?? `Photo ${i + 1}`}
              onClick={() => {
                commit()
                s.setDevelop({ ...d, index: i })
              }}
              className={cn('relative h-16 shrink-0 overflow-hidden rounded border-2 border-transparent', i === d.index ? 'border-white' : 'opacity-70 hover:opacity-100')}
            >
              {p && <img src={thumbUrl(pid, p.rev)} alt="" className="h-full w-auto object-contain" draggable={false} loading="lazy" />}
              {p?.developed && <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-white shadow" aria-label="Edited" />}
            </button>
          )
        })}
      </div>

      {exportIds && <ExportDialog ids={exportIds} onClose={() => setExportIds(null)} />}
      {groupsAsk && settings && (
        <GroupsDialog
          title={groupsAsk === 'copy' ? 'Copy settings' : 'Save as a style'}
          description={groupsAsk === 'copy' ? `Choose what to copy. Paste with ${MOD}Shift+V here, or on photos in the library.` : 'Choose what the style sets. Settings it leaves out stay as they are on each photo.'}
          confirmLabel={groupsAsk === 'copy' ? 'Copy' : 'Save Style'}
          withName={groupsAsk === 'style'}
          initial={(() => {
            const ch = changedGroups(settings, catalogKind)
            // White balance and detail are usually per photo; leave them out unless they're all that changed.
            const pref = ch.filter((g) => g !== 'wb' && g !== 'layers' && (groupsAsk === 'copy' || g !== 'detail'))
            return pref.length ? pref : ch.length ? ch : ALL_GROUPS.filter((g) => g !== 'wb')
          })()}
          onDone={(r) => {
            const which = groupsAsk
            setGroupsAsk(null)
            if (!r) return
            if (which === 'copy') {
              s.setDevelopClip(pick(settings, r.groups))
              toast('Settings copied', { description: r.groups.map((g) => GROUPS[g].label).join(', '), duration: 2000 })
            } else void saveStyle(r.groups, r.name)
          }}
        />
      )}
    </div>
  )
}
