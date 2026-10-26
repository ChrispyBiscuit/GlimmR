// Types shared by the main process, preload and renderer.

export type Flag = 'pick' | 'reject' | null
export type ColorLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | null

export const COLOR_LABELS: Exclude<ColorLabel, null>[] = ['red', 'yellow', 'green', 'blue', 'purple']

export interface Photo {
  id: number
  rootId: number
  relPath: string
  path: string
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
}

export interface PhotoDetail extends Photo {
  keywords: string[]
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

export interface AppSettings {
  theme: 'dark' | 'light' | 'system'
  thumbSize: number
  autoAdvance: boolean
  editors: EditorSettings
  backup: BackupSettings
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
  kind: 'scan' | 'backup' | 'restore' | 'xmp'
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
