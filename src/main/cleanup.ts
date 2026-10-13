/**
 * 近重复清理的 IPC：扫描 / 隐藏 / 取消隐藏走服务层（src/services/api.ts，与服务器共用）。
 * 移到废纸篓是桌面专属：只走 shell.trashItem（可从废纸篓恢复），且必须先过主进程的原生确认框。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CLEANUP_CHANNELS, type TrashResult } from '../shared/cleanup'
import type { DatabaseInstance } from '../core/db'
import type { VixelServices } from '../services/api'
import { t } from '../shared/i18n'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function registerCleanupIpc(services: VixelServices, db: DatabaseInstance): void {
  const { api, cleanupStore, events } = services

  ipcMain.handle(CLEANUP_CHANNELS.SCAN, async () => api.cleanup.scan())
  ipcMain.handle(CLEANUP_CHANNELS.HIDE, async (_event, hashes: string[]) => api.cleanup.hide(hashes))
  ipcMain.handle(CLEANUP_CHANNELS.UNHIDE, async (_event, hashes: string[]) => api.cleanup.unhide(hashes))
  ipcMain.handle(CLEANUP_CHANNELS.LIST_HIDDEN, async () => api.cleanup.listHidden())
  ipcMain.handle(CLEANUP_CHANNELS.DISMISS, async (_event, groupIds: string[]) => api.cleanup.dismiss(groupIds))

  ipcMain.handle(CLEANUP_CHANNELS.TRASH, async (event, hashes: string[]): Promise<TrashResult> => {
    const targets = cleanupStore.trashTargets((Array.isArray(hashes) ? hashes : []).filter((h) => typeof h === 'string'))
    if (targets.length === 0) return { cancelled: false, trashed: 0, failed: 0 }
    const total = targets.reduce((s, x) => s + x.fileSize, 0)
    const win = BrowserWindow.fromWebContents(event.sender)
    const bin = process.platform === 'darwin' ? t.cleanup.binMac : t.cleanup.binWin
    const opts = {
      type: 'warning' as const,
      buttons: [t.cleanup.trashConfirmButton(bin), t.common.cancel],
      defaultId: 1,
      cancelId: 1,
      message: t.cleanup.trashConfirmTitle(targets.length, bin),
      detail: t.cleanup.trashConfirmDetail(formatBytes(total), bin),
    }
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (response !== 0) return { cancelled: true, trashed: 0, failed: 0 }

    let trashed = 0, failed = 0
    for (const { filePath } of targets) {
      try {
        await shell.trashItem(filePath)
        // 监视器随后也会收到 unlink；这里先软删，界面立即一致（重复软删无副作用）
        db.softDeletePhoto(filePath)
        trashed++
      } catch (err) {
        console.error('[cleanup] trash failed:', filePath, err)
        failed++
      }
    }
    events.emit('library-changed')
    return { cancelled: false, trashed, failed }
  })
}
