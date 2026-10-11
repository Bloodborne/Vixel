/** 收集箱 / 浏览器扩展：主进程 ↔ 渲染进程共用的类型和 IPC 通道（独立文件，不挤进 types.ts） */

export const COLLECT_CHANNELS = {
  GET_INBOX: 'collect:get-inbox',
  CHOOSE_INBOX: 'collect:choose-inbox',
  OPEN_INBOX: 'collect:open-inbox',
  IMPORT_PATHS: 'collect:import-paths',
  IMPORT_BYTES: 'collect:import-bytes',
  IMPORT_URL: 'collect:import-url',
  UNDO: 'collect:undo',
  GET_SOURCE: 'collect:get-source',
  OPEN_SOURCE: 'collect:open-source',
  SERVER_STATUS: 'collect:server-status',
  SERVER_SET: 'collect:server-set',
  SERVER_NEW_TOKEN: 'collect:server-new-token',
  /** 主 → 渲染：有新内容收进来了（浏览器扩展收的也走这里） */
  COLLECTED: 'collect:collected',
} as const

export interface InboxInfo {
  folderId: number | null
  /** 收集箱路径（还没创建时是将要使用的默认路径） */
  path: string
  exists: boolean
}

export type CollectVia = 'drop' | 'paste' | 'url' | 'extension'

/** 一次收集（可能是多个文件）的结果 */
export interface CollectResult {
  /** 新写进收集箱的文件数 */
  saved: number
  /** 库里已有相同内容、没有再存一份的数量 */
  existing: number
  /** 不支持的格式 / 读不了的文件 */
  skipped: number
  /** 加为监视文件夹（原地索引）的文件夹数 */
  addedFolders: number
  /** 用户在"文件夹怎么处理"的对话框里取消了 */
  cancelled?: boolean
  /** 用来定位的第一项：已入库的 photo（新文件要等索引登记，超时则为 null） */
  revealPhotoId: number | null
  /** 定位用的文件夹（收集箱或新加的监视文件夹） */
  revealFolderId: number | null
  /** 本次新建的文件，撤销时移到废纸篓 */
  createdPaths: string[]
  /** 失败原因（下载失败、不是图片等），用于提示 */
  error?: string
  via: CollectVia
}

export interface ItemSource {
  url: string | null
  pageUrl: string | null
  pageTitle: string | null
  collectedAt: string
}

export interface CollectServerStatus {
  enabled: boolean
  running: boolean
  port: number
  token: string
  /** 只放行该扩展 id；空 = 任何扩展 */
  extensionId: string
  /** 启动失败原因（端口被占用等） */
  error: string | null
}
