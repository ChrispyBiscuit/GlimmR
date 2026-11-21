// Implements the renderer-facing API (src/shared/api.ts) on top of the Library and background jobs.

import { app, dialog, net, screen, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getPhotos, openDb, reindexFts } from './db'
import sharp from 'sharp'
import { rotateEdit } from '../shared/edit'
import wasmPath from './print/vendor/lcms.wasm?asset'
import { setWasmSource } from './print/color'
import { addProfile, listProfiles } from './print/profiles'
import { previewPage, runOutput } from './print/job'
import { fontCss, listPrinters, pdfHtml, printHtml } from './print/printer'
import { displayFile, photoFiles } from './files'
import { trashSet } from './fileops'
import { removeCached } from './scanner'
import { driverInfo, openWindowsPreferences } from './print/driver'
import { Library } from './library'
import { scanRoot } from './scanner'
import { SORT_FIELDS } from './query'
import { detectEditors, editorFor, launchEditor, mergeEditors } from './editors'
import { createBackup, listBackups, mirroredRootPath, readBackup, restoreCatalogFile, verifyBackup } from './backup'
import type { Api } from '../shared/api'
import type { Editor, Histogram, JobProgress } from '../shared/types'
import { Updater } from './updater'
import { generatePreviews, previewPaths } from './previews'
import { MODEL, Tagger } from './tagging/tagger'
import { tagsFor, VOCABULARY_VERSION } from './tagging/rules'
import { appliedVocabulary, clearTags, embeddedIds, hideTag, pendingTagIds, retagFromEmbeddings, saveTagResults, setAppliedVocabulary, tagCounts } from './tagging/store'
import { TITLE_BAR } from './titlebar'

export class AppContext {
  library: Library
  window: BrowserWindow | null = null
  private jobs = new Map<string, { progress: JobProgress; abort: AbortController }>()
  private scanQueue: Promise<void> = Promise.resolve()
  readonly updater = new Updater(
    (s) => this.emit('update', s),
    () => this.library.getSettings().autoUpdate
  )
  /** Resolves when the catalog is usable; requests wait on it while a restore swaps the catalog file. */
  ready: Promise<void> = Promise.resolve()
  readonly tagger = new Tagger(path.join(app.getPath('userData'), 'Models'), (url, init) => net.fetch(url, init))
  private tagging: Promise<void> | null = null
  private tagAgain = false

