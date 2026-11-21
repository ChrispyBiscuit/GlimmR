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
  Histogram,
  ConflictChoice,
  FileOpResult,
  FolderRef,
  IccProfile,
  PrinterInfo,
  DriverInfo,
  SmartAlbum,
  SmartTagStatus,
  Suggestion,
  UpdateStatus
} from './types'
import type { PhotoEdit } from './edit'
import type { Layout, Placement, PrintSettings } from './print'

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
  updateStatus(): UpdateStatus
  checkForUpdates(): void
  downloadUpdate(): void
  installUpdate(): void
  openReleasePage(): void
  platform(): string
  /** Recolours the native window buttons (Windows/Linux) to match the app's top bar. */
  setTitleBarTheme(theme: 'dark' | 'light'): void

  /** Saves a photo's non-destructive rotate/crop (null resets it), re-renders its previews and returns it. */
  setEdit(id: number, edit: PhotoEdit | null): Promise<Photo | null>
  /** Turns photos a quarter clockwise (1) or anticlockwise (-1). */
  rotatePhotos(ids: number[], dir: 1 | -1): Promise<void>
  histogram(id: number): Promise<Histogram | null>

  /** Moves photos (and sidecars only they use) to the system trash and removes them from the catalog. */
  trashPhotos(ids: number[], part?: 'all' | 'raw' | 'jpeg'): Promise<{ trashed: number; failed: number; error?: string }>

  // folder management (moves happen on disk and in the catalog together)
  /** Photos whose files would clash with files already in the folder. */
  folderConflicts(ids: number[], target: FolderRef): { id: number; name: string }[]
  /** Moves or copies photos (with their RAW + JPEG pair and sidecars) into a folder. */
  putInFolder(ids: number[], target: FolderRef, opts: { copy: boolean; onConflict: ConflictChoice }): Promise<FileOpResult>
  createFolder(parent: FolderRef, name: string): Promise<FileOpResult>
  renameFolder(folder: FolderRef, name: string): Promise<FileOpResult>
  /** Moves or copies a folder, with everything in it, into another folder. */
  moveFolder(folder: FolderRef, into: FolderRef, copy: boolean): Promise<FileOpResult>
  folderStats(folder: FolderRef): { photos: number; files: number; bytes: number }
  /** Sends a folder and everything in it to the system trash. */
  deleteFolder(folder: FolderRef): Promise<FileOpResult>
  revealFolder(folder: FolderRef): void
  /** Whether two library folders are on the same drive (moves between drives copy by default). */
  sameDrive(a: number, b: number): boolean

  // printing
  printers(): Promise<PrinterInfo[]>
  printProfiles(): Promise<IccProfile[]>
  /** Adds an ICC profile (chosen in a dialog) to Glimmr's own profiles. */
  addPrintProfile(): Promise<IccProfile | null>
  removePrintProfile(path: string): Promise<void>
  /** One page of the print preview, each photo rendered at screen resolution (soft-proofed if asked). */
  printPreview(req: PrintJobRequest, page: number, pxPerInch: number): Promise<{ layout: Layout; cells: { src: string; ppi: number; lowRes: boolean }[] }>
  /** Prints, or saves a PDF or image files, as the settings say. Runs as a job with progress. */
  print(req: PrintJobRequest): Promise<{ ok: boolean; message: string; files?: string[] }>
  openPrinterSettings(): void
  /** The printer's own driver settings (tray, media type, quality…). Null means the default printer. */
  printerOptions(printer: string | null): Promise<DriverInfo>
  /** Windows: opens the driver's Printing Preferences window (Epson, Canon, HP…). */
  printerPreferences(printer: string): void
  showFile(path: string): void
  displayColor(): { colorSpace: string; colorDepth: number }

  // smart tags
  smartTagStatus(): SmartTagStatus
  /** Turns smart tags on, downloading the model first if needed, then tags the library in the background. */
  enableSmartTags(): void
  disableSmartTags(): void
  /** Turns smart tags off and deletes the model and every smart tag. */
  removeSmartTags(): void
  hideSmartTag(photoId: number, tag: string): void
}

export interface PrintJobRequest {
  settings: Partial<PrintSettings>
  photoIds: number[]
  placements?: Record<number, Placement>
  /** Print the calibration chart instead of photos. */
  chart?: boolean
}

export type ApiMethod = keyof Api

export interface Bridge {
  call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<Awaited<ReturnType<Api[M]>>>
  onJob(cb: (p: JobProgress) => void): () => void
  onLibraryChanged(cb: () => void): () => void
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  /** Absolute path of a file or folder dropped onto the window. */
  pathForFile(file: File): string
}
