// Develop settings, history, styles and LUTs in the catalog. Additive tables and columns only (docs/DEVELOP_PRD.md
// BR-4), so catalogs stay usable by builds without the develop module.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { type Db, tx } from '../db'
import { RAW_EXTS } from '../../shared/formats'
import { packLut, parseLut, unpackLut, type Lut } from '../../shared/develop/lut'
import { applyPartial, changedGroups, defaultSettings, sanitize, type DevelopSettings, type PartialSettings, type SourceKind } from '../../shared/develop/settings'
import type { LutInfo, StyleInfo } from '../../shared/types'

const HISTORY_MAX = 100
/** Repeats of the same change within this long make one history step. */
const MERGE_MS = 3000

/** The kind of develop source a photo has (raw for raw files and pairs; LibRaw failures are handled at render). */
export function kindOf(db: Db, id: number): SourceKind {
  const r = db.prepare('SELECT ext FROM photos WHERE id = ?').get(id) as { ext: string } | undefined
  return r && RAW_EXTS.has(r.ext) ? 'raw' : 'display'
}

export function getDevelop(db: Db, id: number, kind = kindOf(db, id)): DevelopSettings | null {
  const r = db.prepare('SELECT develop FROM photos WHERE id = ?').get(id) as { develop: string | null } | undefined
  if (!r?.develop) return null
  try {
    return sanitize(JSON.parse(r.develop), kind)
  } catch {
    return null
  }
}

/** Saves a photo's develop settings (null resets), with a history step. Settings equal to the defaults reset. */
export function setDevelop(db: Db, id: number, settings: DevelopSettings | null, label: string, kind = kindOf(db, id)): void {
  const s = settings ? sanitize(settings, kind) : null
  const isDefault = !s || (!changedGroups(s, kind).length && !s.styles.length)
  tx(db, () => {
    db.prepare('UPDATE photos SET develop = ?, develop_at = ? WHERE id = ?').run(isDefault ? null : JSON.stringify(s), Date.now() % 1e9, id)
    const last = db.prepare('SELECT seq, label, at FROM develop_history WHERE photo_id = ? ORDER BY seq DESC LIMIT 1').get(id) as { seq: number; label: string; at: number } | undefined
    const json = JSON.stringify(s ?? defaultSettings(kind))
    // Nudging one control again and again (arrow keys, several drags) is one step.
    if (last && last.label === label && Date.now() - last.at < MERGE_MS) {
      db.prepare('UPDATE develop_history SET settings = ?, at = ? WHERE photo_id = ? AND seq = ?').run(json, Date.now(), id, last.seq)
      return
    }
    const seq = (last?.seq ?? 0) + 1
    db.prepare('INSERT INTO develop_history (photo_id, seq, label, settings, at) VALUES (?, ?, ?, ?, ?)').run(id, seq, label, json, Date.now())
    db.prepare('DELETE FROM develop_history WHERE photo_id = ? AND seq <= ?').run(id, seq - HISTORY_MAX)
  })
}

export function history(db: Db, id: number): { seq: number; label: string; at: number; settings: DevelopSettings }[] {
  const kind = kindOf(db, id)
  return (db.prepare('SELECT seq, label, at, settings FROM develop_history WHERE photo_id = ? ORDER BY seq').all(id) as { seq: number; label: string; at: number; settings: string }[]).map((r) => ({
    seq: r.seq,
    label: r.label,
    at: r.at,
    settings: sanitize(JSON.parse(r.settings), kind)
  }))
}

/** Applies some groups of settings (a paste, a sync or a style) to photos. */
export function applyToMany(db: Db, ids: number[], partial: PartialSettings, label: string, opts: { amount?: number; style?: string } = {}): number[] {
  const done: number[] = []
  for (const id of ids) {
    const kind = kindOf(db, id)
    // White balance in kelvin only makes sense between raw files, and relative values between other files.
    const p = { ...partial }
    if (p.wb && p.wb.mode === 'custom' && (kind === 'raw') !== (p.wb.temp > 200)) delete p.wb
    let s = applyPartial(getDevelop(db, id, kind) ?? defaultSettings(kind), p, opts.amount ?? 1)
    if (opts.style && !s.styles.includes(opts.style)) s = { ...s, styles: [...s.styles, opts.style] }
    setDevelop(db, id, s, label, kind)
    done.push(id)
  }
  return done
}

