// Finds installed photo editors and opens files in them.

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Editor, EditorSettings } from '../shared/types'
import { RAW_EXTS } from './metadata'

interface Candidate {
  id: string
  name: string
  /** Path segments; a RegExp segment matches the newest-looking directory entry. */
  mac: (string | RegExp)[][]
  win: (string | RegExp)[][]
}

const CANDIDATES: Candidate[] = [
  {
    id: 'lightroom-classic',
    name: 'Lightroom Classic',
    mac: [['/Applications', 'Adobe Lightroom Classic', 'Adobe Lightroom Classic.app']],
    win: [['%ProgramFiles%', 'Adobe', 'Adobe Lightroom Classic', 'Lightroom.exe']]
  },
  {
    id: 'lightroom',
    name: 'Lightroom',
    mac: [
      ['/Applications', 'Adobe Lightroom', 'Adobe Lightroom.app'],
      ['/Applications', 'Adobe Lightroom CC', 'Adobe Lightroom CC.app']
    ],
    win: [
      ['%ProgramFiles%', 'Adobe', 'Adobe Lightroom', 'lightroom.exe'],
      ['%ProgramFiles%', 'Adobe', 'Adobe Lightroom CC', 'lightroom.exe']
    ]
  },
  {
    id: 'capture-one',
    name: 'Capture One',
    mac: [['/Applications', /^Capture One.*\.app$/]],
    win: [
      ['%ProgramFiles%', 'Capture One', /^Capture One/, 'CaptureOne.exe'],
      ['%ProgramFiles%', /^Capture One/, 'CaptureOne.exe']
    ]
  },
  {
    id: 'photoshop',
    name: 'Photoshop',
    mac: [['/Applications', /^Adobe Photoshop/, /^Adobe Photoshop.*\.app$/]],
    win: [['%ProgramFiles%', 'Adobe', /^Adobe Photoshop/, 'Photoshop.exe']]
  },
  {
    id: 'affinity',
    name: 'Affinity',
    mac: [['/Applications', /^Affinity( Photo( 2)?)?\.app$/]],
    win: [
      ['%ProgramFiles%', 'Affinity', /^(Photo 2|Photo|Affinity)$/, /^(Photo|Affinity)\.exe$/]
    ]
  },
  {
    id: 'dxo',
    name: 'DxO PhotoLab',
    mac: [['/Applications', /^DxO PhotoLab.*\.app$/]],
    win: [['%ProgramFiles%', 'DxO', /^DxO PhotoLab/, 'DxO.PhotoLab.exe']]
  },
  {
    id: 'darktable',
    name: 'darktable',
    mac: [['/Applications', 'darktable.app']],
    win: [['%ProgramFiles%', 'darktable', 'bin', 'darktable.exe']]
  },
  {
    id: 'gimp',
    name: 'GIMP',
    mac: [['/Applications', /^GIMP.*\.app$/]],
    win: [['%ProgramFiles%', /^GIMP/, 'bin', /^gimp-\d.*\.exe$/]]
  },
  {
    id: 'luminar',
    name: 'Luminar Neo',
    mac: [['/Applications', /^Luminar Neo.*\.app$/]],
    win: [['%ProgramFiles%', 'Skylum', /^Luminar Neo/, /^Luminar Neo.*\.exe$/]]
  },
  {
    id: 'on1',
    name: 'ON1 Photo RAW',
    mac: [['/Applications', /^ON1 Photo RAW/, /^ON1 Photo RAW.*\.app$/]],
    win: [['%ProgramFiles%', 'ON1', /^ON1 Photo RAW/, /^ON1 Photo RAW.*\.exe$/]]
  },
  {
    id: 'pixelmator',
    name: 'Pixelmator Pro',
    mac: [['/Applications', 'Pixelmator Pro.app']],
    win: []
  },
  {
    id: 'preview',
    name: 'Preview',
    mac: [['/System/Applications', 'Preview.app']],
    win: []
  }
]

function expand(seg: string): string {
  return seg.replace(/%(\w+)%/g, (_, v) => process.env[v] ?? process.env[v.toUpperCase()] ?? '')
}

/** Resolves a pattern to an existing path, choosing the last (usually newest) match for RegExp segments. */
export function resolvePattern(segments: (string | RegExp)[]): string | null {
  let current = ''
  for (const seg of segments) {
    if (typeof seg === 'string') {
      current = current ? path.join(current, expand(seg)) : expand(seg)
      if (!current || !fs.existsSync(current)) return null
      continue
    }
    let entries: string[]
    try {
      entries = fs.readdirSync(current)
    } catch {
      return null
    }
    const matches = entries.filter((e) => seg.test(e)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!matches.length) return null
    current = path.join(current, matches[matches.length - 1])
  }
  return current || null
}

export function detectEditors(platform = process.platform): Editor[] {
  const found: Editor[] = []
  for (const c of CANDIDATES) {
    const patterns = platform === 'darwin' ? c.mac : platform === 'win32' ? c.win : []
    for (const p of patterns) {
      const hit = resolvePattern(p)
      if (hit) {
        found.push({ id: c.id, name: c.name, path: hit, args: [], detected: true })
        break
      }
    }
  }
  return found
}

/** Merges freshly detected editors with the user's saved list (custom editors are kept). */
export function mergeEditors(saved: EditorSettings, detected: Editor[]): EditorSettings {
  const custom = saved.editors.filter((e) => !e.detected)
  const detectedWithArgs = detected.map((d) => ({ ...d, args: saved.editors.find((e) => e.id === d.id)?.args ?? [] }))
  const editors = [...detectedWithArgs, ...custom]
  const ids = new Set(editors.map((e) => e.id))
  const perType = Object.fromEntries(Object.entries(saved.perType).filter(([, id]) => ids.has(id)))
  const defaultEditor = saved.defaultEditor && ids.has(saved.defaultEditor) ? saved.defaultEditor : null
  return { editors, perType, defaultEditor }
}

export function editorFor(settings: EditorSettings, ext: string): Editor | null {
  const byType = settings.perType[ext] ?? (RAW_EXTS.has(ext) ? settings.perType.raw : undefined)
  const id = byType ?? settings.defaultEditor
  return settings.editors.find((e) => e.id === id) ?? null
}

export function launchEditor(editor: Editor, files: string[], platform = process.platform): void {
  if (!files.length) return
  let cmd: string
  let args: string[]
  if (platform === 'darwin' && editor.path.endsWith('.app')) {
    cmd = 'open'
    args = ['-a', editor.path, ...files, ...(editor.args.length ? ['--args', ...editor.args] : [])]
  } else {
    cmd = editor.path
    args = [...editor.args, ...files]
  }
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  child.unref()
}
