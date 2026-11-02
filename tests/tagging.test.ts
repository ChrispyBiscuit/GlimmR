import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/main/db'
import { Library } from '../src/main/library'
import { scanRoot } from '../src/main/scanner'
import { normalize, packEmbedding, tagsFor, unpackEmbedding } from '../src/main/tagging/rules'
import { appliedVocabulary, embeddedIds, hideTag, pendingTagIds, photoTags, retagFromEmbeddings, saveTagResults, setAppliedVocabulary, tagCounts } from '../src/main/tagging/store'
import { MODEL, Tagger } from '../src/main/tagging/tagger'
import fixture from './fixtures-clip.json'
import { makeJpeg, tmpDir } from './fixtures'

const decode = (b64: string): Float32Array => new Float32Array(new Uint8Array(Buffer.from(b64, 'base64')).buffer)

describe('smart tag rule', () => {
  it('gives real photos the same tags as the reference rule', () => {
    for (const p of fixture.photos) expect(tagsFor(decode(p.embedding)).map((t) => t.tag), p.photo).toEqual(p.tags)
  })

  it('keeps tags stable through the int8 embedding store', () => {
    for (const p of fixture.photos) {
      const v = decode(p.embedding)
      const back = unpackEmbedding(packEmbedding(v))
      expect(back.reduce((s, x, i) => s + x * v[i], 0)).toBeGreaterThan(0.99)
      // Rounding can tip a borderline tag, but no more than one.
      const got = tagsFor(back).map((t) => t.tag)
      const changed = [...got.filter((t) => !p.tags.includes(t)), ...p.tags.filter((t) => !got.includes(t))]
      expect(changed.length, p.photo).toBeLessThanOrEqual(1)
    }
  })
})

describe('smart tag storage and search', () => {
  it('stores tags, finds them by auto: and free text, and respects hidden tags', async () => {
    const dir = tmpDir()
    const photos = path.join(dir, 'Photos')
    await makeJpeg(path.join(photos, 'cat.jpg'))
    await makeJpeg(path.join(photos, 'coffee.jpg'))
    const lib = new Library(openDb(path.join(dir, 'catalog.db')), path.join(dir, 'cache'))
    const root = lib.addRoot(photos)
    await scanRoot(lib.db, root.id, photos, { cacheDir: lib.cacheDir })
    const byName = new Map(lib.photos(lib.allIds()).map((p) => [p.filename, p]))
    const fx = new Map(fixture.photos.map((p) => [p.photo, decode(p.embedding)]))

    expect(pendingTagIds(lib.db, MODEL.id).sort()).toEqual(lib.allIds().sort())
    const rows = [
      ['cat.jpg', 'chelsea.png'],
      ['coffee.jpg', 'coffee.png']
    ].map(([file, photo]) => {
      const p = byName.get(file)!
      return { id: p.id, mtime: p.mtime, embedding: fx.get(photo)!, tags: tagsFor(fx.get(photo)!) }
    })
    saveTagResults(lib.db, MODEL.id, rows)
    expect(pendingTagIds(lib.db, MODEL.id)).toEqual([])
    expect(tagCounts(lib.db, MODEL.id)).toEqual({ tagged: 2, total: 2 })

    const find = (q: string): string[] =>
      lib.search({ scope: { type: 'all' }, query: q, sort: { field: 'filename', dir: 'asc' }, offset: 0, limit: 10 }).photos.map((p) => p.filename)
    expect(find('auto:cat')).toEqual(['cat.jpg'])
    expect(find('drink')).toEqual(['coffee.jpg'])
    expect(find('-auto:drink')).toEqual(['cat.jpg'])
    expect(lib.suggest('auto:dr')[0]).toMatchObject({ value: 'auto:=drink', count: 1 })
    const catTags = fixture.photos.find((p) => p.photo === 'chelsea.png')!.tags
    expect(lib.detail(byName.get('cat.jpg')!.id)!.smartTags.map((t) => t.tag)).toEqual(catTags)

    // A hidden tag stays hidden when the photo is tagged again.
    hideTag(lib.db, byName.get('cat.jpg')!.id, 'cat')
    expect(find('auto:=cat')).toEqual([])
    expect(find('auto:cat')).toEqual(['cat.jpg']) // auto: without = also matches 'tabby cat'
    saveTagResults(lib.db, MODEL.id, rows)
    expect(photoTags(lib.db, byName.get('cat.jpg')!.id).map((t) => t.tag)).toEqual(catTags.filter((t) => t !== 'cat'))
    expect(find('cat')).toEqual(['cat.jpg']) // still found by its file name

    // A new vocabulary re-tags from stored embeddings, still keeping hidden tags hidden.
    saveTagResults(lib.db, MODEL.id, rows.map((r) => ({ ...r, tags: [] })))
    expect(find('drink')).toEqual([])
    expect(appliedVocabulary(lib.db)).toBe(null)
    retagFromEmbeddings(lib.db, MODEL.id, embeddedIds(lib.db, MODEL.id), tagsFor)
    setAppliedVocabulary(lib.db, 'v2')
    expect(appliedVocabulary(lib.db)).toBe('v2')
    expect(find('drink')).toEqual(['coffee.jpg'])
    expect(find('auto:=cat')).toEqual([])

    // An edited file is tagged again.
    lib.db.prepare('UPDATE photos SET mtime = mtime + 1 WHERE id = ?').run(byName.get('coffee.jpg')!.id)
    expect(pendingTagIds(lib.db, MODEL.id)).toEqual([byName.get('coffee.jpg')!.id])
  })
})

