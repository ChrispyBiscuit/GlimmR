import { useEffect, useRef, useState } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { CircleHelp, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { tokenize } from '../../../shared/tokenize'
import type { Suggestion } from '../../../shared/types'

const mac = navigator.userAgent.includes('Mac')

/** Replaces the token being typed with the chosen suggestion. */
function applySuggestion(input: string, value: string): string {
  const tokens = tokenize(input)
  if (!input.endsWith(' ')) tokens.pop()
  tokens.push(value)
  return tokens.join(' ') + (value.endsWith(':') || value.endsWith(':=') ? '' : ' ')
}

export function SearchBar() {
  const s = useStore()
  const [text, setText] = useState(s.query)
  const [options, setOptions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState('')
  const navigated = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Follow query changes made elsewhere (filters, chips, metadata links).
  useEffect(() => {
    setText(s.query ? `${s.query} ` : '')
  }, [s.query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commit = (q: string): void => {
    clearTimeout(commitTimer.current)
    if (q.trim() !== s.query.trim() || s.view !== 'browse') s.search(q.trim())
  }

  const change = (v: string): void => {
    setText(v)
    navigated.current = false
    setOpen(true)
    clearTimeout(commitTimer.current)
    // Wait while a field is half-typed ("lens:"), so partial searches don't run.
    if (!/:=?$/.test(v.trim())) commitTimer.current = setTimeout(() => commit(v), 450)
    void api.suggest(v).then(setOptions)
  }

  const choose = (value: string): void => {
    const next = applySuggestion(text, value)
    setText(next)
    navigated.current = false
    void api.suggest(next).then(setOptions)
    if (!next.endsWith(':') && !next.endsWith(':=')) commit(next)
    input.current?.focus()
  }

  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      value={highlight}
      onValueChange={setHighlight}
      className="relative max-w-2xl flex-1"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigated.current = true
        if (e.key === 'Enter' && (!navigated.current || !open || !options.length)) {
          e.preventDefault()
          commit(text)
          setOpen(false)
        }
        if (e.key === 'Escape') {
          setOpen(false)
          input.current?.blur()
        }
      }}
    >
      <div className="flex h-9 items-center gap-2 rounded-md border border-transparent bg-canvas px-3 focus-within:border-ink-muted">
        <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
        <CommandPrimitive.Input
          ref={input}
          value={text}
          onValueChange={change}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          aria-label="Search photos"
          placeholder="Search photos, places, cameras, keywords…"
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ink-muted"
        />
        {text ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText('')
              commit('')
            }}
          >
            <X />
          </Button>
        ) : (
          <Kbd className="hidden sm:inline-flex">{mac ? '⌘' : 'Ctrl'}&nbsp;K</Kbd>
        )}
        <Button variant="ghost" size="icon-xs" aria-label="Search help" onMouseDown={(e) => e.preventDefault()} onClick={() => s.openSettings('help')}>
          <CircleHelp />
        </Button>
      </div>
      <CommandPrimitive.List
        className={cn(
          'absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg',
          !(open && options.length) && 'hidden'
        )}
      >
        {options.map((o) => (
          <CommandPrimitive.Item
            key={o.value}
            value={o.value}
            onSelect={choose}
            onMouseDown={(e) => e.preventDefault()}
            className="flex cursor-default items-center gap-3 rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-accent"
          >
            {o.kind === 'field' ? (
              <>
                <code className="font-sans font-medium">{o.value}</code>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{o.label}</span>
              </>
            ) : (
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
            )}
            {o.count != null && <span className="tnum text-xs text-ink-muted">{o.count.toLocaleString()}</span>}
          </CommandPrimitive.Item>
        ))}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}
