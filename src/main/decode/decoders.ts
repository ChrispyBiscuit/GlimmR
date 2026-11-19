// Formats sharp's libvips can't read, decoded in JavaScript or WebAssembly.

import fs from 'node:fs'
import { decodeBmp } from './bmp'
import { decodeHeif } from './heif'
import { decodeJxl } from './jxl'
import { decodePsd } from './psd'
import type { Decoded } from './types'

const DECODERS: Record<string, (b: Buffer) => Decoded | Promise<Decoded>> = {
  heic: decodeHeif,
  heif: decodeHeif,
  hif: decodeHeif,
  jxl: decodeJxl,
  psd: decodePsd,
  psb: decodePsd,
  bmp: decodeBmp,
  dib: decodeBmp
}

/** Whether Glimmr decodes this format itself rather than through sharp. */
export const hasDecoder = (ext: string): boolean => ext.toLowerCase() in DECODERS

export async function decodeDirect(file: string, ext: string): Promise<Decoded> {
  const decode = DECODERS[ext.toLowerCase()]
  if (!decode) throw new Error(`No decoder for .${ext} files.`)
  return decode(await fs.promises.readFile(file))
}
