import { describe, it, expect } from 'vitest'
import path from 'node:path'
import sharp, { type Sharp } from 'sharp'
import { cropFits, defaultCrop, editedSize, fitCrop, inscribedScale, rotateEdit, sanitizeEdit, type PhotoEdit } from '../src/shared/edit'
import { applyEdit } from '../src/main/previews'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { makeJpeg, tmpDir } from './fixtures'

describe('edit geometry', () => {
  it('fits the largest frame-shaped crop inside a straightened image', () => {
    const W = 600
    const H = 400
    for (const angle of [0, 5, -12, 30, 45]) {
      const c = defaultCrop(W, H, angle)
      expect(cropFits(c, W, H, angle)).toBe(true)
      expect(c.w).toBeCloseTo(inscribedScale(W, H, angle), 3)
      // Any bigger and a corner falls outside.
      expect(cropFits({ x: c.x - 0.01, y: c.y - 0.01, w: c.w + 0.02, h: c.h + 0.02 }, W, H, angle)).toBe(angle === 0 && false)
    }
    const full = defaultCrop(600, 400, 0)
    for (const [k, v] of Object.entries({ x: 0, y: 0, w: 1, h: 1 })) expect(full[k as keyof typeof full]).toBeCloseTo(v, 6)
  })

  it('keeps an aspect ratio and pulls a crop back inside', () => {
    const square = defaultCrop(600, 400, 0, 1)
    expect((square.w * 600) / (square.h * 400)).toBeCloseTo(1, 5)
    const outside = { x: 0.7, y: 0.1, w: 0.4, h: 0.4 }
    const fitted = fitCrop(outside, 600, 400, 10)
    expect(cropFits(fitted, 600, 400, 10)).toBe(true)
    expect(fitted.w / fitted.h).toBeCloseTo(1, 5)
  })

  it('turns crops with the frame and comes back after four turns', () => {
    const e: PhotoEdit = { rotate: 0, angle: 3, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } }
    let r: PhotoEdit | null = e
    for (let i = 0; i < 4; i++) r = rotateEdit(r, 1)
    expect(r!.rotate).toBe(0)
    for (const k of ['x', 'y', 'w', 'h'] as const) expect(r!.crop![k]).toBeCloseTo(e.crop![k], 10)
    expect(rotateEdit(rotateEdit(e, 1), -1)!.crop!.x).toBeCloseTo(0.1, 10)
    expect(rotateEdit(e, 1)).toMatchObject({ rotate: 90, crop: { x: expect.closeTo(0.5), y: 0.1, w: 0.3, h: 0.5 } })
    // A full-frame crop with no turn or angle is no edit at all.
    expect(sanitizeEdit({ rotate: 0, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 } })).toBeNull()
    expect(editedSize(600, 400, { rotate: 90, angle: 0, crop: { x: 0, y: 0, w: 1, h: 0.5 } })).toEqual({ w: 400, h: 300 })
  })
})

describe('rendering edits', () => {
  // Left half red, right half blue.
  const halves = (): Sharp =>
    sharp({ create: { width: 600, height: 400, channels: 3, background: '#0000ff' } }).composite([
      { input: { create: { width: 300, height: 400, channels: 3, background: '#ff0000' } }, left: 0, top: 0 }
    ])
  const stats = async (img: Sharp) => {
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
    let dark = 0
    for (let i = 0; i < data.length; i += info.channels) if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark++
    return { width: info.width, height: info.height, dark, first: [data[0], data[1], data[2]] }
  }

  it('crops the right region and turns a quarter', async () => {
    const right = await stats(await applyEdit(halves(), { rotate: 0, angle: 0, crop: { x: 0.6, y: 0.1, w: 0.3, h: 0.5 } }))
    expect(right).toMatchObject({ width: 180, height: 200, first: [0, 0, 255] })
    // A quarter turn clockwise puts the red left half on top.
    const turned = await stats(await applyEdit(halves(), { rotate: 90, angle: 0, crop: { x: 0, y: 0, w: 1, h: 0.4 } }))
    expect(turned).toMatchObject({ width: 400, height: 240, first: [255, 0, 0] })
  })

  it('straightens without showing empty corners', async () => {
    for (const angle of [7, -20, 45]) {
      const out = await stats(await applyEdit(halves(), { rotate: 0, angle, crop: null }))
      expect(out.dark, `angle ${angle}`).toBe(0)
      expect(out.width / out.height).toBeCloseTo(1.5, 1)
    }
  })
})

describe('edits in the catalog', () => {
  it('upgrades an older catalog, shapes the grid by the edit and finds edited photos', async () => {
    const dir = tmpDir()
    const file = path.join(dir, 'catalog.db')
    const old = openDb(file)
    old.exec('ALTER TABLE photos DROP COLUMN edit; ALTER TABLE photos DROP COLUMN edited_at; PRAGMA user_version = 1')
    old.close()
    const photos = path.join(dir, 'Photos')
    await makeJpeg(path.join(photos, 'a.jpg'), { width: 600, height: 400 })
    const lib = new Library(openDb(file), path.join(dir, 'cache'))
    const root = lib.addRoot(photos)
    await scanRoot(lib.db, root.id, photos, { cacheDir: lib.cacheDir })
    const [id] = lib.allIds()
    const req = { scope: { type: 'all' as const }, query: '', sort: { field: 'filename', dir: 'asc' as const }, offset: 0, limit: 10 }
    expect(lib.search(req).aspects).toEqual([1.5])
    lib.setEdit(id, { rotate: 90, angle: 0, crop: null })
    expect(lib.search(req).aspects).toEqual([0.667])
    expect(lib.photos([id])[0]).toMatchObject({ edit: { rotate: 90 } })
    expect(lib.search({ ...req, query: 'is:edited' }).total).toBe(1)
    lib.setEdit(id, null)
    expect(lib.search({ ...req, query: 'is:edited' }).total).toBe(0)
  })
})
