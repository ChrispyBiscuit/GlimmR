// Folder management: move and copy photos between folders, and create, rename, move, copy and delete folders, on
// disk and in the catalog together. Photos keep their ids, so ratings, keywords, albums, edits and previews survive
// a move. A photo's RAW + JPEG pair and sidecars always travel with it. Nothing is overwritten; deletes go to the
// system trash.

import fs from 'node:fs'
import path from 'node:path'
import { type Db, getPhotos, reindexFts, tx } from './db'
import { allFiles, photoFiles, targetFor, type PhotoFileSet } from './files'
import { moveFile, trashSet, uniqueName, verifiedCopy } from './fileops'
import { previewPaths } from './previews'
import { removeCached } from './scanner'
import type { Photo } from '../shared/types'

export interface FolderRef {
  rootId: number
  /** Folder path inside the library folder, `/`-separated; '' is the library folder itself. */
  rel: string
}

export type ConflictChoice = 'skip' | 'keep' | 'replace'

export interface FolderDeps {
  db: Db
  cacheDir: string
  trash: (file: string) => Promise<void>
  signal?: AbortSignal
  report?: (done: number, total: number, message?: string) => void
}

const join = (rel: string, name: string): string => (rel ? `${rel}/${name}` : name)
const parentOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const like = (v: string): string => v.replace(/[\\%_]/g, (c) => '\\' + c)

export function rootPath(db: Db, rootId: number): string {
  const r = db.prepare('SELECT path FROM roots WHERE id = ?').get(rootId) as { path: string } | undefined
  if (!r) throw new Error('That library folder no longer exists.')
  return r.path
}

export const absOf = (db: Db, f: FolderRef): string => path.join(rootPath(db, f.rootId), ...f.rel.split('/').filter(Boolean))

/** A file or folder name the operating systems accept. */
export function validName(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name.'
  if (n === '.' || n === '..') return 'That name isn’t allowed.'
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) return 'Names can’t contain \\ / : * ? " < > |'
  if (/[. ]$/.test(n)) return 'Names can’t end with a dot or a space.'
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) return 'That name is reserved by Windows.'
  if (n.length > 200) return 'That name is too long.'
  return null
}

// ---- the folders table: every folder Glimmr knows, including empty ones ----

function insertFolders(db: Db, rootId: number, rels: string[]): void {
  const ins = db.prepare('INSERT OR IGNORE INTO folders (root_id, rel) VALUES (?, ?)')
  // Parents too, so the tree is never missing a level.
  for (const rel of rels) for (let r = rel; r; r = parentOf(r)) ins.run(rootId, r)
}

export function recordFolders(db: Db, rootId: number, rels: string[]): void {
  tx(db, () => insertFolders(db, rootId, rels))
}

/** Folders in a library folder, from the catalog's photos and the folders table. */
export function knownFolders(db: Db, rootId: number): string[] {
  const rows = db.prepare('SELECT DISTINCT folder AS rel FROM photos WHERE root_id = ? UNION SELECT rel FROM folders WHERE root_id = ?').all(rootId, rootId) as { rel: string }[]
  return rows.map((r) => r.rel)
}

// ---- photos into a folder ----

interface Planned {
  photo: Photo
  set: PhotoFileSet
  /** The main file's name at the destination. */
  name: string
  conflict: boolean
}

function plan(db: Db, ids: number[], target: FolderRef): { dest: string; items: Planned[] } {
  const dest = absOf(db, target)
  let names: Set<string>
  try {
    names = new Set(fs.readdirSync(dest).map((n) => n.toLowerCase()))
  } catch {
    names = new Set()
  }
  const cache = new Map<string, string[]>()
  const items: Planned[] = []
  for (const p of getPhotos(db, ids)) {
    if (p.offline) continue
    const set = photoFiles(p, cache)
    const same = path.resolve(path.dirname(p.path)) === path.resolve(dest)
    const own = [p.path, ...(set.companion ? [set.companion] : [])].map((f) => path.basename(f).toLowerCase())
    items.push({ photo: p, set, name: p.filename, conflict: !same && own.some((n) => names.has(n)) })
  }
  return { dest, items }
}

