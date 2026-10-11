import { useState, useEffect, useCallback } from 'react'
import { folderName, revealLabel } from '../../lib/platform'
import type { WatchedFolder } from '../../../../shared/types'
import type { InboxInfo } from '../../../../shared/collect'
import { t } from '../../../../shared/i18n'

/** 设置 › 文件夹：收集箱位置 + 监视的文件夹列表，添加 / 移除（移除前确认） */
export function FolderSettings(): JSX.Element {
  const [folders, setFolders] = useState<WatchedFolder[]>([])
  const [inbox, setInbox] = useState<InboxInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<{ folder: WatchedFolder; isOpen: boolean } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // 主窗口那边（侧边栏 +、空状态按钮）也能加文件夹：靠主进程广播保持同步
  useEffect(() => {
    const load = (): void => {
      window.api.getFolders().then((data) => {
        setFolders(data)
        setIsLoading(false)
      })
      window.api.collect.getInbox().then(setInbox).catch(() => {})
    }
    load()
    return window.api.onLibraryChanged(load)
  }, [])

  // 更改位置只是换登记（不移动已有文件，文案里说明）；旧收集箱保留为普通文件夹
  const handleChangeInbox = useCallback(async () => {
    setInbox(await window.api.collect.chooseInbox())
  }, [])

  const handleAddFolder = useCallback(async () => {
    const path = await window.api.selectFolder()
    if (path) await window.api.addFolder(path)
  }, [])

  const handleRequestRemove = useCallback((folder: WatchedFolder) => {
    setDeleteConfirm({ folder, isOpen: true })
  }, [])

  const handleConfirmRemove = useCallback(async () => {
    if (!deleteConfirm) return
    setIsDeleting(true)
    try {
      await window.api.removeFolder(deleteConfirm.folder.id)
      setDeleteConfirm(null)
    } finally {
      setIsDeleting(false)
    }
  }, [deleteConfirm])

  const handleCancelRemove = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  const getFolderName = (path: string): string => {
    return folderName(path)
  }

  return (
    <>
      <div className="p-5 pb-0" data-inbox-settings>
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-fill">
          <svg className="w-4 h-4 text-accent/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-callout font-medium text-ink">{t.collect.inboxLocation}</p>
            <div className="flex items-center gap-1.5 text-micro text-ink-4">
              <span className="truncate">{inbox?.path ?? '…'}</span>
              {inbox && !inbox.exists && (
                <>
                  <span>·</span>
                  <span className="flex-shrink-0">{t.collect.inboxNotCreated}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={handleChangeInbox}
            className="flex-shrink-0 h-6 px-2 rounded-md bg-fill-hover hover:bg-fill-active text-ink-2 hover:text-ink text-caption transition-colors"
          >
            {t.collect.change}
          </button>
          <button
            onClick={() => { void window.api.collect.openInbox() }}
            className="flex-shrink-0 h-6 px-2 rounded-md bg-fill-hover hover:bg-fill-active text-ink-2 hover:text-ink text-caption transition-colors"
          >
            {revealLabel}
          </button>
        </div>
        <p className="mt-1.5 px-0.5 text-micro text-ink-4">{t.collect.inboxNote}</p>
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <svg className="w-6 h-6 text-ink-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : folders.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-ink-3 text-body mb-1">{t.settings.noFolders}</p>
            <p className="text-ink-4 text-callout">{t.settings.noFoldersHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-fill hover:bg-fill-hover transition-colors"
              >
                <svg className="w-4 h-4 text-accent/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-callout font-medium text-ink truncate">
                    {folder.isInbox ? `${getFolderName(folder.path)} · ${t.collect.inbox}` : getFolderName(folder.path)}
                  </p>
                  <div className="flex items-center gap-1.5 text-micro text-ink-4">
                    <span className="truncate">{folder.path}</span>
                    {folder.photoCount !== undefined && folder.photoCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex-shrink-0">{t.common.items(folder.photoCount)}</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRequestRemove(folder)}
                  className="p-1 rounded hover:bg-fill-hover transition-colors text-ink-4 hover:text-bad"
                  title={t.common.remove}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pb-5">
        <button
          onClick={handleAddFolder}
          className="w-full py-2 px-3 bg-fill-hover hover:bg-fill-active text-ink text-callout rounded-md transition-colors flex items-center justify-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          {t.settings.addFolder}
        </button>
      </div>

    {/* 删除确认对话框 */}
    {deleteConfirm?.isOpen && (
      <div
        className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 modal-overlay" style={{ zIndex: 950 }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isDeleting) {
            handleCancelRemove()
          }
        }}
      >
        <div className="bg-raised rounded-xl shadow-2xl max-w-sm w-full p-5 border border-line-strong">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-full bg-bad/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-bad" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-body font-semibold text-ink">
              {t.settings.removeFolderTitle}
            </h3>
          </div>

          <div className="mb-5 space-y-2.5">
            <p className="text-callout text-ink-2">
              {t.settings.removeFolderAskBefore}<span className="font-medium text-ink">"{getFolderName(deleteConfirm.folder.path)}"</span>{t.settings.removeFolderAskAfter}
            </p>

            {deleteConfirm.folder.photoCount !== undefined && deleteConfirm.folder.photoCount > 0 && (
              <div className="p-2.5 bg-warn/10 rounded-lg">
                <p className="text-callout text-warn/80">
                  {t.settings.removeFolderCountBefore}<span className="font-semibold">{deleteConfirm.folder.photoCount.toLocaleString()}</span>{t.settings.removeFolderCountAfter}
                </p>
              </div>
            )}

            <p className="text-micro text-ink-4">
              {t.settings.removeFolderNote}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCancelRemove}
              disabled={isDeleting}
              className="flex-1 py-2 px-3 bg-fill-hover hover:bg-fill-active text-ink-2 text-callout rounded-md transition-colors disabled:opacity-50"
            >
              {t.common.cancel}
            </button>
            <button
              onClick={handleConfirmRemove}
              disabled={isDeleting}
              className="flex-1 py-2 px-3 bg-bad/20 hover:bg-bad/30 text-bad text-callout rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isDeleting ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t.settings.removing}
                </>
              ) : (
                t.settings.confirmRemove
              )}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
