// Incremental folder scanning: catalogs files in place, never modifies them.

import fs from 'node:fs'
import path from 'node:path'
import * as exifr from 'exifr'
import { type Db, tx, keywordId, localDay, mergePhotos, parseEdit, reindexFts } from './db'
import { isSupported, RAW_EXTS, readMetadata, findSidecar, type ExtractedMeta } from './metadata'
import { generatePreviews, imageSize, previewPaths } from './previews'
import { DISPLAY_EXTS } from './files'

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', '@eadir', '.trashes', '.spotlight-v100', '.fseventsd', 'node_modules', '.glimmr'])

export interface FoundFile {
  rel: string
  abs: string
  ext: string
  size: number
  mtime: number
  /** The camera JPEG/HEIF paired with this RAW (same folder, same name). */
  companion?: FoundFile
}

const stemKey = (rel: string): string => rel.slice(0, rel.length - path.extname(rel).length).toLowerCase()
const DISPLAY_ORDER = ['jpg', 'jpeg', 'jpe', 'heic', 'hif', 'heif']

/**
 * Pairs each RAW with the camera JPEG (or HEIF) of the same name in the same folder, as cameras write them. The RAW
 * stays the main file and carries the JPEG as its companion; the JPEG is no longer a photo of its own. `keep(raw,
 * jpeg)` can veto a pair (e.g. when the capture times disagree).
 */
export function pairFiles(files: FoundFile[], keep: (raw: FoundFile, display: FoundFile) => boolean = () => true): FoundFile[] {
  const groups = new Map<string, FoundFile[]>()
  for (const f of files) {
    const k = stemKey(f.rel)
    const g = groups.get(k)
    if (g) g.push(f)
    else groups.set(k, [f])
  }
  const out: FoundFile[] = []
  for (const g of groups.values()) {
    const raws = g.filter((f) => RAW_EXTS.has(f.ext)).sort((a, b) => a.rel.localeCompare(b.rel))
    const displays = g.filter((f) => DISPLAY_EXTS.has(f.ext)).sort((a, b) => DISPLAY_ORDER.indexOf(a.ext) - DISPLAY_ORDER.indexOf(b.ext))
    const raw = raws[0]
    const display = raw && displays.find((d) => keep(raw, d))
    if (raw && display) {
      out.push({ ...raw, mtime: Math.max(raw.mtime, display.mtime), companion: display })
      for (const f of g) if (f !== raw && f !== display) out.push(f)
    } else out.push(...g)
  }
  return out
}

/** Capture time from EXIF, for checking a pair belongs together. */
async function captureTime(file: string): Promise<number | null> {
  try {
    const r = (await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] })) as { DateTimeOriginal?: Date; CreateDate?: Date } | undefined
    const d = r?.DateTimeOriginal ?? r?.CreateDate
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : null
  } catch {
    return null
  }
}

export async function walk(root: string, signal?: AbortSignal): Promise<FoundFile[]> {
  const out: FoundFile[] = []
  const stack = ['']
  while (stack.length) {
    if (signal?.aborted) break
    const rel = stack.pop()!
    let dir: fs.Dir
    try {
      dir = await fs.promises.opendir(path.join(root, rel))
    } catch {
      continue
    }
    for await (const ent of dir) {
      if (ent.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase()) && !ent.name.endsWith('.lrdata') && !ent.name.endsWith('.cosessiondb')) stack.push(childRel)
        continue
      }
      if (!ent.isFile()) continue
      const ext = path.extname(ent.name).slice(1).toLowerCase()
      if (!isSupported(ext)) continue
      const abs = path.join(root, rel, ent.name)
      try {
        const st = await fs.promises.stat(abs)
        let mtime = Math.floor(st.mtimeMs)
        // An edited sidecar (e.g. ratings changed in Lightroom) counts as a change to the photo.
        const side = findSidecar(abs)
        if (side) mtime = Math.max(mtime, Math.floor((await fs.promises.stat(side)).mtimeMs))
        out.push({ rel: childRel, abs, ext, size: st.size, mtime })
      } catch {
        /* vanished during scan */
      }
    }
  }
  return out
}

/** Deletes a removed photo's cached previews. */
export function removeCached(cacheDir: string, id: number): void {
  for (const f of Object.values(previewPaths(cacheDir, id))) fs.rmSync(f, { force: true })
}

function orientationOf(w: number | null, h: number | null): string | null {
  if (!w || !h) return null
  if (Math.abs(w - h) / Math.max(w, h) < 0.02) return 'square'
  return w > h ? 'landscape' : 'portrait'
}