/** Which photos would clash with files already in the folder. */
export function conflictsFor(db: Db, ids: number[], target: FolderRef): { id: number; name: string }[] {
  return plan(db, ids, target)
    .items.filter((i) => i.conflict)
    .map((i) => ({ id: i.photo.id, name: i.photo.filename }))
}

/** Updates a moved photo's place in the catalog. */
function relocate(db: Db, id: number, target: FolderRef, name: string, companion: string | null): void {
  db.prepare('UPDATE photos SET root_id = ?, folder = ?, rel_path = ?, filename = ?, companion = ? WHERE id = ?').run(
    target.rootId,
    target.rel,
    join(target.rel, name),
    name,
    companion,
    id
  )
  reindexFts(db, id)
}

/** A catalog record for a copied photo: same marks, keywords and metadata, its own id and previews. */
function duplicateRecord(db: Db, cacheDir: string, id: number, target: FolderRef, name: string, companion: string | null): number {
  const cols = (db.prepare('PRAGMA table_info(photos)').all() as { name: string }[]).map((c) => c.name).filter((c) => c !== 'id')
  const set: Record<string, unknown> = { root_id: target.rootId, folder: target.rel, rel_path: join(target.rel, name), filename: name, companion, added_at: Date.now() }
  const newId = Number(
    db
      .prepare(`INSERT INTO photos (${cols.join(', ')}) SELECT ${cols.map((c) => (c in set ? '?' : c)).join(', ')} FROM photos WHERE id = ?`)
      .run(...[...cols.filter((c) => c in set).map((c) => set[c] as string | number | null), id]).lastInsertRowid
  )
  db.prepare('INSERT INTO photo_keywords (photo_id, keyword_id) SELECT ?, keyword_id FROM photo_keywords WHERE photo_id = ?').run(newId, id)
  db.prepare('INSERT INTO metadata (photo_id, key, value, num) SELECT ?, key, value, num FROM metadata WHERE photo_id = ?').run(newId, id)
  reindexFts(db, newId)
  const from = previewPaths(cacheDir, id)
  const to = previewPaths(cacheDir, newId)
  for (const k of ['thumb', 'preview', 'view'] as const)
    if (fs.existsSync(from[k])) {
      fs.mkdirSync(path.dirname(to[k]), { recursive: true })
      fs.copyFileSync(from[k], to[k])
    }
  return newId
}

export interface MoveResult {
  done: number
  skipped: number
  failed: number
  error?: string
}

