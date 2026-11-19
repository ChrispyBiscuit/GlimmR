// A decoding thread: keeps WebAssembly decoders (a second or more for a 12 MP HEIC) off the main process.

import { parentPort } from 'node:worker_threads'
import { decodeDirect } from './decoders'

parentPort?.on('message', async ({ id, file, ext }: { id: number; file: string; ext: string }) => {
  try {
    const r = await decodeDirect(file, ext)
    const bytes = r.encoded ?? r.data
    // Copy into a buffer we own so it can be transferred rather than cloned.
    const owned = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice()
    const result = r.encoded ? { ...r, encoded: owned } : { ...r, data: owned }
    parentPort!.postMessage({ id, result }, [owned.buffer as ArrayBuffer])
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error).message })
  }
})
