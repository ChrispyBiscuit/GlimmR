import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Flag, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api, thumbUrl } from '../api'
import { confirmDialog } from '../dialogs'
import { fmtBytes, fmtDate, fmtNum, LABEL_COLORS } from '../format'
import { formatLabel, formatOfExt } from '../../../shared/formats'
import type { DuplicateGroup, DuplicatePhoto } from '../../../shared/types'

const mac = navigator.platform.toLowerCase().includes('mac')
const BIN = mac ? 'Trash' : 'Recycle Bin'
const TIER: Record<DuplicateGroup['tier'], { title: string; hint: string }> = {
  exact: { title: 'Exact copies', hint: 'The same file in more than one place.' },
  picture: { title: 'Same picture', hint: 'The same pixels with different metadata or a different name.' }
}

/** What's shown for each photo, so differences from the one being kept stand out. */
const FIELDS: { label: string; value: (p: DuplicatePhoto) => string }[] = [
  { label: 'Format', value: (p) => (p.companion ? `RAW + JPEG (${p.ext.toUpperCase()})` : formatLabel(formatOfExt(p.ext)?.id ?? p.ext)) },
  { label: 'Pixels', value: (p) => (p.width && p.height ? `${p.width} × ${p.height}` : '—') },
  { label: 'File size', value: (p) => fmtBytes(p.size) },
  { label: 'Taken', value: (p) => (p.takenAt ? fmtDate(p.takenAt) : '—') },
  { label: 'Marks', value: (p) => [p.rating ? '★'.repeat(p.rating) : '', p.flag === 'pick' ? 'Picked' : p.flag === 'reject' ? 'Rejected' : '', p.label ?? ''].filter(Boolean).join(' ') || '—' },
  { label: 'Keywords', value: (p) => (p.keywordCount ? fmtNum(p.keywordCount) : '—') },
  { label: 'Albums', value: (p) => (p.albumCount ? fmtNum(p.albumCount) : '—') },
  { label: 'Edited', value: (p) => (p.edit ? 'Crop or rotation' : '—') }
]

