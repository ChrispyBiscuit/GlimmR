import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

export function tmpDir(prefix = 'glimmr-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export interface FixtureOptions {
  make?: string
  model?: string
  lens?: string
  iso?: number
  fnumber?: string
  exposure?: string
  focal?: string
  date?: string
  width?: number
  height?: number
  color?: string
  xmp?: { rating?: number; label?: string; subjects?: string[]; hierarchical?: string[]; title?: string }
}

export function xmpPacket(x: NonNullable<FixtureOptions['xmp']>): string {
  const bag = (items: string[]): string => `<rdf:Bag>${items.map((i) => `<rdf:li>${i}</rdf:li>`).join('')}</rdf:Bag>`
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""
 xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
 ${x.rating != null ? `xmp:Rating="${x.rating}"` : ''} ${x.label ? `xmp:Label="${x.label}"` : ''}>
 ${x.subjects ? `<dc:subject>${bag(x.subjects)}</dc:subject>` : ''}
 ${x.hierarchical ? `<lr:hierarchicalSubject>${bag(x.hierarchical)}</lr:hierarchicalSubject>` : ''}
 ${x.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${x.title}</rdf:li></rdf:Alt></dc:title>` : ''}
 </rdf:Description></rdf:RDF></x:xmpmeta>`
}

export async function makeJpeg(file: string, o: FixtureOptions = {}): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let img = sharp({ create: { width: o.width ?? 600, height: o.height ?? 400, channels: 3, background: o.color ?? '#3a7bd5' } })
    .jpeg()
    .withExif({
      IFD0: { Make: o.make ?? 'FUJIFILM', Model: o.model ?? 'X-T5' },
      IFD2: {
        ISOSpeedRatings: String(o.iso ?? 200),
        FNumber: o.fnumber ?? '28/10',
        ExposureTime: o.exposure ?? '1/250',
        FocalLength: o.focal ?? '23/1',
        LensModel: o.lens ?? 'XF23mmF1.4 R LM WR',
        DateTimeOriginal: o.date ?? '2021:05:14 19:32:10'
      }
    })
  if (o.xmp) img = img.withXmp(xmpPacket(o.xmp))
  await img.toFile(file)
}

/** A fake RAW file: junk bytes around an embedded JPEG preview, like a real CR2/NEF container. */
export async function makeFakeRaw(file: string): Promise<void> {
  const preview = await sharp({ create: { width: 800, height: 533, channels: 3, background: '#c0392b' } }).jpeg().toBuffer()
  const junk = Buffer.alloc(5000, 0x11)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([Buffer.from('II*\0'), junk, preview, junk]))
}
