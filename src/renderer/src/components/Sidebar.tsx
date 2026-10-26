import { useMemo, useState } from 'react'
import { App, Button, Dropdown, Input, Menu, Progress, Tooltip, Tree, Typography } from 'antd'
import type { MenuProps, TreeDataNode } from 'antd'
import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  FlagOutlined,
  FolderOutlined,
  PlusOutlined,
  StarOutlined,
  ThunderboltOutlined,
  BookOutlined,
  TagOutlined
} from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { fmtNum } from '../format'
import { usePrompt } from '../prompt'
import type { FolderNode, KeywordNode, Scope } from '../../../shared/types'

const scopeKey = (s: Scope): string => {
  switch (s.type) {
    case 'album':
    case 'smart':
      return `${s.type}:${s.id}`
    case 'folder':
      return `folder:${s.rootId}:${s.relPath}`
    case 'keyword':
      return `keyword:${s.path}`
    default:
      return s.type
  }
}

export function Sidebar() {
  const s = useStore()
  const { modal } = App.useApp()
  const prompt = usePrompt()
  const [kwFilter, setKwFilter] = useState('')
  const active = s.view === 'rediscover' ? 'rediscover' : scopeKey(s.scope)

  const mainItems: MenuProps['items'] = [
    { key: 'rediscover', icon: <ThunderboltOutlined />, label: 'Rediscover' },
    { key: 'all', icon: <AppstoreOutlined />, label: 'All photos' },
    { key: 'picks', icon: <FlagOutlined />, label: 'Picks' },
    { key: 'recent', icon: <ClockCircleOutlined />, label: 'Recently added' }
  ]

  const albumItems: MenuProps['items'] = s.albums.map((a) => ({
    key: `album:${a.id}`,
    icon: <BookOutlined />,
    label: (
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [
            { key: 'rename', label: 'Rename…' },
            { key: 'delete', label: 'Delete album', danger: true }
          ],
          onClick: async ({ key, domEvent }) => {
            domEvent.stopPropagation()
            if (key === 'rename') {
              const name = await prompt('Rename album', a.name)
              if (name) await api.renameAlbum(a.id, name)
            } else
              await new Promise<void>((done) =>
                modal.confirm({
                  title: `Delete album “${a.name}”?`,
                  content: 'Photos stay in your library; only the album is removed.',
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    await api.deleteAlbum(a.id)
                    if (s.scope.type === 'album' && s.scope.id === a.id) s.navigate({ type: 'all' })
                  },
                  afterClose: done
                })
              )
            void s.refreshSidebar()
          }
        }}
      >
        <span>
          {a.name}
          <span className="side-count">{a.count}</span>
        </span>
      </Dropdown>
    )
  }))

  const smartItems: MenuProps['items'] = s.smartAlbums.map((a) => ({
    key: `smart:${a.id}`,
    icon: <StarOutlined />,
    label: (
      <Dropdown
        trigger={['contextMenu']}
        menu={{
          items: [
            { key: 'rename', label: 'Rename…' },
            { key: 'delete', label: 'Delete smart album', danger: true }
          ],
          onClick: async ({ key, domEvent }) => {
            domEvent.stopPropagation()
            if (key === 'rename') {
              const name = await prompt('Rename smart album', a.name)
              if (name) await api.saveSmartAlbum({ ...a, name })
            } else await api.deleteSmartAlbum(a.id)
            void s.refreshSidebar()
          }
        }}
      >
        <Tooltip title={a.query} placement="right">
          <span>{a.name}</span>
        </Tooltip>
      </Dropdown>
    )
  }))

  const onMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'rediscover') return s.navigate('rediscover')
    if (key === 'all') return s.navigate({ type: 'all' }, 'All photos')
    if (key === 'picks') return s.navigate({ type: 'picks' }, 'Picks')
    if (key === 'recent') return s.navigate({ type: 'recent' }, 'Recently added')
    const [type, id] = key.split(':')
    if (type === 'album') return s.navigate({ type: 'album', id: Number(id) }, s.albums.find((a) => a.id === Number(id))?.name)
    if (type === 'smart') return s.navigate({ type: 'smart', id: Number(id) }, s.smartAlbums.find((a) => a.id === Number(id))?.name)
  }

  const kwTree = useMemo(() => {
    const f = kwFilter.toLowerCase()
    const map = (nodes: KeywordNode[]): TreeDataNode[] =>
      nodes
        .map((n) => {
          const children = map(n.children)
          if (f && !n.name.toLowerCase().includes(f) && !children.length) return null
          return {
            key: n.path,
            title: (
              <span>
                {n.name}
                <span className="side-count">{n.count}</span>
              </span>
            ),
            children
          } as TreeDataNode
        })
        .filter((n): n is TreeDataNode => !!n)
    return map(s.keywords)
  }, [s.keywords, kwFilter])

  const folderTree = useMemo(() => {
    const map = (n: FolderNode): TreeDataNode => ({
      key: `folder:${n.rootId}:${n.relPath}`,
      title: (
        <span>
          {n.name}
          <span className="side-count">{fmtNum(n.count)}</span>
        </span>
      ),
      icon: <FolderOutlined />,
      children: n.children.map(map)
    })
    return s.folders.map(map)
  }, [s.folders])

  const jobs = Object.values(s.jobs)

  return (
    <div className="side-scroll">
      <div className="brand app-drag" style={{ paddingTop: navigator.userAgent.includes('Mac') ? 38 : 18 }}>
        <span className="spark">✦</span> GlimmR
      </div>
      <Menu mode="inline" selectedKeys={[active]} items={mainItems} onClick={onMenu} style={{ borderInlineEnd: 'none' }} />

      <div className="side-section">
        Albums
        <Tooltip title="New album (adds the selected photos)">
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            onClick={async () => {
              const name = await prompt('New album')
              if (!name) return
              const id = await api.createAlbum(name, s.targets)
              await s.refreshSidebar()
              s.navigate({ type: 'album', id }, name)
            }}
          />
        </Tooltip>
      </div>
      {s.albums.length ? (
        <Menu mode="inline" selectedKeys={[active]} items={albumItems} onClick={onMenu} style={{ borderInlineEnd: 'none' }} />
      ) : (
        <Typography.Text type="secondary" style={{ padding: '2px 24px', fontSize: 12 }}>
          Select photos, then press + to make an album.
        </Typography.Text>
      )}

      <div className="side-section">Smart albums</div>
      {s.smartAlbums.length ? (
        <Menu mode="inline" selectedKeys={[active]} items={smartItems} onClick={onMenu} style={{ borderInlineEnd: 'none' }} />
      ) : (
        <Typography.Text type="secondary" style={{ padding: '2px 24px', fontSize: 12 }}>
          Search, then “Save as smart album”.
        </Typography.Text>
      )}

      <div className="side-section">
        <span>
          <TagOutlined /> Keywords
        </span>
      </div>
      {s.keywords.length > 8 && (
        <div style={{ padding: '2px 16px 6px' }}>
          <Input size="small" allowClear placeholder="Filter keywords" value={kwFilter} onChange={(e) => setKwFilter(e.target.value)} />
        </div>
      )}
      <Tree
        className="side-tree"
        blockNode
        treeData={kwTree}
        selectedKeys={s.scope.type === 'keyword' && s.view === 'browse' ? [s.scope.path] : []}
        onSelect={(keys) => keys[0] && s.navigate({ type: 'keyword', path: String(keys[0]) }, String(keys[0]).split('>').pop())}
        titleRender={(node) => (
          <Dropdown
            trigger={['contextMenu']}
            menu={{
              items: [
                { key: 'rename', label: 'Rename…' },
                { key: 'delete', label: 'Remove keyword from all photos', danger: true }
              ],
              onClick: async ({ key, domEvent }) => {
                domEvent.stopPropagation()
                const path = String(node.key)
                if (key === 'rename') {
                  const name = await prompt('Rename keyword (use > for hierarchy)', path)
                  if (name) await api.renameKeyword(path, name)
                } else await api.deleteKeyword(path)
                void s.refreshSidebar()
              }
            }}
          >
            <span>{node.title as React.ReactNode}</span>
          </Dropdown>
        )}
      />

      <div className="side-section">
        Folders
        <Tooltip title="Add a photo folder">
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={async () => (await api.addRoot()) && s.refreshSidebar()} />
        </Tooltip>
      </div>
      <Tree
        className="side-tree"
        blockNode
        showIcon
        treeData={folderTree}
        selectedKeys={s.view === 'browse' ? [active] : []}
        onSelect={(keys) => {
          const key = String(keys[0] ?? '')
          if (!key) return
          const [, rootId, ...rest] = key.split(':')
          const relPath = rest.join(':')
          const root = s.roots.find((r) => r.id === Number(rootId))
          s.navigate({ type: 'folder', rootId: Number(rootId), relPath }, relPath ? relPath.split('/').pop() : root?.name)
        }}
      />

      <div style={{ flex: 1 }} />
      {jobs.map((j) => (
        <div key={j.id} style={{ padding: '8px 16px', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.label}</span>
            <Tooltip title="Cancel">
              <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => api.cancelJob(j.id)} />
            </Tooltip>
          </div>
          <Progress size="small" percent={j.total ? Math.round((j.done / j.total) * 100) : 0} status="active" showInfo={false} />
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {j.total ? `${fmtNum(j.done)} / ${fmtNum(j.total)}` : (j.message ?? 'Starting…')}
          </Typography.Text>
        </div>
      ))}
    </div>
  )
}
