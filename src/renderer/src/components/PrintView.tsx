import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, FileDown, FolderOpen, Link2, Link2Off, Plus, Printer, RefreshCw, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { promptDialog } from '../dialogs'
import { editedSize } from '../../../shared/edit'
import {
  BUILT_IN_PRESETS,
  captionText,
  computeLayout,
  fromUnits,
  LOW_PPI,
  PACKAGE_TEMPLATES,
  PAPERS,
  PPI_CHOICES,
  PRINT_SIZES,
  toUnits,
  withDefaults,
  type CaptionField,
  type Layout,
  type PackageItem,
  type Placement,
  type PrintPhoto,
  type PrintPreset,
  type PrintSettings,
  type Units
} from '../../../shared/print'
import { overlaySvg } from '../../../shared/printOverlay'
import type { IccProfile, PrinterInfo } from '../../../shared/types'

const mac = navigator.userAgent.includes('Mac')
const CHART_ID = -1
const CHART_SIZE = { w: 7.5 * 300, h: 10 * 300 }

const CAPTION_FIELDS: { key: CaptionField; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'filename', label: 'File name' },
  { key: 'date', label: 'Date taken' },
  { key: 'exposure', label: 'Exposure' },
  { key: 'caption', label: 'Caption' },
  { key: 'rating', label: 'Rating' },
  { key: 'custom', label: 'Custom text' }
]

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <CollapsibleTrigger className="flex h-10 w-full items-center gap-1.5 px-4 text-[13px] font-medium hover:bg-accent/50">
        <ChevronRight className={cn('size-3.5 text-ink-muted transition-transform', open && 'rotate-90')} aria-hidden />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 px-4 pt-1 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={htmlFor} className="text-xs font-normal text-ink-muted">
          {label}
        </Label>
        <div className="flex min-w-0 items-center gap-1.5">{children}</div>
      </div>
      {hint && <p className="text-[11px] leading-snug text-ink-muted">{hint}</p>}
    </div>
  )
}

function SwitchField({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  )
}

/** A length in the chosen units, stored in inches. */
function Length({ value, units, onChange, label, min = 0, max = 60 }: { value: number; units: Units; onChange: (inches: number) => void; label: string; min?: number; max?: number }) {
  const shown = Number(toUnits(value, units).toFixed(units === 'mm' ? 1 : 2))
  const [text, setText] = useState(String(shown))
  useEffect(() => setText(String(shown)), [shown])
  const commit = (): void => {
    const n = Number(text.replace(',', '.'))
    if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, fromUnits(n, units))))
    else setText(String(shown))
  }
  return (
    <div className="flex items-center gap-1">
      <Input aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} className="tnum h-7 w-16 px-2 text-right text-xs" inputMode="decimal" />
      <span className="w-5 text-[11px] text-ink-muted">{units === 'in' ? 'in' : units}</span>
    </div>
  )
}

function NumberBox({ value, onChange, label, min, max, step = 1, suffix }: { value: number; onChange: (v: number) => void; label: string; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
        }}
        className="tnum h-7 w-16 px-2 text-right text-xs"
      />
      {suffix && <span className="w-5 text-[11px] text-ink-muted">{suffix}</span>}
    </div>
  )
}

function ColorBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded-md border bg-transparent p-0.5" />
}

const PROFILE_GROUPS: { kind: IccProfile['kind']; label: string }[] = [
  { kind: 'printer', label: 'Printer and paper' },
  { kind: 'space', label: 'Colour spaces' },
  { kind: 'display', label: 'Displays' },
  { kind: 'other', label: 'Other' }
]

