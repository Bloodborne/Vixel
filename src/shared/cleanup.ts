/** 近重复清理：主进程 ↔ 渲染进程共用的类型和 IPC 通道（独立文件，不挤进 types.ts） */

export const CLEANUP_CHANNELS = {
  SCAN: 'cleanup:scan',
  PROGRESS: 'cleanup:progress',
  HIDE: 'cleanup:hide',
  UNHIDE: 'cleanup:unhide',
  LIST_HIDDEN: 'cleanup:list-hidden',
  TRASH: 'cleanup:trash',
  DISMISS: 'cleanup:dismiss',
} as const

export interface DupItem {
  /** 代表 photo 的 id（缩略图 vixel://thumb/<id>） */
  photoId: number
  fileHash: string
  fileName: string
  width: number | null
  height: number | null
  /** 字节数（同一内容多份副本时只算一份） */
  fileSize: number
  takenAt: string | null
  /** 该内容在磁盘上的副本数（不同路径、同一 hash） */
  copies: number
}

export interface DupGroup {
  /** 稳定 id：组内 hash 排序后的 sha1，重扫后同一组 id 不变；"不是重复"按它记住 */
  id: string
  items: DupItem[]
  /** 建议保留的那张 */
  keeperHash: string
  /** 组内最相似一对的余弦 */
  similarity: number
}

export interface DupScanResult {
  groups: DupGroup[]
  /** 参与比较的图片数 */
  scanned: number
  /** 按建议（只留 keeper）可释放的字节数 */
  reclaimableBytes: number
  /** 结果来自缓存（库没变） */
  cached: boolean
}

export interface DupScanProgress {
  done: number
  total: number
}

export interface HiddenItem {
  photoId: number
  fileHash: string
  fileName: string
  fileSize: number
  hiddenAt: string
}

export interface TrashResult {
  cancelled: boolean
  trashed: number
  failed: number
}
