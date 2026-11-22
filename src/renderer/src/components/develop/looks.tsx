// The Develop view's left side: styles and LUTs with live previews on the photo, and the edit history.

import { useEffect, useMemo, useState } from 'react'
import { FolderInput, MoreHorizontal, Plus } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { guessSpace } from './panels'
import type { LookThumbs } from '../../develop/thumbs'
import { applyPartial, type DevelopSettings } from '../../../../shared/develop/settings'
import type { LutInfo, StyleInfo } from '../../../../shared/types'

export type Look = { kind: 'style'; style: StyleInfo } | { kind: 'lut'; lut: LutInfo }

export const lookSettings = (base: DevelopSettings, l: Look): DevelopSettings =>
  l.kind === 'style'
    ? { ...applyPartial(base, l.style.settings), styles: base.styles.includes(l.style.name) ? base.styles : [...base.styles, l.style.name] }
    : { ...base, look: { lut: l.lut.sha, name: l.lut.name, amount: 1, space: guessSpace(l.lut) ?? 'srgb' } }

const keyOf = (l: Look): string => (l.kind === 'style' ? `s${l.style.id}` : `l${l.lut.sha}`)

export function LooksPanel({
  styles,
  luts,
  base,
  thumbs,
  thumbsReady,
  onHover,
  onApply,
  onImport,
  onSaveStyle,
  onRenameStyle,
  onDeleteStyle,
  onExportStyle,
  onRemoveLut
}: {
  styles: StyleInfo[]
  luts: LutInfo[]
  /** The settings looks are previewed on (the photo's current, committed settings). */
  base: DevelopSettings | null
  thumbs: LookThumbs | null
  /** Changes when the thumbnail engine has a new photo. */
  thumbsReady: number
  onHover: (l: Look | null) => void
  onApply: (l: Look) => void
  onImport: () => void
  onSaveStyle: () => void
  onRenameStyle: (s: StyleInfo) => void
  onDeleteStyle: (s: StyleInfo) => void
  onExportStyle: (s: StyleInfo) => void
  onRemoveLut: (l: LutInfo) => void
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const looks = useMemo<Look[]>(() => [...styles.map((style) => ({ kind: 'style' as const, style })), ...luts.map((lut) => ({ kind: 'lut' as const, lut }))], [styles, luts])
  const baseKey = base ? JSON.stringify(base) : ''

  // Previews follow the photo's settings, rendered one by one after edits settle.
  useEffect(() => {
    if (!thumbs || !base) return
    let live = true
    const made: string[] = []
    const t = setTimeout(async () => {
      for (const l of looks) {
        if (!live) break
        try {
          const url = await thumbs.render(lookSettings(base, l))
          if (!url) continue
          if (!live) {
            URL.revokeObjectURL(url)
            break
          }
          made.push(url)
          setUrls((u) => ({ ...u, [keyOf(l)]: url }))
        } catch {
          // A broken LUT just has no preview.
        }
        // Leave the main thread (and GPU) to the editing between previews.
        await new Promise((r) => setTimeout(r, 30))
      }
    }, 1500)
    return () => {
      live = false
      clearTimeout(t)
      // Keep the shown previews until replaced; revoke later ones.
      setTimeout(() => made.forEach((u) => URL.revokeObjectURL(u)), 30000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thumbs, thumbsReady, baseKey, looks])

  const groups = new Map<string, Look[]>()
  for (const l of looks) {
    const g = l.kind === 'style' ? (l.style.folder || 'My styles') : `LUTs${l.lut.folder ? ` / ${l.lut.folder}` : ''}`
    groups.set(g, [...(groups.get(g) ?? []), l])
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1">
        <h3 className="flex-1 text-[13px] font-medium">Styles and LUTs</h3>
        <button type="button" className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink" onClick={onSaveStyle} title="Save these settings as a style" aria-label="Save as a style">
          <Plus className="size-4" />
        </button>
        <button type="button" className="rounded p-1 text-ink-muted hover:bg-white/10 hover:text-ink" onClick={onImport} title="Add LUTs (.cube, .3dl), folders of them, or Glimmr styles" aria-label="Add LUTs or styles">
          <FolderInput className="size-4" />
        </button>
      </div>
      {[...groups].map(([g, list]) => (
        <section key={g} className="flex flex-col gap-1.5">
          <h4 className="text-[11px] text-ink-muted">{g}</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {list.map((l) => {
              const k = keyOf(l)
              const name = l.kind === 'style' ? l.style.name : l.lut.name
              const notes = l.kind === 'lut' ? l.lut.notes : l.style.report ? [...l.style.report.approximate, ...l.style.report.unsupported].join('; ') : ''
              const mine = l.kind === 'lut' || !l.style.builtIn
              return (
                <div key={k} className="group relative">
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 rounded-md p-1 text-left hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onMouseEnter={() => onHover(l)}
                    onMouseLeave={() => onHover(null)}
                    onFocus={() => onHover(l)}
                    onBlur={() => onHover(null)}
                    onClick={() => onApply(l)}
                    title={notes ? `${name}\n${notes}` : name}
                  >
                    <span className={cn('block aspect-[3/2] w-full overflow-hidden rounded bg-black/40')}>{urls[k] && <img src={urls[k]} alt="" className="size-full object-cover" draggable={false} />}</span>
                    <span className="truncate text-[11px]">{name}</span>
                  </button>
                  {mine && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="absolute top-1.5 right-1.5 rounded bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`${name} options`}>
                          <MoreHorizontal className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {l.kind === 'style' ? (
                          <>
                            <DropdownMenuItem onSelect={() => onRenameStyle(l.style)}>Rename…</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onExportStyle(l.style)}>Export…</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => onDeleteStyle(l.style)}>
                              Delete
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem onSelect={() => onRemoveLut(l.lut)}>Remove from list</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {!luts.length && <p className="text-[11px] text-pretty text-ink-muted">Add .cube or .3dl LUTs, from Lightroom, Capture One, Resolve or a LUT pack, with the folder button above.</p>}
    </div>
  )
}

export function HistoryPanel({ steps, current, onPick }: { steps: { seq: number; label: string; at: number }[]; current: number | null; onPick: (seq: number) => void }) {
  if (!steps.length) return <p className="p-3 text-[11px] text-ink-muted">No edits yet.</p>
  return (
    <ol className="flex flex-col p-1.5" aria-label="Edit history">
      {[...steps].reverse().map((h) => (
        <li key={h.seq}>
          <button
            type="button"
            onClick={() => onPick(h.seq)}
            className={cn('flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-white/10', current === h.seq && 'bg-white/10')}
          >
            <span className="truncate">{h.label}</span>
            <span className="tnum shrink-0 text-[10px] text-ink-muted">{new Date(h.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
