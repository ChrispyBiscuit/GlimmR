// The page overlay: strokes, crop marks, captions, header, footer and watermark, as SVG in physical units. Shared by
// the print preview and every output so they match exactly.

import { pageText, type Layout, type Page, type PrintSettings } from './print'

const PT = 72
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"

/** The page's overlay as SVG, sized in inches with a point-based viewBox. */
export function overlaySvg(layout: Layout, page: Page, s: PrintSettings, captions: string[], pageCount: number): string {
  const W = layout.width * PT
  const H = layout.height * PT
  const o: string[] = []
  page.cells.forEach((c, i) => {
    const b = { x: c.box.x * PT, y: c.box.y * PT, w: c.box.w * PT, h: c.box.h * PT }
    if (s.stroke.width > 0) {
      const sw = s.stroke.width
      o.push(`<rect x="${b.x + sw / 2}" y="${b.y + sw / 2}" width="${Math.max(0, b.w - sw)}" height="${Math.max(0, b.h - sw)}" fill="none" stroke="${esc(s.stroke.color)}" stroke-width="${sw}"/>`)
    }
    if (s.cropMarks) {
      const gap = 3
      const len = 12
      const corners: [number, number, number, number][] = [
        [b.x, b.y, -1, -1],
        [b.x + b.w, b.y, 1, -1],
        [b.x, b.y + b.h, -1, 1],
        [b.x + b.w, b.y + b.h, 1, 1]
      ]
      for (const [x, y, dx, dy] of corners) {
        o.push(`<path d="M${x + dx * gap} ${y}h${dx * len}M${x} ${y + dy * gap}v${dy * len}" stroke="#000" stroke-width="0.5" fill="none"/>`)
      }
    }
    if (c.caption && captions[i]) {
      const r = c.caption
      o.push(
        `<text x="${(r.x + r.w / 2) * PT}" y="${(r.y + r.h * 0.62) * PT}" font-family="${esc(FONT)}" font-size="${s.caption.size}" fill="${esc(s.caption.color)}" text-anchor="middle">${esc(captions[i])}</text>`
      )
    }
    if (s.watermark.enabled && s.watermark.text.trim()) {
      const pad = Math.max(4, s.watermark.size * 0.8)
      const pos = s.watermark.position
      const x = pos === 'c' ? b.x + b.w / 2 : pos.endsWith('l') ? b.x + pad : b.x + b.w - pad
      const y = pos === 'c' ? b.y + b.h / 2 : pos.startsWith('t') ? b.y + pad + s.watermark.size : b.y + b.h - pad
      const anchor = pos === 'c' ? 'middle' : pos.endsWith('l') ? 'start' : 'end'
      o.push(
        `<text x="${x}" y="${y}" font-family="${esc(FONT)}" font-size="${s.watermark.size}" fill="#ffffff" fill-opacity="${s.watermark.opacity}" stroke="#000000" stroke-opacity="${s.watermark.opacity * 0.35}" stroke-width="0.3" text-anchor="${anchor}">${esc(s.watermark.text)}</text>`
      )
    }
  })
  const band = (r: { x: number; y: number; w: number; h: number } | null, t: string): void => {
    if (!r || !t) return
    o.push(`<text x="${(r.x + r.w / 2) * PT}" y="${(r.y + r.h * 0.62) * PT}" font-family="${esc(FONT)}" font-size="${s.textSize}" fill="#333333" text-anchor="middle">${esc(t)}</text>`)
  }
  band(layout.header, pageText(s.header, page.index + 1, pageCount, false))
  band(layout.footer, pageText(s.footer, page.index + 1, pageCount, s.pageNumbers))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}in" height="${layout.height}in" viewBox="0 0 ${W} ${H}">${o.join('')}</svg>`
}

