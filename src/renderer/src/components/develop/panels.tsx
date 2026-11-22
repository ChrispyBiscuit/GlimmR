// The Develop view's adjustment panels (right side): Basic, Tone curve, Colour, Detail and Look.

import { useState } from 'react'
import { Crosshair, Pipette } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { CurveEditor, Section, SliderRow, type CurveChannel } from './controls'
import { LUT_SPACES, type LutSpace } from '../../../../shared/develop/color'
import { defaultSettings, GROUPS, HSL_BANDS, WB_PRESETS, type DevelopSettings, type Group, type SourceKind, type WbMode } from '../../../../shared/develop/settings'
import type { LutInfo } from '../../../../shared/types'

export type Change = (label: string, f: (s: DevelopSettings) => DevelopSettings) => void

export const BAND_COLORS = ['#e5484d', '#f76b15', '#ffd60a', '#30a46c', '#12a594', '#0090ff', '#8e4ec6', '#d6409f']
const BAND_HUES = [0, 28, 52, 120, 175, 215, 275, 320]
const BAND_LABEL = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta']

// Raw temperature: the slider is even in mireds (as eyes judge colour shifts), 2000–50000 K.
const kToPos = (k: number): number => (500 - 1e6 / k) / 0.48
const posToK = (t: number): number => Math.round(1e6 / (500 - t * 0.48) / 10) * 10

export type HslTab = 'hue' | 'sat' | 'lum'

export interface PanelProps {
  s: DevelopSettings
  kind: SourceKind
  /** White balance the as-shot and auto modes resolved to. */
  wb: { temp: number; tint: number }
  change: Change
  commit: () => void
  histogram: number[] | null
  luts: LutInfo[]
  eyedropper: boolean
  setEyedropper: (on: boolean) => void
  /** The targeted HSL tool's tab, when it's on. */
  targeted: HslTab | 'bw' | null
  setTargeted: (t: HslTab | 'bw' | null) => void
  open: Record<string, boolean>
  setOpen: (k: string, o: boolean) => void
}

const resetGroup = (change: Change, kind: SourceKind, g: Group): void =>
  change(`Reset ${GROUPS[g].label.toLowerCase()}`, (s) => {
    const d = defaultSettings(kind) as unknown as Record<string, unknown>
    const out = { ...s } as unknown as Record<string, unknown>
    for (const k of GROUPS[g].keys) out[k] = JSON.parse(JSON.stringify(d[k]))
    return out as unknown as DevelopSettings
  })

const differs = (s: DevelopSettings, kind: SourceKind, groups: Group[]): boolean => {
  const d = defaultSettings(kind) as unknown as Record<string, unknown>
  return groups.some((g) => GROUPS[g].keys.some((k) => JSON.stringify((s as unknown as Record<string, unknown>)[k]) !== JSON.stringify(d[k])))
}

