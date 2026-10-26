import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import type { Photo } from '../shared/types'

export const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES roots(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  folder TEXT NOT NULL,
  filename TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  taken_at INTEGER,
  -- Local calendar day taken (YYYY-MM-DD), computed at scan time; much faster than strftime(..., 'localtime').
  taken_day TEXT,
  width INTEGER,
  height INTEGER,
  orientation TEXT,
  exif_orientation INTEGER NOT NULL DEFAULT 1,
  make TEXT,
  model TEXT,
  lens TEXT,
  focal REAL,
  aperture REAL,
  shutter REAL,
  iso REAL,
  lat REAL,
  lon REAL,
  rating INTEGER NOT NULL DEFAULT 0,
  flag TEXT,
  label TEXT,
  title TEXT,
  caption TEXT,
  creator TEXT,
  offline INTEGER NOT NULL DEFAULT 0,
  has_preview INTEGER NOT NULL DEFAULT 0,
  UNIQUE (root_id, rel_path)
);
CREATE INDEX IF NOT EXISTS photos_taken ON photos(taken_at);
CREATE INDEX IF NOT EXISTS photos_day ON photos(taken_day);
CREATE INDEX IF NOT EXISTS photos_added ON photos(added_at);
CREATE INDEX IF NOT EXISTS photos_folder ON photos(root_id, folder);
CREATE INDEX IF NOT EXISTS photos_model ON photos(model);
CREATE INDEX IF NOT EXISTS photos_lens ON photos(lens);
CREATE INDEX IF NOT EXISTS photos_rating ON photos(rating);

CREATE TABLE IF NOT EXISTS metadata (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  key TEXT NOT NULL COLLATE NOCASE,
  value TEXT NOT NULL,
  num REAL
);
CREATE INDEX IF NOT EXISTS metadata_photo ON metadata(photo_id);
CREATE INDEX IF NOT EXISTS metadata_key_num ON metadata(key, num);
CREATE INDEX IF NOT EXISTS metadata_key_value ON metadata(key, value);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS photo_keywords (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, keyword_id)
);
CREATE INDEX IF NOT EXISTS photo_keywords_kw ON photo_keywords(keyword_id);

CREATE TABLE IF NOT EXISTS albums (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS album_photos (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, photo_id)
);
CREATE INDEX IF NOT EXISTS album_photos_photo ON album_photos(photo_id);

CREATE TABLE IF NOT EXISTS smart_albums (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  sort_field TEXT NOT NULL,
  sort_dir TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS photos_fts USING fts5(
  body,
  content = '',
  contentless_delete = 1,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3'
);
`

export type Db = DatabaseSync

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
  db.exec(SCHEMA)
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  return db
}

/** Local calendar day for an epoch-ms time, as YYYY-MM-DD. */
export function localDay(ms: number | null): string | null {
  if (ms == null) return null
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/** Columns selected for a Photo, joined with its root. */
export const PHOTO_COLUMNS = `p.id, p.root_id, p.rel_path, p.filename, p.ext, p.kind, p.size, p.mtime, p.added_at,
  p.taken_at, p.width, p.height, p.orientation, p.make, p.model, p.lens, p.focal, p.aperture, p.shutter, p.iso,
  p.lat, p.lon, p.rating, p.flag, p.label, p.title, p.caption, p.creator, p.offline, p.has_preview,
  r.path AS root_path`

export function rowToPhoto(r: Record<string, any>): Photo {
  return {
    id: r.id,
    rootId: r.root_id,
    relPath: r.rel_path,
    path: path.join(r.root_path, ...String(r.rel_path).split('/')),
    filename: r.filename,
    ext: r.ext,
    kind: r.kind,
    size: r.size,
    mtime: r.mtime,
    addedAt: r.added_at,
    takenAt: r.taken_at,
    width: r.width,
    height: r.height,
    orientation: r.orientation,
    make: r.make,
    model: r.model,
    lens: r.lens,
    focal: r.focal,
    aperture: r.aperture,
    shutter: r.shutter,
    iso: r.iso,
    lat: r.lat,
    lon: r.lon,
    rating: r.rating,
    flag: r.flag,
    label: r.label,
    title: r.title,
    caption: r.caption,
    creator: r.creator,
    offline: !!r.offline,
    hasPreview: !!r.has_preview
  }
}

export function getPhotos(db: Db, ids: number[]): Photo[] {
  if (!ids.length) return []
  const out = new Map<number, Photo>()
  // SQLite limits bound parameters; chunk large id lists.
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = db
      .prepare(`SELECT ${PHOTO_COLUMNS} FROM photos p JOIN roots r ON r.id = p.root_id WHERE p.id IN (${chunk.map(() => '?').join(',')})`)
      .all(...chunk) as Record<string, any>[]
    for (const r of rows) out.set(r.id, rowToPhoto(r))
  }
  return ids.map((id) => out.get(id)).filter((p): p is Photo => !!p)
}

/** Normalizes Lightroom-style `A|B|C` and `A > B` keyword paths to `A>B>C`. */
export function normalizeKeyword(k: string): string {
  return k
    .split(/[|>]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('>')
}

export function keywordId(db: Db, kwPath: string): number {
  const existing = db.prepare('SELECT id FROM keywords WHERE path = ?').get(kwPath) as { id: number } | undefined
  if (existing) return existing.id
  return Number(db.prepare('INSERT INTO keywords (path) VALUES (?)').run(kwPath).lastInsertRowid)
}

export function getKeywords(db: Db, photoId: number): string[] {
  return (
    db
      .prepare('SELECT k.path FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id WHERE pk.photo_id = ? ORDER BY k.path')
      .all(photoId) as { path: string }[]
  ).map((r) => r.path)
}

/** Rebuilds the full-text row for a photo from its columns, keywords and metadata values. */
export function reindexFts(db: Db, photoId: number): void {
  const p = db
    .prepare(
      `SELECT p.rel_path, p.filename, p.make, p.model, p.lens, p.title, p.caption, p.creator, p.flag, p.label, r.name AS root_name
       FROM photos p JOIN roots r ON r.id = p.root_id WHERE p.id = ?`
    )
    .get(photoId) as Record<string, string | null> | undefined
  db.prepare('DELETE FROM photos_fts WHERE rowid = ?').run(photoId)
  if (!p) return
  const parts: string[] = [p.rel_path!.replace(/[/\\._-]/g, ' '), p.filename!, p.root_name!]
  for (const k of ['make', 'model', 'lens', 'title', 'caption', 'creator', 'flag', 'label']) if (p[k]) parts.push(p[k]!)
  parts.push(...getKeywords(db, photoId).map((k) => k.replace(/>/g, ' ')))
  const albums = db
    .prepare('SELECT a.name FROM album_photos ap JOIN albums a ON a.id = ap.album_id WHERE ap.photo_id = ?')
    .all(photoId) as { name: string }[]
  parts.push(...albums.map((a) => a.name))
  const meta = db.prepare('SELECT value FROM metadata WHERE photo_id = ? AND num IS NULL').all(photoId) as { value: string }[]
  for (const m of meta) if (m.value.length <= 200) parts.push(m.value)
  db.prepare('INSERT INTO photos_fts (rowid, body) VALUES (?, ?)').run(photoId, parts.join(' \n '))
}
