// The files that make up one photo: the main file (the RAW of a pair), the camera JPEG paired with it, and the
// sidecars that belong to either. Moves, renames, deletes, backups and imports all work on this set, so a photo's
// files always travel together.

import fs from 'node:fs'
import path from 'node:path'

/** Formats a camera writes next to a RAW, shown in its place (the pair's displayed file). */
export const DISPLAY_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'heic', 'heif', 'hif'])

export interface PhotoFileSet {
  main: string
  companion: string | null
  /** Sidecars that exist: .xmp (IMG.xmp and IMG.CR3.xmp), .AAE, .THM, Capture One settings. */
  sidecars: string[]
}

/** The file shown for a photo: the camera JPEG of a pair, otherwise the main file. */
export function displayFile(p: { path: string; ext: string; companion: string | null }): { path: string; ext: string } {
  return p.companion ? { path: p.companion, ext: path.extname(p.companion).slice(1).toLowerCase() } : { path: p.path, ext: p.ext }
}

const stem = (name: string): string => name.slice(0, name.length - path.extname(name).length)

function listDir(dir: string, cache?: Map<string, string[]>): string[] {
  const hit = cache?.get(dir)
  if (hit) return hit
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    names = []
  }
  cache?.set(dir, names)
  return names
}

/** Sidecar names (lower case) that belong to these files in one folder. */
function sidecarNames(files: string[]): Set<string> {
  const out = new Set<string>()
  for (const f of files) {
    const name = path.basename(f).toLowerCase()
    const base = stem(name)
    for (const n of [`${base}.xmp`, `${name}.xmp`, `${base}.aae`, `${base}.thm`]) out.add(n)
  }
  return out
}

/** Every existing file of a photo. Pass a cache when calling for many photos in the same folders. */
export function photoFiles(p: { path: string; companion: string | null }, cache?: Map<string, string[]>): PhotoFileSet {
  const dir = path.dirname(p.path)
  const own = [p.path, ...(p.companion ? [p.companion] : [])]
  const wanted = sidecarNames(own)
  const ownNames = new Set(own.map((f) => path.basename(f).toLowerCase()))
  const sidecars = listDir(dir, cache)
    .filter((n) => wanted.has(n.toLowerCase()) && !ownNames.has(n.toLowerCase()))
    .map((n) => path.join(dir, n))
  // Capture One keeps edits in CaptureOne/Settings<version>/<file name>.cos (and .comask) next to the images.
  const c1 = listDir(dir, cache).find((n) => n.toLowerCase() === 'captureone')
  if (c1) {
    const settingsNames = new Set(own.flatMap((f) => [`${path.basename(f)}.cos`, `${path.basename(f)}.comask`].map((n) => n.toLowerCase())))
    for (const sub of listDir(path.join(dir, c1), cache).filter((n) => /^settings/i.test(n)))
      for (const n of listDir(path.join(dir, c1, sub), cache)) if (settingsNames.has(n.toLowerCase())) sidecars.push(path.join(dir, c1, sub, n))
  }
  return { main: p.path, companion: p.companion && fs.existsSync(p.companion) ? p.companion : null, sidecars }
}

/** All the files as one list, main file first. */
export const allFiles = (s: PhotoFileSet): string[] => [s.main, ...(s.companion ? [s.companion] : []), ...s.sidecars]

/**
 * Where a file of the set goes when the photo's main file is renamed to `newMain` in `toDir`: files named after the
 * main file's stem follow its new stem, others keep their names. Capture One settings keep their sub-path.
 */
export function targetFor(file: string, set: PhotoFileSet, toDir: string, newMainName?: string): string {
  const fromDir = path.dirname(set.main)
  const rel = path.relative(fromDir, file)
  const name = path.basename(file)
  if (!newMainName) return path.join(toDir, rel)
  const oldStem = stem(path.basename(set.main))
  const newStem = stem(newMainName)
  const renamed = name.toLowerCase().startsWith(oldStem.toLowerCase()) ? newStem + name.slice(oldStem.length) : name
  return path.join(toDir, path.dirname(rel), renamed)
}
