/**
 * 标签的主进程部分：IPC 转发到服务层（src/services/api.ts），侧栏标签右键菜单留在这里
 * （原生菜单 / 确认框是桌面专属）。改动后服务层 emit tags-changed，index.ts 转发到各窗口。
 */
import { BrowserWindow, Menu, dialog, ipcMain, type MenuItemConstructorOptions } from 'electron'
import { TAG_CHANNELS, type TagMenuAction } from '../shared/tags'
import { t } from '../shared/i18n'
import type { TagStore } from '../core/tagStore'
import type { VixelServices } from '../services/api'

/** 合并到…子菜单最多列这么多个标签（按使用次数） */
const MERGE_MENU_MAX = 30

/** 侧栏标签右键菜单；删除先弹确认框，确认了才执行 */
function popupTagMenu(win: BrowserWindow, store: TagStore, tagId: number): Promise<TagMenuAction | null> {
  const tag = store.get(tagId)
  if (!tag) return Promise.resolve(null)
  const others = store.list().filter((x) => x.id !== tagId && x.count > 0).slice(0, MERGE_MENU_MAX)
  return new Promise((resolve) => {
    let picked: TagMenuAction | null = null
    const template: MenuItemConstructorOptions[] = [
      { label: t.tags.rename, click: () => { picked = { action: 'rename' } } },
      {
        label: t.tags.mergeInto,
        submenu: others.length > 0
          ? others.map((o) => ({ label: o.name, click: () => { picked = { action: 'merge', intoId: o.id } } }))
          : [{ label: t.tags.noOtherTags, enabled: false }],
      },
      { type: 'separator' },
      { label: t.tags.deleteTag, click: () => { picked = { action: 'delete' } } },
    ]
    // 和其他弹出菜单一样：click 可能晚于关闭回调，稍等再收尾
    Menu.buildFromTemplate(template).popup({
      window: win,
      callback: () => setTimeout(async () => {
        if (picked?.action !== 'delete') return resolve(picked)
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          message: t.tags.deleteConfirm(tag.name),
          detail: t.tags.deleteDetail,
          buttons: [t.tags.deleteButton, t.common.cancel],
          defaultId: 1,
          cancelId: 1,
        })
        resolve(response === 0 ? picked : null)
      }, 100),
    })
  })
}

export function registerTagIpc(services: VixelServices): void {
  const { api, tagStore, events } = services

  ipcMain.handle(TAG_CHANNELS.LIST, async () => api.tags.list())
  ipcMain.handle(TAG_CHANNELS.FOR_HASHES, async (_e, list: string[]) => api.tags.forHashes(list))
  ipcMain.handle(TAG_CHANNELS.ADD, async (_e, list: string[], name: string) => api.tags.add(list, name))
  ipcMain.handle(TAG_CHANNELS.REMOVE, async (_e, list: string[], tagId: number) => api.tags.remove(list, tagId))
  // 自动标签的 ✓：变成用户标签
  ipcMain.handle(TAG_CHANNELS.CONFIRM_AUTO, async (_e, list: string[], tagId: number) => api.tags.confirmAuto(list, tagId))
  ipcMain.handle(TAG_CHANNELS.RENAME, async (_e, tagId: number, name: string) => api.tags.rename(tagId, name))

  // 合并 / 删除在主进程直接执行（删除已经过确认框）；改名由渲染进程进入行内编辑
  ipcMain.handle(TAG_CHANNELS.SHOW_MENU, async (event, tagId: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof tagId !== 'number') return null
    const action = await popupTagMenu(win, tagStore, tagId)
    if (action?.action === 'merge') { tagStore.merge(tagId, action.intoId); events.emit('tags-changed') }
    if (action?.action === 'delete') { tagStore.delete(tagId); events.emit('tags-changed') }
    return action
  })
}