export function Adjustments(props: PanelProps) {
  const { s, kind, change, commit, open, setOpen } = props
  const n = (label: string, key: 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks' | 'vibrance' | 'saturation', min = -100, max = 100, step = 1, fmt?: (v: number) => string) => (
    <SliderRow label={label} value={s[key]} min={min} max={max} step={step} format={fmt} onChange={(v) => change(label, (x) => ({ ...x, [key]: v }))} onCommit={commit} />
  )
  return (
    <>
      <Section title="Basic" open={open.basic ?? true} onOpenChange={(o) => setOpen('basic', o)} changed={differs(s, kind, ['wb', 'tone', 'presence'])} onReset={() => {
        resetGroup(change, kind, 'wb')
        resetGroup(change, kind, 'tone')
        resetGroup(change, kind, 'presence')
        commit()
      }}>
        <WhiteBalance {...props} />
        <div className="h-px bg-white/10" />
        {n('Exposure', 'exposure', -5, 5, 0.01, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`)}
        {n('Contrast', 'contrast')}
        <div className="h-px bg-white/10" />
        {n('Highlights', 'highlights')}
        {n('Shadows', 'shadows')}
        {n('Whites', 'whites')}
        {n('Blacks', 'blacks')}
        <div className="h-px bg-white/10" />
        {n('Vibrance', 'vibrance')}
        {n('Saturation', 'saturation')}
      </Section>
      <ToneCurve {...props} />
      <Colour {...props} />
      <Detail {...props} />
      <Look {...props} />
    </>
  )
}

function WhiteBalance({ s, kind, wb, change, commit, eyedropper, setEyedropper }: PanelProps) {
  const raw = kind === 'raw'
  const modes: { id: WbMode; label: string }[] = [
    { id: 'asShot', label: 'As shot' },
    { id: 'auto', label: 'Auto' },
    ...(raw ? (Object.entries(WB_PRESETS) as [WbMode, { label: string }][]).map(([id, p]) => ({ id, label: p.label })) : []),
    { id: 'custom', label: 'Custom' }
  ]
  const preset = WB_PRESETS[s.wb.mode]
  const shown = s.wb.mode === 'custom' ? s.wb : raw && preset ? preset : wb
  // Moving a slider from a preset or as shot starts a custom white balance from where it was.
  const setWb = (temp: number, tint: number, label: string): void => change(label, (x) => ({ ...x, wb: { mode: 'custom', temp, tint } }))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-[80px] text-[12px] text-ink-muted">White balance</span>
        <Select
          value={s.wb.mode}
          onValueChange={(m) => {
            change('White balance', (x) => ({ ...x, wb: { mode: m as WbMode, temp: m === 'custom' ? shown.temp : raw ? x.wb.temp : 0, tint: m === 'custom' ? shown.tint : raw ? x.wb.tint : 0 } }))
            commit()
          }}
        >
          <SelectTrigger size="sm" className="h-7 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {modes.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          aria-pressed={eyedropper}
          onClick={() => setEyedropper(!eyedropper)}
          className={cn('rounded p-1.5 text-ink-muted hover:bg-white/10 hover:text-ink', eyedropper && 'bg-white/15 text-ink')}
          title="Pick something that should be neutral grey (W)"
          aria-label="White balance picker"
        >
          <Pipette className="size-4" />
        </button>
      </div>
      {raw ? (
        <>
          <SliderRow
            label="Temperature"
            value={kToPos(shown.temp)}
            def={kToPos(wb.temp)}
            min={0}
            max={1000}
            format={(v) => `${posToK(v)} K`}
            parse={(t) => kToPos(Number(t))}
            track="linear-gradient(90deg, #3d6bd6, #e8e8e8 45%, #e8c33d)"
            onChange={(v) => setWb(posToK(v), shown.tint, 'Temperature')}
            onCommit={commit}
          />
          <SliderRow label="Tint" value={shown.tint} def={wb.tint} min={-150} max={150} track="linear-gradient(90deg, #3dc05a, #e8e8e8, #c93dc9)" onChange={(v) => setWb(shown.temp, v, 'Tint')} onCommit={commit} />
        </>
      ) : (
        <>
          <SliderRow label="Temperature" value={shown.temp} min={-100} max={100} track="linear-gradient(90deg, #3d6bd6, #e8e8e8, #e8c33d)" onChange={(v) => setWb(v, shown.tint, 'Temperature')} onCommit={commit} />
          <SliderRow label="Tint" value={shown.tint} min={-100} max={100} track="linear-gradient(90deg, #3dc05a, #e8e8e8, #c93dc9)" onChange={(v) => setWb(shown.temp, v, 'Tint')} onCommit={commit} />
        </>
      )}
    </div>
  )
}

function ToneCurve({ s, kind, change, commit, histogram, open, setOpen }: PanelProps) {
  const [ch, setCh] = useState<CurveChannel>('rgb')
  const c = s.curve
  const region = (label: string, key: 'highlights' | 'lights' | 'darks' | 'shadows') => (
    <SliderRow label={label} value={c[key]} min={-100} max={100} onChange={(v) => change(`Curve ${label.toLowerCase()}`, (x) => ({ ...x, curve: { ...x.curve, [key]: v } }))} onCommit={commit} />
  )
  return (
    <Section title="Tone curve" open={open.curve ?? false} onOpenChange={(o) => setOpen('curve', o)} changed={differs(s, kind, ['curve'])} onReset={() => {
      resetGroup(change, kind, 'curve')
      commit()
    }}>
      <div className="flex gap-1" role="radiogroup" aria-label="Curve channel">
        {(['rgb', 'r', 'g', 'b'] as CurveChannel[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={ch === k}
            onClick={() => setCh(k)}
            className={cn('h-6 flex-1 rounded text-[11px] font-medium text-ink-muted hover:bg-white/10', ch === k && 'bg-white/15 text-ink')}
          >
            {k === 'rgb' ? 'RGB' : k.toUpperCase()}
            {c[k].length > 0 && <span className="ml-1 inline-block size-1 rounded-full bg-current align-middle" aria-hidden />}
          </button>
        ))}
      </div>
      <CurveEditor
        points={c[ch]}
        channel={ch}
        param={c}
        histogram={histogram}
        onChange={(p) => change('Tone curve', (x) => ({ ...x, curve: { ...x.curve, [ch]: p.map((q) => ({ x: +q.x.toFixed(4), y: +q.y.toFixed(4) })) } }))}
        onCommit={commit}
      />
      <p className="text-[11px] text-ink-muted">Click to add a point, drag to move it, double-click to remove it.</p>
      {region('Highlights', 'highlights')}
      {region('Lights', 'lights')}
      {region('Darks', 'darks')}
      {region('Shadows', 'shadows')}
    </Section>
  )
}

function Colour({ s, kind, change, commit, targeted, setTargeted, open, setOpen }: PanelProps) {
  const [tab, setTab] = useState<HslTab>('hue')
  const bw = s.bw.on
  const track = (i: number): string => {
    const h = BAND_HUES[i]
    if (tab === 'hue') return `linear-gradient(90deg, hsl(${h - 30} 80% 55%), hsl(${h} 80% 55%), hsl(${h + 30} 80% 55%))`
    if (tab === 'sat') return `linear-gradient(90deg, hsl(${h} 0% 55%), hsl(${h} 90% 55%))`
    return `linear-gradient(90deg, hsl(${h} 70% 12%), hsl(${h} 70% 50%), hsl(${h} 70% 90%))`
  }
  const key = tab
  return (
    <Section title="Colour" open={open.colour ?? false} onOpenChange={(o) => setOpen('colour', o)} changed={differs(s, kind, ['hsl', 'bw'])} onReset={() => {
      resetGroup(change, kind, 'hsl')
      resetGroup(change, kind, 'bw')
      commit()
    }}>
      <label className="flex items-center justify-between text-[12px]">
        <span>Black and white</span>
        <Switch
          checked={bw}
          onCheckedChange={(on) => {
            change(on ? 'Black and white' : 'Colour', (x) => ({ ...x, bw: { ...x.bw, on } }))
            commit()
          }}
        />
      </label>
      {bw ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-ink-muted">How bright each colour becomes in grey</span>
            <TargetButton on={targeted === 'bw'} onClick={() => setTargeted(targeted === 'bw' ? null : 'bw')} />
          </div>
          {HSL_BANDS.map((_, i) => (
            <SliderRow
              key={i}
              label={BAND_LABEL[i]}
              value={s.bw.mix[i]}
              min={-100}
              max={100}
              track={`linear-gradient(90deg, #111, ${BAND_COLORS[i]}, #eee)`}
              onChange={(v) => change(`B&W ${BAND_LABEL[i].toLowerCase()}`, (x) => ({ ...x, bw: { ...x.bw, mix: x.bw.mix.map((m, k) => (k === i ? v : m)) } }))}
              onCommit={commit}
            />
          ))}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <div className="flex flex-1 gap-1" role="radiogroup" aria-label="Colour adjustment">
              {(
                [
                  ['hue', 'Hue'],
                  ['sat', 'Saturation'],
                  ['lum', 'Luminance']
                ] as [HslTab, string][]
              ).map(([k, l]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={tab === k}
                  onClick={() => {
                    setTab(k)
                    if (targeted && targeted !== 'bw') setTargeted(k)
                  }}
                  className={cn('h-6 flex-1 rounded text-[11px] font-medium text-ink-muted hover:bg-white/10', tab === k && 'bg-white/15 text-ink')}
                >
                  {l}
                </button>
              ))}
            </div>
            <TargetButton on={targeted != null && targeted !== 'bw'} onClick={() => setTargeted(targeted && targeted !== 'bw' ? null : tab)} />
          </div>
          {HSL_BANDS.map((_, i) => (
            <SliderRow
              key={`${key}${i}`}
              label={BAND_LABEL[i]}
              value={s.hsl[key][i]}
              min={-100}
              max={100}
              track={track(i)}
              onChange={(v) => change(`${BAND_LABEL[i]} ${tab === 'hue' ? 'hue' : tab === 'sat' ? 'saturation' : 'luminance'}`, (x) => ({ ...x, hsl: { ...x.hsl, [key]: x.hsl[key].map((m, k) => (k === i ? v : m)) } }))}
              onCommit={commit}
            />
          ))}
        </>
      )}
    </Section>
  )
}

function TargetButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('rounded p-1.5 text-ink-muted hover:bg-white/10 hover:text-ink', on && 'bg-white/15 text-ink')}
      title="Drag up or down on the photo to adjust the colours under the pointer"
      aria-label="Adjust by dragging on the photo"
    >
      <Crosshair className="size-4" />
    </button>
  )
}

function Detail({ s, kind, change, commit, open, setOpen }: PanelProps) {
  const sh = s.sharpen
  const nr = s.noise
  return (
    <Section title="Detail" open={open.detail ?? false} onOpenChange={(o) => setOpen('detail', o)} changed={differs(s, kind, ['detail'])} onReset={() => {
      resetGroup(change, kind, 'detail')
      commit()
    }}>
      <h4 className="text-[11px] text-ink-muted">Sharpening</h4>
      <SliderRow label="Amount" value={sh.amount} def={defaultSettings(kind).sharpen.amount} min={0} max={150} format={String} onChange={(v) => change('Sharpening', (x) => ({ ...x, sharpen: { ...x.sharpen, amount: v } }))} onCommit={commit} />
      <SliderRow label="Radius" value={sh.radius} def={1} min={0.5} max={3} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => change('Sharpening radius', (x) => ({ ...x, sharpen: { ...x.sharpen, radius: v } }))} onCommit={commit} />
      <SliderRow label="Detail" value={sh.detail} def={25} min={0} max={100} format={String} onChange={(v) => change('Sharpening detail', (x) => ({ ...x, sharpen: { ...x.sharpen, detail: v } }))} onCommit={commit} />
      <SliderRow label="Masking" value={sh.masking} min={0} max={100} format={String} onChange={(v) => change('Sharpening masking', (x) => ({ ...x, sharpen: { ...x.sharpen, masking: v } }))} onCommit={commit} />
      <h4 className="mt-1 text-[11px] text-ink-muted">Noise reduction</h4>
      <SliderRow label="Luminance" value={nr.luminance} min={0} max={100} format={String} onChange={(v) => change('Noise reduction', (x) => ({ ...x, noise: { ...x.noise, luminance: v } }))} onCommit={commit} />
      <SliderRow label="Colour" value={nr.color} def={defaultSettings(kind).noise.color} min={0} max={100} format={String} onChange={(v) => change('Colour noise reduction', (x) => ({ ...x, noise: { ...x.noise, color: v } }))} onCommit={commit} />
    </Section>
  )
}

