/**
 * 近重复清理的 IPC：扫描（带进度）、在 Vixel 中隐藏 / 取消隐藏、移到废纸篓。
 * 移到废纸篓只走 shell.trashItem（可从废纸篓恢复），且必须先过主进程的原生确认框。
 */
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { CLEANUP_CHANNELS, type DupScanProgress, type TrashResult } from '../shared/cleanup'
import { CleanupStore } from '../core/cleanupStore'
import type { DatabaseInstance } from '../core/db'
import { t } from '../shared/i18n'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function registerCleanupIpc(db: DatabaseInstance, onLibraryChanged: () => void): CleanupStore {
  const store = new CleanupStore(db.raw)

  ipcMain.handle(CLEANUP_CHANNELS.SCAN, async (event) => {
    let last = 0
    return store.scan((done, total) => {
      const now = Date.now()
      if (now - last < 200 && done < total) return
      last = now
      const progress: DupScanProgress = { done, total }
      if (!event.sender.isDestroyed()) event.sender.send(CLEANUP_CHANNELS.PROGRESS, progress)
    })
  })

  ipcMain.handle(CLEANUP_CHANNELS.HIDE, async (_event, hashes: string[]) => {
    store.hide(hashes.filter((h) => typeof h === 'string'))
    onLibraryChanged()
  })

  ipcMain.handle(CLEANUP_CHANNELS.UNHIDE, async (_event, hashes: string[]) => {
    store.unhide(hashes.filter((h) => typeof h === 'string'))
    onLibraryChanged()
  })

  ipcMain.handle(CLEANUP_CHANNELS.LIST_HIDDEN, async () => store.listHidden())

  ipcMain.handle(CLEANUP_CHANNELS.DISMISS, async (_event, groupIds: string[]) => {
    store.dismiss(groupIds.filter((id) => typeof id === 'string'))
  })

  ipcMain.handle(CLEANUP_CHANNELS.TRASH, async (event, hashes: string[]): Promise<TrashResult> => {
    const targets = store.trashTargets(hashes.filter((h) => typeof h === 'string'))
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
    onLibraryChanged()
    return { cancelled: false, trashed, failed }
  })

  return store
}
