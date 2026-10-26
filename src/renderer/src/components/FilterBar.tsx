import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { LABEL_COLORS, quoteValue } from '../format'
import { tokenize } from '../../../shared/tokenize'
import type { FacetValue, Facets } from '../../../shared/types'

type ListKey = keyof Omit<Facets, 'ranges'>

interface ListDef {
  key: ListKey
  title: string
  token: (v: string) => string
  label?: (f: FacetValue) => ReactNode
  searchable?: boolean
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)

/** Many makers repeat the brand in the model ("Canon Canon EOS R5"); show it once. */
const cameraName = (v: string): string => v.replace(/^(\S+)\s+(?=\1\b)/i, '')

const LISTS: Record<string, ListDef> = {
  year: { key: 'year', title: 'Year', token: (v) => `date:${v}` },
  rating: { key: 'rating', title: 'Rating', token: (v) => `rating:${v}`, label: (f) => (f.value === '0' ? 'No rating' : <Stars n={Number(f.value)} />) },
  flag: { key: 'flag', title: 'Flag', token: (v) => `flag:${v}` },
  label: {
    key: 'label',
    title: 'Color label',
    token: (v) => `label:${v}`,
    label: (f) => (
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: LABEL_COLORS[f.value] }} aria-hidden />
        {cap(f.value)}
      </span>
    )
  },
  camera: { key: 'camera', title: 'Camera', token: (v) => `camera:=${quoteValue(v)}`, searchable: true, label: (f) => cameraName(f.value) },
  lens: { key: 'lens', title: 'Lens', token: (v) => `lens:=${quoteValue(v)}`, searchable: true },
  keyword: { key: 'keyword', title: 'Keyword', token: (v) => `keyword:=${quoteValue(v)}`, searchable: true, label: (f) => f.value.replace(/>/g, ' › ') },
  type: { key: 'type', title: 'File type', token: (v) => `type:${v}` },
  orientation: { key: 'orientation', title: 'Orientation', token: (v) => `orientation:${v}`, label: (f) => cap(f.value) }
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-marker" aria-label={`${n} stars`}>
      {'★'.repeat(n)}
      <span className="text-ink-muted/40">{'★'.repeat(5 - n)}</span>
    </span>
  )
}

