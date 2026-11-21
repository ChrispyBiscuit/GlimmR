import { useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { useStore } from '../store'
import { api, originalUrl, previewUrl, thumbUrl } from '../api'
import { confirmDialog } from '../dialogs'
import { fmtNum } from '../format'
import { CullAction, CullView, type CullItem } from './CullView'

const mac = navigator.platform.toLowerCase().includes('mac')
const BIN = mac ? 'Trash' : 'Recycle Bin'

/** The cull view over library photos: marks are saved as you go; rejects can then go to the trash. */
export function LibraryCull() {
  const s = useStore()
  const job = s.cull!
  useEffect(() => void s.ensurePhotos(job.ids), [job.ids])
  const items: CullItem[] = useMemo(
    () =>
      job.ids.map((id) => {
        const p = s.cache.get(id)
        const v = p?.rev ?? 0
        return {
          key: String(id),
          name: p?.filename ?? '',
          thumb: thumbUrl(id, v),
          preview: previewUrl(id, v),
          full: originalUrl(id, v),
          badge: p?.companion ? 'RAW+JPEG' : p?.kind === 'raw' ? 'RAW' : undefined,
          flag: p?.flag ?? null,
          rating: p?.rating ?? 0,
          label: p?.label ?? null
        }
      }),
    [job.ids, s.cacheVersion, s.editVersion]
  )

  const deleteRejects = async (): Promise<void> => {
    const rejects = job.ids.filter((id) => s.cache.get(id)?.flag === 'reject')
    if (!rejects.length) return void toast('No rejected photos', { description: 'Press X on a photo to reject it.' })
    const pairs = rejects.filter((id) => s.cache.get(id)?.companion).length
    const ok = await confirmDialog({
      title: `Move ${rejects.length === 1 ? 'the rejected photo' : `${fmtNum(rejects.length)} rejected photos`} to the ${BIN}?`,
      description: (() => {
        const one = rejects.length === 1
        const pairNote = pairs ? (one ? 'It’s a RAW + JPEG pair: both files go. ' : `${fmtNum(pairs)} ${pairs === 1 ? 'is a RAW + JPEG pair' : 'are RAW + JPEG pairs'}: both files go. `) : ''
        return `${pairNote}Sidecars go with ${one ? 'it' : 'them'}, and ${one ? 'it’s' : 'they’re'} removed from Glimmr. Check ${one ? 'it' : 'them'} first with the Rejected filter. You can restore ${one ? 'it' : 'them'} from the ${BIN}.`
      })(),
      confirmLabel: `Move to ${BIN}`,
      destructive: true
    })
    if (!ok) return
    const r = await api.trashPhotos(rejects)
    if (r.failed) toast.error(`${fmtNum(r.failed)} couldn’t be moved to the ${BIN}`, { description: r.error })
    else toast.success(`Moved ${r.trashed === 1 ? '1 rejected photo' : `${fmtNum(r.trashed)} rejected photos`} to the ${BIN}`)
    s.refreshResults()
    void s.refreshSidebar()
    const left = job.ids.filter((id) => !rejects.includes(id))
    if (left.length) s.openCull(left, 0, job.title)
    else s.closeCull()
  }

  return (
    <CullView
      title={job.title}
      items={items}
      start={job.start}
      onMark={(i, u) => void s.updatePhotos([job.ids[i]], u)}
      onClose={(i) => {
        s.closeCull()
        const at = s.ids.indexOf(job.ids[i])
        if (at >= 0) s.setFocusIndex(at)
      }}
      actions={<CullAction label="Delete Rejects…" hint={`Move the rejected photos to the ${BIN}`} onClick={() => void deleteRejects()} destructive />}
    />
  )
}