describe('model download', () => {
  it('rejects a damaged download and leaves nothing behind', async () => {
    const dir = tmpDir()
    const tagger = new Tagger(dir, async () => new Response(new Uint8Array(1000)))
    await expect(tagger.download(new AbortController().signal, () => {})).rejects.toThrow(/incomplete or damaged/)
    expect(fs.readdirSync(dir)).toEqual([])
    expect(tagger.installed()).toBe(false)
  })

  it('reports HTTP errors', async () => {
    const tagger = new Tagger(tmpDir(), async () => new Response('nope', { status: 404 }))
    await expect(tagger.download(new AbortController().signal, () => {})).rejects.toThrow(/HTTP 404/)
  })
})

// End to end with the real model: GLIMMR_CLIP_MODEL=/path/to/clip-vit-b32-visual-w8.onnx and
// GLIMMR_CLIP_PHOTOS=/folder/with/the/fixture/photos (see tests/fixtures-clip.json).
const modelFile = process.env.GLIMMR_CLIP_MODEL
const photoDir = process.env.GLIMMR_CLIP_PHOTOS
describe.skipIf(!modelFile || !photoDir)('CLIP model', () => {
  it('embeds photos like the reference implementation and tags them the same', async () => {
    const dir = tmpDir()
    fs.copyFileSync(modelFile!, path.join(dir, MODEL.file))
    const tagger = new Tagger(dir)
    expect(tagger.installed()).toBe(true)
    const files = fixture.photos.map((p) => path.join(photoDir!, p.photo))
    const vecs = await tagger.embed(files)
    let agree = 0
    fixture.photos.forEach((p, i) => {
      const ref = decode(p.embedding)
      const cos = vecs[i].reduce((s, x, k) => s + x * ref[k], 0)
      expect(cos, p.photo).toBeGreaterThan(0.97)
      if (JSON.stringify(tagsFor(vecs[i]).map((t) => t.tag)) === JSON.stringify(p.tags)) agree++
    })
    // sharp resizes slightly differently from Pillow, which could tip a borderline tag; allow one.
    expect(agree).toBeGreaterThanOrEqual(fixture.photos.length - 1)
    expect(normalize(Float32Array.from(vecs[0])).length).toBe(512)
  }, 120000)
})
