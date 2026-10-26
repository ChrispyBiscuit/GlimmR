import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { App as AntApp } from 'antd'
import { api, bridge } from './api'
import type {
  Album,
  AppSettings,
  FolderNode,
  JobProgress,
  KeywordNode,
  Photo,
  PhotoUpdate,
  Root,
  Scope,
  SmartAlbum,
  SortSpec
} from '../../shared/types'

export type View = 'rediscover' | 'browse'

export interface ViewerState {
  ids: number[]
  index: number
  slideshow: boolean
}

function useStoreValue() {
  const { message } = AntApp.useApp()
  const [settings, setSettingsState] = useState<AppSettings | null>(null)
  const [view, setView] = useState<View>('rediscover')
  const [scope, setScopeState] = useState<Scope>({ type: 'all' })
  const [title, setTitle] = useState('All photos')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortSpec>({ field: 'default', dir: 'desc' })
  const [ids, setIds] = useState<number[]>([])
  const [total, setTotal] = useState(0)
  const [searchError, setSearchError] = useState<string | undefined>()
  const [tookMs, setTookMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const cache = useRef(new Map<number, Photo>())
  const [cacheVersion, setCacheVersion] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [focusIndex, setFocusIndex] = useState(-1)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [roots, setRoots] = useState<Root[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [smartAlbums, setSmartAlbums] = useState<SmartAlbum[]>([])
  const [keywords, setKeywords] = useState<KeywordNode[]>([])
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [jobs, setJobs] = useState<Record<string, JobProgress>>({})
  const [libraryVersion, setLibraryVersion] = useState(0)
  // Bumped on catalog edits: refreshes facet counts without re-running (and re-sorting) the search.
  const [editVersion, setEditVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(true)

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
    void refreshSidebar()
    const offJob = bridge().onJob((p) => {
      setJobs((j) => {
        const next = { ...j, [p.id]: p }
        if (p.finished) delete next[p.id]
        return next
      })
      if (p.finished) {
        // Jobs can change settings in the main process (e.g. last backup time).
        void api.getSettings().then(setSettingsState)
        if (p.error) message.error(`${p.label}: ${p.error}`, 6)
        else if (p.kind !== 'scan' || (p.message && !p.message.startsWith('0 new, 0 updated'))) message.success(`${p.label}: ${p.message ?? 'done'}`)
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
      offJob()
      offLib()
    }
  }, [refreshSidebar, message])

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

  const search = useCallback((q: string) => {
    setQuery(q)
    setView('browse')
  }, [])

  const refreshResults = useCallback(() => setLibraryVersion((v) => v + 1), [])

  const setSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettingsState(await api.setSettings(patch))
  }, [])

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
      if (!r.ok) message.warning(r.message ?? 'Could not open the editor')
      else message.info(`Opening ${targetIds.length === 1 ? 'photo' : `${targetIds.length} photos`}…`, 1.5)
    },
    [message]
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
    roots,
    albums,
    smartAlbums,
    keywords,
    folders,
    refreshSidebar,
    jobs,
    libraryVersion,
    editVersion,
    refreshResults,
    updatePhotos,
    openEditor,
    settingsOpen,
    setSettingsOpen,
    filtersOpen,
    setFiltersOpen
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
