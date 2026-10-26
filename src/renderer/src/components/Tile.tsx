import { memo, useState } from 'react'
import { Flag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { thumbUrl } from '../api'
import { LABEL_COLORS, fmtDate } from '../format'
import type { Photo } from '../../../shared/types'

interface Props {
  photo: Photo | undefined
  width: number
  height: number
  selected?: boolean
  focused?: boolean
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  tabIndex?: number
}

/** One frame on the contact sheet. Marks (stars, flag, label) are always visible; the caption appears on hover. */
export const Tile = memo(function Tile({ photo, width, height, selected, focused, onClick, onDoubleClick, tabIndex = -1 }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!photo) return <div className="shrink-0 bg-ink/5" style={{ width, height }} />
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      data-id={photo.id}
      aria-label={`${photo.title || photo.filename}, ${fmtDate(photo.takenAt, { dateStyle: 'medium' })}${photo.rating ? `, ${photo.rating} stars` : ''}${photo.flag ? `, ${photo.flag === 'pick' ? 'picked' : 'rejected'}` : ''}`}
      aria-pressed={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group relative shrink-0 overflow-hidden bg-ink/5 outline-none focus-visible:outline-none',
        selected && 'ring-2 ring-ink ring-offset-2 ring-offset-canvas',
        focused && !selected && 'ring-1 ring-ink/60 ring-offset-1 ring-offset-canvas'
      )}
      style={{ width, height }}
    >
      {!failed && (
        <img
          src={thumbUrl(photo.id, photo.mtime)}
          width={Math.round(width)}
          height={Math.round(height)}
          loading="lazy"
          decoding="async"
          draggable={false}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0', photo.flag === 'reject' && 'opacity-35 grayscale')}
        />
      )}
      {failed && <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-muted">{photo.offline ? 'Drive not connected' : 'No preview'}</span>}

      {/* Marks, always visible, like china marker on a contact sheet. */}
      {(photo.rating > 0 || photo.flag || photo.label) && (
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-sm bg-black/55 px-1.5 py-0.5 text-[11px] leading-none text-white">
          {photo.rating > 0 && <span className="text-[#f2c744]">{'★'.repeat(photo.rating)}</span>}
          {photo.flag === 'pick' && <Flag className="size-3 fill-[#4cc38a] text-[#4cc38a]" aria-hidden />}
          {photo.flag === 'reject' && <X className="size-3 text-[#e5534b]" aria-hidden />}
          {photo.label && <span className="size-2 rounded-full" style={{ background: LABEL_COLORS[photo.label] }} aria-hidden />}
        </span>
      )}
      {(photo.kind === 'raw' || photo.offline) && (
        <span className="absolute top-1.5 right-1.5 rounded-sm bg-black/55 px-1 py-px text-[10px] font-medium text-white">{photo.offline ? 'Offline' : 'RAW'}</span>
      )}
      <span className="pointer-events-none absolute inset-x-0 top-0 truncate bg-gradient-to-b from-black/60 to-transparent px-2 pt-1.5 pb-4 text-left text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
        {photo.title || photo.filename}
      </span>
    </button>
  )
})
