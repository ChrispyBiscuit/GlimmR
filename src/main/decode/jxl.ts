// JPEG XL, decoded by jxl-oxide (a Rust decoder compiled to WebAssembly) to a PNG that keeps the image's ICC profile.

import fs from 'node:fs'
import path from 'node:path'
import type { Decoded } from './types'

type JxlModule = typeof import('jxl-oxide-wasm')
let ready: Promise<JxlModule> | undefined

function jxl(): Promise<JxlModule> {
  return (ready ??= import('jxl-oxide-wasm').then((m) => {
    const dir = path.dirname(require.resolve('jxl-oxide-wasm/package.json'))
    m.initSync({
      module: fs.readFileSync(path.join(dir, 'jxl_oxide_wasm_bg.wasm'))
    })
    return m
  }))
}

export async function decodeJxl(b: Uint8Array): Promise<Decoded> {
  const { JxlImage } = await jxl()
  const img = new JxlImage()
  try {
    img.feedBytes(b)
    if (!img.tryInit()) throw new Error('This JPEG XL file is incomplete.')
    // encodeToPng takes ownership of the frame and frees it.
    return { encoded: img.render().encodeToPng() }
  } finally {
    img.free()
  }
}
