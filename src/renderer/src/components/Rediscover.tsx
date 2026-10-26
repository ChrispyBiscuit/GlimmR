import { useCallback, useEffect, useState } from 'react'
import { Button, Empty, Flex, Skeleton, Statistic, Typography } from 'antd'
import { ReloadOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { fmtBytes, fmtNum } from '../format'
import { Tile } from './Tile'
import type { LibraryStats, Photo } from '../../../shared/types'

interface Data {
  stats: LibraryStats
  onThisDay: { year: number; photos: Photo[] }[]
  highlights: Photo[]
  lookBack: { label: string; query: string; photos: Photo[] } | null
  recent: Photo[]
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Rediscover() {
  const s = useStore()
  const [data, setData] = useState<Data | null>(null)
  const [shuffle, setShuffle] = useState<Photo[]>([])

  const load = useCallback(async () => {
    const [stats, onThisDay, highlights, lookBack, recent] = await Promise.all([api.stats(), api.onThisDay(), api.highlights(13), api.lookBack(), api.recentlyAdded(18)])
    s.putPhotos([...onThisDay.flatMap((d) => d.photos), ...highlights, ...(lookBack?.photos ?? []), ...recent])
    setData({ stats, onThisDay, highlights, lookBack, recent })
  }, [])

  useEffect(() => void load(), [load])
  // Pick up photos as the first scan streams in.
  useEffect(() => {
    if (data && data.stats.photos < 50) void load()
  }, [s.libraryVersion])

  const reshuffle = async (): Promise<void> => {
    const list = await api.shuffle(24)
    s.putPhotos(list)
    setShuffle(list)
  }

  const open = (list: Photo[], index: number): void => s.setViewer({ ids: list.map((p) => p.id), index, slideshow: false })

  if (!data)
    return (
      <div className="rediscover">
        <Skeleton active paragraph={{ rows: 8 }} style={{ marginTop: 40 }} />
      </div>
    )

  const st = data.stats
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

  const strip = (list: Photo[]) => (
    <div className="strip">
      {list.map((p, i) => (
        <Tile key={p.id} photo={s.cache.get(p.id) ?? p} onClick={() => open(list, i)} />
      ))}
    </div>
  )

  const section = (title: React.ReactNode, extra: React.ReactNode, body: React.ReactNode) => (
    <section style={{ marginTop: 34 }}>
      <Flex justify="space-between" align="baseline" style={{ marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </Flex>
      {body}
    </section>
  )

  return (
    <div className="rediscover">
      <div className="hero">
        <Typography.Text type="secondary">{greeting()}</Typography.Text>
        <h1>
          {fmtNum(st.photos)} photos
          {st.firstYear && st.lastYear && st.lastYear > st.firstYear ? `, ${st.lastYear - st.firstYear + 1} years of moments` : ''}
        </h1>
        <Flex gap={40} wrap style={{ marginTop: 16 }}>
          <Statistic title="Cameras" value={st.cameras} />
          <Statistic title="RAW files" value={st.raw} />
          <Statistic title="Rated" value={st.rated} />
          <Statistic title="Picks" value={st.picks} />
          <Statistic title="Library size" value={fmtBytes(st.bytes)} />
          {st.topLens && <Statistic title="Favourite lens" value={st.topLens} valueStyle={{ fontSize: 18 }} />}
        </Flex>
        <Flex gap={8} style={{ marginTop: 22 }}>
          <Button type="primary" size="large" onClick={() => s.navigate({ type: 'all' }, 'All photos')}>
            Browse everything
          </Button>
          <Button size="large" onClick={() => s.setViewer({ ids: data.highlights.map((p) => p.id), index: 0, slideshow: true })} disabled={!data.highlights.length}>
            Play highlights
          </Button>
        </Flex>
      </div>

      {section(
        <>On this day · {today}</>,
        null,
        data.onThisDay.length ? (
          data.onThisDay.map((d) => (
            <div key={d.year} style={{ marginBottom: 16 }}>
              <Typography.Text strong>
                {d.year} · {new Date().getFullYear() - d.year} {new Date().getFullYear() - d.year === 1 ? 'year' : 'years'} ago
              </Typography.Text>
              <div style={{ marginTop: 8 }}>{strip(d.photos)}</div>
            </div>
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No photos from this day in earlier years — check back tomorrow." />
        )
      )}

      {data.highlights.length > 0 &&
        section(
          'Highlights',
          <Button type="text" icon={<ReloadOutlined />} onClick={async () => setData({ ...data, highlights: await api.highlights(13) })}>
            Refresh
          </Button>,
          <div className="mosaic">
            {data.highlights.map((p, i) => (
              <Tile key={p.id} photo={s.cache.get(p.id) ?? p} className={i % 7 === 0 ? 'big' : ''} onClick={() => open(data.highlights, i)} />
            ))}
          </div>
        )}

      {data.lookBack &&
        section(
          <>A look back · {data.lookBack.label}</>,
          <Button type="link" onClick={() => s.navigate({ type: 'all' }, data.lookBack!.label, data.lookBack!.query)}>
            See all <ArrowRightOutlined />
          </Button>,
          strip(data.lookBack.photos)
        )}

      {section(
        'Shuffle',
        <Button icon={<ReloadOutlined />} onClick={reshuffle}>
          {shuffle.length ? 'Shuffle again' : 'Shuffle'}
        </Button>,
        shuffle.length ? strip(shuffle) : <Typography.Text type="secondary">A random handful from your whole library.</Typography.Text>
      )}

      {data.recent.length > 0 &&
        section(
          'Recently added',
          <Button type="link" onClick={() => s.navigate({ type: 'recent' }, 'Recently added')}>
            See all <ArrowRightOutlined />
          </Button>,
          strip(data.recent)
        )}
    </div>
  )
}