/** The print workspace: settings on the right, a live page preview on the left. */
export function PrintView() {
  const s = useStore()
  const job = s.printJob!
  const [settings, setSettingsState] = useState<PrintSettings>(() => withDefaults(s.settings?.print.last))
  const [placements, setPlacements] = useState<Record<number, Placement>>({})
  const [page, setPage] = useState(0)
  const [printers, setPrinters] = useState<PrinterInfo[] | null>(null)
  const [profiles, setProfiles] = useState<IccProfile[] | null>(null)
  const [preview, setPreview] = useState<{ key: string; cells: { src: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; files?: string[] } | null>(null)
  const [linkMargins, setLinkMargins] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 })
  const drag = useRef<{ id: number; x: number; y: number; start: Placement; rotate: boolean; boxPx: { w: number; h: number }; crop: { w: number; h: number } } | null>(null)

  const set = (patch: Partial<PrintSettings>): void => {
    setResult(null)
    setSettingsState((p) => ({ ...p, ...patch }))
  }
  const units = settings.units

  // Remember the settings for next time.
  useEffect(() => {
    const t = setTimeout(() => void s.setSettings({ print: { ...(s.settings?.print ?? { presets: [] }), last: settings } }), 600)
    return () => clearTimeout(t)
  }, [settings])

  const loadPrinters = (): void => {
    setPrinters(null)
    void api.printers().then((list) => {
      setPrinters(list)
      setSettingsState((p) => (p.printer && list.some((x) => x.name === p.printer) ? p : { ...p, printer: list[0]?.name ?? null }))
    })
  }
  const loadProfiles = (): void => void api.printProfiles().then(setProfiles)
  useEffect(() => {
    loadPrinters()
    loadProfiles()
  }, [])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStageBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The photos to lay out, at their edited shapes.
  const ids = job.chart ? [CHART_ID] : job.ids
  useEffect(() => void s.ensurePhotos(job.ids), [job.ids])
  const photos: PrintPhoto[] = job.chart
    ? [{ id: CHART_ID, ...CHART_SIZE }]
    : job.ids.flatMap((id) => {
        const p = s.cache.get(id)
        if (!p) return []
        const { w, h } = p.width && p.height ? editedSize(p.width, p.height, p.edit) : { w: 3000, h: 2000 }
        return [{ id, w, h }]
      })
  const effective: PrintSettings = job.chart ? { ...settings, layout: 'single', fit: 'fit', rotateToFit: false, caption: { ...settings.caption, enabled: false }, watermark: { ...settings.watermark, enabled: false } } : settings
  const layout: Layout = useMemo(() => computeLayout(effective, photos, placements), [JSON.stringify(effective), JSON.stringify(photos), placements])
  const pages = layout.pages.length
  const current = layout.pages[Math.min(page, Math.max(0, pages - 1))]
  useEffect(() => {
    if (page > pages - 1) setPage(Math.max(0, pages - 1))
  }, [pages])

  // Page fitted to the preview area.
  const pad = 48
  const scale = Math.max(0, Math.min((stageBox.w - pad * 2) / layout.width, (stageBox.h - pad * 2) / layout.height))
  const pxPerInch = Math.round(scale * (window.devicePixelRatio || 1))

  // Preview images come from the main process (same pipeline as the output), debounced while settings change.
  const previewKey = JSON.stringify([ids, effective.layout, effective.paper, effective.customW, effective.customH, effective.orientation, effective.margins, effective.grid, effective.pkg, effective.fit, effective.rotateToFit, effective.repeatOnPage, effective.border, effective.caption.enabled, effective.caption.size, effective.header, effective.footer, effective.pageNumbers, effective.textSize, effective.adjust, effective.grayscale, effective.proof, effective.profile, effective.intent, effective.bpc, effective.gamutWarning, effective.gamutColor, placements, page, pxPerInch])
  useEffect(() => {
    if (!current || !pxPerInch) return
    let live = true
    const t = setTimeout(() => {
      void api.printPreview({ settings: effective, photoIds: job.ids, placements, chart: job.chart }, page, pxPerInch).then((r) => live && setPreview({ key: previewKey, cells: r.cells }))
    }, 160)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [previewKey])

  const printJob = Object.values(s.jobs).find((j) => j.kind === 'print')
  const run = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.print({ settings: effective, photoIds: job.ids, placements, chart: job.chart }))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [role="listbox"], [role="menu"], [role="slider"]')) return
      if (e.key === 'Escape') s.closePrint()
      if (e.key === 'ArrowRight') setPage((p) => Math.min(pages - 1, p + 1))
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(0, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Dragging a filled photo moves its crop; the wheel zooms it.
  const onCellPointerDown = (e: React.PointerEvent, i: number): void => {
    const c = current?.cells[i]
    if (!c || settings.fit !== 'fill' || job.chart) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: c.photoId, x: e.clientX, y: e.clientY, start: placements[c.photoId] ?? { ox: 0, oy: 0, zoom: 1 }, rotate: c.rotate, boxPx: { w: c.box.w * scale, h: c.box.h * scale }, crop: { w: c.crop.w, h: c.crop.h } }
  }
  const onCellPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    let dx = e.clientX - d.x
    let dy = e.clientY - d.y
    // A photo turned to fit moves along its own axes: screen right is the photo's up.
    if (d.rotate) [dx, dy] = [dy, -dx]
    const bw = d.rotate ? d.boxPx.h : d.boxPx.w
    const bh = d.rotate ? d.boxPx.w : d.boxPx.h
    const room = (span: number): number => Math.max(1e-6, 1 - span)
    const ox = d.start.ox - ((dx / bw) * d.crop.w * 2) / room(d.crop.w)
    const oy = d.start.oy - ((dy / bh) * d.crop.h * 2) / room(d.crop.h)
    setPlacements((p) => ({ ...p, [d.id]: { ...d.start, ox: Math.max(-1, Math.min(1, ox)), oy: Math.max(-1, Math.min(1, oy)) } }))
  }
  const onCellWheel = (e: React.WheelEvent, i: number): void => {
    const c = current?.cells[i]
    if (!c || settings.fit !== 'fill' || job.chart) return
    const cur = placements[c.photoId] ?? { ox: 0, oy: 0, zoom: 1 }
    const zoom = Math.max(1, Math.min(4, cur.zoom * Math.exp(-e.deltaY * 0.0015)))
    setPlacements((p) => ({ ...p, [c.photoId]: { ...cur, zoom } }))
  }

  const captions = current ? current.cells.map((c) => (settings.caption.enabled && !job.chart ? captionText(s.cache.get(c.photoId) ?? { title: null, filename: '', takenAt: null, shutter: null, aperture: null, iso: null, focal: null, caption: null, rating: 0 }, settings.caption.fields, settings.caption.custom) : '')) : []
  const overlay = current ? overlaySvg(layout, current, effective, captions, pages) : ''
  const lowRes = current?.cells.filter((c) => c.photoId !== CHART_ID && c.ppi < LOW_PPI) ?? []

  const presets: PrintPreset[] = [...BUILT_IN_PRESETS, ...(s.settings?.print.presets ?? [])]
  const applyPreset = (p: PrintPreset): void => {
    setSettingsState((cur) => withDefaults({ ...cur, ...p.settings, printer: p.settings.printer ?? cur.printer }))
    setPlacements({})
    toast(`Applied “${p.name}”`, { duration: 1500 })
  }
  const savePreset = async (): Promise<void> => {
    const name = await promptDialog({ title: 'Save print preset', description: 'Saves all of these settings so you can use them again in one click.', confirmLabel: 'Save', placeholder: 'e.g. Fine art 13×19 matte' })
    if (!name) return
    const saved = (s.settings?.print.presets ?? []).filter((p) => p.name !== name)
    await s.setSettings({ print: { last: settings, presets: [...saved, { name, settings }] } })
    toast.success(`Saved “${name}”`)
  }
  const deletePreset = async (name: string): Promise<void> => {
    await s.setSettings({ print: { last: settings, presets: (s.settings?.print.presets ?? []).filter((p) => p.name !== name) } })
  }

  const selectedProfile = profiles?.find((p) => p.path === settings.profile)
  const cmyk = selectedProfile?.space === 'CMYK'
  const actionLabel = { printer: 'Print', pdf: 'Save PDF…', jpeg: 'Save JPEG Files…', tiff: 'Save TIFF Files…' }[settings.output]
  const printerInfo = printers?.find((p) => p.name === settings.printer)
  const count = job.chart ? 'the calibration chart' : `${job.ids.length.toLocaleString()} ${job.ids.length === 1 ? 'photo' : 'photos'}`

  return (
    <div role="dialog" aria-modal="true" aria-label="Print" className="fixed inset-0 z-40 flex flex-col bg-canvas text-ink">
      <header className={cn('app-drag titlebar-inset flex h-12 shrink-0 items-center gap-3 border-b bg-panel pl-3', mac && 'pl-20')}>
        <Button variant="ghost" size="sm" onClick={s.closePrint}>
          <ArrowLeft data-icon="inline-start" />
          Back
        </Button>
        <h1 className="text-[13px] font-medium">Print {count}</h1>
        <div className="flex flex-1 items-center justify-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft />
          </Button>
          <span className="tnum min-w-24 text-center text-xs text-ink-muted">{pages ? `Page ${page + 1} of ${pages}` : 'No pages'}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Presets
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Built in</DropdownMenuLabel>
            {BUILT_IN_PRESETS.map((p) => (
              <DropdownMenuItem key={p.name} onSelect={() => applyPreset(p)}>
                {p.name}
              </DropdownMenuItem>
            ))}
            {presets.length > BUILT_IN_PRESETS.length && <DropdownMenuLabel>Yours</DropdownMenuLabel>}
            {(s.settings?.print.presets ?? []).map((p) => (
              <DropdownMenuItem key={p.name} onSelect={() => applyPreset(p)} className="justify-between">
                <span className="truncate">{p.name}</span>
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  className="rounded p-0.5 text-ink-muted hover:text-ink"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    void deletePreset(p.name)
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void savePreset()}>
              <Save />
              Save Current Settings…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Preview */}
        <div ref={stage} className="relative min-w-0 flex-1 overflow-hidden bg-[oklch(0.32_0_0)]">
          {current && scale > 0 ? (
            <div
              className="absolute shadow-[0_8px_40px_rgb(0_0_0/0.45)]"
              style={{ left: (stageBox.w - layout.width * scale) / 2, top: (stageBox.h - layout.height * scale) / 2, width: layout.width * scale, height: layout.height * scale, background: effective.background }}
              aria-label={`Preview of page ${page + 1}`}
            >
              {/* Margins, faintly. */}
              <div
                className="pointer-events-none absolute outline-1 outline-dashed outline-black/10"
                style={{ left: settings.margins.left * scale, top: settings.margins.top * scale, right: settings.margins.right * scale, bottom: settings.margins.bottom * scale }}
              />
              {current.cells.map((c, i) => {
                const src = preview?.cells[i]?.src
                return (
                  <div
                    key={`${c.photoId}-${i}`}
                    className={cn('absolute overflow-hidden bg-black/5', settings.fit === 'fill' && !job.chart && 'cursor-grab active:cursor-grabbing')}
                    style={{ left: c.box.x * scale, top: c.box.y * scale, width: c.box.w * scale, height: c.box.h * scale }}
                    onPointerDown={(e) => onCellPointerDown(e, i)}
                    onPointerMove={onCellPointerMove}
                    onPointerUp={() => (drag.current = null)}
                    onWheel={(e) => onCellWheel(e, i)}
                    onDoubleClick={() => setPlacements((p) => ({ ...p, [c.photoId]: { ox: 0, oy: 0, zoom: 1 } }))}
                    title={settings.fit === 'fill' && !job.chart ? 'Drag to reposition, scroll to zoom, double-click to reset' : undefined}
                  >
                    {src && <img src={src} alt="" draggable={false} className="pointer-events-none size-full select-none" />}
                    {c.photoId !== CHART_ID && c.ppi < LOW_PPI && (
                      <span className="tnum absolute top-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-medium text-black" title="This photo may print soft at this size">
                        {Math.round(c.ppi)} ppi
                      </span>
                    )}
                  </div>
                )
              })}
              <div className="pointer-events-none absolute inset-0 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: overlay }} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-white/70">{layout.problem ?? (photos.length ? '' : 'Loading…')}</div>
          )}
          {layout.problem && current && <p className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-reject/90 px-3 py-1.5 text-xs text-white">{layout.problem}</p>}
          <div className="tnum absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[11px] text-white/85">
            {`${toUnits(layout.width, units).toFixed(units === 'mm' ? 0 : 2)} × ${toUnits(layout.height, units).toFixed(units === 'mm' ? 0 : 2)} ${units}`}
            {current && ` · ${current.cells.length} on this page`}
            {settings.proof && settings.profile && ` · soft proof${settings.gamutWarning ? ' with gamut warning' : ''}`}
          </div>
        </div>

        {/* Settings */}
        <aside aria-label="Print settings" className="flex w-[360px] shrink-0 flex-col border-l bg-panel">
          <div className="scroll-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <Section title="Printer and paper">
              <Field label="Output">
                <ToggleGroup type="single" variant="outline" size="sm" value={settings.output} onValueChange={(v) => v && set({ output: v as PrintSettings['output'] })} aria-label="Output">
                  <ToggleGroupItem value="printer">Printer</ToggleGroupItem>
                  <ToggleGroupItem value="pdf">PDF</ToggleGroupItem>
                  <ToggleGroupItem value="jpeg">JPEG</ToggleGroupItem>
                  <ToggleGroupItem value="tiff">TIFF</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {settings.output === 'printer' && (
                <>
                  <Field
                    label="Printer"
                    hint={
                      printers && !printers.length ? (
                        <>
                          No printers found.{' '}
                          <button type="button" className="underline" onClick={() => api.openPrinterSettings()}>
                            Add a printer
                          </button>
                        </>
                      ) : printerInfo?.state === 'stopped' ? (
                        'This printer is paused or has a problem.'
                      ) : undefined
                    }
                  >
                    <Select value={settings.printer ?? ''} onValueChange={(v) => set({ printer: v })}>
                      <SelectTrigger size="sm" className="w-48" aria-label="Printer">
                        <SelectValue placeholder={printers ? 'No printers' : 'Looking for printers…'} />
                      </SelectTrigger>
                      <SelectContent>
                        {(printers ?? []).map((p) => (
                          <SelectItem key={p.name} value={p.name}>
                            <span className={cn('size-1.5 rounded-full', p.state === 'ready' ? 'bg-emerald-500' : p.state === 'stopped' ? 'bg-red-500' : p.state === 'busy' ? 'bg-amber-500' : 'bg-ink-muted/50')} aria-hidden />
                            {p.displayName}
                            {p.isDefault && <span className="text-ink-muted"> (default)</span>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Refresh printers" onClick={loadPrinters}>
                          <RefreshCw />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Refresh printers</TooltipContent>
                    </Tooltip>
                  </Field>
                  <SwitchField
                    id="system-dialog"
                    label="Use the system print dialog"
                    checked={settings.systemDialog || settings.colorMode === 'glimmr'}
                    onChange={(v) => set({ systemDialog: v })}
                    hint={settings.colorMode === 'glimmr' ? 'Always on when Glimmr manages colours, so you can turn the printer’s colour management off.' : 'For printer options like paper type and print quality.'}
                  />
                </>
              )}
              <Field label="Paper">
                <Select value={settings.paper} onValueChange={(v) => set({ paper: v })}>
                  <SelectTrigger size="sm" className="w-48" aria-label="Paper size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom size</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {settings.paper === 'custom' && (
                <Field label="Custom size">
                  <Length label="Paper width" value={settings.customW} units={units} min={1} onChange={(v) => set({ customW: v })} />
                  <span className="text-xs text-ink-muted">×</span>
                  <Length label="Paper height" value={settings.customH} units={units} min={1} onChange={(v) => set({ customH: v })} />
                </Field>
              )}
              <Field label="Orientation">
                <ToggleGroup type="single" variant="outline" size="sm" value={settings.orientation} onValueChange={(v) => v && set({ orientation: v as PrintSettings['orientation'] })} aria-label="Orientation">
                  <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                  <ToggleGroupItem value="portrait">Portrait</ToggleGroupItem>
                  <ToggleGroupItem value="landscape">Landscape</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field label="Units">
                <ToggleGroup type="single" variant="outline" size="sm" value={units} onValueChange={(v) => v && set({ units: v as Units })} aria-label="Units">
                  <ToggleGroupItem value="in">in</ToggleGroupItem>
                  <ToggleGroupItem value="mm">mm</ToggleGroupItem>
                  <ToggleGroupItem value="cm">cm</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-ink-muted">Margins</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => set({ margins: { top: 0, right: 0, bottom: 0, left: 0 } })}>
                      Borderless
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label="Same on all sides" aria-pressed={linkMargins} onClick={() => setLinkMargins(!linkMargins)}>
                          {linkMargins ? <Link2 /> : <Link2Off />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{linkMargins ? 'Same on all sides' : 'Each side separately'}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                    <div key={side} className="flex items-center justify-between">
                      <span className="text-[11px] text-ink-muted capitalize">{side}</span>
                      <Length
                        label={`${side} margin`}
                        value={settings.margins[side]}
                        units={units}
                        max={6}
                        onChange={(v) => set({ margins: linkMargins ? { top: v, right: v, bottom: v, left: v } : { ...settings.margins, [side]: v } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
              {settings.output === 'printer' && (
                <>
                  <Field label="Copies">
                    <NumberBox label="Copies" value={settings.copies} min={1} max={999} onChange={(v) => set({ copies: Math.round(v) })} />
                  </Field>
                  <SwitchField id="collate" label="Collate" checked={settings.collate} onChange={(v) => set({ collate: v })} />
                  <Field label="Two-sided">
                    <Select value={settings.duplex} onValueChange={(v) => set({ duplex: v as PrintSettings['duplex'] })}>
                      <SelectTrigger size="sm" className="w-40" aria-label="Two-sided printing">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="simplex">Off</SelectItem>
                        <SelectItem value="longEdge">Long-edge binding</SelectItem>
                        <SelectItem value="shortEdge">Short-edge binding</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </>
              )}
              <SwitchField id="grayscale" label="Black and white" checked={settings.grayscale} onChange={(v) => set({ grayscale: v })} />
              <Field label="Pages" hint={pages > 1 ? 'Leave empty for all pages, or e.g. 1-3, 5.' : undefined}>
                <Input aria-label="Page range" value={settings.pageRange} placeholder="All" onChange={(e) => set({ pageRange: e.target.value })} className="h-7 w-32 text-xs" />
              </Field>
            </Section>

            {!job.chart && (
              <Section title="Layout">
                <Field label="Layout">
                  <ToggleGroup type="single" variant="outline" size="sm" value={settings.layout} onValueChange={(v) => v && (set({ layout: v as PrintSettings['layout'] }), setPage(0))} aria-label="Layout">
                    <ToggleGroupItem value="single">Single</ToggleGroupItem>
                    <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
                    <ToggleGroupItem value="package">Print sizes</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                {settings.layout === 'grid' && (
                  <>
                    <Field label="Rows × columns">
                      <NumberBox label="Rows" value={settings.grid.rows} min={1} max={20} onChange={(v) => set({ grid: { ...settings.grid, rows: Math.round(v) } })} />
                      <span className="text-xs text-ink-muted">×</span>
                      <NumberBox label="Columns" value={settings.grid.cols} min={1} max={20} onChange={(v) => set({ grid: { ...settings.grid, cols: Math.round(v) } })} />
                    </Field>
                    <Field label="Spacing">
                      <Length label="Horizontal spacing" value={settings.grid.hGap} units={units} max={4} onChange={(v) => set({ grid: { ...settings.grid, hGap: v } })} />
                      <Length label="Vertical spacing" value={settings.grid.vGap} units={units} max={4} onChange={(v) => set({ grid: { ...settings.grid, vGap: v } })} />
                    </Field>
                  </>
                )}
                {settings.layout === 'package' && (
                  <>
                    <Field label="Package">
                      <Select
                        value=""
                        onValueChange={(name) => {
                          const t = PACKAGE_TEMPLATES.find((x) => x.name === name)
                          // A template is a whole sheet design: its paper and narrow margins come with it.
                          if (t) set({ paper: t.paper, margins: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 }, pkg: { ...settings.pkg, items: t.items.map(([size, count]) => ({ size, w: 4, h: 6, count })) } })
                        }}
                      >
                        <SelectTrigger size="sm" className="w-48" aria-label="Package template">
                          <SelectValue placeholder="Pick a template…" />
                        </SelectTrigger>
                        <SelectContent>
                          {PACKAGE_TEMPLATES.map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-ink-muted">Prints of each photo</span>
                      {settings.pkg.items.map((item, i) => {
                        const update = (patch: Partial<PackageItem>): void => set({ pkg: { ...settings.pkg, items: settings.pkg.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) } })
                        return (
                          <div key={i} className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <Select value={item.size} onValueChange={(v) => update({ size: v })}>
                                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={`Print size ${i + 1}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PRINT_SIZES.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.label}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="custom">Custom size</SelectItem>
                                </SelectContent>
                              </Select>
                              <span className="text-xs text-ink-muted">×</span>
                              <NumberBox label={`How many of print size ${i + 1}`} value={item.count} min={1} max={99} onChange={(v) => update({ count: Math.round(v) })} />
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Remove print size ${i + 1}`}
                                disabled={settings.pkg.items.length === 1}
                                onClick={() => set({ pkg: { ...settings.pkg, items: settings.pkg.items.filter((_, k) => k !== i) } })}
                              >
                                <X />
                              </Button>
                            </div>
                            {item.size === 'custom' && (
                              <div className="flex items-center gap-1.5 pl-1">
                                <Length label={`Custom print ${i + 1} width`} value={item.w} units={units} min={0.5} onChange={(v) => update({ w: v })} />
                                <span className="text-xs text-ink-muted">×</span>
                                <Length label={`Custom print ${i + 1} height`} value={item.h} units={units} min={0.5} onChange={(v) => update({ h: v })} />
                              </div>
                            )}
                          </div>
                        )
                      })}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() => set({ pkg: { ...settings.pkg, items: [...settings.pkg.items, { size: 'wallet', w: 2.5, h: 3.5, count: 4 }] } })}
                      >
                        <Plus data-icon="inline-start" />
                        Add a Size
                      </Button>
                      <p className="text-[11px] text-ink-muted">
                        {(() => {
                          const prints = settings.pkg.items.reduce((n, i) => n + i.count, 0) * photos.length
                          return `${prints.toLocaleString()} ${prints === 1 ? 'print' : 'prints'} on ${pages} ${pages === 1 ? 'sheet' : 'sheets'}, arranged so they can be cut apart with straight cuts.`
                        })()}
                      </p>
                    </div>
                    <Field label="Spacing">
                      <Length label="Spacing between prints" value={settings.pkg.gap} units={units} max={2} onChange={(v) => set({ pkg: { ...settings.pkg, gap: v } })} />
                    </Field>
                    {photos.length > 1 && (
                      <SwitchField
                        id="pkg-separate"
                        label="Each photo on its own sheets"
                        checked={settings.pkg.separate}
                        onChange={(v) => set({ pkg: { ...settings.pkg, separate: v } })}
                        hint={settings.pkg.separate ? 'Each sheet holds one photo’s prints, to hand out separately.' : 'Photos share sheets to save paper.'}
                      />
                    )}
                  </>
                )}
                <Field label="Photos" hint={settings.fit === 'fill' ? 'Drag a photo in the preview to choose its crop, scroll to zoom, double-click to reset.' : undefined}>
                  <ToggleGroup type="single" variant="outline" size="sm" value={settings.fit} onValueChange={(v) => v && set({ fit: v as PrintSettings['fit'] })} aria-label="Fit or fill">
                    <ToggleGroupItem value="fit">Fit</ToggleGroupItem>
                    <ToggleGroupItem value="fill">Fill and crop</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <SwitchField id="rotate-fit" label="Rotate to fit" checked={settings.rotateToFit} onChange={(v) => set({ rotateToFit: v })} />
                {settings.layout === 'grid' && <SwitchField id="repeat-page" label="Fill each page with one photo" checked={settings.repeatOnPage} onChange={(v) => set({ repeatOnPage: v })} />}
              </Section>
            )}

            {!job.chart && (
              <Section title="Borders and marks" defaultOpen={false}>
                <Field label="Photo border (mat)">
                  <Length label="Photo border" value={settings.border} units={units} max={4} onChange={(v) => set({ border: v })} />
                </Field>
                <Field label="Stroke">
                  <NumberBox label="Stroke width" value={settings.stroke.width} min={0} max={36} step={0.5} suffix="pt" onChange={(v) => set({ stroke: { ...settings.stroke, width: v } })} />
                  <ColorBox label="Stroke colour" value={settings.stroke.color} onChange={(v) => set({ stroke: { ...settings.stroke, color: v } })} />
                </Field>
                <Field label="Page colour">
                  <ColorBox label="Page colour" value={settings.background} onChange={(v) => set({ background: v })} />
                </Field>
                <SwitchField id="crop-marks" label="Crop marks" checked={settings.cropMarks} onChange={(v) => set({ cropMarks: v })} hint="Cut lines at each photo’s corners, for trimming." />
              </Section>
            )}

            {!job.chart && (
              <Section title="Text" defaultOpen={false}>
                <SwitchField id="captions" label="Captions under photos" checked={settings.caption.enabled} onChange={(v) => set({ caption: { ...settings.caption, enabled: v } })} />
                {settings.caption.enabled && (
                  <>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {CAPTION_FIELDS.map((f) => (
                        <label key={f.key} className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={settings.caption.fields.includes(f.key)}
                            onCheckedChange={(v) => set({ caption: { ...settings.caption, fields: v ? [...settings.caption.fields, f.key] : settings.caption.fields.filter((x) => x !== f.key) } })}
                          />
                          {f.label}
                        </label>
                      ))}
                    </div>
                    {settings.caption.fields.includes('custom') && (
                      <Input aria-label="Custom caption text" placeholder="Custom caption text" value={settings.caption.custom} onChange={(e) => set({ caption: { ...settings.caption, custom: e.target.value } })} className="h-7 text-xs" />
                    )}
                    <Field label="Caption size and colour">
                      <NumberBox label="Caption size" value={settings.caption.size} min={5} max={36} suffix="pt" onChange={(v) => set({ caption: { ...settings.caption, size: v } })} />
                      <ColorBox label="Caption colour" value={settings.caption.color} onChange={(v) => set({ caption: { ...settings.caption, color: v } })} />
                    </Field>
                  </>
                )}
                <Field label="Header">
                  <Input aria-label="Header" value={settings.header} placeholder="None" onChange={(e) => set({ header: e.target.value })} className="h-7 w-48 text-xs" />
                </Field>
                <Field label="Footer" hint="{page} and {pages} are filled in.">
                  <Input aria-label="Footer" value={settings.footer} placeholder="None" onChange={(e) => set({ footer: e.target.value })} className="h-7 w-48 text-xs" />
                </Field>
                <SwitchField id="page-numbers" label="Page numbers" checked={settings.pageNumbers} onChange={(v) => set({ pageNumbers: v })} />
                <SwitchField id="watermark" label="Watermark" checked={settings.watermark.enabled} onChange={(v) => set({ watermark: { ...settings.watermark, enabled: v } })} />
                {settings.watermark.enabled && (
                  <>
                    <Input aria-label="Watermark text" placeholder="© Your name" value={settings.watermark.text} onChange={(e) => set({ watermark: { ...settings.watermark, text: e.target.value } })} className="h-7 text-xs" />
                    <Field label="Position">
                      <Select value={settings.watermark.position} onValueChange={(v) => set({ watermark: { ...settings.watermark, position: v as PrintSettings['watermark']['position'] } })}>
                        <SelectTrigger size="sm" className="w-36" aria-label="Watermark position">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="br">Bottom right</SelectItem>
                          <SelectItem value="bl">Bottom left</SelectItem>
                          <SelectItem value="tr">Top right</SelectItem>
                          <SelectItem value="tl">Top left</SelectItem>
                          <SelectItem value="c">Centre</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Size and opacity">
                      <NumberBox label="Watermark size" value={settings.watermark.size} min={5} max={120} suffix="pt" onChange={(v) => set({ watermark: { ...settings.watermark, size: v } })} />
                      <Slider aria-label="Watermark opacity" className="w-20" min={0.1} max={1} step={0.05} value={[settings.watermark.opacity]} onValueChange={([v]) => set({ watermark: { ...settings.watermark, opacity: v } })} />
                    </Field>
                  </>
                )}
              </Section>
            )}

            <Section title="Image quality">
              <Field label="Print resolution">
                <Select value={String(settings.ppi)} onValueChange={(v) => set({ ppi: Number(v) })}>
                  <SelectTrigger size="sm" className="w-28" aria-label="Print resolution">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PPI_CHOICES.map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        {p} ppi
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Print sharpening">
                <Select value={settings.sharpen} onValueChange={(v) => set({ sharpen: v as PrintSettings['sharpen'] })}>
                  <SelectTrigger size="sm" className="w-28" aria-label="Print sharpening">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off">Off</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Paper finish">
                <ToggleGroup type="single" variant="outline" size="sm" value={settings.media} onValueChange={(v) => v && set({ media: v as PrintSettings['media'] })} aria-label="Paper finish" disabled={settings.sharpen === 'off'}>
                  <ToggleGroupItem value="glossy">Glossy</ToggleGroupItem>
                  <ToggleGroupItem value="matte">Matte</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-ink-muted">Print adjustment (prints only, to match a bright screen)</span>
                {(['brightness', 'contrast'] as const).map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-20 text-[11px] text-ink-muted capitalize">{k}</span>
                    <Slider aria-label={`Print ${k}`} className="flex-1" min={-50} max={50} step={1} value={[settings.adjust[k]]} onValueChange={([v]) => set({ adjust: { ...settings.adjust, [k]: v } })} />
                    <button type="button" className="tnum w-8 text-right text-[11px] hover:underline" title="Reset" onClick={() => set({ adjust: { ...settings.adjust, [k]: 0 } })}>
                      {settings.adjust[k] > 0 ? '+' : ''}
                      {settings.adjust[k]}
                    </button>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Colour management">
              <Field label="Colours">
                <ToggleGroup type="single" variant="outline" size="sm" value={settings.colorMode} onValueChange={(v) => v && set({ colorMode: v as PrintSettings['colorMode'] })} aria-label="Colour handling">
                  <ToggleGroupItem value="printer">Printer manages</ToggleGroupItem>
                  <ToggleGroupItem value="glimmr">Glimmr manages</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field label="Profile" hint={profiles && !profiles.length ? 'No colour profiles found. Install your paper’s profile, or add one.' : cmyk ? 'CMYK profiles are for soft proofing only.' : undefined}>
                <Select value={settings.profile ?? ''} onValueChange={(v) => set({ profile: v || null })}>
                  <SelectTrigger size="sm" className="w-48" aria-label="Colour profile">
                    <SelectValue placeholder={profiles ? 'Choose a profile' : 'Looking for profiles…'}>{selectedProfile?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {PROFILE_GROUPS.map((g) => {
                      const list = (profiles ?? []).filter((p) => p.kind === g.kind)
                      return list.length ? (
                        <SelectGroup key={g.kind}>
                          <SelectLabel>{g.label}</SelectLabel>
                          {list.map((p) => (
                            <SelectItem key={p.path} value={p.path}>
                              {p.name}
                              <span className="text-ink-muted"> {p.space}</span>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null
                    })}
                  </SelectContent>
                </Select>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add a profile"
                      onClick={async () => {
                        const p = await api.addPrintProfile()
                        if (p) {
                          loadProfiles()
                          set({ profile: p.path })
                        }
                      }}
                    >
                      <Plus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add a profile (.icc, .icm)</TooltipContent>
                </Tooltip>
              </Field>
              <Field label="Rendering intent">
                <Select value={settings.intent} onValueChange={(v) => set({ intent: v as PrintSettings['intent'] })}>
                  <SelectTrigger size="sm" className="w-44" aria-label="Rendering intent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="relative">Relative colorimetric</SelectItem>
                    <SelectItem value="perceptual">Perceptual</SelectItem>
                    <SelectItem value="saturation">Saturation</SelectItem>
                    <SelectItem value="absolute">Absolute colorimetric</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <SwitchField id="bpc" label="Black point compensation" checked={settings.bpc} onChange={(v) => set({ bpc: v })} />
              <SwitchField id="proof" label="Soft proof" checked={settings.proof} onChange={(v) => set({ proof: v })} hint={settings.proof && !settings.profile ? 'Choose a profile to proof with.' : 'Shows how the print will look with this profile.'} />
              <Field label="Gamut warning">
                <ColorBox label="Gamut warning colour" value={settings.gamutColor} onChange={(v) => set({ gamutColor: v })} />
                <Switch aria-label="Gamut warning" checked={settings.gamutWarning} onCheckedChange={(v) => set({ gamutWarning: v, proof: v || settings.proof })} />
              </Field>
              {settings.colorMode === 'glimmr' && (
                <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] leading-snug">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  {settings.output === 'printer'
                    ? 'In the print dialog that opens, turn off the printer’s colour management (e.g. “No Colour Adjustment” or “ICM off”) and choose the same paper as the profile. Otherwise colours are converted twice.'
                    : 'Files are converted to this profile and tagged with it, ready for a lab or printer utility that prints without further colour conversion.'}
                </p>
              )}
            </Section>
          </div>

          <div className="flex flex-col gap-2 border-t p-4">
            {(busy || printJob) && (
              <div className="flex flex-col gap-1">
                <Progress value={printJob?.total ? (printJob.done / printJob.total) * 100 : 5} className="h-1" />
                <span className="text-[11px] text-ink-muted">{printJob?.message ?? 'Preparing…'}</span>
              </div>
            )}
            {result && !busy && (
              <p role="status" className={cn('flex items-start gap-2 text-xs', result.ok ? 'text-ink' : 'text-reject')}>
                {result.message}
                {result.ok && result.files?.[0] && (
                  <button type="button" className="ml-auto shrink-0 text-ink-muted underline underline-offset-2 hover:text-ink" onClick={() => api.showFile(result.files![0])}>
                    <FolderOpen className="mr-1 inline size-3.5" />
                    Show
                  </button>
                )}
              </p>
            )}
            {lowRes.length > 0 && (
              <p className="flex items-start gap-2 text-[11px] text-amber-500">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                {lowRes.length === 1 ? 'A photo on this page' : `${lowRes.length} photos on this page`} may print soft at this size (under {LOW_PPI} ppi).
              </p>
            )}
            <Button disabled={busy || !current || (settings.output === 'printer' && !settings.printer)} onClick={() => void run()}>
              {settings.output === 'printer' ? <Printer data-icon="inline-start" /> : <FileDown data-icon="inline-start" />}
              {busy ? 'Working…' : actionLabel}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
