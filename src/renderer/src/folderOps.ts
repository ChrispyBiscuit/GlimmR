// Folder actions from the sidebar: dropping photos or folders onto a folder, and the folder context menu. Moves and
// copies happen on disk and in the catalog together (see src/main/folders.ts).

import { toast } from 'sonner'
import { api } from './api'
import { choiceDialog, confirmDialog, folderDialog, promptDialog, type FolderOption } from './dialogs'
import { fmtBytes, fmtNum } from './format'
import type { ConflictChoice, FileOpResult, FolderNode, FolderRef } from '../../shared/types'

/** Drag-and-drop payload types. */
export const DND_PHOTOS = 'application/x-glimmr-photos'
export const DND_FOLDER = 'application/x-glimmr-folder'

const mac = navigator.platform.toLowerCase().includes('mac')
const BIN = mac ? 'Trash' : 'Recycle Bin'
export const COPY_KEY = mac ? 'Option' : 'Alt'

export const refOf = (n: FolderNode): FolderRef => ({ rootId: n.rootId, rel: n.relPath })
const nameOf = (f: FolderRef, folders: FolderNode[]): string => findNode(folders, f)?.name ?? (f.rel.split('/').pop() || 'the library folder')

export function findNode(nodes: FolderNode[], f: FolderRef): FolderNode | undefined {
  for (const n of nodes) {
    if (n.rootId === f.rootId && n.relPath === f.rel) return n
    const c = findNode(n.children, f)
    if (c) return c
  }
  return undefined
}

/** Every folder, flattened for the Move to… picker. */
export function folderOptions(nodes: FolderNode[], depth = 0): FolderOption[] {
  return nodes.flatMap((n) => [{ key: `${n.rootId}:${n.relPath}`, label: n.name, depth }, ...folderOptions(n.children, depth + 1)])
}
export const parseKey = (key: string): FolderRef => ({ rootId: Number(key.slice(0, key.indexOf(':'))), rel: key.slice(key.indexOf(':') + 1) })

function report(r: FileOpResult, verb: string, where: string): void {
  if (r.error && !r.done) return void toast.error(`Couldn’t ${verb.toLowerCase()} the photos`, { description: r.error })
  const parts = [`${verb} ${r.done === 1 ? '1 photo' : `${fmtNum(r.done)} photos`} to ${where}`]
  if (r.skipped) parts.push(`${fmtNum(r.skipped)} skipped`)
  if (r.failed) parts.push(`${fmtNum(r.failed)} failed`)
  ;(r.failed ? toast.warning : toast.success)(parts.join(', '), r.error ? { description: r.error } : undefined)
}

/** Moves (or copies) photos into a folder, asking what to do about name clashes first. */
export async function putPhotos(ids: number[], target: FolderRef, folders: FolderNode[], opts: { copy?: boolean; fromRoot?: number; shift?: boolean } = {}): Promise<boolean> {
  if (!ids.length) return false
  // Between drives, a drop copies unless Shift is held, as in Explorer and Finder.
  const copy = opts.copy || (opts.fromRoot != null && !opts.shift && !(await api.sameDrive(opts.fromRoot, target.rootId)))
  const where = `“${nameOf(target, folders)}”`
  let onConflict: ConflictChoice = 'keep'
  const clashes = await api.folderConflicts(ids, target)
  if (clashes.length) {
    const choice = await choiceDialog({
      title: clashes.length === 1 ? `“${clashes[0].name}” is already in ${where}` : `${fmtNum(clashes.length)} photos have names already used in ${where}`,
      description: `Keep both gives the ${copy ? 'copied' : 'moved'} photo${clashes.length === 1 ? '' : 's'} a new name (like IMG_1234-1). Replace sends the file${clashes.length === 1 ? '' : 's'} already there to the ${BIN}. Other photos are ${copy ? 'copied' : 'moved'} either way.`,
      choices: [
        { value: 'skip', label: 'Skip', variant: 'outline' },
        { value: 'replace', label: 'Replace', variant: 'outline' },
        { value: 'keep', label: 'Keep Both', variant: 'default' }
      ]
    })
    if (!choice) return false
    onConflict = choice as ConflictChoice
  }
  const r = await api.putInFolder(ids, target, { copy, onConflict })
  report(r, copy ? 'Copied' : 'Moved', where)
  return r.done > 0
}

