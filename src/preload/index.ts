import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Bridge } from '../shared/api'
import type { JobProgress, UpdateStatus } from '../shared/types'

const bridge: Bridge = {
  call: (method, ...args) => ipcRenderer.invoke('api', method, args),
  onJob: (cb) => {
    const listener = (_: unknown, p: JobProgress): void => cb(p)
    ipcRenderer.on('job', listener)
    return () => ipcRenderer.removeListener('job', listener)
  },
  onLibraryChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('library-changed', listener)
    return () => ipcRenderer.removeListener('library-changed', listener)
  },
  onUpdate: (cb) => {
    const listener = (_: unknown, s: UpdateStatus): void => cb(s)
    ipcRenderer.on('update', listener)
    return () => ipcRenderer.removeListener('update', listener)
  },
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('glimmr', bridge)