/** Moves (or copies) photos into a folder, with their pairs and sidecars. */
export async function putInFolder(deps: FolderDeps, ids: number[], target: FolderRef, opts: { copy: boolean; onConflict: ConflictChoice }): Promise<MoveResult> {
  const { db } = deps
  const { dest, items } = plan(db, ids, target)
  const result: MoveResult = { done: 0, skipped: 0, failed: 0 }
  fs.mkdirSync(dest, { recursive: true })
  recordFolders(db, target.rootId, [target.rel])
  let n = 0
  for (const it of items) {
    if (deps.signal?.aborted) break
    deps.report?.(n++, items.length, `${opts.copy ? 'Copying' : 'Moving'} ${it.photo.filename}`)
    const { photo, set } = it
    const same = path.resolve(path.dirname(photo.path)) === path.resolve(dest)
    if (same && !opts.copy) {
      result.skipped++
      continue
    }
    try {
      let name = photo.filename
      let rename: string | undefined
      if (it.conflict || (same && opts.copy)) {
        if (opts.onConflict === 'skip' && !same) {
          result.skipped++
          continue
        }
        if (opts.onConflict === 'replace' && !same) {
          // The photo already there goes to the trash first, with its own files, and leaves the catalog.
          // Any photo there that uses one of the incoming names, as its main file or its paired JPEG.
          const names = [photo.filename, ...(set.companion ? [path.basename(set.companion)] : [])]
          const marks = names.map(() => '?').join(', ')
          const there = db
            .prepare(`SELECT id FROM photos WHERE root_id = ? AND folder = ? AND (filename COLLATE NOCASE IN (${marks}) OR companion COLLATE NOCASE IN (${marks}))`)
            .all(target.rootId, target.rel, ...names, ...names) as { id: number }[]
          for (const t of getPhotos(db, there.map((r) => r.id))) {
            await trashSet(photoFiles(t), 'all', deps.trash)
            db.prepare('DELETE FROM photos WHERE id = ?').run(t.id)
            removeCached(deps.cacheDir, t.id)
          }
          for (const f of [photo.path, set.companion].filter(Boolean) as string[]) {
            const at = path.join(dest, path.basename(f))
            if (fs.existsSync(at)) await deps.trash(at)
          }
        } else {
          // Keep both: the new photo (and its JPEG and sidecars) get the next free name, IMG_1234-1.CR3.
          const taken = new Set(fs.readdirSync(dest).map((x) => x.toLowerCase()))
          const compExt = set.companion ? path.extname(set.companion) : ''
          name = uniqueName(photo.filename, (c) => !taken.has(c.toLowerCase()) && (!compExt || !taken.has((c.slice(0, -path.extname(c).length) + compExt).toLowerCase())))
          rename = name
        }
      }
      const files = allFiles(set)
      const targets = files.map((f) => targetFor(f, set, dest, rename))
      for (let i = 0; i < files.length; i++) {
        if (opts.copy) await verifiedCopy(files[i], targets[i], deps.signal)
        else await moveFile(files[i], targets[i], deps.trash)
      }
      const companion = set.companion ? path.basename(targets[1]) : null
      if (opts.copy) duplicateRecord(db, deps.cacheDir, photo.id, target, name, companion)
      else relocate(db, photo.id, target, name, companion)
      result.done++
    } catch (e) {
      result.failed++
      result.error ??= (e as Error).message
    }
  }
  deps.report?.(items.length, items.length)
  return result
}

// ---- folders ----

export function createFolder(db: Db, parent: FolderRef, name: string): FolderRef {
  const bad = validName(name)
  if (bad) throw new Error(bad)
  const ref = { rootId: parent.rootId, rel: join(parent.rel, name.trim()) }
  const abs = absOf(db, ref)
  if (fs.existsSync(abs)) throw new Error(`A folder named “${name.trim()}” is already there.`)
  fs.mkdirSync(abs, { recursive: true })
  recordFolders(db, ref.rootId, [ref.rel])
  return ref
}

/** Moves a folder's catalog entries (photos and known folders) to a new place. */
function relocateTree(db: Db, from: FolderRef, to: FolderRef): void {
  tx(db, () => {
    const ids = db.prepare(`SELECT id FROM photos WHERE root_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`).all(from.rootId, from.rel, `${like(from.rel)}/%`) as { id: number }[]
    const cut = from.rel.length + 1
    db.prepare(
      `UPDATE photos SET root_id = ?, folder = ? || substr(folder, ?), rel_path = ? || substr(rel_path, ?) WHERE root_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`
    ).run(to.rootId, to.rel, cut, to.rel, cut, from.rootId, from.rel, `${like(from.rel)}/%`)
    const rels = db.prepare(`SELECT rel FROM folders WHERE root_id = ? AND (rel = ? OR rel LIKE ? ESCAPE '\\')`).all(from.rootId, from.rel, `${like(from.rel)}/%`) as { rel: string }[]
    db.prepare(`DELETE FROM folders WHERE root_id = ? AND (rel = ? OR rel LIKE ? ESCAPE '\\')`).run(from.rootId, from.rel, `${like(from.rel)}/%`)
    insertFolders(db, to.rootId, [to.rel, ...rels.map((r) => to.rel + r.rel.slice(from.rel.length))])
    for (const { id } of ids) reindexFts(db, id)
  })
}

async function copyTree(from: string, to: string, deps: FolderDeps, progress: { done: number; total: number }): Promise<void> {
  fs.mkdirSync(to, { recursive: true })
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (deps.signal?.aborted) throw new Error('Cancelled.')
    const a = path.join(from, ent.name)
    const b = path.join(to, ent.name)
    if (ent.isDirectory()) await copyTree(a, b, deps, progress)
    else if (ent.isFile()) {
      deps.report?.(progress.done++, progress.total, `Copying ${ent.name}`)
      await verifiedCopy(a, b, deps.signal)
    }
  }
}

