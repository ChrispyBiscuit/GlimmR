import type { ColorLabel, PhotoUpdate } from '../../shared/types'

const LABEL_KEYS: Record<string, ColorLabel> = { '6': 'red', '7': 'yellow', '8': 'green', '9': 'blue' }

/**
 * Lightroom-style culling keys: 0–5 stars, P pick, X reject, U unflag, 6–9 color labels.
 * Returns the update for a key press, or null when the key is not a culling key.
 */
export function cullingUpdate(e: KeyboardEvent, currentLabel: ColorLabel | undefined): PhotoUpdate | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  const k = e.key.toLowerCase()
  if (/^[0-5]$/.test(k)) return { rating: Number(k) }
  if (k === 'p') return { flag: 'pick' }
  if (k === 'x') return { flag: 'reject' }
  if (k === 'u') return { flag: null }
  if (LABEL_KEYS[k]) return { label: currentLabel === LABEL_KEYS[k] ? null : LABEL_KEYS[k] }
  return null
}

export const isTyping = (e: KeyboardEvent): boolean => !!(e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable], .ant-select')
