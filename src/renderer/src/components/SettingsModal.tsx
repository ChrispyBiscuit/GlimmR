import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Flex, InputNumber, List, Modal, Radio, Segmented, Select, Space, Steps, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { fmtBytes, fmtDate, fmtNum } from '../format'
import type { BackupEntry, EditorSettings } from '../../../shared/types'

const { Text, Paragraph, Title } = Typography

function LibraryTab() {
  const s = useStore()
  const { modal } = App.useApp()
  return (
    <div>
      <Paragraph type="secondary">GlimmR catalogs photos where they are. It never moves, renames or edits your files.</Paragraph>
      <List
        bordered
        dataSource={s.roots}
        locale={{ emptyText: 'No folders yet' }}
        renderItem={(r) => (
          <List.Item
            actions={[
              <Tooltip key="scan" title="Look for new and changed photos">
                <Button size="small" icon={<ReloadOutlined />} onClick={() => api.rescan(r.id)}>
                  Rescan
                </Button>
              </Tooltip>,
              <Tooltip key="relink" title="The folder moved or the drive letter changed? Point GlimmR at its new location.">
                <Button size="small" icon={<LinkOutlined />} onClick={async () => (await api.relinkRoot(r.id)) && s.refreshSidebar()}>
                  Relink
                </Button>
              </Tooltip>,
              <Button
                key="rm"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  modal.confirm({
                    title: `Remove “${r.name}” from the library?`,
                    content: 'Ratings, keywords and album membership for these photos are removed from the catalog. Your files are not touched.',
                    okButtonProps: { danger: true },
                    okText: 'Remove',
                    onOk: async () => {
                      await api.removeRoot(r.id)
                      await s.refreshSidebar()
                      s.refreshResults()
                    }
                  })
                }
              />
            ]}
          >
            <List.Item.Meta
              title={
                <Space>
                  {r.name}
                  {!r.online && <Tag color="red">Offline</Tag>}
                </Space>
              }
              description={
                <span className="selectable">
                  {r.path} · {fmtNum(r.count)} photos
                </span>
              }
            />
          </List.Item>
        )}
      />
      <Flex gap={8} wrap style={{ marginTop: 12 }}>
        <Button type="primary" icon={<FolderAddOutlined />} onClick={async () => (await api.addRoot()) && s.refreshSidebar()}>
          Add folder
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => api.rescan()}>
          Rescan all
        </Button>
        <Button
          onClick={() =>
            modal.confirm({
              title: 'Re-read metadata from files?',
              content: 'Ratings, labels, keywords, titles and captions are re-imported from the photos and XMP sidecars, replacing edits made in GlimmR.',
              onOk: () => api.rescan(undefined, true)
            })
          }
        >
          Re-read metadata from files
        </Button>
        <Button
          onClick={() =>
            modal.confirm({
              title: 'Write XMP sidecars for every photo?',
              content: 'Saves rating, label, keywords, title and caption next to each photo (photo.xmp) for Lightroom, Capture One, Bridge and darktable. Other data in existing sidecars is kept.',
              onOk: () => api.writeXmp('all')
            })
          }
        >
          Write XMP for all photos
        </Button>
      </Flex>
    </div>
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

function EditorsTab() {
  const s = useStore()
  const ed = s.settings!.editors
  const save = (patch: Partial<EditorSettings>): Promise<void> => s.setSettings({ editors: { ...ed, ...patch } })
  const options = [{ value: '', label: 'System default app' }, ...ed.editors.map((e) => ({ value: e.id, label: e.name }))]
  return (
    <div>
      <Paragraph type="secondary">
        GlimmR does not edit photos. Press <span className="kbd">Ctrl/⌘ E</span> or use “Edit” to hand photos to your editor. Lightroom Classic and Capture One open their import
        window for files outside their catalog.
      </Paragraph>
      <Table
        size="small"
        pagination={false}
        rowKey="id"
        dataSource={ed.editors}
        locale={{ emptyText: 'No editors found. Add one with “Add editor…”.' }}
        columns={[
          { title: 'Editor', dataIndex: 'name', render: (n, e) => <Space>{n}{e.detected ? <Tag color="green">Detected</Tag> : <Tag>Custom</Tag>}</Space> },
          { title: 'Location', dataIndex: 'path', render: (p) => <Text type="secondary" className="selectable" style={{ fontSize: 12, wordBreak: 'break-all' }}>{p}</Text> },
          {
            title: '',
            width: 50,
            render: (_, e) =>
              !e.detected && (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => save({ editors: ed.editors.filter((x) => x.id !== e.id), defaultEditor: ed.defaultEditor === e.id ? null : ed.defaultEditor })}
                />
              )
          }
        ]}
      />
      <Flex gap={8} style={{ margin: '12px 0 20px' }}>
        <Button icon={<SearchOutlined />} onClick={async () => (await api.detectEditors(), s.setSettings({}))}>
          Detect editors again
        </Button>
        <Button icon={<PlusOutlined />} onClick={async () => (await api.addCustomEditor(), s.setSettings({}))}>
          Add editor…
        </Button>
      </Flex>
      <Title level={5}>Default editor</Title>
      <Select style={{ width: 280 }} value={ed.defaultEditor ?? ''} options={options} onChange={(v) => save({ defaultEditor: v || null })} />
      <Title level={5} style={{ marginTop: 20 }}>
        By file type
      </Title>
      <Space direction="vertical">
        {TYPES.map((t) => (
          <Flex key={t.key} align="center" gap={12}>
            <Text style={{ width: 90 }}>{t.label}</Text>
            <Select
              style={{ width: 280 }}
              value={ed.perType[t.key] ?? ''}
              options={[{ value: '', label: 'Use default editor' }, ...options.slice(1)]}
              onChange={(v) => {
                const perType = { ...ed.perType }
                if (v) perType[t.key] = v
                else delete perType[t.key]
                void save({ perType })
              }}
            />
          </Flex>
        ))}
      </Space>
    </div>
  )
}

