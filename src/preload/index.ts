import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type MediaFilters, type SmartAlbum, type SmartAlbumMenuAction, type SearchResult, type WatchedFolder, type PhotoDetail, type PhotoLocation, type IndexProgress, type ModelStatus, type EmbeddingConfig, type Person, type FaceRecord, type BackupStatus, type MediaKind, type TaskOverview, type MediaDetail, type LibraryCounts, type MenuCommand, type ItemMenuAction, type ThemeMode, type PersonSuggestion, type PersonFace } from '../shared/types'
import type { Locale, LocaleSetting } from '../shared/i18n'
import { CLEANUP_CHANNELS, type DupScanResult, type DupScanProgress, type HiddenItem, type TrashResult } from '../shared/cleanup'
import { TAG_CHANNELS, type EagleItemInfo, type Tag, type TagMenuAction, type TagsForSelection } from '../shared/tags'

const api = {
  // 搜索
  search: (query: string, limit?: number, options?: { dateFrom?: string; dateTo?: string; kind?: MediaKind; folderId?: number }): Promise<SearchResult[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SEARCH, query, limit, options)
  },
  findSimilar: (photoId: number, limit?: number): Promise<SearchResult[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.FIND_SIMILAR, photoId, limit)
  },
  getPhotosWithGPS: (): Promise<import('../shared/types').Photo[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PHOTOS_WITH_GPS)
  },

  // 文件夹管理
  selectFolder: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER)
  },
  addFolder: (path: string): Promise<WatchedFolder> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ADD_FOLDER, path)
  },
  removeFolder: (id: number): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FOLDER, id)
  },
  getFolders: (): Promise<WatchedFolder[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FOLDERS)
  },
  getLibraryCounts: (): Promise<LibraryCounts> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_LIBRARY_COUNTS)
  },
  /** 原生菜单命令（快捷键都挂在菜单上） */
  openSettings: (): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_SETTINGS)
  },
  /** 文件夹增删（任意窗口发起）后主进程广播 */
  onLibraryChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.LIBRARY_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LIBRARY_CHANGED, handler)
    }
  },
  onMenuCommand: (callback: (cmd: MenuCommand) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, cmd: MenuCommand): void => callback(cmd)
    ipcRenderer.on(IPC_CHANNELS.MENU_COMMAND, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MENU_COMMAND, handler)
    }
  },
  /** 弹出原生右键菜单，resolve 为选中的动作；菜单关闭未选则为 null */
  showItemMenu: (opts: { count: number; isMedia: boolean; favorite: boolean }): Promise<ItemMenuAction | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_ITEM_MENU, opts)
  },
  /** 收藏 / 取消收藏（按内容 hash，同内容的副本一起变） */
  setFavorite: (fileHashes: string[], on: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_FAVORITE, fileHashes, on)
  },
  // 智能相册
  getSmartAlbums: (): Promise<SmartAlbum[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_SMART_ALBUMS)
  },
  createSmartAlbum: (album: { name: string; query: string; filters: MediaFilters }): Promise<SmartAlbum> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CREATE_SMART_ALBUM, album)
  },
  updateSmartAlbum: (id: number, patch: { name?: string; query?: string; filters?: MediaFilters }): Promise<SmartAlbum | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SMART_ALBUM, id, patch)
  },
  deleteSmartAlbum: (id: number): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DELETE_SMART_ALBUM, id)
  },
  reorderSmartAlbums: (ids: number[]): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REORDER_SMART_ALBUMS, ids)
  },
  /** 右键菜单；选"删除"时主进程已确认过 */
  showSmartAlbumMenu: (name: string): Promise<SmartAlbumMenuAction | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_SMART_ALBUM_MENU, name)
  },
  onSmartAlbumsChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.SMART_ALBUMS_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SMART_ALBUMS_CHANGED, handler)
    }
  },
  getFolderStats: (id: number): Promise<{ photoCount: number; photoIds: number[] }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_FOLDER_STATS, id)
  },

  // 照片
  getPhotoDetail: (id: number): Promise<PhotoDetail> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PHOTO_DETAIL, id)
  },
  getThumbnail: (id: number): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_THUMBNAIL, id)
  },
  showInFinder: (filePath: string): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SHOW_IN_FINDER, filePath)
  },
  getPhotoLocations: (photoId: number): Promise<PhotoLocation[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PHOTO_LOCATIONS, photoId)
  },

  // 进度
  onIndexProgress: (callback: (progress: IndexProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: IndexProgress): void => {
      callback(progress)
    }
    ipcRenderer.on(IPC_CHANNELS.INDEX_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.INDEX_PROGRESS, handler)
    }
  },

  /** 当前界面语言（已按设置 / 系统解析），渲染前同步取 */
  locale: ipcRenderer.sendSync(IPC_CHANNELS.GET_LOCALE_SYNC) as Locale,
  getLocaleSetting: (): Promise<LocaleSetting> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_LOCALE_SETTING)
  },
  /** 保存后主进程会 reload 所有窗口 */
  setLocaleSetting: (setting: LocaleSetting): Promise<LocaleSetting> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_LOCALE_SETTING, setting)
  },

  getTheme: (): Promise<ThemeMode> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_THEME)
  },
  setTheme: (mode: ThemeMode): Promise<ThemeMode> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_THEME, mode)
  },

  getIndexPaused: (): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_INDEX_PAUSED)
  },
  setIndexPaused: (paused: boolean): Promise<boolean> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_INDEX_PAUSED, paused)
  },
  getTaskOverview: (): Promise<TaskOverview> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_TASK_OVERVIEW)
  },
  retryFailedTasks: (ids?: number[]): Promise<number> => {
    return ipcRenderer.invoke(IPC_CHANNELS.RETRY_FAILED_TASKS, ids)
  },
  clearFailedTasks: (): Promise<number> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CLEAR_FAILED_TASKS)
  },
  getMediaDetail: (videoId: number): Promise<MediaDetail | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MEDIA_DETAIL, videoId)
  },

  // 系统 / 模型状态
  getAppPath: (): Promise<string> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_APP_PATH)
  },
  getModelStatus: (): Promise<ModelStatus> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_MODEL_STATUS)
  },

  // Embedding 配置（EmbeddingGemma 2 量化档位 / 推理设备）
  getEmbeddingConfig: (): Promise<EmbeddingConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_EMBEDDING_CONFIG)
  },
  /** 改量化档位；provider 会在下次 encode 时按新档位重新加载 */
  setEmbeddingConfig: (config: EmbeddingConfig): Promise<{ success: boolean; ready?: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_EMBEDDING_CONFIG, config)
  },

  // Caption（手动编辑）
  updateCaption: (photoId: number, text: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CAPTION, photoId, text)
  },

  // OCR
  startOcrScan: (): Promise<{ queued?: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.START_OCR_SCAN)
  },

  // 打开视频源
  openSourceVideo: (videoId: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.OPEN_SOURCE_VIDEO, videoId)
  },

  // 备份
  triggerBackup: (): Promise<{ success: boolean; path?: string; sizeBytes?: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.TRIGGER_BACKUP)
  },
  getBackupStatus: (): Promise<BackupStatus> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_BACKUP_STATUS)
  },

  // 人脸识别
  startFaceScan: (): Promise<{ queued?: number; error?: string }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.START_FACE_SCAN)
  },
  getPeople: (): Promise<Person[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PEOPLE)
  },
  getPersonPhotos: (personId: number, limit?: number): Promise<SearchResult[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PERSON_PHOTOS, personId, limit)
  },
  setPersonName: (personId: number, name: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_PERSON_NAME, personId, name)
  },
  mergePeople: (targetId: number, sourceIds: number[]): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.MERGE_PEOPLE, targetId, sourceIds)
  },
  getPhotoFaces: (photoId: number): Promise<FaceRecord[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PHOTO_FACES, photoId)
  },
  getPersonSuggestions: (): Promise<PersonSuggestion[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PERSON_SUGGESTIONS)
  },
  dismissPersonSuggestion: (a: number, b: number): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DISMISS_PERSON_SUGGESTION, a, b)
  },
  getPersonFaces: (personId: number, limit?: number): Promise<PersonFace[]> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_PERSON_FACES, personId, limit)
  },
  rejectFace: (faceId: number): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.REJECT_FACE, faceId)
  },
  assignFace: (faceId: number, personId: number): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.ASSIGN_FACE, faceId, personId)
  },
  setPersonHidden: (personId: number, hidden: boolean): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke(IPC_CHANNELS.SET_PERSON_HIDDEN, personId, hidden)
  },
  onPeopleChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.PEOPLE_CHANGED, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.PEOPLE_CHANGED, handler) }
  },

  // 清理相似照片（近重复）
  cleanup: {
    scan: (): Promise<DupScanResult> => ipcRenderer.invoke(CLEANUP_CHANNELS.SCAN),
    onProgress: (callback: (p: DupScanProgress) => void): (() => void) => {
      const handler = (_: unknown, p: DupScanProgress): void => callback(p)
      ipcRenderer.on(CLEANUP_CHANNELS.PROGRESS, handler)
      return () => { ipcRenderer.removeListener(CLEANUP_CHANNELS.PROGRESS, handler) }
    },
    hide: (hashes: string[]): Promise<void> => ipcRenderer.invoke(CLEANUP_CHANNELS.HIDE, hashes),
    unhide: (hashes: string[]): Promise<void> => ipcRenderer.invoke(CLEANUP_CHANNELS.UNHIDE, hashes),
    listHidden: (): Promise<HiddenItem[]> => ipcRenderer.invoke(CLEANUP_CHANNELS.LIST_HIDDEN),
    /** 记住"不是重复"：之后扫描不再列出这些组 */
    dismiss: (groupIds: string[]): Promise<void> => ipcRenderer.invoke(CLEANUP_CHANNELS.DISMISS, groupIds),
    /** 主进程会先弹原生确认框；用户取消时 cancelled = true */
    trash: (hashes: string[]): Promise<TrashResult> => ipcRenderer.invoke(CLEANUP_CHANNELS.TRASH, hashes),
  },

  // 标签（按内容 hash）
  tags: {
    list: (): Promise<Tag[]> => ipcRenderer.invoke(TAG_CHANNELS.LIST),
    forHashes: (hashes: string[]): Promise<TagsForSelection> => ipcRenderer.invoke(TAG_CHANNELS.FOR_HASHES, hashes),
    /** 名字不存在就新建；返回标签 id */
    add: (hashes: string[], name: string): Promise<number | null> => ipcRenderer.invoke(TAG_CHANNELS.ADD, hashes, name),
    remove: (hashes: string[], tagId: number): Promise<void> => ipcRenderer.invoke(TAG_CHANNELS.REMOVE, hashes, tagId),
    /** 和已有标签重名就合并过去；返回最终的标签 id */
    rename: (tagId: number, name: string): Promise<number | null> => ipcRenderer.invoke(TAG_CHANNELS.RENAME, tagId, name),
    /** 侧栏右键菜单：合并 / 删除在主进程执行完才返回；'rename' 由调用方进入行内编辑 */
    showMenu: (tagId: number): Promise<TagMenuAction | null> => ipcRenderer.invoke(TAG_CHANNELS.SHOW_MENU, tagId),
    onChanged: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(TAG_CHANNELS.CHANGED, handler)
      return () => { ipcRenderer.removeListener(TAG_CHANNELS.CHANGED, handler) }
    },
  },

  // Eagle 资源库（只读）
  eagle: {
    info: (fileHash: string): Promise<EagleItemInfo | null> => ipcRenderer.invoke(TAG_CHANNELS.EAGLE_INFO, fileHash),
    /** 来源链接：只在用户点击时由主进程用系统浏览器打开 */
    openUrl: (url: string): Promise<boolean> => ipcRenderer.invoke(TAG_CHANNELS.OPEN_URL, url),
    addLibrary: (): Promise<WatchedFolder | null> => ipcRenderer.invoke(TAG_CHANNELS.ADD_EAGLE_LIBRARY),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
