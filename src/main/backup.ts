// Catalog backups (consistent SQLite snapshot + manifest with checksums), an optional incremental
// mirror of the originals, verification, and restore with library-folder remapping.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Db } from './db'
import type { BackupEntry, BackupManifest } from '../shared/types'

export const BACKUP_SUFFIX = '.glimmr-backup'
export const ORIGINALS_DIR = 'Glimmr Originals'

export async function sha256(file: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', resolve)
      .on('error', reject)
  })
  return hash.digest('hex')
}

function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export function integrityOk(dbFile: string): boolean {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    const r = db.prepare('PRAGMA integrity_check').get() as Record<string, string>
    return Object.values(r)[0] === 'ok'
  } finally {
    db.close()
  }
}

/** Folder name for a library root inside the originals mirror. */
export const mirrorName = (root: { id: number; name: string }): string => `${root.id}-${root.name.replace(/[<>:"/\\|?*]/g, '_')}`

export interface BackupOptions {
  destination: string
  appVersion: string
  includeOriginals: boolean
  keep: number
  onProgress?: (done: number, total: number, message?: string) => void
  signal?: AbortSignal
}

export async function createBackup(db: Db, opts: BackupOptions): Promise<BackupEntry> {
  await fs.promises.mkdir(opts.destination, { recursive: true })
  const check = db.prepare('PRAGMA integrity_check').get() as Record<string, string>
  if (Object.values(check)[0] !== 'ok') throw new Error('The catalog failed its integrity check; backup stopped so a damaged copy is not saved.')

  const dir = path.join(opts.destination, `Glimmr ${stamp()}${BACKUP_SUFFIX}`)
  const tmp = `${dir}.partial`
  await fs.promises.rm(tmp, { recursive: true, force: true })
  await fs.promises.mkdir(tmp, { recursive: true })
  opts.onProgress?.(0, 1, 'Saving catalog snapshot…')
  const catalogFile = path.join(tmp, 'catalog.db')
  // VACUUM INTO writes a consistent, compact copy even while the app keeps using the catalog.
  db.prepare('VACUUM INTO ?').run(catalogFile)
  if (!integrityOk(catalogFile)) throw new Error('The catalog snapshot failed verification.')

  const roots = db.prepare('SELECT id, path, name FROM roots').all() as { id: number; path: string; name: string }[]
  const photoCount = (db.prepare('SELECT COUNT(*) AS c FROM photos').get() as { c: number }).c
  const originals = { included: false, fileCount: 0, bytes: 0 }
  if (opts.includeOriginals) {
    const r = await mirrorOriginals(db, opts.destination, roots, opts)
    Object.assign(originals, { included: true, ...r })
  }

  const manifest: BackupManifest = {
    app: 'GlimmR',
    formatVersion: 1,
    appVersion: opts.appVersion,
    createdAt: Date.now(),
    photoCount,
    roots,
    files: [{ path: 'catalog.db', size: fs.statSync(catalogFile).size, sha256: await sha256(catalogFile) }],
    originals
  }
  await fs.promises.writeFile(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await fs.promises.rename(tmp, dir)
  await prune(opts.destination, opts.keep)
  return { path: dir, manifest }
}

/**
 * Copies every cataloged original (and its XMP sidecar) into `<destination>/Glimmr Originals/<root>/…`.
 * Files already present with the same size and mtime are skipped; copies are verified by size and checksum.
 */
async function mirrorOriginals(
  db: Db,
  destination: string,
  roots: { id: number; path: string; name: string }[],
  opts: BackupOptions
): Promise<{ fileCount: number; bytes: number }> {
  const rows = db.prepare('SELECT root_id, rel_path FROM photos WHERE offline = 0').all() as { root_id: number; rel_path: string }[]
  const byId = new Map(roots.map((r) => [r.id, r]))
  let done = 0
  let fileCount = 0
  let bytes = 0
  for (const row of rows) {
    if (opts.signal?.aborted) throw new Error('Backup cancelled')
    const root = byId.get(row.root_id)!
    const src = path.join(root.path, ...row.rel_path.split('/'))
    const dst = path.join(destination, ORIGINALS_DIR, mirrorName(root), ...row.rel_path.split('/'))
    const base = src.slice(0, src.length - path.extname(src).length)
    const pairs: [string, string][] = [[src, dst]]
    for (const side of [`${base}.xmp`, `${src}.xmp`])
      if (fs.existsSync(side)) pairs.push([side, path.join(path.dirname(dst), path.basename(side))])
    for (const [from, to] of pairs) {
      const st = await fs.promises.stat(from)
      const existing = await fs.promises.stat(to).catch(() => null)
      if (!existing || existing.size !== st.size || Math.abs(existing.mtimeMs - st.mtimeMs) > 2000) {
        await fs.promises.mkdir(path.dirname(to), { recursive: true })
        const partial = `${to}.partial`
        await fs.promises.copyFile(from, partial)
        if ((await sha256(from)) !== (await sha256(partial))) throw new Error(`Copy verification failed for ${from}`)
        await fs.promises.utimes(partial, st.atime, st.mtime)
        await fs.promises.rename(partial, to)
      }
      fileCount++
      bytes += st.size
    }
    done++
    if (done % 10 === 0 || done === rows.length) opts.onProgress?.(done, rows.length, 'Backing up originals…')
  }
  return { fileCount, bytes }
}

async function prune(destination: string, keep: number): Promise<void> {
  if (keep <= 0) return
  const list = await listBackups(destination)
  for (const old of list.slice(keep)) await fs.promises.rm(old.path, { recursive: true, force: true })
}

/** Backups in a destination folder, newest first. */
export async function listBackups(destination: string | null): Promise<BackupEntry[]> {
  if (!destination || !fs.existsSync(destination)) return []
  const out: BackupEntry[] = []
  for (const name of await fs.promises.readdir(destination)) {
    if (!name.endsWith(BACKUP_SUFFIX)) continue
    const entry = readBackup(path.join(destination, name))
    if (entry) out.push(entry)
  }
  return out.sort((a, b) => b.manifest.createdAt - a.manifest.createdAt)
}

export function readBackup(dir: string): BackupEntry | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as BackupManifest
    if (manifest.app !== 'GlimmR') return null
    return { path: dir, manifest }
  } catch {
    return null
  }
}

