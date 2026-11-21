import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookImage, ChevronRight, Clock, Copy, Flag, Folder, HardDriveDownload, Images, Plus, Sparkles, Tag, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from '@/components/ui/context-menu'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { confirmDialog, promptDialog } from '../dialogs'
import { fmtNum } from '../format'
import type { FolderNode, KeywordNode, Scope } from '../../../shared/types'
import { DND_FOLDER, DND_PHOTOS, deleteFolder, moveFolderInto, moveFolderTo, newFolder, putPhotos, refOf, renameFolder } from '../folderOps'
import { UpdateNotice } from './UpdateNotice'

const sameScope = (a: Scope, b: Scope): boolean => JSON.stringify(a) === JSON.stringify(b)

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  onKeyDown,
  inset = 10
}: {
  icon?: ReactNode
  label: string
  count?: number
  active?: boolean
  onClick: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  inset?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-current={active ? 'page' : undefined}
      style={{ paddingLeft: inset }}
      className={cn(
        'flex h-7 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-[13px] text-ink-muted transition-colors hover:bg-accent hover:text-ink',
        active && 'bg-accent font-medium text-ink'
      )}
    >
      {icon && <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="tnum text-xs text-ink-muted">{fmtNum(count)}</span>}
    </button>
  )
}

function Section({ title, action, children, defaultOpen = true }: { title: string; action?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-4">
      <div className="flex h-7 items-center pr-1 pl-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1 rounded-sm text-xs font-medium text-ink-muted hover:text-ink">
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} aria-hidden />
          {title}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="flex flex-col gap-px">{children}</CollapsibleContent>
    </Collapsible>
  )
}

