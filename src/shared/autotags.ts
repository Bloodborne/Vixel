/** 自动标签：主进程 ↔ 渲染进程共用的类型和 IPC 通道（独立文件，不挤进 types.ts） */

export const AUTOTAG_CHANNELS = {
  STATUS: 'autotags:status',
  SET_ENABLED: 'autotags:set-enabled',
  RERUN: 'autotags:rerun',
  /** 主进程 → 渲染进程：状态变化（进度、开关） */
  CHANGED: 'autotags:changed',
} as const

export interface AutoTagStatus {
  enabled: boolean
  /** 正在后台判定 */
  running: boolean
  /** 有图片向量、还没判定的内容数 */
  pending: number
  /** 已判定的内容数 */
  done: number
  /** 库太小（不到 20 项）时先不打：没有可靠的基线 */
  waitingForLibrary: boolean
}
