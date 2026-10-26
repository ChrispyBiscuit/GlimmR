import { useState } from 'react'
import { FolderPlus, Settings } from 'lucide-react'
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

  return (
    <div
      className={cn('grid h-full grid-cols-[232px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]', dropping && 'outline-2 -outline-offset-8 outline-dashed outline-ink')}
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
      <Sidebar onAddFolder={() => void addFolder()} />
      <main className="flex min-h-0 min-w-0 flex-col bg-canvas">
        {s.view !== 'settings' && (
          <header className={cn('app-drag flex h-14 shrink-0 items-center gap-2 border-b bg-panel px-4', mac && 'pt-1')}>
            <SearchBar />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => s.openSettings()}>
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </header>
        )}
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
