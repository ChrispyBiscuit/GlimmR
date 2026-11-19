// A printable calibration chart: compare the print with the screen to judge the printer, paper and profile.

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

/** Chart size in inches (fits Letter and A4 with margins). */
export const CHART = { w: 7.5, h: 10 }

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The chart as SVG in inches-based user units (1 unit = 1/100 inch). */
export function chartSvg(title: string): string {
  const U = 100
  const W = CHART.w * U
  const H = CHART.h * U
  const parts: string[] = []
  const text = (x: number, y: number, s: string, size = 11, weight = 400, anchor = 'start'): void => {
    parts.push(`<text x="${x}" y="${y}" font-family="Archivo, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="#111" text-anchor="${anchor}">${esc(s)}</text>`)
  }
  let y = 30
  text(0, y, title, 20, 700)
  y += 18
  text(0, y, 'Compare with the screen in good daylight. Every grey step should be distinct, greys should look neutral, and gradients smooth.', 9)

  // Grey step wedge: 0–100% in 5% steps, with percentages.
  y += 22
  text(0, y, 'Grey wedge', 11, 600)
  y += 8
  const steps = 21
  const sw = W / steps
  for (let i = 0; i < steps; i++) {
    const v = Math.round(255 * (1 - i / (steps - 1)))
    parts.push(`<rect x="${i * sw}" y="${y}" width="${sw + 0.5}" height="50" fill="rgb(${v},${v},${v})"/>`)
    text(i * sw + sw / 2, y + 64, `${i * 5}`, 7, 400, 'middle')
  }
  // Near-black and near-white separation: 0–10% and 90–100% in 1% steps.
  y += 80
  text(0, y, 'Shadow and highlight separation (1% steps)', 11, 600)
  y += 8
  for (let i = 0; i <= 10; i++) {
    const dark = Math.round(255 * (i / 100))
    const light = Math.round(255 * (1 - i / 100))
    parts.push(`<rect x="${i * (W / 22)}" y="${y}" width="${W / 22 + 0.5}" height="36" fill="rgb(${dark},${dark},${dark})"/>`)
    parts.push(`<rect x="${W / 2 + i * (W / 22)}" y="${y}" width="${W / 22 + 0.5}" height="36" fill="rgb(${light},${light},${light})"/>`)
  }
  parts.push(`<rect x="${W / 2}" y="${y}" width="${W / 2}" height="36" fill="none" stroke="#bbb" stroke-width="0.5"/>`)

  // Smooth gradients.
  y += 54
  text(0, y, 'Gradients', 11, 600)
  const ramps: [string, string][] = [
    ['#000000', '#ffffff'],
    ['#000000', '#ff0000'],
    ['#000000', '#00ff00'],
    ['#000000', '#0000ff'],
    ['#ffffff', '#00ffff'],
    ['#ffffff', '#ff00ff'],
    ['#ffffff', '#ffff00']
  ]
  parts.push('<defs>')
  ramps.forEach(([a, b], i) => parts.push(`<linearGradient id="g${i}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`))
  parts.push(`<linearGradient id="hue">${['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].map((c, i) => `<stop offset="${i / 6}" stop-color="${c}"/>`).join('')}</linearGradient>`)
  parts.push('</defs>')
  y += 8
  ramps.forEach((_, i) => parts.push(`<rect x="0" y="${y + i * 20}" width="${W}" height="18" fill="url(#g${i})"/>`))
  y += ramps.length * 20
  parts.push(`<rect x="0" y="${y}" width="${W}" height="18" fill="url(#hue)"/>`)

  // Colour patches: primaries, secondaries, skin tones and memory colours.
  y += 40
  text(0, y, 'Colour patches', 11, 600)
  y += 8
  const patches: [string, string][] = [
    ['Red', '#ff0000'],
    ['Green', '#00ff00'],
    ['Blue', '#0000ff'],
    ['Cyan', '#00ffff'],
    ['Magenta', '#ff00ff'],
    ['Yellow', '#ffff00'],
    ['Light skin', '#f1c8a8'],
    ['Medium skin', '#c68863'],
    ['Tan skin', '#a0694a'],
    ['Deep skin', '#5c3a2a'],
    ['Sky', '#5d8fc9'],
    ['Foliage', '#4f6b2f'],
    ['Orange', '#e8812a'],
    ['Purple', '#5e3c99'],
    ['Neutral 50%', '#808080'],
    ['Neutral 20%', '#cccccc']
  ]
  const cols = 8
  const pw = W / cols
  patches.forEach(([name, c], i) => {
    const px = (i % cols) * pw
    const py = y + Math.floor(i / cols) * 74
    parts.push(`<rect x="${px + 2}" y="${py}" width="${pw - 4}" height="54" fill="${c}"/>`)
    text(px + pw / 2, py + 66, name, 7, 400, 'middle')
  })

  // Fine-line resolution target.
  y += 2 * 74 + 26
  text(0, y, 'Fine lines (1/300, 1/150, 1/100, 1/75 inch)', 11, 600)
  y += 8
  ;[1 / 3, 2 / 3, 1, 4 / 3].forEach((lw, k) => {
    const x0 = k * (W / 4)
    for (let i = 0; i < 24; i++) parts.push(`<rect x="${x0 + i * lw * 2}" y="${y}" width="${lw}" height="60" fill="#000"/>`)
  })

  // Registration crosses in the corners.
  const cross = (cx: number, cy: number): void => {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="8" fill="none" stroke="#000" stroke-width="0.6"/>`)
    parts.push(`<path d="M${cx - 12} ${cy}H${cx + 12}M${cx} ${cy - 12}V${cy + 12}" stroke="#000" stroke-width="0.6"/>`)
  }
  cross(W - 14, 14)
  cross(W - 14, H - 14)
  cross(14, H - 14)
  text(W / 2, H - 6, 'Glimmr print calibration chart', 8, 400, 'middle')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART.w}in" height="${CHART.h}in" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`
}

/** Renders the chart to a PNG at `ppi` and returns its path and pixel size. */
export async function renderChart(dir: string, ppi: number, title = 'Print calibration chart'): Promise<{ file: string; w: number; h: number }> {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `chart-${ppi}.png`)
  const info = await sharp(Buffer.from(chartSvg(title)), { density: ppi }).flatten({ background: '#ffffff' }).png().toFile(file)
  return { file, w: info.width, h: info.height }
}
