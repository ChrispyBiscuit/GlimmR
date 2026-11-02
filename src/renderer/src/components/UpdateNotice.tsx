import { Download, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useStore } from '../store'
import { api } from '../api'

/** Shown at the bottom of the sidebar while a new version is downloading or ready to install. */
export function UpdateNotice() {
  const { update } = useStore()
  if (!update || !['available', 'downloading', 'ready', 'manual'].includes(update.state)) return null
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3" aria-live="polite">
      <p className="text-[13px] font-medium">Glimmr {update.version}</p>
      {update.state === 'downloading' && (
        <>
          <Progress value={update.percent ?? 0} className="h-1" aria-label="Download progress" />
          <p className="tnum text-xs text-ink-muted">Downloading… {update.percent ?? 0}%</p>
        </>
      )}
      {update.state === 'ready' && (
        <>
          <p className="text-xs text-ink-muted">Ready to install. Your library stays as it is.</p>
          <Button size="sm" onClick={() => api.installUpdate()}>
            <RotateCw data-icon="inline-start" />
            Restart to Update
          </Button>
        </>
      )}
      {update.state === 'available' && (
        <Button size="sm" variant="outline" onClick={() => api.downloadUpdate()}>
          <Download data-icon="inline-start" />
          Download Update
        </Button>
      )}
      {update.state === 'manual' && (
        <>
          <p className="text-xs text-ink-muted">{update.message}</p>
          <Button size="sm" variant="outline" onClick={() => api.openReleasePage()}>
            <Download data-icon="inline-start" />
            Get the New Version
          </Button>
        </>
      )}
    </div>
  )
}
