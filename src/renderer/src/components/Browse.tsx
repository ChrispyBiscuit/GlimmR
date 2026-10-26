import { useEffect, useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Bookmark, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useStore } from '../store'
import { api } from '../api'
import { promptDialog } from '../dialogs'
import { fmtNum } from '../format'
import { FilterBar } from './FilterBar'
import { PhotoGrid } from './PhotoGrid'
import { SelectionBar } from './SelectionBar'

export function Browse() {
  const s = useStore()
  const [sortFields, setSortFields] = useState<{ value: string; label: string }[]>([])
  const [customSort, setCustomSort] = useState('')
  useEffect(() => void api.sortFields().then(setSortFields), [])

  const options = [
    ...(s.scope.type === 'album' ? [{ value: 'albumOrder', label: 'Album order' }] : []),
    { value: 'default', label: s.scope.type === 'smart' ? 'Smart album order' : 'Date taken' },
    ...sortFields.filter((f) => f.value !== 'taken')
  ]
  const sortLabel = options.find((o) => o.value === s.sort.field)?.label ?? s.sort.field

  const saveSearch = async (): Promise<void> => {
    const name = await promptDialog({
      title: 'Save search as a smart album',
      description: 'The album keeps itself up to date as photos match.',
      confirmLabel: 'Save Smart Album',
      initial: s.query
    })
    if (!name) return
    const id = await api.saveSmartAlbum({ name, query: s.query, sort: s.sort.field === 'default' ? { field: 'taken', dir: 'desc' } : s.sort })
    await s.refreshSidebar()
    s.navigate({ type: 'smart', id }, name)
    toast.success('Smart album saved', { description: name })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b bg-panel px-5 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 truncate text-lg font-semibold">{s.title}</h1>
          <span className="tnum text-[13px] text-ink-muted" aria-live="polite">
            {fmtNum(s.total)} {s.total === 1 ? 'photo' : 'photos'}
          </span>
          <div className="flex-1" />
          {s.query && (
            <Button variant="ghost" size="sm" onClick={saveSearch}>
              <Bookmark data-icon="inline-start" />
              Save Search
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="font-normal">
                <span className="text-ink-muted">Sort</span> {sortLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              {options.map((o) => (
                <DropdownMenuItem key={o.value} onSelect={() => s.setSort({ ...s.sort, field: o.value })}>
                  <span className="flex-1">{o.label}</span>
                  {s.sort.field === o.value && <Check />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <form
                className="p-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (customSort.trim()) s.setSort({ ...s.sort, field: customSort.trim() })
                }}
              >
                <Input
                  aria-label="Sort by a metadata field"
                  placeholder="Any metadata field, e.g. ShutterCount…"
                  value={customSort}
                  onChange={(e) => setCustomSort(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  spellCheck={false}
                  autoComplete="off"
                  className="h-7 text-xs"
                />
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={s.sort.dir === 'desc' ? 'Sorted newest or largest first; switch to ascending' : 'Sorted oldest or smallest first; switch to descending'}
                onClick={() => s.setSort({ ...s.sort, dir: s.sort.dir === 'desc' ? 'asc' : 'desc' })}
              >
                {s.sort.dir === 'desc' ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{s.sort.dir === 'desc' ? 'Descending' : 'Ascending'}</TooltipContent>
          </Tooltip>
          <div className="flex w-28 items-center">
            <Slider aria-label="Photo size" min={120} max={420} step={20} value={[s.settings?.thumbSize ?? 220]} onValueChange={([v]) => s.setSettings({ thumbSize: v })} />
          </div>
        </div>
        <FilterBar />
        {s.searchError && <p className="text-xs text-reject">{s.searchError}</p>}
      </div>
      <div className="relative min-h-0 flex-1">
        <PhotoGrid />
        <SelectionBar />
      </div>
    </div>
  )
}
