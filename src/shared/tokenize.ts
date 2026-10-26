/** Splits a search string on whitespace, keeping "quoted phrases" (and field:"quoted values") together. */
export function tokenize(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote
      cur += ch
    } else if (/\s/.test(ch) && !inQuote) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
