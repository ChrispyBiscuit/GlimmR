// Decodes formats sharp can't (HEIC, JPEG XL, Photoshop, BMP) on a small pool of worker threads.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { decodeDirect, hasDecoder } from './decoders'
import type { Decoded } from './types'

export { hasDecoder }
export type { Decoded }

interface Job {
  id: number
  file: string
  ext: string
  resolve: (d: Decoded) => void
  reject: (e: Error) => void
}

const SIZE = Math.max(1, Math.min(2, os.cpus().length - 1))
const IDLE_MS = 60_000
const workers: { w: Worker; job: Job | null }[] = []
const queue: Job[] = []
let nextId = 1
let idleTimer: NodeJS.Timeout | undefined

/** The built worker sits next to the main bundle. In tests and unbuilt runs, decode in-process. */
const workerFile = (): string | null => {
  const f = path.join(__dirname, 'decodeWorker.js')
  return fs.existsSync(f) ? f : null
}

function spawn(file: string): { w: Worker; job: Job | null } {
  const slot: { w: Worker; job: Job | null } = {
    w: new Worker(file),
    job: null
  }
  slot.w.on('message', (m: { id: number; result?: Decoded; error?: string }) => {
    const job = slot.job
    slot.job = null
    if (job && job.id === m.id) m.error ? job.reject(new Error(m.error)) : job.resolve(m.result!)
    pump()
  })
  slot.w.on('error', (e: Error) => {
    slot.job?.reject(e)
    slot.job = null
    workers.splice(workers.indexOf(slot), 1)
    pump()
  })
  slot.w.unref()
  workers.push(slot)
  return slot
}

function pump(): void {
  const file = workerFile()
  while (queue.length && file) {
    const slot = workers.find((s) => !s.job) ?? (workers.length < SIZE ? spawn(file) : null)
    if (!slot) break
    const job = queue.shift()!
    slot.job = job
    slot.w.postMessage({ id: job.id, file: job.file, ext: job.ext })
  }
  clearTimeout(idleTimer)
  // Free the decoders' memory when nothing has needed them for a while.
  if (!queue.length && workers.every((s) => !s.job))
    idleTimer = setTimeout(() => {
      for (const s of workers.splice(0)) void s.w.terminate()
    }, IDLE_MS).unref()
}

export function decodeFile(file: string, ext: string): Promise<Decoded> {
  if (!workerFile()) return decodeDirect(file, ext)
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, file, ext, resolve, reject })
    pump()
  })
}
