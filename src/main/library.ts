// Catalog operations used by the IPC layer: search, organization, rediscovery and settings.

import fs from 'node:fs'
import path from 'node:path'
import { type Db, getPhotos, getKeywords, keywordId, normalizeKeyword, reindexFts, tx, PHOTO_COLUMNS, rowToPhoto } from './db'
import { buildWhere, computeFacets, orderBy, suggest } from './query'
import { writeSidecar } from './xmp'
import type {
  Album,
  AppSettings,
  Facets,
  FolderNode,
  KeywordNode,
  LibraryStats,
  Photo,
  PhotoDetail,
  PhotoUpdate,
  Root,
  Scope,
  SearchRequest,
  SearchResult,
  SmartAlbum,
  SortSpec,
  Suggestion
} from '../shared/types'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  thumbSize: 220,
  autoAdvance: false,
  editors: { editors: [], defaultEditor: null, perType: {} },
  backup: { destination: null, schedule: 'off', keep: 10, includeOriginals: false, lastBackupAt: null }
}

export class Library {
  constructor(
    readonly db: Db,
    readonly cacheDir: string
  ) {}

  // ---- settings ----

  getSettings(): AppSettings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined
    const saved = row ? (JSON.parse(row.value) as Partial<AppSettings>) : {}
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      editors: { ...DEFAULT_SETTINGS.editors, ...saved.editors },
      backup: { ...DEFAULT_SETTINGS.backup, ...saved.backup }
    }
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...patch }
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(next))
    return next
  }

  // ---- roots ----

  listRoots(): Root[] {
    const rows = this.db
      .prepare('SELECT r.id, r.path, r.name, (SELECT COUNT(*) FROM photos p WHERE p.root_id = r.id) AS count FROM roots r ORDER BY r.name COLLATE NOCASE')
      .all() as { id: number; path: string; name: string; count: number }[]
    return rows.map((r) => ({ ...r, online: fs.existsSync(r.path) }))
  }

  addRoot(dir: string): Root {
    const abs = path.resolve(dir)
    for (const r of this.listRoots()) {
      const rel = path.relative(r.path, abs)
      if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error(`"${abs}" is already inside library folder "${r.path}"`)
    }
    const id = Number(
      this.db.prepare('INSERT INTO roots (path, name, created_at) VALUES (?, ?, ?)').run(abs, path.basename(abs) || abs, Date.now()).lastInsertRowid
    )
    return this.listRoots().find((r) => r.id === id)!
  }

  removeRoot(id: number): void {
    const ids = (this.db.prepare('SELECT id FROM photos WHERE root_id = ?').all(id) as { id: number }[]).map((r) => r.id)
    tx(this.db, () => {
      const del = this.db.prepare('DELETE FROM photos_fts WHERE rowid = ?')
      for (const pid of ids) del.run(pid)
      this.db.prepare('DELETE FROM roots WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM keywords WHERE id NOT IN (SELECT keyword_id FROM photo_keywords)').run()
    })
  }

  relinkRoot(id: number, newPath: string): void {
    this.db.prepare('UPDATE roots SET path = ? WHERE id = ?').run(path.resolve(newPath), id)
    this.db.prepare('UPDATE photos SET offline = 0 WHERE root_id = ?').run(id)
  }

  // ---- search ----

  search(req: SearchRequest): SearchResult {
    const t0 = performance.now()
    const where = buildWhere(this.db, req.scope, req.query)
    let sort: SortSpec = req.sort
    if (req.scope.type === 'smart') {
      const s = this.db.prepare('SELECT sort_field, sort_dir FROM smart_albums WHERE id = ?').get(req.scope.id) as any
      if (s && req.sort.field === 'default') sort = { field: s.sort_field, dir: s.sort_dir }
    }
    if (sort.field === 'default') sort = { field: 'taken', dir: 'desc' }
    const ob = orderBy(sort, req.scope)
    try {
      const ids = (
        this.db
          .prepare(`SELECT p.id FROM photos p ${where.join} WHERE ${where.sql} ${ob.sql}`)
          .all(...where.params, ...ob.params) as { id: number }[]
      ).map((r) => r.id)
      const page = ids.slice(req.offset, req.offset + req.limit)
      return { total: ids.length, ids, photos: getPhotos(this.db, page), error: where.error, tookMs: Math.round(performance.now() - t0) }
    } catch (e) {
      return { total: 0, ids: [], photos: [], error: `Search error: ${(e as Error).message}`, tookMs: 0 }
    }
  }

  facets(scope: Scope, query: string): Facets {
    return computeFacets(this.db, buildWhere(this.db, scope, query))
  }

  suggest(input: string): Suggestion[] {
    return suggest(this.db, input)
  }

  photos(ids: number[]): Photo[] {
    return getPhotos(this.db, ids)
  }

  detail(id: number): PhotoDetail | null {
    const [p] = getPhotos(this.db, [id])
    if (!p) return null
    const metadata = this.db.prepare('SELECT key, value FROM metadata WHERE photo_id = ? ORDER BY rowid').all(id) as { key: string; value: string }[]
    const albums = this.db
      .prepare('SELECT a.id, a.name FROM album_photos ap JOIN albums a ON a.id = ap.album_id WHERE ap.photo_id = ? ORDER BY a.name')
      .all(id) as { id: number; name: string }[]
    return { ...p, keywords: getKeywords(this.db, id), albums, metadata }
  }

  // ---- editing catalog metadata ----

  update(ids: number[], u: PhotoUpdate): Photo[] {
    tx(this.db, () => {
      for (const id of ids) {
        const sets: string[] = []
        const params: (string | number | null)[] = []
        const set = (col: string, v: string | number | null): void => {
          sets.push(`${col} = ?`)
          params.push(v)
        }
        if (u.rating !== undefined) set('rating', Math.max(0, Math.min(5, Math.round(u.rating))))
        if (u.flag !== undefined) set('flag', u.flag)
        if (u.label !== undefined) set('label', u.label)
        if (u.title !== undefined) set('title', u.title || null)
        if (u.caption !== undefined) set('caption', u.caption || null)
        if (sets.length) this.db.prepare(`UPDATE photos SET ${sets.join(', ')} WHERE id = ?`).run(...params, id)
        for (const k of u.addKeywords ?? []) {
          const kw = normalizeKeyword(k)
          if (kw) this.db.prepare('INSERT OR IGNORE INTO photo_keywords (photo_id, keyword_id) VALUES (?, ?)').run(id, keywordId(this.db, kw))
        }
        for (const k of u.removeKeywords ?? [])
          this.db.prepare('DELETE FROM photo_keywords WHERE photo_id = ? AND keyword_id = (SELECT id FROM keywords WHERE path = ?)').run(id, normalizeKeyword(k))
        reindexFts(this.db, id)
      }
      if (u.removeKeywords?.length) this.db.prepare('DELETE FROM keywords WHERE id NOT IN (SELECT keyword_id FROM photo_keywords)').run()
    })
    return getPhotos(this.db, ids)
  }

  async writeXmp(ids: number[], onProgress?: (done: number, total: number) => void): Promise<{ written: number; failed: number }> {
    let written = 0
    let failed = 0
    for (const [i, p] of getPhotos(this.db, ids).entries()) {
      try {
        if (p.offline) throw new Error('offline')
        const side = await writeSidecar(p.path, {
          rating: p.rating,
          flag: p.flag,
          label: p.label,
          keywords: getKeywords(this.db, p.id),
          title: p.title,
          caption: p.caption
        })
        // Record the new sidecar time so the next scan does not treat the photo as changed.
        const mtime = Math.max(Math.floor(fs.statSync(p.path).mtimeMs), Math.floor(fs.statSync(side).mtimeMs))
        this.db.prepare('UPDATE photos SET mtime = ? WHERE id = ?').run(mtime, p.id)
        written++
      } catch {
        failed++
      }
      onProgress?.(i + 1, ids.length)
    }
    return { written, failed }
  }

  allIds(): number[] {
    return (this.db.prepare('SELECT id FROM photos WHERE offline = 0').all() as { id: number }[]).map((r) => r.id)
  }

  // ---- albums ----

  albums(): Album[] {
    return this.db
      .prepare(
        `SELECT a.id, a.name, COUNT(ap.photo_id) AS count,
          (SELECT ap2.photo_id FROM album_photos ap2 WHERE ap2.album_id = a.id ORDER BY ap2.added_at LIMIT 1) AS coverId
         FROM albums a LEFT JOIN album_photos ap ON ap.album_id = a.id GROUP BY a.id ORDER BY a.name COLLATE NOCASE`
      )
      .all() as unknown as Album[]
  }

  createAlbum(name: string, photoIds: number[] = []): number {
    const id = Number(this.db.prepare('INSERT INTO albums (name, created_at) VALUES (?, ?)').run(name.trim() || 'Untitled album', Date.now()).lastInsertRowid)
    if (photoIds.length) this.addToAlbum(id, photoIds)
    return id
  }

  renameAlbum(id: number, name: string): void {
    this.db.prepare('UPDATE albums SET name = ? WHERE id = ?').run(name.trim(), id)
    this.reindexAlbum(id)
  }

  deleteAlbum(id: number): void {
    const ids = this.albumPhotoIds(id)
    this.db.prepare('DELETE FROM albums WHERE id = ?').run(id)
    tx(this.db, () => ids.forEach((pid) => reindexFts(this.db, pid)))
  }

  addToAlbum(id: number, photoIds: number[]): void {
    const now = Date.now()
    tx(this.db, () => {
      const ins = this.db.prepare('INSERT OR IGNORE INTO album_photos (album_id, photo_id, added_at) VALUES (?, ?, ?)')
      photoIds.forEach((pid, i) => {
        ins.run(id, pid, now + i)
        reindexFts(this.db, pid)
      })
    })
  }

  removeFromAlbum(id: number, photoIds: number[]): void {
    tx(this.db, () => {
      const del = this.db.prepare('DELETE FROM album_photos WHERE album_id = ? AND photo_id = ?')
      for (const pid of photoIds) {
        del.run(id, pid)
        reindexFts(this.db, pid)
      }
    })
  }

  private albumPhotoIds(id: number): number[] {
    return (this.db.prepare('SELECT photo_id FROM album_photos WHERE album_id = ?').all(id) as { photo_id: number }[]).map((r) => r.photo_id)
  }

  private reindexAlbum(id: number): void {
    tx(this.db, () => this.albumPhotoIds(id).forEach((pid) => reindexFts(this.db, pid)))
  }

  // ---- smart albums ----

  smartAlbums(): SmartAlbum[] {
    return (this.db.prepare('SELECT id, name, query, sort_field, sort_dir FROM smart_albums ORDER BY name COLLATE NOCASE').all() as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      query: r.query,
      sort: { field: r.sort_field, dir: r.sort_dir }
    }))
  }

  saveSmartAlbum(s: Omit<SmartAlbum, 'id'> & { id?: number }): number {
    if (s.id) {
      this.db.prepare('UPDATE smart_albums SET name = ?, query = ?, sort_field = ?, sort_dir = ? WHERE id = ?').run(s.name, s.query, s.sort.field, s.sort.dir, s.id)
      return s.id
    }
    return Number(
      this.db.prepare('INSERT INTO smart_albums (name, query, sort_field, sort_dir) VALUES (?, ?, ?, ?)').run(s.name, s.query, s.sort.field, s.sort.dir).lastInsertRowid
    )
  }

  deleteSmartAlbum(id: number): void {
    this.db.prepare('DELETE FROM smart_albums WHERE id = ?').run(id)
  }

  // ---- keywords ----

  keywordTree(): KeywordNode[] {
    const rows = this.db.prepare('SELECT pk.photo_id, k.id, k.path FROM photo_keywords pk JOIN keywords k ON k.id = pk.keyword_id').all() as {
      photo_id: number
      id: number
      path: string
    }[]
    const ids = new Map((this.db.prepare('SELECT id, path FROM keywords').all() as { id: number; path: string }[]).map((k) => [k.path.toLowerCase(), k.id]))
    // Count distinct photos per node, including photos tagged with descendants.
    const photosPer = new Map<string, Set<number>>()
    const display = new Map<string, string>()
    for (const r of rows) {
      const parts = r.path.split('>')
      for (let i = 1; i <= parts.length; i++) {
        const p = parts.slice(0, i).join('>')
        const key = p.toLowerCase()
        if (!display.has(key)) display.set(key, p)
        let set = photosPer.get(key)
        if (!set) photosPer.set(key, (set = new Set()))
        set.add(r.photo_id)
      }
    }
    const nodes = new Map<string, KeywordNode>()
    const roots: KeywordNode[] = []
    for (const key of [...photosPer.keys()].sort()) {
      const p = display.get(key)!
      const node: KeywordNode = { id: ids.get(key) ?? 0, name: p.split('>').pop()!, path: p, count: photosPer.get(key)!.size, children: [] }
      nodes.set(key, node)
      const parent = key.includes('>') ? nodes.get(key.slice(0, key.lastIndexOf('>'))) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    const sort = (list: KeywordNode[]): void => {
      list.sort((a, b) => a.name.localeCompare(b.name))
      list.forEach((n) => sort(n.children))
    }
    sort(roots)
    return roots
  }

  /** Renames a keyword path; descendants move with it. */
  renameKeyword(from: string, to: string): void {
    const src = normalizeKeyword(from)
    const dst = normalizeKeyword(to)
    if (!src || !dst || src.toLowerCase() === dst.toLowerCase()) return
    const affected = new Set<number>()
    tx(this.db, () => {
      const kws = this.db.prepare("SELECT id, path FROM keywords WHERE path = ? OR path LIKE ? ESCAPE '\\'").all(src, src.replace(/[\\%_]/g, (c) => '\\' + c) + '>%') as {
        id: number
        path: string
      }[]
      for (const k of kws) {
        const newPath = dst + k.path.slice(src.length)
        const target = keywordId(this.db, newPath)
        const photos = this.db.prepare('SELECT photo_id FROM photo_keywords WHERE keyword_id = ?').all(k.id) as { photo_id: number }[]
        for (const { photo_id } of photos) {
          this.db.prepare('INSERT OR IGNORE INTO photo_keywords (photo_id, keyword_id) VALUES (?, ?)').run(photo_id, target)
          affected.add(photo_id)
        }
        if (target !== k.id) this.db.prepare('DELETE FROM keywords WHERE id = ?').run(k.id)
      }
      affected.forEach((pid) => reindexFts(this.db, pid))
    })
  }

  deleteKeyword(kwPath: string): void {
    const src = normalizeKeyword(kwPath)
    tx(this.db, () => {
      const kws = this.db.prepare("SELECT id FROM keywords WHERE path = ? OR path LIKE ? ESCAPE '\\'").all(src, src.replace(/[\\%_]/g, (c) => '\\' + c) + '>%') as { id: number }[]
      const affected = new Set<number>()
      for (const k of kws) {
        for (const r of this.db.prepare('SELECT photo_id FROM photo_keywords WHERE keyword_id = ?').all(k.id) as { photo_id: number }[]) affected.add(r.photo_id)
        this.db.prepare('DELETE FROM keywords WHERE id = ?').run(k.id)
      }
      affected.forEach((pid) => reindexFts(this.db, pid))
    })
  }

  // ---- folders ----

  folderTree(): FolderNode[] {
    const out: FolderNode[] = []
    for (const root of this.listRoots()) {
      const rows = this.db.prepare('SELECT folder, COUNT(*) AS c FROM photos WHERE root_id = ? GROUP BY folder').all(root.id) as { folder: string; c: number }[]
      const top: FolderNode = { key: `${root.id}:`, rootId: root.id, relPath: '', name: root.name, count: 0, children: [] }
      const nodes = new Map<string, FolderNode>([['', top]])
      const ensure = (rel: string): FolderNode => {
        let n = nodes.get(rel)
        if (n) return n
        const parentRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        n = { key: `${root.id}:${rel}`, rootId: root.id, relPath: rel, name: rel.slice(rel.lastIndexOf('/') + 1), count: 0, children: [] }
        nodes.set(rel, n)
        ensure(parentRel).children.push(n)
        return n
      }
      for (const r of rows) {
        ensure(r.folder)
        // Counts include subfolders.
        let rel: string | null = r.folder
        while (rel !== null) {
          nodes.get(rel)!.count += r.c
          rel = rel === '' ? null : rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        }
      }
      const sort = (n: FolderNode): void => {
        n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        n.children.forEach(sort)
      }
      sort(top)
      out.push(top)
    }
    return out
  }

  // ---- rediscover ----

  stats(): LibraryStats {
    const s = this.db
      .prepare(
        `SELECT COUNT(*) AS photos, SUM(kind = 'raw') AS raw, SUM(size) AS bytes, SUM(rating > 0) AS rated, SUM(flag = 'pick') AS picks,
          MIN(substr(taken_day, 1, 4)) AS firstYear,
          MAX(substr(taken_day, 1, 4)) AS lastYear,
          COUNT(DISTINCT substr(taken_day, 1, 4)) AS years,
          COUNT(DISTINCT model) AS cameras FROM photos`
      )
      .get() as any
    const top = (col: string): string | null =>
      (this.db.prepare(`SELECT ${col} AS v FROM photos WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY COUNT(*) DESC LIMIT 1`).get() as { v: string } | undefined)?.v ??
      null
    return {
      photos: s.photos ?? 0,
      raw: s.raw ?? 0,
      bytes: s.bytes ?? 0,
      rated: s.rated ?? 0,
      picks: s.picks ?? 0,
      firstYear: s.firstYear ? Number(s.firstYear) : null,
      lastYear: s.lastYear ? Number(s.lastYear) : null,
      years: s.years ?? 0,
      cameras: s.cameras ?? 0,
      topCamera: top("TRIM(COALESCE(make,'') || ' ' || COALESCE(model,''))"),
      topLens: top('lens')
    }
  }

  private pick(sql: string, ...params: (string | number)[]): Photo[] {
    return (this.db.prepare(`SELECT ${PHOTO_COLUMNS} FROM photos p JOIN roots r ON r.id = p.root_id WHERE p.offline = 0 AND ${sql}`).all(...params) as any[]).map(rowToPhoto)
  }

  /** Photos taken on today's month/day in earlier years, grouped by year (newest first). */
  onThisDay(now = new Date()): { year: number; photos: Photo[] }[] {
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const photos = this.pick(
      `substr(p.taken_day, 6) = ? AND substr(p.taken_day, 1, 4) < ?
       AND COALESCE(p.flag, '') <> 'reject' ORDER BY p.taken_at DESC LIMIT 300`,
      md,
      String(now.getFullYear())
    )
    const byYear = new Map<number, Photo[]>()
    for (const p of photos) {
      const y = new Date(p.takenAt!).getFullYear()
      if (!byYear.has(y)) byYear.set(y, [])
      byYear.get(y)!.push(p)
    }
    return [...byYear.entries()].map(([year, list]) => ({ year, photos: list.sort((a, b) => b.rating - a.rating).slice(0, 24) }))
  }

  highlights(limit = 24): Photo[] {
    const best = this.pick("(p.rating >= 4 OR p.flag = 'pick') ORDER BY random() LIMIT ?", limit)
    if (best.length >= limit) return best
    return [...best, ...this.pick("COALESCE(p.flag, '') <> 'reject' AND p.rating < 4 ORDER BY random() LIMIT ?", limit - best.length)]
  }

  shuffle(limit = 36): Photo[] {
    return this.pick("COALESCE(p.flag, '') <> 'reject' ORDER BY random() LIMIT ?", limit)
  }

  recentlyAdded(limit = 24): Photo[] {
    return this.pick('1 ORDER BY p.added_at DESC, p.id DESC LIMIT ?', limit)
  }

  /** A random past month with enough photos, for the "A look back" strip. */
  lookBack(): { label: string; query: string; photos: Photo[] } | null {
    const row = this.db
      .prepare(
        `SELECT substr(taken_day, 1, 7) AS ym, COUNT(*) AS c FROM photos WHERE taken_day IS NOT NULL AND offline = 0
         GROUP BY ym HAVING c >= 6 ORDER BY random() LIMIT 1`
      )
      .get() as { ym: string } | undefined
    if (!row) return null
    const [y, m] = row.ym.split('-').map(Number)
    const label = new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
    const photos = this.pick(
      "substr(p.taken_day, 1, 7) = ? AND COALESCE(p.flag, '') <> 'reject' ORDER BY p.rating DESC, random() LIMIT 18",
      row.ym
    )
    return { label, query: `date:${row.ym}`, photos }
  }
}
