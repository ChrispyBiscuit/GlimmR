import { memo, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { EditOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import { thumbUrl } from '../api'
import { camera, exposure, fmtDate, LABEL_COLORS } from '../format'
import type { Photo } from '../../../shared/types'

interface Props {
  photo: Photo | undefined
  selected?: boolean
  focused?: boolean
  className?: string
  onClick?: (e: React.MouseEvent) => void
  onDoubleClick?: () => void
  onRate?: (rating: number) => void
  onEdit?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

export const Tile = memo(function Tile({ photo, selected, focused, className, onClick, onDoubleClick, onRate, onEdit, onContextMenu }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (!photo) return <div className={`tile ${className ?? ''}`} />
  const cls = ['tile', className, selected && 'selected', focused && 'focused', photo.flag === 'reject' && 'rejected'].filter(Boolean).join(' ')
  return (
    <div className={cls} onClick={onClick} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu} data-id={photo.id}>
      {!failed && (
        <img
          src={thumbUrl(photo.id, photo.mtime)}
          className={loaded ? 'loaded' : ''}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          alt=""
        />
      )}
      {failed && <div className="tile-missing">{photo.offline ? 'Offline' : 'No preview'}</div>}
      <div className="tile-badges">
        {photo.kind === 'raw' && <span className="badge">RAW</span>}
        {photo.flag === 'pick' && <span className="badge" style={{ color: '#7ee787' }}>PICK</span>}
        {photo.offline && <span className="badge" style={{ color: '#ff7875' }}>OFFLINE</span>}
        {photo.rating > 0 && <span className="badge stars">{'★'.repeat(photo.rating)}</span>}
        {photo.label && <span className="label-dot" style={{ background: LABEL_COLORS[photo.label] }} />}
      </div>
      {(onRate || onEdit) && (
        <div className="tile-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {onRate && (
            <Tooltip title={photo.rating >= 5 ? 'Clear rating' : 'Add a star (or press 1–5)'}>
              <Button size="small" shape="circle" icon={photo.rating ? <StarFilled /> : <StarOutlined />} onClick={() => onRate(photo.rating >= 5 ? 0 : photo.rating + 1)} />
            </Tooltip>
          )}
          {onEdit && (
            <Tooltip title="Open in editor (Ctrl/⌘ E)">
              <Button size="small" shape="circle" icon={<EditOutlined />} onClick={onEdit} />
            </Tooltip>
          )}
        </div>
      )}
      <div className="tile-overlay">
        <div className="name">{photo.title || photo.filename}</div>
        <div className="meta">{fmtDate(photo.takenAt, { dateStyle: 'medium' })}{camera(photo) ? ` · ${camera(photo)}` : ''}</div>
        <div className="meta">{exposure(photo)}</div>
      </div>
    </div>
  )
})
