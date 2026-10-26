// The API the main process exposes to the renderer (see src/main/api.ts and src/preload/index.ts).

import type {
  Album,
  AppSettings,
  BackupEntry,
  Editor,
  Facets,
  FolderNode,
  JobProgress,
  KeywordNode,
  LibraryStats,
  Photo,
  PhotoDetail,
  PhotoUpdate,
  RestorePlan,
  Root,
  Scope,
  SearchRequest,
  SearchResult,
  SmartAlbum,
  Suggestion
} from './types'

export interface Api {
  // library folders
  listRoots(): Root[]
  /** Adds a folder; asks with a dialog when no path is given. */
  addRoot(dir?: string): Promise<Root | null>
  removeRoot(id: number): void
  relinkRoot(id: number): Promise<boolean>
  rescan(rootId?: number, reimport?: boolean): void
  cancelJob(id: string): void

  // search
  search(req: SearchRequest): SearchResult
  facets(scope: Scope, query: string): Facets
  suggest(input: string): Suggestion[]
  photos(ids: number[]): Photo[]
  detail(id: number): PhotoDetail | null
  sortFields(): { value: string; label: string }[]

  // organize
  update(ids: number[], u: PhotoUpdate): Photo[]
  writeXmp(ids: number[] | 'all'): void
  albums(): Album[]
  createAlbum(name: string, photoIds?: number[]): number
  renameAlbum(id: number, name: string): void
  deleteAlbum(id: number): void
  addToAlbum(id: number, photoIds: number[]): void
  removeFromAlbum(id: number, photoIds: number[]): void
  smartAlbums(): SmartAlbum[]
  saveSmartAlbum(s: Omit<SmartAlbum, 'id'> & { id?: number }): number
  deleteSmartAlbum(id: number): void
  keywordTree(): KeywordNode[]
  renameKeyword(from: string, to: string): void
  deleteKeyword(path: string): void
  folderTree(): FolderNode[]

  // rediscover
  stats(): LibraryStats
  onThisDay(): { year: number; photos: Photo[] }[]
  highlights(limit?: number): Photo[]
  shuffle(limit?: number): Photo[]
  recentlyAdded(limit?: number): Photo[]
  lookBack(): { label: string; query: string; photos: Photo[] } | null

  // external apps
  openInEditor(ids: number[], editorId?: string): { ok: boolean; message?: string }
  openWithDefault(id: number): void
  reveal(id: number): void
  detectEditors(): Editor[]
  addCustomEditor(): Promise<Editor | null>

  // settings
  getSettings(): AppSettings
  setSettings(patch: Partial<AppSettings>): AppSettings

  // backup
  chooseBackupFolder(): Promise<string | null>
  backupNow(): void
  listBackups(): Promise<BackupEntry[]>
  chooseBackupToRestore(): Promise<BackupEntry | null>
  verifyBackup(path: string): Promise<{ ok: boolean; problems: string[] }>
  restorePreview(path: string): { roots: { id: number; name: string; path: string; exists: boolean; mirror: string | null }[] }
  chooseFolder(title: string): Promise<string | null>
  restore(plan: RestorePlan): Promise<void>
  appVersion(): string
  platform(): string
}

export type ApiMethod = keyof Api

export interface Bridge {
  call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<Awaited<ReturnType<Api[M]>>>
  onJob(cb: (p: JobProgress) => void): () => void
  onLibraryChanged(cb: () => void): () => void
  /** Absolute path of a file or folder dropped onto the window. */
  pathForFile(file: File): string
}
