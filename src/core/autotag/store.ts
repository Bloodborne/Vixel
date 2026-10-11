/**
 * 自动标签的数据访问。直接用 db.raw（同 tagStore / cleanupStore），表在 db.ts 的 SCHEMA 里建。
 *
 * 自动标签和用户标签共用 tags / item_tags：
 *   - 词表标签在 tags 里一行，带 label_id；用户已有同名标签（中文名或英文名）就复用那一行
 *   - 自动打的链接 auto_score 非空；用户确认后清空（变成普通标签）
 *   - 用户删掉的记进 autotag_rejections，以后不再自动打
 */
import type Database from 'better-sqlite3'
import type { Label } from './vocabulary'
import type { Assignment } from './assign'

function toF32(buf: Buffer): Float32Array {
  // 拷一份：better-sqlite3 返回的 Buffer 可能不在 4 字节边界上
  const bytes = new Uint8Array(buf.byteLength)
  bytes.set(buf)
  return new Float32Array(bytes.buffer)
}

export class AutoTagStore {
  private stmts: ReturnType<AutoTagStore['prepare']>

  constructor(private raw: Database.Database) {
    this.stmts = this.prepare()
  }

  private prepare() {
    const db = this.raw
    return {
      labelVectors: db.prepare(`SELECT label_id as id, embedding FROM autotag_labels WHERE version = ?`),
      saveLabel: db.prepare(`INSERT OR REPLACE INTO autotag_labels (label_id, version, embedding) VALUES (?, ?, ?)`),
      dropStaleLabels: db.prepare(`DELETE FROM autotag_labels WHERE version != ?`),
      // 待判定：有图片向量、存活、没隐藏、本版本没判过（每次取一小批）
      pending: db.prepare(`
        SELECT m.file_hash FROM image_vec_map m
        WHERE m.file_hash NOT IN (SELECT file_hash FROM autotag_done WHERE version = ?)
          AND EXISTS (SELECT 1 FROM photos p WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL)
          AND m.file_hash NOT IN (SELECT file_hash FROM hidden_items)
        LIMIT ?
      `).pluck(),
      countPending: db.prepare(`
        SELECT COUNT(*) FROM image_vec_map m
        WHERE m.file_hash NOT IN (SELECT file_hash FROM autotag_done WHERE version = ?)
          AND EXISTS (SELECT 1 FROM photos p WHERE p.file_hash = m.file_hash AND p.deleted_at IS NULL)
          AND m.file_hash NOT IN (SELECT file_hash FROM hidden_items)
      `).pluck(),
      countDone: db.prepare(`SELECT COUNT(*) FROM autotag_done WHERE version = ?`).pluck(),
      imageVec: db.prepare(`SELECT v.embedding FROM image_vecs v JOIN image_vec_map m ON m.rowid = v.rowid WHERE m.file_hash = ?`).pluck(),
      // 视频 / 音频的代表帧 → 各片段向量
      segmentVecs: db.prepare(`
        SELECT v.embedding FROM video_segment_vecs v
        JOIN video_segment_vec_map m ON m.rowid = v.rowid
        JOIN video_segments s ON s.id = m.segment_id
        WHERE s.video_id = (SELECT p.video_id FROM photos p WHERE p.file_hash = ? AND p.video_id IS NOT NULL AND p.deleted_at IS NULL LIMIT 1)
      `).pluck(),
      repHashOfVideo: db.prepare(`SELECT file_hash FROM photos WHERE video_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1`).pluck(),
      markDone: db.prepare(`INSERT OR REPLACE INTO autotag_done (file_hash, version) VALUES (?, ?)`),
      forget: db.prepare(`DELETE FROM autotag_done WHERE file_hash = ?`),
      rejected: db.prepare(`SELECT label_id FROM autotag_rejections WHERE file_hash = ?`).pluck(),
      tagByLabel: db.prepare(`SELECT id FROM tags WHERE label_id = ?`).pluck(),
      tagByName: db.prepare(`SELECT id, label_id as labelId FROM tags WHERE name = ? COLLATE NOCASE`),
      setLabel: db.prepare(`UPDATE tags SET label_id = ? WHERE id = ?`),
      insertTag: db.prepare(`INSERT INTO tags (name, label_id) VALUES (?, ?)`),
      // 自动链接：已有链接（用户打的或之前自动打的）不动
      linkAuto: db.prepare(`INSERT OR IGNORE INTO item_tags (file_hash, tag_id, auto_score) VALUES (?, ?, ?)`),
      clearAutoForHash: db.prepare(`DELETE FROM item_tags WHERE file_hash = ? AND auto_score IS NOT NULL`),
      clearAllAuto: db.prepare(`DELETE FROM item_tags WHERE auto_score IS NOT NULL`),
      clearDone: db.prepare(`DELETE FROM autotag_done`),
      gcTags: db.prepare(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM item_tags)`),
    }
  }

  loadLabelVectors(version: string): Map<string, Float32Array> {
    const rows = this.stmts.labelVectors.all(version) as Array<{ id: string; embedding: Buffer }>
    return new Map(rows.map((r) => [r.id, toF32(r.embedding)]))
  }

  saveLabelVectors(version: string, vectors: Map<string, Float32Array>): void {
    this.raw.transaction(() => {
      this.stmts.dropStaleLabels.run(version)
      for (const [id, v] of vectors) this.stmts.saveLabel.run(id, version, Buffer.from(v.buffer, v.byteOffset, v.byteLength))
    })()
  }

  pendingHashes(version: string, limit: number): string[] {
    return this.stmts.pending.all(version, limit) as string[]
  }

  counts(version: string): { pending: number; done: number } {
    return { pending: Number(this.stmts.countPending.get(version)), done: Number(this.stmts.countDone.get(version)) }
  }

  imageVector(hash: string): Float32Array | null {
    const b = this.stmts.imageVec.get(hash) as Buffer | undefined
    return b ? toF32(b) : null
  }

  segmentVectors(hash: string): Float32Array[] {
    return (this.stmts.segmentVecs.all(hash) as Buffer[]).map(toF32)
  }

  representativeHashOfVideo(videoId: number): string | null {
    return (this.stmts.repHashOfVideo.get(videoId) as string | undefined) ?? null
  }

  /** 词表标签对应的 tags 行：已有 label_id 的、或同名（中 / 英）的用户标签，都没有就新建 */
  private tagIdFor(label: Label): number {
    const byLabel = this.stmts.tagByLabel.get(label.id) as number | undefined
    if (byLabel) return byLabel
    for (const name of [label.zh, label.en]) {
      const row = this.stmts.tagByName.get(name) as { id: number; labelId: string | null } | undefined
      if (row && !row.labelId) {
        this.stmts.setLabel.run(label.id, row.id)
        return row.id
      }
    }
    return Number(this.stmts.insertTag.run(label.zh, label.id).lastInsertRowid)
  }

  /**
   * 写入一项内容的判定结果：先清掉它原来的自动链接（用户打的 / 确认过的不动），再按新结果打上，
   * 跳过用户删过的标签。返回实际打上的标签数。
   */
  apply(hash: string, version: string, assignments: Assignment[], labels: Map<string, Label>): number {
    return this.raw.transaction(() => {
      this.stmts.clearAutoForHash.run(hash)
      const rejected = new Set(this.stmts.rejected.all(hash) as string[])
      let n = 0
      for (const a of assignments) {
        const label = labels.get(a.labelId)
        if (!label || rejected.has(a.labelId)) continue
        n += this.stmts.linkAuto.run(hash, this.tagIdFor(label), a.z).changes
      }
      this.stmts.markDone.run(hash, version)
      this.stmts.gcTags.run()
      return n
    })()
  }

  /** 让某项内容重新判定（视频的片段向量后到时） */
  forget(hash: string): void {
    this.stmts.forget.run(hash)
  }

  /** 重跑：清掉全部未确认的自动标签和判定记录（拒绝记录保留） */
  reset(): void {
    this.raw.transaction(() => {
      this.stmts.clearAllAuto.run()
      this.stmts.clearDone.run()
      this.stmts.gcTags.run()
    })()
  }

  /** 关闭自动标签：去掉未确认的自动标签（确认过的已经是用户标签，保留） */
  clearAuto(): void {
    this.reset()
  }
}