function Look({ s, kind, change, commit, luts, open, setOpen }: PanelProps) {
  const l = s.look
  const known = luts.find((x) => x.sha === l.lut)
  return (
    <Section title="Look" open={open.look ?? !!l.lut} onOpenChange={(o) => setOpen('look', o)} changed={differs(s, kind, ['look'])} onReset={() => {
      resetGroup(change, kind, 'look')
      commit()
    }}>
      <div className="flex items-center gap-2">
        <span className="w-[80px] text-[12px] text-ink-muted">LUT</span>
        <Select
          value={l.lut ?? 'none'}
          onValueChange={(v) => {
            const info = luts.find((x) => x.sha === v)
            change('LUT', (x) => ({ ...x, look: v === 'none' ? { ...x.look, lut: null, name: '' } : { ...x.look, lut: v, name: info?.name ?? '', space: guessSpace(info) ?? x.look.space } }))
            commit()
          }}
        >
          <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {l.lut && !known && <SelectItem value={l.lut}>{l.name || 'LUT'}</SelectItem>}
            {luts.map((x) => (
              <SelectItem key={x.sha} value={x.sha}>
                {x.folder ? `${x.folder} / ` : ''}
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SliderRow label="Amount" value={Math.round(l.amount * 100)} def={100} min={0} max={100} format={(v) => `${v}%`} disabled={!l.lut} onChange={(v) => change('LUT amount', (x) => ({ ...x, look: { ...x.look, amount: v / 100 } }))} onCommit={commit} />
      <div className="flex items-center gap-2">
        <span className="w-[80px] text-[12px] text-ink-muted">Made for</span>
        <Select
          value={l.space}
          disabled={!l.lut}
          onValueChange={(v) => {
            change('LUT input', (x) => ({ ...x, look: { ...x.look, space: v as LutSpace } }))
            commit()
          }}
        >
          <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 text-[12px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LUT_SPACES.map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {l.lut && LUT_SPACES.find((x) => x.id === l.space)?.log && <p className="text-[11px] text-ink-muted">A log LUT: it replaces the tone mapping, as on a camera monitor.</p>}
    </Section>
  )
}

/** A LUT's input space from its name or pack, e.g. "S-Log3" or "LogC". */
export function guessSpace(info?: { name: string; folder: string } | null): LutSpace | null {
  if (!info) return null
  const t = `${info.folder} ${info.name}`.toLowerCase().replace(/[\s_-]/g, '')
  if (/slog3|sgamut3/.test(t)) return 'slog3'
  if (/logc|alexa|arri/.test(t)) return 'logc3'
  if (/vlog|vgamut/.test(t)) return 'vlog'
  if (/flog|fgamut/.test(t)) return 'flog'
  if (/rec709|709/.test(t)) return 'rec709'
  return 'srgb'
}