  constructor(
    readonly catalogPath: string,
    readonly cacheDir: string
  ) {
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true })
    this.library = new Library(openDb(catalogPath), cacheDir)
  }

  emit(channel: string, payload?: unknown): void {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(channel, payload)
  }

  /** Runs a background job with progress reporting. */
  async runJob<T>(kind: JobProgress['kind'], label: string, fn: (report: (done: number, total: number, message?: string) => void, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const abort = new AbortController()
    const progress: JobProgress = { id, kind, label, done: 0, total: 0, finished: false }
    this.jobs.set(id, { progress, abort })
    let last = 0
    const report = (done: number, total: number, message?: string): void => {
      Object.assign(progress, { done, total, message })
      const now = Date.now()
      if (now - last > 150 || done === total) {
        last = now
        this.emit('job', { ...progress })
      }
    }
    this.emit('job', { ...progress })
    try {
      const result = await fn(report, abort.signal)
      progress.finished = true
      this.emit('job', { ...progress })
      return result
    } catch (e) {
      Object.assign(progress, { finished: true, error: (e as Error).message })
      this.emit('job', { ...progress })
      return undefined
    } finally {
      this.jobs.delete(id)
      this.emit('library-changed')
    }
  }

  cancelJob(id: string): void {
    this.jobs.get(id)?.abort.abort()
  }

  /** Scans one or all roots, one scan at a time. */
  scan(rootId?: number, reimport = false): Promise<void> {
    this.scanQueue = this.scanQueue.then(async () => {
      const roots = this.library.listRoots().filter((r) => rootId == null || r.id === rootId)
      for (const root of roots) {
        await this.runJob('scan', `Scanning ${root.name}`, async (report, signal) => {
          const r = await scanRoot(this.library.db, root.id, root.path, { cacheDir: this.cacheDir, reimport, signal, onProgress: report })
          report(r.found, r.found, `${r.added} new, ${r.updated} updated${r.offline ? `, ${r.offline} missing` : ''}`)
          return r
        })
      }
      void this.tagLibrary()
    })
    return this.scanQueue
  }

  cancelJobs(...kinds: JobProgress['kind'][]): void {
    for (const [id, job] of this.jobs) if (kinds.includes(job.progress.kind)) this.cancelJob(id)
  }

  /** Downloads the smart tag model if it's missing, then tags whatever needs it. */
  async startSmartTags(): Promise<void> {
    if (!this.library.getSettings().smartTags.enabled) return
    if (!this.tagger.installed()) {
      if ([...this.jobs.values()].some((j) => j.progress.kind === 'model')) return
      const mb = (n: number): string => `${Math.round(n / 1e6)}`
      await this.runJob('model', 'Downloading the smart tag model', (report, signal) =>
        this.tagger.download(signal, (bytes, total) => report(bytes, total, `${mb(bytes)} of ${mb(total)} MB`))
      )
    }
    await this.tagLibrary()
  }

  /** Tags photos that are new or changed, one run at a time. Runs after scans, so new photos are tagged as they arrive. */
  tagLibrary(): Promise<void> {
    if (this.tagging) {
      this.tagAgain = true
      return this.tagging
    }
    this.tagging = (async () => {
      do {
        this.tagAgain = false
        if (!this.library.getSettings().smartTags.enabled || !this.tagger.installed()) return
        const stale = appliedVocabulary(this.library.db) !== VOCABULARY_VERSION
        if (!stale && !pendingTagIds(this.library.db, MODEL.id, 1).length) return
        await this.runJob('tags', 'Finding subjects in photos', async (report, signal) => {
          if (stale) {
            // A new vocabulary: re-score what's already analysed, which takes seconds rather than rerunning the model.
            const tagged = embeddedIds(this.library.db, MODEL.id)
            for (let i = 0; i < tagged.length && !signal.aborted; i += 200) {
              retagFromEmbeddings(this.library.db, MODEL.id, tagged.slice(i, i + 200), tagsFor)
              report(i, tagged.length, 'Updating smart tags…')
              await new Promise((r) => setImmediate(r))
            }
            if (signal.aborted) return
            setAppliedVocabulary(this.library.db, VOCABULARY_VERSION)
            this.emit('library-changed')
          }
          const ids = pendingTagIds(this.library.db, MODEL.id)
          let done = 0
          let failed = 0
          for (let i = 0; i < ids.length && !signal.aborted; i += 16) {
            const db = this.library.db
            const photos = getPhotos(db, ids.slice(i, i + 16))
            const rows: Parameters<typeof saveTagResults>[2] = []
            const embedAll = async (list: typeof photos): Promise<void> => {
              const vecs = await this.tagger.embed(list.map((p) => previewPaths(this.cacheDir, p.id).thumb))
              list.forEach((p, k) => rows.push({ id: p.id, mtime: p.mtime, embedding: vecs[k], tags: tagsFor(vecs[k]) }))
            }
            try {
              await embedAll(photos)
            } catch {
              // One unreadable thumbnail shouldn't sink the batch: retry one by one.
              for (const p of photos) await embedAll([p]).catch(() => failed++)
            }
            saveTagResults(db, MODEL.id, rows)
            done += photos.length
            report(done, ids.length, `${done.toLocaleString()} of ${ids.length.toLocaleString()} photos`)
            if (i % 320 === 0) this.emit('library-changed')
            await new Promise((r) => setImmediate(r))
          }
          report(ids.length, ids.length, `${(done - failed).toLocaleString()} photos tagged${failed ? `, ${failed} couldn't be read` : ''}`)
        })
      } while (this.tagAgain)
    })().finally(() => (this.tagging = null))
    return this.tagging
  }

  async removeSmartTags(): Promise<void> {
    this.library.setSettings({ smartTags: { enabled: false } })
    this.cancelJobs('model', 'tags')
    await this.tagging
    this.tagger.remove()
    clearTags(this.library.db)
    this.emit('library-changed')
  }

  async backup(): Promise<void> {
    const s = this.library.getSettings().backup
    if (!s.destination) throw new Error('Choose a backup folder first')
    await this.runJob('backup', 'Backing up library', async (report, signal) => {
      const entry = await createBackup(this.library.db, {
        destination: s.destination!,
        appVersion: app.getVersion(),
        includeOriginals: s.includeOriginals,
        keep: s.keep,
        signal,
        onProgress: report
      })
      this.library.setSettings({ backup: { ...this.library.getSettings().backup, lastBackupAt: entry.manifest.createdAt } })
      report(1, 1, `Saved to ${entry.path}`)
    })
  }

  /** Runs a scheduled backup if one is due. */
  async backupIfDue(): Promise<void> {
    const s = this.library.getSettings().backup
    if (!s.destination || s.schedule === 'off' || s.schedule === 'onQuit') return
    const interval = s.schedule === 'daily' ? 86400000 : 7 * 86400000
    if (!s.lastBackupAt || Date.now() - s.lastBackupAt >= interval) await this.backup()
  }

  async restore(backupPath: string, rootMap: Record<number, string>): Promise<void> {
    await this.runJob('restore', 'Restoring library', async (report) => {
      report(0, 3, 'Saving a safety copy of the current catalog…')
      const keep = this.library.getSettings()
      await createBackup(this.library.db, {
        destination: path.join(app.getPath('userData'), 'Safety backups'),
        appVersion: app.getVersion(),
        includeOriginals: false,
        keep: 5
      })
      report(1, 3, 'Restoring catalog…')
      let reopen!: () => void
      this.ready = new Promise((r) => (reopen = r))
      try {
        // Stop scans that would write to the old catalog, then swap the file.
        this.cancelJobs('scan', 'tags')
        await this.scanQueue
        await this.tagging
        this.library.db.close()
        try {
          await restoreCatalogFile(backupPath, this.catalogPath, rootMap)
        } finally {
          this.library = new Library(openDb(this.catalogPath), this.cacheDir)
        }
      } finally {
        reopen()
      }
      // Editors and backup settings belong to this computer, not to the backup.
      this.library.setSettings({ editors: keep.editors, backup: keep.backup })
      await fs.promises.rm(this.cacheDir, { recursive: true, force: true })
      report(2, 3, 'Rebuilding previews…')
    })
    this.emit('library-changed')
    void this.scan()
  }
}

/** RGB and luminance histograms of an image, with clipping. A thumbnail has plenty of pixels for this. */
async function histogramOf(file: string): Promise<Histogram> {
  const { data, info } = await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const r = new Array(256).fill(0)
  const g = new Array(256).fill(0)
  const b = new Array(256).fill(0)
  const l = new Array(256).fill(0)
  let low = 0
  let high = 0
  let sum = 0
  const n = info.width * info.height
  for (let i = 0; i < data.length; i += info.channels) {
    const R = data[i]
    const G = data[i + 1]
    const B = data[i + 2]
    r[R]++
    g[G]++
    b[B]++
    const Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)
    l[Y]++
    sum += Y
    if (R === 0 || G === 0 || B === 0) low++
    if (R === 255 || G === 255 || B === 255) high++
  }
  return { r, g, b, l, shadowClip: low / n, highlightClip: high / n, mean: sum / n }
}

