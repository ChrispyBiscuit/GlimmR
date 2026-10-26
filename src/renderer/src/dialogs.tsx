import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface Request {
  kind: 'confirm' | 'prompt'
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  initial?: string
  placeholder?: string
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
            {req.kind === 'prompt' && (
              <Input ref={input} aria-label={req.title} value={value} placeholder={req.placeholder} autoComplete="off" onChange={(e) => setValue(e.target.value)} />
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={req.destructive ? 'destructive' : 'default'} disabled={req.kind === 'prompt' && !value.trim()}>
                {req.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}
