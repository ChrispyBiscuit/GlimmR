import { useEffect, useRef, useState } from 'react'
import { Button, Divider, Dropdown, Input, Rate, Space, Tag, Tooltip, Typography } from 'antd'
import {
  ArrowLeftOutlined,
  CloseOutlined,
  EditOutlined,
  FlagOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  RightOutlined,
  StopOutlined
} from '@ant-design/icons'
import { useStore } from '../store'
import { api, originalUrl, previewUrl, thumbUrl } from '../api'
import { camera, exposure, fmtBytes, fmtDate, LABEL_COLORS, quoteValue } from '../format'
import { cullingUpdate, isTyping } from '../culling'
import { KeywordEditor } from './SelectionBar'
import { COLOR_LABELS } from '../../../shared/types'
import type { PhotoDetail } from '../../../shared/types'

const BROWSER_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'])

export function Viewer() {
  const s = useStore()
  const v = s.viewer!
  const id = v.ids[v.index]
  const photo = s.cache.get(id)
  const [detail, setDetail] = useState<PhotoDetail | null>(null)
  const [showInfo, setShowInfo] = useState(true)
  const [zoom, setZoom] = useState(false)
  const [hiRes, setHiRes] = useState(false)
  const [metaFilter, setMetaFilter] = useState('')
  const stage = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null)

  const go = (delta: number): void => {
    const index = Math.max(0, Math.min(v.ids.length - 1, v.index + delta))
    if (index !== v.index) s.setViewer({ ...v, index })
  }
  const close = (): void => {
    const i = s.ids.indexOf(id)
    if (i >= 0) {
      s.setFocusIndex(i)
      s.setSelected(new Set([id]))
    }
    s.setViewer(null)
  }

  useEffect(() => void s.ensurePhotos(v.ids.slice(Math.max(0, v.index - 40), v.index + 40)), [v.index, v.ids, s])

  // Detail for the info panel; re-read when the cached photo changes (rating edits etc.).
  useEffect(() => {
    let live = true
    void api.detail(id).then((d) => live && setDetail(d))
    return () => {
      live = false
    }
  }, [id, photo])

  // Show the fast preview first, then swap in the original when the browser can display it.
  useEffect(() => {
    setHiRes(false)
    setZoom(false)
    if (!photo || !BROWSER_EXTS.has(photo.ext) || photo.offline) return
    const img = new Image()
    img.onload = () => setHiRes(true)
    img.src = originalUrl(photo.id, photo.mtime)
    // Warm the neighbours.
    for (const n of [v.ids[v.index + 1], v.ids[v.index - 1]]) if (n != null) new Image().src = previewUrl(n)
    return () => {
      img.onload = null
    }
  }, [photo?.id, photo?.mtime, photo?.ext, photo?.offline, v.ids, v.index, photo])

  useEffect(() => {
    strip.current?.querySelector('.current')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [v.index])

  // Slideshow.
  useEffect(() => {
    if (!v.slideshow) return
    const t = setInterval(() => {
      if (v.index >= v.ids.length - 1) s.setViewer({ ...v, slideshow: false })
      else s.setViewer({ ...v, index: v.index + 1 })
    }, 4000)
    return () => clearInterval(t)
  }, [v, s])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e)) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') return v.slideshow ? s.setViewer({ ...v, slideshow: false }) : close()
      if (e.key === 'ArrowRight') return go(1)
      if (e.key === 'ArrowLeft') return go(-1)
      if (e.key === 'Home') return s.setViewer({ ...v, index: 0 })
      if (e.key === 'End') return s.setViewer({ ...v, index: v.ids.length - 1 })
      if (e.key.toLowerCase() === 'i' && !mod) return setShowInfo((x) => !x)
      if (e.key.toLowerCase() === 'z' || e.key === ' ') {
        e.preventDefault()
        return setZoom((z) => !z)
      }
      if (e.key.toLowerCase() === 's' && !mod) return s.setViewer({ ...v, slideshow: !v.slideshow })
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        return void s.openEditor([id])
      }
      const u = cullingUpdate(e, photo?.label)
      if (u) {
        e.preventDefault()
        void s.updatePhotos([id], u)
        if (s.settings?.autoAdvance) go(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const src = photo ? (hiRes ? originalUrl(photo.id, photo.mtime) : previewUrl(photo.id, photo.mtime)) : undefined

  const onStageMouseDown = (e: React.MouseEvent): void => {
    if (!zoom || !stage.current) return
    drag.current = { x: e.clientX, y: e.clientY, sl: stage.current.scrollLeft, st: stage.current.scrollTop, moved: false }
  }
  const onStageMouseMove = (e: React.MouseEvent): void => {
    const d = drag.current
    if (!d || !stage.current) return
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
    stage.current.scrollLeft = d.sl - (e.clientX - d.x)
    stage.current.scrollTop = d.st - (e.clientY - d.y)
  }
  const onImageClick = (e: React.MouseEvent<HTMLImageElement>): void => {
    if (drag.current?.moved) {
      drag.current = null
      return
    }
    drag.current = null
    const img = e.currentTarget
    if (!zoom) {
      // Zoom to 100% around the clicked point.
      const rx = (e.clientX - img.getBoundingClientRect().left) / img.clientWidth
      const ry = (e.clientY - img.getBoundingClientRect().top) / img.clientHeight
      setZoom(true)
      requestAnimationFrame(() => {
        const el = stage.current
        if (!el) return
        el.scrollLeft = rx * img.naturalWidth - el.clientWidth / 2
        el.scrollTop = ry * img.naturalHeight - el.clientHeight / 2
      })
    } else setZoom(false)
  }

  const editors = s.settings?.editors.editors ?? []
  const meta = (detail?.metadata ?? []).filter((m) => !metaFilter || `${m.key} ${m.value}`.toLowerCase().includes(metaFilter.toLowerCase()))
  const searchFor = (q: string): void => {
    s.setViewer(null)
    s.navigate({ type: 'all' }, 'All photos', q)
  }

  return (
    <div className={`viewer ${v.slideshow ? 'slideshow' : ''}`}>
      <div className="viewer-top">
        <Tooltip title="Back to grid (Esc)">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={close} style={{ color: '#ddd' }} />
        </Tooltip>
        <div className="title">
          {photo?.title || photo?.filename}
          <Typography.Text style={{ color: '#888', marginLeft: 12, fontWeight: 400 }}>
            {v.index + 1} / {v.ids.length.toLocaleString()}
          </Typography.Text>
        </div>
        {photo && (
          <Space size={4}>
            <Rate value={photo.rating} onChange={(r) => void s.updatePhotos([id], { rating: r })} style={{ fontSize: 16 }} />
            <Tooltip title="Pick (P)">
              <Button
                type="text"
                icon={<FlagOutlined style={{ color: photo.flag === 'pick' ? '#7ee787' : '#888' }} />}
                onClick={() => void s.updatePhotos([id], { flag: photo.flag === 'pick' ? null : 'pick' })}
              />
            </Tooltip>
            <Tooltip title="Reject (X)">
              <Button
                type="text"
                icon={<StopOutlined style={{ color: photo.flag === 'reject' ? '#ff7875' : '#888' }} />}
                onClick={() => void s.updatePhotos([id], { flag: photo.flag === 'reject' ? null : 'reject' })}
              />
            </Tooltip>
            {COLOR_LABELS.map((l) => (
              <span
                key={l}
                className="label-dot"
                title={l}
                onClick={() => void s.updatePhotos([id], { label: photo.label === l ? null : l })}
                style={{ background: LABEL_COLORS[l], cursor: 'pointer', opacity: photo.label === l ? 1 : 0.3, margin: '0 2px' }}
              />
            ))}
            <Divider orientation="vertical" style={{ borderColor: '#333' }} />
            <Dropdown.Button
              icon={<EditOutlined />}
              onClick={() => void s.openEditor([id])}
              menu={{
                items: [...editors.map((e) => ({ key: e.id, label: `Open in ${e.name}` })), { type: 'divider' as const }, { key: 'system', label: 'System default app' }],
                onClick: ({ key }) => (key === 'system' ? void api.openWithDefault(id) : void s.openEditor([id], key))
              }}
            >
              Edit
            </Dropdown.Button>
            <Tooltip title="Show in folder">
              <Button type="text" icon={<FolderOpenOutlined />} style={{ color: '#ddd' }} onClick={() => void api.reveal(id)} />
            </Tooltip>
            <Tooltip title="Slideshow (S)">
              <Button type="text" icon={<PlayCircleOutlined />} style={{ color: '#ddd' }} onClick={() => s.setViewer({ ...v, slideshow: true })} />
            </Tooltip>
            <Tooltip title="Info (I)">
              <Button type="text" icon={<InfoCircleOutlined />} style={{ color: showInfo ? 'var(--accent)' : '#ddd' }} onClick={() => setShowInfo(!showInfo)} />
            </Tooltip>
            <Button type="text" icon={<CloseOutlined />} style={{ color: '#ddd' }} onClick={close} />
          </Space>
        )}
      </div>

      <div className="viewer-body">
        <div
          ref={stage}
          className={`viewer-stage ${zoom ? 'zoomed' : ''}`}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={() => setTimeout(() => (drag.current = null), 0)}
          onClick={(e) => v.slideshow && e.target === e.currentTarget && s.setViewer({ ...v, slideshow: false })}
        >
          {!zoom && v.index > 0 && (
            <Button className="viewer-nav" shape="circle" size="large" icon={<LeftOutlined />} style={{ left: 16 }} onClick={() => go(-1)} />
          )}
          {src && <img key={photo?.id} src={src} onClick={onImageClick} draggable={false} alt={photo?.filename} />}
          {photo?.offline && (
            <Tag color="red" style={{ position: 'absolute', top: 12, left: 12 }}>
              Original is offline — showing the cached preview
            </Tag>
          )}
          {!zoom && v.index < v.ids.length - 1 && (
            <Button className="viewer-nav" shape="circle" size="large" icon={<RightOutlined />} style={{ right: 16 }} onClick={() => go(1)} />
          )}
        </div>

        {showInfo && !v.slideshow && detail && (
          <div className="viewer-info selectable">
            <Typography.Title level={5} style={{ color: '#eee', marginTop: 0 }}>
              {fmtDate(detail.takenAt, { dateStyle: 'full', timeStyle: 'short' })}
            </Typography.Title>
            <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.8 }}>
              {camera(detail) && (
                <div>
                  <Typography.Link onClick={() => searchFor(`camera:=${quoteValue(`${detail.make ?? ''} ${detail.model ?? ''}`.trim())}`)}>{camera(detail)}</Typography.Link>
                </div>
              )}
              {detail.lens && (
                <div>
                  <Typography.Link onClick={() => searchFor(`lens:=${quoteValue(detail.lens!)}`)}>{detail.lens}</Typography.Link>
                </div>
              )}
              <div>{exposure(detail)}</div>
              <div>
                {detail.width && detail.height ? `${detail.width} × ${detail.height} · ${((detail.width * detail.height) / 1e6).toFixed(1)} MP · ` : ''}
                {fmtBytes(detail.size)} · {detail.ext.toUpperCase()}
              </div>
              {detail.lat != null && detail.lon != null && (
                <div>
                  📍 {detail.lat.toFixed(5)}, {detail.lon.toFixed(5)}
                </div>
              )}
              <div style={{ wordBreak: 'break-all', color: '#888' }}>{detail.path}</div>
            </div>

            <Divider style={{ borderColor: '#2a2d33', margin: '14px 0' }} />
            <Input
              key={`t-${detail.id}`}
              placeholder="Title"
              defaultValue={detail.title ?? ''}
              variant="borderless"
              style={{ fontSize: 15, fontWeight: 600, padding: 0, color: '#eee' }}
              onBlur={(e) => e.target.value !== (detail.title ?? '') && void s.updatePhotos([id], { title: e.target.value })}
              onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
            />
            <Input.TextArea
              key={`c-${detail.id}`}
              placeholder="Add a caption…"
              defaultValue={detail.caption ?? ''}
              variant="borderless"
              autoSize={{ minRows: 1, maxRows: 6 }}
              style={{ padding: 0, marginTop: 4, color: '#ccc' }}
              onBlur={(e) => e.target.value !== (detail.caption ?? '') && void s.updatePhotos([id], { caption: e.target.value })}
            />
            <div style={{ marginTop: 12 }}>
              <Typography.Text style={{ color: '#888', fontSize: 12 }}>Keywords</Typography.Text>
              <KeywordEditor key={`k-${detail.id}-${detail.keywords.join('|')}`} ids={[id]} current={detail.keywords} />
            </div>
            {detail.albums.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <Typography.Text style={{ color: '#888', fontSize: 12, display: 'block' }}>Albums</Typography.Text>
                {detail.albums.map((a) => (
                  <Tag key={a.id} style={{ cursor: 'pointer' }} onClick={() => (s.setViewer(null), s.navigate({ type: 'album', id: a.id }, a.name))}>
                    {a.name}
                  </Tag>
                ))}
              </div>
            )}

            <Divider style={{ borderColor: '#2a2d33', margin: '14px 0 8px' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Typography.Text style={{ color: '#888', fontSize: 12 }}>All metadata ({detail.metadata.length})</Typography.Text>
            </div>
            <Input size="small" allowClear placeholder="Filter fields" value={metaFilter} onChange={(e) => setMetaFilter(e.target.value)} style={{ marginBottom: 6 }} />
            <table className="meta-table">
              <tbody>
                {meta.map((m, i) => (
                  <tr key={`${m.key}-${i}`}>
                    <td>{m.key}</td>
                    <td title="Find photos with this value" onClick={() => searchFor(`${m.key}:=${quoteValue(m.value)}`)}>
                      {m.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="filmstrip" ref={strip}>
        {v.ids.slice(Math.max(0, v.index - 30), v.index + 31).map((fid, k) => {
          const idx = Math.max(0, v.index - 30) + k
          return <img key={fid} src={thumbUrl(fid, s.cache.get(fid)?.mtime ?? 0)} className={idx === v.index ? 'current' : ''} onClick={() => s.setViewer({ ...v, index: idx })} alt="" />
        })}
      </div>
    </div>
  )
}
