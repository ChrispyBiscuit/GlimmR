// Turns a CLIP image embedding into smart tags, using the label embeddings built by scripts/build-clip-labels.py
// from scripts/clip-vocabulary.json. Pure functions, so the rule can be tested without the model.

import labels from './clip-labels.json'

export interface ScoredTag {
  tag: string
  /** Vocabulary group the tag came from, e.g. subject, bird kind, light, or attribute. */
  group: string
  score: number
}

const decode = (b64: string): Float32Array => {
  const bytes = Buffer.from(b64, 'base64')
  // Copy into a fresh, aligned buffer; base64 decoding can land at any offset in Node's pool.
  return new Float32Array(new Uint8Array(bytes).buffer)
}

const GROUPS = labels.groups.map((g) => ({ ...g, labels: g.labels.map((l) => ({ tag: l.tag, vec: decode(l.embedding) })) }))
const ATTRIBUTES = labels.attributes.map((a) => ({ ...a, yes: decode(a.yes), no: decode(a.no) }))

/** CLIP's learned logit scale. */
const SCALE = 100

const dot = (a: Float32Array, b: Float32Array): number => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** Scales an embedding to unit length in place. */
export function normalize(v: Float32Array): Float32Array {
  const n = Math.sqrt(dot(v, v)) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

/** Changes whenever the vocabulary does, so stored embeddings can be re-scored. */
export const VOCABULARY_VERSION = labels.version

/**
 * Tags for a unit-length image embedding, best first and at most `maxTags`. Each group is a softmax over alternatives
 * (labels sharing a tag add up; distractor labels are never stored), so a tag is only kept when it clearly wins. A group
 * with parents is scored only when one of them was given: specific kinds sit under broad tags (bird → heron).
 * Attributes are yes/no pairs. What's in the photo and where come first, then styles, then the look (light, mood…).
 */
export function tagsFor(embedding: Float32Array): ScoredTag[] {
  const prob = new Map(ATTRIBUTES.map((a) => [a.tag, 1 / (1 + Math.exp(SCALE * (dot(a.no, embedding) - dot(a.yes, embedding))))]))
  const suppressed = new Set<string>()
  const attrs: ScoredTag[] = []
  // Attributes that rule groups out (a document has no place) are decided first.
  for (const a of ATTRIBUTES) {
    if (!a.suppresses.length || prob.get(a.tag)! < a.threshold) continue
    attrs.push({ tag: a.tag, group: 'attribute', score: prob.get(a.tag)! })
    a.suppresses.forEach((g) => suppressed.add(g))
  }
  const given = new Set<string>()
  const what: ScoredTag[] = []
  const look: ScoredTag[] = []
  for (const g of GROUPS) {
    if (suppressed.has(g.id) || (g.parents.length && !g.parents.some((t) => given.has(t)))) continue
    const logits = g.labels.map((l) => SCALE * dot(l.vec, embedding))
    const max = Math.max(...logits)
    const exps = logits.map((z) => Math.exp(z - max))
    const sum = exps.reduce((a, b) => a + b, 0)
    const byTag = new Map<string | null, number>()
    g.labels.forEach((l, i) => byTag.set(l.tag, (byTag.get(l.tag) ?? 0) + exps[i] / sum))
    let kept = 0
    for (const [tag, p] of [...byTag].sort((a, b) => b[1] - a[1])) {
      if (p < g.threshold || kept >= g.max) break
      if (!tag) continue
      ;(g.look ? look : what).push({ tag, group: g.id, score: p })
      given.add(tag)
      kept++
    }
  }
  for (const a of ATTRIBUTES) {
    if (a.suppresses.length || prob.get(a.tag)! < a.threshold) continue
    if (a.parents.length && !a.parents.some((t) => given.has(t))) continue
    attrs.push({ tag: a.tag, group: 'attribute', score: prob.get(a.tag)! })
  }
  const seen = new Set<string>()
  return [...what, ...attrs, ...look].filter((t) => !seen.has(t.tag) && seen.add(t.tag)).slice(0, labels.maxTags)
}

/** Embeddings are stored as int8 (512 bytes a photo), enough to re-tag or search later without the model. */
export function packEmbedding(v: Float32Array): Uint8Array {
  const out = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)))
  return new Uint8Array(out.buffer)
}

export function unpackEmbedding(bytes: Uint8Array): Float32Array {
  const q = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return normalize(Float32Array.from(q, (x) => x / 127))
}