function TreeItem<T extends { children: T[] }>({
  node,
  depth,
  label,
  count,
  icon,
  active,
  onSelect,
  menu,
  dnd,
  onKeyDown
}: {
  node: T
  depth: number
  label: (n: T) => string
  count: (n: T) => number
  icon?: ReactNode
  active: (n: T) => boolean
  onSelect: (n: T) => void
  menu?: (n: T) => ReactNode
  /** Drag and drop: what a row carries when dragged, and what happens when something is dropped on it. */
  dnd?: { start?: (n: T, e: React.DragEvent) => void; accepts: (e: React.DragEvent) => boolean; drop: (n: T, e: React.DragEvent) => void }
  onKeyDown?: (n: T, e: React.KeyboardEvent) => void
}) {
  const [open, setOpen] = useState(depth === 0 && node.children.length < 12)
  const [over, setOver] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const row = (
    <div
      className={cn('flex items-center rounded-md', over && 'bg-accent ring-1 ring-ink/40')}
      draggable={!!dnd?.start}
      onDragStart={dnd?.start ? (e) => dnd.start!(node, e) : undefined}
      onDragOver={
        dnd
          ? (e) => {
              if (!dnd.accepts(e)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
              if (!over) {
                setOver(true)
                // Hovering a closed folder while dragging opens it, so you can drop deeper.
                if (!open && node.children.length) openTimer.current = setTimeout(() => setOpen(true), 700)
              }
            }
          : undefined
      }
      onDragLeave={
        dnd
          ? () => {
              setOver(false)
              if (openTimer.current) clearTimeout(openTimer.current)
            }
          : undefined
      }
      onDrop={
        dnd
          ? (e) => {
              setOver(false)
              if (openTimer.current) clearTimeout(openTimer.current)
              if (!dnd.accepts(e)) return
              e.preventDefault()
              e.stopPropagation()
              dnd.drop(node, e)
            }
          : undefined
      }
    >
      {node.children.length > 0 ? (
        <button
          type="button"
          aria-label={open ? `Collapse ${label(node)}` : `Expand ${label(node)}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          style={{ marginLeft: depth * 14 }}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:text-ink"
        >
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        </button>
      ) : (
        <span style={{ marginLeft: depth * 14 }} className="size-5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <NavItem icon={icon} label={label(node)} count={count(node)} active={active(node)} onClick={() => onSelect(node)} onKeyDown={onKeyDown ? (e) => onKeyDown(node, e) : undefined} inset={4} />
      </div>
    </div>
  )
  return (
    <>
      {menu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          {menu(node)}
        </ContextMenu>
      ) : (
        row
      )}
      {open &&
        node.children.map((c, i) => (
          <TreeItem key={i} node={c} depth={depth + 1} label={label} count={count} icon={icon} active={active} onSelect={onSelect} menu={menu} dnd={dnd} onKeyDown={onKeyDown} />
        ))}
    </>
  )
}

const mac = navigator.platform.toLowerCase().includes('mac')

export function Sidebar({ onAddFolder }: { onAddFolder: () => void }) {
  const s = useStore()
  const [kwFilter, setKwFilter] = useState('')
  const [lastImport, setLastImport] = useState<{ id: number; label: string; count: number } | null>(null)
  const [dupCount, setDupCount] = useState(0)
  useEffect(() => {
    void api.lastImport().then(setLastImport)
    void api.duplicateCount().then(setDupCount)
  }, [s.libraryVersion, s.roots])
  const browsing = s.view === 'browse'
  const is = (scope: Scope): boolean => browsing && sameScope(s.scope, scope)

  const newAlbum = async (): Promise<void> => {
    const name = await promptDialog({
      title: 'New album',
      description: s.targets.length ? `The ${s.targets.length === 1 ? 'selected photo is' : `${s.targets.length} selected photos are`} added to it.` : undefined,
      confirmLabel: 'Create Album',
      placeholder: 'Summer in Lisbon'
    })
    if (!name) return
    const id = await api.createAlbum(name, s.targets)
    await s.refreshSidebar()
    s.navigate({ type: 'album', id }, name)
  }

  const filterKeywords = (nodes: KeywordNode[]): KeywordNode[] =>
    kwFilter
      ? nodes.flatMap((n) => {
          const children = filterKeywords(n.children)
          return n.name.toLowerCase().includes(kwFilter.toLowerCase()) || children.length ? [{ ...n, children }] : []
        })
      : nodes

  const jobs = Object.values(s.jobs)

  // ---- folders: drag and drop, and the context menu ----
  const after = (): void => {
    void s.refreshSidebar()
    s.refreshResults()
  }
  const folderDnd = {
    start: (n: FolderNode, e: React.DragEvent) => {
      if (!n.relPath) return e.preventDefault()
      e.dataTransfer.setData(DND_FOLDER, JSON.stringify(refOf(n)))
      e.dataTransfer.effectAllowed = 'copyMove'
    },
    accepts: (e: React.DragEvent) => e.dataTransfer.types.includes(DND_PHOTOS) || e.dataTransfer.types.includes(DND_FOLDER),
    drop: (n: FolderNode, e: React.DragEvent) => {
      const copy = e.altKey
      const shift = e.shiftKey
      const photos = e.dataTransfer.getData(DND_PHOTOS)
      const folder = e.dataTransfer.getData(DND_FOLDER)
      if (photos) {
        const { ids, rootId } = JSON.parse(photos) as { ids: number[]; rootId: number }
        void putPhotos(ids, refOf(n), s.folders, { copy, fromRoot: rootId, shift }).then(after)
      } else if (folder) void moveFolderInto(JSON.parse(folder), refOf(n), s.folders, { copy, shift }).then(after)
    }
  }
  const navigateTo = (rootId: number, rel: string): void => {
    s.navigate({ type: 'folder', rootId, relPath: rel }, rel.split('/').pop() || '')
  }
  const create = async (n: FolderNode): Promise<void> => {
    const ref = await newFolder(refOf(n))
    after()
    if (ref) navigateTo(ref.rootId, ref.rel)
  }
  const rename = async (n: FolderNode): Promise<void> => {
    const ref = await renameFolder(refOf(n), n.name)
    after()
    // Stay in the folder after renaming it.
    if (ref && is({ type: 'folder', rootId: n.rootId, relPath: n.relPath })) navigateTo(ref.rootId, ref.rel)
  }
  const remove = async (n: FolderNode): Promise<void> => {
    const viewing = browsing && s.scope.type === 'folder' && s.scope.rootId === n.rootId && (s.scope.relPath === n.relPath || s.scope.relPath.startsWith(`${n.relPath}/`))
    if (await deleteFolder(refOf(n), n.name)) {
      after()
      if (viewing) s.navigate({ type: 'all' }, 'Photos')
    }
  }
  const removeRoot = async (n: FolderNode): Promise<void> => {
    const ok = await confirmDialog({
      title: `Remove “${n.name}” from the library?`,
      description: `Glimmr forgets its ${fmtNum(n.count)} photos, with their ratings, keywords and albums in the catalog. Nothing on disk is changed or deleted, and you can add the folder again.`,
      confirmLabel: 'Remove from Library',
      destructive: true
    })
    if (!ok) return
    await api.removeRoot(n.rootId)
    after()
    s.navigate({ type: 'all' }, 'Photos')
  }

  return (
    <aside className="flex min-h-0 flex-col border-r bg-panel" aria-label="Library">
      <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-4">
        <div className="flex flex-col gap-px">
          <NavItem icon={<Sparkles />} label="Rediscover" active={s.view === 'rediscover'} onClick={() => s.navigate('rediscover')} />
          <NavItem icon={<Images />} label="Photos" active={is({ type: 'all' })} onClick={() => s.navigate({ type: 'all' }, 'Photos')} />
          <NavItem icon={<Flag />} label="Picks" active={is({ type: 'picks' })} onClick={() => s.navigate({ type: 'picks' }, 'Picks')} />
          <NavItem icon={<Clock />} label="Recently added" active={is({ type: 'recent' })} onClick={() => s.navigate({ type: 'recent' }, 'Recently added')} />
          <NavItem icon={<Copy />} label="Duplicates" count={dupCount || undefined} active={s.view === 'duplicates'} onClick={() => s.openDuplicates()} />
          {lastImport && lastImport.count > 0 && (
            <NavItem
              icon={<HardDriveDownload />}
              label="Last import"
              count={lastImport.count}
              active={is({ type: 'import', id: lastImport.id })}
              onClick={() => s.navigate({ type: 'import', id: lastImport.id }, `Imported from ${lastImport.label}`)}
            />
          )}
        </div>

        <Section
          title="Albums"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="New album" onClick={newAlbum}>
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New album from the selection</TooltipContent>
            </Tooltip>
          }
        >
          {s.albums.length === 0 && <p className="px-2.5 py-1 text-xs text-pretty text-ink-muted">Select photos and press + to make an album.</p>}
          {s.albums.map((a) => (
            <ContextMenu key={a.id}>
              <ContextMenuTrigger asChild>
                <div
                  className="rounded-md data-[over=true]:bg-accent data-[over=true]:ring-1 data-[over=true]:ring-ink/40"
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DND_PHOTOS)) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'link'
                    e.currentTarget.dataset.over = 'true'
                  }}
                  onDragLeave={(e) => delete e.currentTarget.dataset.over}
                  onDrop={async (e) => {
                    delete e.currentTarget.dataset.over
                    const data = e.dataTransfer.getData(DND_PHOTOS)
                    if (!data) return
                    e.preventDefault()
                    const { ids } = JSON.parse(data) as { ids: number[] }
                    await api.addToAlbum(a.id, ids)
                    toast.success(`Added ${ids.length === 1 ? '1 photo' : `${fmtNum(ids.length)} photos`} to “${a.name}”`)
                    void s.refreshSidebar()
                  }}
                >
                  <NavItem icon={<BookImage />} label={a.name} count={a.count} active={is({ type: 'album', id: a.id })} onClick={() => s.navigate({ type: 'album', id: a.id }, a.name)} />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={async () => {
                    const name = await promptDialog({ title: 'Rename album', confirmLabel: 'Rename', initial: a.name })
                    if (name) await api.renameAlbum(a.id, name)
                    void s.refreshSidebar()
                  }}
                >
                  Rename…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    if (
                      !(await confirmDialog({
                        title: `Delete “${a.name}”?`,
                        description: 'The photos stay in your library. Only the album is removed.',
                        confirmLabel: 'Delete Album',
                        destructive: true
                      }))
                    )
                      return
                    await api.deleteAlbum(a.id)
                    if (s.scope.type === 'album' && s.scope.id === a.id) s.navigate({ type: 'all' }, 'Photos')
                    void s.refreshSidebar()
                  }}
                >
                  Delete Album
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>

        <Section title="Smart albums">
          {s.smartAlbums.length === 0 && <p className="px-2.5 py-1 text-xs text-pretty text-ink-muted">Search, then choose Save Search.</p>}
          {s.smartAlbums.map((a) => (
            <ContextMenu key={a.id}>
              <ContextMenuTrigger asChild>
                <div title={a.query}>
                  <NavItem icon={<WandSparkles />} label={a.name} active={is({ type: 'smart', id: a.id })} onClick={() => s.navigate({ type: 'smart', id: a.id }, a.name)} />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={async () => {
                    const name = await promptDialog({ title: 'Rename smart album', confirmLabel: 'Rename', initial: a.name })
                    if (name) await api.saveSmartAlbum({ ...a, name })
                    void s.refreshSidebar()
                  }}
                >
                  Rename…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    await api.deleteSmartAlbum(a.id)
                    void s.refreshSidebar()
                  }}
                >
                  Delete Smart Album
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </Section>

        <Section
          title="Folders"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Add a photo folder" onClick={onAddFolder}>
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a photo folder</TooltipContent>
            </Tooltip>
          }
        >
          {s.folders.map((f) => (
            <TreeItem<FolderNode>
              key={f.key}
              node={f}
              depth={0}
              icon={<Folder />}
              label={(n) => n.name}
              count={(n) => n.count}
              active={(n) => is({ type: 'folder', rootId: n.rootId, relPath: n.relPath })}
              onSelect={(n) => s.navigate({ type: 'folder', rootId: n.rootId, relPath: n.relPath }, n.name)}
              dnd={folderDnd}
              onKeyDown={(n, e) => {
                if (e.key === 'F2' && n.relPath) {
                  e.preventDefault()
                  void rename(n)
                } else if ((e.key === 'Delete' || (mac && e.key === 'Backspace' && e.metaKey)) && n.relPath) {
                  e.preventDefault()
                  e.stopPropagation()
                  void remove(n)
                }
              }}
              menu={(n) => (
                <ContextMenuContent className="w-56">
                  <ContextMenuItem onSelect={() => void create(n)}>New Folder…</ContextMenuItem>
                  {n.relPath && (
                    <>
                      <ContextMenuItem onSelect={() => void rename(n)}>
                        Rename…<ContextMenuShortcut>F2</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => void moveFolderTo(refOf(n), s.folders).then(after)}>Move to…</ContextMenuItem>
                      <ContextMenuItem onSelect={() => void moveFolderTo(refOf(n), s.folders, true).then(after)}>Copy to…</ContextMenuItem>
                    </>
                  )}
                  <ContextMenuItem onSelect={() => api.revealFolder(refOf(n))}>{mac ? 'Show in Finder' : 'Show in Explorer'}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => api.rescan(n.rootId)}>Rescan</ContextMenuItem>
                  <ContextMenuSeparator />
                  {n.relPath ? (
                    <ContextMenuItem variant="destructive" onSelect={() => void remove(n)}>
                      Move to {mac ? 'Trash' : 'Recycle Bin'}…<ContextMenuShortcut>{mac ? '⌘⌫' : 'Del'}</ContextMenuShortcut>
                    </ContextMenuItem>
                  ) : (
                    <ContextMenuItem variant="destructive" onSelect={() => void removeRoot(n)}>
                      Remove from Library…
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              )}
            />
          ))}
        </Section>

        <Section title="Keywords">
          {s.keywords.length > 10 && (
            <Input
              aria-label="Filter keywords"
              placeholder="Filter keywords…"
              value={kwFilter}
              onChange={(e) => setKwFilter(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mx-1 mb-1 h-7 w-auto text-xs"
            />
          )}
          {s.keywords.length === 0 && <p className="px-2.5 py-1 text-xs text-ink-muted">Keywords from your photos appear here.</p>}
          {filterKeywords(s.keywords).map((k) => (
            <TreeItem<KeywordNode>
              key={k.path}
              node={k}
              depth={0}
              icon={<Tag />}
              label={(n) => n.name}
              count={(n) => n.count}
              active={(n) => is({ type: 'keyword', path: n.path })}
              onSelect={(n) => s.navigate({ type: 'keyword', path: n.path }, n.name)}
              menu={(n) => (
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={async () => {
                      const name = await promptDialog({ title: 'Rename keyword', description: 'Use > for hierarchy, like Places > Portugal.', confirmLabel: 'Rename', initial: n.path.replace(/>/g, ' > ') })
                      if (name) await api.renameKeyword(n.path, name)
                      void s.refreshSidebar()
                    }}
                  >
                    Rename…
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={async () => {
                      if (
                        !(await confirmDialog({
                          title: `Remove “${n.name}” from all photos?`,
                          description: `${fmtNum(n.count)} photos lose this keyword in the catalog. Files aren’t changed.`,
                          confirmLabel: 'Remove Keyword',
                          destructive: true
                        }))
                      )
                        return
                      await api.deleteKeyword(n.path)
                      void s.refreshSidebar()
                    }}
                  >
                    Remove Keyword
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
            />
          ))}
        </Section>
      </nav>

      {jobs.length > 0 && (
        <div className="flex flex-col gap-3 border-t px-4 py-3" aria-live="polite">
          {jobs.map((j) => (
            <div key={j.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{j.label}</span>
                <Button variant="ghost" size="icon-xs" aria-label={`Cancel ${j.label}`} onClick={() => api.cancelJob(j.id)}>
                  <X />
                </Button>
              </div>
              <Progress value={j.total ? (j.done / j.total) * 100 : 0} className="h-1" />
              <span className="tnum text-[11px] text-ink-muted">{j.kind === 'model' ? (j.message ?? 'Starting…') : j.total ? `${fmtNum(j.done)} of ${fmtNum(j.total)}` : (j.message ?? 'Starting…')}</span>
            </div>
          ))}
        </div>
      )}
      <UpdateNotice />
    </aside>
  )
}
