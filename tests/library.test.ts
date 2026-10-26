import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { parseQuery, parseDateRange } from '../src/main/query'
import { previewPaths } from '../src/main/previews'
import { makeJpeg, makeFakeRaw, tmpDir } from './fixtures'

const dir = tmpDir()
const photos = path.join(dir, 'Photos')
const cache = path.join(dir, 'cache')
let lib: Library
let rootId: number

const all = (query: string, scope: any = { type: 'all' }): string[] =>
  lib.search({ scope, query, sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 1000 }).photos.map((p) => p.filename)

beforeAll(async () => {
  await makeJpeg(path.join(photos, '2021/lisbon/sunset.jpg'), {
    iso: 3200,
    fnumber: '14/10',
    date: '2021:05:14 19:32:10',
    xmp: { rating: 4, label: 'Red', subjects: ['beach', 'Lisbon'], hierarchical: ['Places|Portugal|Lisbon'], title: 'Sunset over Tagus' }
  })
  await makeJpeg(path.join(photos, '2021/lisbon/tram.jpg'), { iso: 400, date: '2021:05:15 10:00:00', height: 900, width: 600 })
  await makeJpeg(path.join(photos, '2023/portrait.jpg'), {
    make: 'Canon',
    model: 'Canon EOS R5',
    lens: 'RF85mm F1.2 L USM',
    focal: '85/1',
    iso: 100,
    date: '2023:08:01 12:00:00'
  })
  await makeFakeRaw(path.join(photos, '2023/DSC_0001.nef'))
  fs.writeFileSync(path.join(photos, 'notes.txt'), 'ignore me')
  lib = new Library(openDb(path.join(dir, 'catalog.db')), cache)
  rootId = lib.addRoot(photos).id
  const r = await scanRoot(lib.db, rootId, photos, { cacheDir: cache })
  expect(r).toMatchObject({ found: 4, added: 4, errors: 0 })
})

describe('scanning', () => {
  it('reads normalized metadata and embedded XMP', () => {
    const id = lib.search({ scope: { type: 'all' }, query: 'file:sunset', sort: { field: 'taken', dir: 'desc' }, offset: 0, limit: 1 }).ids[0]
    const d = lib.detail(id)!
    expect(d).toMatchObject({ make: 'FUJIFILM', model: 'X-T5', iso: 3200, aperture: 1.4, rating: 4, label: 'red', title: 'Sunset over Tagus', orientation: 'landscape' })
    expect(d.keywords).toEqual(['beach', 'Places>Portugal>Lisbon'])
    expect(new Date(d.takenAt!).getFullYear()).toBe(2021)
    expect(d.metadata.some((m) => m.key === 'LensModel')).toBe(true)
  })

  it('generates thumbnails, including from a RAW embedded preview', () => {
    for (const p of lib.photos(lib.allIds())) {
      expect(p.hasPreview, p.filename).toBe(true)
      expect(fs.existsSync(previewPaths(cache, p.id).thumb)).toBe(true)
    }
  })

  it('is incremental and marks missing files offline', async () => {
    const again = await scanRoot(lib.db, rootId, photos, { cacheDir: cache })
    expect(again).toMatchObject({ added: 0, updated: 0, offline: 0 })
    fs.renameSync(path.join(photos, '2023/portrait.jpg'), path.join(dir, 'moved.jpg'))
    expect((await scanRoot(lib.db, rootId, photos, { cacheDir: cache })).offline).toBe(1)
    expect(all('is:offline')).toEqual(['portrait.jpg'])
    fs.renameSync(path.join(dir, 'moved.jpg'), path.join(photos, '2023/portrait.jpg'))
    await scanRoot(lib.db, rootId, photos, { cacheDir: cache })
    expect(all('is:offline')).toEqual([])
  })
})

