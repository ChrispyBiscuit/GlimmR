import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { conflictsFor, createFolder, deleteFolder, moveFolder, putInFolder, validName, type FolderDeps } from '../src/main/folders'
import { previewPaths } from '../src/main/previews'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

let dir: string
let photos: string
let bin: string
let lib: Library
let rootId: number
let deps: FolderDeps

const all = () => lib.search({ scope: { type: 'all' }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 100 }).photos
const byName = (n: string) => all().find((p) => p.filename === n)!
const files = (rel = ''): string[] => fs.readdirSync(path.join(photos, rel)).sort()
const rescan = () => scanRoot(lib.db, rootId, photos, { cacheDir: path.join(dir, 'cache') })

beforeEach(async () => {
  dir = tmpDir()
  photos = path.join(dir, 'Photos')
  bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  await makeFakeRaw(path.join(photos, 'Shoot/IMG_1.CR3'))
  await makeJpeg(path.join(photos, 'Shoot/IMG_1.JPG'))
  fs.writeFileSync(path.join(photos, 'Shoot/IMG_1.xmp'), '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
  await makeJpeg(path.join(photos, 'Shoot/beach.jpg'))
  await makeJpeg(path.join(photos, 'Other/IMG_1.JPG'), { color: '#00ff00' })
  lib = new Library(openDb(path.join(dir, 'catalog.db')), path.join(dir, 'cache'))
  rootId = lib.addRoot(photos).id
  await rescan()
  let n = 0
  deps = {
    db: lib.db,
    cacheDir: path.join(dir, 'cache'),
    // A stand-in for the system trash: files move into a folder the test can look at.
    trash: async (f) => fs.renameSync(f, path.join(bin, `${n++}-${path.basename(f)}`))
  }
})

describe('moving photos', () => {
  it('moves a RAW + JPEG pair with its sidecar, keeping the photo and its marks', async () => {
    const pair = byName('IMG_1.CR3')
    lib.update([pair.id], { rating: 5 })
    const r = await putInFolder(deps, [pair.id], { rootId, rel: 'Best' }, { copy: false, onConflict: 'keep' })
    expect(r).toMatchObject({ done: 1, failed: 0 })
    expect(files('Best')).toEqual(['IMG_1.CR3', 'IMG_1.JPG', 'IMG_1.xmp'])
    expect(files('Shoot')).toEqual(['beach.jpg'])
    const moved = byName('IMG_1.CR3')
    expect(moved.id).toBe(pair.id)
    expect([moved.relPath, moved.rating, moved.companion]).toEqual(['Best/IMG_1.CR3', 5, path.join(photos, 'Best', 'IMG_1.JPG')])
    // The catalog already matches the disk: a rescan finds nothing new or missing.
    const scan = await rescan()
    expect([scan.added, scan.offline]).toEqual([0, 0])
  })

  it('reports clashes, and keeps both with a new name for every file of the pair', async () => {
    const pair = byName('IMG_1.CR3')
    expect(conflictsFor(lib.db, [pair.id], { rootId, rel: 'Other' })).toEqual([{ id: pair.id, name: 'IMG_1.CR3' }])
    await putInFolder(deps, [pair.id], { rootId, rel: 'Other' }, { copy: false, onConflict: 'keep' })
    expect(files('Other')).toEqual(['IMG_1-1.CR3', 'IMG_1-1.JPG', 'IMG_1-1.xmp', 'IMG_1.JPG'])
    expect(byName('IMG_1-1.CR3').companion).toBe(path.join(photos, 'Other', 'IMG_1-1.JPG'))
    expect((await rescan()).added).toBe(0)
  })

  it('skips clashes, or replaces the file already there by sending it to the trash', async () => {
    const pair = byName('IMG_1.CR3')
    expect(await putInFolder(deps, [pair.id], { rootId, rel: 'Other' }, { copy: false, onConflict: 'skip' })).toMatchObject({ done: 0, skipped: 1 })
    expect(files('Other')).toEqual(['IMG_1.JPG'])
    const green = all().find((p) => p.relPath === 'Other/IMG_1.JPG')!
    await putInFolder(deps, [pair.id], { rootId, rel: 'Other' }, { copy: false, onConflict: 'replace' })
    expect(files('Other')).toEqual(['IMG_1.CR3', 'IMG_1.JPG', 'IMG_1.xmp'])
    expect(fs.readdirSync(bin).some((f) => f.endsWith('IMG_1.JPG'))).toBe(true)
    expect(all().some((p) => p.id === green.id)).toBe(false)
  })

  it('copies photos as new catalog entries with the same keywords and previews', async () => {
    const beach = byName('beach.jpg')
    lib.update([beach.id], { addKeywords: ['Sea'] })
    await putInFolder(deps, [beach.id], { rootId, rel: 'Other' }, { copy: true, onConflict: 'keep' })
    const copies = all().filter((p) => p.filename === 'beach.jpg')
    expect(copies.map((p) => p.relPath).sort()).toEqual(['Other/beach.jpg', 'Shoot/beach.jpg'])
    const copy = copies.find((p) => p.id !== beach.id)!
    expect(lib.detail(copy.id)!.keywords).toEqual(['Sea'])
    expect(fs.existsSync(previewPaths(deps.cacheDir, copy.id).thumb)).toBe(true)
    expect((await rescan()).added).toBe(0)
  })
})

describe('folders', () => {
  it('creates an empty folder that shows in the tree', () => {
    createFolder(lib.db, { rootId, rel: 'Shoot' }, 'Selects')
    expect(fs.existsSync(path.join(photos, 'Shoot', 'Selects'))).toBe(true)
    const shoot = lib.folderTree()[0].children.find((c) => c.name === 'Shoot')!
    expect(shoot.children.map((c) => [c.name, c.count])).toEqual([['Selects', 0]])
    expect(() => createFolder(lib.db, { rootId, rel: 'Shoot' }, 'Selects')).toThrow(/already there/)
    expect(validName('a/b')).toMatch(/can’t contain/)
    expect(validName('CON')).toMatch(/reserved/)
  })

  it('renames and moves folders with everything in them', async () => {
    const pair = byName('IMG_1.CR3')
    await moveFolder(deps, { rootId, rel: 'Shoot' }, { rootId, rel: '' }, { newName: 'Lisbon' })
    expect(files()).toEqual(['Lisbon', 'Other'])
    expect(byName('IMG_1.CR3')).toMatchObject({ id: pair.id, relPath: 'Lisbon/IMG_1.CR3' })
    await moveFolder(deps, { rootId, rel: 'Lisbon' }, { rootId, rel: 'Other' })
    expect(byName('beach.jpg').relPath).toBe('Other/Lisbon/beach.jpg')
    await expect(moveFolder(deps, { rootId, rel: 'Other' }, { rootId, rel: 'Other/Lisbon' })).rejects.toThrow(/inside itself/)
    const scan = await rescan()
    expect([scan.added, scan.offline]).toEqual([0, 0])
    expect(lib.folderTree()[0].children.map((c) => c.name)).toEqual(['Other'])
  })

  it('copies a folder', async () => {
    await moveFolder(deps, { rootId, rel: 'Shoot' }, { rootId, rel: 'Other' }, { copy: true })
    expect(files('Other/Shoot')).toEqual(['IMG_1.CR3', 'IMG_1.JPG', 'IMG_1.xmp', 'beach.jpg'])
    expect(all().filter((p) => p.filename === 'IMG_1.CR3').map((p) => p.relPath).sort()).toEqual(['Other/Shoot/IMG_1.CR3', 'Shoot/IMG_1.CR3'])
    expect((await rescan()).added).toBe(0)
  })

  it('deletes a folder to the trash and forgets its photos', async () => {
    expect(await deleteFolder(deps, { rootId, rel: 'Shoot' })).toBe(2)
    expect(files()).toEqual(['Other'])
    expect(fs.readdirSync(bin)).toEqual(['0-Shoot'])
    expect(all().map((p) => p.relPath)).toEqual(['Other/IMG_1.JPG'])
    await expect(deleteFolder(deps, { rootId, rel: '' })).rejects.toThrow(/Remove from Library/)
  })
})