export async function verifyBackup(dir: string): Promise<{ ok: boolean; problems: string[] }> {
  const entry = readBackup(dir)
  if (!entry) return { ok: false, problems: ['manifest.json is missing or unreadable'] }
  const problems: string[] = []
  for (const f of entry.manifest.files) {
    const p = path.join(dir, f.path)
    if (!fs.existsSync(p)) {
      problems.push(`${f.path} is missing`)
      continue
    }
    if ((await sha256(p)) !== f.sha256) problems.push(`${f.path} does not match its checksum`)
  }
  const catalog = path.join(dir, 'catalog.db')
  if (fs.existsSync(catalog) && !problems.length && !integrityOk(catalog)) problems.push('catalog.db failed the SQLite integrity check')
  return { ok: problems.length === 0, problems }
}

/** Path of a root's copy inside the originals mirror next to a backup, if it exists. */
export function mirroredRootPath(backupDir: string, root: { id: number; name: string }): string | null {
  const p = path.join(path.dirname(backupDir), ORIGINALS_DIR, mirrorName(root))
  return fs.existsSync(p) ? p : null
}

/**
 * Replaces the catalog file with the backup's copy and remaps library roots. The caller must have
 * closed the live database first and reopens it afterwards.
 */
export async function restoreCatalogFile(backupDir: string, catalogPath: string, rootMap: Record<number, string>): Promise<void> {
  const v = await verifyBackup(backupDir)
  if (!v.ok) throw new Error(`Backup failed verification: ${v.problems.join('; ')}`)
  const tmp = `${catalogPath}.restoring`
  await fs.promises.copyFile(path.join(backupDir, 'catalog.db'), tmp)
  const db = new DatabaseSync(tmp)
  try {
    const upd = db.prepare('UPDATE roots SET path = ? WHERE id = ?')
    for (const [id, p] of Object.entries(rootMap)) if (p) upd.run(path.resolve(p), Number(id))
    // Previews are regenerated for the restored catalog.
    db.exec('UPDATE photos SET has_preview = 0')
  } finally {
    db.close()
  }
  for (const ext of ['', '-wal', '-shm']) await fs.promises.rm(catalogPath + ext, { force: true })
  await fs.promises.rename(tmp, catalogPath)
}