// ---- LUTs ----

export function addLut(db: Db, name: string, text: string, folder = '', inLibrary = true): { sha: string; lut: Lut } {
  const lut = parseLut(name, text)
  const bytes = packLut(lut)
  const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  db.prepare(
    'INSERT INTO luts (sha, name, folder, data, notes, in_library, added_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sha) DO UPDATE SET in_library = MAX(in_library, excluded.in_library)'
  ).run(sha, lut.title || name.replace(/\.(cube|3dl)$/i, ''), folder, bytes, lut.notes.join('; '), inLibrary ? 1 : 0, Date.now())
  return { sha, lut }
}

/** Adds .cube/.3dl files, or folders of them (packs keep their folder names). */
export function importLutFiles(db: Db, paths: string[]): { added: LutInfo[]; failed: { file: string; error: string }[] } {
  const added: LutInfo[] = []
  const failed: { file: string; error: string }[] = []
  const walk = (p: string, folder: string): void => {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(p).sort()) if (!n.startsWith('.')) walk(path.join(p, n), folder ? `${folder}/${path.basename(p)}` : path.basename(p))
      return
    }
    if (!/\.(cube|3dl)$/i.test(p)) return
    try {
      const { sha } = addLut(db, path.basename(p), fs.readFileSync(p, 'utf8'), folder)
      added.push(lutInfo(db, sha)!)
    } catch (e) {
      failed.push({ file: path.basename(p), error: (e as Error).message })
    }
  }
  for (const p of paths) walk(p, '')
  return { added, failed }
}

export function lutInfo(db: Db, sha: string): LutInfo | null {
  const r = db.prepare('SELECT sha, name, folder, notes, in_library FROM luts WHERE sha = ?').get(sha) as { sha: string; name: string; folder: string; notes: string; in_library: number } | undefined
  return r ? { sha: r.sha, name: r.name, folder: r.folder, notes: r.notes, inLibrary: !!r.in_library } : null
}

export function listLuts(db: Db): LutInfo[] {
  return (db.prepare('SELECT sha FROM luts WHERE in_library = 1 ORDER BY folder COLLATE NOCASE, name COLLATE NOCASE').all() as { sha: string }[]).map((r) => lutInfo(db, r.sha)!)
}

export function lutBytes(db: Db, sha: string): Uint8Array | null {
  const r = db.prepare('SELECT data FROM luts WHERE sha = ?').get(sha) as { data: Uint8Array } | undefined
  return r ? new Uint8Array(r.data) : null
}

export const loadLut = (db: Db, sha: string): Lut | null => {
  const b = lutBytes(db, sha)
  return b ? unpackLut(b) : null
}

/** Takes a LUT out of the library list; photos and styles using it keep their copy. */
export function removeLut(db: Db, sha: string): void {
  db.prepare('UPDATE luts SET in_library = 0 WHERE sha = ?').run(sha)
}

// ---- styles ----

export function listStyles(db: Db): StyleInfo[] {
  return (db.prepare('SELECT id, name, folder, settings, lut, report, builtin FROM styles ORDER BY builtin DESC, folder COLLATE NOCASE, name COLLATE NOCASE').all() as {
    id: number
    name: string
    folder: string
    settings: string
    lut: string | null
    report: string
    builtin: number
  }[]).map((r) => ({ id: r.id, name: r.name, folder: r.folder, settings: JSON.parse(r.settings) as PartialSettings, lut: r.lut, report: r.report ? (JSON.parse(r.report) as StyleInfo['report']) : null, builtIn: !!r.builtin }))
}

