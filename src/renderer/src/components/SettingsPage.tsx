import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, CircleAlert, FolderPlus, Link2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { confirmDialog } from '../dialogs'
import { fmtBytes, fmtDate, fmtNum } from '../format'
import type { BackupEntry, EditorSettings } from '../../../shared/types'

const mac = navigator.userAgent.includes('Mac')

const SECTIONS = [
  { key: 'library', label: 'Library' },
  { key: 'editors', label: 'Editors' },
  { key: 'backup', label: 'Backup' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'updates', label: 'Updates' },
  { key: 'help', label: 'Search help' }
]

function Page({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-xl font-semibold">{title}</h1>
        {intro && <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-pretty text-ink-muted">{intro}</p>}
      </header>
      {children}
    </div>
  )
}

function Setting({ label, description, htmlFor, children }: { label: string; description?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-8 border-b py-4 last:border-b-0">
      <div className="max-w-[48ch]">
        <Label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
        </Label>
        {description && <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function LibrarySection() {
  const s = useStore()
  return (
    <Page title="Library" intro="Glimmr catalogs photos where they already are. It never moves, renames or edits your files.">
      <ul className="divide-y rounded-md border bg-raised">
        {s.roots.length === 0 && <li className="p-4 text-[13px] text-ink-muted">No folders yet.</li>}
        {s.roots.map((r) => (
          <li key={r.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[13px] font-medium">
                {r.name}
                {!r.online && <span className="rounded-sm bg-reject/15 px-1.5 text-xs text-reject">Not connected</span>}
              </p>
              <p className="selectable tnum mt-0.5 truncate text-xs text-ink-muted" title={r.path}>
                {fmtNum(r.count)} photos in {r.path}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => api.rescan(r.id)}>
              <RefreshCw data-icon="inline-start" />
              Rescan
            </Button>
            <Button variant="ghost" size="sm" onClick={async () => (await api.relinkRoot(r.id)) && s.refreshSidebar()}>
              <Link2 data-icon="inline-start" />
              Relink
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${r.name} from the library`}
              onClick={async () => {
                if (
                  !(await confirmDialog({
                    title: `Remove ${r.name} from the library?`,
                    description: 'Ratings, keywords and album membership for these photos are removed from the catalog. The files themselves aren’t touched.',
                    confirmLabel: 'Remove Folder',
                    destructive: true
                  }))
                )
                  return
                await api.removeRoot(r.id)
                await s.refreshSidebar()
                s.refreshResults()
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button onClick={async () => (await api.addRoot()) && s.refreshSidebar()}>
          <FolderPlus data-icon="inline-start" />
          Add Folder
        </Button>
        <Button variant="outline" onClick={() => api.rescan()}>
          Rescan All
        </Button>
      </div>
      <div>
        <Setting label="Read marks from files again" description="Re-imports stars, labels, keywords, titles and captions from photos and XMP sidecars, replacing changes made in Glimmr.">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (await confirmDialog({ title: 'Read marks from files again?', description: 'Changes made in Glimmr are replaced by what’s in the files.', confirmLabel: 'Read From Files', destructive: true }))
                api.rescan(undefined, true)
            }}
          >
            Read From Files
          </Button>
        </Setting>
        <Setting label="Save marks to XMP sidecars" description="Writes stars, labels, keywords, titles and captions to a sidecar next to every photo, so Lightroom, Capture One, Bridge and darktable can read them. Other data in existing sidecars is kept.">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (await confirmDialog({ title: 'Save marks for every photo?', description: 'A .xmp file is written or updated next to each photo.', confirmLabel: 'Save to XMP' })) api.writeXmp('all')
            }}
          >
            Save All to XMP
          </Button>
        </Setting>
      </div>
    </Page>
  )
}

const TYPES = [
  { key: 'raw', label: 'RAW files' },
  { key: 'jpg', label: 'JPEG' },
  { key: 'heic', label: 'HEIC' },
  { key: 'tif', label: 'TIFF' },
  { key: 'png', label: 'PNG' },
  { key: 'dng', label: 'DNG' }
]

function EditorSelect({ value, onChange, editors, emptyLabel, id }: { value: string; onChange: (v: string) => void; editors: EditorSettings['editors']; emptyLabel: string; id?: string }) {
  return (
    <Select value={value || '__none'} onValueChange={(v) => onChange(v === '__none' ? '' : v)}>
      <SelectTrigger id={id} className="w-56" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="__none">{emptyLabel}</SelectItem>
          {editors.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function EditorsSection() {
  const s = useStore()
  const ed = s.settings!.editors
  const save = (patch: Partial<EditorSettings>): Promise<void> => s.setSettings({ editors: { ...ed, ...patch } })
  return (
    <Page
      title="Editors"
      intro={
        <>
          Glimmr doesn’t edit photos. Press <Kbd>{mac ? '⌘' : 'Ctrl'}&nbsp;E</Kbd> to open the selection in your editor. Lightroom Classic and Capture One open their import window for files that
          aren’t in their catalog yet.
        </>
      }
    >
      <ul className="divide-y rounded-md border bg-raised">
        {ed.editors.length === 0 && <li className="p-4 text-[13px] text-ink-muted">No editors found on this computer. Add one below.</li>}
        {ed.editors.map((e) => (
          <li key={e.id} className="flex items-center gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{e.name}</p>
              <p className="selectable truncate text-xs text-ink-muted" title={e.path}>
                {e.detected ? 'Found automatically' : 'Added by you'}: {e.path}
              </p>
            </div>
            {!e.detected && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${e.name}`}
                onClick={() => save({ editors: ed.editors.filter((x) => x.id !== e.id), defaultEditor: ed.defaultEditor === e.id ? null : ed.defaultEditor })}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" onClick={async () => (await api.detectEditors(), s.setSettings({}))}>
          Look for Editors Again
        </Button>
        <Button variant="outline" onClick={async () => (await api.addCustomEditor(), s.setSettings({}))}>
          Add an Editor…
        </Button>
      </div>
      <div>
        <Setting label="Default editor" description="Used for every file type without its own choice below." htmlFor="default-editor">
          <EditorSelect id="default-editor" value={ed.defaultEditor ?? ''} onChange={(v) => save({ defaultEditor: v || null })} editors={ed.editors} emptyLabel="System default app" />
        </Setting>
        {TYPES.map((t) => (
          <Setting key={t.key} label={t.label} htmlFor={`editor-${t.key}`}>
            <EditorSelect
              id={`editor-${t.key}`}
              value={ed.perType[t.key] ?? ''}
              editors={ed.editors}
              emptyLabel="Default editor"
              onChange={(v) => {
                const perType = { ...ed.perType }
                if (v) perType[t.key] = v
                else delete perType[t.key]
                void save({ perType })
              }}
            />
          </Setting>
        ))}
      </div>
    </Page>
  )
}

function RestoreDialog({ entry, onClose }: { entry: BackupEntry; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [check, setCheck] = useState<{ ok: boolean; problems: string[] } | null>(null)
  const [roots, setRoots] = useState<{ id: number; name: string; path: string; exists: boolean; mirror: string | null }[]>([])
  const [map, setMap] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.verifyBackup(entry.path).then(setCheck)
    void api.restorePreview(entry.path).then((p) => {
      setRoots(p.roots)
      setMap(Object.fromEntries(p.roots.map((r) => [r.id, r.exists ? r.path : (r.mirror ?? r.path)])))
    })
  }, [entry.path])

  const steps = ['Check', 'Photo locations', 'Restore']
  const m = entry.manifest
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Restore from backup</DialogTitle>
          <DialogDescription>
            Saved {fmtDate(m.createdAt)}, {fmtNum(m.photoCount)} photos{m.originals.included ? `, with copies of ${fmtNum(m.originals.fileCount)} files (${fmtBytes(m.originals.bytes)})` : ''}.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex gap-4 text-xs" aria-label="Restore steps">
          {steps.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} className={cn('flex items-center gap-1.5', i === step ? 'text-ink' : 'text-ink-muted')}>
              <span className={cn('tnum flex size-5 items-center justify-center rounded-full border text-[11px]', i < step && 'border-ink bg-ink text-raised', i === step && 'border-ink')}>
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>

        {step === 0 &&
          (!check ? (
            <p className="text-[13px] text-ink-muted" aria-live="polite">
              Checking every file against its checksum…
            </p>
          ) : check.ok ? (
            <Alert>
              <ShieldCheck />
              <AlertTitle>This backup is intact</AlertTitle>
              <AlertDescription>All checksums match and the catalog passed SQLite’s integrity check.</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>This backup can’t be restored</AlertTitle>
              <AlertDescription>{check.problems.join(' ')}</AlertDescription>
            </Alert>
          ))}

        {step === 1 && (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-ink-muted">Choose where each folder’s photos are now. If the originals were lost, use the copy inside the backup.</p>
            {roots.map((r) => {
              const choice = map[r.id] === r.path ? 'keep' : map[r.id] === r.mirror ? 'mirror' : 'custom'
              return (
                <fieldset key={r.id} className="flex flex-col gap-2">
                  <legend className="mb-2 text-[13px] font-medium">{r.name}</legend>
                  <RadioGroup
                    value={choice}
                    onValueChange={async (val) => {
                      if (val === 'keep') setMap({ ...map, [r.id]: r.path })
                      else if (val === 'mirror' && r.mirror) setMap({ ...map, [r.id]: r.mirror })
                      else {
                        const dir = await api.chooseFolder(`New location of ${r.name}`)
                        if (dir) setMap({ ...map, [r.id]: dir })
                      }
                    }}
                  >
                    {[
                      { v: 'keep', label: 'Where it was', detail: r.exists ? r.path : `${r.path} (not found)`, disabled: false },
                      { v: 'mirror', label: 'The copy in the backup', detail: r.mirror ?? 'This backup didn’t include originals.', disabled: !r.mirror },
                      { v: 'custom', label: 'Somewhere else…', detail: choice === 'custom' ? map[r.id] : 'Choose a folder', disabled: false }
                    ].map((o) => (
                      <div key={o.v} className="flex items-start gap-3">
                        <RadioGroupItem value={o.v} id={`r${r.id}-${o.v}`} disabled={o.disabled} className="mt-0.5" />
                        <Label htmlFor={`r${r.id}-${o.v}`} className={cn('flex flex-col items-start gap-0.5 font-normal', o.disabled && 'opacity-50')}>
                          <span className="text-[13px]">{o.label}</span>
                          <span className="selectable text-xs break-all text-ink-muted">{o.detail}</span>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </fieldset>
              )
            })}
          </div>
        )}

        {step === 2 && (
          <Alert>
            <CircleAlert />
            <AlertTitle>Your current catalog will be replaced</AlertTitle>
            <AlertDescription>A safety copy of it is saved first. Photo files aren’t changed. Previews are rebuilt afterwards.</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          {step > 0 && (
            <Button variant="ghost" disabled={busy} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          {step < 2 ? (
            <Button disabled={step === 0 && !check?.ok} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.restore({ backupPath: entry.path, rootMap: map })
                  toast.success('Library restored', { description: 'Previews are being rebuilt.' })
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Restoring…' : 'Restore Library'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BackupSection() {
  const s = useStore()
  const b = s.settings!.backup
  const [list, setList] = useState<BackupEntry[]>([])
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const refresh = useCallback(() => void api.listBackups().then(setList), [])
  useEffect(refresh, [refresh, b.destination, b.lastBackupAt, s.jobs])
  const save = (patch: Partial<typeof b>): Promise<void> => s.setSettings({ backup: { ...b, ...patch } })
  const running = Object.values(s.jobs).some((j) => j.kind === 'backup')

  return (
    <Page
      title="Backup"
      intro="A backup saves the catalog (stars, labels, keywords, albums, smart albums and settings) with checksums. Include originals to also keep a verified copy of every photo. Keep backups on a different drive from your photos."
    >
      <div>
        <Setting label="Backup folder" description={b.destination ?? 'Not chosen yet. An external drive is best.'}>
          <Button variant="outline" size="sm" onClick={async () => (await api.chooseBackupFolder()) && s.setSettings({})}>
            {b.destination ? 'Change…' : 'Choose…'}
          </Button>
        </Setting>
        <Setting label="Back up automatically">
          <ToggleGroup type="single" variant="outline" size="sm" value={b.schedule} onValueChange={(v) => v && save({ schedule: v as typeof b.schedule })} aria-label="Automatic backup schedule">
            <ToggleGroupItem value="off">Off</ToggleGroupItem>
            <ToggleGroupItem value="onQuit">On Quit</ToggleGroupItem>
            <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
            <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
          </ToggleGroup>
        </Setting>
        <Setting label="Backups to keep" description="Older catalog backups are deleted after a new one is saved." htmlFor="keep">
          <Select value={String(b.keep)} onValueChange={(v) => save({ keep: Number(v) })}>
            <SelectTrigger id="keep" size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[3, 5, 10, 20, 50].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Setting>
        <Setting label="Include originals" description="Keeps a copy of every photo in “Glimmr Originals” in the backup folder. Only new or changed files are copied, and every copy is verified." htmlFor="originals">
          <Switch id="originals" checked={b.includeOriginals} onCheckedChange={(v) => save({ includeOriginals: v })} />
        </Setting>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!b.destination || running} onClick={() => api.backupNow()}>
          {running ? 'Backing Up…' : 'Back Up Now'}
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            const e = await api.chooseBackupToRestore()
            if (e) setRestoring(e)
          }}
        >
          Restore From a Folder…
        </Button>
        <span className="text-[13px] text-ink-muted">Last backup: {b.lastBackupAt ? fmtDate(b.lastBackupAt) : 'never'}</span>
      </div>
      <section>
        <h2 className="mb-3 text-[13px] font-medium">Backups in this folder</h2>
        {list.length === 0 ? (
          <p className="text-[13px] text-ink-muted">None yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="text-left text-xs text-ink-muted">
              <tr className="border-b">
                <th className="py-2 font-normal">Saved</th>
                <th className="py-2 font-normal">Photos</th>
                <th className="py-2 font-normal">Originals</th>
                <th className="py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.path} className="border-b last:border-b-0">
                  <td className="py-2">{fmtDate(e.manifest.createdAt)}</td>
                  <td className="tnum py-2">{fmtNum(e.manifest.photoCount)}</td>
                  <td className="py-2 text-ink-muted">{e.manifest.originals.included ? 'Included' : 'Catalog only'}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={verifying === e.path}
                      onClick={async () => {
                        setVerifying(e.path)
                        const r = await api.verifyBackup(e.path)
                        setVerifying(null)
                        if (r.ok) toast.success('Backup verified', { description: 'Every checksum matches.' })
                        else toast.error('Backup is damaged', { description: r.problems.join(' ') })
                      }}
                    >
                      {verifying === e.path ? 'Verifying…' : 'Verify'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRestoring(e)}>
                      Restore…
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {restoring && <RestoreDialog entry={restoring} onClose={() => setRestoring(null)} />}
    </Page>
  )
}

function AppearanceSection() {
  const s = useStore()
  const st = s.settings!
  return (
    <Page title="Appearance">
      <div>
        <Setting label="Theme" description="Both themes use neutral greys so photo colours look right.">
          <ToggleGroup type="single" variant="outline" size="sm" value={st.theme} onValueChange={(v) => v && s.setSettings({ theme: v as typeof st.theme })} aria-label="Theme">
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="system">System</ToggleGroupItem>
          </ToggleGroup>
        </Setting>
        <Setting label="Move to the next photo after marking" description="After you rate, flag or label one photo, the next one is selected." htmlFor="auto-advance">
          <Switch id="auto-advance" checked={st.autoAdvance} onCheckedChange={(v) => s.setSettings({ autoAdvance: v })} />
        </Setting>
      </div>
    </Page>
  )
}

function UpdatesSection() {
  const s = useStore()
  const u = s.update
  const status: Record<string, string> = {
    idle: 'Glimmr checks for updates shortly after it starts and every few hours.',
    dev: 'This is a development build. Installed builds check GitHub for updates.',
    checking: 'Checking for updates…',
    none: `You’re on the latest version${u?.checkedAt ? ` (checked ${fmtDate(u.checkedAt, { timeStyle: 'short' })})` : ''}.`,
    available: `Version ${u?.version} is available.`,
    downloading: `Downloading version ${u?.version}… ${u?.percent ?? 0}%`,
    ready: `Version ${u?.version} is downloaded and installs when you restart.`,
    manual: `Version ${u?.version} is available. ${u?.message ?? ''}`,
    error: `The update check didn’t work: ${u?.message ?? 'unknown error'}. Check your connection and try again.`
  }
  return (
    <Page title="Updates" intro="New versions are published as GitHub releases. Glimmr downloads them in the background and installs them when you restart.">
      <div>
        <Setting label={`Glimmr ${u?.currentVersion ?? ''}`} description={status[u?.state ?? 'idle']}>
          {u?.state === 'ready' ? (
            <Button size="sm" onClick={() => api.installUpdate()}>
              Restart to Update
            </Button>
          ) : u?.state === 'available' ? (
            <Button size="sm" onClick={() => api.downloadUpdate()}>
              Download Update
            </Button>
          ) : u?.state === 'manual' ? (
            <Button size="sm" onClick={() => api.openReleasePage()}>
              Open Release Page
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={u?.state === 'checking' || u?.state === 'downloading'} onClick={() => api.checkForUpdates()}>
              Check for Updates
            </Button>
          )}
        </Setting>
        <Setting label="Download updates automatically" description="When off, Glimmr tells you about a new version and waits for you to download it." htmlFor="auto-update">
          <Switch id="auto-update" checked={s.settings!.autoUpdate} onCheckedChange={(v) => s.setSettings({ autoUpdate: v })} />
        </Setting>
        <Setting label="Release notes" description="See what changed in each version.">
          <Button variant="outline" size="sm" onClick={() => api.openReleasePage()}>
            View Releases
          </Button>
        </Setting>
      </div>
    </Page>
  )
}

const HELP: [string, string][] = [
  ['sunset beach', 'Words match file and folder names, keywords, titles, captions, cameras, lenses, albums and every text metadata value. Partial words work: lisb finds Lisbon.'],
  ['"golden hour"', 'An exact phrase.'],
  ['camera:"X-T5"   lens:85', 'A field that contains a value.'],
  ['camera:="Canon EOS R5"', 'A field with exactly this value. The filters use this form.'],
  ['iso:>1600   f:<=2.8   rating:>=4', 'Number comparisons with >, >=, <, <= or =.'],
  ['focal:24..70   iso:100..400', 'Number ranges.'],
  ['shutter:<1/500   size:>20mb   mp:>40', 'Shutter in seconds or fractions, file size with kb/mb/gb, megapixels.'],
  ['date:2019   date:2019-07   date:2019-07-14', 'Year, month or day taken.'],
  ['date:2018..2020   date:>=2021-06', 'Date ranges and comparisons.'],
  ['flag:pick   label:red   rating:0', 'Marks.'],
  ['keyword:Portugal   album:"Trip"   folder:2021', 'Organization.'],
  ['type:raw   orientation:portrait', 'File type and shape.'],
  ['has:gps   has:keywords   is:offline', 'Whether something is present.'],
  ['ExposureProgram:Manual', 'Any EXIF, IPTC or XMP field by name. Click a value in the photo info panel to search for it.'],
  ['-raw   -keyword:test', 'A minus sign excludes.']
]

const KEYS: [string, string][] = [
  ['/', 'Search'],
  ['← → ↑ ↓', 'Move between photos'],
  ['Enter', 'View the photo'],
  ['1–5, 0', 'Set or clear stars'],
  ['P, X, U', 'Pick, reject, unflag'],
  ['6–9', 'Red, yellow, green or blue label'],
  [mac ? '⌘E' : 'Ctrl+E', 'Open in your editor'],
  ['S', 'Slideshow'],
  ['I', 'Photo info in the viewer'],
  ['Z or click', 'Zoom to 100%'],
  ['Esc', 'Back, or clear the selection']
]

function HelpSection() {
  return (
    <Page title="Search help" intro="Type words, fields or both. Every filter you pick appears in the search box, so you can edit it there.">
      <dl className="divide-y rounded-md border bg-raised">
        {HELP.map(([q, d]) => (
          <div key={q} className="grid grid-cols-[minmax(0,280px)_1fr] gap-6 px-4 py-3">
            <dt>
              <code className="selectable text-[13px]">{q}</code>
            </dt>
            <dd className="text-[13px] text-ink-muted">{d}</dd>
          </div>
        ))}
      </dl>
      <section>
        <h2 className="mb-3 text-[13px] font-medium">Keyboard</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2">
          {KEYS.map(([k, d]) => (
            <div key={k} className="flex items-center gap-3 text-[13px]">
              <dt className="w-28 shrink-0">
                <Kbd>{k}</Kbd>
              </dt>
              <dd className="text-ink-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Page>
  )
}

export function SettingsPage() {
  const s = useStore()
  if (!s.settings) return null
  const Section = { library: LibrarySection, editors: EditorsSection, backup: BackupSection, appearance: AppearanceSection, updates: UpdatesSection, help: HelpSection }[s.settingsSection] ?? LibrarySection
  return (
    <div className="flex h-full">
      <nav aria-label="Settings" className="flex w-52 shrink-0 flex-col gap-px border-r bg-panel p-3">
        <Button variant="ghost" size="sm" className="mb-3 justify-start" onClick={s.closeSettings}>
          <ArrowLeft data-icon="inline-start" />
          Back
        </Button>
        {SECTIONS.map((sec) => (
          <button
            key={sec.key}
            type="button"
            aria-current={s.settingsSection === sec.key ? 'page' : undefined}
            onClick={() => s.openSettings(sec.key)}
            className={cn('h-8 rounded-md px-2.5 text-left text-[13px] text-ink-muted hover:bg-accent hover:text-ink', s.settingsSection === sec.key && 'bg-accent font-medium text-ink')}
          >
            {sec.label}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-w-0 flex-1 overflow-y-auto bg-panel px-12 py-10">
        <Section />
      </div>
    </div>
  )
}
