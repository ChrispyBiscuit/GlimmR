import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, bridge } from './api'
import { confirmDialog } from './dialogs'
import type {
  Album,
  AppSettings,
  FolderNode,
  ImportSource,
  JobProgress,
  KeywordNode,
  Photo,
  PhotoUpdate,
  Root,
  Scope,
  SmartAlbum,
  SortSpec,
  UpdateStatus,
  Volume
} from '../../shared/types'
import type { PartialSettings } from '../../shared/develop/settings'

export type View = 'rediscover' | 'browse' | 'settings' | 'duplicates'

const BIN = navigator.userAgent.includes('Mac') ? 'Trash' : 'Recycle Bin'

/** A place in the app, for back and forward. */
interface Place {
  view: View
  scope: Scope
  title: string
  query: string
  sort: SortSpec
  section: string
}

const samePlace = (a: Place, b: Place): boolean =>
  a.view === b.view && JSON.stringify(a.scope) === JSON.stringify(b.scope) && a.query === b.query && (a.view !== 'settings' || a.section === b.section)

export interface ViewerState {
  ids: number[]
  index: number
  slideshow: boolean
}

function useStoreValue() {
  const [settings, setSettingsState] = useState<AppSettings | null>(null)
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settings
  const [view, setView] = useState<View>('rediscover')
  const [scope, setScopeState] = useState<Scope>({ type: 'all' })
  const [title, setTitle] = useState('All photos')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortSpec>({ field: 'default', dir: 'desc' })
  const [ids, setIds] = useState<number[]>([])
  const [aspects, setAspects] = useState<number[]>([])
  const [days, setDays] = useState<(string | null)[]>([])
  const [total, setTotal] = useState(0)
  const [searchError, setSearchError] = useState<string | undefined>()
  const [tookMs, setTookMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const cache = useRef(new Map<number, Photo>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focusIndex, setFocusIndex] = useState(-1)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  /** The print workspace, when open: the photos to print, or the calibration chart. */
  const [printJob, setPrintJob] = useState<{ ids: number[]; chart?: boolean } | null>(null)
  const [cull, setCull] = useState<{ ids: number[]; start: number; title: string } | null>(null)
  /** The Develop view, when open: the photos in its filmstrip and the one being edited. */
  const [develop, setDevelop] = useState<{ ids: number[]; index: number } | null>(null)
  /** Copied develop settings, for paste (Ctrl/⌘+Shift+V). */
  const [developClip, setDevelopClip] = useState<PartialSettings | null>(null)
  const [importSource, setImportSource] = useState<ImportSource | null>(null)
  const [cards, setCards] = useState<Volume[]>([])
  /** Reads a card or folder and opens the import window (asks for a folder when no path is given). */
  const openImport = useCallback(async (path?: string): Promise<void> => {
    const src = await api.openImportSource(path)
    if (src) setImportSource(src)
    else if (path) toast.error('That card couldn’t be read')
  }, [])
  const [roots, setRoots] = useState<Root[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>([])
  const [keywords, setKeywords] = useState<KeywordNode[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [jobs, setJobs] = useState<Record<string, JobProgress>>({})
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const [libraryVersion, setLibraryVersion] = useState(0)
  // Bumped on catalog edits: refreshes facet counts without re-running (and re-sorting) the search.
  const [editVersion, setEditVersion] = useState(0)
  const [settingsSection, setSettingsSection] = useState('library')
  const [previousView, setPreviousView] = useState<View>('rediscover')
  // Photo size follows the slider or wheel at once; the setting is saved when it settles.
  const [liveThumbSize, setLiveThumbSize] = useState<number | null>(null)
  const thumbSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const history = useRef<{ list: Place[]; index: number; restoring: boolean }>({ list: [], index: -1, restoring: false })
  const [historyVersion, setHistoryVersion] = useState(0)

  const putPhotos = useCallback((list: Photo[]) => {
    for (const p of list) cache.current.set(p.id, p)
    setCacheVersion((v) => v + 1)
  }, [])

  const refreshSidebar = useCallback(async () => {
    const [r, a, s, k, f] = await Promise.all([api.listRoots(), api.albums(), api.smartAlbums(), api.keywordTree(), api.folderTree()])
    setRoots(r)
    setAlbums(a)
    setSmartAlbums(s)
    setKeywords(k)
    setFolders(f)
  }, [])

  useEffect(() => {
    void api.getSettings().then(setSettingsState)
    void api.updateStatus().then(setUpdate)
    const offUpdate = bridge().onUpdate(setUpdate)
    void refreshSidebar()
    // Camera cards: offer (or open) Import when one is inserted, as the import setting says.
    let known = new Set<string>()
    const offCards = bridge().onCards((list) => {
      setCards(list)
      const fresh = list.filter((c) => !known.has(c.path))
      // Cards already in when Glimmr starts are offered too.
      known = new Set(list.map((c) => c.path))
      const mode = settingsRef.current?.import.onCard ?? 'ask'
      for (const c of fresh) {
        if (mode === 'open') void openImport(c.path)
        else if (mode === 'ask')
          toast(`${c.name} is connected`, { description: 'A camera card. Import its photos?', duration: 15000, action: { label: 'Import', onClick: () => void openImport(c.path) } })
      }
    })
    const offJob = bridge().onJob((p) => {
      setJobs((j) => {
        const next = { ...j, [p.id]: p }
        if (p.finished) delete next[p.id]
        return next
      })
      if (p.finished) {
        // Jobs can change settings in the main process (e.g. last backup time).
        void api.getSettings().then(setSettingsState)
        // The print workspace reports its own results.
        if (p.kind === 'print') return
        if (p.error) toast.error(p.label, { description: p.error, duration: 8000 })
        else if (p.kind === 'files' || p.kind === 'import') return
        // Scans and tagging run often in the background; only mention the ones that changed something notable.
        else if (p.kind === 'tags' ? p.total >= 100 : p.kind !== 'scan' || (p.message && !p.message.startsWith('0 new, 0 updated')))
          toast.success(p.kind === 'tags' ? 'Smart tags are ready' : p.kind === 'model' ? 'Smart tag model downloaded' : p.label, {
            description: p.kind === 'model' ? 'Finding subjects in your photos…' : p.message
          })
      }
    })
    // Throttle library refreshes while a scan streams in.
    let t: ReturnType<typeof setTimeout> | null = null
    const offLib = bridge().onLibraryChanged(() => {
      if (t) return
      t = setTimeout(() => {
        t = null
        setLibraryVersion((v) => v + 1)
        void refreshSidebar()
      }, 400)
    })
    return () => {
      offCards()
      offJob()
      offLib()
      offUpdate()
    }
  }, [refreshSidebar])

  // While scanning, refresh results every few seconds so new photos appear.
  const scanning = Object.values(jobs).some((j) => j.kind === 'scan' && j.total > 0)
  useEffect(() => {
    if (!scanning) return
    const i = setInterval(() => {
      setLibraryVersion((v) => v + 1)
      void refreshSidebar()
    }, 3000)
    return () => clearInterval(i)
  }, [scanning, refreshSidebar])

  // Run the search whenever its inputs change.
  const searchSeq = useRef(0)
  useEffect(() => {
    if (view !== 'browse') return
    const seq = ++searchSeq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      const r = await api.search({ scope, query, sort, offset: 0, limit: 300 })
      if (seq !== searchSeq.current) return
      putPhotos(r.photos)
      setIds(r.ids)
      setAspects(r.aspects)
      setDays(r.days)
      setTotal(r.total)
      setSearchError(r.error)
      setTookMs(r.tookMs)
      setLoading(false)
    }, 120)
    return () => clearTimeout(timer)
  }, [view, scope, query, sort, libraryVersion, putPhotos])

  // Reset selection when the result set changes identity.
  useEffect(() => {
    setSelected(new Set())
    setFocusIndex(-1)
  }, [scope, query, sort])

  const loading$ = useRef(new Set<number>())
  const ensurePhotos = useCallback(
    async (wanted: number[]) => {
      const missing = wanted.filter((id) => !cache.current.has(id) && !loading$.current.has(id))
      if (!missing.length) return
      missing.forEach((id) => loading$.current.add(id))
      try {
        putPhotos(await api.photos(missing))
      } finally {
        missing.forEach((id) => loading$.current.delete(id))
      }
    },
    [putPhotos]
  )

  const navigate = useCallback((next: Scope | 'rediscover', label?: string, q = '') => {
    if (next === 'rediscover') {
      setView('rediscover')
      return
    }
    setScopeState(next)
    setTitle(label ?? 'All photos')
    setQuery(q)
    setSort({ field: next.type === 'album' ? 'albumOrder' : next.type === 'recent' ? 'added' : 'default', dir: next.type === 'album' ? 'asc' : 'desc' })
    setView('browse')
  }, [])

  const openSettings = useCallback(
    (section = 'library') => {
      setSettingsSection(section)
      setView((v) => {
        if (v !== 'settings') setPreviousView(v)
        return 'settings'
      })
    },
    []
  )
  const closeSettings = useCallback(() => setView(previousView), [previousView])

  const search = useCallback((q: string) => {
    setQuery(q)
    setView('browse')
  }, [])

  // Record each place visited. Refining a search replaces the current step instead of adding one per keystroke.
  useEffect(() => {
    const h = history.current
    const place: Place = { view, scope, title, query, sort, section: settingsSection }
    if (h.restoring) {
      h.restoring = false
      return
    }
    const cur = h.list[h.index]
    if (cur && samePlace(cur, place)) {
      h.list[h.index] = place
      return
    }
    const refining = cur && cur.view === 'browse' && place.view === 'browse' && JSON.stringify(cur.scope) === JSON.stringify(place.scope) && cur.query && place.query
    h.list = h.list.slice(0, refining ? h.index : h.index + 1)
    h.list.push(place)
    h.index = h.list.length - 1
    setHistoryVersion((v) => v + 1)
  }, [view, scope, title, query, sort, settingsSection])

  const goHistory = useCallback((delta: number) => {
    const h = history.current
    const place = h.list[h.index + delta]
    if (!place) return
    h.index += delta
    h.restoring = true
    if (place.view !== 'settings') setPreviousView(place.view)
    setScopeState(place.scope)
    setTitle(place.title)
    setQuery(place.query)
    setSort(place.sort)
    setSettingsSection(place.section)
    setView(place.view)
    setHistoryVersion((v) => v + 1)
  }, [])
  const back = useCallback(() => goHistory(-1), [goHistory])
  const forward = useCallback(() => goHistory(1), [goHistory])
  const canBack = history.current.index > 0
  const canForward = history.current.index < history.current.list.length - 1
  void historyVersion

  const refreshResults = useCallback(() => setLibraryVersion((v) => v + 1), [])

  const setSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettingsState(await api.setSettings(patch))
  }, [])

  const thumbSize = liveThumbSize ?? settings?.thumbSize ?? 220
  const setThumbSize = useCallback(
    (size: number) => {
      const next = Math.round(Math.min(420, Math.max(120, size)))
      setLiveThumbSize(next)
      clearTimeout(thumbSaveTimer.current)
      thumbSaveTimer.current = setTimeout(() => void setSettings({ thumbSize: next }).then(() => setLiveThumbSize((v) => (v === next ? null : v))), 400)
    },
    [setSettings]
  )

  /** Applies a catalog edit and refreshes the affected tiles. */
  const updatePhotos = useCallback(
    async (targetIds: number[], u: PhotoUpdate) => {
      if (!targetIds.length) return
      putPhotos(await api.update(targetIds, u))
      setEditVersion((v) => v + 1)
      if (u.addKeywords || u.removeKeywords) void refreshSidebar()
    },
    [putPhotos, refreshSidebar]
  )

  const openEditor = useCallback(
    async (targetIds: number[], editorId?: string) => {
      if (!targetIds.length) return
      const r = await api.openInEditor(targetIds, editorId)
      if (!r.ok) toast.warning(r.message ?? 'The editor could not be opened.')
      else toast(`Opening ${targetIds.length === 1 ? '1 photo' : `${targetIds.length} photos`} in your editor…`, { duration: 1800 })
    },
    []
  )

  /** Asks, then moves photos to the system trash. Resolves true when any were removed. */
  const trashPhotos = useCallback(
    async (targetIds: number[], part: 'all' | 'raw' | 'jpeg' = 'all'): Promise<boolean> => {
      const n = targetIds.length
      if (!n) return false
      const pairs = targetIds.filter((id) => cache.current.get(id)?.companion).length
      const what = part === 'raw' ? 'RAW file' : part === 'jpeg' ? 'JPEG' : null
      const ok = await confirmDialog({
        title: what
          ? `Move the ${what}${n === 1 ? '' : 's'} of ${n === 1 ? 'this photo' : `${n.toLocaleString()} photos`} to the ${BIN}?`
          : n === 1
            ? `Move this photo to the ${BIN}?`
            : `Move ${n.toLocaleString()} photos to the ${BIN}?`,
        description: what
          ? `Only the ${what}${n === 1 ? '' : 's'} and ${n === 1 ? 'its' : 'their'} own sidecars are moved. The photo${n === 1 ? ' stays' : 's stay'} in Glimmr as the other file.`
          : `${pairs ? `${pairs === n ? (n === 1 ? 'Both the RAW and the JPEG are' : 'Both RAW and JPEG files are') : `RAW + JPEG pairs go together. Everything is`} moved` : n === 1 ? 'The file is moved' : 'The files are moved'} to the ${BIN} with ${n === 1 && !pairs ? 'its' : 'their'} sidecars (XMP and the like), and removed from Glimmr. You can restore ${n === 1 ? 'it' : 'them'} from the ${BIN}.`,
        confirmLabel: `Move to ${BIN}`,
        destructive: true
      })
      if (!ok) return false
      const r = await api.trashPhotos(targetIds, part)
      if (r.failed) toast.error(`${r.failed === 1 ? 'A photo' : `${r.failed} photos`} couldn’t be moved to the ${BIN}`, { description: r.error })
      else toast(`Moved ${r.trashed === 1 ? '1 photo' : `${r.trashed.toLocaleString()} photos`} to the ${BIN}`)
      setSelected(new Set())
      setLibraryVersion((v) => v + 1)
      void refreshSidebar()
      return r.trashed > 0
    },
    [refreshSidebar]
  )

  /** Selected ids, or the focused photo when nothing is selected. */
  const targets = useMemo(() => {
    if (selected.size) return ids.filter((id) => selected.has(id))
    return focusIndex >= 0 && ids[focusIndex] != null ? [ids[focusIndex]] : []
  }, [selected, ids, focusIndex])

  return {
    settings,
    setSettings,
    view,
    scope,
    title,
    query,
    setQuery,
    search,
    sort,
    setSort,
    navigate,
    ids,
    aspects,
    days,
    total,
    searchError,
    tookMs,
    loading,
    cache: cache.current,
    cacheVersion,
    putPhotos,
    ensurePhotos,
    selected,
    setSelected,
    focusIndex,
    setFocusIndex,
    targets,
    viewer,
    setViewer,
    printJob,
    openPrint: (ids: number[]): void => {
      if (ids.length) setPrintJob({ ids })
    },
    openPrintChart: () => setPrintJob({ ids: [], chart: true }),
    closePrint: () => setPrintJob(null),
    cull,
    openCull: (ids: number[], start: number, title: string): void => {
      if (ids.length) setCull({ ids, start, title })
    },
    closeCull: () => setCull(null),
    develop,
    setDevelop,
    openDevelop: (ids: number[], index = 0): void => {
      if (ids.length) setDevelop({ ids, index: Math.min(Math.max(0, index), ids.length - 1) })
    },
    closeDevelop: () => setDevelop(null),
    developClip,
    setDevelopClip,
    importSource,
    setImportSource,
    cards,
    setCards,
    openImport,
    roots,
    albums,
    smartAlbums,
    keywords,
    folders,
    refreshSidebar,
    jobs,
    update,
    libraryVersion,
    editVersion,
    refreshResults,
    updatePhotos,
    trashPhotos,
    openEditor,
    settingsSection,
    openSettings,
    closeSettings,
    openDuplicates: () => setView('duplicates'),
    back,
    forward,
    canBack,
    canForward,
    thumbSize,
    setThumbSize
  }
}

export type Store = ReturnType<typeof useStoreValue>

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue()
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