function RestoreWizard({ entry, onClose }: { entry: BackupEntry; onClose: () => void }) {
  const { message } = App.useApp()
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

  return (
    <Modal open title="Restore library" onCancel={onClose} footer={null} width={720} destroyOnHidden>
      <Steps current={step} size="small" items={[{ title: 'Check backup' }, { title: 'Photo locations' }, { title: 'Restore' }]} style={{ margin: '8px 0 24px' }} />
      {step === 0 && (
        <div>
          <Paragraph>
            Backup from <b>{fmtDate(entry.manifest.createdAt)}</b> · {fmtNum(entry.manifest.photoCount)} photos · GlimmR {entry.manifest.appVersion}
            {entry.manifest.originals.included && ` · originals mirrored (${fmtNum(entry.manifest.originals.fileCount)} files, ${fmtBytes(entry.manifest.originals.bytes)})`}
          </Paragraph>
          {!check ? (
            <Alert type="info" message="Verifying checksums and catalog integrity…" />
          ) : check.ok ? (
            <Alert type="success" showIcon message="Backup verified: checksums match and the catalog passed its integrity check." />
          ) : (
            <Alert type="error" showIcon message="This backup failed verification" description={check.problems.join('; ')} />
          )}
          <Flex justify="end" style={{ marginTop: 20 }}>
            <Button type="primary" disabled={!check?.ok} onClick={() => setStep(1)}>
              Next
            </Button>
          </Flex>
        </div>
      )}
      {step === 1 && (
        <div>
          <Paragraph type="secondary">Choose where each library folder's photos are now. Use the backup's copy of the originals if the originals were lost.</Paragraph>
          {roots.map((r) => (
            <div key={r.id} style={{ marginBottom: 16 }}>
              <Text strong>{r.name}</Text>
              <Radio.Group
                style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}
                value={map[r.id] === r.path ? 'keep' : map[r.id] === r.mirror ? 'mirror' : 'custom'}
                onChange={async (e) => {
                  if (e.target.value === 'keep') setMap({ ...map, [r.id]: r.path })
                  else if (e.target.value === 'mirror' && r.mirror) setMap({ ...map, [r.id]: r.mirror })
                  else {
                    const dir = await api.chooseFolder(`New location of “${r.name}”`)
                    if (dir) setMap({ ...map, [r.id]: dir })
                  }
                }}
              >
                <Radio value="keep">
                  Original location <Text type="secondary">{r.path}</Text> {!r.exists && <Tag color="red">not found</Tag>}
                </Radio>
                <Radio value="mirror" disabled={!r.mirror}>
                  Copy inside the backup {r.mirror ? <Text type="secondary">{r.mirror}</Text> : <Text type="secondary">(originals were not included)</Text>}
                </Radio>
                <Radio value="custom">
                  Another folder… {map[r.id] !== r.path && map[r.id] !== r.mirror && <Text type="secondary">{map[r.id]}</Text>}
                </Radio>
              </Radio.Group>
            </div>
          ))}
          <Flex justify="space-between" style={{ marginTop: 20 }}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button type="primary" onClick={() => setStep(2)}>
              Next
            </Button>
          </Flex>
        </div>
      )}
      {step === 2 && (
        <div>
          <Alert
            type="warning"
            showIcon
            message="The current catalog will be replaced"
            description="A safety copy of your current catalog is saved first. Your photo files are not changed. Previews are rebuilt after the restore."
          />
          <Flex justify="space-between" style={{ marginTop: 20 }}>
            <Button onClick={() => setStep(1)}>Back</Button>
            <Button
              type="primary"
              danger
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.restore({ backupPath: entry.path, rootMap: map })
                  message.success('Library restored')
                  onClose()
                } finally {
                  setBusy(false)
                }
              }}
            >
              Restore now
            </Button>
          </Flex>
        </div>
      )}
    </Modal>
  )
}

