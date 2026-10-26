import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { cullingUpdate, isTyping } from '../culling'
import { buildLayout, GAP, type LayoutRow } from '../layout'
import { fmtNum, monthLabel } from '../format'
import { Tile } from './Tile'

const mac = navigator.userAgent.includes('Mac')
const PAD = 20

export function PhotoGrid() {
  const s = useStore()
  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const anchor = useRef(-1)
  const [menuId, setMenuId] = useState<number | null>(null)
  const target = s.settings?.thumbSize ?? 220
  const groupByMonth = ['default', 'taken'].includes(s.sort.field) && s.scope.type !== 'smart'

  // The scroller only mounts once there are results, so measure it through a callback ref.
  useEffect(() => {
    if (!scrollEl) return
    const ro = new ResizeObserver(() => setWidth(scrollEl.clientWidth - PAD * 2))
    ro.observe(scrollEl)
    return () => ro.disconnect()
  }, [scrollEl])

  const rows = useMemo(
    () => buildLayout({ aspects: s.aspects, days: s.days, width, target, groupByMonth, monthLabel }),
    [s.aspects, s.days, width, target, groupByMonth]
  )
  // Index of the row holding each photo, for keyboard navigation and scrolling.
  const rowOf = useMemo(() => {
    const m = new Int32Array(s.ids.length)
    rows.forEach((r, ri) => r.kind === 'row' && r.items.forEach((it) => (m[it.index] = ri)))
    return m
  }, [rows, s.ids.length])

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => rows[i].height + (rows[i].kind === 'row' ? GAP : 0),
    overscan: 6,
    getItemKey: (i) => rows[i].key
  })
  useEffect(() => {
    virtual.measure()
  }, [rows, virtual])

  // Load photo details for visible rows.
  const items = virtual.getVirtualItems()
  useEffect(() => {
    if (!items.length) return
    const first = rows[items[0].index]?.firstIndex ?? 0
    const lastRow = rows[items[items.length - 1].index]
    const last = lastRow?.kind === 'row' ? lastRow.items[lastRow.items.length - 1].index : (lastRow?.firstIndex ?? 0)
    void s.ensurePhotos(s.ids.slice(Math.max(0, first - 40), last + 80))
  }, [items, rows, s])

  const scrollToPhoto = useCallback((i: number) => virtual.scrollToIndex(rowOf[i], { align: 'auto' }), [virtual, rowOf])
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

  // Arrow keys move through the justified rows; culling keys mark the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (s.viewer || isTyping(e) || document.querySelector('[role="dialog"], [role="menu"]')) return
      const n = s.ids.length
      if (!n) return
      const mod = e.metaKey || e.ctrlKey
      const f = s.focusIndex
      const move = (to: number): void => {
        const i = Math.max(0, Math.min(n - 1, to))
        s.setFocusIndex(i)
        if (e.shiftKey) s.setSelected(new Set([...s.selected, s.ids[i]]))
        else {
          s.setSelected(new Set([s.ids[i]]))
          anchor.current = i
        }
        scrollToPhoto(i)
        e.preventDefault()
      }
      const vertical = (dir: 1 | -1): void => {
        if (f < 0) return move(0)
        // Find the photo in the next/previous photo row nearest horizontally.
        let ri = rowOf[f] + dir
        while (rows[ri] && rows[ri].kind !== 'row') ri += dir
        const row = rows[ri]
        if (!row || row.kind !== 'row') return move(dir > 0 ? n - 1 : 0)
        const cur = rows[rowOf[f]] as Extract<LayoutRow, { kind: 'row' }>
        let x = 0
        for (const it of cur.items) {
          if (it.index === f) break
          x += it.width + GAP
        }
        let acc = 0
        let pick = row.items[row.items.length - 1].index
        for (const it of row.items) {
          if (acc + it.width >= x) {
            pick = it.index
            break
          }
          acc += it.width + GAP
        }
        move(pick)
      }
      if (e.key === 'ArrowRight') return move(f + 1)
      if (e.key === 'ArrowLeft') return move(f - 1)
      if (e.key === 'ArrowDown') return vertical(1)
      if (e.key === 'ArrowUp') return vertical(-1)
      if (e.key === 'Home') return move(0)
      if (e.key === 'End') return move(n - 1)
      if ((e.key === 'Enter' || e.key === ' ') && f >= 0) {
        e.preventDefault()
        return openViewer(f)
      }
      if (e.key === 'Escape') return s.setSelected(new Set())
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        return s.setSelected(new Set(s.ids))
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        return void s.openEditor(s.targets)
      }
      if (e.key.toLowerCase() === 's' && !mod) return s.setViewer({ ids: s.ids, index: Math.max(0, f), slideshow: true })
      const u = cullingUpdate(e, s.cache.get(s.ids[f])?.label)
      if (u && s.targets.length) {
        e.preventDefault()
        void s.updatePhotos(s.targets, u)
        if (s.settings?.autoAdvance && s.targets.length === 1) move(f + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, rows, rowOf, openViewer, scrollToPhoto])

  // Year scrubber: the first header of each year, positioned by scroll offset.
  const years = useMemo(() => {
    if (!groupByMonth) return []
    const out: { year: string; row: number }[] = []
    rows.forEach((r, i) => {
      if (r.kind === 'header' && r.day && out[out.length - 1]?.year !== r.day.slice(0, 4)) out.push({ year: r.day.slice(0, 4), row: i })
    })
    return out
  }, [rows, groupByMonth])
  const currentRow = items[0]?.index ?? 0
  const currentYear = [...years].reverse().find((y) => y.row <= currentRow + 1)?.year

  const menuIds = menuId == null ? [] : s.selected.has(menuId) ? s.targets : [menuId]
  const editors = s.settings?.editors.editors ?? []

  if (!s.ids.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{s.loading ? 'Searching…' : s.query ? 'Nothing matches this search' : 'No photos here yet'}</EmptyTitle>
          {!s.loading && s.query && <EmptyDescription>Remove a filter or try fewer words. Field searches like iso:&gt;1600 need a value photos actually have.</EmptyDescription>}
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="relative flex h-full">
      <ContextMenu
        onOpenChange={(open) => {
          if (!open) setMenuId(null)
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            ref={(el) => {
              scroller.current = el
              setScrollEl(el)
            }}
            className="scroll-thin min-w-0 flex-1 overflow-y-auto"
            onContextMenu={(e) => {
              const id = Number((e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id)
              if (!id) return e.preventDefault()
              setMenuId(id)
              if (!s.selected.has(id)) {
                s.setSelected(new Set([id]))
                s.setFocusIndex(s.ids.indexOf(id))
              }
            }}
          >
            <div className="relative" style={{ height: virtual.getTotalSize() + 120 }}>
              {items.map((vi) => {
                const row = rows[vi.index]
                return (
                  <div key={vi.key} className="absolute left-0 w-full" style={{ top: vi.start, paddingLeft: PAD, paddingRight: PAD }}>
                    {row.kind === 'header' ? (
                      <div className="flex h-16 items-end justify-between pb-3">
                        <h2 className="display text-[19px] leading-none">{row.label}</h2>
                        <span className="tnum text-xs text-ink-muted">{fmtNum(row.count)} photos</span>
                      </div>
                    ) : (
                      <div className="flex" style={{ gap: GAP, height: row.height }}>
                        {row.items.map((it) => {
                          const id = s.ids[it.index]
                          return (
                            <Tile
                              key={id}
                              photo={s.cache.get(id)}
                              width={it.width}
                              height={row.height}
                              selected={s.selected.has(id)}
                              focused={s.focusIndex === it.index}
                              tabIndex={s.focusIndex === it.index || (s.focusIndex < 0 && it.index === 0) ? 0 : -1}
                              onClick={(e) => onTileClick(it.index, e)}
                              onDoubleClick={() => openViewer(it.index)}
                            />
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem onSelect={() => menuId != null && openViewer(s.ids.indexOf(menuId))}>View</ContextMenuItem>
          <ContextMenuItem onSelect={() => void s.openEditor(menuIds)}>
            Open in Editor
            <ContextMenuShortcut>{mac ? '⌘E' : 'Ctrl+E'}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Open With</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {editors.map((e) => (
                <ContextMenuItem key={e.id} onSelect={() => void s.openEditor(menuIds, e.id)}>
                  {e.name}
                </ContextMenuItem>
              ))}
              {editors.length > 0 && <ContextMenuSeparator />}
              <ContextMenuItem onSelect={() => menuId != null && void api.openWithDefault(menuId)}>System Default App</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => menuId != null && void api.reveal(menuId)}>{mac ? 'Show in Finder' : 'Show in Explorer'}</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={!s.albums.length}>Add to Album</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {s.albums.map((a) => (
                <ContextMenuItem
                  key={a.id}
                  onSelect={async () => {
                    await api.addToAlbum(a.id, menuIds)
                    void s.refreshSidebar()
                  }}
                >
                  {a.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          {s.scope.type === 'album' && (
            <ContextMenuItem
              onSelect={async () => {
                if (s.scope.type !== 'album') return
                await api.removeFromAlbum(s.scope.id, menuIds)
                s.refreshResults()
                void s.refreshSidebar()
              }}
            >
              Remove from This Album
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => void api.writeXmp(menuIds)}>Save Marks to XMP Sidecar</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {years.length > 1 && (
        <nav aria-label="Jump to year" className="flex w-12 shrink-0 flex-col justify-between border-l py-4 text-center">
          {years.map((y) => (
            <button
              key={y.year}
              type="button"
              onClick={() => virtual.scrollToIndex(y.row, { align: 'start' })}
              className={cn('tnum rounded-sm text-[11px] text-ink-muted hover:text-ink', currentYear === y.year && 'font-semibold text-ink')}
            >
              {y.year}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
