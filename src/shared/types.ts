import type { PhotoEdit } from './edit'
import type { PrintPreset, PrintSettings } from './print'

// Types shared by the main process, preload and renderer.

export type Flag = 'pick' | 'reject' | null
export type ColorLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | null

export const COLOR_LABELS: Exclude<ColorLabel, null>[] = ['red', 'yellow', 'green', 'blue', 'purple']

export interface Photo {
  id: number
  rootId: number
  relPath: string
  /** The main file: the RAW of a RAW + JPEG pair. */
  path: string
  /** The camera JPEG (or HEIF) paired with a RAW, in the same folder: what's displayed. Null for single files. */
  companion: string | null
  filename: string
  ext: string
  kind: 'raw' | 'image'
  size: number
  mtime: number
  addedAt: number
  takenAt: number | null
  width: number | null
  height: number | null
  orientation: 'landscape' | 'portrait' | 'square' | null
  make: string | null
  model: string | null
  lens: string | null
  focal: number | null
  aperture: number | null
  shutter: number | null
  iso: number | null
  lat: number | null
  lon: number | null
  rating: number
  flag: Flag
  label: ColorLabel
  title: string | null
  caption: string | null
  creator: string | null
  offline: boolean
  hasPreview: boolean
  /** Non-destructive rotation and crop, if any. */
  edit: PhotoEdit | null
  /** Changes whenever the file or its edit does; used to refresh cached images. */
  rev: number
}

export interface PhotoDetail extends Photo {
  keywords: string[]
  /** Smart tags found on this computer, best first. */
  smartTags: SmartTag[]
  albums: { id: number; name: string }[]
  metadata: { key: string; value: string }[]
}

export interface Root {
  id: number
  path: string
  name: string
  count: number
  online: boolean
}

export interface Album {
  id: number
  name: string
  count: number
  coverId: number | null
}

export interface SmartAlbum {
  id: number
  name: string
  query: string
  sort: SortSpec
}

export interface KeywordNode {
  id: number
  name: string
  path: string
  count: number
  children: KeywordNode[]
}

/** A folder inside a library folder: `rel` is its `/`-separated path there ('' is the library folder itself). */
export interface FolderRef {
  rootId: number
  rel: string
}

export type ConflictChoice = 'skip' | 'keep' | 'replace'

export interface FileOpResult {
  done: number
  skipped: number
  failed: number
  error?: string
  /** Where a folder ended up, for folder operations. */
  ref?: FolderRef
}

export interface FolderNode {
  key: string
  rootId: number
  relPath: string
  name: string
  count: number
  children: FolderNode[]
}

export interface SortSpec {
  field: string
  dir: 'asc' | 'desc'
}

/** Where the result set comes from, in addition to the search query. */
export type Scope =
  | { type: 'all' }
  | { type: 'album'; id: number }
  | { type: 'smart'; id: number }
  | { type: 'folder'; rootId: number; relPath: string }
  | { type: 'keyword'; path: string }
  | { type: 'picks' }
  | { type: 'recent' }
  | { type: 'import'; id: number }

export interface SearchRequest {
  scope: Scope
  query: string
  sort: SortSpec
  offset: number
  limit: number
}

export interface SearchResult {
  total: number
  ids: number[]
  /** width / height for every id, for laying out justified rows without loading each photo. */
  aspects: number[]
  /** Local day taken (YYYY-MM-DD) for every id, for date sections and the year scrubber. */
  days: (string | null)[]
  photos: Photo[]
  error?: string
  tookMs: number
}

export interface FacetValue {
  value: string
  label: string
  count: number
}

export interface Facets {
  year: FacetValue[]
  camera: FacetValue[]
  lens: FacetValue[]
  keyword: FacetValue[]
  type: FacetValue[]
  rating: FacetValue[]
  flag: FacetValue[]
  label: FacetValue[]
  orientation: FacetValue[]
  ranges: { iso: [number, number] | null; focal: [number, number] | null; aperture: [number, number] | null }
}

export interface Suggestion {
  value: string
  label: string
  count?: number
  kind: 'field' | 'value'
}

export interface Editor {
  id: string
  name: string
  path: string
  args: string[]
  detected: boolean
}

export interface EditorSettings {
  editors: Editor[]
  defaultEditor: string | null
  /** ext without dot (or 'raw') → editor id */
  perType: Record<string, string>
}

export interface BackupSettings {
  destination: string | null
  schedule: 'off' | 'onQuit' | 'daily' | 'weekly'
  keep: number
  includeOriginals: boolean
  lastBackupAt: number | null
}

export interface UpdateStatus {
  /** manual: an update exists but can't be installed in place (e.g. an unsigned macOS build); download it from the release page. */
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'manual' | 'dev'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
  releaseUrl?: string
  checkedAt?: number
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  /** Download updates in the background as soon as they're published. */
  autoUpdate: boolean
  thumbSize: number
  autoAdvance: boolean
  editors: EditorSettings
  backup: BackupSettings
  smartTags: { enabled: boolean }
  /** Last-used print settings and saved presets. */
  print: { last: Partial<PrintSettings>; presets: PrintPreset[] }
  import: ImportSettings
}

