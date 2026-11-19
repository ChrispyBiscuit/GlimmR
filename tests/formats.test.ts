import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { decodeBmp } from '../src/main/decode/bmp'
import { decodePsd } from '../src/main/decode/psd'
import { decodeDirect } from '../src/main/decode/decoders'
import { heifIcc } from '../src/main/decode/heif'
import { userCommentText } from '../src/main/metadata'
import { FORMATS, RAW_EXTS, SUPPORTED_EXTS, findFormat, formatIdSql, formatLabel } from '../src/shared/formats'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { largestEmbeddedJpeg, previewPaths } from '../src/main/previews'
import { x3fPreview } from '../src/main/decode/x3f'
import { makeFakeRaw, makeJpeg, tmpDir } from './fixtures'

const FIX = path.join(__dirname, 'fixtures')

/** A w×h test pattern: red ramps across, green ramps down, blue fixed. */
const pattern = (w: number, h: number): Uint8Array => {
  const px = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      px[o] = Math.round((x * 255) / (w - 1))
      px[o + 1] = Math.round((y * 255) / (h - 1))
      px[o + 2] = 128
    }
  return px
}

// ---- tiny writers for formats sharp can't produce ----

function bmp24(w: number, h: number, px: Uint8Array, topDown = false): Buffer {
  const stride = Math.ceil((w * 3) / 4) * 4
  const b = Buffer.alloc(54 + stride * h)
  b.write('BM', 0, 'latin1')
  b.writeUInt32LE(b.length, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(w, 18)
  b.writeInt32LE(topDown ? -h : h, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  for (let y = 0; y < h; y++) {
    const row = topDown ? y : h - 1 - y
    for (let x = 0; x < w; x++) {
      const o = 54 + row * stride + x * 3
      const s = (y * w + x) * 3
      b[o] = px[s + 2]
      b[o + 1] = px[s + 1]
      b[o + 2] = px[s]
    }
  }
  return b
}

/** An 8-bit RLE bitmap: 4×2, palette of 3 colours. */
function bmpRle8(): Buffer {
  const pal = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255]
  ]
  // Bottom row: a run of 3 × index 0, a run of 1 × index 2, end of line.
  // Top row: an absolute run [1, 2, 1] (padded to 16 bits), a run of 1 × index 0, end of line, end of bitmap.
  const data = [3, 0, 1, 2, 0, 0, 0, 3, 1, 2, 1, 0, 1, 0, 0, 0, 0, 1]
  const at = 54 + pal.length * 4
  const b = Buffer.alloc(at + data.length)
  b.write('BM', 0, 'latin1')
  b.writeUInt32LE(b.length, 2)
  b.writeUInt32LE(at, 10)
  b.writeUInt32LE(40, 14)
  b.writeInt32LE(4, 18)
  b.writeInt32LE(2, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(8, 28)
  b.writeUInt32LE(1, 30)
  b.writeUInt32LE(pal.length, 46)
  pal.forEach(([r, g, bl], i) => {
    b[54 + i * 4] = bl
    b[54 + i * 4 + 1] = g
    b[54 + i * 4 + 2] = r
  })
  Buffer.from(data).copy(b, at)
  return b
}

/** PackBits, as Photoshop writes it. */
function packBits(row: Uint8Array): Buffer {
  const out: number[] = []
  let i = 0
  while (i < row.length) {
    let run = 1
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run++
    if (run > 1) {
      out.push(257 - run, row[i])
      i += run
    } else {
      let n = 1
      while (i + n < row.length && n < 128 && row[i + n] !== row[i + n - 1]) n++
      out.push(n - 1, ...row.subarray(i, i + n))
      i += n
    }
  }
  return Buffer.from(out)
}

function psd(
  w: number,
  h: number,
  planes: Uint8Array[],
  o: {
    mode: number
    rle?: boolean
    psb?: boolean
    icc?: Buffer
    depth?: number
  }
): Buffer {
  const parts: Buffer[] = []
  const head = Buffer.alloc(26)
  head.write('8BPS', 0, 'latin1')
  head.writeUInt16BE(o.psb ? 2 : 1, 4)
  head.writeUInt16BE(planes.length, 12)
  head.writeUInt32BE(h, 14)
  head.writeUInt32BE(w, 18)
  head.writeUInt16BE(o.depth ?? 8, 22)
  head.writeUInt16BE(o.mode, 24)
  parts.push(head, Buffer.alloc(4)) // no colour mode data
  let res = Buffer.alloc(0)
  if (o.icc) {
    const r = Buffer.alloc(12)
    r.write('8BIM', 0, 'latin1')
    r.writeUInt16BE(1039, 4)
    r.writeUInt32BE(o.icc.length, 8) // empty name: length byte 0 + pad
    res = Buffer.concat([r, o.icc, Buffer.alloc(o.icc.length % 2)])
  }
  const resLen = Buffer.alloc(4)
  resLen.writeUInt32BE(res.length)
  parts.push(resLen, res, Buffer.alloc(o.psb ? 8 : 4)) // no layers
  const comp = Buffer.alloc(2)
  comp.writeUInt16BE(o.rle ? 1 : 0)
  parts.push(comp)
  const bpr = (w * (o.depth ?? 8)) / 8
  if (!o.rle) parts.push(...planes.map((p) => Buffer.from(p)))
  else {
    const rows = planes.flatMap((p) => Array.from({ length: h }, (_, y) => packBits(p.subarray(y * bpr, (y + 1) * bpr))))
    const counts = Buffer.alloc(rows.length * (o.psb ? 4 : 2))
    rows.forEach((r, i) => (o.psb ? counts.writeUInt32BE(r.length, i * 4) : counts.writeUInt16BE(r.length, i * 2)))
    parts.push(counts, ...rows)
  }
  return Buffer.concat(parts)
}

const planesOf = (px: Uint8Array, w: number, h: number): Uint8Array[] => [0, 1, 2].map((c) => Uint8Array.from({ length: w * h }, (_, i) => px[i * 3 + c]))

const meanDiff = (a: Uint8Array, b: Uint8Array): number => {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i])
  return d / a.length
}

