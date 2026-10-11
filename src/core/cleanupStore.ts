/**
 * 近重复清理的数据访问 + 扫描服务（主进程）。直接用 db.raw 写自己的语句，不往 db.ts 的大接口里加东西。
 * hidden_items 表本身在 db.ts 的 SCHEMA 里建（网格 / 计数查询要引用它，必须先于那些语句存在）。
 */
import { sep } from 'path'
import type Database from 'better-sqlite3'
import type { DupScanResult, HiddenItem } from '../shared/cleanup'
import { groupNearDuplicates, reclaimableBytes, type DupCandidate } from './duplicates'

/** 隐藏原因：目前只有近重复清理会隐藏 */
export type HiddenReason = 'near-duplicate'

export class CleanupStore {
  private stmts: ReturnType<CleanupStore['prepare']>
  private cache: { signature: string; result: DupScanResult } | null = null
  private running: Promise<DupScanResult> | null = null

  constructor(private raw: Database.Database) {
    this.stmts = this.prepare()
  }

  private prepare() {
    const db = this.raw
    return {
      // 候选：存活的图片代表行（不含视频帧 / 音频封面），有向量、未隐藏
      candidates: db.prepare(`
        SELECT p.id as photoId, p.file_hash as fileHash, p.file_name as fileName,
               p.width, p.height, p.file_size as fileSize, p.taken_at as takenAt, p.file_mtime as fileMtime,
               (SELECT COUNT(*) FROM photos p2 WHERE p2.file_hash = p.file_hash AND p2.deleted_at IS NULL) as copies
        FROM photos p
        WHERE p.deleted_at IS NULL AND p.video_id IS NULL
          AND p.id = (SELECT MIN(p3.id) FROM photos p3 WHERE p3.file_hash = p.file_hash AND p3.deleted_at IS NULL)
          AND p.file_hash IN (SELECT file_hash FROM image_vec_map)
          AND p.file_hash NOT IN (SELECT file_hash FROM hidden_items)
      `),
      vector: db.prepare(`
        SELECT v.embedding FROM image_vecs v JOIN image_vec_map m ON m.rowid = v.rowid WHERE m.file_hash = ?
      `).pluck(),
      // 库签名：存活图片数 + 最近一次变更 + 向量数 + 隐藏数，变了就重扫
      signature: db.prepare(`
        SELECT (SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL AND video_id IS NULL) || '|' ||
               (SELECT COALESCE(MAX(updated_at), '') FROM photos) || '|' ||
               (SELECT COUNT(*) FROM photos WHERE deleted_at IS NOT NULL) || '|' ||
               (SELECT COUNT(*) FROM image_vec_map) || '|' ||
               (SELECT COUNT(*) FROM hidden_items)
      `).pluck(),
      hide: db.prepare(`INSERT OR IGNORE INTO hidden_items (file_hash, reason) VALUES (?, ?)`),
      unhide: db.prepare(`DELETE FROM hidden_items WHERE file_hash = ?`),
      listHidden: db.prepare(`
        SELECT p.id as photoId, h.file_hash as fileHash, p.file_name as fileName, p.file_size as fileSize, h.created_at as hiddenAt
        FROM hidden_items h
        JOIN photos p ON p.id = (SELECT MIN(p3.id) FROM photos p3 WHERE p3.file_hash = h.file_hash AND p3.deleted_at IS NULL)
        ORDER BY h.created_at DESC
      `),
      hiddenHashes: db.prepare(`SELECT file_hash FROM hidden_items`).pluck(),
      livePaths: db.prepare(`
        SELECT p.file_path as filePath, p.file_size as fileSize, f.path as folderPath
        FROM photos p JOIN watched_folders f ON f.id = p.folder_id
        WHERE p.file_hash = ? AND p.deleted_at IS NULL AND p.video_id IS NULL
      `),
    }
  }

  private getVector = (fileHash: string): Float32Array | null => {
    const b = this.stmts.vector.get(fileHash) as Buffer | undefined
    if (!b) return null
    // 拷一份：better-sqlite3 返回的 Buffer 可能不在 4 字节边界上，不能直接套 Float32Array
    const bytes = new Uint8Array(b.byteLength)
    bytes.set(b)
    return new Float32Array(bytes.buffer)
  }

  /** 扫描（同一时间只跑一个；库没变直接返回缓存） */
  scan(onProgress?: (done: number, total: number) => void): Promise<DupScanResult> {
    const signature = String(this.stmts.signature.get())
    if (this.cache && this.cache.signature === signature) return Promise.resolve({ ...this.cache.result, cached: true })
    if (this.running) return this.running
    this.running = (async () => {
      try {
        const rows = this.stmts.candidates.all() as Array<Omit<DupCandidate, 'ts'> & { fileMtime: number }>
        const candidates: DupCandidate[] = rows.map(({ fileMtime, ...r }) => {
          const taken = r.takenAt ? Date.parse(r.takenAt.replace(' ', 'T')) : NaN
          return { ...r, ts: Number.isFinite(taken) ? taken : fileMtime }
        })
        const groups = await groupNearDuplicates(candidates, this.getVector, { onProgress })
        const result: DupScanResult = { groups, scanned: candidates.length, reclaimableBytes: reclaimableBytes(groups), cached: false }
        this.cache = { signature: String(this.stmts.signature.get()), result }
        return result
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  hide(hashes: string[], reason: HiddenReason = 'near-duplicate'): void {
    this.raw.transaction(() => { for (const h of hashes) this.stmts.hide.run(h, reason) })()
  }

  unhide(hashes: string[]): void {
    this.raw.transaction(() => { for (const h of hashes) this.stmts.unhide.run(h) })()
  }

  listHidden(): HiddenItem[] {
    return this.stmts.listHidden.all() as HiddenItem[]
  }

  hiddenHashes(): Set<string> {
    return new Set(this.stmts.hiddenHashes.all() as string[])
  }

  /**
   * 这些内容在磁盘上的所有副本路径。只返回位于其所属监视文件夹内的路径（防御：绝不碰监视范围外的文件）。
   */
  trashTargets(hashes: string[]): Array<{ filePath: string; fileSize: number }> {
    const out: Array<{ filePath: string; fileSize: number }> = []
    for (const h of hashes) {
      for (const r of this.stmts.livePaths.all(h) as Array<{ filePath: string; fileSize: number; folderPath: string }>) {
        const root = r.folderPath.endsWith(sep) ? r.folderPath : r.folderPath + sep
        if (r.filePath.startsWith(root)) out.push({ filePath: r.filePath, fileSize: r.fileSize })
      }
    }
    return out
  }
}
