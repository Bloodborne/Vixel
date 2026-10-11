/**
 * 标签的主进程部分：IPC、侧栏标签右键菜单。改动后广播 TAG_CHANNELS.CHANGED，各窗口刷新标签。
 */
import { BrowserWindow, Menu, dialog, ipcMain, type MenuItemConstructorOptions } from 'electron'
import { TAG_CHANNELS, type TagMenuAction } from '../shared/tags'
import { t } from '../shared/i18n'
import type { DatabaseInstance } from '../core/db'
import { TagStore } from '../core/tagStore'

/** 合并到…子菜单最多列这么多个标签（按使用次数） */
const MERGE_MENU_MAX = 30

export function broadcastTagsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(TAG_CHANNELS.CHANGED)
}

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

export function registerTagIpc(db: DatabaseInstance): TagStore {
  const store = new TagStore(db.raw)
  const hashes = (v: unknown): string[] => (Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string') : [])

  ipcMain.handle(TAG_CHANNELS.LIST, async () => store.list())
  ipcMain.handle(TAG_CHANNELS.FOR_HASHES, async (_e, list: unknown) => store.forHashes(hashes(list)))

  ipcMain.handle(TAG_CHANNELS.ADD, async (_e, list: unknown, name: unknown) => {
    if (typeof name !== 'string' || !name.trim()) return null
    const id = store.add(hashes(list), name)
    broadcastTagsChanged()
    return id
  })

  ipcMain.handle(TAG_CHANNELS.REMOVE, async (_e, list: unknown, tagId: unknown) => {
    if (typeof tagId !== 'number') return
    store.remove(hashes(list), tagId)
    broadcastTagsChanged()
  })

  // 自动标签的 ✓：变成用户标签
  ipcMain.handle(TAG_CHANNELS.CONFIRM_AUTO, async (_e, list: unknown, tagId: unknown) => {
    if (typeof tagId !== 'number') return
    store.confirmAuto(hashes(list), tagId)
    broadcastTagsChanged()
  })

  ipcMain.handle(TAG_CHANNELS.RENAME, async (_e, tagId: unknown, name: unknown) => {
    if (typeof tagId !== 'number' || typeof name !== 'string') return null
    const id = store.rename(tagId, name)
    broadcastTagsChanged()
    return id
  })

  // 合并 / 删除在主进程直接执行（删除已经过确认框）；改名由渲染进程进入行内编辑
  ipcMain.handle(TAG_CHANNELS.SHOW_MENU, async (event, tagId: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || typeof tagId !== 'number') return null
    const action = await popupTagMenu(win, store, tagId)
    if (action?.action === 'merge') { store.merge(tagId, action.intoId); broadcastTagsChanged() }
    if (action?.action === 'delete') { store.delete(tagId); broadcastTagsChanged() }
    return action
  })

  return store
}
