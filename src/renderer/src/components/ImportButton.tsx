import { HardDriveDownload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useStore } from '../store'

/** Import from a camera card (listed when one is inserted) or any folder. */
export function ImportButton() {
  const s = useStore()
  if (!s.cards.length)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Import photos" onClick={() => void s.openImport()}>
            <HardDriveDownload />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Import photos from a card or folder</TooltipContent>
      </Tooltip>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Import photos">
          <HardDriveDownload />
          Import
          <span className="size-1.5 rounded-full bg-pick" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Camera cards</DropdownMenuLabel>
        {s.cards.map((c) => (
          <DropdownMenuItem key={c.path} onSelect={() => void s.openImport(c.path)}>
            <HardDriveDownload />
            {c.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void s.openImport()}>From a Folder…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
