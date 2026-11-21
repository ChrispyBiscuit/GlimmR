import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { pairFiles, scanRoot, type FoundFile } from '../src/main/scanner'
import { previewPaths } from '../src/main/previews'
import { displayFile, photoFiles, targetFor } from '../src/main/files'
import { trashSet, uniqueName, verifiedCopy, moveFile } from '../src/main/fileops'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

const ff = (rel: string): FoundFile => ({ rel, abs: `/x/${rel}`, ext: path.extname(rel).slice(1).toLowerCase(), size: 1, mtime: 1 })

describe('pairing files', () => {
  it('pairs a RAW with the camera JPEG of the same name in the same folder', () => {
    const out = pairFiles(['a/IMG_1.CR3', 'a/IMG_1.JPG', 'a/IMG_2.JPG', 'b/IMG_1.JPG', 'a/IMG_3.NEF', 'a/IMG_3.HEIC', 'a/IMG_4.CR2', 'a/IMG_4.jpg', 'a/IMG_4.heic'].map(ff))
    const pairs = Object.fromEntries(out.map((f) => [f.rel, f.companion?.rel ?? null]))
    expect(pairs).toEqual({
      'a/IMG_1.CR3': 'a/IMG_1.JPG',
      'a/IMG_2.JPG': null,
      'b/IMG_1.JPG': null,
      'a/IMG_3.NEF': 'a/IMG_3.HEIC',
      'a/IMG_4.CR2': 'a/IMG_4.jpg',
      'a/IMG_4.heic': null
    })
  })

  it('lets a check veto a pair', () => {
    const out = pairFiles(['IMG_1.CR3', 'IMG_1.JPG'].map(ff), () => false)
    expect(out.map((f) => [f.rel, f.companion?.rel])).toEqual([
      ['IMG_1.CR3', undefined],
      ['IMG_1.JPG', undefined]
    ])
  })
})

