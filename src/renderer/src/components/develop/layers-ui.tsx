// The Develop view's layers: the list (Background is the photo's own settings), and for a selected layer its mask
// tools and local adjustments.

import { Brush, Circle, Eraser, Eye, EyeOff, Layers, MoreHorizontal, Plus, SquareSplitVertical } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { Section, SliderRow } from './controls'
import { promptDialog } from '../../dialogs'
import type { Change } from './panels'
import { MAX_LAYERS, newLayer, noAdjust, type Layer, type LayerAdjust } from '../../../../shared/develop/layers'
import type { DevelopSettings } from '../../../../shared/develop/settings'

export type MaskTool = 'brush' | 'erase' | 'linear' | 'radial' | null
export interface BrushOptions {
  /** Radius, fraction of the long edge. */
  size: number
  feather: number
  density: number
}

const mac = navigator.userAgent.includes('Mac')

export const updateLayer = (change: Change, id: string, label: string, f: (l: Layer) => Layer): void =>
  change(label, (x) => ({ ...x, layers: x.layers.map((l) => (l.id === id ? f(l) : l)) }))

export function LayerList({
  s,
  active,
  setActive,
  change,
  commit,
  setTool
}: {
  s: DevelopSettings
  active: string | null
  setActive: (id: string | null) => void
  change: Change
  commit: () => void
  setTool: (t: MaskTool) => void
}) {
  const add = (kind: 'brush' | 'linear' | 'radial'): void => {
    const n = s.layers.length + 1
    const l = newLayer(kind === 'brush' ? `Brush ${n}` : kind === 'linear' ? `Gradient ${n}` : `Radial ${n}`)
    change('Add layer', (x) => ({ ...x, layers: [...x.layers, l] }))
    commit()
    setActive(l.id)
    setTool(kind)
  }
  const row = (id: string | null, name: string, extra?: React.ReactNode, layer?: Layer) => (
    <div
      key={id ?? 'bg'}
      className={cn('group flex h-8 items-center gap-1 rounded px-1.5 text-[12px] hover:bg-white/10', active === id && 'bg-white/15')}
      onClick={() => setActive(id)}
      role="option"
      aria-selected={active === id}
    >
      {layer ? (
        <button
          type="button"
          className="rounded p-0.5 text-ink-muted hover:text-ink"
          aria-label={layer.visible ? `Hide ${name}` : `Show ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            updateLayer(change, layer.id, layer.visible ? 'Hide layer' : 'Show layer', (l) => ({ ...l, visible: !l.visible }))
            commit()
          }}
        >
          {layer.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
      ) : (
        <Layers className="mx-0.5 size-3.5 text-ink-muted" aria-hidden />
      )}
      <span className={cn('min-w-0 flex-1 truncate', layer && !layer.visible && 'text-ink-muted')}>{name}</span>
      {extra}
    </div>
  )
  return (
    <div className="flex flex-col gap-1 border-b border-white/10 p-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[12px] font-medium">Layers</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink disabled:opacity-40" aria-label="Add a layer" disabled={s.layers.length >= MAX_LAYERS}>
              <Plus className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => add('brush')}>
              <Brush /> Brush layer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => add('linear')}>
              <SquareSplitVertical /> Linear gradient layer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => add('radial')}>
              <Circle /> Radial gradient layer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div role="listbox" aria-label="Layers" className="flex flex-col-reverse">
        {row(null, 'Background')}
        {s.layers.map((l) =>
          row(
            l.id,
            l.name,
            <>
              <span className="tnum text-[10px] text-ink-muted">{l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : ''}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded p-0.5 text-ink-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`${l.name} options`} onClick={(e) => e.stopPropagation()}>
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={async () => {
                      const name = await promptDialog({ title: 'Rename layer', confirmLabel: 'Rename', initial: l.name })
                      if (name?.trim()) {
                        updateLayer(change, l.id, 'Rename layer', (x) => ({ ...x, name: name.trim() }))
                        commit()
                      }
                    }}
                  >
                    Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const copy = { ...JSON.parse(JSON.stringify(l)), id: Math.random().toString(36).slice(2, 10), name: `${l.name} copy` } as Layer
                      change('Duplicate layer', (x) => ({ ...x, layers: [...x.layers, copy] }))
                      commit()
                      setActive(copy.id)
                    }}
                    disabled={s.layers.length >= MAX_LAYERS}
                  >
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      change('Delete layer', (x) => ({ ...x, layers: x.layers.filter((y) => y.id !== l.id) }))
                      commit()
                      if (active === l.id) setActive(null)
                    }}
                  >
                    Delete layer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>,
            l
          )
        )}
      </div>
    </div>
  )
}

const ADJ: { key: keyof LayerAdjust; label: string; min: number; max: number; step: number; track?: string; fmt?: (v: number) => string }[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.01, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'temp', label: 'Temperature', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg, #3d6bd6, #e8e8e8, #e8c33d)' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, track: 'linear-gradient(90deg, #3dc05a, #e8e8e8, #c93dc9)' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 }
]

export function LayerPanel({
  layer,
  change,
  commit,
  tool,
  setTool,
  brush,
  setBrush,
  showMask,
  setShowMask,
  open,
  setOpen
}: {
  layer: Layer
  change: Change
  commit: () => void
  tool: MaskTool
  setTool: (t: MaskTool) => void
  brush: BrushOptions
  setBrush: (b: BrushOptions) => void
  showMask: boolean
  setShowMask: (v: boolean) => void
  open: Record<string, boolean>
  setOpen: (k: string, o: boolean) => void
}) {
  const up = (label: string, f: (l: Layer) => Layer): void => updateLayer(change, layer.id, label, f)
  const toolButton = (t: Exclude<MaskTool, null>, label: string, key: string, icon: React.ReactNode) => (
    <button
      type="button"
      aria-pressed={tool === t}
      onClick={() => setTool(tool === t ? null : t)}
      className={cn('flex h-8 flex-1 flex-col items-center justify-center rounded text-ink-muted hover:bg-white/10 hover:text-ink', tool === t && 'bg-white/15 text-ink')}
      title={`${label} (${key})`}
      aria-label={label}
    >
      {icon}
    </button>
  )
  const r = layer.mask.range
  const shapes = layer.mask.shapes
  const changedAdj = Object.values(layer.adjust).some((v) => v !== 0)
  return (
    <>
      <Section title="Mask" open={open.mask ?? true} onOpenChange={(o) => setOpen('mask', o)} changed={shapes.length > 0 || layer.mask.invert || r.on} onReset={() => {
        up('Clear mask', (l) => ({ ...l, mask: { shapes: [], invert: false, range: { on: false, lo: 0, hi: 1, feather: 0.1 } } }))
        commit()
      }}>
        <div className="flex gap-1" role="toolbar" aria-label="Mask tools">
          {toolButton('brush', 'Brush', 'B', <Brush className="size-4" />)}
          {toolButton('erase', 'Erase', 'E', <Eraser className="size-4" />)}
          {toolButton('linear', 'Linear gradient', 'G', <SquareSplitVertical className="size-4" />)}
          {toolButton('radial', 'Radial gradient', 'R', <Circle className="size-4" />)}
        </div>
        {(tool === 'brush' || tool === 'erase') && (
          <>
            <SliderRow label="Size" value={Math.round(brush.size * 1000)} def={30} min={2} max={300} format={(v) => `${(v / 10).toFixed(1)}%`} onChange={(v) => setBrush({ ...brush, size: v / 1000 })} onCommit={() => {}} />
            <SliderRow label="Feather" value={Math.round(brush.feather * 100)} def={50} min={0} max={100} format={(v) => `${v}`} onChange={(v) => setBrush({ ...brush, feather: v / 100 })} onCommit={() => {}} />
            <SliderRow label="Density" value={Math.round(brush.density * 100)} def={100} min={5} max={100} format={(v) => `${v}%`} onChange={(v) => setBrush({ ...brush, density: v / 100 })} onCommit={() => {}} />
            <p className="text-[11px] text-ink-muted">
              Paint on the photo. <kbd>[</kbd> <kbd>]</kbd> change the size; hold <kbd>{mac ? '⌥' : 'Alt'}</kbd> to erase.
            </p>
          </>
        )}
        {tool === 'linear' && <p className="text-[11px] text-ink-muted">Drag on the photo from where the effect is full to where it fades out. Drag the dots to adjust.</p>}
        {tool === 'radial' && <p className="text-[11px] text-ink-muted">Drag on the photo from the centre outwards. Drag the dots to move or resize it.</p>}
        <label className="flex items-center justify-between text-[12px]">
          <span>Show mask (O)</span>
          <Switch checked={showMask} onCheckedChange={setShowMask} />
        </label>
        <label className="flex items-center justify-between text-[12px]">
          <span>Invert mask</span>
          <Switch
            checked={layer.mask.invert}
            onCheckedChange={(v) => {
              up('Invert mask', (l) => ({ ...l, mask: { ...l.mask, invert: v } }))
              commit()
            }}
          />
        </label>
        <label className="flex items-center justify-between text-[12px]">
          <span>Limit to a brightness range</span>
          <Switch
            checked={r.on}
            onCheckedChange={(v) => {
              up('Luminance range', (l) => ({ ...l, mask: { ...l.mask, range: { ...l.mask.range, on: v } } }))
              commit()
            }}
          />
        </label>
        {r.on && (
          <>
            <SliderRow label="From" value={Math.round(r.lo * 100)} def={0} min={0} max={100} format={(v) => `${v}`} track="linear-gradient(90deg, #000, #fff)" onChange={(v) => up('Luminance range', (l) => ({ ...l, mask: { ...l.mask, range: { ...l.mask.range, lo: Math.min(v / 100, l.mask.range.hi) } } }))} onCommit={commit} />
            <SliderRow label="To" value={Math.round(r.hi * 100)} def={100} min={0} max={100} format={(v) => `${v}`} track="linear-gradient(90deg, #000, #fff)" onChange={(v) => up('Luminance range', (l) => ({ ...l, mask: { ...l.mask, range: { ...l.mask.range, hi: Math.max(v / 100, l.mask.range.lo) } } }))} onCommit={commit} />
            <SliderRow label="Softness" value={Math.round(r.feather * 100)} def={10} min={0} max={50} format={(v) => `${v}`} onChange={(v) => up('Luminance range', (l) => ({ ...l, mask: { ...l.mask, range: { ...l.mask.range, feather: v / 100 } } }))} onCommit={commit} />
          </>
        )}
        {shapes.length === 0 && !layer.mask.invert && <p className="text-[11px] text-pretty text-ink-muted">The mask is empty, so this layer changes nothing yet. Paint or add a gradient, or invert the mask to start from everywhere.</p>}
      </Section>
      <Section title="Layer adjustments" open={open.layerAdj ?? true} onOpenChange={(o) => setOpen('layerAdj', o)} changed={changedAdj || layer.opacity < 1} onReset={() => {
        up('Reset layer', (l) => ({ ...l, adjust: noAdjust(), opacity: 1 }))
        commit()
      }}>
        <SliderRow label="Opacity" value={Math.round(layer.opacity * 100)} def={100} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => up('Layer opacity', (l) => ({ ...l, opacity: v / 100 }))} onCommit={commit} />
        <div className="h-px bg-white/10" />
        {ADJ.map((a) => (
          <SliderRow
            key={a.key}
            label={a.label}
            value={layer.adjust[a.key]}
            min={a.min}
            max={a.max}
            step={a.step}
            track={a.track}
            format={a.fmt}
            onChange={(v) => up(`Layer ${a.label.toLowerCase()}`, (l) => ({ ...l, adjust: { ...l.adjust, [a.key]: v } }))}
            onCommit={commit}
          />
        ))}
      </Section>
    </>
  )
}
