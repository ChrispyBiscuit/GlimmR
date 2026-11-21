// Memory cards and other drives with photos: polled every 2 s, since Electron has no event for a mounted volume.
// A volume counts as a card when it has a DCIM folder at its top (the camera file system standard).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Volume {
  path: string
  name: string
  /** Has a DCIM folder: a camera card. */
  dcim: boolean
}

/** Resolves false instead of hanging on a slow or disconnected drive. */
function exists(p: string, ms = 1500): Promise<boolean> {
  return Promise.race([fs.promises.access(p).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
}

async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

/** Mounted volumes that could hold photos, other than the system drive. */
export async function candidateVolumes(platform = process.platform): Promise<string[]> {
  if (platform === 'win32') {
    const system = (process.env.SystemDrive ?? 'C:').toUpperCase()
    const letters = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:`).filter((l) => l !== system)
    const ok = await Promise.all(letters.map((l) => exists(`${l}\\`)))
    return letters.filter((_, i) => ok[i]).map((l) => `${l}\\`)
  }
  if (platform === 'darwin') {
    const vols = await subdirs('/Volumes')
    // The startup disk is listed as a link to /.
    const real = await Promise.all(vols.map((v) => fs.promises.realpath(v).catch(() => v)))
    return vols.filter((_, i) => real[i] !== '/')
  }
  const user = os.userInfo().username
  const lists = await Promise.all([`/media/${user}`, `/run/media/${user}`, '/media', '/mnt'].map(subdirs))
  return [...new Set(lists.flat())].filter((v) => !v.endsWith(`/media/${user}`) && !v.endsWith(`/run/media/${user}`))
}

export async function listVolumes(): Promise<Volume[]> {
  const out: Volume[] = []
  for (const v of await candidateVolumes()) {
    const names = await fs.promises.readdir(v).catch(() => [] as string[])
    const dcim = names.some((n) => n.toUpperCase() === 'DCIM')
    out.push({ path: v, name: volumeName(v), dcim })
  }
  return out
}

export function volumeName(v: string): string {
  if (/^[A-Z]:\\?$/i.test(v)) return `Drive ${v.slice(0, 2).toUpperCase()}`
  return path.basename(v) || v
}

/** Calls back with the cards present whenever the set changes. */
export function watchCards(onChange: (cards: Volume[]) => void, everyMs = 2000): () => void {
  let last = ''
  let stopped = false
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy || stopped) return
    busy = true
    try {
      const cards = (await listVolumes()).filter((v) => v.dcim)
      const key = cards.map((c) => c.path).join('|')
      if (key !== last) {
        last = key
        onChange(cards)
      }
    } finally {
      busy = false
    }
  }
  void tick()
  const t = setInterval(() => void tick(), everyMs)
  return () => {
    stopped = true
    clearInterval(t)
  }
}
