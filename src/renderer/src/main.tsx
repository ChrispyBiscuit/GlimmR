import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App as AntApp, ConfigProvider, theme } from 'antd'
import { StoreProvider, useStore } from './store'
import { Shell } from './components/Shell'
import './styles.css'

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (): void => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

/** Theme follows the saved setting; the store lives inside AntApp so it can use message/notification. */
function Themed() {
  const systemDark = useSystemDark()
  const [pref, setPref] = useState<'dark' | 'light' | 'system'>('dark')
  const dark = pref === 'system' ? systemDark : pref === 'dark'
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#f5b83d',
          colorInfo: '#f5b83d',
          borderRadius: 8,
          fontFamily: "Inter, 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
          colorBgBase: dark ? '#0d0f12' : '#ffffff',
          colorBgContainer: dark ? '#15181d' : '#ffffff',
          colorBgElevated: dark ? '#1c2027' : '#ffffff'
        },
        components: {
          Layout: { siderBg: dark ? '#111317' : '#f6f7f9', headerBg: dark ? '#0d0f12' : '#ffffff', bodyBg: dark ? '#0d0f12' : '#ffffff' },
          Menu: { itemBg: 'transparent', subMenuItemBg: 'transparent' },
          Tree: { colorBgContainer: 'transparent' }
        }
      }}
    >
      <AntApp>
        <StoreProvider>
          <ThemeSync onTheme={setPref} />
          <Shell />
        </StoreProvider>
      </AntApp>
    </ConfigProvider>
  )
}

function ThemeSync({ onTheme }: { onTheme: (t: 'dark' | 'light' | 'system') => void }) {
  const { settings } = useStore()
  useEffect(() => {
    if (settings) onTheme(settings.theme)
  }, [settings, onTheme])
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Themed />
  </StrictMode>
)