/** Duplicates: review each group, keep one photo, and send the rest to the trash with their marks merged. */
export function DuplicatesView() {
  const s = useStore()
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null)
  const [keepers, setKeepers] = useState<Record<string, number>>({})
  const [tier, setTier] = useState<'all' | DuplicateGroup['tier']>('all')
  const [busy, setBusy] = useState(false)
  const job = Object.values(s.jobs).find((j) => j.label === 'Finding duplicates')

  const load = (): void => {
    setGroups(null)
    void api.duplicates().then((g) => {
      setGroups(g)
      setKeepers(Object.fromEntries(g.map((x) => [x.key, x.keeper])))
    })
  }
  useEffect(load, [])

  const shown = useMemo(() => (groups ?? []).filter((g) => tier === 'all' || g.tier === tier), [groups, tier])
  const exact = (groups ?? []).filter((g) => g.tier === 'exact')
  const drop = (keys: string[]): void => setGroups((gs) => (gs ?? []).filter((g) => !keys.includes(g.key)))

  const merge = async (list: DuplicateGroup[], ask: boolean): Promise<void> => {
    const removing = list.reduce((n, g) => n + g.photos.length - 1, 0)
    if (
      ask &&
      !(await confirmDialog({
        title: `Merge ${list.length === 1 ? 'this group' : `${fmtNum(list.length)} groups`}?`,
        description: `${fmtNum(removing)} ${removing === 1 ? 'copy goes' : 'copies go'} to the ${BIN} with ${removing === 1 ? 'its' : 'their'} sidecars. The photo${list.length === 1 ? '' : 's'} kept get${list.length === 1 ? 's' : ''} the highest rating, any pick, and every keyword and album of the copies.`,
        confirmLabel: 'Merge',
        destructive: true
      }))
    )
      return
    setBusy(true)
    const r = await api.mergeDuplicates(list.map((g) => ({ keep: keepers[g.key], drop: g.photos.map((p) => p.id).filter((id) => id !== keepers[g.key]) })))
    setBusy(false)
    if (r.error) toast.error('Some copies couldn’t be moved', { description: r.error })
    else toast.success(`Merged ${list.length === 1 ? '1 group' : `${fmtNum(list.length)} groups`}: ${fmtNum(r.merged)} ${r.merged === 1 ? 'copy' : 'copies'} moved to the ${BIN}`)
    drop(list.map((g) => g.key))
    void s.refreshSidebar()
    s.refreshResults()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 px-6 pt-5 pb-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="display flex items-center gap-2 text-xl">
            <Copy className="size-5 text-ink-muted" aria-hidden />
            Duplicates
          </h1>
          {groups && <span className="tnum text-[13px] text-ink-muted">{groups.length ? `${fmtNum(groups.length)} groups` : 'None found'}</span>}
          <div className="ml-auto flex items-center gap-1">
            {(['all', 'exact', 'picture'] as const).map((t) => (
              <Button key={t} variant="ghost" size="sm" aria-pressed={tier === t} className={cn('h-7 text-xs', tier === t && 'bg-accent text-ink')} onClick={() => setTier(t)}>
                {t === 'all' ? 'All' : TIER[t].title}
                {groups && <span className="tnum text-ink-muted">{fmtNum(t === 'all' ? groups.length : groups.filter((g) => g.tier === t).length)}</span>}
              </Button>
            ))}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={load} disabled={!groups || busy}>
              Look Again
            </Button>
            {exact.length > 0 && (
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void merge(exact, true)}>
                Merge All Exact Copies ({fmtNum(exact.length)})
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-pretty text-ink-muted">
          RAW + JPEG pairs from the camera are one photo, never duplicates. Merging keeps the starred photo (click another to keep it instead) and gives it the copies’ marks, keywords and albums.
        </p>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {!groups && (
          <div className="mx-auto mt-16 flex max-w-sm flex-col gap-2 text-center text-sm text-ink-muted">
            Looking for duplicates…
            {job && job.total > 0 && <Progress value={(job.done / job.total) * 100} className="h-1" />}
          </div>
        )}
        {groups && !groups.length && <p className="mt-16 text-center text-sm text-ink-muted">No duplicates in the library.</p>}
        <div className="flex flex-col gap-4">
          {shown.map((g) => {
            const keep = g.photos.find((p) => p.id === keepers[g.key]) ?? g.photos[0]
            return (
              <section key={g.key} aria-label={TIER[g.tier].title} className="rounded-md border bg-raised p-4">
                <header className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-medium">{TIER[g.tier].title}</h2>
                  <span className="text-xs text-ink-muted">
                    {fmtNum(g.photos.length)} photos · {TIER[g.tier].hint}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => drop([g.key])}>
                      Skip
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={busy}
                      onClick={() => {
                        void api.notDuplicates(g.photos.map((p) => p.id))
                        drop([g.key])
                        toast('Glimmr won’t show these as duplicates again')
                      }}
                    >
                      Not Duplicates
                    </Button>
                    <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void merge([g], true)}>
                      Keep One, Merge
                    </Button>
                  </div>
                </header>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {g.photos.map((p) => {
                    const kept = p.id === keep.id
                    return (
                      <div key={p.id} className={cn('flex w-56 shrink-0 flex-col gap-2 rounded-md p-2', kept ? 'bg-accent ring-1 ring-ink/40' : 'opacity-90')}>
                        <button
                          type="button"
                          aria-pressed={kept}
                          aria-label={kept ? `Keeping ${p.filename}` : `Keep ${p.filename} instead`}
                          onClick={() => setKeepers((k) => ({ ...k, [g.key]: p.id }))}
                          className="relative aspect-[3/2] overflow-hidden rounded-sm bg-ink/5"
                        >
                          <img src={thumbUrl(p.id, p.rev)} alt="" loading="lazy" className="size-full object-cover" />
                          <span className={cn('absolute top-1.5 left-1.5 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium', kept ? 'bg-ink text-raised' : 'bg-black/55 text-white')}>
                            {kept ? <Star className="size-3 fill-current" /> : <X className="size-3" />}
                            {kept ? 'Keep' : `To ${BIN}`}
                          </span>
                          <span className="absolute right-1.5 bottom-1.5 flex gap-1">
                            {p.flag === 'pick' && <Flag className="size-3 fill-current text-pick" />}
                            {p.label && <span className="size-2.5 rounded-full" style={{ background: LABEL_COLORS[p.label] }} />}
                          </span>
                        </button>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium" title={p.filename}>
                            {p.filename}
                          </p>
                          <p className="selectable truncate text-[11px] text-ink-muted" title={p.path}>
                            {p.relPath.includes('/') ? p.relPath.slice(0, p.relPath.lastIndexOf('/')) : '(top folder)'}
                          </p>
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                          {FIELDS.map((f) => {
                            const v = f.value(p)
                            const differs = !kept && v !== f.value(keep)
                            return (
                              <div key={f.label} className="contents">
                                <dt className="text-ink-muted">{f.label}</dt>
                                <dd className={cn('tnum truncate', differs && 'font-medium text-marker')} title={v}>
                                  {v}
                                  {differs && kept === false && f.label === 'Keywords' && p.keywordCount > 0 && <Check className="ml-1 inline size-3 text-ink-muted" aria-label="merged into the kept photo" />}
                                </dd>
                              </div>
                            )
                          })}
                        </dl>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
