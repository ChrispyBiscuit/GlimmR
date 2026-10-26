import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StoreProvider, useStore } from './store'
import { DialogHost } from './dialogs'
import { Shell } from './components/Shell'
import { loadBrandFont } from './fonts'
import './styles.css'

void loadBrandFont()

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
  const { settings } = useStore()
  const systemDark = useSystemDark()
  const pref = settings?.theme ?? 'dark'
  const dark = pref === 'system' ? systemDark : pref === 'dark'
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
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