/** Decoder output as 8-bit RGB through sharp, the way previews read it. */
async function rgbOf(d: Awaited<ReturnType<typeof decodeDirect>>): Promise<{ data: Buffer; width: number; height: number }> {
  const img = d.encoded
    ? sharp(Buffer.from(d.encoded))
    : sharp(Buffer.from(d.data), {
        raw: { width: d.width, height: d.height, channels: d.channels }
      })
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

describe('file formats', () => {
  it('has one table for every extension', () => {
    expect(findFormat('jpg')?.id).toBe('jpeg')
    expect(findFormat('.JFIF')?.id).toBe('jpeg')
    expect(findFormat('hif')?.id).toBe('heic')
    expect(findFormat('tif')?.id).toBe('tiff')
    expect(findFormat('photoshop')?.id).toBe('psd')
    for (const e of ['cr3', 'cr2', 'nef', 'arw', 'raf', 'orf', 'rw2', 'raw', 'dng', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'gpr']) expect(RAW_EXTS.has(e)).toBe(true)
    for (const e of ['jpg', 'heic', 'avif', 'jxl', 'png', 'tiff', 'webp', 'gif', 'bmp', 'psd', 'psb']) expect(SUPPORTED_EXTS.has(e) && !RAW_EXTS.has(e)).toBe(true)
    expect(new Set(FORMATS.flatMap((f) => f.exts)).size).toBe(FORMATS.flatMap((f) => f.exts).length)
    expect(formatLabel('cr3')).toBe('Canon raw (CR3)')
    expect(formatLabel('psd')).toBe('Photoshop document (PSD)')
    expect(formatIdSql()).toContain("WHEN 'jpg' THEN 'jpeg'")
  })

  it('decodes BMP: 24-bit both ways up, and RLE8', () => {
    const px = pattern(7, 5)
    for (const topDown of [false, true]) {
      const d = decodeBmp(bmp24(7, 5, px, topDown))
      expect(d.data && [d.width, d.height, d.channels]).toEqual([7, 5, 3])
      expect(Array.from(d.data!)).toEqual(Array.from(px))
    }
    const r = decodeBmp(bmpRle8())
    const at = (x: number, y: number): number[] => Array.from(r.data!.subarray((y * 4 + x) * 3, (y * 4 + x) * 3 + 3))
    // Stored bottom row first: red red red blue; top row: green blue green red.
    expect([at(0, 1), at(3, 1)]).toEqual([
      [255, 0, 0],
      [0, 0, 255]
    ])
    expect([at(0, 0), at(1, 0), at(2, 0), at(3, 0)]).toEqual([
      [0, 255, 0],
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0]
    ])
  })

  it('decodes Photoshop composites: raw and RLE, PSD and PSB, RGB and grey, with the ICC profile', async () => {
    const w = 9
    const h = 6
    const px = pattern(w, h)
    const profile = Buffer.from('fake-icc-profile-bytes')
    for (const o of [{ rle: false }, { rle: true }, { rle: true, psb: true }]) {
      const d = decodePsd(psd(w, h, planesOf(px, w, h), { mode: 3, icc: profile, ...o }))
      expect(Array.from(d.data!)).toEqual(Array.from(px))
      expect(Buffer.from(d.icc!).toString()).toBe('fake-icc-profile-bytes')
    }
    const grey = decodePsd(psd(w, h, [planesOf(px, w, h)[0]], { mode: 1, rle: true }))
    expect(grey.channels).toBe(1)
    expect(Array.from(grey.data!)).toEqual(Array.from(planesOf(px, w, h)[0]))
    // 16-bit: high bytes are kept.
    const wide = planesOf(px, w, h).map((p) => Uint8Array.from(Array.from(p).flatMap((v) => [v, 0x7f])))
    expect(Array.from(decodePsd(psd(w, h, wide, { mode: 3, depth: 16 })).data!)).toEqual(Array.from(px))
  })

  it('decodes HEIC with libheif and JPEG XL with jxl-oxide', async () => {
    const ref = pattern(64, 48)
    for (const f of ['gradient.heic', 'gradient.jxl']) {
      const d = await decodeDirect(path.join(FIX, f), path.extname(f).slice(1))
      const rgb = await rgbOf(d)
      expect([rgb.width, rgb.height]).toEqual([64, 48])
      // HEIC is lossy (and 4:2:0); JPEG XL fixture is lossless.
      expect(meanDiff(rgb.data, ref)).toBeLessThan(f.endsWith('jxl') ? 0.5 : 4)
    }
  })

  it('decodes EXIF user comments', () => {
    const c = (code: string, body: Buffer): Uint8Array => Buffer.concat([Buffer.from(code.padEnd(8, '\0'), 'latin1'), body])
    expect(userCommentText(c('ASCII', Buffer.from('Hello there\0\0')))).toBe('Hello there')
    expect(userCommentText(c('UNICODE', Buffer.from('Café', 'utf16le')))).toBe('Café')
    expect(userCommentText(c('UNICODE', Buffer.from('Hi', 'utf16le').swap16()))).toBe('Hi')
    expect(userCommentText(c('', Buffer.alloc(16)))).toBeNull()
  })

  it('picks the raw file’s preview, not its lossless-JPEG sensor data', async () => {
    const preview = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#09f' }
    })
      .jpeg()
      .toBuffer()
    // A well-formed lossless (SOF3) stream, larger than the preview, as Canon CR2 sensor data is.
    const sof3 = Buffer.from([0xff, 0xc3, 0x00, 0x0b, 8, 0, 30, 0, 40, 1, 1, 0x11, 0])
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 1, 0, 0])
    const lossless = Buffer.concat([Buffer.from([0xff, 0xd8]), sof3, sos, Buffer.alloc(preview.length * 3, 0x55), Buffer.from([0xff, 0xd9])])
    const file = Buffer.concat([Buffer.from('II*\0'), Buffer.alloc(100), preview, Buffer.alloc(100), lossless])
    expect(largestEmbeddedJpeg(file)?.equals(preview)).toBe(true)
  })

  it('reads a Sigma X3F preview', () => {
    const w = 5
    const h = 4
    const px = pattern(w, h)
    const sec = Buffer.alloc(28)
    sec.write('SECi', 0, 'latin1')
    sec.writeUInt32LE(2, 8)
    sec.writeUInt32LE(3, 12)
    sec.writeUInt32LE(w, 16)
    sec.writeUInt32LE(h, 20)
    sec.writeUInt32LE(w * 3, 24)
    const body = Buffer.concat([sec, Buffer.from(px)])
    const head = Buffer.alloc(40)
    head.write('FOVb', 0, 'latin1')
    const dirAt = head.length + body.length
    const dir = Buffer.alloc(24)
    dir.write('SECd', 0, 'latin1')
    dir.writeUInt32LE(1, 8)
    dir.writeUInt32LE(head.length, 12)
    dir.writeUInt32LE(body.length, 16)
    dir.write('IMA2', 20, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32LE(dirAt)
    const d = x3fPreview(Buffer.concat([head, body, dir, tail]))
    expect(d && [d.width, d.height]).toEqual([w, h])
    expect(Array.from(d!.data!)).toEqual(Array.from(px))
  })

  it('finds an ICC profile in a HEIF colr box', () => {
    const prof = Buffer.alloc(200, 7)
    const box = Buffer.alloc(12)
    box.writeUInt32BE(12 + prof.length)
    box.write('colrprof', 4, 'latin1')
    const file = Buffer.concat([Buffer.from('....ftypheic'), box, prof])
    expect(Buffer.from(heifIcc(file)!).equals(prof)).toBe(true)
    expect(heifIcc(Buffer.from('no profile here'))).toBeUndefined()
  })
})

