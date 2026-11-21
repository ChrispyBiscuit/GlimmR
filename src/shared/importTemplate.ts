// Destination folders for imports, from a template such as `{YYYY}/{YYYY-MM-DD} {event}`. Shared by the import
// window's preview and the copier, so what's shown is what happens.

export interface TemplateValues {
  /** Capture time (epoch ms, local time is used), or null when unknown. */
  takenAt: number | null
  event: string
  camera: string
  card: string
}

export const DEFAULT_TEMPLATE = '{YYYY}/{YYYY-MM-DD} {event}'

export const TEMPLATE_TOKENS: { token: string; label: string }[] = [
  { token: '{YYYY}', label: 'Year' },
  { token: '{MM}', label: 'Month' },
  { token: '{DD}', label: 'Day' },
  { token: '{YYYY-MM-DD}', label: 'Date' },
  { token: '{event}', label: 'Event name' },
  { token: '{camera}', label: 'Camera model' },
  { token: '{card}', label: 'Card name' }
]

const pad = (n: number): string => String(n).padStart(2, '0')

/** A folder path (`/`-separated, relative to the library folder) for one photo. Empty segments are dropped. */
export function folderFor(template: string, v: TemplateValues): string {
  const d = v.takenAt != null ? new Date(v.takenAt) : null
  const map: Record<string, string> = {
    '{YYYY}': d ? String(d.getFullYear()) : 'Undated',
    '{MM}': d ? pad(d.getMonth() + 1) : '',
    '{DD}': d ? pad(d.getDate()) : '',
    '{YYYY-MM-DD}': d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : 'Undated',
    // Names can't add folder levels.
    '{event}': v.event.replace(/[\\/]/g, '-').trim(),
    '{camera}': v.camera.replace(/[\\/]/g, '-').trim(),
    '{card}': v.card.replace(/[\\/]/g, '-').trim()
  }
  let filled = template
  // Longest token first, so {YYYY-MM-DD} isn't read as {YYYY}.
  for (const token of Object.keys(map).sort((a, b) => b.length - a.length)) filled = filled.split(new RegExp(token.replace(/[{}-]/g, '\\$&'), 'i')).join(map[token])
  return filled
    .split(/[\\/]+/)
    .map((seg) =>
      seg
        .replace(/[:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[-\s.]+|[-\s.]+$/g, '')
    )
    .filter((seg) => seg && seg !== '.' && seg !== '..')
    .join('/')
}
