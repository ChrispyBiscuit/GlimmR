// Importing from memory cards and folders. The source is only ever read: Glimmr never deletes, changes or formats
// anything on a card. Files are copied into a library folder with verification, RAW + JPEG pairs and sidecars
// together, and every copied file is recorded as it completes, so an interrupted import picks up where it stopped.

import fs from 'node:fs'
import path from 'node:path'
import * as exifr from 'exifr'
import sharp from 'sharp'
import { type Db, tx } from './db'
import { displayFile, photoFiles } from './files'
import { quickHash, sha256File, uniqueName, verifiedCopy } from './fileops'
import { pairFiles, walk } from './scanner'
import { pipeline, sourceFor } from './previews'
import { folderFor } from '../shared/importTemplate'
import { RAW_EXTS } from '../shared/formats'
import type { ImportItem, ImportMarks, ImportOptions, ImportResult, ImportSource } from '../shared/types'

export const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'mts', 'm2ts', 'avi', 'mxf', '3gp', 'insv', 'lrv', 'mpg', 'mpeg'])

interface SourceFile {
  abs: string
  rel: string
  size: number
  mtime: number
}

/** A source read for import, with absolute paths kept on this side only. */
interface Session {
  source: ImportSource
  root: string
  files: Map<string, { main: SourceFile; companion: SourceFile | null; sidecars: SourceFile[] }>
  videos: SourceFile[]
  thumbs: string
}

const sessions = new Map<string, Session>()

async function captureInfo(file: string): Promise<{ takenAt: number | null; camera: string }> {
  try {
    const r = (await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'Model'] })) as { DateTimeOriginal?: Date; CreateDate?: Date; Model?: string } | undefined
    const d = r?.DateTimeOriginal ?? r?.CreateDate
    return { takenAt: d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null, camera: String(r?.Model ?? '').trim() }
  } catch {
    return { takenAt: null, camera: '' }
  }
}

async function walkVideos(root: string, signal?: AbortSignal): Promise<SourceFile[]> {
  const out: SourceFile[] = []
  const stack = ['']
  while (stack.length && !signal?.aborted) {
    const rel = stack.pop()!
    const ents = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) stack.push(childRel)
      else if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).slice(1).toLowerCase())) {
        const abs = path.join(root, childRel)
        const st = await fs.promises.stat(abs).catch(() => null)
        if (st) out.push({ abs, rel: childRel, size: st.size, mtime: Math.floor(st.mtimeMs) })
      }
    }
  }
  return out
}

/**
 * Whether a file is already in the library or was imported before: the same size and quick hash as a photo or an
 * earlier import's file, or (for photos cataloged before hashes were kept) the same size, type and capture time.
 */
function alreadyImported(db: Db, size: number, hash: string, ext: string, takenAt: number | null): boolean {
  if (db.prepare('SELECT 1 FROM photos WHERE size = ? AND quick_hash = ? LIMIT 1').get(size, hash)) return true
  const prior = db.prepare("SELECT dest_path FROM import_files WHERE size = ? AND quick_hash = ? AND state = 'done'").all(size, hash) as { dest_path: string }[]
  if (prior.some((p) => p.dest_path && fs.existsSync(p.dest_path))) return true
  if (takenAt != null && db.prepare('SELECT 1 FROM photos WHERE size = ? AND ext = ? AND taken_at BETWEEN ? AND ? LIMIT 1').get(size, ext, takenAt - 1000, takenAt + 1000)) return true
  return false
}

