// Runs the CLIP image encoder on this computer: downloads the model once (checked against a pinned SHA-256),
// then turns photos into embeddings. Nothing about the photos leaves the machine.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { InferenceSession } from 'onnxruntime-node'
import MODEL from './model.json'
import { normalize } from './rules'

export { MODEL }

const SIZE = 224
// CLIP's RGB normalisation.
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export class Tagger {
  private session: Promise<InferenceSession> | null = null

  constructor(
    readonly modelDir: string,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  get modelPath(): string {
    return path.join(this.modelDir, MODEL.file)
  }

  installed(): boolean {
    return fs.statSync(this.modelPath, { throwIfNoEntry: false })?.size === MODEL.size
  }

  /** Downloads the model, verifying its size and hash before it's put in place. */
  async download(signal: AbortSignal, onProgress: (bytes: number, total: number) => void): Promise<void> {
    if (this.installed()) return
    fs.mkdirSync(this.modelDir, { recursive: true })
    const part = `${this.modelPath}.part`
    // GLIMMR_MODEL_URL points at a mirror (or a local copy when testing); the hash check still applies.
    const res = await this.fetchImpl(process.env.GLIMMR_MODEL_URL ?? MODEL.url, { signal })
    if (!res.ok || !res.body) throw new Error(`The model couldn't be downloaded (HTTP ${res.status}).`)
    const hash = crypto.createHash('sha256')
    const file = fs.createWriteStream(part)
    let bytes = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        bytes += value.byteLength
        if (!file.write(value)) await new Promise((r) => file.once('drain', r))
        onProgress(bytes, MODEL.size)
      }
      await new Promise<void>((resolve, reject) => file.end((e?: Error | null) => (e ? reject(e) : resolve())))
      if (bytes !== MODEL.size || hash.digest('hex') !== MODEL.sha256) throw new Error('The downloaded model was incomplete or damaged. Try again.')
      fs.renameSync(part, this.modelPath)
      this.removeOtherModels()
    } catch (e) {
      file.destroy()
      fs.rmSync(part, { force: true })
      throw e
    }
  }

  remove(): void {
    this.session = null
    fs.rmSync(this.modelDir, { recursive: true, force: true })
  }

  /** Deletes models from earlier versions of the app, which are replaced rather than kept. */
  private removeOtherModels(): void {
    for (const f of fs.readdirSync(this.modelDir)) if (f !== MODEL.file) fs.rmSync(path.join(this.modelDir, f), { force: true })
  }

  private load(): Promise<InferenceSession> {
    this.session ??= (async () => {
      // Loaded on first use, so a missing native runtime only affects tagging.
      const ort = await import('onnxruntime-node')
      // Leave half the cores free so browsing stays smooth while a library is tagged.
      return ort.InferenceSession.create(this.modelPath, { intraOpNumThreads: Math.max(1, Math.floor(os.cpus().length / 2)), graphOptimizationLevel: 'all' })
    })()
    this.session.catch(() => (this.session = null))
    return this.session
  }

  /** Unit-length embeddings for image files (Glimmr passes its upright thumbnails), in order. */
  async embed(files: string[]): Promise<Float32Array[]> {
    if (!files.length) return []
    const session = await this.load()
    const { Tensor } = await import('onnxruntime-node')
    const input = new Float32Array(files.length * 3 * SIZE * SIZE)
    await Promise.all(files.map(async (f, i) => input.set(await pixels(f), i * 3 * SIZE * SIZE)))
    const out = await session.run({ [session.inputNames[0]]: new Tensor('float32', input, [files.length, 3, SIZE, SIZE]) })
    const data = out[session.outputNames[0]].data as Float32Array
    const dim = data.length / files.length
    return files.map((_, i) => normalize(data.slice(i * dim, (i + 1) * dim)))
  }
}

/** CLIP preprocessing: scale the short side to 224 (bicubic), centre-crop, normalise, channels first. */
export async function pixels(file: string): Promise<Float32Array> {
  const rgb = await sharp(file).rotate().resize(SIZE, SIZE, { fit: 'cover', position: 'centre', kernel: 'cubic' }).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const plane = SIZE * SIZE
  const out = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) out[c * plane + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c]
  return out
}
