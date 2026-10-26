import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { createBackup, listBackups, verifyBackup, restoreCatalogFile, mirroredRootPath, originalsDir } from '../src/main/backup'
import { mergeSidecar, buildSidecar } from '../src/main/xmp'
import { readMetadata } from '../src/main/metadata'
import { editorFor, mergeEditors, resolvePattern } from '../src/main/editors'
import { makeJpeg, tmpDir } from './fixtures'

describe('backup and restore', () => {
  it('backs up catalog and originals, verifies, prunes and restores with remapping', async () => {
    const dir = tmpDir()
    const photos = path.join(dir, 'Photos')
    await makeJpeg(path.join(photos, 'a/one.jpg'))
    await makeJpeg(path.join(photos, 'two.jpg'), { iso: 6400 })
    const dbFile = path.join(dir, 'catalog.db')
    let lib = new Library(openDb(dbFile), path.join(dir, 'cache'))
    const root = lib.addRoot(photos)
    await scanRoot(lib.db, root.id, photos, { cacheDir: lib.cacheDir })
    lib.update(lib.allIds(), { rating: 3, addKeywords: ['family'] })
    lib.createAlbum('Best', lib.allIds())

    const dest = path.join(dir, 'Backups')
    const entry = await createBackup(lib.db, { destination: dest, appVersion: 'test', includeOriginals: true, keep: 2 })
    expect(entry.manifest).toMatchObject({ photoCount: 2, originals: { included: true, fileCount: 2 } })
    expect(await verifyBackup(entry.path)).toEqual({ ok: true, problems: [] })
    const mirror = mirroredRootPath(entry.path, root)!
    expect(fs.existsSync(path.join(mirror, 'a/one.jpg'))).toBe(true)

    // Retention keeps the newest N.
    await new Promise((r) => setTimeout(r, 1100))
    await createBackup(lib.db, { destination: dest, appVersion: 'test', includeOriginals: false, keep: 2 })
    await new Promise((r) => setTimeout(r, 1100))
    await createBackup(lib.db, { destination: dest, appVersion: 'test', includeOriginals: false, keep: 2 })
    const list = await listBackups(dest)
    expect(list).toHaveLength(2)
    expect(list.some((b) => b.path === entry.path)).toBe(false)

    // Simulate disaster: catalog changed, originals lost. Restore from the newest backup and point the root at the mirror.
    lib.update(lib.allIds(), { rating: 0 })
    lib.db.close()
    fs.rmSync(photos, { recursive: true })
    await restoreCatalogFile(list[0].path, dbFile, { [root.id]: mirror })
    lib = new Library(openDb(dbFile), path.join(dir, 'cache'))
    expect(lib.listRoots()[0]).toMatchObject({ path: mirror, online: true, count: 2 })
    const res = lib.search({ scope: { type: 'all' }, query: 'rating:3 keyword:family album:Best', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 })
    expect(res.photos.map((p) => p.filename)).toEqual(['one.jpg', 'two.jpg'])
    const rescan = await scanRoot(lib.db, root.id, mirror, { cacheDir: lib.cacheDir })
    expect(rescan).toMatchObject({ added: 0, offline: 0, errors: 0 })
    expect(lib.photos(lib.allIds()).every((p) => p.hasPreview)).toBe(true)
  })

  it('detects a corrupted backup', async () => {
    const dir = tmpDir()
    const lib = new Library(openDb(path.join(dir, 'catalog.db')), path.join(dir, 'cache'))
    const entry = await createBackup(lib.db, { destination: path.join(dir, 'b'), appVersion: 'test', includeOriginals: false, keep: 5 })
    fs.appendFileSync(path.join(entry.path, 'catalog.db'), 'garbage')
    const v = await verifyBackup(entry.path)
    expect(v.ok).toBe(false)
    expect(v.problems[0]).toMatch(/checksum/)
    await expect(restoreCatalogFile(entry.path, path.join(dir, 'other.db'), {})).rejects.toThrow(/verification/)
  })
})

describe('renamed originals mirror', () => {
  it('keeps using a mirror made before the app was renamed GLMR', () => {
    const dest = tmpDir()
    const legacy = path.join(dest, 'Glimmr Originals', '1-Photos')
    fs.mkdirSync(legacy, { recursive: true })
    expect(originalsDir(dest)).toBe(path.join(dest, 'Glimmr Originals'))
    expect(mirroredRootPath(path.join(dest, 'GLMR 2026-10-26 20-00-00.glimmr-backup'), { id: 1, name: 'Photos' })).toBe(legacy)
    expect(originalsDir(tmpDir())).toMatch(/GLMR Originals$/)
  })
})

describe('XMP sidecars', () => {
  const fields = { rating: 4, flag: null, label: 'blue', keywords: ['Places>Portugal>Lisbon', 'beach'], title: 'A & B', caption: null }

  it('round-trips through the metadata reader', async () => {
    const dir = tmpDir()
    const img = path.join(dir, 'x.jpg')
    await makeJpeg(img)
    fs.writeFileSync(path.join(dir, 'x.xmp'), buildSidecar(fields))
    const m = await readMetadata(img)
    expect(m).toMatchObject({ rating: 4, label: 'blue', title: 'A & B' })
    expect(m.keywords.sort()).toEqual(['Places>Portugal>Lisbon', 'beach'])
  })

  it('merges into an existing sidecar, keeping other apps’ data', () => {
    const existing = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" xmp:Rating="1" crs:Exposure2012="+0.50">
<xmp:Label>Red</xmp:Label><crs:ToneCurveName2012>Linear</crs:ToneCurveName2012></rdf:Description></rdf:RDF></x:xmpmeta>`
    const out = mergeSidecar(existing, { ...fields, flag: 'reject' })
    expect(out).toContain('crs:Exposure2012="+0.50"')
    expect(out).toContain('<crs:ToneCurveName2012>Linear</crs:ToneCurveName2012>')
    expect(out).not.toContain('xmp:Rating="1"')
    expect(out).not.toContain('Red')
    expect(out).toContain('<xmp:Rating>-1</xmp:Rating>')
    expect(out).toContain('<rdf:li>Places|Portugal|Lisbon</rdf:li>')
    expect(out).toContain('A &amp; B')
    expect(out).toContain('xmlns:dc=')
  })
})

describe('editors', () => {
  it('resolves patterns and picks editors per type', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'Capture One 22'))
    fs.mkdirSync(path.join(dir, 'Capture One 23'))
    expect(resolvePattern([dir, /^Capture One/])).toBe(path.join(dir, 'Capture One 23'))
    const s = mergeEditors(
      {
        editors: [{ id: 'custom-1', name: 'Mine', path: '/x', args: [], detected: false }],
        defaultEditor: 'photoshop',
        perType: { raw: 'capture-one', jpg: 'gone' }
      },
      [
        { id: 'capture-one', name: 'Capture One', path: '/c1', args: [], detected: true },
        { id: 'photoshop', name: 'Photoshop', path: '/ps', args: [], detected: true }
      ]
    )
    expect(s.editors.map((e) => e.id)).toEqual(['capture-one', 'photoshop', 'custom-1'])
    expect(s.perType).toEqual({ raw: 'capture-one' })
    expect(editorFor(s, 'cr3')?.id).toBe('capture-one')
    expect(editorFor(s, 'jpg')?.id).toBe('photoshop')
  })
})