/** Human-readable chip text for a query token. */
export function describeToken(t: string): string {
  const neg = t.startsWith('-')
  const body = neg ? t.slice(1) : t
  const m = /^([A-Za-z][\w.-]*):(=)?(.*)$/.exec(body)
  let text: string
  if (!m) text = `“${body.replace(/"/g, '')}”`
  else {
    const [, field, , raw] = m
    const v = raw.replace(/"/g, '')
    const range = v.includes('..') ? v.replace('..', '–') : v
    const names: Record<string, string> = { date: 'Taken', iso: 'ISO', f: 'Aperture ƒ', focal: 'Focal length', keyword: 'Keyword', tag: 'Keyword', camera: 'Camera', lens: 'Lens' }
    if (field === 'rating') text = v === '0' ? 'No rating' : /^\d$/.test(v) ? `${v} stars` : `Rating ${v}`
    else if (field === 'flag') text = v === 'none' ? 'Unflagged' : v === 'pick' ? 'Picked' : 'Rejected'
    else if (field === 'label') text = `${cap(v)} label`
    else if (field === 'type') text = v === 'raw' ? 'RAW files' : `${v.toUpperCase()} files`
    else if (field === 'orientation') text = cap(v)
    else if (field === 'has') text = `Has ${v}`
    else if (field === 'is') text = cap(v)
    else text = `${names[field] ?? field}: ${field === 'keyword' ? range.replace(/>/g, ' › ') : field === 'camera' ? cameraName(range) : range}`
  }
  return neg ? `Not ${text.replace(/^./, (c) => c.toLowerCase())}` : text
}

function FacetList({ def, values, tokens, toggle }: { def: ListDef; values: FacetValue[]; tokens: string[]; toggle: (t: string, exclude?: boolean) => void }) {
  return (
    <Command>
      {def.searchable && <CommandInput placeholder={`Filter ${def.title.toLowerCase()}s…`} />}
      <CommandList className="max-h-72">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup>
          {values.map((f) => {
            const token = def.token(f.value)
            const on = tokens.includes(token)
            const off = tokens.includes(`-${token}`)
            return (
              <CommandItem key={f.value} value={`${f.label} ${f.value}`} onSelect={() => toggle(token)} className="group gap-2">
                <span className={cn('flex size-4 items-center justify-center rounded-sm border', on && 'border-ink bg-ink text-raised', off && 'border-reject bg-reject text-white')}>
                  {on && <Check className="size-3" />}
                  {off && <Minus className="size-3" />}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', off && 'line-through opacity-70')}>{def.label ? def.label(f) : f.label}</span>
                <span className="tnum text-xs text-ink-muted">{f.count.toLocaleString()}</span>
                <button
                  type="button"
                  aria-label={`Exclude ${f.label}`}
                  title="Exclude"
                  className="invisible rounded-sm p-0.5 text-ink-muted group-hover:visible group-data-[selected=true]:visible hover:text-reject"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(token, true)
                  }}
                >
                  <Minus className="size-3.5" />
                </button>
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function FilterButton({ label, active, children, wide }: { label: string; active: number; children: ReactNode; wide?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('h-7 gap-1 px-2.5 text-[13px] font-normal text-ink-muted hover:text-ink', active > 0 && 'bg-accent text-ink')}>
          {label}
          {active > 0 && <span className="tnum text-xs">{active}</span>}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('p-0', wide ? 'w-80' : 'w-64')}>
        {children}
      </PopoverContent>
    </Popover>
  )
}

const RANGES = [
  { key: 'iso' as const, title: 'ISO', field: 'iso', step: 1, fmt: (v: number) => String(Math.round(v)) },
  { key: 'focal' as const, title: 'Focal length', field: 'focal', step: 1, fmt: (v: number) => `${Math.round(v)} mm` },
  { key: 'aperture' as const, title: 'Aperture', field: 'f', step: 0.1, fmt: (v: number) => `ƒ/${v.toFixed(1)}` }
]

function RangeControl({ r, bounds, tokens, set }: { r: (typeof RANGES)[number]; bounds: [number, number]; tokens: string[]; set: (a: number, b: number) => void }) {
  const current = tokens.find((t) => t.startsWith(`${r.field}:`) && t.includes('..'))
  const initial = current ? (current.slice(r.field.length + 1).split('..').map(Number) as [number, number]) : bounds
  const [value, setValue] = useState<number[]>(initial)
  useEffect(() => {
    setValue(initial)
  }, [current, bounds[0], bounds[1]])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between text-[13px]">
        <span>{r.title}</span>
        <span className="tnum text-xs text-ink-muted">
          {r.fmt(value[0])} – {r.fmt(value[1])}
        </span>
      </div>
      <Slider aria-label={r.title} min={bounds[0]} max={bounds[1]} step={r.step} value={value} onValueChange={setValue} onValueCommit={(v) => set(v[0], v[1])} />
    </div>
  )
}

export function FilterBar() {
  const s = useStore()
  const [facets, setFacets] = useState<Facets | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => void api.facets(s.scope, s.query).then((f) => live && setFacets(f)), 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [s.scope, s.query, s.libraryVersion, s.editVersion])

  const tokens = tokenize(s.query)
  const setTokens = (next: string[]): void => s.setQuery(next.join(' '))
  const toggle = (token: string, exclude = false): void => {
    const neg = `-${token}`
    let next = tokens.filter((t) => t !== token && t !== neg)
    if (exclude ? !tokens.includes(neg) : !tokens.includes(token)) next = [...next, exclude ? neg : token]
    setTokens(next)
  }
  const activeFor = (defs: ListDef[]): number => tokens.filter((t) => defs.some((d) => (facets?.[d.key] ?? []).some((f) => [d.token(f.value), `-${d.token(f.value)}`].includes(t)))).length
  const list = (k: string) => <FacetList def={LISTS[k]} values={facets?.[LISTS[k].key] ?? []} tokens={tokens} toggle={toggle} />
  const section = (title: string, body: ReactNode) => (
    <div className="border-b p-1 last:border-b-0">
      <div className="px-2 pt-1.5 pb-1 text-xs text-ink-muted">{title}</div>
      {body}
    </div>
  )
  const rangeTokens = tokens.filter((t) => RANGES.some((r) => t.startsWith(`${r.field}:`) && t.includes('..'))).length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Filters">
        <FilterButton label="Date" active={activeFor([LISTS.year])}>
          {list('year')}
        </FilterButton>
        <FilterButton label="Marks" active={activeFor([LISTS.rating, LISTS.flag, LISTS.label])}>
          {section('Rating', list('rating'))}
          {section('Flag', list('flag'))}
          {(facets?.label.length ?? 0) > 0 && section('Color label', list('label'))}
        </FilterButton>
        <FilterButton label="Camera" active={activeFor([LISTS.camera])} wide>
          {list('camera')}
        </FilterButton>
        <FilterButton label="Lens" active={activeFor([LISTS.lens])} wide>
          {list('lens')}
        </FilterButton>
        <FilterButton label="Keywords" active={activeFor([LISTS.keyword])} wide>
          {list('keyword')}
        </FilterButton>
        <FilterButton label="Exposure" active={rangeTokens} wide>
          <div className="flex flex-col gap-5 p-4">
            {RANGES.map((r) => {
              const b = facets?.ranges[r.key]
              if (!b || b[0] === b[1]) return null
              return (
                <RangeControl
                  key={r.key}
                  r={r}
                  bounds={b}
                  tokens={tokens}
                  set={(a, z) => {
                    const next = tokens.filter((t) => !t.startsWith(`${r.field}:`))
                    if (a > b[0] || z < b[1]) next.push(`${r.field}:${a}..${z}`)
                    setTokens(next)
                  }}
                />
              )
            })}
            {!RANGES.some((r) => facets?.ranges[r.key] && facets.ranges[r.key]![0] !== facets.ranges[r.key]![1]) && (
              <p className="text-xs text-ink-muted">These photos share the same exposure settings.</p>
            )}
          </div>
        </FilterButton>
        <FilterButton label="File" active={activeFor([LISTS.type, LISTS.orientation])}>
          {section('Type', list('type'))}
          {section('Orientation', list('orientation'))}
        </FilterButton>
      </div>
      {tokens.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {tokens.map((t, i) => (
            <li key={`${t}-${i}`}>
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border bg-raised pr-1 pl-2.5 text-xs',
                  t.startsWith('-') && 'border-reject/50 text-reject'
                )}
                title={t}
              >
                {describeToken(t)}
                <button
                  type="button"
                  aria-label={`Remove ${describeToken(t)}`}
                  className="rounded-full p-0.5 text-ink-muted hover:bg-accent hover:text-ink"
                  onClick={() => setTokens(tokens.filter((_, j) => j !== i))}
                >
                  <X className="size-3" />
                </button>
              </span>
            </li>
          ))}
          <li>
            <Button variant="link" size="xs" className="text-ink-muted" onClick={() => s.setQuery('')}>
              Clear All
            </Button>
          </li>
        </ul>
      )}
    </div>
  )
}
