// Turns a CLIP image embedding into smart tags, using the label embeddings built by scripts/build-clip-labels.py
// from scripts/clip-vocabulary.json. Pure functions, so the rule can be tested without the model.

import labels from './clip-labels.json'

export interface ScoredTag {
  tag: string
  /** Vocabulary group the tag came from: subject, scene, event or attribute. */
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

/**
 * Tags for a unit-length image embedding. Each group is a softmax over alternatives (with distractor labels that
 * are never stored), so a tag is only kept when it clearly wins; attributes are yes/no pairs.
 */
export function tagsFor(embedding: Float32Array): ScoredTag[] {
  const out: ScoredTag[] = []
  const suppressed = new Set<string>()
  const attrs: ScoredTag[] = []
  for (const a of ATTRIBUTES) {
    const p = 1 / (1 + Math.exp(SCALE * (dot(a.no, embedding) - dot(a.yes, embedding))))
    if (p >= a.threshold) {
      attrs.push({ tag: a.tag, group: 'attribute', score: p })
      a.suppresses.forEach((g) => suppressed.add(g))
    }
  }
  for (const g of GROUPS) {
    if (suppressed.has(g.id)) continue
    const logits = g.labels.map((l) => SCALE * dot(l.vec, embedding))
    const max = Math.max(...logits)
    const exps = logits.map((z) => Math.exp(z - max))
    const sum = exps.reduce((a, b) => a + b, 0)
    const order = exps.map((e, i) => ({ i, p: e / sum })).sort((a, b) => b.p - a.p)
    let kept = 0
    for (const { i, p } of order) {
      if (p < g.threshold || kept >= g.max) break
      const tag = g.labels[i].tag
      if (!tag) continue
      out.push({ tag, group: g.id, score: p })
      kept++
    }
  }
  return [...out, ...attrs]
}

/** Every tag the vocabulary can produce, for autocomplete and filters. */
export const ALL_TAGS: { tag: string; group: string; title: string }[] = [
  ...GROUPS.flatMap((g) => g.labels.filter((l) => l.tag).map((l) => ({ tag: l.tag!, group: g.id, title: g.title }))),
  ...ATTRIBUTES.map((a) => ({ tag: a.tag, group: 'attribute', title: 'Style' }))
]

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
