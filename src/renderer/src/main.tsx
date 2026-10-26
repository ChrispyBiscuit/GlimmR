import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StoreProvider, useStore } from './store'
import { DialogHost } from './dialogs'
import { Shell } from './components/Shell'
import { api } from './api'
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

/** Applies the saved theme to <html> so the semantic tokens switch together. */
function Theme() {
  const { settings, viewer } = useStore()
  const systemDark = useSystemDark()
  const pref = settings?.theme ?? 'dark'
  const dark = pref === 'system' ? systemDark : pref === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  // The native window buttons (Windows/Linux) follow the theme; the photo viewer is always dark.
  const titleBar = dark || viewer ? 'dark' : 'light'
  useEffect(() => {
    void api.setTitleBarTheme(titleBar)
  }, [titleBar])
  return <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
}

document.documentElement.classList.add('dark')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider delayDuration={400}>
      <StoreProvider>
        <Theme />
        <DialogHost />
        <Shell />
      </StoreProvider>
    </TooltipProvider>
  </StrictMode>
)
