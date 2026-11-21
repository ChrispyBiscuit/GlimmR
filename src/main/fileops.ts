// File operations on photos: verified copies, moves (across drives too), conflict-free names and trashing a photo
// with everything that belongs to it. Glimmr never overwrites a file and never deletes permanently.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { allFiles, type PhotoFileSet } from './files'
import { isSupported } from './metadata'

export const PART_SUFFIX = '.glimmr-part'

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(file), h)
  return h.digest('hex')
}

/** A quick content fingerprint: size plus a hash of the first and last 64 KB. Cheap enough for every file. */
export async function quickHash(file: string, size?: number): Promise<string> {
  const n = size ?? (await fs.promises.stat(file)).size
  const fh = await fs.promises.open(file, 'r')
  try {
    const chunk = 65536
    const h = crypto.createHash('sha1')
    const head = Buffer.alloc(Math.min(chunk, n))
    await fh.read(head, 0, head.length, 0)
    h.update(head)
    if (n > chunk) {
      const tail = Buffer.alloc(Math.min(chunk, n - chunk))
      await fh.read(tail, 0, tail.length, n - tail.length)
      h.update(tail)
    }
    h.update(String(n))
    return h.digest('hex')
  } finally {
    await fh.close()
  }
}

/**
 * Copies a file and proves the copy: hashes the source while reading it, writes to `<to>.glimmr-part`, flushes it to
 * disk, reads it back and compares, then renames it into place with the source's modified time. Never overwrites:
 * fails if `to` exists. Returns the SHA-256.
 */
export async function verifiedCopy(from: string, to: string, signal?: AbortSignal): Promise<string> {
  if (fs.existsSync(to)) throw new Error(`${to} already exists`)
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  const part = to + PART_SUFFIX
  const st = await fs.promises.stat(from)
  const h = crypto.createHash('sha256')
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      h.update(chunk)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(fs.createReadStream(from), tap, fs.createWriteStream(part, { flags: 'w' }), { signal })
    const fh = await fs.promises.open(part, 'r+')
    await fh.sync()
    await fh.close()
    const source = h.digest('hex')
    const copy = await sha256File(part)
    if (copy !== source) throw new Error(`The copy of ${path.basename(from)} doesn’t match the original`)
    await fs.promises.utimes(part, st.atime, st.mtime)
    if (fs.existsSync(to)) throw new Error(`${to} already exists`)
    await fs.promises.rename(part, to)
    return source
  } catch (e) {
    await fs.promises.rm(part, { force: true })
    throw e
  }
}

/** Moves a file without overwriting. Across drives it copies with verification, then trashes the original. */
export async function moveFile(from: string, to: string, trash: (f: string) => Promise<void>): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) return
  // A case-only rename on a case-insensitive disk is the same file: allow it.
  const caseOnly = path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()
  if (!caseOnly && fs.existsSync(to)) throw new Error(`${to} already exists`)
  await fs.promises.mkdir(path.dirname(to), { recursive: true })
  try {
    await fs.promises.rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await verifiedCopy(from, to)
    await trash(from)
  }
}

/** `IMG_1234.CR3` → `IMG_1234-1.CR3`, `-2`… until `free(name)` says yes. */
export function uniqueName(name: string, free: (candidate: string) => boolean): string {
  if (free(name)) return name
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 1; ; i++) {
    const c = `${base}-${i}${ext}`
    if (free(c)) return c
  }
}

/** Whether a sidecar named `IMG.xmp` is also used by another photo file of the same name in its folder. */
function sharedSidecar(side: string, set: PhotoFileSet): boolean {
  const name = path.basename(side).toLowerCase()
  const own = new Set(allFiles(set).map((f) => path.basename(f).toLowerCase()))
  const base = name.replace(/\.xmp$/, '')
  if (base.includes('.')) return false // IMG.CR3.xmp belongs to IMG.CR3 only
  try {
    return fs
      .readdirSync(path.dirname(side))
      .some((f) => !own.has(f.toLowerCase()) && f.toLowerCase().startsWith(base + '.') && isSupported(path.extname(f).slice(1).toLowerCase()))
  } catch {
    return false
  }
}

/**
 * Moves a photo's files to the system trash: the whole set, or one half of a RAW + JPEG pair with its own sidecars.
 * Sidecars another photo still uses stay.
 */
export async function trashSet(set: PhotoFileSet, part: 'all' | 'raw' | 'jpeg', trash: (f: string) => Promise<void>): Promise<void> {
  const files: string[] = []
  const mainName = path.basename(set.main).toLowerCase()
  const compName = set.companion ? path.basename(set.companion).toLowerCase() : ''
  if (part !== 'jpeg') files.push(set.main)
  if (part !== 'raw' && set.companion) files.push(set.companion)
  for (const s of set.sidecars) {
    const n = path.basename(s).toLowerCase()
    // A sidecar named after one file goes with that file; IMG.xmp, IMG.AAE and IMG.THM go only when both halves go.
    const forMain = n.startsWith(mainName + '.')
    const forComp = !!compName && n.startsWith(compName + '.')
    const keep = part === 'raw' ? !forMain : part === 'jpeg' ? !forComp : false
    if (!keep && !sharedSidecar(s, set)) files.push(s)
  }
  for (const f of files) if (fs.existsSync(f)) await trash(f)
}
