import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, FolderPlus, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api, bridge } from '../api'
import { Sidebar } from './Sidebar'
import { SearchBar } from './SearchBar'
import { Browse } from './Browse'
import { Rediscover } from './Rediscover'
import { Viewer } from './Viewer'
import { SettingsPage } from './SettingsPage'

const mac = navigator.userAgent.includes('Mac')

export function Shell() {
  const s = useStore()
  const [dropping, setDropping] = useState(false)
  const empty = s.roots.length === 0 && s.view !== 'settings'

  const addFolder = async (dir?: string): Promise<void> => {
    try {
      const root = await api.addRoot(dir)
      if (root) toast.success(`Added ${root.name}`, { description: 'Looking for photos…' })
    } catch (err) {
      toast.error('That folder couldn’t be added', { description: (err as Error).message.replace(/^Error invoking remote method 'api': Error: /, '') })
    }
    void s.refreshSidebar()
  }

  // Back and forward: mouse side buttons, Alt+arrows (Windows) and Cmd+[ / ] (macOS), as in browsers.
  const { back, forward, viewer } = s
  useEffect(() => {
    if (viewer) return
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) back()
      if (e.button === 4) forward()
    }
    const onKey = (e: KeyboardEvent): void => {
      const dir = mac ? (e.metaKey && e.key === '[' ? -1 : e.metaKey && e.key === ']' ? 1 : 0) : e.altKey ? (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) : 0
      if (!dir) return
      e.preventDefault()
      if (dir < 0) back()
      else forward()
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [back, forward, viewer])

  const iconButton = (label: string, hint: string, icon: React.ReactNode, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={opts.pressed} disabled={opts.disabled} onClick={onClick} className={cn(opts.pressed && 'bg-accent text-ink')}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )

  return (
    <div
      className={cn('grid h-full grid-cols-[232px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]', dropping && 'outline-2 -outline-offset-8 outline-dashed outline-ink')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDropping(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setDropping(false)
        for (const f of Array.from(e.dataTransfer.files)) await addFolder(bridge().pathForFile(f))
      }}
    >
      <header className="app-drag titlebar-inset col-span-2 grid h-12 grid-cols-subgrid items-center border-b bg-panel">
        <div className={cn('flex items-center gap-0.5 px-2', mac && 'pl-[84px]')}>
          {iconButton('Back', mac ? 'Back (⌘[)' : 'Back (Alt+←)', <ArrowLeft />, back, { disabled: !s.canBack })}
          {iconButton('Forward', mac ? 'Forward (⌘])' : 'Forward (Alt+→)', <ArrowRight />, forward, { disabled: !s.canForward })}
        </div>
        <div className="flex min-w-0 items-center gap-2 pl-4">
          <SearchBar />
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            {iconButton('Add a photo folder', 'Add a photo folder', <FolderPlus />, () => void addFolder())}
            {iconButton('Settings', 'Settings', <Settings />, () => (s.view === 'settings' ? s.closeSettings() : s.openSettings()), { pressed: s.view === 'settings' })}
          </div>
        </div>
      </header>
      <Sidebar onAddFolder={() => void addFolder()} />
      <main className="flex min-h-0 min-w-0 flex-col bg-canvas">
        <div className="relative min-h-0 flex-1">
          {empty ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle className="display text-2xl">Bring your photos in</EmptyTitle>
                <EmptyDescription className="text-pretty">
                  Choose the folders where your photos already live. Glimmr catalogs them in place and never moves or changes a file. You can also drop
                  folders onto this window.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="lg" onClick={() => void addFolder()}>
                  <FolderPlus data-icon="inline-start" />
                  Add a Photo Folder
                </Button>
              </EmptyContent>
            </Empty>
          ) : s.view === 'rediscover' ? (
            <Rediscover />
          ) : s.view === 'settings' ? (
            <SettingsPage />
          ) : (
            <Browse />
          )}
        </div>
      </main>
      {s.viewer && <Viewer />}
    </div>
  )
}
