// Writes rating, label, keywords, title and caption to XMP sidecars that Lightroom, Capture One,
// Bridge, darktable and digiKam read. Existing sidecars are merged: only these properties are replaced.

import fs from 'node:fs'
import path from 'node:path'
import { findSidecar } from './metadata'

export interface XmpFields {
  rating: number
  flag: 'pick' | 'reject' | null
  label: string | null
  keywords: string[]
  title: string | null
  caption: string | null
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const NAMESPACES: Record<string, string> = {
  xmp: 'http://ns.adobe.com/xap/1.0/',
  dc: 'http://purl.org/dc/elements/1.1/',
  lr: 'http://ns.adobe.com/lightroom/1.0/'
}

const OWNED = ['xmp:Rating', 'xmp:Label', 'dc:subject', 'lr:hierarchicalSubject', 'dc:title', 'dc:description']

export function sidecarPathFor(file: string): string {
  return findSidecar(file) ?? path.join(path.dirname(file), `${path.basename(file, path.extname(file))}.xmp`)
}

function elements(f: XmpFields): string {
  const lines: string[] = []
  const rating = f.flag === 'reject' ? -1 : f.rating
  lines.push(`   <xmp:Rating>${rating}</xmp:Rating>`)
  if (f.label) lines.push(`   <xmp:Label>${esc(f.label[0].toUpperCase() + f.label.slice(1))}</xmp:Label>`)
  if (f.keywords.length) {
    const leaves = [...new Set(f.keywords.flatMap((k) => k.split('>')))]
    lines.push('   <dc:subject>\n    <rdf:Bag>')
    for (const k of leaves) lines.push(`     <rdf:li>${esc(k)}</rdf:li>`)
    lines.push('    </rdf:Bag>\n   </dc:subject>')
    const hier = f.keywords.filter((k) => k.includes('>'))
    if (hier.length) {
      lines.push('   <lr:hierarchicalSubject>\n    <rdf:Bag>')
      for (const k of hier) lines.push(`     <rdf:li>${esc(k.replace(/>/g, '|'))}</rdf:li>`)
      lines.push('    </rdf:Bag>\n   </lr:hierarchicalSubject>')
    }
  }
  for (const [tag, v] of [
    ['dc:title', f.title],
    ['dc:description', f.caption]
  ] as const) {
    if (v) lines.push(`   <${tag}>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${esc(v)}</rdf:li>\n    </rdf:Alt>\n   </${tag}>`)
  }
  return lines.join('\n')
}

export function buildSidecar(f: XmpFields): string {
  const xmlns = Object.entries(NAMESPACES)
    .map(([p, u]) => `\n    xmlns:${p}="${u}"`)
    .join('')
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="GlimmR">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""${xmlns}>
${elements(f)}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
`
}

/** Removes the owned properties (attribute and element forms) and inserts fresh ones into the first Description. */
export function mergeSidecar(existing: string, f: XmpFields): string {
  let xml = existing
  for (const tag of OWNED) {
    const t = tag.replace(':', '\\:')
    xml = xml.replace(new RegExp(`\\s${t}="[^"]*"`, 'g'), '')
    xml = xml.replace(new RegExp(`\\s*<${t}(\\s[^>]*)?/>`, 'g'), '')
    xml = xml.replace(new RegExp(`\\s*<${t}(\\s[^>]*)?>[\\s\\S]*?</${t}>`, 'g'), '')
  }
  const open = /<rdf:Description\b([^>]*?)(\/?)>/.exec(xml)
  if (!open) return buildSidecar(f)
  let attrs = open[1]
  for (const [p, u] of Object.entries(NAMESPACES)) if (!new RegExp(`xmlns:${p}=`).test(attrs)) attrs += `\n    xmlns:${p}="${u}"`
  const body = elements(f)
  const replacement = open[2] === '/' ? `<rdf:Description${attrs}>\n${body}\n  </rdf:Description>` : `<rdf:Description${attrs}>\n${body}`
  return xml.slice(0, open.index) + replacement + xml.slice(open.index + open[0].length)
}

export async function writeSidecar(file: string, f: XmpFields): Promise<string> {
  const target = sidecarPathFor(file)
  let content: string
  try {
    content = mergeSidecar(await fs.promises.readFile(target, 'utf8'), f)
  } catch {
    content = buildSidecar(f)
  }
  const tmp = `${target}.glimmr-tmp`
  await fs.promises.writeFile(tmp, content, 'utf8')
  await fs.promises.rename(tmp, target)
  return target
}
