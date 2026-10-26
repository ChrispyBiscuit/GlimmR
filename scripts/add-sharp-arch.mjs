// Adds sharp's prebuilt binaries for extra CPU architectures, so one machine can package
// installers for several (e.g. an Apple Silicon runner building the Intel DMG too).
// Usage: node scripts/add-sharp-arch.mjs <darwin|win32|linux> <cpu> [cpu…]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const [os, ...cpus] = process.argv.slice(2)
if (!os || !cpus.length) {
  console.error('Usage: node scripts/add-sharp-arch.mjs <os> <cpu> [cpu…]')
  process.exit(1)
}
const optional = JSON.parse(readFileSync('node_modules/sharp/package.json', 'utf8')).optionalDependencies ?? {}
const wanted = cpus.flatMap((cpu) => [`@img/sharp-${os}-${cpu}`, `@img/sharp-libvips-${os}-${cpu}`])
const missing = wanted.filter((name) => optional[name] && !existsSync(`node_modules/${name}`))
if (missing.length) {
  const specs = missing.map((name) => `${name}@${optional[name]}`)
  console.log(`Adding ${specs.join(', ')}`)
  // --force skips npm's os/cpu check; --no-save keeps package.json and the lockfile unchanged.
  execFileSync('npm', ['install', '--no-save', '--force', '--ignore-scripts', ...specs], { stdio: 'inherit', shell: process.platform === 'win32' })
}
for (const name of wanted.filter((n) => optional[n])) {
  if (!existsSync(`node_modules/${name}`)) {
    console.error(`Missing ${name} after install`)
    process.exit(1)
  }
  console.log(`ok ${name}`)
}
