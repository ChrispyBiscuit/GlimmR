// Duplicates: exact copies (the same file) and the same picture with different metadata or name. Fingerprints are
// cheap: a quick hash (size plus the first and last 64 KB) for every photo, a full SHA-256 only when quick hashes
// collide, and a pixel hash of the upright preview. Merging keeps one photo, gives it the others' marks, keywords and
// albums, and sends the other files to the trash. Camera RAW + JPEG pairs are one photo, never duplicates.

import fs from 'node:fs'
import path from 'node:path'
import { type Db, getPhotos, mergePhotos } from './db'
import { photoFiles } from './files'
import { quickHash, sha256File, trashSet } from './fileops'
import { pixelHash, previewPaths } from './previews'
import { removeCached } from './scanner'
import type { DuplicateGroup, DuplicatePhoto } from '../shared/types'


/** Fills in missing quick and pixel hashes, for photos cataloged before duplicates were found. */
export async function fingerprintLibrary(db: Db, cacheDir: string, report: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  const rows = db
    .prepare(
      `SELECT p.id, p.size, p.quick_hash, p.pixel_hash, p.has_preview, r.path AS root, p.rel_path FROM photos p JOIN roots r ON r.id = p.root_id
       WHERE p.offline = 0 AND (p.quick_hash IS NULL OR (p.pixel_hash IS NULL AND p.has_preview = 1))`
    )
    .all() as { id: number; size: number; quick_hash: string | null; pixel_hash: string | null; has_preview: number; root: string; rel_path: string }[]
  const setQuick = db.prepare('UPDATE photos SET quick_hash = ? WHERE id = ?')
  const setPixel = db.prepare('UPDATE photos SET pixel_hash = ? WHERE id = ?')
  let done = 0
  for (const r of rows) {
    if (signal?.aborted) break
    try {
      if (!r.quick_hash) setQuick.run(await quickHash(path.join(r.root, ...r.rel_path.split('/')), r.size), r.id)
      const preview = previewPaths(cacheDir, r.id).preview
      if (!r.pixel_hash && r.has_preview && fs.existsSync(preview)) setPixel.run(await pixelHash(preview), r.id)
    } catch {
      /* unreadable now; tried again next time */
    }
    if (++done % 20 === 0) report(done, rows.length)
  }
  report(rows.length, rows.length)
  return rows.length
}

interface Row {
  id: number
  size: number
  quick_hash: string | null
  sha256: string | null
  pixel_hash: string | null
}

