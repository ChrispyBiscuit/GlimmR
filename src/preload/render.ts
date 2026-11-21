// The render window's bridge: jobs in, results out (see src/main/develop/renderService.ts).
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('glimmrRender', {
  onJob: (cb: (job: unknown) => void) => ipcRenderer.on('render-job', (_e, job) => cb(job)),
  done: (id: number, result: unknown) => ipcRenderer.send('render-done', id, result),
  ready: () => ipcRenderer.send('render-ready')
})
