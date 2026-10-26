// Generates build/icon.png (1024×1024), which electron-builder turns into .icns and .ico.
// The mark: a four-point glint on neutral grey, matching the app's palette (docs/DESIGN.md).
import sharp from 'sharp'

const size = 1024
const c = size / 2
const glint = (r, w) => `M ${c} ${c - r} Q ${c + w} ${c - w} ${c + r} ${c} Q ${c + w} ${c + w} ${c} ${c + r} Q ${c - w} ${c + w} ${c - r} ${c} Q ${c - w} ${c - w} ${c} ${c - r} Z`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect x="100" y="100" width="824" height="824" rx="184" fill="#232323"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="183.5" fill="none" stroke="#3a3a3a" stroke-width="1"/>
  <path d="${glint(300, 46)}" fill="#ededed"/>
  <circle cx="${c + 200}" cy="${c - 200}" r="34" fill="#f2c744"/>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(new URL('../build/icon.png', import.meta.url).pathname)
console.log('build/icon.png written')