export async function moveFolderInto(from: FolderRef, into: FolderRef, folders: FolderNode[], opts: { copy?: boolean; shift?: boolean } = {}): Promise<void> {
  if (from.rootId === into.rootId && (into.rel === from.rel || into.rel.startsWith(from.rel ? `${from.rel}/` : '\0'))) return void toast.error('A folder can’t go inside itself.')
  const copy = opts.copy || (!opts.shift && !(await api.sameDrive(from.rootId, into.rootId)))
  const r = await api.moveFolder(from, into, copy)
  if (r.error) toast.error(`Couldn’t ${copy ? 'copy' : 'move'} “${nameOf(from, folders)}”`, { description: r.error })
  else toast.success(`${copy ? 'Copied' : 'Moved'} “${nameOf(from, folders)}” to “${nameOf(into, folders)}”`)
}

export async function newFolder(parent: FolderRef): Promise<FolderRef | null> {
  const name = await promptDialog({ title: 'New folder', confirmLabel: 'Create Folder', placeholder: 'Lisbon 2026' })
  if (!name) return null
  const r = await api.createFolder(parent, name)
  if (r.error) toast.error('Couldn’t create the folder', { description: r.error })
  return r.ref ?? null
}

export async function renameFolder(f: FolderRef, current: string): Promise<FolderRef | null> {
  const name = await promptDialog({ title: 'Rename folder', description: 'The folder is renamed on disk. Photos keep their marks, albums and edits.', confirmLabel: 'Rename', initial: current })
  if (!name || name === current) return null
  const r = await api.renameFolder(f, name)
  if (r.error) toast.error('Couldn’t rename the folder', { description: r.error })
  return r.ref ?? null
}

export async function moveFolderTo(f: FolderRef, folders: FolderNode[], copy = false): Promise<void> {
  const key = await folderDialog({ title: `${copy ? 'Copy' : 'Move'} “${nameOf(f, folders)}” to…`, folders: folderOptions(folders) })
  if (key) await moveFolderInto(f, parseKey(key), folders, { copy, shift: !copy })
}

export async function movePhotosTo(ids: number[], folders: FolderNode[], copy: boolean, fromRoot?: number): Promise<void> {
  const key = await folderDialog({
    title: `${copy ? 'Copy' : 'Move'} ${ids.length === 1 ? 'this photo' : `${fmtNum(ids.length)} photos`} to…`,
    description: 'RAW + JPEG pairs and sidecars go along.',
    folders: folderOptions(folders)
  })
  if (key) await putPhotos(ids, parseKey(key), folders, { copy, fromRoot, shift: !copy })
}

export async function deleteFolder(f: FolderRef, name: string): Promise<boolean> {
  const st = await api.folderStats(f)
  const extra = st.files > st.photos ? ` (${fmtNum(st.files)} files in all, ${fmtBytes(st.bytes)})` : st.bytes ? ` (${fmtBytes(st.bytes)})` : ''
  const ok = await confirmDialog({
    title: `Move “${name}” to the ${BIN}?`,
    description: st.files
      ? `The folder and everything in it go to the ${BIN}: ${st.photos === 1 ? '1 photo' : `${fmtNum(st.photos)} photos`}${extra}. They’re removed from Glimmr. You can restore the folder from the ${BIN}.`
      : `The empty folder goes to the ${BIN}.`,
    confirmLabel: `Move to ${BIN}`,
    destructive: true
  })
  if (!ok) return false
  const r = await api.deleteFolder(f)
  if (r.error) toast.error('Couldn’t delete the folder', { description: r.error })
  else toast(`Moved “${name}” to the ${BIN}`)
  return !r.error
}