/** Groups of duplicates, largest first. Computes full SHA-256s where quick hashes collide. */
export async function findDuplicates(db: Db, signal?: AbortSignal): Promise<DuplicateGroup[]> {
  const rows = db.prepare('SELECT id, size, quick_hash, sha256, pixel_hash FROM photos WHERE offline = 0').all() as unknown as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ignored = new Set((db.prepare('SELECT a, b FROM not_duplicates').all() as { a: number; b: number }[]).map((r) => `${r.a}:${r.b}`))
  const pairIgnored = (a: number, b: number): boolean => ignored.has(a < b ? `${a}:${b}` : `${b}:${a}`)

  // Exact: same size and quick hash, confirmed by SHA-256.
  const quick = new Map<string, number[]>()
  for (const r of rows) if (r.quick_hash) (quick.get(`${r.size}:${r.quick_hash}`) ?? quick.set(`${r.size}:${r.quick_hash}`, []).get(`${r.size}:${r.quick_hash}`)!).push(r.id)
  const setSha = db.prepare('UPDATE photos SET sha256 = ? WHERE id = ?')
  const exact = new Map<string, number[]>()
  for (const ids of quick.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      if (signal?.aborted) throw new Error('Cancelled.')
      const r = byId.get(id)!
      if (!r.sha256) {
        const [p] = getPhotos(db, [id])
        try {
          r.sha256 = await sha256File(p.path)
          setSha.run(r.sha256, id)
        } catch {
          continue
        }
      }
      ;(exact.get(r.sha256) ?? exact.set(r.sha256, []).get(r.sha256)!).push(id)
    }
  }
  const groups: { tier: DuplicateGroup['tier']; ids: number[] }[] = []
  const inExact = new Set<number>()
  for (const ids of exact.values())
    if (ids.length > 1) {
      groups.push({ tier: 'exact', ids })
      ids.forEach((id) => inExact.add(id))
    }
  // Same picture: identical pixels, different files (re-tagged, renamed, a pair's JPEG copied elsewhere).
  const pixels = new Map<string, number[]>()
  for (const r of rows) if (r.pixel_hash) (pixels.get(r.pixel_hash) ?? pixels.set(r.pixel_hash, []).get(r.pixel_hash)!).push(r.id)
  for (const ids of pixels.values()) {
    if (ids.length < 2) continue
    // Copies already grouped as exact count once: keep one of each exact set in this group.
    const shas = new Set<string>()
    const members = ids.filter((id) => {
      const s = byId.get(id)!.sha256
      if (!inExact.has(id) || !s) return true
      if (shas.has(s)) return false
      shas.add(s)
      return true
    })
    if (members.length > 1 && !members.every((id) => inExact.has(id))) groups.push({ tier: 'picture', ids: members })
  }

  const out: DuplicateGroup[] = []
  for (const g of groups) {
    const ids = g.ids.filter((a) => g.ids.some((b) => a !== b && !pairIgnored(a, b)))
    if (ids.length < 2) continue
    const photos = describe(db, ids)
    out.push({ key: `${g.tier}:${[...ids].sort((a, b) => a - b).join(',')}`, tier: g.tier, photos, keeper: suggestKeeper(photos) })
  }
  return out.sort((a, b) => (a.tier === b.tier ? b.photos.length - a.photos.length : a.tier === 'exact' ? -1 : 1))
}

function describe(db: Db, ids: number[]): DuplicatePhoto[] {
  const kw = db.prepare('SELECT COUNT(*) AS c FROM photo_keywords WHERE photo_id = ?')
  const al = db.prepare('SELECT COUNT(*) AS c FROM album_photos WHERE photo_id = ?')
  return getPhotos(db, ids).map((p) => ({ ...p, keywordCount: (kw.get(p.id) as { c: number }).c, albumCount: (al.get(p.id) as { c: number }).c }))
}

/**
 * The photo to keep, in order: a RAW (or a pair) over other formats, more pixels, edited or marked (rating, flag,
 * label, keywords, albums), the oldest, then the largest file.
 */
export function suggestKeeper(photos: DuplicatePhoto[]): number {
  const score = (p: DuplicatePhoto): number[] => [
    p.kind === 'raw' ? 1 : 0,
    p.companion ? 1 : 0,
    (p.width ?? 0) * (p.height ?? 0),
    (p.edit ? 1 : 0) + (p.rating ? 1 : 0) + (p.flag ? 1 : 0) + (p.label ? 1 : 0) + (p.keywordCount ? 1 : 0) + (p.albumCount ? 1 : 0),
    -(p.takenAt ?? Infinity),
    -p.addedAt,
    p.size
  ]
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  }
  return [...photos].sort((a, b) => cmp(score(b), score(a)))[0].id
}

/** Keeps one photo of a group: the others' marks, keywords and albums move to it, and their files go to the trash. */
export async function mergeGroup(db: Db, cacheDir: string, keep: number, drop: number[], trash: (f: string) => Promise<void>): Promise<{ merged: number; error?: string }> {
  let merged = 0
  let error: string | undefined
  for (const p of getPhotos(db, drop.filter((id) => id !== keep))) {
    try {
      await trashSet(photoFiles(p), 'all', trash)
      mergePhotos(db, keep, p.id)
      removeCached(cacheDir, p.id)
      merged++
    } catch (e) {
      error ??= (e as Error).message
    }
  }
  return { merged, error }
}

/** Remembers that a group's photos aren't duplicates of each other. */
export function markNotDuplicates(db: Db, ids: number[]): void {
  const ins = db.prepare('INSERT OR IGNORE INTO not_duplicates (a, b) VALUES (?, ?)')
  for (const a of ids) for (const b of ids) if (a < b) ins.run(a, b)
}
