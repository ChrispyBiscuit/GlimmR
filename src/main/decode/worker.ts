// A decoding thread: keeps WebAssembly decoders (a second or more for a 12 MP HEIC) off the main process.

import { parentPort } from 'node:worker_threads'
import fs from 'node:fs'
import { decodeDirect } from './decoders'
import { decodeRawSource } from './raw'

parentPort?.on('message', async ({ id, file, ext, op, half }: { id: number; file: string; ext: string; op?: 'decode' | 'raw'; half?: boolean }) => {
  try {
    if (op === 'raw') {
      const r = await decodeRawSource(new Uint8Array(await fs.promises.readFile(file)), { half })
      const owned = r.data.byteOffset === 0 && r.data.byteLength === r.data.buffer.byteLength ? r.data : r.data.slice()
      parentPort!.postMessage({ id, result: { ...r, data: owned } }, [owned.buffer as ArrayBuffer])
      return
    }
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
