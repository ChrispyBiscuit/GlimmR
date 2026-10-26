// Auto-update from GitHub Releases (electron-updater). CI publishes installers plus latest.yml /
// latest-mac.yml to a release for each version tag; installed apps poll for them.

import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

export const RELEASES_URL = 'https://github.com/ChrispyBiscuit/GlimmR/releases'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export class Updater {
  private status: UpdateStatus = { state: 'idle', currentVersion: app.getVersion() }

  constructor(
    private emit: (s: UpdateStatus) => void,
    private autoDownload: () => boolean
  ) {}

  get(): UpdateStatus {
    return this.status
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch, currentVersion: app.getVersion() }
    this.emit(this.status)
  }

  start(): void {
    if (!app.isPackaged) {
      this.set({ state: 'dev', message: 'Updates are checked in installed builds only.' })
      return
    }
    autoUpdater.autoDownload = this.autoDownload()
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', message: undefined }))
    autoUpdater.on('update-not-available', () => this.set({ state: 'none', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) =>
      this.set({ state: 'available', version: info.version, releaseUrl: `${RELEASES_URL}/tag/v${info.version}`, checkedAt: Date.now() })
    )
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version, percent: 100 }))
    autoUpdater.on('error', (err) => {
      // macOS can only install updates in place for builds signed with a Developer ID.
      // When that fails, point people at the release page instead of failing silently.
      const known = this.status.version
      if (known && process.platform === 'darwin') this.set({ state: 'manual', message: 'Download the new version from the release page.' })
      else this.set({ state: 'error', message: err?.message?.split('\n')[0] ?? 'The update check failed.' })
    })
    setTimeout(() => this.check(), 15_000)
    setInterval(() => this.check(), CHECK_EVERY_MS)
  }

  check(): void {
    if (!app.isPackaged) return this.set({ state: 'dev', message: 'Updates are checked in installed builds only.' })
    autoUpdater.autoDownload = this.autoDownload()
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        // null means this kind of build can't update itself (for example an unpacked Linux build).
        if (!result) this.set({ state: 'manual', message: 'This build can’t update itself. Download new versions from the release page.' })
      })
      .catch(() => {
        // Reported through the 'error' event.
      })
  }

  download(): void {
    autoUpdater.downloadUpdate().catch(() => {})
  }

  install(): void {
    // Give windows a moment to close cleanly, then quit and run the installer.
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
  }

  openReleasePage(): void {
    void shell.openExternal(this.status.releaseUrl ?? RELEASES_URL)
  }
}