export function saveStyle(db: Db, name: string, settings: PartialSettings, opts: { folder?: string; report?: StyleInfo['report']; builtIn?: boolean } = {}): number {
  const lut = settings.look?.lut ?? null
  return Number(
    db
      .prepare('INSERT INTO styles (name, folder, settings, lut, report, builtin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(name.trim() || 'Style', opts.folder ?? '', JSON.stringify(settings), lut, opts.report ? JSON.stringify(opts.report) : '', opts.builtIn ? 1 : 0, Date.now()).lastInsertRowid
  )
}

export function renameStyle(db: Db, id: number, name: string): void {
  db.prepare('UPDATE styles SET name = ? WHERE id = ? AND builtin = 0').run(name.trim(), id)
}

export function deleteStyle(db: Db, id: number): void {
  db.prepare('DELETE FROM styles WHERE id = ? AND builtin = 0').run(id)
}

/** Built-in styles, added once. "Camera-like" is the punchier look camera JPEGs have (the default is neutral). */
export function ensureBuiltInStyles(db: Db): void {
  if (db.prepare('SELECT 1 FROM styles WHERE builtin = 1 LIMIT 1').get()) return
  const add = (name: string, s: PartialSettings): number => saveStyle(db, name, s, { builtIn: true, folder: 'Glimmr' })
  add('Camera-like', { contrast: 25, vibrance: 20, saturation: 8, blacks: -10, curve: { ...defaultSettings('display').curve, darks: -10, lights: 10 } })
  add('Soft and bright', { exposure: 0.3, contrast: -15, highlights: -30, shadows: 30, vibrance: 10, curve: { ...defaultSettings('display').curve, shadows: 15 } })
  add('Punchy', { contrast: 40, whites: 15, blacks: -20, vibrance: 35, saturation: 10 })
  add('Black and white', { bw: { on: true, mix: [10, 10, 0, -10, -10, -20, 0, 0] }, contrast: 20 })
  add('Black and white, high contrast', { bw: { on: true, mix: [20, 20, 10, -20, -20, -40, -10, 10] }, contrast: 55, whites: 20, blacks: -25 })
  add('Faded film', { contrast: -10, blacks: 25, saturation: -15, curve: { ...defaultSettings('display').curve, shadows: 20, highlights: -10 } })
}

// ---- .glimmrstyle files ----

export interface StyleFile {
  glimmrStyle: 1
  name: string
  settings: PartialSettings
  /** The style's LUT, packed and base64-encoded, so a style is one self-contained file. */
  lut?: { name: string; data: string } | null
}

export function exportStyle(db: Db, id: number): StyleFile {
  const s = listStyles(db).find((x) => x.id === id)
  if (!s) throw new Error('That style no longer exists.')
  const lut = s.lut ? db.prepare('SELECT name, data FROM luts WHERE sha = ?').get(s.lut) as { name: string; data: Uint8Array } | undefined : undefined
  return { glimmrStyle: 1, name: s.name, settings: s.settings, lut: lut ? { name: lut.name, data: Buffer.from(lut.data).toString('base64') } : null }
}

export function importStyleFile(db: Db, text: string, fileName: string): StyleInfo {
  const f = JSON.parse(text) as StyleFile
  if (f.glimmrStyle !== 1 || typeof f.settings !== 'object') throw new Error('Not a Glimmr style file.')
  const settings = { ...f.settings }
  if (f.lut?.data) {
    const bytes = new Uint8Array(Buffer.from(f.lut.data, 'base64'))
    unpackLut(bytes) // validates
    const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)
    db.prepare('INSERT OR IGNORE INTO luts (sha, name, folder, data, notes, in_library, added_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(sha, f.lut.name, '', bytes, '', Date.now())
    if (settings.look) settings.look = { ...settings.look, lut: sha }
  }
  const id = saveStyle(db, f.name || fileName.replace(/\.glimmrstyle$/i, ''), settings, { report: { exact: ['Glimmr style'], approximate: [], unsupported: [] } })
  return listStyles(db).find((s) => s.id === id)!
}