/** A file with exactly this content already in the library or copied by an earlier import, confirmed by SHA-256. */
async function existingCopy(db: Db, abs: string, size: number, hash: string): Promise<string | null> {
  const rows = [
    ...(db.prepare('SELECT r.path AS root, p.rel_path AS rel FROM photos p JOIN roots r ON r.id = p.root_id WHERE p.size = ? AND p.quick_hash = ?').all(size, hash) as { root: string; rel: string }[]).map((r) =>
      path.join(r.root, ...r.rel.split('/'))
    ),
    ...(db.prepare("SELECT dest_path FROM import_files WHERE size = ? AND quick_hash = ? AND state = 'done' AND dest_path IS NOT NULL").all(size, hash) as { dest_path: string }[]).map((r) => r.dest_path)
  ]
  let mine: string | null = null
  for (const candidate of new Set(rows)) {
    if (!fs.existsSync(candidate)) continue
    mine ??= await sha256File(abs)
    if ((await sha256File(candidate)) === mine) return candidate
  }
  return null
}

/** Reads a card or folder: its photos (paired, with sidecars), videos, and which are already in the library. */
export async function readSource(
  db: Db,
  root: string,
  label: string,
  cacheDir: string,
  report: (done: number, total: number, message?: string) => void,
  signal?: AbortSignal
): Promise<ImportSource> {
  report(0, 0, 'Reading the card…')
  const found = await walk(root, signal)
  const groups = pairFiles(found)
  const videos = await walkVideos(root, signal)
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const files: Session['files'] = new Map()
  const items: ImportItem[] = []
  const dirCache = new Map<string, string[]>()
  let done = 0
  for (const g of groups) {
    if (signal?.aborted) throw new Error('Cancelled.')
    report(done++, groups.length, 'Checking for photos already in the library…')
    const set = photoFiles({ path: g.abs, companion: g.companion?.abs ?? null }, dirCache)
    const stat = (abs: string): SourceFile => {
      const st = fs.statSync(abs)
      return { abs, rel: path.relative(root, abs).split(path.sep).join('/'), size: st.size, mtime: Math.floor(st.mtimeMs) }
    }
    const main = stat(g.abs)
    const companion = g.companion ? stat(g.companion.abs) : null
    const sidecars = set.sidecars.map(stat)
    const hash = await quickHash(g.abs, main.size)
    let { takenAt, camera } = await captureInfo(g.abs)
    // A RAW whose date can't be read takes it from its camera JPEG.
    if (companion && (takenAt == null || !camera)) {
      const c = await captureInfo(companion.abs)
      takenAt ??= c.takenAt
      camera ||= c.camera
    }
    files.set(main.rel, { main, companion, sidecars })
    items.push({
      key: main.rel,
      index: items.length,
      name: path.basename(g.abs),
      companion: companion ? path.basename(companion.abs) : null,
      ext: g.ext,
      raw: RAW_EXTS.has(g.ext),
      size: main.size + (companion?.size ?? 0) + sidecars.reduce((n, s) => n + s.size, 0),
      fileCount: 1 + (companion ? 1 : 0) + sidecars.length,
      takenAt: takenAt ?? main.mtime,
      camera,
      already: alreadyImported(db, main.size, hash, g.ext, takenAt)
    })
  }
  items.sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0) || a.name.localeCompare(b.name))
  items.forEach((it, i) => (it.index = i))
  const source: ImportSource = {
    token,
    label,
    path: root,
    items,
    videos: videos.length,
    videoBytes: videos.reduce((n, v) => n + v.size, 0)
  }
  sessions.set(token, { source, root, files, videos, thumbs: path.join(cacheDir, 'import', token) })
  report(groups.length, groups.length)
  return source
}