describe('search', () => {
  it('parses field syntax', () => {
    expect(parseQuery('sunset -raw camera:"EOS R5" iso:>1600 focal:24..70 f:=2.8')).toEqual([
      { neg: false, field: null, op: '', value: 'sunset' },
      { neg: true, field: null, op: '', value: 'raw' },
      { neg: false, field: 'camera', op: '', value: 'EOS R5' },
      { neg: false, field: 'iso', op: '>', value: '1600' },
      { neg: false, field: 'focal', op: 'range', value: '24', value2: '70' },
      { neg: false, field: 'f', op: '=', value: '2.8' }
    ])
    const [a, b] = parseDateRange('2021-05')!
    expect(new Date(a).getMonth()).toBe(4)
    expect(new Date(b).getMonth()).toBe(5)
  })

  it('free text matches any metadata, with prefixes', () => {
    expect(all('lisb')).toEqual(['sunset.jpg', 'tram.jpg']) // folder name + keyword
    expect(all('tagus')).toEqual(['sunset.jpg'])
    expect(all('canon')).toEqual(['portrait.jpg'])
  })

  it('supports field filters, numbers, ranges and exclusion', () => {
    expect(all('iso:>1000')).toEqual(['sunset.jpg'])
    expect(all('iso:100..400')).toEqual(['portrait.jpg', 'tram.jpg'])
    expect(all('camera:"EOS R5"')).toEqual(['portrait.jpg'])
    expect(all('camera:="Canon Canon EOS R5"')).toEqual(['portrait.jpg'])
    expect(all('rating:>=4')).toEqual(['sunset.jpg'])
    expect(all('label:red')).toEqual(['sunset.jpg'])
    expect(all('keyword:Portugal')).toEqual(['sunset.jpg'])
    expect(all('type:raw')).toEqual(['DSC_0001.nef'])
    expect(all('-type:raw -lisbon')).toEqual(['portrait.jpg'])
    expect(all('date:2021')).toEqual(['sunset.jpg', 'tram.jpg'])
    expect(all('date:2021-05-15')).toEqual(['tram.jpg'])
    expect(all('orientation:portrait')).toEqual(['tram.jpg'])
    expect(all('focal:85 f:<2')).toEqual([])
    expect(all('shutter:1/250')).toEqual(['portrait.jpg', 'sunset.jpg', 'tram.jpg'])
  })

  it('searches any raw metadata key', () => {
    expect(all('LensModel:RF85')).toEqual(['portrait.jpg'])
    expect(all('ExifImageWidth:>500')).toEqual(['portrait.jpg', 'sunset.jpg', 'tram.jpg'])
  })

  it('sorts by built-in and raw metadata fields', () => {
    const s = (field: string, dir: 'asc' | 'desc'): string[] =>
      lib.search({ scope: { type: 'all' }, query: '-type:raw', sort: { field, dir }, offset: 0, limit: 10 }).photos.map((p) => p.filename)
    expect(s('iso', 'desc')).toEqual(['sunset.jpg', 'tram.jpg', 'portrait.jpg'])
    expect(s('taken', 'asc')).toEqual(['sunset.jpg', 'tram.jpg', 'portrait.jpg'])
    expect(s('ISO', 'asc')[0]).toBe('portrait.jpg')
  })

  it('reports errors instead of failing', () => {
    const r = lib.search({ scope: { type: 'all' }, query: 'iso:abc', sort: { field: 'taken', dir: 'desc' }, offset: 0, limit: 10 })
    expect(r.error).toMatch(/not a number/)
    expect(r.total).toBe(4)
  })

  it('computes facets and suggestions', () => {
    const f = lib.facets({ type: 'all' }, '')
    expect(f.year.map((y) => y.value)).toContain('2021')
    expect(f.camera.find((c) => c.value === 'FUJIFILM X-T5')?.count).toBe(2)
    expect(f.ranges.iso).toEqual([100, 3200])
    expect(lib.suggest('cam').some((s) => s.value === 'camera:')).toBe(true)
    expect(lib.suggest('camera:fuj')[0].value).toBe('camera:="FUJIFILM X-T5"')
    expect(lib.suggest('LensMo').some((s) => s.value === 'LensModel:')).toBe(true)
  })
})

describe('organizing', () => {
  it('edits ratings, flags, labels and keywords, and search follows', () => {
    const [tram] = lib.search({ scope: { type: 'all' }, query: 'file:tram', sort: { field: 'taken', dir: 'desc' }, offset: 0, limit: 1 }).ids
    lib.update([tram], { rating: 5, flag: 'pick', label: 'green', addKeywords: ['Transport|Tram'], title: 'Line 28' })
    expect(all('rating:5 flag:pick label:green keyword:Tram')).toEqual(['tram.jpg'])
    expect(all('"line 28"')).toEqual(['tram.jpg'])
    expect(all('', { type: 'picks' })).toEqual(['tram.jpg'])
    lib.update([tram], { removeKeywords: ['Transport>Tram'] })
    expect(all('keyword:tram')).toEqual([])
  })

  it('albums and smart albums', () => {
    const ids = lib.search({ scope: { type: 'all' }, query: 'lisbon', sort: { field: 'taken', dir: 'desc' }, offset: 0, limit: 10 }).ids
    const album = lib.createAlbum('Portugal trip', ids)
    expect(lib.albums()[0]).toMatchObject({ name: 'Portugal trip', count: 2 })
    expect(all('', { type: 'album', id: album })).toEqual(['sunset.jpg', 'tram.jpg'])
    expect(all('album:portugal')).toEqual(['sunset.jpg', 'tram.jpg'])
    expect(all('trip')).toEqual(['sunset.jpg', 'tram.jpg'])
    const smart = lib.saveSmartAlbum({ name: 'High ISO', query: 'iso:>=1600', sort: { field: 'iso', dir: 'desc' } })
    expect(all('', { type: 'smart', id: smart })).toEqual(['sunset.jpg'])
  })

  it('keyword tree, rename and folder tree', () => {
    const tree = lib.keywordTree()
    expect(tree.find((k) => k.name === 'Places')?.children[0]).toMatchObject({ name: 'Portugal', count: 1 })
    lib.renameKeyword('Places>Portugal', 'Places>PT')
    expect(all('keyword:"Places>PT>Lisbon"')).toEqual(['sunset.jpg'])
    expect(all('', { type: 'keyword', path: 'Places>PT' })).toEqual(['sunset.jpg'])
    const [root] = lib.folderTree()
    expect(root.count).toBe(4)
    expect(root.children.map((c) => c.name)).toEqual(['2021', '2023'])
    expect(all('', { type: 'folder', rootId, relPath: '2021' })).toEqual(['sunset.jpg', 'tram.jpg'])
  })

  it('rediscover: on this day, highlights, stats', () => {
    const days = lib.onThisDay(new Date(2026, 4, 14))
    expect(days).toHaveLength(1)
    expect(days[0].year).toBe(2021)
    expect(lib.highlights(10).length).toBe(4)
    expect(lib.stats()).toMatchObject({ photos: 4, raw: 1, cameras: 2 })
  })

  it('refuses nested library folders', () => {
    expect(() => lib.addRoot(path.join(photos, '2021'))).toThrow(/already inside/)
  })
})
