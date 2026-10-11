/** 标签 + Eagle 资源库：主进程 ↔ 渲染进程共用的类型和 IPC 通道（独立文件，不挤进 types.ts） */

export const TAG_CHANNELS = {
  LIST: 'tags:list',
  FOR_HASHES: 'tags:for-hashes',
  ADD: 'tags:add',
  REMOVE: 'tags:remove',
  RENAME: 'tags:rename',
  SHOW_MENU: 'tags:show-menu',
  CHANGED: 'tags:changed',
  EAGLE_INFO: 'eagle:info',
  OPEN_URL: 'eagle:open-url',
  ADD_EAGLE_LIBRARY: 'eagle:add-library',
} as const

export interface Tag {
  id: number
  name: string
  /** 'user' = 在 Vixel 里打的；'eagle' = 从 Eagle 资源库同步来的 */
  source: 'user' | 'eagle'
  /** 带这个标签的内容数（不含已删除 / 已隐藏） */
  count: number
}

/** 选中项的标签：all = 每一项都有；some = 只有部分有（多选时淡色显示） */
export interface TagsForSelection {
  all: Tag[]
  some: Tag[]
}

/** 侧栏标签右键菜单的结果 */
export type TagMenuAction = { action: 'rename' } | { action: 'delete' } | { action: 'merge'; intoId: number }

/** 一条内容在 Eagle 资源库里的信息（只读展示） */
export interface EagleItemInfo {
  libraryName: string
  name: string
  annotation: string
  url: string
  /** 0 = 未评星 */
  star: number
  /** Eagle 文件夹路径，如 "自然素材/花卉" */
  folders: string[]
}
