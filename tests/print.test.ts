import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { computeLayout, parsePageRange, placePhoto, sharpenParams, withDefaults, captionText, pageText, type PrintSettings } from '../src/shared/print'
import { setWasmSource } from '../src/main/print/color'
import { adjustmentLut } from '../src/main/print/render'
import { overlaySvg, pagesHtml } from '../src/main/print/compose'
import { previewPage, runOutput, type OutputDeps } from '../src/main/print/job'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { makeJpeg, tmpDir } from './fixtures'

const S = (p: Partial<PrintSettings> = {}): PrintSettings => withDefaults(p)
const landscape = { id: 1, w: 6000, h: 4000 }
const portrait = { id: 2, w: 4000, h: 6000 }
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

describe('print layout', () => {
  it('fits one photo per page, turning the page to match it', () => {
    const l = computeLayout(S(), [landscape])
    expect(l).toMatchObject({ width: 11, height: 8.5, landscape: true })
    const c = l.pages[0].cells[0]
    expect(near(c.box.w / c.box.h, 1.5)).toBe(true)
    // Inside the half-inch margins, centred.
    expect(c.box.x).toBeGreaterThanOrEqual(0.5 - 1e-9)
    expect(near(c.box.y + c.box.h / 2, 8.5 / 2)).toBe(true)
    expect(Math.round(c.ppi)).toBe(Math.round(6000 / c.box.w))
    expect(computeLayout(S({ orientation: 'portrait' }), [landscape]).landscape).toBe(false)
  })

  it('makes grids and pages', () => {
    const photos = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, w: 3000, h: 2000 }))
    const l = computeLayout(S({ layout: 'grid', grid: { rows: 2, cols: 2, hGap: 0.25, vGap: 0.25 }, orientation: 'portrait' }), photos)
    expect(l.pages.map((p) => p.cells.length)).toEqual([4, 1])
    const [a, b] = l.pages[0].cells
    expect(near(b.cell.x - (a.cell.x + a.cell.w), 0.25)).toBe(true)
    // Repeat on page: each photo fills its own page.
    expect(computeLayout(S({ layout: 'grid', repeatOnPage: true }), photos.slice(0, 2)).pages.map((p) => new Set(p.cells.map((c) => c.photoId)).size)).toEqual([1, 1])
  })

  it('packs print sizes, choosing the orientation that fits more', () => {
    const l = computeLayout(S({ layout: 'package', pkg: { size: '4x6', customW: 4, customH: 6, repeat: 3, gap: 0.1 } }), [landscape])
    expect(l.pages[0].cells.length + (l.pages[1]?.cells.length ?? 0)).toBe(3)
    for (const c of l.pages[0].cells) expect([4, 6]).toContain(Math.round(c.cell.w))
    expect(computeLayout(S({ layout: 'package', pkg: { size: 'custom', customW: 20, customH: 30, repeat: 1, gap: 0 } }), [landscape]).problem).toMatch(/doesn’t fit/)
  })

  it('fills by cropping to the cell, and the crop can be moved and zoomed', () => {
    const s = S({ fit: 'fill', rotateToFit: false })
    const cell = { x: 0, y: 0, w: 4, h: 4 }
    const centred = placePhoto(s, landscape, cell)
    expect(centred.crop).toMatchObject({ y: 0, h: 1 })
    expect(near(centred.crop.w, 2 / 3)).toBe(true)
    expect(near(centred.crop.x, 1 / 6)).toBe(true)
    expect(placePhoto(s, landscape, cell, { ox: -1, oy: 0, zoom: 1 }).crop.x).toBe(0)
    expect(near(placePhoto(s, landscape, cell, { ox: 1, oy: 0, zoom: 1 }).crop.x, 1 / 3)).toBe(true)
    const zoomed = placePhoto(s, landscape, cell, { ox: 0, oy: 0, zoom: 2 })
    expect(near(zoomed.crop.w, 1 / 3)).toBe(true)
    expect(near(zoomed.crop.h, 0.5)).toBe(true)
  })

  it('turns photos to fit their cell, and makes room for borders and captions', () => {
    const s = S({ rotateToFit: true })
    const tall = { x: 0, y: 0, w: 4, h: 6 }
    const c = placePhoto(s, landscape, tall)
    expect(c.rotate).toBe(true)
    expect(near(c.box.w / c.box.h, 4000 / 6000)).toBe(true)
    const framed = placePhoto(S({ border: 0.5, caption: { ...S().caption, enabled: true, size: 9 } }), portrait, tall)
    expect(framed.box.x).toBeGreaterThanOrEqual(0.5)
    expect(framed.caption!.y).toBeGreaterThanOrEqual(framed.box.y + framed.box.h - 1e-9)
    expect(framed.caption!.y + framed.caption!.h).toBeLessThanOrEqual(6 - 0.5 + 1e-9)
  })

  it('reads page ranges and builds text', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2])
    expect(parsePageRange('2-3, 1', 5)).toEqual([0, 1, 2])
    expect(parsePageRange('9', 3)).toEqual([0, 1, 2])
    expect(pageText('Trip {page}/{pages}', 2, 4, true)).toBe('Trip 2/4    Page 2 of 4')
    expect(captionText({ title: 'Lisbon', filename: 'a.jpg', takenAt: null, shutter: 1 / 250, aperture: 2.8, iso: 100, focal: 35, caption: null, rating: 3 }, ['title', 'exposure', 'rating'], '')).toBe(
      'Lisbon  ·  1/250 s  ƒ/2.8  ISO 100  35 mm  ·  ★★★'
    )
  })

  it('scales sharpening with resolution and media, and print adjustments keep black and white', () => {
    expect(sharpenParams({ sharpen: 'off', media: 'glossy', ppi: 300 })).toBeNull()
    const glossy = sharpenParams({ sharpen: 'standard', media: 'glossy', ppi: 300 })!
    expect(sharpenParams({ sharpen: 'standard', media: 'matte', ppi: 300 })!.amount).toBeGreaterThan(glossy.amount)
    expect(sharpenParams({ sharpen: 'standard', media: 'glossy', ppi: 600 })!.sigma).toBeGreaterThan(glossy.sigma)
    for (const [b, c] of [[20, 0], [0, 50], [-30, -40], [50, 50]]) {
      const lut = adjustmentLut(b, c)!
      expect([lut[0], lut[255]]).toEqual([0, 255])
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1])
    }
    expect(adjustmentLut(20, 0)![128]).toBeGreaterThan(128)
  })
})

