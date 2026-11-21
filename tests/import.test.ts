import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { closeSource, finishImport, readSource, runImport, sourceImage } from '../src/main/importer'
import { folderFor } from '../src/shared/importTemplate'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

const fingerprint = (dir: string): string => {
  const h = crypto.createHash('sha1')
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else h.update(e.name).update(fs.readFileSync(p)).update(String(fs.statSync(p).mtimeMs))
    }
  }
  walk(dir)
  return h.digest('hex')
}
const files = (d: string, p = ''): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name), `${p}${e.name}/`) : [`${p}${e.name}`])).sort()
const noop = (): void => {}

describe('import folder templates', () => {
  const t = new Date(2026, 10, 21, 9, 30).getTime()
  it('fills dates, event, camera and card, and drops empty parts', () => {
    expect(folderFor('{YYYY}/{YYYY-MM-DD} {event}', { takenAt: t, event: 'Lisbon', camera: '', card: '' })).toBe('2026/2026-11-21 Lisbon')
    expect(folderFor('{YYYY}/{YYYY-MM-DD} {event}', { takenAt: t, event: '', camera: '', card: '' })).toBe('2026/2026-11-21')
    expect(folderFor('{yyyy}/{MM}/{DD}/{camera}', { takenAt: t, event: '', camera: 'EOS R5', card: '' })).toBe('2026/11/21/EOS R5')
    expect(folderFor('{card}/{event}', { takenAt: null, event: 'a/b: c', camera: '', card: 'EOS_DIGITAL' })).toBe('EOS_DIGITAL/a-b- c')
    expect(folderFor('{YYYY-MM-DD}', { takenAt: null, event: '', camera: '', card: '' })).toBe('Undated')
  })
})

