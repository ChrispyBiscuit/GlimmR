import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { findDuplicates, fingerprintLibrary, markNotDuplicates, mergeGroup } from '../src/main/duplicates'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

const dir = tmpDir()
const photos = path.join(dir, 'Photos')
const cache = path.join(dir, 'cache')
const bin = path.join(dir, 'bin')
let lib: Library
const byRel = (rel: string) => lib.search({ scope: { type: 'all' }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 100 }).photos.find((p) => p.relPath === rel)!
const trash = async (f: string): Promise<void> => fs.renameSync(f, path.join(bin, `${Date.now()}-${Math.random()}-${path.basename(f)}`))

/** A photo-like image (a gradient), so different files really have different pixels. */
async function gradient(file: string, hue: number, exif: Record<string, string> = {}): Promise<void> {
  const w = 300
  const h = 200
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      px[o] = (x + hue) % 256
      px[o + 1] = (y * 2 + hue) % 256
      px[o + 2] = hue
    }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 92 })
    .withExif({ IFD0: { Make: 'Canon', Model: 'EOS R5', ...exif } })
    .toFile(file)
}

beforeAll(async () => {
  fs.mkdirSync(bin)
  await gradient(path.join(photos, 'Trip/beach.jpg'), 10)
  fs.mkdirSync(path.join(photos, 'Backup'), { recursive: true })
  fs.copyFileSync(path.join(photos, 'Trip/beach.jpg'), path.join(photos, 'Backup/beach.jpg'))
  // The same picture re-saved with different metadata: identical pixels, different file.
  // (A comment segment inserted after the start marker, as a metadata editor would: the image data is untouched.)
  const jpeg = fs.readFileSync(path.join(photos, 'Trip/beach.jpg'))
  const note = Buffer.from('Tagged in another app')
  const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0, note.length + 2]), note])
  fs.writeFileSync(path.join(photos, 'Backup/beach-tagged.jpg'), Buffer.concat([jpeg.subarray(0, 2), com, jpeg.subarray(2)]))
  // A RAW + JPEG pair, and a loose copy of its JPEG elsewhere.
  await makeFakeRaw(path.join(photos, 'Trip/IMG_1.CR3'))
  await gradient(path.join(photos, 'Trip/IMG_1.JPG'), 90)
  fs.mkdirSync(path.join(photos, 'Exports'))
  fs.copyFileSync(path.join(photos, 'Trip/IMG_1.JPG'), path.join(photos, 'Exports/IMG_1.JPG'))
  // A different photo: never a duplicate.
  await gradient(path.join(photos, 'Trip/other.jpg'), 170)
  lib = new Library(openDb(path.join(dir, 'catalog.db')), cache)
  const root = lib.addRoot(photos)
  await scanRoot(lib.db, root.id, photos, { cacheDir: cache })
}, 30000)

describe('duplicates', () => {
  it('fingerprints photos while scanning', async () => {
    const missing = lib.db.prepare('SELECT COUNT(*) AS c FROM photos WHERE quick_hash IS NULL OR pixel_hash IS NULL').get() as { c: number }
    expect(missing.c).toBe(0)
    expect(await fingerprintLibrary(lib.db, cache, () => {})).toBe(0)
  })

  it('finds exact copies and the same picture under other files, but not pairs or different photos', async () => {
    const groups = await findDuplicates(lib.db)
    const named = groups.map((g) => `${g.tier}: ${g.photos.map((p) => p.relPath.replace('Backup/beach.jpg', 'Trip/beach.jpg')).sort().join(' + ')}`).sort()
    // One exact copy stands in for its set in the same-picture group.
    expect(named).toEqual(['exact: Trip/beach.jpg + Trip/beach.jpg', 'picture: Backup/beach-tagged.jpg + Trip/beach.jpg', 'picture: Exports/IMG_1.JPG + Trip/IMG_1.CR3'])
    // The RAW + JPEG pair is kept over the loose JPEG.
    const pair = groups.find((g) => g.photos.some((p) => p.relPath === 'Trip/IMG_1.CR3'))!
    expect(pair.keeper).toBe(byRel('Trip/IMG_1.CR3').id)
  })

  it('merges: keeps one, moves marks, keywords and albums to it, and trashes the copy', async () => {
    const keep = byRel('Trip/beach.jpg')
    const copy = byRel('Backup/beach.jpg')
    lib.update([copy.id], { rating: 5, flag: 'pick', addKeywords: ['Sea'] })
    lib.createAlbum('Best', [copy.id])
    const r = await mergeGroup(lib.db, cache, keep.id, [copy.id], trash)
    expect(r.merged).toBe(1)
    expect(fs.existsSync(path.join(photos, 'Backup/beach.jpg'))).toBe(false)
    const kept = lib.detail(keep.id)!
    expect([kept.rating, kept.flag, kept.keywords]).toEqual([5, 'pick', ['Sea']])
    expect(lib.search({ scope: { type: 'album', id: lib.albums()[0].id }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 5 }).ids).toEqual([keep.id])
  })

  it('remembers photos that aren’t duplicates', async () => {
    const g = (await findDuplicates(lib.db)).find((x) => x.photos.some((p) => p.relPath === 'Exports/IMG_1.JPG'))!
    markNotDuplicates(lib.db, g.photos.map((p) => p.id))
    expect((await findDuplicates(lib.db)).some((x) => x.photos.some((p) => p.relPath === 'Exports/IMG_1.JPG'))).toBe(false)
  })
})
