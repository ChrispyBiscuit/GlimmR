import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Shuffle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useStore } from '../store'
import { api } from '../api'
import { fmtBytes, fmtNum } from '../format'
import { packRows, GAP } from '../layout'
import { Tile } from './Tile'
import type { LibraryStats, Photo } from '../../../shared/types'

interface Data {
  stats: LibraryStats
  onThisDay: { year: number; photos: Photo[] }[]
  highlights: Photo[]
  lookBack: { label: string; query: string; photos: Photo[] } | null
  recent: Photo[]
}

const aspectOf = (p: Photo): number => (p.width && p.height ? p.width / p.height : 1.5)

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Photos in justified rows at their true aspect ratios, limited to a few rows. */
function PhotoRows({ photos, target, maxRows = 2, onOpen }: { photos: Photo[]; target: number; maxRows?: number; onOpen: (i: number) => void }) {
  const s = useStore()
  const [ref, width] = useWidth<HTMLDivElement>()
  const rows = width ? packRows(photos.map(aspectOf), 0, photos.length, width, target).slice(0, maxRows) : []
  return (
    <div ref={ref} className="flex flex-col" style={{ gap: GAP }}>
      {rows.map((r, ri) => (
        <div key={ri} className="flex" style={{ gap: GAP, height: r.height }}>
          {r.items.map((it) => (
            <Tile key={photos[it.index].id} photo={s.cache.get(photos[it.index].id) ?? photos[it.index]} width={it.width} height={r.height} tabIndex={0} onClick={() => onOpen(it.index)} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A photo-book spread: one large photo beside a two-row cluster that exactly fills the remaining space. */
function Spread({ photos, onOpen }: { photos: Photo[]; onOpen: (i: number) => void }) {
  const s = useStore()
  const [ref, width] = useWidth<HTMLDivElement>()
  const [lead, ...rest] = photos
  if (!lead) return null
  const height = Math.min(440, Math.max(280, width * 0.34))
  const leadWidth = rest.length ? Math.min(width * 0.6, aspectOf(lead) * height) : Math.min(width, aspectOf(lead) * height)
  const clusterWidth = width - leadWidth - GAP
  const rowCount = rest.length > 2 ? 2 : 1
  const rowHeight = (height - GAP * (rowCount - 1)) / rowCount
  // Split into rows, then scale each row to the cluster width (tiles crop slightly to keep the grid square).
  const rows = clusterWidth > 0 ? packRows(rest.map(aspectOf), 0, rest.length, clusterWidth, rowHeight).slice(0, rowCount) : []
  return (
    <div ref={ref} className="flex" style={{ gap: GAP, height }}>
      {width > 0 && (
        <>
          <Tile photo={s.cache.get(lead.id) ?? lead} width={leadWidth} height={height} tabIndex={0} onClick={() => onOpen(0)} />
          <div className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
            {rows.map((r, ri) => {
              const natural = r.items.reduce((sum, it) => sum + it.width / r.height, 0) * rowHeight
              const scale = (clusterWidth - GAP * (r.items.length - 1)) / natural
              return (
                <div key={ri} className="flex" style={{ gap: GAP, height: rowHeight }}>
                  {r.items.map((it) => {
                    const p = rest[it.index]
                    return <Tile key={p.id} photo={s.cache.get(p.id) ?? p} width={(it.width / r.height) * rowHeight * scale} height={rowHeight} tabIndex={0} onClick={() => onOpen(it.index + 1)} />
                  })}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function Chapter({ title, meta, action, children }: { title: string; meta?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-14 first:mt-0">
      <div className="mb-4 flex items-end gap-4">
        <h2 className="display text-[26px] leading-none text-balance">{title}</h2>
        {meta && <span className="pb-0.5 text-[13px] text-ink-muted">{meta}</span>}
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

export function Rediscover() {
  const s = useStore()
  const [data, setData] = useState<Data | null>(null)
  const [shuffled, setShuffled] = useState<Photo[]>([])

  const load = useCallback(async () => {
    const [stats, onThisDay, highlights, lookBack, recent] = await Promise.all([api.stats(), api.onThisDay(), api.highlights(18), api.lookBack(), api.recentlyAdded(16)])
    s.putPhotos([...onThisDay.flatMap((d) => d.photos), ...highlights, ...(lookBack?.photos ?? []), ...recent])
    setData({ stats, onThisDay, highlights, lookBack, recent })
  }, [s.putPhotos])

  useEffect(() => void load(), [load])
  useEffect(() => {
    if (data && data.stats.photos < 50) void load()
  }, [s.libraryVersion])

  const open = (list: Photo[], index: number): void => s.setViewer({ ids: list.map((p) => p.id), index, slideshow: false })

  if (!data)
    return (
      <div className="flex flex-col gap-6 p-10">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )

  const st = data.stats
  const now = new Date()
  const today = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' }).format(now)
  const years = st.firstYear && st.lastYear ? (st.firstYear === st.lastYear ? `${st.firstYear}` : `${st.firstYear} to ${st.lastYear}`) : null

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-10 pt-10 pb-24">
        <div className="mb-12 flex items-center gap-4">
          <p className="text-[13px] text-pretty text-ink-muted">
            {fmtNum(st.photos)} photos{years ? ` from ${years}` : ''}, {st.cameras === 1 ? 'one camera' : `${st.cameras} cameras`}, {fmtBytes(st.bytes)}.
            {st.topLens ? ` Most used lens: ${st.topLens}.` : ''}
          </p>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" disabled={!data.highlights.length} onClick={() => s.setViewer({ ids: data.highlights.map((p) => p.id), index: 0, slideshow: true })}>
            <Play data-icon="inline-start" />
            Play Highlights
          </Button>
        </div>

        {data.onThisDay.length > 0 ? (
          data.onThisDay.map((d) => {
            const ago = now.getFullYear() - d.year
            return (
              <Chapter key={d.year} title={`${today}, ${d.year}`} meta={`${ago} ${ago === 1 ? 'year' : 'years'} ago today`}>
                <Spread photos={d.photos.slice(0, 9)} onOpen={(i) => open(d.photos, i)} />
              </Chapter>
            )
          })
        ) : data.lookBack ? (
          <Chapter
            title={data.lookBack.label}
            meta="Nothing from this day in earlier years, so here’s a month from your archive."
            action={
              <Button variant="ghost" size="sm" onClick={() => s.navigate({ type: 'all' }, data.lookBack!.label, data.lookBack!.query)}>
                See the Month
              </Button>
            }
          >
            <Spread photos={data.lookBack.photos.slice(0, 9)} onOpen={(i) => open(data.lookBack!.photos, i)} />
          </Chapter>
        ) : null}

        {data.onThisDay.length > 0 && data.lookBack && (
          <Chapter
            title={data.lookBack.label}
            meta="A month from your archive"
            action={
              <Button variant="ghost" size="sm" onClick={() => s.navigate({ type: 'all' }, data.lookBack!.label, data.lookBack!.query)}>
                See the Month
              </Button>
            }
          >
            <PhotoRows photos={data.lookBack.photos} target={200} maxRows={1} onOpen={(i) => open(data.lookBack!.photos, i)} />
          </Chapter>
        )}

        {data.highlights.length > 0 && (
          <Chapter
            title="Highlights"
            meta="Your top-rated and picked photos"
            action={
              <Button variant="ghost" size="sm" onClick={async () => setData({ ...data, highlights: await api.highlights(18) })}>
                <Shuffle data-icon="inline-start" />
                Show Others
              </Button>
            }
          >
            <PhotoRows photos={data.highlights} target={240} maxRows={3} onOpen={(i) => open(data.highlights, i)} />
          </Chapter>
        )}

        <Chapter
          title="Anything at all"
          meta="A random handful from the whole library"
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const list = await api.shuffle(24)
                s.putPhotos(list)
                setShuffled(list)
              }}
            >
              <Shuffle data-icon="inline-start" />
              {shuffled.length ? 'Shuffle Again' : 'Shuffle'}
            </Button>
          }
        >
          {shuffled.length ? (
            <PhotoRows photos={shuffled} target={180} maxRows={2} onOpen={(i) => open(shuffled, i)} />
          ) : (
            <p className="text-[13px] text-ink-muted">Press Shuffle to see photos you might have forgotten.</p>
          )}
        </Chapter>

        {data.recent.length > 0 && (
          <Chapter
            title="Recently added"
            action={
              <Button variant="ghost" size="sm" onClick={() => s.navigate({ type: 'recent' }, 'Recently added')}>
                See All
              </Button>
            }
          >
            <PhotoRows photos={data.recent} target={160} maxRows={1} onOpen={(i) => open(data.recent, i)} />
          </Chapter>
        )}
      </div>
    </div>
  )
}
