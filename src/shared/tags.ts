/** 标签：主进程 ↔ 渲染进程共用的类型和 IPC 通道（独立文件，不挤进 types.ts） */

export const TAG_CHANNELS = {
  LIST: 'tags:list',
  FOR_HASHES: 'tags:for-hashes',
  ADD: 'tags:add',
  REMOVE: 'tags:remove',
  RENAME: 'tags:rename',
  SHOW_MENU: 'tags:show-menu',
  CHANGED: 'tags:changed',
} as const

export interface Tag {
  id: number
  name: string
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
