import { useEffect, useState } from 'react'
import { App, Button, Input, Segmented, Select, Slider, Tag, Tooltip, Typography } from 'antd'
import { FilterOutlined, SortAscendingOutlined, SortDescendingOutlined, SaveOutlined, ExpandOutlined, CompressOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { fmtNum } from '../format'
import { tokenize } from '../../../shared/tokenize'
import { Filters } from './Filters'
import { PhotoGrid } from './PhotoGrid'
import { SelectionBar } from './SelectionBar'

export function Browse() {
  const s = useStore()
  const { modal, message } = App.useApp()
  const [sortFields, setSortFields] = useState<{ value: string; label: string }[]>([])
  const [fit, setFit] = useState<'cover' | 'contain'>('cover')
  useEffect(() => void api.sortFields().then(setSortFields), [])

  const tokens = tokenize(s.query)
  const removeToken = (i: number): void => s.setQuery(tokens.filter((_, j) => j !== i).join(' '))

  const sortOptions = [
    ...(s.scope.type === 'album' ? [{ value: 'albumOrder', label: 'Album order' }] : []),
    { value: 'default', label: s.scope.type === 'smart' ? 'Smart album order' : 'Date taken' },
    ...sortFields.filter((f) => f.value !== 'taken'),
    ...(sortFields.some((f) => f.value === s.sort.field) || ['default', 'albumOrder'].includes(s.sort.field) ? [] : [{ value: s.sort.field, label: s.sort.field }])
  ]

  const saveSmart = (): void => {
    let name = s.query
    modal.confirm({
      title: 'Save as smart album',
      icon: null,
      content: (
        <div>
          <Input autoFocus defaultValue={name} onChange={(e) => (name = e.target.value)} />
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            Updates automatically as photos match <code>{s.query}</code>.
          </Typography.Paragraph>
        </div>
      ),
      onOk: async () => {
        const id = await api.saveSmartAlbum({ name: name.trim() || s.query, query: s.query, sort: s.sort.field === 'default' ? { field: 'taken', dir: 'desc' } : s.sort })
        await s.refreshSidebar()
        s.navigate({ type: 'smart', id }, name.trim() || s.query)
        message.success('Smart album saved')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '6px 20px 10px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Tooltip title="Filters">
          <Button type={s.filtersOpen ? 'primary' : 'default'} ghost={s.filtersOpen} icon={<FilterOutlined />} onClick={() => s.setFiltersOpen(!s.filtersOpen)} />
        </Tooltip>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {s.title}
        </Typography.Title>
        <Typography.Text type="secondary" className="stat">
          {fmtNum(s.total)} {s.total === 1 ? 'photo' : 'photos'}
          {s.query && ` · ${s.tookMs} ms`}
        </Typography.Text>
        <div className="chips">
          {tokens.map((t, i) => (
            <Tag key={`${t}-${i}`} closable onClose={() => removeToken(i)} color={t.startsWith('-') ? 'red' : 'gold'} style={{ marginInlineEnd: 0 }}>
              {t}
            </Tag>
          ))}
          {tokens.length > 0 && (
            <>
              <Button size="small" type="link" onClick={() => s.setQuery('')}>
                Clear
              </Button>
              <Tooltip title="Save this search as a smart album">
                <Button size="small" icon={<SaveOutlined />} onClick={saveSmart}>
                  Save as smart album
                </Button>
              </Tooltip>
            </>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <Select
          style={{ width: 170 }}
          value={s.sort.field}
          options={sortOptions}
          showSearch
          onChange={(field) => s.setSort({ ...s.sort, field })}
          popupRender={(menu) => (
            <>
              {menu}
              <div style={{ padding: 8, borderTop: '1px solid var(--line)' }}>
                <Input
                  size="small"
                  placeholder="Sort by metadata key, e.g. ShutterCount"
                  onPressEnter={(e) => {
                    const v = (e.target as HTMLInputElement).value.trim()
                    if (v) s.setSort({ ...s.sort, field: v })
                  }}
                />
              </div>
            </>
          )}
        />
        <Tooltip title={s.sort.dir === 'desc' ? 'Descending' : 'Ascending'}>
          <Button
            icon={s.sort.dir === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />}
            onClick={() => s.setSort({ ...s.sort, dir: s.sort.dir === 'desc' ? 'asc' : 'desc' })}
          />
        </Tooltip>
        <Segmented
          size="small"
          value={fit}
          onChange={(v) => setFit(v as 'cover' | 'contain')}
          options={[
            { value: 'cover', icon: <ExpandOutlined />, title: 'Fill tiles' },
            { value: 'contain', icon: <CompressOutlined />, title: 'Show whole photo' }
          ]}
        />
        <Slider
          style={{ width: 120 }}
          min={120}
          max={480}
          step={20}
          value={s.settings?.thumbSize ?? 220}
          onChange={(v) => s.setSettings({ thumbSize: v })}
          tooltip={{ formatter: null }}
        />
      </div>
      {s.searchError && (
        <Typography.Text type="warning" style={{ padding: '0 20px 8px' }}>
          {s.searchError}
        </Typography.Text>
      )}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
        {s.filtersOpen && <Filters />}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }} className={fit === 'contain' ? 'fit-contain' : ''}>
          <PhotoGrid />
          <SelectionBar />
        </div>
      </div>
    </div>
  )
}
