// Assembles printed pages. The SVG overlay (src/shared/printOverlay.ts) serves every output: inline in an HTML page
// for the printer and PDF (text stays vector), and rasterised by sharp for JPEG/TIFF files, so they all match.

import zlib from 'node:zlib'
import fs from 'node:fs'
import sharp, { type OverlayOptions, type Sharp } from 'sharp'
import type { Layout, Page, PrintSettings } from '../../shared/print'
export { overlaySvg } from '../../shared/printOverlay'
import type { RawImage } from './render'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const inches = (v: number): string => `${Number(v.toFixed(4))}in`

/** An HTML document with one exact-size page per entry, for printing and PDF. */
export function pagesHtml(layout: Layout, pages: { page: Page; images: string[]; overlay: string }[], s: PrintSettings, fontCss = '', title = 'Glimmr print'): string {
  const body = pages
    .map(
      ({ page, images, overlay }) =>
        `<div class="page">${page.cells
          .map((c, i) => `<img src="${esc(images[i])}" style="left:${inches(c.box.x)};top:${inches(c.box.y)};width:${inches(c.box.w)};height:${inches(c.box.h)}">`)
          .join('')}${overlay}</div>`
    )
    .join('')
  // The title names the job in the system's print queue.
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fontCss}
@page { size: ${inches(layout.width)} ${inches(layout.height)}; margin: 0 }
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { position: relative; width: ${inches(layout.width)}; height: ${inches(layout.height)}; overflow: hidden; background: ${esc(s.background)}; break-after: page }
.page:last-child { break-after: auto }
.page img { position: absolute; display: block }
.page svg { position: absolute; left: 0; top: 0 }
</style></head><body>${body}</body></html>`
}

/** A whole page as pixels at `ppi`, for JPEG/TIFF output. */
export async function composePage(layout: Layout, page: Page, cells: RawImage[], overlay: string, s: PrintSettings, ppi: number): Promise<RawImage> {
  const width = Math.round(layout.width * ppi)
  const height = Math.round(layout.height * ppi)
  const layers: OverlayOptions[] = page.cells.map((c, i) => ({
    input: cells[i].data,
    raw: { width: cells[i].width, height: cells[i].height, channels: 3 },
    left: Math.round(c.box.x * ppi),
    top: Math.round(c.box.y * ppi)
  }))
  layers.push({ input: await sharp(Buffer.from(overlay), { density: ppi }).resize(width, height).png().toBuffer(), left: 0, top: 0 })
  const out = await sharp({ create: { width, height, channels: 3, background: s.background } })
    .composite(layers)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: out.data, width: out.info.width, height: out.info.height }
}

// ---- files with an ICC profile ----

/** Adds an iCCP chunk (the profile, compressed) to a PNG, replacing any sRGB/gAMA/iCCP chunk. */
export function attachIccToPng(png: Buffer, icc: Buffer, name = 'ICC profile'): Buffer {
  const chunks: Buffer[] = [png.subarray(0, 8)]
  let pos = 8
  const iccp = (() => {
    const data = Buffer.concat([Buffer.from(name.slice(0, 79).replace(/[^\x20-\x7e]/g, '?'), 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(icc)])
    const type = Buffer.from('iCCP', 'latin1')
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0)
    return Buffer.concat([len, type, data, crc])
  })()
  while (pos < png.length) {
    const len = png.readUInt32BE(pos)
    const type = png.toString('latin1', pos + 4, pos + 8)
    const chunk = png.subarray(pos, pos + 12 + len)
    pos += 12 + len
    if (type === 'sRGB' || type === 'gAMA' || type === 'iCCP') continue
    chunks.push(chunk)
    if (type === 'IHDR') chunks.push(iccp)
  }
  return Buffer.concat(chunks)
}

/**
 * Encodes pixels as JPEG or TIFF with a profile attached. Pixels already in the profile's space are only tagged,
 * never converted again; without a profile they're sRGB and tagged as such.
 */
export async function encodeWithProfile(img: RawImage, format: 'jpeg' | 'tiff', ppi: number, profile: string | null, profileName = 'Printer profile'): Promise<Buffer> {
  const raw = { raw: { width: img.width, height: img.height, channels: 3 as const } }
  const finish = (p: Sharp): Promise<Buffer> =>
    (format === 'jpeg' ? p.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }) : p.tiff({ compression: 'lzw', predictor: 'horizontal' })).withDensity(ppi).toBuffer()
  if (!profile) return finish(sharp(img.data, raw).withIccProfile('srgb'))
  const png = await sharp(img.data, raw).png({ compressionLevel: 1 }).toBuffer()
  return finish(sharp(attachIccToPng(png, fs.readFileSync(profile), profileName)).keepIccProfile())
}