const countFiles = (dir: string): number =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : e.isFile() ? 1 : 0), 0)

/** Moves or copies a folder (with everything in it) into another folder, or renames it in place with `newName`. */
export async function moveFolder(deps: FolderDeps, from: FolderRef, into: FolderRef, opts: { copy?: boolean; newName?: string } = {}): Promise<FolderRef> {
  const { db } = deps
  if (!from.rel) throw new Error('A library folder can’t be moved. Remove it from the library and add the new place instead.')
  const name = (opts.newName ?? path.posix.basename(from.rel)).trim()
  const bad = validName(name)
  if (bad) throw new Error(bad)
  const to = { rootId: into.rootId, rel: join(into.rel, name) }
  if (to.rootId === from.rootId && (to.rel === from.rel || to.rel.startsWith(`${from.rel}/`))) {
    if (to.rel === from.rel && !opts.copy) return to
    throw new Error('A folder can’t go inside itself.')
  }
  const src = absOf(db, from)
  const dst = absOf(db, to)
  const caseOnly = src.toLowerCase() === dst.toLowerCase() && src !== dst
  if (fs.existsSync(dst) && !caseOnly) throw new Error(`A folder named “${name}” is already there.`)
  if (opts.copy) {
    await copyTree(src, dst, deps, { done: 0, total: countFiles(src) })
    const ids = db.prepare(`SELECT id, folder, filename, companion FROM photos WHERE root_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`).all(from.rootId, from.rel, `${like(from.rel)}/%`) as {
      id: number
      folder: string
      filename: string
      companion: string | null
    }[]
    tx(db, () => {
      for (const r of ids) duplicateRecord(db, deps.cacheDir, r.id, { rootId: to.rootId, rel: to.rel + r.folder.slice(from.rel.length) }, r.filename, r.companion)
    })
    const rels = db.prepare(`SELECT rel FROM folders WHERE root_id = ? AND (rel = ? OR rel LIKE ? ESCAPE '\\')`).all(from.rootId, from.rel, `${like(from.rel)}/%`) as { rel: string }[]
    recordFolders(db, to.rootId, [to.rel, ...rels.map((r) => to.rel + r.rel.slice(from.rel.length))])
    return to
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  try {
    await fs.promises.rename(src, dst)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    // Another drive: copy everything with verification, then send the original folder to the trash.
    await copyTree(src, dst, deps, { done: 0, total: countFiles(src) })
    await deps.trash(src)
  }
  relocateTree(db, from, to)
  return to
}

export function folderStats(db: Db, f: FolderRef): { photos: number; files: number; bytes: number } {
  const photos = (db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE root_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`).get(f.rootId, f.rel, `${like(f.rel)}/%`) as { c: number }).c
  let files = 0
  let bytes = 0
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) {
        files++
        bytes += fs.statSync(p).size
      }
    }
  }
  try {
    walk(absOf(db, f))
  } catch {
    /* missing */
  }
  return { photos, files, bytes }
}

/** Sends a folder and everything in it to the system trash, and takes its photos out of the catalog. */
export async function deleteFolder(deps: FolderDeps, f: FolderRef): Promise<number> {
  const { db } = deps
  if (!f.rel) throw new Error('Use Remove from Library for a library folder.')
  const abs = absOf(db, f)
  if (fs.existsSync(abs)) await deps.trash(abs)
  const ids = db.prepare(`SELECT id FROM photos WHERE root_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`).all(f.rootId, f.rel, `${like(f.rel)}/%`) as { id: number }[]
  tx(db, () => {
    for (const { id } of ids) {
      db.prepare('DELETE FROM photos WHERE id = ?').run(id)
      db.prepare('DELETE FROM photos_fts WHERE rowid = ?').run(id)
    }
    db.prepare(`DELETE FROM folders WHERE root_id = ? AND (rel = ? OR rel LIKE ? ESCAPE '\\')`).run(f.rootId, f.rel, `${like(f.rel)}/%`)
  })
  for (const { id } of ids) removeCached(deps.cacheDir, id)
  return ids.length
}