describe('importing a card', () => {
  const dir = tmpDir()
  const card = path.join(dir, 'EOS_DIGITAL')
  const library = path.join(dir, 'Photos')
  const cache = path.join(dir, 'cache')
  let lib: Library
  let rootId: number
  let before: string

  beforeAll(async () => {
    // Two DCIM folders, both with an IMG_0001 (the camera's counter rolled over): different photos, same names.
    await makeFakeRaw(path.join(card, 'DCIM/100CANON/IMG_0001.CR3'))
    await makeJpeg(path.join(card, 'DCIM/100CANON/IMG_0001.JPG'), { date: '2026:11:21 09:30:00' })
    await makeJpeg(path.join(card, 'DCIM/100CANON/IMG_0002.JPG'), { date: '2026:11:21 09:31:00', color: '#ff0000' })
    await makeJpeg(path.join(card, 'DCIM/101CANON/IMG_0001.JPG'), { date: '2026:11:21 10:00:00', color: '#00ff00' })
    fs.writeFileSync(path.join(card, 'DCIM/100CANON/MVI_0003.MOV'), Buffer.alloc(5000, 1))
    fs.mkdirSync(library, { recursive: true })
    lib = new Library(openDb(path.join(dir, 'catalog.db')), cache)
    rootId = lib.addRoot(library).id
    before = fingerprint(card)
  })

  it('reads the card: pairs, sidecars, videos, nothing imported yet', async () => {
    const s = await readSource(lib.db, card, 'EOS_DIGITAL', cache, noop)
    expect(s.items.map((i) => [i.key, i.companion, i.already])).toEqual([
      ['DCIM/100CANON/IMG_0001.CR3', 'IMG_0001.JPG', false],
      ['DCIM/100CANON/IMG_0002.JPG', null, false],
      ['DCIM/101CANON/IMG_0001.JPG', null, false]
    ])
    expect(s.videos).toBe(1)
    expect(fs.existsSync((await sourceImage(s.token, 0, 'thumb'))!)).toBe(true)
    closeSource(s.token)
  })

  it('copies with verification into dated folders, renaming clashes, and catalogs with the card marks', async () => {
    const s = await readSource(lib.db, card, 'EOS_DIGITAL', cache, noop)
    const opts = { keys: s.items.map((i) => i.key), rootId, template: '{YYYY}/{YYYY-MM-DD} {event}', event: 'Lisbon', copyVideos: true }
    const r = await runImport({ db: lib.db, rootPath: library, report: noop }, s.token, opts)
    expect([r.imported, r.skipped, r.failed, r.videos]).toEqual([3, 0, 0, 1])
    expect(files(library)).toEqual([
      '2026/2026-11-21 Lisbon/IMG_0001-1.JPG',
      '2026/2026-11-21 Lisbon/IMG_0001.CR3',
      '2026/2026-11-21 Lisbon/IMG_0001.JPG',
      '2026/2026-11-21 Lisbon/IMG_0002.JPG',
      // The video is dated by its file time, today.
      ...files(library).filter((f) => f.endsWith('MVI_0003.MOV'))
    ])
    await scanRoot(lib.db, rootId, library, { cacheDir: cache })
    const ids = finishImport(lib.db, rootId, library, r, { 'DCIM/100CANON/IMG_0002.JPG': { flag: 'pick', rating: 4 } })
    expect(ids).toHaveLength(3)
    const imported = lib.search({ scope: { type: 'import', id: r.importId }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).photos
    expect(imported.map((p) => [p.filename, p.companion ? path.basename(p.companion) : null, p.flag, p.rating])).toEqual([
      ['IMG_0001-1.JPG', null, null, 0],
      ['IMG_0001.CR3', 'IMG_0001.JPG', null, 0],
      ['IMG_0002.JPG', null, 'pick', 4]
    ])
    closeSource(s.token)
  })

  it('never changes the card', () => {
    expect(fingerprint(card)).toBe(before)
  })

  it('knows what’s already imported when the card comes back, and copies nothing twice', async () => {
    await makeJpeg(path.join(card, 'DCIM/101CANON/IMG_0002.JPG'), { date: '2026:11:22 08:00:00', color: '#0000ff' })
    const s = await readSource(lib.db, card, 'EOS_DIGITAL', cache, noop)
    expect(s.items.map((i) => [i.name, i.already])).toEqual([
      ['IMG_0001.CR3', true],
      ['IMG_0002.JPG', true],
      ['IMG_0001.JPG', true],
      ['IMG_0002.JPG', false]
    ])
    // Importing everything again only copies the new photo.
    const r = await runImport({ db: lib.db, rootPath: library, report: noop }, s.token, { keys: s.items.map((i) => i.key), rootId, template: '{YYYY}/{YYYY-MM-DD} {event}', event: 'Lisbon', copyVideos: false })
    expect([r.imported, r.skipped]).toEqual([1, 3])
    expect(files(library).filter((f) => f.endsWith('.JPG') || f.endsWith('.CR3'))).toHaveLength(5)
    closeSource(s.token)
  })

  it('stops when cancelled, and a later import copies only the rest', async () => {
    const card2 = path.join(dir, 'CARD2')
    for (let i = 1; i <= 4; i++) await makeJpeg(path.join(card2, `DCIM/100MSDCF/DSC0000${i}.JPG`), { date: `2026:10:0${i} 12:00:00` })
    const s = await readSource(lib.db, card2, 'CARD2', cache, noop)
    const ac = new AbortController()
    let n = 0
    const r1 = await runImport({ db: lib.db, rootPath: library, report: () => (++n === 3 ? ac.abort() : undefined), signal: ac.signal }, s.token, {
      keys: s.items.map((i) => i.key),
      rootId,
      template: '{YYYY-MM-DD}',
      event: '',
      copyVideos: false
    })
    expect(r1.imported).toBe(2)
    expect(files(library).filter((f) => f.includes('.glimmr-part'))).toEqual([])
    closeSource(s.token)
    const again = await readSource(lib.db, card2, 'CARD2', cache, noop)
    expect(again.items.map((i) => i.already)).toEqual([true, true, false, false])
    closeSource(again.token)
  })
})
