import { useState } from 'react'
import { Button, Divider, Dropdown, Popover, Rate, Select, Tooltip, Typography, theme } from 'antd'
import { BookOutlined, CheckOutlined, CloseOutlined, EditOutlined, FlagOutlined, StopOutlined, TagsOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { LABEL_COLORS } from '../format'
import { usePrompt } from '../prompt'
import { COLOR_LABELS } from '../../../shared/types'
import type { KeywordNode } from '../../../shared/types'

const flatten = (nodes: KeywordNode[]): string[] => nodes.flatMap((n) => [n.path, ...flatten(n.children)])

export function KeywordEditor({ ids, current, onDone, autoFocus }: { ids: number[]; current: string[]; onDone?: () => void; autoFocus?: boolean }) {
  const s = useStore()
  const [value, setValue] = useState<string[]>(current)
  const all = flatten(s.keywords)
  return (
    <div style={{ width: 320 }}>
      <Select
        mode="tags"
        style={{ width: '100%' }}
        autoFocus={autoFocus}
        value={value}
        tokenSeparators={[',']}
        placeholder="Add keywords; use > for hierarchy (Places > Portugal)"
        options={all.map((k) => ({ value: k, label: k.replace(/>/g, ' › ') }))}
        onChange={async (next: string[]) => {
          const add = next.filter((k) => !value.includes(k))
          const remove = value.filter((k) => !next.includes(k))
          setValue(next)
          await s.updatePhotos(ids, { addKeywords: add, removeKeywords: remove })
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        {ids.length > 1 ? `Applies to ${ids.length} photos. Only keywords added or removed here change.` : 'Stored in the catalog. Use “Write XMP” to share with other apps.'}
      </Typography.Text>
      {onDone && (
        <Button size="small" type="primary" style={{ marginTop: 8 }} onClick={onDone}>
          Done
        </Button>
      )}
    </div>
  )
}

export function SelectionBar() {
  const s = useStore()
  const { token } = theme.useToken()
  const [kwOpen, setKwOpen] = useState(false)
  const prompt = usePrompt()
  if (s.selected.size === 0) return null
  const ids = s.targets
  const photos = ids.map((id) => s.cache.get(id)).filter(Boolean)
  const commonRating = photos.every((p) => p!.rating === photos[0]?.rating) ? (photos[0]?.rating ?? 0) : 0

  return (
    <div className="selection-bar" style={{ background: token.colorBgElevated, border: `1px solid ${token.colorBorderSecondary}` }}>
      <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
        {ids.length.toLocaleString()} selected
      </Typography.Text>
      <Divider orientation="vertical" />
      <Rate value={commonRating} onChange={(v) => void s.updatePhotos(ids, { rating: v })} style={{ fontSize: 16 }} />
      <Tooltip title="Pick (P)">
        <Button type="text" icon={<FlagOutlined style={{ color: '#7ee787' }} />} onClick={() => void s.updatePhotos(ids, { flag: 'pick' })} />
      </Tooltip>
      <Tooltip title="Reject (X)">
        <Button type="text" icon={<StopOutlined style={{ color: '#ff7875' }} />} onClick={() => void s.updatePhotos(ids, { flag: 'reject' })} />
      </Tooltip>
      <Tooltip title="Unflag (U)">
        <Button type="text" icon={<CloseOutlined />} onClick={() => void s.updatePhotos(ids, { flag: null })} />
      </Tooltip>
      <Dropdown
        menu={{
          items: [
            ...COLOR_LABELS.map((l, i) => ({
              key: l,
              label: (
                <span>
                  <span className="label-dot" style={{ background: LABEL_COLORS[l], marginRight: 8 }} />
                  {l[0].toUpperCase() + l.slice(1)}
                  {i < 4 && <span className="kbd" style={{ marginLeft: 10 }}>{i + 6}</span>}
                </span>
              )
            })),
            { key: 'none', label: 'No label' }
          ],
          onClick: ({ key }) => void s.updatePhotos(ids, { label: key === 'none' ? null : (key as (typeof COLOR_LABELS)[number]) })
        }}
      >
        <Button type="text">
          <span className="label-dot" style={{ background: 'conic-gradient(#ff5a5f, #ffc53d, #52c41a, #4096ff, #b37feb, #ff5a5f)' }} />
        </Button>
      </Dropdown>
      <Popover
        trigger="click"
        open={kwOpen}
        onOpenChange={setKwOpen}
        destroyOnHidden
        content={<KeywordEditor ids={ids} current={[]} onDone={() => setKwOpen(false)} autoFocus />}
        title="Add keywords"
      >
        <Tooltip title="Keywords">
          <Button type="text" icon={<TagsOutlined />} />
        </Tooltip>
      </Popover>
      <Dropdown
        menu={{
          items: [
            ...s.albums.map((a) => ({ key: String(a.id), label: a.name })),
            ...(s.albums.length ? [{ type: 'divider' as const }] : []),
            { key: 'new', label: 'New album with selection…' }
          ],
          onClick: async ({ key }) => {
            if (key === 'new') {
              const name = await prompt('New album')
              if (!name) return
              const id = await api.createAlbum(name, ids)
              await s.refreshSidebar()
              s.navigate({ type: 'album', id }, name)
            } else {
              await api.addToAlbum(Number(key), ids)
              void s.refreshSidebar()
            }
          }
        }}
      >
        <Tooltip title="Add to album">
          <Button type="text" icon={<BookOutlined />} />
        </Tooltip>
      </Dropdown>
      <Divider orientation="vertical" />
      <Tooltip title="Open in editor (Ctrl/⌘ E)">
        <Button icon={<EditOutlined />} onClick={() => void s.openEditor(ids)}>
          Edit
        </Button>
      </Tooltip>
      <Tooltip title="Write rating, label, keywords, title and caption to XMP sidecars so Lightroom, Capture One and others see them">
        <Button icon={<CheckOutlined />} onClick={() => void api.writeXmp(ids)}>
          Write XMP
        </Button>
      </Tooltip>
      <Tooltip title="Clear selection (Esc)">
        <Button type="text" icon={<CloseOutlined />} onClick={() => s.setSelected(new Set())} />
      </Tooltip>
    </div>
  )
}