/** A card photo's thumbnail (480 px) or preview (2048 px), from its camera JPEG or embedded preview. Cached per session. */
export async function sourceImage(token: string, index: number, size: 'thumb' | 'preview'): Promise<string | null> {
  const s = sessions.get(token)
  const item = s?.source.items[index]
  if (!s || !item) return null
  const out = path.join(s.thumbs, `${index}-${size}.jpg`)
  if (fs.existsSync(out)) return out
  const f = s.files.get(item.key)!
  const shown = displayFile({ path: f.main.abs, ext: item.ext, companion: f.companion?.abs ?? null })
  const { input, orientation } = await sourceFor(shown.path, shown.ext, 1)
  const px = size === 'thumb' ? 480 : 2048
  await fs.promises.mkdir(s.thumbs, { recursive: true })
  await pipeline(input, orientation).resize(px, px, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#111' }).jpeg({ quality: 82 }).toFile(`${out}.tmp`)
  await fs.promises.rename(`${out}.tmp`, out)
  return out
}

/** A card photo at full size for 100% zoom: its camera JPEG itself, or the preview for other formats. */
export async function sourceFull(token: string, index: number): Promise<string | null> {
  const s = sessions.get(token)
  const item = s?.source.items[index]
  if (!s || !item) return null
  const f = s.files.get(item.key)!
  const shown = displayFile({ path: f.main.abs, ext: item.ext, companion: f.companion?.abs ?? null })
  return /^(jpe?g|jpe|jfif|png|webp|gif|avif)$/.test(shown.ext) ? shown.path : sourceImage(token, index, 'preview')
}

export function closeSource(token: string): void {
  const s = sessions.get(token)
  if (!s) return
  sessions.delete(token)
  fs.rmSync(s.thumbs, { recursive: true, force: true })
}

export interface ImportDeps {
  db: Db
  /** Absolute path of the destination library folder. */
  rootPath: string
  report: (done: number, total: number, message?: string) => void
  signal?: AbortSignal
}

/**
 * Copies the chosen photos (and videos, if asked) into the library folder, each into the folder its template gives.
 * A file already at the destination with the same content counts as already imported; a different file with the same
 * name makes the new photo take the next free name (IMG_1234-1.CR3, with its JPEG and sidecars).
 */
export async function runImport(deps: ImportDeps, token: string, opts: ImportOptions): Promise<ImportResult & { copied: { key: string; dest: string; sha256: string; quickHash: string }[] }> {
  const s = sessions.get(token)
  if (!s) throw new Error('The card is no longer open. Open it again to import.')
  const { db } = deps
  const chosen = new Set(opts.keys)
  const items = s.source.items.filter((i) => chosen.has(i.key))
  const result: ImportResult & { copied: { key: string; dest: string; sha256: string; quickHash: string }[] } = {
    importId: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    videos: 0,
    errors: [],
    folders: [],
    copied: []
  }
  const importId = Number(
    db
      .prepare('INSERT INTO imports (source, label, destination, started_at, state) VALUES (?, ?, ?, ?, ?)')
      .run(s.root, s.source.label, deps.rootPath, Date.now(), 'running').lastInsertRowid
  )
  result.importId = importId
  const record = db.prepare(
    'INSERT OR REPLACE INTO import_files (import_id, source_rel, size, quick_hash, sha256, dest_path, state, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const folders = new Set<string>()
  const total = items.length + (opts.copyVideos ? s.videos.length : 0)
  let n = 0
  for (const item of items) {
    if (deps.signal?.aborted) break
    deps.report(n++, total, `Copying ${item.name}`)
    const f = s.files.get(item.key)!
    const rel = folderFor(opts.template, { takenAt: item.takenAt, event: opts.event, camera: item.camera, card: s.source.label })
    const dir = path.join(deps.rootPath, ...rel.split('/').filter(Boolean))
    const hash = await quickHash(f.main.abs, f.main.size)
    try {
      // Already in the library (or imported before), wherever it went: never copied twice.
      const there = await existingCopy(db, f.main.abs, f.main.size, hash)
      if (there) {
        record.run(importId, item.key, f.main.size, hash, null, there, 'done', null)
        result.skipped++
        continue
      }
      fs.mkdirSync(dir, { recursive: true })
      const names = new Set(fs.readdirSync(dir).map((x) => x.toLowerCase()))
      const at = path.join(dir, item.name)
      // The same file is already there (an earlier import of this card): nothing to copy.
      if (names.has(item.name.toLowerCase()) && fs.statSync(at).size === f.main.size && (await sha256File(at)) === (await sha256File(f.main.abs))) {
        record.run(importId, item.key, f.main.size, hash, null, at, 'done', null)
        result.skipped++
        continue
      }
      const stem = (x: string): string => x.slice(0, x.length - path.extname(x).length)
      const own = [f.main, ...(f.companion ? [f.companion] : []), ...f.sidecars]
      let newStem = stem(item.name)
      if (own.some((o) => names.has(path.basename(o.abs).toLowerCase()))) {
        // Another file has this name (cameras reuse numbers): every file of the photo gets the next free name.
        const free = (cand: string): boolean => own.every((o) => !names.has((stem(cand) + path.basename(o.abs).slice(stem(item.name).length)).toLowerCase()))
        newStem = stem(uniqueName(item.name, free))
      }
      const target = (o: SourceFile): string => path.join(dir, newStem + path.basename(o.abs).slice(stem(item.name).length))
      let mainSha = ''
      for (const o of own) {
        const sha = await verifiedCopy(o.abs, target(o), deps.signal)
        if (o === f.main) mainSha = sha
      }
      record.run(importId, item.key, f.main.size, hash, mainSha, target(f.main), 'done', null)
      result.copied.push({ key: item.key, dest: target(f.main), sha256: mainSha, quickHash: hash })
      result.imported++
      folders.add(rel)
    } catch (e) {
      const msg = (e as Error).message
      record.run(importId, item.key, f.main.size, hash, null, null, 'failed', msg)
      result.failed++
      if (result.errors.length < 20) result.errors.push(`${item.name}: ${msg}`)
    }
  }
  if (opts.copyVideos) {
    for (const v of s.videos) {
      if (deps.signal?.aborted) break
      deps.report(n++, total, `Copying ${path.basename(v.abs)}`)
      const rel = folderFor(opts.template, { takenAt: v.mtime, event: opts.event, camera: '', card: s.source.label })
      const dir = path.join(deps.rootPath, ...rel.split('/').filter(Boolean))
      try {
        fs.mkdirSync(dir, { recursive: true })
        const name = path.basename(v.abs)
        const there = path.join(dir, name)
        if (fs.existsSync(there) && fs.statSync(there).size === v.size) {
          result.skipped++
          continue
        }
        const taken = new Set(fs.readdirSync(dir).map((x) => x.toLowerCase()))
        await verifiedCopy(v.abs, path.join(dir, uniqueName(name, (c) => !taken.has(c.toLowerCase()))), deps.signal)
        result.videos++
        folders.add(rel)
      } catch (e) {
        result.failed++
        if (result.errors.length < 20) result.errors.push(`${path.basename(v.abs)}: ${(e as Error).message}`)
      }
    }
  }
  db.prepare('UPDATE imports SET finished_at = ?, state = ? WHERE id = ?').run(Date.now(), deps.signal?.aborted ? 'cancelled' : 'done', importId)
  result.folders = [...folders].sort()
  deps.report(total, total)
  return result
}

/** After the library folder is scanned: ties the new photos to the import, keeps their hashes, applies card marks. */
export function finishImport(db: Db, rootId: number, rootPath: string, result: { importId: number; copied: { key: string; dest: string; sha256: string; quickHash: string }[] }, marks: ImportMarks): number[] {
  const ids: number[] = []
  const find = db.prepare('SELECT id FROM photos WHERE root_id = ? AND rel_path = ?')
  tx(db, () => {
    for (const c of result.copied) {
      const rel = path.relative(rootPath, c.dest).split(path.sep).join('/')
      const row = find.get(rootId, rel) as { id: number } | undefined
      if (!row) continue
      ids.push(row.id)
      db.prepare('UPDATE photos SET import_id = ?, quick_hash = ?, sha256 = ? WHERE id = ?').run(result.importId, c.quickHash, c.sha256, row.id)
      const m = marks[c.key]
      if (m) db.prepare('UPDATE photos SET rating = COALESCE(?, rating), flag = ?, label = COALESCE(?, label) WHERE id = ?').run(m.rating ?? null, m.flag ?? null, m.label ?? null, row.id)
    }
  })
  return ids
}

