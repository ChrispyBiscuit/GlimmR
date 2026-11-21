import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export interface Choice {
  value: string
  label: string
  variant?: 'default' | 'outline' | 'destructive'
}

export interface FolderOption {
  key: string
  label: string
  depth: number
}

interface Request {
  kind: 'confirm' | 'prompt' | 'choice' | 'folder'
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  initial?: string
  placeholder?: string
  choices?: Choice[]
  folders?: FolderOption[]
  resolve: (v: string | boolean | null) => void
}

let push: ((r: Request) => void) | null = null

/** Asks a yes/no question in a modal. Resolves true when confirmed. */
export function confirmDialog(o: { title: string; description?: string; confirmLabel: string; destructive?: boolean }): Promise<boolean> {
  return new Promise((resolve) => push?.({ kind: 'confirm', ...o, resolve: (v) => resolve(v === true) }))
}

/** Asks for one line of text. Resolves null when cancelled or empty. */
export function promptDialog(o: { title: string; description?: string; confirmLabel: string; initial?: string; placeholder?: string }): Promise<string | null> {
  return new Promise((resolve) => push?.({ kind: 'prompt', ...o, resolve: (v) => resolve(typeof v === 'string' && v.trim() ? v.trim() : null) }))
}

/** Asks the user to pick one of several actions. Resolves the chosen value, or null when cancelled. */
export function choiceDialog(o: { title: string; description?: string; choices: Choice[] }): Promise<string | null> {
  return new Promise((resolve) => push?.({ kind: 'choice', confirmLabel: '', ...o, resolve: (v) => resolve(typeof v === 'string' ? v : null) }))
}

/** Asks for a folder from a searchable list. Resolves its key, or null when cancelled. */
export function folderDialog(o: { title: string; description?: string; folders: FolderOption[] }): Promise<string | null> {
  return new Promise((resolve) => push?.({ kind: 'folder', confirmLabel: '', ...o, resolve: (v) => resolve(typeof v === 'string' ? v : null) }))
}

export function DialogHost() {
  const [req, setReq] = useState<Request | null>(null)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    push = (r) => {
      setValue(r.initial ?? '')
      setReq(r)
    }
    return () => {
      push = null
    }
  }, [])

  const close = (result: string | boolean | null): void => {
    req?.resolve(result)
    setReq(null)
  }

  return (
    <Dialog open={!!req} onOpenChange={(open) => !open && close(null)}>
      {req && (
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => req.kind === 'prompt' && (e.preventDefault(), input.current?.select())}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              close(req.kind === 'prompt' ? value : true)
            }}
          >
            <DialogHeader>
              <DialogTitle>{req.title}</DialogTitle>
              {req.description ? <DialogDescription>{req.description}</DialogDescription> : <DialogDescription className="sr-only">{req.title}</DialogDescription>}
            </DialogHeader>
            {req.kind === 'folder' && (
              <Command className="rounded-md border">
                <CommandInput placeholder="Find a folder…" />
                <CommandList className="max-h-72">
                  <CommandEmpty>No folders match.</CommandEmpty>
                  {req.folders!.map((f) => (
                    <CommandItem key={f.key} value={`${f.label} ${f.key}`} onSelect={() => close(f.key)} style={{ paddingLeft: 8 + f.depth * 14 }}>
                      {f.label}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            )}
            {req.kind === 'prompt' && (
              <Input ref={input} aria-label={req.title} value={value} placeholder={req.placeholder} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(null)}>
                Cancel
              </Button>
              {req.kind === 'choice' &&
                req.choices!.map((c, i) => (
                  <Button key={c.value} type="button" variant={c.variant ?? (i === req.choices!.length - 1 ? 'default' : 'outline')} onClick={() => close(c.value)}>
                    {c.label}
                  </Button>
                ))}
              <Button
                type="submit"
                hidden={req.kind === 'choice' || req.kind === 'folder'} variant={req.destructive ? 'destructive' : 'default'} disabled={req.kind === 'prompt' && !value.trim()}>
                {req.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}
