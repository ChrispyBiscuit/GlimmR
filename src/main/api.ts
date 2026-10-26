// Implements the renderer-facing API (src/shared/api.ts) on top of the Library and background jobs.

import { app, dialog, shell, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './db'
import { Library } from './library'
import { scanRoot } from './scanner'
import { SORT_FIELDS } from './query'
import { detectEditors, editorFor, launchEditor, mergeEditors } from './editors'
import { createBackup, listBackups, mirroredRootPath, readBackup, restoreCatalogFile, verifyBackup } from './backup'
import type { Api } from '../shared/api'
import type { Editor, JobProgress } from '../shared/types'
import { Updater } from './updater'
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
    })
    return this.scanQueue
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
        for (const [id, job] of this.jobs) if (job.progress.kind === 'scan') this.cancelJob(id)
        await this.scanQueue
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

export function createApi(ctx: AppContext): Api {
  const lib = (): Library => ctx.library
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
        title: 'Choose a GLMR backup folder (ends in .glimmr-backup)',
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
    }
  }
}
