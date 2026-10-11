/**
 * 标签 + Eagle 资源库的主进程部分：IPC、侧栏标签右键菜单、Eagle 同步调度。
 * 同步只读 .library；改动写进 Vixel 自己的库后广播 TAG_CHANNELS.CHANGED，各窗口刷新标签。
 */
import { BrowserWindow, Menu, dialog, ipcMain, shell, type MenuItemConstructorOptions } from 'electron'
import { TAG_CHANNELS, type TagMenuAction } from '../shared/tags'
import { t } from '../shared/i18n'
import type { DatabaseInstance } from '../core/db'
import type { FileWatcher } from '../core/watcher'
import { classifyMedia } from '../core/watcher'
import { TagStore } from '../core/tagStore'
import { EagleSync, isEagleLibrary } from '../core/eagle'

/** Eagle 那边一次改动常常连写好几个 metadata.json：攒一会儿再同步 */
const EAGLE_SYNC_DEBOUNCE_MS = 1500
/** 合并到…子菜单最多列这么多个标签（按使用次数） */
const MERGE_MENU_MAX = 30

export function broadcastTagsChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(TAG_CHANNELS.CHANGED)
}

/** Eagle 同步调度：按库防抖；同步完按回收站状态增删索引，再广播标签变化 */
export function createEagleScheduler(eagle: EagleSync, watcher: FileWatcher): (folderId: number, root: string) => void {
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  const running = new Map<number, Promise<void>>()
  const run = async (folderId: number, root: string): Promise<void> => {
    try {
      const { removed, restored } = await eagle.sync(folderId, root, (name) => classifyMedia(name) !== null)
      for (const p of removed) await watcher.removePath(p)
      for (const p of restored) await watcher.addPath(folderId, p)
      broadcastTagsChanged()
    } catch (err) {
      console.warn(`[eagle] sync failed for ${root}:`, err)
    }
  }
  return (folderId, root) => {
    clearTimeout(timers.get(folderId))
    timers.set(folderId, setTimeout(() => {
      timers.delete(folderId)
      // 同一个库不并发同步：上一次没跑完就排在它后面
      const prev = running.get(folderId) ?? Promise.resolve()
      const next = prev.then(() => run(folderId, root))
      running.set(folderId, next)
      void next.finally(() => { if (running.get(folderId) === next) running.delete(folderId) })
    }, EAGLE_SYNC_DEBOUNCE_MS))
  }
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

/** 选一个 Eagle 资源库并加入监视；不是资源库就提示。返回新文件夹的路径（取消 / 无效时 null） */
export async function chooseEagleLibrary(win: BrowserWindow | null): Promise<string | null> {
  const opts = { title: t.tags.eagleDialogTitle, message: t.tags.eagleDialogTitle, properties: ['openDirectory' as const] }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || !result.filePaths[0]) return null
  const dir = result.filePaths[0]
  if (!isEagleLibrary(dir)) {
    const box = { type: 'warning' as const, message: t.tags.notEagleTitle, detail: t.tags.notEagleDetail, buttons: [t.common.ok] }
    if (win) await dialog.showMessageBox(win, box)
    else await dialog.showMessageBox(box)
    return null
  }
  return dir
}

export function registerTagIpc(db: DatabaseInstance, eagle: EagleSync): TagStore {
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

  ipcMain.handle(TAG_CHANNELS.EAGLE_INFO, async (_e, fileHash: unknown) => (typeof fileHash === 'string' ? eagle.info(fileHash) : null))

  // 只在用户明确点了来源链接时打开，且只认 http(s)：渲染进程自身仍然不能联网
  ipcMain.handle(TAG_CHANNELS.OPEN_URL, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })

  return store
}
