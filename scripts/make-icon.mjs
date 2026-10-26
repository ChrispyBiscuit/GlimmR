// Generates the app icon (build/icon.svg and build/icon.png, 1024×1024); electron-builder turns the PNG into
// .icns and .ico. The mark is the "G" from Rubik Mono One (the wordmark's font, SIL OFL), converted to an
// outline so no font ships in the icon. Layout follows Apple's macOS grid: an 824×824 rounded square inset 100 px.
//
//   node scripts/make-icon.mjs           → build/icon.svg + build/icon.png
//   node scripts/make-icon.mjs --crop    → adds a crop-mark corner (reads as a stray apostrophe below 32 px)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const font = opentype.parse(fs.readFileSync(path.join(root, 'node_modules/@fontsource/rubik-mono-one/files/rubik-mono-one-latin-400-normal.woff')))
const withCrop = process.argv.includes('--crop')
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? path.join(root, 'build/icon')

const INK = '#ededed'

// Size the G to a fixed width, then centre it optically (slightly low and left, making room for the crop mark).
const probe = font.getPath('G', 0, 0, 1000).getBoundingBox()
const targetWidth = withCrop ? 500 : 560
const scale = targetWidth / (probe.x2 - probe.x1)
const gw = (probe.x2 - probe.x1) * scale
const gh = (probe.y2 - probe.y1) * scale
const left = 512 - gw / 2 - (withCrop ? 18 : 0)
const top = 512 - gh / 2 + (withCrop ? 26 : 0)
const g = font.getPath('G', left - probe.x1 * scale, top - probe.y1 * scale, 1000 * scale)

// Crop-mark corner above and to the right of the G, same ink and weight family as the letter.
const cx = left + gw + 52
const cy = top - 52
const arm = 112
const crop = withCrop
  ? `<path d="M ${cx - arm} ${cy} L ${cx} ${cy} L ${cx} ${cy + arm}" fill="none" stroke="${INK}" stroke-width="58" stroke-linecap="square" stroke-linejoin="miter"/>`
  : ''

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2c2c2c"/>
      <stop offset="1" stop-color="#171717"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#plate)"/>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#ffffff" stroke-opacity="0.10" stroke-width="3"/>
  <path d="${g.toPathData(2)}" fill="${INK}"/>
  ${crop}
</svg>
`

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(`${out}.svg`, svg)
await sharp(Buffer.from(svg)).png().toFile(`${out}.png`)
console.log(`${path.relative(root, out)}.svg and .png written`)
