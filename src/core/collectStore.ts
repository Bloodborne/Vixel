/**
 * 收集箱的数据访问（主进程）：直接用 db.raw，不往 db.ts 的大接口里加东西。
 * is_inbox 列和 item_sources 表在 db.ts 的 SCHEMA / migrateSchema 里建。
 */
import type Database from 'better-sqlite3'
import type { ItemSource } from '../shared/collect'

export class CollectStore {
  private stmts: ReturnType<CollectStore['prepare']>

  constructor(private raw: Database.Database) {
    this.stmts = this.prepare()
  }

  private prepare() {
    const db = this.raw
    return {
      inbox: db.prepare(`SELECT id, path FROM watched_folders WHERE is_inbox = 1 ORDER BY id LIMIT 1`),
      markInbox: db.prepare(`UPDATE watched_folders SET is_inbox = CASE WHEN id = ? THEN 1 ELSE 0 END`),
      folderByPath: db.prepare(`SELECT id, path FROM watched_folders WHERE path = ?`),
      // 内容是否已在库里（任一存活副本）；返回代表 photo（MIN(id)）
      liveByHash: db.prepare(`
        SELECT MIN(id) AS id FROM photos WHERE file_hash = ? AND deleted_at IS NULL
      `).pluck(),
      photoByPath: db.prepare(`SELECT id, file_hash AS fileHash FROM photos WHERE file_path = ? AND deleted_at IS NULL`),
      folderOfPhoto: db.prepare(`SELECT folder_id FROM photos WHERE id = ?`).pluck(),
      // 音视频判重：同大小的存活文件逐个比头尾字节（音视频的 file_hash 含 mtime，复制后必然不同）
      videosBySize: db.prepare(`SELECT file_path AS filePath FROM videos WHERE file_size = ? AND deleted_at IS NULL`),
      videoByPath: db.prepare(`SELECT id FROM videos WHERE file_path = ? AND deleted_at IS NULL`).pluck(),
      videoFrame: db.prepare(`
        SELECT MIN(p.id) FROM photos p JOIN videos v ON v.id = p.video_id
        WHERE v.file_path = ? AND v.deleted_at IS NULL AND p.deleted_at IS NULL
      `).pluck(),
      // 来源只记第一次（同一张图后来又从别处收一次，不覆盖原始出处）
      setSource: db.prepare(`
        INSERT INTO item_sources (file_hash, url, page_url, page_title) VALUES (?, ?, ?, ?)
        ON CONFLICT(file_hash) DO UPDATE SET
          url = COALESCE(item_sources.url, excluded.url),
          page_url = COALESCE(item_sources.page_url, excluded.page_url),
          page_title = COALESCE(item_sources.page_title, excluded.page_title)
      `),
      getSource: db.prepare(`
        SELECT url, page_url AS pageUrl, page_title AS pageTitle, collected_at AS collectedAt
        FROM item_sources WHERE file_hash = ?
      `),
    }
  }

  getInbox(): { id: number; path: string } | null {
    return (this.stmts.inbox.get() as { id: number; path: string } | undefined) ?? null
  }

  markInbox(folderId: number): void {
    this.stmts.markInbox.run(folderId)
  }

  folderByPath(path: string): { id: number; path: string } | null {
    return (this.stmts.folderByPath.get(path) as { id: number; path: string } | undefined) ?? null
  }

  liveImageByHash(fileHash: string): number | null {
    return (this.stmts.liveByHash.get(fileHash) as number | null) ?? null
  }

  photoByPath(path: string): { id: number; fileHash: string } | null {
    return (this.stmts.photoByPath.get(path) as { id: number; fileHash: string } | undefined) ?? null
  }

  folderOfPhoto(photoId: number): number | null {
    return (this.stmts.folderOfPhoto.get(photoId) as number | undefined) ?? null
  }

  videoPathsBySize(size: number): string[] {
    return (this.stmts.videosBySize.all(size) as Array<{ filePath: string }>).map((r) => r.filePath)
  }

  hasVideoAt(path: string): boolean {
    return this.stmts.videoByPath.get(path) != null
  }

  /** 音视频的代表 photo（首帧 / 封面）；还没抽出来时为 null */
  videoFrameByPath(path: string): number | null {
    return (this.stmts.videoFrame.get(path) as number | null) ?? null
  }

  setSource(fileHash: string, src: { url?: string; pageUrl?: string; pageTitle?: string }): void {
    if (!src.url && !src.pageUrl) return
    this.stmts.setSource.run(fileHash, src.url ?? null, src.pageUrl ?? null, src.pageTitle ?? null)
  }

  getSource(fileHash: string): ItemSource | null {
    return (this.stmts.getSource.get(fileHash) as ItemSource | undefined) ?? null
  }
}
