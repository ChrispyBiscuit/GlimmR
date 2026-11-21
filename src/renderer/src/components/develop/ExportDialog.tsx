// Export photos as files: developed photos are rendered with their develop settings, others from their display file,
// with the crop applied. Options are remembered on this computer.

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { api } from '../../api'
import type { ExportOptions } from '../../../../shared/types'

const KEY = 'glimmr.export'
const DEFAULTS: ExportOptions = { format: 'jpeg', bits: 8, quality: 90, size: { mode: 'full', value: 2048 }, space: 'srgb', sharpen: 'off', metadata: 'all', suffix: '', folder: '' }

function load(): ExportOptions {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ExportOptions>) }
  } catch {
    return DEFAULTS
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
      <Label className="text-[13px] text-ink-muted">{label}</Label>
      {children}
    </div>
  )
}

function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ExportDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const [o, setO] = useState<ExportOptions>(load)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<ExportOptions>): void => setO((x) => ({ ...x, ...p }))
  const n = ids.length

  const run = async (): Promise<void> => {
    let folder = o.folder
    if (!folder) {
      folder = (await api.chooseExportFolder()) ?? ''
      if (!folder) return
      set({ folder })
    }
    const opts = { ...o, folder }
    try {
      localStorage.setItem(KEY, JSON.stringify(opts))
    } catch {
      // Not remembered; fine.
    }
    setBusy(true)
    try {
      const r = await api.exportPhotos(ids, opts)
      if (r.failed.length)
        toast.error(`${r.failed.length === 1 ? 'A photo' : `${r.failed.length} photos`} couldn’t be exported`, { description: r.failed.slice(0, 3).map((f) => `${f.name}: ${f.error}`).join('\n'), duration: 10000 })
      if (r.files.length) toast.success(`Exported ${r.files.length === 1 ? '1 photo' : `${r.files.length} photos`}`, { action: { label: 'Show', onClick: () => void api.showFile(r.files[0]) } })
      onClose()
    } catch (e) {
      toast.error('Export failed', { description: (e as Error).message.replace(/^Error invoking remote method 'api': Error: /, '') })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export {n === 1 ? 'photo' : `${n.toLocaleString()} photos`}</DialogTitle>
          <DialogDescription>Saves copies with edits applied. The originals aren’t changed.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Format">
            <Choice
              value={o.format}
              onChange={(format) => set({ format })}
              options={[
                ['jpeg', 'JPEG'],
                ['png', 'PNG'],
                ['tiff', 'TIFF']
              ]}
            />
          </Field>
          {o.format === 'jpeg' ? (
            <Field label={`Quality ${o.quality}`}>
              <Slider min={40} max={100} step={1} value={[o.quality]} onValueChange={([quality]) => set({ quality })} aria-label="JPEG quality" />
            </Field>
          ) : (
            <Field label="Bit depth">
              <Choice
                value={String(o.bits) as '8' | '16'}
                onChange={(b) => set({ bits: Number(b) as 8 | 16 })}
                options={[
                  ['8', '8 bits per channel'],
                  ['16', '16 bits per channel (for further editing)']
                ]}
              />
            </Field>
          )}
          <Field label="Size">
            <div className="flex gap-2">
              <Choice
                value={o.size.mode}
                onChange={(mode) => set({ size: { mode, value: mode === 'megapixels' ? 12 : o.size.mode === 'megapixels' ? 2048 : o.size.value } })}
                options={[
                  ['full', 'Full size'],
                  ['long', 'Long edge'],
                  ['short', 'Short edge'],
                  ['megapixels', 'Megapixels']
                ]}
              />
              {o.size.mode !== 'full' && (
                <Input
                  type="number"
                  className="w-28"
                  min={1}
                  value={o.size.value}
                  onChange={(e) => set({ size: { ...o.size, value: Math.max(1, Number(e.target.value) || 1) } })}
                  aria-label={o.size.mode === 'megapixels' ? 'Megapixels' : 'Pixels'}
                />
              )}
            </div>
          </Field>
          <Field label="Colour space">
            <Choice
              value={o.space}
              onChange={(space) => set({ space })}
              options={[
                ['srgb', 'sRGB (web and most uses)'],
                ['p3', 'Display P3 (wide-gamut screens)']
              ]}
            />
          </Field>
          <Field label="Sharpen for screen">
            <Choice
              value={o.sharpen}
              onChange={(sharpen) => set({ sharpen })}
              options={[
                ['off', 'Off'],
                ['low', 'Low'],
                ['standard', 'Standard'],
                ['high', 'High']
              ]}
            />
          </Field>
          <Field label="Metadata">
            <Choice
              value={o.metadata}
              onChange={(metadata) => set({ metadata })}
              options={[
                ['all', 'All (camera, date, title, creator)'],
                ['copyright', 'Copyright only'],
                ['none', 'None']
              ]}
            />
          </Field>
          <Field label="Add to file names">
            <Input value={o.suffix} placeholder="e.g. -edit" onChange={(e) => set({ suffix: e.target.value.replace(/[\\/:*?"<>|]/g, '') })} />
          </Field>
          <Field label="Folder">
            <div className="flex min-w-0 gap-2">
              <span className="min-w-0 flex-1 truncate self-center text-[13px]" title={o.folder}>
                {o.folder || 'Choose when exporting'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const f = await api.chooseExportFolder()
                  if (f) set({ folder: f })
                }}
              >
                Choose…
              </Button>
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