export interface ImportSettings {
  /** What happens when a camera card is inserted. */
  onCard: 'off' | 'ask' | 'open'
  /** Library folder imports go into (the first one when unset). */
  rootId: number | null
  /** Folder template, e.g. {YYYY}/{YYYY-MM-DD} {event}. */
  template: string
  copyVideos: boolean
  /** The most recent import, for the Last import view. */
  lastImportId: number | null
}

/** A mounted drive; `dcim` marks a camera card. */
export interface Volume {
  path: string
  name: string
  dcim: boolean
}

/** One photo on a card: a file, or a RAW + JPEG pair, with its sidecars. */
export interface ImportItem {
  /** The main file's path on the card. */
  key: string
  /** Position in the source's list (sorted by capture time), used for its thumbnail. */
  index: number
  name: string
  companion: string | null
  ext: string
  raw: boolean
  /** Bytes of every file of the photo. */
  size: number
  fileCount: number
  takenAt: number | null
  camera: string
  /** Already in the library or copied by an earlier import. */
  already: boolean
}

export interface ImportSource {
  token: string
  label: string
  path: string
  items: ImportItem[]
  videos: number
  videoBytes: number
}

export interface ImportOptions {
  keys: string[]
  rootId: number
  template: string
  event: string
  copyVideos: boolean
}

/** Marks made while culling on the card, applied to the imported photos. */
export type ImportMarks = Record<string, { flag?: Flag; rating?: number; label?: ColorLabel }>

export interface ImportResult {
  importId: number
  imported: number
  /** Already at the destination with the same content. */
  skipped: number
  failed: number
  videos: number
  errors: string[]
  /** Folders (inside the library folder) that received photos. */
  folders: string[]
}

export interface IccProfile {
  path: string
  name: string
  /** ICC device class: printer (paper) profiles, colour spaces, displays. */
  kind: 'printer' | 'space' | 'display' | 'other'
  space: 'RGB' | 'CMYK'
  /** Installed with the system or a printer driver, or added in Glimmr. */
  source: 'system' | 'added'
}

export interface PrinterInfo {
  /** The system name, used to print. */
  name: string
  displayName: string
  description: string
  isDefault: boolean
  state: 'ready' | 'busy' | 'stopped' | 'unknown'
  location: string
  model: string
}

/** One setting a printer's own driver offers (CUPS), such as its paper source, media type or print quality. */
export interface DriverOption {
  /** The driver's keyword, e.g. InputSlot. */
  key: string
  label: string
  /** Where the print window shows it. */
  group: 'source' | 'media' | 'quality' | 'other'
  choices: { value: string; label: string }[]
  /** The printer's own default choice. */
  defaultValue: string
}

/**
 * What Glimmr can set on a printer. On macOS and Linux every driver (Epson, Canon, HP, Brother and the rest) lists its
 * options through CUPS, so they're shown in the print window. On Windows the driver's own Printing Preferences window
 * holds them, and silent prints use whatever is chosen there.
 */
export interface DriverInfo {
  kind: 'cups' | 'windows' | 'none'
  printer: string | null
  options: DriverOption[]
  /** The driver's page size keywords. */
  pageSizes: string[]
}

/** Per-channel counts in 256 bins, from the image as shown (edits applied). */
export interface Histogram {
  r: number[]
  g: number[]
  b: number[]
  /** Luminance (Rec. 709). */
  l: number[]
  /** Share of pixels with any channel at 0 / at 255. */
  shadowClip: number
  highlightClip: number
  /** Mean luminance, 0–255. */
  mean: number
}

export interface SmartTag {
  tag: string
  /** subject, scene, event or attribute */
  group: string
  score: number
}

export interface SmartTagStatus {
  enabled: boolean
  /** The model is downloaded and verified. */
  installed: boolean
  /** Download size of the model, in bytes. */
  modelSize: number
  tagged: number
  total: number
}

export interface BackupManifest {
  app: 'GlimmR'
  formatVersion: 1
  appVersion: string
  createdAt: number
  photoCount: number
  roots: { id: number; path: string; name: string }[]
  files: { path: string; size: number; sha256: string }[]
  originals: { included: boolean; fileCount: number; bytes: number }
}

export interface BackupEntry {
  path: string
  manifest: BackupManifest
}

export interface RestorePlan {
  backupPath: string
  /** rootId → new path (or the same path to keep) */
  rootMap: Record<number, string>
}

export interface JobProgress {
  id: string
  kind: 'scan' | 'backup' | 'restore' | 'xmp' | 'model' | 'tags' | 'print' | 'files' | 'import'
  label: string
  done: number
  total: number
  finished: boolean
  error?: string
  message?: string
}

export interface LibraryStats {
  photos: number
  raw: number
  years: number
  firstYear: number | null
  lastYear: number | null
  cameras: number
  topCamera: string | null
  topLens: string | null
  rated: number
  picks: number
  bytes: number
}

export interface PhotoUpdate {
  rating?: number
  flag?: Flag
  label?: ColorLabel
  title?: string | null
  caption?: string | null
  addKeywords?: string[]
  removeKeywords?: string[]
}
