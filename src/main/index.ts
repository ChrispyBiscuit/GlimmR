import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell, Menu } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppContext, createApi } from './api'
import { getPhotos } from './db'
import { BROWSER_EXTS } from './metadata'
import { generatePreviews, previewPaths, renderFullEdit, renderPreviewOf } from './previews'
import { displayFile } from './files'
import { isEdited } from '../shared/edit'
import type { Api } from '../shared/api'
import { TITLE_BAR } from './titlebar'
import { watchCards } from './volumes'
import { sourceFull, sourceImage } from './importer'
import { developParity } from './develop/parity'

// Developing photos needs WebGL2. Where the GPU is blocklisted, Chromium may only offer WebGL through its software
// renderer (SwiftShader), which it now hides behind this switch; Glimmr only renders its own local content.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

protocol.registerSchemesAsPrivileged([{ scheme: 'glimmr', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

// A separate data folder (portable installs, testing).
// The data folder is pinned to "Glimmr" so a change of product name never moves the library.
app.setPath('userData', process.env.GLIMMR_USER_DATA ?? path.join(app.getPath('appData'), 'Glimmr'))

if (!app.requestSingleInstanceLock()) app.quit()

const userData = app.getPath('userData')
const ctx = new AppContext(path.join(userData, 'Library', 'catalog.db'), path.join(userData, 'Cache'))
const api = createApi(ctx)

/** Serves glimmr://thumb/<id>, glimmr://preview/<id> and glimmr://original/<id>. */
// glimmr://thumb, preview (edited when there's an edit), source (the unedited preview, for the crop tool) and
// original (the file itself, or a full-resolution render of its edit).
async function handleImage(request: Request): Promise<Response> {
  await ctx.ready
  const url = new URL(request.url)
  const kind = url.hostname
  // A photo on a card being imported: glimmr://import/<session>/<index>?s=thumb|preview
  if (kind === 'import') {
    const [token, index] = url.pathname.slice(1).split('/')
    try {
      const size = url.searchParams.get('s')
      const file = size === 'full' ? await sourceFull(token, Number(index)) : await sourceImage(token, Number(index), size === 'preview' ? 'preview' : 'thumb')
      return file ? fetchFile(file) : new Response('not found', { status: 404 })
    } catch {
      return new Response('no preview', { status: 404 })
    }
  }
  const id = Number(url.pathname.slice(1))
  const [photo] = getPhotos(ctx.library.db, [id])
  if (!photo) return new Response('not found', { status: 404 })
  const paths = previewPaths(ctx.cacheDir, id)
  const edited = isEdited(photo.edit)
  // A RAW + JPEG pair is shown by its camera JPEG; `raw` shows the RAW's own preview, for comparison.
  const shown = displayFile(photo)
  if (kind === 'raw') {
    if (!photo.companion) return handleImage(new Request(request.url.replace('//raw/', '//preview/')))
    if (!fs.existsSync(paths.raw)) {
      try {
        const o = ctx.library.db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id) as { exif_orientation: number }
        await renderPreviewOf(photo.path, photo.ext, o.exif_orientation, paths.raw)
      } catch {
        return new Response('no preview', { status: 404 })
      }
    }
    return fetchFile(paths.raw)
  }
  if (kind === 'original' && BROWSER_EXTS.has(shown.ext) && !photo.offline) {
    if (!edited) return fetchFile(shown.path)
    if (!fs.existsSync(paths.full)) {
      try {
        await renderFullEdit(shown.path, photo.edit!, paths.full)
      } catch {
        return new Response('render failed', { status: 500 })
      }
    }
    return fetchFile(paths.full)
  }
  const file = kind === 'thumb' ? paths.thumb : kind === 'preview' && edited ? paths.view : paths.preview
  if (!fs.existsSync(file)) {
    if (photo.offline) return new Response('offline', { status: 404 })
    try {
      const o = ctx.library.db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id) as { exif_orientation: number }
      await generatePreviews(shown.path, shown.ext, o.exif_orientation, paths, photo.edit)
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
    title: 'Glimmr',
    backgroundColor: TITLE_BAR.dark.color,
    // The app draws its own top bar. macOS keeps its traffic lights, centred in that bar; Windows and Linux keep
    // their native window buttons as an overlay (so Snap Layouts still work), recoloured to match the theme.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 17 } } : { titleBarOverlay: { ...TITLE_BAR.dark, height: TITLE_BAR.height } }),
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
  // Test hooks (end-to-end tests only).
  if (process.env.GLIMMR_TEST) (globalThis as Record<string, unknown>).__glimmrTest = { parity: (file: string, ext: string, settings: unknown) => developParity(ctx.renderer, file, ext, settings) }
  protocol.handle('glimmr', handleImage)
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]))
  else Menu.setApplicationMenu(null)
  createWindow()
  // Detect editors on first run, then catch up on library changes, scheduled backups and smart tags.
  if (!ctx.library.getSettings().editors.editors.length) api.detectEditors()
  setTimeout(() => {
    void ctx.scan().then(() => Promise.all([ctx.backupIfDue(), ctx.startSmartTags()]))
  }, 1500)
  setInterval(() => void ctx.backupIfDue(), 60 * 60 * 1000)
  // Camera cards: the renderer offers or opens Import when one appears.
  watchCards((cards) => {
    ctx.cards = cards
    ctx.emit('cards', cards)
  })
  ctx.updater.start()
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
