import { useEffect, useState } from 'react'
import { Collapse, Slider, Tooltip, Typography } from 'antd'
import { MinusCircleOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { LABEL_COLORS, quoteValue } from '../format'
import { tokenize } from '../../../shared/tokenize'
import type { FacetValue, Facets } from '../../../shared/types'

interface FacetDef {
  key: keyof Omit<Facets, 'ranges'>
  title: string
  token: (v: string) => string
  limit?: number
}

const FACETS: FacetDef[] = [
  { key: 'year', title: 'Year', token: (v) => `date:${v}` },
  { key: 'rating', title: 'Rating', token: (v) => `rating:${v}` },
  { key: 'flag', title: 'Flag', token: (v) => `flag:${v}` },
  { key: 'label', title: 'Color label', token: (v) => `label:${v}` },
  { key: 'camera', title: 'Camera', token: (v) => `camera:=${quoteValue(v)}`, limit: 12 },
  { key: 'lens', title: 'Lens', token: (v) => `lens:=${quoteValue(v)}`, limit: 12 },
  { key: 'keyword', title: 'Keywords', token: (v) => `keyword:=${quoteValue(v)}`, limit: 15 },
  { key: 'type', title: 'File type', token: (v) => `type:${v}` },
  { key: 'orientation', title: 'Orientation', token: (v) => `orientation:${v}` }
]

const RANGES = [
  { key: 'iso' as const, title: 'ISO', field: 'iso', step: 1, fmt: (v: number) => String(Math.round(v)) },
  { key: 'focal' as const, title: 'Focal length', field: 'focal', step: 1, fmt: (v: number) => `${Math.round(v)}mm` },
  { key: 'aperture' as const, title: 'Aperture', field: 'f', step: 0.1, fmt: (v: number) => `ƒ/${v.toFixed(1)}` }
]

export function Filters() {
  const s = useStore()
  const [facets, setFacets] = useState<Facets | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let live = true
    const t = setTimeout(() => void api.facets(s.scope, s.query).then((f) => live && setFacets(f)), 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [s.scope, s.query, s.libraryVersion, s.editVersion])

  const tokens = tokenize(s.query)
  const has = (t: string): boolean => tokens.includes(t)

  const toggle = (token: string, exclude = false): void => {
    const neg = `-${token}`
    let next = tokens.filter((t) => t !== token && t !== neg)
    if (exclude ? !has(neg) : !has(token)) next = [...next, exclude ? neg : token]
    s.setQuery(next.join(' '))
  }

  const setRange = (field: string, a: number, b: number, bounds: [number, number]): void => {
    const next = tokens.filter((t) => !t.startsWith(`${field}:`))
    if (a > bounds[0] || b < bounds[1]) next.push(`${field}:${a}..${b}`)
    s.setQuery(next.join(' '))
  }

  const row = (def: FacetDef, f: FacetValue) => {
    const token = def.token(f.value)
    const on = has(token)
    const off = has(`-${token}`)
    return (
      <div key={f.value} className={`facet-row ${on ? 'on' : ''} ${off ? 'off' : ''}`} onClick={() => toggle(token)}>
        {def.key === 'label' && <span className="label-dot" style={{ background: LABEL_COLORS[f.value] }} />}
        <span className="label" title={f.value}>
          {def.key === 'label' ? f.value[0].toUpperCase() + f.value.slice(1) : def.key === 'orientation' ? f.label[0].toUpperCase() + f.label.slice(1) : f.label}
        </span>
        <span className="count">{f.count.toLocaleString()}</span>
        <Tooltip title="Exclude">
          <MinusCircleOutlined
            className="exclude"
            onClick={(e) => {
              e.stopPropagation()
              toggle(token, true)
            }}
          />
        </Tooltip>
      </div>
    )
  }

  if (!facets) return <div className="filters" />

  const items = [
    ...FACETS.filter((d) => facets[d.key].length > 0).map((d) => {
      const list = facets[d.key]
      const limit = d.limit ?? 100
      const show = expanded[d.key] ? list : list.slice(0, limit)
      return {
        key: d.key,
        label: d.title,
        children: (
          <div>
            {show.map((f) => row(d, f))}
            {list.length > limit && (
              <Typography.Link style={{ fontSize: 12, paddingLeft: 8 }} onClick={() => setExpanded({ ...expanded, [d.key]: !expanded[d.key] })}>
                {expanded[d.key] ? 'Show fewer' : `Show all ${list.length}`}
              </Typography.Link>
            )}
          </div>
        )
      }
    }),
    ...RANGES.filter((r) => facets.ranges[r.key] && facets.ranges[r.key]![0] !== facets.ranges[r.key]![1]).map((r) => {
      const bounds = facets.ranges[r.key]!
      const current = tokens.find((t) => t.startsWith(`${r.field}:`) && t.includes('..'))
      const value = current ? (current.slice(r.field.length + 1).split('..').map(Number) as [number, number]) : bounds
      return {
        key: r.key,
        label: r.title,
        children: (
          <div style={{ padding: '0 10px' }}>
            <Slider
              range
              min={bounds[0]}
              max={bounds[1]}
              step={r.step}
              defaultValue={value}
              key={`${s.query}-${bounds.join()}`}
              tooltip={{ formatter: (v) => r.fmt(v ?? 0) }}
              onChangeComplete={(v) => setRange(r.field, (v as number[])[0], (v as number[])[1], bounds)}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.6 }}>
              <span>{r.fmt(value[0])}</span>
              <span>{r.fmt(value[1])}</span>
            </div>
          </div>
        )
      }
    })
  ]

  return (
    <div className="filters">
      <Collapse ghost size="small" defaultActiveKey={['year', 'rating', 'camera', 'lens', 'keyword', 'flag', 'label']} items={items} />
    </div>
  )
}
