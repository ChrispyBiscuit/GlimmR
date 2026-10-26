import { useState } from 'react'
import { App, Button, Layout, Result, Tooltip } from 'antd'
import { FolderAddOutlined, SettingOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api, bridge } from '../api'
import { Sidebar } from './Sidebar'
import { SearchBar } from './SearchBar'
import { Browse } from './Browse'
import { Rediscover } from './Rediscover'
import { Viewer } from './Viewer'
import { SettingsModal } from './SettingsModal'

export function Shell() {
  const s = useStore()
  const empty = s.roots.length === 0
  const { message } = App.useApp()
  const [dropping, setDropping] = useState(false)

  // Drop folders anywhere on the window to add them to the library.
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDropping(false)
    for (const f of Array.from(e.dataTransfer.files)) {
      try {
        const root = await api.addRoot(bridge().pathForFile(f))
        if (root) message.success(`Added “${root.name}”. Scanning…`)
      } catch (err) {
        message.error((err as Error).message.replace(/^Error invoking remote method 'api': Error: /, ''))
      }
    }
    void s.refreshSidebar()
  }

  return (
    <Layout
      style={{ height: '100%', overflow: 'clip', outline: dropping ? '3px dashed var(--accent)' : 'none', outlineOffset: -6 }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={onDrop}
    >
      <Layout.Sider width={256} style={{ borderRight: '1px solid var(--line)' }}>
        <Sidebar />
      </Layout.Sider>
      <Layout style={{ overflow: 'clip' }}>
        <Layout.Header className="app-drag" style={{ height: 68, lineHeight: 'normal', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <SearchBar />
          <Tooltip title="Settings">
            <Button type="text" icon={<SettingOutlined />} onClick={() => s.setSettingsOpen('library')} />
          </Tooltip>
        </Layout.Header>
        <Layout.Content style={{ position: 'relative', minHeight: 0, overflow: 'clip' }}>
          {empty ? (
            <div className="empty">
              <Result
                icon={<span style={{ fontSize: 64 }}>✦</span>}
                title="Welcome to GlimmR"
                subTitle={
                  <span>
                    Add the folders where your photos live. GlimmR catalogs them where they are and never changes your files.
                    <br />
                    RAW, JPEG, HEIC, TIFF, PNG and more. You can also drop folders onto this window.
                  </span>
                }
                extra={
                  <Button type="primary" size="large" icon={<FolderAddOutlined />} onClick={async () => (await api.addRoot()) && s.refreshSidebar()}>
                    Add a photo folder
                  </Button>
                }
              />
            </div>
          ) : s.view === 'rediscover' ? (
            <Rediscover />
          ) : (
            <Browse />
          )}
        </Layout.Content>
      </Layout>
      {s.viewer && <Viewer />}
      <SettingsModal />
    </Layout>
  )
}
