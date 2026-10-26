import { BookImage, FileDown, Flag, Pencil, Star, Tags, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useStore } from '../store'
import { api } from '../api'
import { promptDialog } from '../dialogs'
import { LABEL_COLORS } from '../format'
import { KeywordEditor } from './KeywordEditor'
import { COLOR_LABELS } from '../../../shared/types'

const mac = navigator.userAgent.includes('Mac')

export function StarRating({ value, onChange, size = 'md' }: { value: number; onChange: (v: number) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex items-center" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          title={`${n} star${n > 1 ? 's' : ''} (${n})`}
          onClick={() => onChange(value === n ? 0 : n)}
          className={cn('flex items-center justify-center rounded-sm text-ink-muted/50 hover:text-marker', size === 'sm' ? 'size-6' : 'size-7')}
        >
          <Star className={cn(size === 'sm' ? 'size-3.5' : 'size-4', n <= value && 'fill-marker text-marker')} />
        </button>
      ))}
    </div>
  )
}

export function SelectionBar() {
  const s = useStore()
  if (s.selected.size === 0) return null
  const ids = s.targets
  const photos = ids.map((id) => s.cache.get(id)).filter((p) => !!p)
  const rating = photos.length && photos.every((p) => p.rating === photos[0].rating) ? photos[0].rating : 0
  const allPicked = photos.length > 0 && photos.every((p) => p.flag === 'pick')
  const allRejected = photos.length > 0 && photos.every((p) => p.flag === 'reject')

  return (
    <div
      role="toolbar"
      aria-label="Selected photos"
      className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border bg-raised px-2 py-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
    >
      <span className="tnum px-2 text-[13px] font-medium whitespace-nowrap">{ids.length.toLocaleString()} selected</span>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <StarRating value={rating} onChange={(v) => void s.updatePhotos(ids, { rating: v })} size="sm" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Pick" aria-pressed={allPicked} onClick={() => void s.updatePhotos(ids, { flag: allPicked ? null : 'pick' })}>
            <Flag className={cn(allPicked && 'fill-pick text-pick')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pick (P)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Reject" aria-pressed={allRejected} onClick={() => void s.updatePhotos(ids, { flag: allRejected ? null : 'reject' })}>
            <X className={cn(allRejected && 'text-reject')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reject (X)</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Color label">
                <span className="size-3.5 rounded-full bg-[conic-gradient(#e5534b,#e6b422,#46a758,#3e8ed0,#8e6bd8,#e5534b)]" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Color label</TooltipContent>
        </Tooltip>
        <DropdownMenuContent>
          {COLOR_LABELS.map((l, i) => (
            <DropdownMenuItem key={l} onSelect={() => void s.updatePhotos(ids, { label: l })}>
              <span className="size-2.5 rounded-full" style={{ background: LABEL_COLORS[l] }} aria-hidden />
              {l[0].toUpperCase() + l.slice(1)}
              {i < 4 && <DropdownMenuShortcut>{i + 6}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void s.updatePhotos(ids, { label: null })}>No Label</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            <Tags data-icon="inline-start" />
            Keywords
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80" side="top">
          <p className="mb-2 text-xs text-ink-muted">Added to {ids.length === 1 ? 'this photo' : `all ${ids.length} photos`}.</p>
          <KeywordEditor ids={ids} current={[]} autoFocus />
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <BookImage data-icon="inline-start" />
            Add to Album
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top">
          {s.albums.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onSelect={async () => {
                await api.addToAlbum(a.id, ids)
                void s.refreshSidebar()
              }}
            >
              {a.name}
            </DropdownMenuItem>
          ))}
          {s.albums.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            onSelect={async () => {
              const name = await promptDialog({ title: 'New album', confirmLabel: 'Create Album', placeholder: 'Summer in Lisbon' })
              if (!name) return
              const id = await api.createAlbum(name, ids)
              await s.refreshSidebar()
              s.navigate({ type: 'album', id }, name)
            }}
          >
            New Album…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" onClick={() => void api.writeXmp(ids)}>
            <FileDown data-icon="inline-start" />
            Save to XMP
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-60">Writes stars, labels, keywords and captions to sidecar files that Lightroom and Capture One read.</TooltipContent>
      </Tooltip>
      <Button size="sm" onClick={() => void s.openEditor(ids)}>
        <Pencil data-icon="inline-start" />
        Edit
        <span className="text-xs opacity-60">{mac ? '⌘E' : 'Ctrl+E'}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={() => s.setSelected(new Set())}>
            <X />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Clear selection (Esc)</TooltipContent>
      </Tooltip>
    </div>
  )
}