describe('importing every format', () => {
  const dir = tmpDir()
  const photos = path.join(dir, 'Photos')
  const cache = path.join(dir, 'cache')
  let lib: Library
  const all = (query: string): string[] =>
    lib
      .search({
        scope: { type: 'all' },
        query,
        sort: { field: 'filename', dir: 'asc' },
        offset: 0,
        limit: 100
      })
      .photos.map((p) => p.filename)

  beforeAll(async () => {
    fs.mkdirSync(photos, { recursive: true })
    const px = pattern(64, 48)
    await makeJpeg(path.join(photos, 'a.jpg'))
    await makeJpeg(path.join(photos, 'b.jpeg'))
    fs.copyFileSync(path.join(FIX, 'gradient.heic'), path.join(photos, 'phone.heic'))
    fs.copyFileSync(path.join(FIX, 'gradient.heic'), path.join(photos, 'camera.HIF'))
    fs.copyFileSync(path.join(FIX, 'gradient.jxl'), path.join(photos, 'new.jxl'))
    fs.writeFileSync(path.join(photos, 'layered.psd'), psd(64, 48, planesOf(px, 64, 48), { mode: 3, rle: true }))
    fs.writeFileSync(path.join(photos, 'scan.bmp'), bmp24(64, 48, px))
    const raw = { width: 64, height: 48, channels: 3 as const }
    await sharp(Buffer.from(px), { raw }).png().toFile(path.join(photos, 'shot.png'))
    await sharp(Buffer.from(px), { raw }).tiff().toFile(path.join(photos, 'print.tif'))
    await sharp(Buffer.from(px), { raw }).webp().toFile(path.join(photos, 'web.webp'))
    await sharp(Buffer.from(px), { raw }).avif().toFile(path.join(photos, 'web.avif'))
    await makeFakeRaw(path.join(photos, 'IMG_1.CR3'))
    await makeFakeRaw(path.join(photos, 'P100.RW2'))
    await makeFakeRaw(path.join(photos, 'L100.raw'))
    fs.writeFileSync(path.join(photos, 'notes.txt'), 'not a photo')
    lib = new Library(openDb(path.join(dir, 'catalog.db')), cache)
    const root = lib.addRoot(photos)
    await scanRoot(lib.db, root.id, photos, { cacheDir: cache })
  }, 60000)

  it('imports, sizes and previews them all', () => {
    const r = lib.search({
      scope: { type: 'all' },
      query: '',
      sort: { field: 'filename', dir: 'asc' },
      offset: 0,
      limit: 100
    })
    expect(r.photos.map((p) => p.filename)).toEqual(
      ['a.jpg', 'b.jpeg', 'camera.HIF', 'IMG_1.CR3', 'L100.raw', 'layered.psd', 'new.jxl', 'P100.RW2', 'phone.heic', 'print.tif', 'scan.bmp', 'shot.png', 'web.avif', 'web.webp'].sort((a, b) =>
        a.localeCompare(b)
      )
    )
    for (const p of r.photos) {
      expect(fs.existsSync(previewPaths(cache, p.id).thumb), p.filename).toBe(true)
      expect(p.width, p.filename).toBeGreaterThan(0)
    }
    expect(r.photos.find((p) => p.filename === 'layered.psd')).toMatchObject({
      width: 64,
      height: 48
    })
  })

  it('filters by file type', () => {
    expect(all('type:raw')).toEqual(['IMG_1.CR3', 'L100.raw', 'P100.RW2'])
    expect(all('type:cr3')).toEqual(['IMG_1.CR3'])
    expect(all('type:jpeg')).toEqual(['a.jpg', 'b.jpeg'])
    expect(all('type:heic')).toEqual(['camera.HIF', 'phone.heic'])
    expect(all('type:psd')).toEqual(['layered.psd'])
    expect(all('type:jxl type:bmp')).toEqual([])
    expect(all('-type:raw -type:jpeg -type:heic')).toEqual(['layered.psd', 'new.jxl', 'print.tif', 'scan.bmp', 'shot.png', 'web.avif', 'web.webp'])
    const facets = lib.facets({ type: 'all' }, '').type
    expect(facets.find((f) => f.value === 'jpeg')).toMatchObject({
      count: 2,
      label: 'JPEG'
    })
    expect(facets.find((f) => f.value === 'cr3')).toMatchObject({
      count: 1,
      label: 'Canon raw (CR3)'
    })
    expect(facets.find((f) => f.value === 'heic')?.count).toBe(2)
  })
})
