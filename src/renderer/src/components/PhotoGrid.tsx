import { useCallback, useEffect, useRef, useState } from 'react'
import { VirtuosoGrid, type VirtuosoGridHandle } from 'react-virtuoso'
import { Dropdown, Empty, Spin } from 'antd'
import type { MenuProps } from 'antd'
import { useStore } from '../store'
import { api } from '../api'
import { cullingUpdate, isTyping } from '../culling'
import { Tile } from './Tile'

export function PhotoGrid() {
  const s = useStore()
  const ref = useRef<VirtuosoGridHandle>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(5)
  const anchor = useRef(-1)
  const thumb = s.settings?.thumbSize ?? 220

  // Column count from the available width and the thumbnail size slider.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setCols(Math.max(1, Math.floor((el.clientWidth - 28) / thumb))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [thumb])

  const openViewer = useCallback((index: number) => s.setViewer({ ids: s.ids, index, slideshow: false }), [s])

  const onTileClick = (index: number, e: React.MouseEvent): void => {
    const id = s.ids[index]
    const next = new Set(s.selected)
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)]
      for (let i = a; i <= b; i++) next.add(s.ids[i])
    } else if (e.metaKey || e.ctrlKey) {
      if (next.has(id)) next.delete(id)
      else next.add(id)
      anchor.current = index
    } else {
      next.clear()
      next.add(id)
      anchor.current = index
    }
    s.setSelected(next)
    s.setFocusIndex(index)
  }

  // Keyboard: arrows move focus, Enter opens, culling keys apply to the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (s.viewer || isTyping(e) || document.querySelector('.ant-modal-wrap')) return
      const n = s.ids.length
      if (!n) return
      const mod = e.metaKey || e.ctrlKey
      const move = (to: number): void => {
        const i = Math.max(0, Math.min(n - 1, to))
        s.setFocusIndex(i)
        if (e.shiftKey) {
          const next = new Set(s.selected)
          next.add(s.ids[i])
          s.setSelected(next)
        } else {
          s.setSelected(new Set([s.ids[i]]))
          anchor.current = i
        }
        ref.current?.scrollToIndex({ index: i, align: 'center', behavior: 'auto' })
        e.preventDefault()
      }
      const f = s.focusIndex
      if (e.key === 'ArrowRight') return move(f + 1)
      if (e.key === 'ArrowLeft') return move(f - 1)
      if (e.key === 'ArrowDown') return move(f < 0 ? 0 : f + cols)
      if (e.key === 'ArrowUp') return move(f - cols)
      if (e.key === 'Home') return move(0)
      if (e.key === 'End') return move(n - 1)
      if ((e.key === 'Enter' || e.key === ' ') && f >= 0) {
        e.preventDefault()
        return openViewer(f)
      }
      if (e.key === 'Escape') {
        s.setSelected(new Set())
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        s.setSelected(new Set(s.ids))
        return
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        void s.openEditor(s.targets)
        return
      }
      if (e.key.toLowerCase() === 's' && !mod && n) {
        s.setViewer({ ids: s.ids, index: Math.max(0, f), slideshow: true })
        return
      }
      const focused = s.cache.get(s.ids[f])
      const u = cullingUpdate(e, focused?.label)
      if (u && s.targets.length) {
        e.preventDefault()
        void s.updatePhotos(s.targets, u)
        if (s.settings?.autoAdvance && s.targets.length === 1) move(f + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, cols, openViewer])

  const contextMenu = (index: number): MenuProps => {
    const id = s.ids[index]
    const ids = s.selected.has(id) ? s.targets : [id]
    const editors = s.settings?.editors.editors ?? []
    return {
      items: [
        { key: 'open', label: 'View' },
        { key: 'edit', label: 'Open in default editor', extra: navigator.userAgent.includes('Mac') ? '⌘E' : 'Ctrl+E' },
        { key: 'with', label: 'Open with', children: [...editors.map((e) => ({ key: `with:${e.id}`, label: e.name })), { type: 'divider' as const }, { key: 'system', label: 'System default app' }] },
        { key: 'reveal', label: navigator.userAgent.includes('Mac') ? 'Show in Finder' : 'Show in Explorer' },
        { type: 'divider' },
        { key: 'album', label: 'Add to album', disabled: !s.albums.length, children: s.albums.map((a) => ({ key: `album:${a.id}`, label: a.name })) },
        ...(s.scope.type === 'album' ? [{ key: 'unalbum', label: 'Remove from this album' }] : []),
        { key: 'xmp', label: 'Write metadata to XMP sidecar' }
      ],
      onClick: async ({ key }) => {
        if (key === 'open') openViewer(index)
        else if (key === 'edit') void s.openEditor(ids)
        else if (key.startsWith('with:')) void s.openEditor(ids, key.slice(5))
        else if (key === 'system') void api.openWithDefault(id)
        else if (key === 'reveal') void api.reveal(id)
        else if (key.startsWith('album:')) {
          await api.addToAlbum(Number(key.slice(6)), ids)
          void s.refreshSidebar()
        } else if (key === 'unalbum' && s.scope.type === 'album') {
          await api.removeFromAlbum(s.scope.id, ids)
          s.refreshResults()
          void s.refreshSidebar()
        } else if (key === 'xmp') void api.writeXmp(ids)
      }
    }
  }

  if (!s.ids.length) {
    return (
      <div className="empty">
        {s.loading ? <Spin /> : <Empty description={s.query ? 'No photos match this search' : 'No photos here yet'} />}
      </div>
    )
  }

  return (
    <div ref={wrap} style={{ height: '100%', ['--tile-w' as string]: `${100 / cols}%` }}>
      <VirtuosoGrid
        ref={ref}
        style={{ height: '100%' }}
        totalCount={s.ids.length}
        listClassName="grid-list"
        itemClassName="grid-item"
        increaseViewportBy={600}
        computeItemKey={(i) => s.ids[i]}
        rangeChanged={({ startIndex, endIndex }) => void s.ensurePhotos(s.ids.slice(Math.max(0, startIndex - 60), endIndex + 120))}
        itemContent={(index) => {
          const id = s.ids[index]
          return (
            <Dropdown trigger={['contextMenu']} menu={contextMenu(index)} destroyOnHidden>
              <div>
                <Tile
                  photo={s.cache.get(id)}
                  selected={s.selected.has(id)}
                  focused={s.focusIndex === index}
                  onClick={(e) => onTileClick(index, e)}
                  onDoubleClick={() => openViewer(index)}
                  onRate={(r) => void s.updatePhotos([id], { rating: r })}
                  onEdit={() => void s.openEditor([id])}
                  onContextMenu={() => {
                    if (!s.selected.has(id)) {
                      s.setSelected(new Set([id]))
                      s.setFocusIndex(index)
                    }
                  }}
                />
              </div>
            </Dropdown>
          )
        }}
      />
    </div>
  )
}