setWasmSource(() => fs.readFileSync(wasmPath))

export function createApi(ctx: AppContext): Api {
  const lib = (): Library => ctx.library
  const profileDir = (): string => path.join(app.getPath('userData'), 'Profiles')
  const chartDir = (): string => path.join(ctx.cacheDir, 'print')
  /** Re-renders a photo's previews after its edit changed. */
  const rerender = async (id: number): Promise<void> => {
    const [p] = lib().photos([id])
    if (!p || p.offline) return
    // What's in the frame may have changed, so the photo is tagged again from its new thumbnail.
    lib().db.prepare('DELETE FROM photo_embeddings WHERE photo_id = ?').run(id)
    const { exif_orientation } = lib().db.prepare('SELECT exif_orientation FROM photos WHERE id = ?').get(id) as { exif_orientation: number }
    const shown = displayFile(p)
    await generatePreviews(shown.path, shown.ext, exif_orientation, previewPaths(ctx.cacheDir, id), p.edit)
  }
  const pickFolder = async (title: string): Promise<string | null> => {
    const r = await dialog.showOpenDialog(ctx.window!, { title, properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  }
  const refreshEditors = (): Editor[] => {
    const s = lib().getSettings()
    const merged = mergeEditors(s.editors, detectEditors())
    lib().setSettings({ editors: merged })
    return merged.editors
  }

  return {
    listRoots: () => lib().listRoots(),
    addRoot: async (given) => {
      const dir = given ?? (await pickFolder('Add a folder of photos to your library'))
      if (!dir) return null
      if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`"${dir}" is not a folder`)
      const root = lib().addRoot(dir)
      void ctx.scan(root.id)
      return root
    },
    removeRoot: (id) => lib().removeRoot(id),
    relinkRoot: async (id) => {
      const dir = await pickFolder('Choose the new location of this folder')
      if (!dir) return false
      lib().relinkRoot(id, dir)
      void ctx.scan(id)
      return true
    },
    rescan: (rootId, reimport) => void ctx.scan(rootId, reimport),
    cancelJob: (id) => ctx.cancelJob(id),

    search: (req) => lib().search(req),
    facets: (scope, query) => lib().facets(scope, query),
    suggest: (input) => lib().suggest(input),
    photos: (ids) => lib().photos(ids),
    detail: (id) => lib().detail(id),
    sortFields: () => Object.entries(SORT_FIELDS).map(([value, f]) => ({ value, label: f.label })),

    update: (ids, u) => lib().update(ids, u),
    writeXmp: (ids) => {
      const list = ids === 'all' ? lib().allIds() : ids
      void ctx.runJob('xmp', 'Writing XMP sidecars', async (report) => {
        const r = await lib().writeXmp(list, report)
        report(list.length, list.length, `${r.written} written${r.failed ? `, ${r.failed} failed` : ''}`)
      })
    },
    albums: () => lib().albums(),
    createAlbum: (name, ids) => lib().createAlbum(name, ids),
    renameAlbum: (id, name) => lib().renameAlbum(id, name),
    deleteAlbum: (id) => lib().deleteAlbum(id),
    addToAlbum: (id, ids) => lib().addToAlbum(id, ids),
    removeFromAlbum: (id, ids) => lib().removeFromAlbum(id, ids),
    smartAlbums: () => lib().smartAlbums(),
    saveSmartAlbum: (s) => lib().saveSmartAlbum(s),
    deleteSmartAlbum: (id) => lib().deleteSmartAlbum(id),
    keywordTree: () => lib().keywordTree(),
    renameKeyword: (from, to) => lib().renameKeyword(from, to),
    deleteKeyword: (p) => lib().deleteKeyword(p),
    folderTree: () => lib().folderTree(),

    stats: () => lib().stats(),
    onThisDay: () => lib().onThisDay(),
    highlights: (n) => lib().highlights(n),
    shuffle: (n) => lib().shuffle(n),
    recentlyAdded: (n) => lib().recentlyAdded(n),
    lookBack: () => lib().lookBack(),

    openInEditor: (ids, editorId) => {
      const settings = lib().getSettings().editors
      const photos = lib().photos(ids).filter((p) => !p.offline)
      if (!photos.length) return { ok: false, message: 'The selected photos are offline.' }
      // Group by editor so RAW and JPEG can go to different apps.
      const groups = new Map<Editor, string[]>()
      for (const p of photos) {
        const ed = editorId ? settings.editors.find((e) => e.id === editorId) : editorFor(settings, p.ext)
        if (!ed) {
          void shell.openPath(p.path)
          continue
        }
        if (!groups.has(ed)) groups.set(ed, [])
        groups.get(ed)!.push(p.path)
      }
      try {
        for (const [ed, files] of groups) launchEditor(ed, files)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
    openWithDefault: (id) => {
      const [p] = lib().photos([id])
      if (p) void shell.openPath(p.path)
    },
    reveal: (id) => {
      const [p] = lib().photos([id])
      if (p) shell.showItemInFolder(p.path)
    },
    detectEditors: () => refreshEditors(),
    addCustomEditor: async () => {
      const mac = process.platform === 'darwin'
      const r = await dialog.showOpenDialog(ctx.window!, {
        title: 'Choose an image editor',
        defaultPath: mac ? '/Applications' : process.env.ProgramFiles,
        // macOS app bundles are selectable as files with 'openFile'.
        properties: ['openFile'],
        filters: mac ? [{ name: 'Applications', extensions: ['app'] }] : [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat'] }]
      })
      if (r.canceled || !r.filePaths[0]) return null
      const p = r.filePaths[0]
      const editor: Editor = { id: `custom-${Date.now()}`, name: path.basename(p).replace(/\.(app|exe|cmd|bat)$/i, ''), path: p, args: [], detected: false }
      const s = lib().getSettings().editors
      lib().setSettings({ editors: { ...s, editors: [...s.editors, editor] } })
      return editor
    },

    getSettings: () => lib().getSettings(),
    setSettings: (patch) => lib().setSettings(patch),

    chooseBackupFolder: async () => {
      const dir = await pickFolder('Choose where backups are saved (an external drive is best)')
      if (dir) lib().setSettings({ backup: { ...lib().getSettings().backup, destination: dir } })
      return dir
    },
    backupNow: () => void ctx.backup().catch((e) => ctx.emit('job', { id: 'backup-error', kind: 'backup', label: 'Backup', done: 0, total: 0, finished: true, error: e.message })),
    listBackups: () => listBackups(lib().getSettings().backup.destination),
    chooseBackupToRestore: async () => {
      const r = await dialog.showOpenDialog(ctx.window!, {
        title: 'Choose a Glimmr backup folder (ends in .glimmr-backup)',
        defaultPath: lib().getSettings().backup.destination ?? undefined,
        properties: ['openDirectory']
      })
      return r.canceled ? null : readBackup(r.filePaths[0])
    },
    verifyBackup: (p) => verifyBackup(p),
    restorePreview: (p) => {
      const entry = readBackup(p)
      if (!entry) return { roots: [] }
      return { roots: entry.manifest.roots.map((r) => ({ ...r, exists: fs.existsSync(r.path), mirror: mirroredRootPath(p, r) })) }
    },
    chooseFolder: (title) => pickFolder(title),
    restore: (plan) => ctx.restore(plan.backupPath, plan.rootMap),
    appVersion: () => app.getVersion(),
    updateStatus: () => ctx.updater.get(),
    checkForUpdates: () => ctx.updater.check(),
    downloadUpdate: () => ctx.updater.download(),
    installUpdate: () => ctx.updater.install(),
    openReleasePage: () => ctx.updater.openReleasePage(),
    platform: () => process.platform,
    setTitleBarTheme: (theme) => {
      if (process.platform === 'darwin' || !ctx.window || ctx.window.isDestroyed()) return
      ctx.window.setTitleBarOverlay({ ...TITLE_BAR[theme], height: TITLE_BAR.height })
    },

    setEdit: async (id, edit) => {
      lib().setEdit(id, edit)
      await rerender(id)
      ctx.emit('library-changed')
      void ctx.tagLibrary()
      return lib().photos([id])[0] ?? null
    },
    rotatePhotos: async (ids, dir) => {
      for (const p of lib().photos(ids)) {
        if (p.offline) continue
        lib().setEdit(p.id, rotateEdit(p.edit, dir))
        await rerender(p.id)
      }
      ctx.emit('library-changed')
      void ctx.tagLibrary()
    },
    histogram: async (id) => {
      const [p] = lib().photos([id])
      if (!p) return null
      const paths = previewPaths(ctx.cacheDir, id)
      try {
        return histogramOf(fs.existsSync(paths.thumb) ? paths.thumb : paths.preview)
      } catch {
        return null
      }
    },

    trashPhotos: async (ids, part = 'all') => {
      const photos = lib().photos(ids)
      const removed: number[] = []
      let error: string | undefined
      let trashed = 0
      const cache = new Map<string, string[]>()
      const db = lib().db
      for (const p of photos) {
        try {
          // Only one half of a RAW + JPEG pair: the photo stays, as the other file.
          const half = p.companion && part !== 'all' ? part : 'all'
          await trashSet(photoFiles(p, cache), half, (f) => shell.trashItem(f))
          if (half === 'jpeg') {
            db.prepare('UPDATE photos SET companion = NULL WHERE id = ?').run(p.id)
            await rerender(p.id)
          } else if (half === 'raw') {
            const name = path.basename(p.companion!)
            const ext = path.extname(name).slice(1).toLowerCase()
            const rel = p.relPath.includes('/') ? `${p.relPath.slice(0, p.relPath.lastIndexOf('/'))}/${name}` : name
            db.prepare("UPDATE photos SET rel_path = ?, filename = ?, ext = ?, kind = 'image', companion = NULL WHERE id = ?").run(rel, name, ext, p.id)
            reindexFts(db, p.id)
          } else removed.push(p.id)
          trashed++
        } catch (e) {
          error ??= (e as Error).message
        }
        cache.clear()
      }
      lib().removePhotos(removed)
      for (const id of removed) removeCached(ctx.cacheDir, id)
      ctx.emit('library-changed')
      return { trashed, failed: photos.length - trashed, error }
    },

    printers: () => (ctx.window ? listPrinters(ctx.window.webContents) : Promise.resolve([])),
    printProfiles: () => listProfiles(profileDir()),
    addPrintProfile: async () => {
      const r = await dialog.showOpenDialog(ctx.window!, { title: 'Add a printer or paper colour profile', properties: ['openFile'], filters: [{ name: 'ICC profiles', extensions: ['icc', 'icm'] }] })
      if (r.canceled || !r.filePaths[0]) return null
      const dest = await addProfile(profileDir(), r.filePaths[0])
      return (await listProfiles(profileDir())).find((p) => p.path === dest) ?? null
    },
    removePrintProfile: async (p) => {
      // Only profiles Glimmr added can be removed; system ones belong to the OS and printer drivers.
      if (path.dirname(path.resolve(p)) === path.resolve(profileDir())) fs.rmSync(p, { force: true })
    },
    printPreview: (req, page, pxPerInch) => previewPage(lib().db, ctx.cacheDir, chartDir(), req, page, pxPerInch),
    print: async (req) => {
      const result = await ctx.runJob('print', req.chart ? 'Printing the calibration chart' : 'Printing', async (report, signal) => {
        const r = await runOutput(req, {
          db: lib().db,
          cacheDir: ctx.cacheDir,
          chartDir: chartDir(),
          report,
          signal,
          printHtml,
          pdfHtml,
          fontCss: fontCss(path.join(__dirname, '../renderer')),
          chooseTarget: async (kind, suggested) => {
            const docs = app.getPath('documents')
            if (kind === 'pdf') {
              const r = await dialog.showSaveDialog(ctx.window!, { title: 'Save as PDF', defaultPath: path.join(docs, suggested), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
              return r.canceled ? null : (r.filePath ?? null)
            }
            const r = await dialog.showOpenDialog(ctx.window!, { title: 'Choose a folder for the print files', defaultPath: docs, properties: ['openDirectory', 'createDirectory'] })
            return r.canceled ? null : r.filePaths[0]
          }
        }).catch((e: Error) => ({ ok: false, message: e.message }))
        report(1, 1, r.message)
        return r
      })
      return result ?? { ok: false, message: 'Printing failed.' }
    },
    openPrinterSettings: () => {
      if (process.platform === 'darwin') void shell.openExternal('x-apple.systempreferences:com.apple.Print-Scan-Settings.extension')
      else if (process.platform === 'win32') void shell.openExternal('ms-settings:printers')
      else void shell.openExternal('http://localhost:631/printers/')
    },
    printerOptions: (printer) => driverInfo(printer),
    printerPreferences: (printer) => {
      if (process.platform === 'win32') openWindowsPreferences(printer)
    },
    showFile: (p) => shell.showItemInFolder(p),
    displayColor: () => {
      const d = screen.getPrimaryDisplay()
      return { colorSpace: d.colorSpace, colorDepth: d.colorDepth }
    },

    smartTagStatus: () => ({
      enabled: lib().getSettings().smartTags.enabled,
      installed: ctx.tagger.installed(),
      modelSize: MODEL.size,
      ...tagCounts(lib().db, MODEL.id)
    }),
    enableSmartTags: () => {
      lib().setSettings({ smartTags: { enabled: true } })
      void ctx.startSmartTags()
    },
    disableSmartTags: () => {
      lib().setSettings({ smartTags: { enabled: false } })
      ctx.cancelJobs('model', 'tags')
    },
    removeSmartTags: () => void ctx.removeSmartTags(),
    hideSmartTag: (photoId, tag) => hideTag(lib().db, photoId, tag)
  }
}
