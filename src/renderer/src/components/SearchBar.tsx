import { useEffect, useRef, useState } from 'react'
import { AutoComplete, Input, Tooltip } from 'antd'
import type { InputRef } from 'antd'
import { SearchOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { useStore } from '../store'
import { api } from '../api'
import { tokenize } from '../../../shared/tokenize'
import type { Suggestion } from '../../../shared/types'

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
  const inputRef = useRef<InputRef>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Follow external query changes (facets, chips, clicking metadata).
  useEffect(() => setText(s.query), [s.query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commit = (q: string): void => {
    clearTimeout(commitTimer.current)
    if (q.trim() !== s.query.trim() || s.view !== 'browse') s.search(q.trim())
  }

  const onChange = (v: string): void => {
    setText(v)
    clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => commit(v), 400)
    void api.suggest(v).then(setOptions)
  }

  return (
    <div className="search-wrap">
      <AutoComplete
        style={{ width: '100%' }}
        value={text}
        options={options.map((o) => ({
          value: o.value,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>
                <b>{o.kind === 'field' ? o.value : o.label}</b>
                {o.kind === 'field' && <span style={{ opacity: 0.6, marginLeft: 8 }}>{o.label}</span>}
              </span>
              {o.count != null && <span style={{ opacity: 0.5 }}>{o.count.toLocaleString()}</span>}
            </div>
          )
        }))}
        onSelect={(v: string) => {
          const next = applySuggestion(text, v)
          setText(next)
          void api.suggest(next).then(setOptions)
          if (!next.endsWith(':') && !next.endsWith(':=')) commit(next)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        onChange={onChange}
        popupMatchSelectWidth
        defaultActiveFirstOption={false}
      >
        <Input
          ref={inputRef}
          id="glimmr-search"
          allowClear
          prefix={<SearchOutlined style={{ opacity: 0.6, marginRight: 4 }} />}
          suffix={
            <Tooltip title="Search help" placement="bottomRight">
              <QuestionCircleOutlined style={{ opacity: 0.5, cursor: 'pointer' }} onClick={() => s.setSettingsOpen('help')} />
            </Tooltip>
          }
          placeholder='Search your photos…  try  beach  ·  camera:"X-T5"  ·  iso:>1600  ·  date:2019  ·  rating:>=4'
          onPressEnter={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
        />
      </AutoComplete>
    </div>
  )
}