function BackupTab() {
  const s = useStore()
  const { message } = App.useApp()
  const b = s.settings!.backup
  const [list, setList] = useState<BackupEntry[]>([])
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const refresh = useCallback(() => void api.listBackups().then(setList), [])
  useEffect(refresh, [refresh, b.destination, b.lastBackupAt, s.jobs])
  const save = (patch: Partial<typeof b>): Promise<void> => s.setSettings({ backup: { ...b, ...patch } })

  return (
    <div>
      <Paragraph type="secondary">
        A backup saves the catalog (ratings, labels, keywords, albums, smart albums, settings) with checksums. Turn on “Include originals” to also keep a verified copy of every photo,
        updated incrementally. Put backups on a different drive from your photos.
      </Paragraph>
      <Flex vertical gap={14}>
        <Flex align="center" gap={12} wrap>
          <Text style={{ width: 150 }}>Backup folder</Text>
          <Text code className="selectable">
            {b.destination ?? 'Not set'}
          </Text>
          <Button size="small" onClick={async () => (await api.chooseBackupFolder()) && s.setSettings({})}>
            Choose…
          </Button>
        </Flex>
        <Flex align="center" gap={12}>
          <Text style={{ width: 150 }}>Automatic backup</Text>
          <Segmented
            value={b.schedule}
            onChange={(v) => save({ schedule: v as typeof b.schedule })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'onQuit', label: 'When quitting' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' }
            ]}
          />
        </Flex>
        <Flex align="center" gap={12}>
          <Text style={{ width: 150 }}>Keep</Text>
          <InputNumber min={1} max={200} value={b.keep} onChange={(v) => v && save({ keep: v })} addonAfter="latest backups" />
        </Flex>
        <Flex align="center" gap={12}>
          <Text style={{ width: 150 }}>Include originals</Text>
          <Switch checked={b.includeOriginals} onChange={(v) => save({ includeOriginals: v })} />
          <Text type="secondary">Mirrors photos into “GlimmR Originals” in the backup folder; only new or changed files are copied.</Text>
        </Flex>
        <Flex gap={8}>
          <Button type="primary" icon={<CloudUploadOutlined />} disabled={!b.destination} onClick={() => api.backupNow()}>
            Back up now
          </Button>
          <Button
            onClick={async () => {
              const e = await api.chooseBackupToRestore()
              if (e) setRestoring(e)
            }}
          >
            Restore from a backup folder…
          </Button>
        </Flex>
        <Text type="secondary">Last backup: {b.lastBackupAt ? fmtDate(b.lastBackupAt) : 'never'}</Text>
      </Flex>
      <Title level={5} style={{ marginTop: 24 }}>
        Backups in this folder
      </Title>
      <Table
        size="small"
        rowKey="path"
        pagination={{ pageSize: 6, hideOnSinglePage: true }}
        dataSource={list}
        locale={{ emptyText: 'No backups yet' }}
        columns={[
          { title: 'Date', render: (_, e) => fmtDate(e.manifest.createdAt) },
          { title: 'Photos', render: (_, e) => fmtNum(e.manifest.photoCount) },
          { title: 'Originals', render: (_, e) => (e.manifest.originals.included ? <Tag color="green">Included</Tag> : <Tag>Catalog only</Tag>) },
          {
            title: '',
            render: (_, e) => (
              <Space>
                <Button
                  size="small"
                  icon={<SafetyCertificateOutlined />}
                  loading={verifying === e.path}
                  onClick={async () => {
                    setVerifying(e.path)
                    const r = await api.verifyBackup(e.path)
                    setVerifying(null)
                    if (r.ok) message.success('Backup verified')
                    else message.error(`Problems: ${r.problems.join('; ')}`)
                  }}
                >
                  Verify
                </Button>
                <Button size="small" onClick={() => setRestoring(e)}>
                  Restore…
                </Button>
              </Space>
            )
          }
        ]}
      />
      {restoring && <RestoreWizard entry={restoring} onClose={() => setRestoring(null)} />}
    </div>
  )
}

