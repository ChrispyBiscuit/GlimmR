import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppContext, createApi } from './api'
import { getPhotos } from './db'
import { BROWSER_EXTS } from './metadata'
import { generatePreviews, previewPaths } from './previews'
import type { Api } from '../shared/api'

protocol.registerSchemesAsPrivileged([{ scheme: 'glimmr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

// A separate data folder (portable installs, testing).
if (process.env.GLIMMR_USER_DATA) app.setPath('userData', process.env.GLIMMR_USER_DATA)

if (!app.requestSingleInstanceLock()) app.quit()

const userData = app.getPath('userData')
const ctx = new AppContext(path.join(userData, 'Library', 'catalog.db'), path.join(userData, 'Cache'))
const api = createApi(ctx)

/** Serves glimmr://thumb/<id>, glimmr://preview/<id> and glimmr://original/<id>. */
async function handleImage(request: Request): Promise<Response> {
  await ctx.ready
  const url = new URL(request.url)
  const kind = url.hostname
  const id = Number(url.pathname.slice(1))
  const [photo] = getPhotos(ctx.library.db, [id])
  if (!photo) return new Response('not found', { status: 404 })
  if (kind === 'original' && BROWSER_EXTS.has(photo.ext) && !photo.offline) return fetchFile(photo.path)
  const paths = previewPaths(ctx.cacheDir, id)
  const file = kind === 'thumb' ? paths.thumb : paths.preview
  if (!fs.existsSync(file)) {
    if (photo.offline) return new Response('offline', { status: 404 })
    try {
      const o = ctx.library.db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id) as { exif_orientation: number }
      await generatePreviews(photo.path, photo.ext, o.exif_orientation, paths)
      ctx.library.db.prepare('UPDATE photos SET has_preview = 1 WHERE id = ?').run(id)
    } catch {
      return new Response('no preview', { status: 404 })
    }
  }
  return fetchFile(file)
}

async function fetchFile(file: string): Promise<Response> {
  const res = await net.fetch(pathToFileURL(file).toString())
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'max-age=31536000' } })
}

function createWindow(): void {
  const settings = ctx.library.getSettings()
  nativeTheme.themeSource = settings.theme
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'GlimmR',
    backgroundColor: '#0d0f12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  ctx.window = win
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('api', async (_e, method: keyof Api, args: unknown[]) => {
  const fn = api[method] as (...a: unknown[]) => unknown
  if (typeof fn !== 'function') throw new Error(`Unknown API method ${String(method)}`)
  await ctx.ready
  if (method === 'setSettings') {
    const patch = args[0] as { theme?: 'dark' | 'light' | 'system' }
    if (patch.theme) nativeTheme.themeSource = patch.theme
  }
  return await fn(...args)
})

app.whenReady().then(() => {
  protocol.handle('glimmr', handleImage)
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  else Menu.setApplicationMenu(null)
  createWindow()
  // Detect editors on first run, then catch up on library changes and scheduled backups.
  if (!ctx.library.getSettings().editors.editors.length) api.detectEditors()
  setTimeout(() => {
    void ctx.scan().then(() => ctx.backupIfDue())
  }, 1500)
  setInterval(() => void ctx.backupIfDue(), 60 * 60 * 1000)
})

app.on('second-instance', () => {
  if (ctx.window) {
    if (ctx.window.isMinimized()) ctx.window.restore()
    ctx.window.focus()
  }
})

let quitting = false
app.on('before-quit', (e) => {
  const s = ctx.library.getSettings().backup
  if (quitting || s.schedule !== 'onQuit' || !s.destination) return
  e.preventDefault()
  quitting = true
  void ctx.backup().finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
