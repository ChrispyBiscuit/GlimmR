// Renders developed photos on the GPU in a hidden window (src/renderer/src/render/main.ts), for previews, thumbnails,
// export and print: the same engine the Develop view uses, so what you see is what you get.

import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import type { RenderJob, RenderResult } from '../../shared/develop/render'

type Pending = { resolve: (r: RenderResult) => void; reject: (e: Error) => void }

export class RenderService {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private next = 1
  private pending = new Map<number, Pending>()
  /** One job at a time: the GPU and memory are the limit, not the CPU. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor() {
    ipcMain.on('render-done', (_e, id: number, result: RenderResult) => {
      const p = this.pending.get(id)
      if (!p) return
      this.pending.delete(id)
      if (result?.error) p.reject(new Error(result.error))
      else p.resolve(result)
    })
  }

  private start(): Promise<void> {
    if (this.ready && this.win && !this.win.isDestroyed()) return this.ready
    this.win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: { preload: path.join(__dirname, '../preload/render.js'), sandbox: false, contextIsolation: true, backgroundThrottling: false }
    })
    this.ready = new Promise<void>((resolve) => ipcMain.once('render-ready', () => resolve()))
    this.win.on('closed', () => {
      this.win = null
      this.ready = null
      for (const p of this.pending.values()) p.reject(new Error('The render window closed.'))
      this.pending.clear()
    })
    if (process.env.ELECTRON_RENDERER_URL) void this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/render.html`)
    else void this.win.loadFile(path.join(__dirname, '../renderer/render.html'))
    return this.ready
  }

  render(job: Omit<RenderJob, 'id'>): Promise<RenderResult> {
    const run = async (): Promise<RenderResult> => {
      await this.start()
      const id = this.next++
      return new Promise<RenderResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.win!.webContents.send('render-job', { ...job, id })
      })
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}