describe('print output', () => {
  const dir = tmpDir()
  let lib: Library
  let ids: number[]
  const out = path.join(dir, 'out')
  const deps = (over: Partial<OutputDeps> = {}): OutputDeps => ({
    db: lib.db,
    cacheDir: path.join(dir, 'cache'),
    chartDir: path.join(dir, 'chart'),
    report: () => {},
    signal: new AbortController().signal,
    printHtml: async () => {},
    pdfHtml: async () => Buffer.from('%PDF-'),
    chooseTarget: async (kind) => (kind === 'pdf' ? path.join(out, 'x.pdf') : out),
    ...over
  })

  beforeAll(async () => {
    setWasmSource(() => fs.readFileSync('src/main/print/vendor/lcms.wasm'))
    fs.mkdirSync(out, { recursive: true })
    const photos = path.join(dir, 'Photos')
    await makeJpeg(path.join(photos, 'wide.jpg'), { width: 1200, height: 800, color: '#e04020' })
    await makeJpeg(path.join(photos, 'tall.jpg'), { width: 600, height: 900, color: '#2060e0' })
    lib = new Library(openDb(path.join(dir, 'catalog.db')), path.join(dir, 'cache'))
    const root = lib.addRoot(photos)
    await scanRoot(lib.db, root.id, photos, { cacheDir: lib.cacheDir })
    ids = lib.search({ scope: { type: 'all' }, query: '', sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).ids
  })

  it('saves page images at the print resolution, tagged sRGB or with the paper profile', async () => {
    const r = await runOutput({ settings: { output: 'jpeg', ppi: 100, layout: 'grid', grid: { rows: 1, cols: 2, hGap: 0.2, vGap: 0 }, orientation: 'landscape', cropMarks: true, caption: { ...S().caption, enabled: true, fields: ['filename'] } }, photoIds: ids }, deps())
    expect(r.ok).toBe(true)
    const m = await sharp(r.files![0]).metadata()
    expect([m.width, m.height, m.density]).toEqual([1100, 850, 100])
    expect(m.icc?.length).toBeGreaterThan(0)
    const adobe = '/usr/share/color/icc/colord/AdobeRGB1998.icc'
    if (fs.existsSync(adobe)) {
      const t = await runOutput({ settings: { output: 'tiff', ppi: 100, colorMode: 'glimmr', profile: adobe, intent: 'relative' }, photoIds: [ids[0]] }, deps())
      expect(t.ok).toBe(true)
      expect((await sharp(t.files![0]).metadata()).icc?.length).toBe(fs.statSync(adobe).size)
    }
  })

  it('builds exact-size pages for the printer and PDF', async () => {
    let html = ''
    const r = await runOutput(
      { settings: { output: 'pdf', ppi: 72, paper: '4x6', orientation: 'portrait', margins: { top: 0, right: 0, bottom: 0, left: 0 }, fit: 'fill' }, photoIds: ids },
      deps({ pdfHtml: async (file) => ((html = fs.readFileSync(file, 'utf8')), Buffer.from('%PDF-')) })
    )
    expect(r.ok).toBe(true)
    expect(html).toContain('@page { size: 4in 6in')
    expect(html.match(/<img /g)).toHaveLength(2)
    expect(fs.readFileSync(path.join(out, 'x.pdf'), 'utf8')).toBe('%PDF-')
    let printed = false
    const p = await runOutput({ settings: { output: 'printer', printer: 'Test', copies: 2, ppi: 72 }, photoIds: [ids[0]] }, deps({ printHtml: async () => void (printed = true) }))
    expect(p).toMatchObject({ ok: true, message: 'Sent 2 pages to Test' })
    expect(printed).toBe(true)
  })

  it('refuses CMYK profiles for output and renders soft-proofed previews', async () => {
    const fogra = '/usr/share/color/icc/colord/FOGRA39L_coated.icc'
    if (!fs.existsSync(fogra)) return
    const r = await runOutput({ settings: { output: 'jpeg', ppi: 72, colorMode: 'glimmr', profile: fogra }, photoIds: [ids[0]] }, deps())
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/CMYK/) })
    const plain = await previewPage(lib.db, path.join(dir, 'cache'), path.join(dir, 'chart'), { settings: {}, photoIds: [ids[0]] }, 0, 40)
    const proofed = await previewPage(lib.db, path.join(dir, 'cache'), path.join(dir, 'chart'), { settings: { proof: true, profile: fogra, gamutWarning: true }, photoIds: [ids[0]] }, 0, 40)
    expect(plain.cells[0].src).toMatch(/^data:image\/jpeg;base64,/)
    expect(proofed.cells[0].src).not.toBe(plain.cells[0].src)
  })

  it('prints the calibration chart', async () => {
    const r = await runOutput({ settings: { output: 'jpeg', ppi: 72 }, photoIds: [], chart: true }, deps())
    expect(r.ok).toBe(true)
    expect(path.basename(r.files![0])).toBe('Glimmr calibration chart.jpg')
  })

  it('draws marks, captions and page text in the overlay', () => {
    const s = S({ cropMarks: true, stroke: { width: 1, color: '#000' }, footer: 'Proofs', pageNumbers: true, watermark: { enabled: true, text: '© Me & Co', position: 'br', size: 10, opacity: 0.5 } })
    const l = computeLayout(s, [landscape])
    const svg = overlaySvg(l, l.pages[0], s, ['A caption'], 1)
    expect(svg).toContain('Proofs    Page 1 of 1')
    expect(svg).toContain('© Me &amp; Co')
    expect(svg.match(/<path /g)).toHaveLength(4)
    expect(pagesHtml(l, [{ page: l.pages[0], images: ['file:///x.jpg'], overlay: svg }], s)).toContain('size: 11in 8.5in')
  })
})
