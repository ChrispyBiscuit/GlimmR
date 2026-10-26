import { useCallback } from 'react'
import { App, Input } from 'antd'

/** Asks for a line of text in a themed modal. Resolves to null when cancelled or empty. */
export function usePrompt(): (title: string, initial?: string) => Promise<string | null> {
  const { modal } = App.useApp()
  return useCallback(
    (title, initial = '') =>
      new Promise((resolve) => {
        let value = initial
        let settled = false
        const done = (v: string | null): void => {
          if (!settled) resolve(v)
          settled = true
        }
        const m = modal.confirm({
          title,
          icon: null,
          content: (
            <Input
              autoFocus
              defaultValue={initial}
              onChange={(e) => (value = e.target.value)}
              onPressEnter={() => {
                done(value.trim() || null)
                m.destroy()
              }}
            />
          ),
          onOk: () => done(value.trim() || null),
          onCancel: () => done(null)
        })
      }),
    [modal]
  )
}
