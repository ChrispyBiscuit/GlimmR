import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import * as dev from '../src/main/develop/catalog'
import { defaultSettings, pick } from '../src/shared/develop/settings'
import { writeCube } from '../src/shared/develop/lut'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

const dir = tmpDir()
const photos = path.join(dir, 'Photos')
let lib: Library
const id = (name: string): number => lib.search({ scope: { type: 'all' }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 50 }).photos.find((p) => p.filename === name)!.id
const find = (q: string): string[] => lib.search({ scope: { type: 'all' }, query: q, sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 50 }).photos.map((p) => p.filename)

beforeAll(async () => {
  await makeJpeg(path.join(photos, 'a.jpg'))
  await makeJpeg(path.join(photos, 'b.jpg'), { color: '#c08040' })
  await makeFakeRaw(path.join(photos, 'c.cr3'))
  lib = new Library(openDb(path.join(dir, 'catalog.db')), path.join(dir, 'cache'))
  const root = lib.addRoot(photos)
  await scanRoot(lib.db, root.id, photos, { cacheDir: path.join(dir, 'cache') })
}, 30000)

describe('develop catalog', () => {
  it('saves settings with history; default settings reset the photo', () => {
    const a = id('a.jpg')
    expect(dev.kindOf(lib.db, a)).toBe('display')
    expect(dev.kindOf(lib.db, id('c.cr3'))).toBe('raw')
    const s = defaultSettings('display')
    s.exposure = 0.5
    dev.setDevelop(lib.db, a, s, 'Exposure')
    s.contrast = 20
    dev.setDevelop(lib.db, a, s, 'Contrast')
    expect(dev.getDevelop(lib.db, a)).toMatchObject({ exposure: 0.5, contrast: 20 })
    expect(dev.history(lib.db, a).map((h) => h.label)).toEqual(['Exposure', 'Contrast'])
    expect(lib.photos([a])[0].developed).toBe(true)
    expect(find('is:developed')).toEqual(['a.jpg'])
    dev.setDevelop(lib.db, a, defaultSettings('display'), 'Reset')
    expect(dev.getDevelop(lib.db, a)).toBeNull()
    expect(lib.photos([a])[0].developed).toBe(false)
  })

  it('applies groups to many photos, blended, and skips kelvin white balance on non-raw photos', () => {
    const raw = defaultSettings('raw')
    raw.exposure = 1
    raw.wb = { mode: 'custom', temp: 3200, tint: 0 }
    const ids = [id('a.jpg'), id('c.cr3')]
    expect(dev.applyToMany(lib.db, ids, pick(raw, ['tone', 'wb']), 'Paste', { amount: 0.5, style: 'Test' })).toEqual(ids)
    expect(dev.getDevelop(lib.db, ids[0])).toMatchObject({ exposure: 0.5, wb: { mode: 'asShot' }, styles: ['Test'] })
    expect(dev.getDevelop(lib.db, ids[1])).toMatchObject({ exposure: 0.5, wb: { mode: 'custom', temp: 4350 } })
    expect(find('style:Test')).toEqual(['a.jpg', 'c.cr3'])
  })

  it('has built-in styles, and saves, renames and deletes styles of one’s own', () => {
    dev.ensureBuiltInStyles(lib.db)
    dev.ensureBuiltInStyles(lib.db)
    const builtIn = dev.listStyles(lib.db).filter((s) => s.builtIn)
    expect(builtIn.map((s) => s.name)).toContain('Camera-like')
    expect(builtIn.length).toBe(6)
    const sid = dev.saveStyle(lib.db, 'Mine', { contrast: 10 })
    dev.renameStyle(lib.db, sid, 'Mine too')
    dev.deleteStyle(lib.db, builtIn[0].id) // built-ins stay
    expect(dev.listStyles(lib.db).map((s) => s.name)).toContain('Mine too')
    expect(dev.listStyles(lib.db).filter((s) => s.builtIn).length).toBe(6)
  })

  it('imports LUTs (packs keep folder names), reports failures, and round-trips a style file with its LUT', () => {
    const packs = path.join(dir, 'packs', 'Film Pack')
    fs.mkdirSync(packs, { recursive: true })
    fs.writeFileSync(path.join(packs, 'warm.cube'), writeCube('Warm', 9, (r, g, b) => [Math.min(1, r * 1.1), g, b * 0.9]))
    fs.writeFileSync(path.join(packs, 'broken.cube'), 'LUT_3D_SIZE 9\n0 0 0\n')
    const r = dev.importLutFiles(lib.db, [path.join(dir, 'packs')])
    expect(r.added.map((l) => [l.name, l.folder])).toEqual([['Warm', 'packs/Film Pack']])
    expect(r.failed.map((f) => f.file)).toEqual(['broken.cube'])
    const sha = r.added[0].sha
    expect(dev.loadLut(lib.db, sha)!.size).toBe(9)
    const s = defaultSettings('display')
    s.look = { lut: sha, name: 'Warm', amount: 0.8, space: 'srgb' }
    const sid = dev.saveStyle(lib.db, 'Warm look', pick(s, ['look']))
    const file = JSON.stringify(dev.exportStyle(lib.db, sid))
    dev.removeLut(lib.db, sha)
    expect(dev.listLuts(lib.db)).toEqual([])
    const back = dev.importStyleFile(lib.db, file, 'Warm look.glimmrstyle')
    expect(back.settings.look).toMatchObject({ lut: sha, amount: 0.8 })
    expect(dev.loadLut(lib.db, sha)!.size).toBe(9)
  })
})
