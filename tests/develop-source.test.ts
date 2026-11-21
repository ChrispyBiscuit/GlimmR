import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { decodeSource, deserialize, serialize, toFloat } from '../src/main/develop/source'
import { decodeRawSource } from '../src/main/decode/raw'
import { prepare, renderReference } from '../src/shared/develop/pipeline'
import { defaultSettings } from '../src/shared/develop/settings'
import { makeJpeg, tmpDir } from './fixtures'

const NEF = process.env.GLIMMR_RAW_SAMPLE

describe('develop sources', () => {
  it('decodes ordinary images to 16-bit sRGB, upright, with a grey-world estimate', async () => {
    const dir = tmpDir()
    const f = path.join(dir, 'a.jpg')
    await makeJpeg(f, { width: 600, height: 400, color: '#806040' })
    const s = await decodeSource({ path: f, ext: 'jpg', companion: null }, 256)
    expect([s.kind, s.width, s.height, s.fullWidth]).toEqual(['display', 256, 171, 600])
    expect(s.autoMul![0]).toBeLessThan(1) // warm image: red needs less gain
    const back = deserialize(serialize(s, 'k'))!
    expect([back.key, back.width, back.data.length]).toEqual(['k', 256, s.data.length])
    expect(back.data[0]).toBe(s.data[0])
  })

  it('falls back to the displayed image when LibRaw can’t read a raw file', async () => {
    const dir = tmpDir()
    const jpg = path.join(dir, 'IMG_1.JPG')
    await makeJpeg(jpg, { width: 300, height: 200 })
    fs.writeFileSync(path.join(dir, 'IMG_1.CR3'), Buffer.alloc(4000, 7))
    const s = await decodeSource({ path: path.join(dir, 'IMG_1.CR3'), ext: 'cr3', companion: jpg }, 256)
    expect(s.kind).toBe('display')
    expect(s.width).toBe(256)
  })

  it.skipIf(!NEF)('develops a real raw file with LibRaw: linear camera RGB and colour data', async () => {
    const r = await decodeRawSource(new Uint8Array(fs.readFileSync(NEF!)), { half: true })
    expect(r.width).toBeGreaterThan(1000)
    expect(r.camera.asShot[1]).toBe(1)
    const s = await decodeSource({ path: NEF!, ext: 'nef', companion: null }, 512)
    expect(s.kind).toBe('raw')
    const out = renderReference(prepare(defaultSettings('raw'), { kind: 'raw', fullWidth: s.fullWidth, camera: s.camera }), toFloat(s))
    const mean = out.data.reduce((a, b) => a + b, 0) / out.data.length
    // A dark night shot, but clearly visible: sRGB-encoded mean well above black.
    expect(mean).toBeGreaterThan(0.12)
    // The resized copy keeps the raw data's level (half-size decode vs the 512 px copy).
    const avg = (d: Uint16Array): number => d.reduce((a, b) => a + b, 0) / d.length
    expect(avg(s.data) / avg(r.data)).toBeCloseTo(1, 1)
  }, 60000)
})