export function writePhotoRecord(
  db: Db,
  rootId: number,
  f: FoundFile,
  meta: ExtractedMeta,
  existingId: number | null,
  importUserFields: boolean
): number {
  return tx(db, () => {
    const id = writeRecord(db, rootId, f, meta, existingId, importUserFields)
    db.prepare('UPDATE photos SET companion = ? WHERE id = ?').run(f.companion ? path.basename(f.companion.rel) : null, id)
    if (f.companion) {
      db.prepare('INSERT INTO metadata (photo_id, key, value, num) VALUES (?, ?, ?, ?)').run(id, 'PairedFile', path.basename(f.companion.rel), null)
      reindexFts(db, id)
    }
    return id
  })
}

function writeRecord(db: Db, rootId: number, f: FoundFile, meta: ExtractedMeta, existingId: number | null, importUserFields: boolean): number {
  {
    const folder = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : ''
    const filename = f.rel.slice(f.rel.lastIndexOf('/') + 1)
    const takenAt = meta.takenAt ?? f.mtime
    const tech = [
      f.size,
      f.mtime,
      takenAt,
      localDay(takenAt),
      meta.width,
      meta.height,
      orientationOf(meta.width, meta.height),
      meta.make,
      meta.model,
      meta.lens,
      meta.focal,
      meta.aperture,
      meta.shutter,
      meta.iso,
      meta.lat,
      meta.lon,
      meta.exifOrientation
    ]
    let id: number
    if (existingId == null) {
      id = Number(
        db
          .prepare(
            `INSERT INTO photos (root_id, rel_path, folder, filename, ext, kind, size, mtime, taken_at, taken_day, width, height, orientation, make, model, lens,
             focal, aperture, shutter, iso, lat, lon, exif_orientation, added_at, rating, flag, label, title, caption, creator)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            rootId,
            f.rel,
            folder,
            filename,
            f.ext,
            RAW_EXTS.has(f.ext) ? 'raw' : 'image',
            ...tech,
            Date.now(),
            meta.rating,
            meta.flag,
            meta.label,
            meta.title,
            meta.caption,
            meta.creator
          ).lastInsertRowid
      )
    } else {
      id = existingId
      db.prepare(
        `UPDATE photos SET size = ?, mtime = ?, taken_at = ?, taken_day = ?, width = ?, height = ?, orientation = ?, make = ?, model = ?, lens = ?,
         focal = ?, aperture = ?, shutter = ?, iso = ?, lat = ?, lon = ?, exif_orientation = ?, offline = 0 WHERE id = ?`
      ).run(...tech, id)
      if (importUserFields)
        db.prepare('UPDATE photos SET rating = ?, flag = ?, label = ?, title = ?, caption = ?, creator = ? WHERE id = ?').run(
          meta.rating,
          meta.flag,
          meta.label,
          meta.title,
          meta.caption,
          meta.creator,
          id
        )
      db.prepare('DELETE FROM metadata WHERE photo_id = ?').run(id)
    }
    if (existingId == null || importUserFields) {
      db.prepare('DELETE FROM photo_keywords WHERE photo_id = ?').run(id)
      const link = db.prepare('INSERT OR IGNORE INTO photo_keywords (photo_id, keyword_id) VALUES (?, ?)')
      for (const k of meta.keywords) link.run(id, keywordId(db, k))
    }
    const ins = db.prepare('INSERT INTO metadata (photo_id, key, value, num) VALUES (?, ?, ?, ?)')
    ins.run(id, 'FileName', filename, null)
    ins.run(id, 'FileSize', String(f.size), f.size)
    ins.run(id, 'FileType', f.ext.toUpperCase(), null)
    if (meta.sidecar) ins.run(id, 'Sidecar', path.basename(meta.sidecar), null)
    for (const e of meta.entries) ins.run(id, e.key, e.value, e.num)
    reindexFts(db, id)
    return id
  }
}

export interface ScanOptions {
  cacheDir: string
  /** Re-read rating, label, keywords, title and caption from the files, overwriting catalog edits. */
  reimport?: boolean
  signal?: AbortSignal
  onProgress?: (done: number, total: number, message?: string) => void
}

export interface ScanResult {
  found: number
  added: number
  updated: number
  offline: number
  errors: number
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}

export async function scanRoot(db: Db, rootId: number, rootPath: string, opts: ScanOptions): Promise<ScanResult> {
  opts.onProgress?.(0, 0, 'Looking for photos…')
  const found = await walk(rootPath, opts.signal)
  const existing = new Map<string, { id: number; size: number; mtime: number; has_preview: number; companion: string | null }>()
  for (const r of db.prepare('SELECT id, rel_path, size, mtime, has_preview, companion FROM photos WHERE root_id = ?').all(rootId) as any[]) existing.set(r.rel_path, r)
  // A RAW and a camera JPEG of the same name become one photo, unless both carry capture times more than 2 s apart.
  // Pairs already in the catalog aren't checked again.
  const times = new Map<string, number | null>()
  for (const g of pairFiles(found)) {
    if (!g.companion || existing.get(g.rel)?.companion === path.basename(g.companion.rel)) continue
    times.set(g.abs, await captureTime(g.abs))
    times.set(g.companion.abs, await captureTime(g.companion.abs))
  }
  const files = pairFiles(found, (raw, jpg) => {
    const a = times.get(raw.abs)
    const b = times.get(jpg.abs)
    return a == null || b == null || Math.abs(a - b) <= 2000
  })
  const result: ScanResult = { found: files.length, added: 0, updated: 0, offline: 0, errors: 0 }
  if (!fs.existsSync(rootPath)) {
    // Drive not connected: keep everything, mark it offline.
    result.offline = Number(db.prepare('UPDATE photos SET offline = 1 WHERE root_id = ?').run(rootId).changes)
    return result
  }

  const seen = new Set<number>()
  let done = 0
  opts.onProgress?.(0, files.length)
  await mapLimit(
    files,
    4,
    async (f) => {
      const prior = existing.get(f.rel)
      try {
        const companion = f.companion ? path.basename(f.companion.rel) : null
        const changed = !prior || prior.size !== f.size || prior.mtime !== f.mtime || (prior.companion ?? null) !== companion || opts.reimport
        let id = prior?.id ?? null
        let orientation = 1
        if (changed) {
          const meta = await readMetadata(f.abs)
          if (!meta.width && !RAW_EXTS.has(f.ext)) {
            const s = await imageSize(f.abs)
            if (s) {
              meta.width = s.width
              meta.height = s.height
            }
          }
          orientation = meta.exifOrientation
          id = writePhotoRecord(db, rootId, f, meta, id, !!opts.reimport)
          if (prior) result.updated++
          else result.added++
          // The camera JPEG was a photo of its own before it was paired: fold its ratings, keywords, albums and edit
          // into the pair, and drop its record.
          const was = f.companion && existing.get(f.companion.rel)
          if (was && was.id !== id) {
            mergePhotos(db, id!, was.id)
            removeCached(opts.cacheDir, was.id)
            seen.add(was.id)
          }
        } else if (prior.has_preview) {
          db.prepare('UPDATE photos SET offline = 0 WHERE id = ? AND offline = 1').run(prior.id)
        }
        seen.add(id!)
        if (changed || !prior?.has_preview) {
          if (!changed) {
            const o = db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id!) as { exif_orientation: number }
            orientation = o.exif_orientation
          }
          try {
            const { edit } = db.prepare('SELECT edit FROM photos WHERE id = ?').get(id!) as { edit: string | null }
            // A pair is shown by its camera JPEG.
            const shown = f.companion ?? f
            const size = await generatePreviews(shown.abs, shown.ext, orientation, previewPaths(opts.cacheDir, id!), parseEdit(edit))
            // Formats whose metadata has no pixel size (Photoshop, BMP) get it from the decode. So do raw files whose
            // metadata only gave a thumbnail's size (some NEFs): the embedded preview is at least that big.
            if (size)
              db.prepare(
                `UPDATE photos SET width = ?, height = ?, orientation = ? WHERE id = ? AND (width IS NULL OR width = 0 OR height IS NULL OR (kind = 'raw' AND width * height < ?))`
              ).run(size.width, size.height, orientationOf(size.width, size.height), id!, size.width * size.height)
            db.prepare('UPDATE photos SET has_preview = 1, offline = 0 WHERE id = ?').run(id!)
          } catch {
            db.prepare('UPDATE photos SET has_preview = 0 WHERE id = ?').run(id!)
          }
        }
      } catch {
        result.errors++
        if (prior) seen.add(prior.id)
      }
      done++
      if (done % 5 === 0 || done === files.length) opts.onProgress?.(done, files.length)
    },
    opts.signal
  )
  if (!opts.signal?.aborted) {
    const missing = [...existing.values()].filter((e) => !seen.has(e.id) && db.prepare('SELECT 1 FROM photos WHERE id = ?').get(e.id)).map((e) => e.id)
    const mark = db.prepare('UPDATE photos SET offline = 1 WHERE id = ?')
    tx(db, () => missing.forEach((id) => mark.run(id)))
    result.offline = missing.length
  }
  return result
}