function AppearanceTab() {
  const s = useStore()
  const st = s.settings!
  return (
    <Flex vertical gap={16}>
      <Flex align="center" gap={12}>
        <Text style={{ width: 150 }}>Theme</Text>
        <Segmented
          value={st.theme}
          onChange={(v) => s.setSettings({ theme: v as typeof st.theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' }
          ]}
        />
      </Flex>
      <Flex align="center" gap={12}>
        <Text style={{ width: 150 }}>Auto-advance</Text>
        <Switch checked={st.autoAdvance} onChange={(v) => s.setSettings({ autoAdvance: v })} />
        <Text type="secondary">Move to the next photo after rating, flagging or labelling one.</Text>
      </Flex>
    </Flex>
  )
}

const HELP: [string, string][] = [
  ['sunset beach', 'Words match anything: file and folder names, keywords, title, caption, camera, lens, albums and every text metadata value. Prefixes work: “lisb” finds Lisbon.'],
  ['"golden hour"', 'Exact phrase'],
  ['camera:"X-T5"   lens:85', 'A field containing a value'],
  ['camera:="Canon EOS R5"', 'A field with exactly this value (what the filters use)'],
  ['iso:>1600   f:<=2.8   rating:>=4', 'Number comparisons: > >= < <= ='],
  ['focal:24..70   iso:100..400', 'Number ranges'],
  ['shutter:<1/500   size:>20mb   mp:>40', 'Shutter in seconds or fractions, size with kb/mb/gb, megapixels'],
  ['date:2019   date:2019-07   date:2019-07-14', 'Year, month or day taken'],
  ['date:2018..2020   date:>=2021-06', 'Date ranges and comparisons'],
  ['year:2015   month:july', 'Year or month on their own (month:7 also works)'],
  ['flag:pick   label:red   rating:0', 'Culling state'],
  ['keyword:Portugal   album:"Trip"   folder:2021', 'Organization'],
  ['type:raw   type:jpeg   orientation:portrait', 'File type and shape'],
  ['has:gps   has:keywords   is:offline', 'Presence and state'],
  ['ExposureProgram:Manual   LensSerialNumber:123', 'Any EXIF, IPTC or XMP field by name. Click a value in the photo info panel to search for it.'],
  ['-raw   -keyword:test   -flag:reject', 'A minus sign excludes'],
  ['Sort by any field', 'Pick a sort in the toolbar, or type a metadata name such as ShutterCount in the sort menu']
]

function HelpTab() {
  return (
    <div>
      <Table
        size="small"
        pagination={false}
        rowKey={(r) => r[0]}
        dataSource={HELP}
        columns={[
          { title: 'Type', render: (_, r) => <Text code className="selectable">{r[0]}</Text>, width: 330 },
          { title: 'Finds', render: (_, r) => r[1] }
        ]}
      />
      <Title level={5} style={{ marginTop: 20 }}>
        Keyboard
      </Title>
      <Paragraph>
        <span className="kbd">/</span> or <span className="kbd">Ctrl/⌘ K</span> search · <span className="kbd">←↑→↓</span> move · <span className="kbd">Enter</span> view ·{' '}
        <span className="kbd">0–5</span> stars · <span className="kbd">P</span> pick · <span className="kbd">X</span> reject · <span className="kbd">U</span> unflag ·{' '}
        <span className="kbd">6–9</span> red/yellow/green/blue label · <span className="kbd">Ctrl/⌘ E</span> open in editor · <span className="kbd">S</span> slideshow ·{' '}
        <span className="kbd">I</span> info · <span className="kbd">Z</span>/<span className="kbd">Space</span> zoom · <span className="kbd">Ctrl/⌘ A</span> select all ·{' '}
        <span className="kbd">Esc</span> back
      </Paragraph>
    </div>
  )
}

export function SettingsModal() {
  const s = useStore()
  if (!s.settings) return null
  return (
    <Modal open={!!s.settingsOpen} onCancel={() => s.setSettingsOpen(null)} footer={null} width={900} title="Settings" destroyOnHidden styles={{ body: { minHeight: 480 } }}>
      <Tabs
        activeKey={s.settingsOpen ?? 'library'}
        onChange={(k) => s.setSettingsOpen(k)}
        items={[
          { key: 'library', label: 'Library', children: <LibraryTab /> },
          { key: 'editors', label: 'Editors', children: <EditorsTab /> },
          { key: 'backup', label: (<span><CheckCircleOutlined /> Backup & restore</span>), children: <BackupTab /> },
          { key: 'appearance', label: 'Appearance', children: <AppearanceTab /> },
          { key: 'help', label: 'Search help', children: <HelpTab /> }
        ]}
      />
    </Modal>
  )
}