describe('pairs in the library', () => {
  const dir = tmpDir()
  const photos = path.join(dir, 'Photos')
  const cache = path.join(dir, 'cache')
  let lib: Library
  let rootId: number
  const all = () => lib.search({ scope: { type: 'all' }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 100 }).photos

  beforeAll(async () => {
    // A camera JPEG that was a photo of its own, rated and in an album, before its RAW arrives.
    await makeJpeg(path.join(photos, 'IMG_1.JPG'), { color: '#2050ff' })
    await makeJpeg(path.join(photos, 'IMG_2.JPG'))
    lib = new Library(openDb(path.join(dir, 'catalog.db')), cache)
    rootId = lib.addRoot(photos).id
    await scanRoot(lib.db, rootId, photos, { cacheDir: cache })
    const jpg = all().find((p) => p.filename === 'IMG_1.JPG')!
    lib.update([jpg.id], { rating: 4, flag: 'pick', addKeywords: ['Lisbon'] })
    lib.createAlbum('Trip', [jpg.id])
    await makeFakeRaw(path.join(photos, 'IMG_1.CR3'))
    fs.writeFileSync(path.join(photos, 'IMG_1.xmp'), '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>')
    await scanRoot(lib.db, rootId, photos, { cacheDir: cache })
  }, 30000)

  it('makes the RAW the main file and keeps the JPEG’s marks, keywords and albums', () => {
    const list = all()
    expect(list.map((p) => p.filename)).toEqual(['IMG_1.CR3', 'IMG_2.JPG'])
    const pair = list[0]
    expect(pair.companion).toBe(path.join(photos, 'IMG_1.JPG'))
    expect(pair.kind).toBe('raw')
    expect([pair.rating, pair.flag]).toEqual([4, 'pick'])
    expect(lib.detail(pair.id)!.keywords).toEqual(['Lisbon'])
    expect(lib.search({ scope: { type: 'album', id: lib.albums()[0].id }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).ids).toEqual([pair.id])
    expect(lib.search({ scope: { type: 'all' }, query: 'IMG_1.JPG', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).ids).toEqual([pair.id])
  })

  it('shows the pair by its camera JPEG', async () => {
    const pair = all()[0]
    expect(displayFile(pair).path).toBe(pair.companion)
    // The fake RAW's preview is red; the thumbnail must come from the blue JPEG.
    const { dominant } = await sharp(previewPaths(cache, pair.id).thumb).stats()
    expect(dominant.b).toBeGreaterThan(dominant.r)
  })

  it('knows every file of the pair', () => {
    const pair = all()[0]
    fs.mkdirSync(path.join(photos, 'CaptureOne', 'Settings153'), { recursive: true })
    fs.writeFileSync(path.join(photos, 'CaptureOne', 'Settings153', 'IMG_1.CR3.cos'), 'x')
    const set = photoFiles(pair)
    expect(set.sidecars.map((s) => path.relative(photos, s)).sort()).toEqual([path.join('CaptureOne', 'Settings153', 'IMG_1.CR3.cos'), 'IMG_1.xmp'])
    expect(path.relative(photos, targetFor(set.sidecars.find((s) => s.endsWith('.cos'))!, set, path.join(photos, 'x'), 'Beach.CR3'))).toBe(
      path.join('x', 'CaptureOne', 'Settings153', 'Beach.CR3.cos')
    )
  })
})

describe('file operations', () => {
  it('trashes a whole pair, or one half with only its own sidecars', async () => {
    const d = tmpDir()
    for (const n of ['IMG_1.CR3', 'IMG_1.JPG', 'IMG_1.xmp', 'IMG_1.JPG.xmp', 'IMG_1.CR3.xmp']) fs.writeFileSync(path.join(d, n), n)
    const set = photoFiles({ path: path.join(d, 'IMG_1.CR3'), companion: path.join(d, 'IMG_1.JPG') })
    const run = async (part: 'all' | 'raw' | 'jpeg'): Promise<string[]> => {
      const gone: string[] = []
      await trashSet(set, part, async (f) => void gone.push(path.basename(f)))
      return gone.sort()
    }
    expect(await run('all')).toEqual(['IMG_1.CR3', 'IMG_1.CR3.xmp', 'IMG_1.JPG', 'IMG_1.JPG.xmp', 'IMG_1.xmp'])
    expect(await run('jpeg')).toEqual(['IMG_1.JPG', 'IMG_1.JPG.xmp'])
    expect(await run('raw')).toEqual(['IMG_1.CR3', 'IMG_1.CR3.xmp'])
  })

  it('keeps a shared IMG.xmp while another photo of that name uses it', async () => {
    const d = tmpDir()
    for (const n of ['IMG_1.TIF', 'IMG_1.PSD', 'IMG_1.xmp']) fs.writeFileSync(path.join(d, n), n)
    const gone: string[] = []
    await trashSet(photoFiles({ path: path.join(d, 'IMG_1.TIF'), companion: null }), 'all', async (f) => void gone.push(path.basename(f)))
    expect(gone).toEqual(['IMG_1.TIF'])
  })

  it('copies with verification, never overwrites, and names around conflicts', async () => {
    const d = tmpDir()
    const a = path.join(d, 'a.bin')
    fs.writeFileSync(a, Buffer.alloc(300000, 7))
    const hash = await verifiedCopy(a, path.join(d, 'sub', 'b.bin'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.readFileSync(path.join(d, 'sub', 'b.bin')).equals(fs.readFileSync(a))).toBe(true)
    expect(fs.statSync(path.join(d, 'sub', 'b.bin')).mtimeMs).toBeCloseTo(fs.statSync(a).mtimeMs, -2)
    await expect(verifiedCopy(a, path.join(d, 'sub', 'b.bin'))).rejects.toThrow(/already exists/)
    expect(fs.readdirSync(path.join(d, 'sub'))).toEqual(['b.bin'])
    await expect(moveFile(a, path.join(d, 'sub', 'b.bin'), async () => {})).rejects.toThrow(/already exists/)
    await moveFile(a, path.join(d, 'moved', 'a.bin'), async () => {})
    expect(fs.existsSync(a)).toBe(false)
    const taken = new Set(['img_1.cr3', 'img_1-1.cr3'])
    expect(uniqueName('IMG_1.CR3', (n) => !taken.has(n.toLowerCase()))).toBe('IMG_1-2.CR3')
  })
})
