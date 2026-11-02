// Catalog storage for smart tags and the embeddings they came from.

import { type Db, reindexFts, tx } from '../db'
import { packEmbedding, type ScoredTag } from './rules'

/** Photos that still need tagging by this model: never done, or the file changed since. */
export function pendingTagIds(db: Db, model: string, limit = -1): number[] {
  return (
    db
      .prepare(
        `SELECT p.id FROM photos p LEFT JOIN photo_embeddings e ON e.photo_id = p.id
         WHERE p.has_preview = 1 AND (e.photo_id IS NULL OR e.model <> ? OR e.mtime <> p.mtime)
         ORDER BY p.taken_at DESC LIMIT ?`
      )
      .all(model, limit) as { id: number }[]
  ).map((r) => r.id)
}

export function tagCounts(db: Db, model: string): { tagged: number; total: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(e.photo_id) AS tagged FROM photos p
       LEFT JOIN photo_embeddings e ON e.photo_id = p.id AND e.model = ? AND e.mtime = p.mtime WHERE p.has_preview = 1`
    )
    .get(model) as { total: number; tagged: number }
  return r
}

/** Stores a batch of results, keeping tags the user hid, and refreshes those photos' search text. */
export function saveTagResults(db: Db, model: string, rows: { id: number; mtime: number; embedding: Float32Array; tags: ScoredTag[] }[]): void {
  const upsertVec = db.prepare(
    'INSERT INTO photo_embeddings (photo_id, model, mtime, vec) VALUES (?, ?, ?, ?) ON CONFLICT(photo_id) DO UPDATE SET model = excluded.model, mtime = excluded.mtime, vec = excluded.vec'
  )
  const clear = db.prepare('DELETE FROM photo_tags WHERE photo_id = ? AND hidden = 0')
  const insert = db.prepare('INSERT OR IGNORE INTO photo_tags (photo_id, tag, grp, score) VALUES (?, ?, ?, ?)')
  tx(db, () => {
    for (const r of rows) {
      // The photo may have been removed while it was being tagged.
      if (!db.prepare('SELECT 1 FROM photos WHERE id = ?').get(r.id)) continue
      upsertVec.run(r.id, model, r.mtime, packEmbedding(r.embedding))
      clear.run(r.id)
      for (const t of r.tags) insert.run(r.id, t.tag, t.group, Math.round(t.score * 1000) / 1000)
      reindexFts(db, r.id)
    }
  })
}

export function photoTags(db: Db, photoId: number): { tag: string; group: string; score: number }[] {
  return db
    .prepare('SELECT tag, grp AS "group", score FROM photo_tags WHERE photo_id = ? AND hidden = 0 ORDER BY score DESC')
    .all(photoId) as { tag: string; group: string; score: number }[]
}

/** Removes a wrong tag from a photo for good. */
export function hideTag(db: Db, photoId: number, tag: string): void {
  tx(db, () => {
    db.prepare('UPDATE photo_tags SET hidden = 1 WHERE photo_id = ? AND tag = ?').run(photoId, tag)
    reindexFts(db, photoId)
  })
}

/** Deletes every smart tag and embedding. */
export function clearTags(db: Db): void {
  const ids = (db.prepare('SELECT DISTINCT photo_id AS id FROM photo_tags').all() as { id: number }[]).map((r) => r.id)
  tx(db, () => {
    db.exec('DELETE FROM photo_tags; DELETE FROM photo_embeddings;')
    ids.forEach((id) => reindexFts(db, id))
  })
}
