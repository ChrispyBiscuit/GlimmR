import { useId, useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useStore } from '../store'
import type { KeywordNode } from '../../../shared/types'

const flatten = (nodes: KeywordNode[]): string[] => nodes.flatMap((n) => [n.path, ...flatten(n.children)])

/** Keyword chips with an input that suggests existing keywords. Changes apply immediately. */
export function KeywordEditor({ ids, current, autoFocus }: { ids: number[]; current: string[]; autoFocus?: boolean }) {
  const s = useStore()
  const [value, setValue] = useState('')
  const [list, setList] = useState(current)
  const listId = useId()

  const add = async (raw: string): Promise<void> => {
    const kws = raw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
    if (!kws.length) return
    setValue('')
    setList((l) => [...new Set([...l, ...kws.map((k) => k.replace(/\s*[>|]\s*/g, '>'))])])
    await s.updatePhotos(ids, { addKeywords: kws })
  }
  const remove = async (k: string): Promise<void> => {
    setList((l) => l.filter((x) => x !== k))
    await s.updatePhotos(ids, { removeKeywords: [k] })
  }

  return (
    <div className="flex flex-col gap-2">
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Keywords">
          {list.map((k) => (
            <li key={k} className="inline-flex h-6 items-center gap-1 rounded-full border bg-raised pr-1 pl-2.5 text-xs">
              {k.replace(/>/g, ' › ')}
              <button type="button" aria-label={`Remove keyword ${k}`} className="rounded-full p-0.5 text-ink-muted hover:bg-accent hover:text-ink" onClick={() => void remove(k)}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void add(value)
        }}
      >
        <Input
          aria-label="Add keywords"
          list={listId}
          value={value}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder="Add keywords, like Places > Lisbon…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
          className="h-8 text-[13px]"
        />
        <datalist id={listId}>
          {flatten(s.keywords).map((k) => (
            <option key={k} value={k.replace(/>/g, ' > ')} />
          ))}
        </datalist>
      </form>
    </div>
  )
}
