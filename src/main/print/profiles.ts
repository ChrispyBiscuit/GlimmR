// Finds ICC profiles in the operating system's colour folders and Glimmr's own, for printing and soft proofing.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { profileInfo } from './color'
import type { IccProfile } from '../../shared/types'

/** Where each platform keeps colour profiles. Printer drivers install paper profiles into these. */
export function systemProfileDirs(): string[] {
  const home = os.homedir()
  if (process.platform === 'darwin') {
    const printers = '/Library/Printers'
    const vendor = fs.existsSync(printers)
      ? fs.readdirSync(printers).flatMap((d) => [path.join(printers, d, 'Profiles'), path.join(printers, d, 'Resources')])
      : []
    return ['/Library/ColorSync/Profiles', path.join(home, 'Library/ColorSync/Profiles'), '/System/Library/ColorSync/Profiles', ...vendor]
  }
  if (process.platform === 'win32') return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'System32', 'spool', 'drivers', 'color')]
  return ['/usr/share/color/icc', '/usr/local/share/color/icc', path.join(home, '.local/share/icc'), path.join(home, '.color/icc'), '/var/lib/colord/icc']
}

const CLASSES: Record<string, IccProfile['kind']> = { prtr: 'printer', mntr: 'display', spac: 'space', scnr: 'other' }

/** Reads the ICC header: device class and colour space. Null when it isn't an ICC profile. */
export function readHeader(file: string): { kind: IccProfile['kind']; space: string } | null {
  let fd: number | null = null
  try {
    fd = fs.openSync(file, 'r')
    const h = Buffer.alloc(128)
    if (fs.readSync(fd, h, 0, 128, 0) < 128 || h.toString('latin1', 36, 40) !== 'acsp') return null
    return { kind: CLASSES[h.toString('latin1', 12, 16)] ?? 'other', space: h.toString('latin1', 16, 20).trim() }
  } catch {
    return null
  } finally {
    if (fd != null) fs.closeSync(fd)
  }
}

function walk(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 3) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1, out)
    else if (/\.(icc|icm)$/i.test(e.name)) out.push(p)
  }
  return out
}

/**
 * RGB and CMYK profiles usable for printing: printer (paper) profiles first, then colour spaces and display
 * profiles, which are useful for file output. Glimmr's own folder holds profiles the user added.
 */
export async function listProfiles(userDir: string): Promise<IccProfile[]> {
  const seen = new Set<string>()
  const out: IccProfile[] = []
  for (const [dir, source] of [[userDir, 'added'] as const, ...systemProfileDirs().map((d) => [d, 'system'] as const)]) {
    for (const file of walk(dir)) {
      const real = fs.realpathSync.native(file)
      if (seen.has(real)) continue
      seen.add(real)
      const h = readHeader(file)
      if (!h || (h.space !== 'RGB' && h.space !== 'CMYK')) continue
      let name = path.basename(file).replace(/\.(icc|icm)$/i, '')
      try {
        name = (await profileInfo(file)).description || name
      } catch {
        continue
      }
      out.push({ path: file, name, kind: h.kind, space: h.space as 'RGB' | 'CMYK', source })
    }
  }
  const order: Record<IccProfile['kind'], number> = { printer: 0, space: 1, display: 2, other: 3 }
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
}

/** Copies a profile into Glimmr's folder so it's always listed. */
export async function addProfile(userDir: string, file: string): Promise<string> {
  const h = readHeader(file)
  if (!h) throw new Error('That file isn’t an ICC colour profile.')
  if (h.space !== 'RGB' && h.space !== 'CMYK') throw new Error('Only RGB and CMYK profiles can be used for printing.')
  await profileInfo(file)
  fs.mkdirSync(userDir, { recursive: true })
  const dest = path.join(userDir, path.basename(file))
  fs.copyFileSync(file, dest)
  return dest
}
