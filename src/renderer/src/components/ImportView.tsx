import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CircleAlert, Flag, FolderOpen, HardDriveDownload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { fmtBytes, fmtDate, fmtNum, LABEL_COLORS } from '../format'
import { DEFAULT_TEMPLATE, TEMPLATE_TOKENS, folderFor } from '../../../shared/importTemplate'
import type { ImportItem, ImportMarks, ImportResult, PhotoUpdate } from '../../../shared/types'
import { CullView, type CullItem } from './CullView'

const mac = navigator.platform.toLowerCase().includes('mac')
const thumb = (token: string, i: number): string => `glimmr://import/${token}/${i}?s=thumb`
const preview = (token: string, i: number, s: 'preview' | 'full' = 'preview'): string => `glimmr://import/${token}/${i}?s=${s}`
const dayOf = (ms: number | null): string => (ms == null ? 'Undated' : new Date(ms).toDateString())

/**
 * Import from a card or folder: see what's new, cull on the card if you like, choose where it goes, and copy. The
 * card is only read; Glimmr never deletes or changes anything on it.
 */
export function ImportView() {
  const s = useStore()
  const src = s.importSource!
  const settings = s.settings?.import
  const [selected, setSelected] = useState<Set<string>>(() => new Set(src.items.filter((i) => !i.already).map((i) => i.key)))
  const [marks, setMarks] = useState<ImportMarks>({})
  const [rootId, setRootId] = useState<number | null>(() => (settings?.rootId && s.roots.some((r) => r.id === settings.rootId) ? settings.rootId : (s.roots[0]?.id ?? null)))
  const [template, setTemplate] = useState(settings?.template || DEFAULT_TEMPLATE)
  const [event, setEvent] = useState('')
  const [videos, setVideos] = useState(settings?.copyVideos ?? true)
  const [cullAt, setCullAt] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<(ImportResult & { error?: string }) | null>(null)
  const last = useRef<number | null>(null)
  const job = Object.values(s.jobs).find((j) => j.kind === 'import')

  const close = (): void => {
    api.closeImportSource(src.token)
    s.setImportSource(null)
  }

  const items = src.items
  const already = items.filter((i) => i.already).length
  const chosen = items.filter((i) => selected.has(i.key))
  const bytes = chosen.reduce((n, i) => n + i.size, 0) + (videos ? src.videoBytes : 0)
  const days = useMemo(() => {
    const out: { day: string; items: ImportItem[] }[] = []
    for (const it of items) {
      const d = dayOf(it.takenAt)
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] })
      out[out.length - 1].items.push(it)
    }
    return out
  }, [items])
  // The folders this import will create or add to, with how many photos each gets.
  const folders = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of chosen) {
      const f = folderFor(template, { takenAt: it.takenAt, event, camera: it.camera, card: src.label }) || '(the library folder itself)'
      m.set(f, (m.get(f) ?? 0) + 1)
    }
    return [...m.entries()]
  }, [chosen, template, event])
  const root = s.roots.find((r) => r.id === rootId)

  const toggle = (it: ImportItem, e: React.MouseEvent): void => {
    const next = new Set(selected)
    if (e.shiftKey && last.current != null) {
      const [a, b] = [Math.min(last.current, it.index), Math.max(last.current, it.index)]
      const on = !selected.has(it.key)
      for (let i = a; i <= b; i++) on ? next.add(items[i].key) : next.delete(items[i].key)
    } else if (next.has(it.key)) next.delete(it.key)
    else next.add(it.key)
    last.current = it.index
    setSelected(next)
  }
  const selectWhere = (f: (i: ImportItem) => boolean): void => setSelected(new Set(items.filter(f).map((i) => i.key)))

  const mark = (index: number, u: PhotoUpdate): void => {
    const key = items[index].key
    setMarks((m) => {
      const cur = m[key] ?? {}
      const next = { ...cur }
      if ('flag' in u) next.flag = u.flag
      if ('rating' in u) next.rating = u.rating
      if ('label' in u) next.label = u.label
      return { ...m, [key]: next }
    })
    // Rejecting on the card leaves the photo on the card; picking selects it.
    if (u.flag === 'reject') setSelected((sel) => new Set([...sel].filter((k) => k !== key)))
    if (u.flag === 'pick') setSelected((sel) => new Set(sel).add(key))
  }

  const cullItems: CullItem[] = useMemo(
    () =>
      items.map((it) => ({
        key: it.key,
        name: it.name,
        thumb: thumb(src.token, it.index),
        preview: preview(src.token, it.index),
        full: preview(src.token, it.index, 'full'),
        badge: it.already ? 'In library' : it.companion ? 'RAW+JPEG' : it.raw ? 'RAW' : undefined,
        flag: marks[it.key]?.flag ?? null,
        rating: marks[it.key]?.rating ?? 0,
        label: marks[it.key]?.label ?? null
      })),
    [items, marks]
  )

  const start = async (): Promise<void> => {
    if (!rootId || !chosen.length) return
    setRunning(true)
    const r = await api.runImport(src.token, { keys: chosen.map((i) => i.key), rootId, template, event, copyVideos: videos && src.videos > 0 }, marks)
    setRunning(false)
    setResult(r)
    void s.refreshSidebar()
    s.refreshResults()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (cullAt != null || document.querySelector('[data-slot="dialog-content"], [role="menu"], [role="listbox"]')) return
      if (e.key === 'Escape' && !running) close()
      if ((mac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'a' && !(e.target as HTMLElement).closest('input')) {
        e.preventDefault()
        selectWhere(() => true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const picks = Object.values(marks).filter((m) => m.flag === 'pick').length
  const rejects = Object.values(marks).filter((m) => m.flag === 'reject').length

  return (
    <div role="dialog" aria-modal="true" aria-label="Import" className="fixed inset-0 z-40 flex flex-col bg-canvas text-ink">
      <header className={cn('app-drag titlebar-inset flex h-12 shrink-0 items-center gap-3 border-b bg-panel pl-3', mac && 'pl-20')}>
        <Button variant="ghost" size="sm" onClick={close} disabled={running}>
          <ArrowLeft data-icon="inline-start" />
          Back
        </Button>
        <h1 className="flex items-center gap-2 text-[13px] font-medium">
          <HardDriveDownload className="size-4 text-ink-muted" aria-hidden />
          Import from {src.label}
        </h1>
        <span className="tnum text-xs text-ink-muted">
          {fmtNum(items.length)} photos · {fmtNum(items.length - already)} new{already ? ` · ${fmtNum(already)} already in library` : ''}
          {src.videos ? ` · ${fmtNum(src.videos)} videos` : ''}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2">
            <span className="mr-1 text-xs text-ink-muted">Select</span>
            {(
              [
                ['All new', () => selectWhere((i) => !i.already)],
                ['Picks', () => selectWhere((i) => marks[i.key]?.flag === 'pick')],
                ['All but rejects', () => selectWhere((i) => !i.already && marks[i.key]?.flag !== 'reject')],
                ['All', () => selectWhere(() => true)],
                ['None', () => setSelected(new Set())]
              ] as [string, () => void][]
            ).map(([label, fn]) => (
              <Button key={label} variant="ghost" size="sm" className="h-7 text-xs" onClick={fn} disabled={running}>
                {label}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setCullAt(0)} disabled={running || !items.length}>
              <Flag data-icon="inline-start" />
              Cull on the Card
            </Button>
            {(picks > 0 || rejects > 0) && (
              <span className="tnum text-xs text-ink-muted">
                {fmtNum(picks)} picked · {fmtNum(rejects)} rejected
              </span>
            )}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6">
            {!items.length && <p className="py-16 text-center text-sm text-ink-muted">No photos on {src.label}.</p>}
            {days.map((d) => (
              <div key={d.day} className="pt-4">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-[13px] font-medium">{d.day === 'Undated' ? 'Undated' : fmtDate(d.items[0].takenAt, { dateStyle: 'full' })}</h2>
                  <span className="tnum text-xs text-ink-muted">{fmtNum(d.items.length)}</span>
                  <Button
                    variant="link"
                    size="xs"
                    className="text-ink-muted"
                    onClick={() => {
                      const all = d.items.every((i) => selected.has(i.key))
                      const next = new Set(selected)
                      for (const i of d.items) all ? next.delete(i.key) : next.add(i.key)
                      setSelected(next)
                    }}
                  >
                    {d.items.every((i) => selected.has(i.key)) ? 'Deselect day' : 'Select day'}
                  </Button>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                  {d.items.map((it) => {
                    const on = selected.has(it.key)
                    const m = marks[it.key]
                    return (
                      <button
                        key={it.key}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${it.name}${it.already ? ', already in library' : ''}`}
                        onClick={(e) => toggle(it, e)}
                        onDoubleClick={() => setCullAt(it.index)}
                        className={cn('group relative aspect-[3/2] overflow-hidden rounded-sm bg-ink/5 [content-visibility:auto]', on && 'ring-2 ring-ink ring-offset-2 ring-offset-canvas', it.already && !on && 'opacity-40')}
                      >
                        <img src={thumb(src.token, it.index)} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
                        <span className={cn('absolute top-1.5 left-1.5 flex size-4 items-center justify-center rounded-sm border border-white/70 bg-black/30 text-white', on && 'border-ink bg-ink text-raised')}>
                          {on && <Check className="size-3" />}
                        </span>
                        <span className="absolute top-1.5 right-1.5 flex gap-1">
                          {it.already && <span className="rounded-sm bg-black/60 px-1 text-[10px] text-white">In library</span>}
                          {(it.companion || it.raw) && <span className="rounded-sm bg-black/55 px-1 text-[10px] text-white">{it.companion ? 'RAW+JPEG' : 'RAW'}</span>}
                        </span>
                        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-left text-[10px] text-white/90">
                          <span className="min-w-0 flex-1 truncate">{it.name}</span>
                          {m?.flag === 'pick' && <Flag className="size-3 fill-current text-pick" aria-label="Picked" />}
                          {m?.flag === 'reject' && <X className="size-3 text-reject" aria-label="Rejected" />}
                          {!!m?.rating && <span className="text-marker">{'★'.repeat(m.rating)}</span>}
                          {m?.label && <span className="size-2 rounded-full" style={{ background: LABEL_COLORS[m.label] }} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside aria-label="Import settings" className="scroll-thin flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l bg-panel p-4">
          {result ? (
            <Summary result={result} where={root?.name ?? ''} onShow={() => {
              if (result.importId) s.navigate({ type: 'import', id: result.importId }, `Imported from ${src.label}`)
              close()
            }} onDone={close} />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-normal text-ink-muted">Copy into</Label>
                {s.roots.length ? (
                  <Select value={rootId != null ? String(rootId) : ''} onValueChange={(v) => setRootId(Number(v))} disabled={running}>
                    <SelectTrigger size="sm" aria-label="Library folder">
                      <SelectValue placeholder="Choose a library folder" />
                    </SelectTrigger>
                    <SelectContent>
                      {s.roots.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          <FolderOpen />
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-ink-muted">Add a photo folder to the library first: photos are copied into it.</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-template" className="text-xs font-normal text-ink-muted">
                  Folders
                </Label>
                <Input id="import-template" value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} autoComplete="off" className="h-8 font-mono text-xs" disabled={running} />
                <div className="flex flex-wrap gap-1">
                  {TEMPLATE_TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      title={t.label}
                      className="rounded-sm border px-1.5 py-px font-mono text-[10px] text-ink-muted hover:text-ink"
                      onClick={() => setTemplate((v) => `${v}${t.token}`)}
                    >
                      {t.token}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="import-event" className="text-xs font-normal text-ink-muted">
                  Event name
                </Label>
                <Input id="import-event" value={event} placeholder="Lisbon" onChange={(e) => setEvent(e.target.value)} autoComplete="off" className="h-8 text-xs" disabled={running} />
              </div>
              <div className="flex flex-col gap-1 rounded-md bg-ink/5 p-2.5">
                <span className="text-[11px] text-ink-muted">Goes to</span>
                {folders.length ? (
                  folders.slice(0, 8).map(([f, n]) => (
                    <div key={f} className="flex items-baseline gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={f}>
                        {root ? `${root.name}/` : ''}
                        {f}
                      </span>
                      <span className="tnum text-ink-muted">{fmtNum(n)}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-ink-muted">Select photos to import.</span>
                )}
                {folders.length > 8 && <span className="text-[11px] text-ink-muted">and {fmtNum(folders.length - 8)} more folders</span>}
              </div>
              {src.videos > 0 && (
                <label className="flex items-center justify-between gap-3 text-xs">
                  <span>
                    Copy {fmtNum(src.videos)} videos too
                    <span className="block text-[11px] text-ink-muted">Videos are copied, not shown in Glimmr yet.</span>
                  </span>
                  <Switch checked={videos} onCheckedChange={setVideos} aria-label="Copy videos" disabled={running} />
                </label>
              )}
              <p className="text-[11px] leading-snug text-pretty text-ink-muted">
                Every copy is checked against the original. Photos already in the library are never copied twice. Nothing on {src.label} is changed or deleted.
              </p>
              <div className="mt-auto flex flex-col gap-2">
                {running && job && (
                  <div className="flex flex-col gap-1.5">
                    <Progress value={job.total ? (job.done / job.total) * 100 : 0} className="h-1" />
                    <span className="truncate text-[11px] text-ink-muted">{job.message ?? 'Starting…'}</span>
                  </div>
                )}
                <Button size="lg" disabled={running || !chosen.length || !rootId} onClick={() => void start()}>
                  <HardDriveDownload data-icon="inline-start" />
                  {running ? 'Importing…' : `Import ${chosen.length === 1 ? '1 photo' : `${fmtNum(chosen.length)} photos`}`}
                </Button>
                {running && job && (
                  <Button variant="ghost" size="sm" onClick={() => api.cancelJob(job.id)}>
                    Cancel
                  </Button>
                )}
                {!running && chosen.length > 0 && <span className="tnum text-center text-[11px] text-ink-muted">{fmtBytes(bytes)}</span>}
              </div>
            </>
          )}
        </aside>
      </div>

      {cullAt != null && <CullView title={`on ${src.label}`} items={cullItems} start={cullAt} onMark={mark} onClose={() => setCullAt(null)} />}
    </div>
  )
}

function Summary({ result, where, onShow, onDone }: { result: ImportResult & { error?: string }; where: string; onShow: () => void; onDone: () => void }) {
  const ok = !result.error && !result.failed
  return (
    <div className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {ok ? <Check className="size-4 text-pick" /> : <CircleAlert className="size-4 text-reject" />}
        {result.error ? 'The import stopped' : result.failed ? 'Imported, with problems' : 'Imported'}
      </h2>
      {result.error && <p className="text-xs text-reject">{result.error}</p>}
      <dl className="tnum grid grid-cols-[1fr_auto] gap-y-1 text-xs">
        <dt className="text-ink-muted">Copied and checked</dt>
        <dd>{fmtNum(result.imported)}</dd>
        {result.skipped > 0 && (
          <>
            <dt className="text-ink-muted">Already in the library</dt>
            <dd>{fmtNum(result.skipped)}</dd>
          </>
        )}
        {result.videos > 0 && (
          <>
            <dt className="text-ink-muted">Videos</dt>
            <dd>{fmtNum(result.videos)}</dd>
          </>
        )}
        {result.failed > 0 && (
          <>
            <dt className="text-reject">Failed</dt>
            <dd className="text-reject">{fmtNum(result.failed)}</dd>
          </>
        )}
      </dl>
      {result.folders.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] text-ink-muted">In {where}</span>
          {result.folders.slice(0, 6).map((f) => (
            <span key={f} className="truncate font-mono text-[11px]">
              {f}
            </span>
          ))}
        </div>
      )}
      {result.errors.length > 0 && (
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[11px] text-reject">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-pretty text-ink-muted">The card is untouched. When you’re happy with the copies, format it in the camera.</p>
      <div className="flex gap-2">
        {result.importId > 0 && result.imported > 0 && (
          <Button className="flex-1" onClick={onShow}>
            Show Imported Photos
          </Button>
        )}
        <Button variant="outline" className="flex-1" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}
