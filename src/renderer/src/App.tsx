import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { PhotoGrid } from './components/PhotoGrid'
import type { GridDensity } from './components/media/MediaCard'
import { PhotoDetail } from './components/PhotoDetail'
import { MapView } from './components/MapView'
import { PeopleView } from './components/PeopleView'
import { CleanupView } from './components/cleanup/CleanupView'
import { TaskDrawer } from './components/tasks/TaskDrawer'
import { QuickLook } from './components/QuickLook'
import { Inspector, SelectionSummary } from './components/inspector/Inspector'
import { Sidebar, LIBRARY_ITEMS, SIDEBAR_MIN, SIDEBAR_MAX, folderName, type Source } from './components/shell/Sidebar'
import { Toolbar } from './components/shell/Toolbar'
import { StatusBar, THUMB_MIN, THUMB_MAX } from './components/shell/StatusBar'
import { Icon } from './components/shell/icons'
import { countLine, mediaKindOf } from './lib/format'
import { useSearchHistory, normalizeQuery } from './lib/searchHistory'
import { t } from '../../shared/i18n'
import { FilterBar, hasExtraFilters, countExtraFilters, describeExtraFilters, type ExtraFilters } from './components/shell/FilterBar'
import { useSmartAlbums, sameAlbumState, splitAlbumFilters } from './lib/smartAlbums'
import type {
  SearchResult, Photo, LibraryCounts, WatchedFolder, MenuCommand, ItemMenuAction, MediaFilters, SmartAlbum,
  IndexProgress as IndexProgressType,
} from '../../shared/types'

/** 空查询浏览时一次取够整个资料库（网格是虚拟化的，渲染成本与总数无关） */
const BROWSE_LIMIT = 20000
/** "查找相似内容"一次取多少 */
const SIMILAR_LIMIT = 60
/** 窗口窄于此宽度时检查器改为浮在网格上，不再挤占网格宽度 */
const INSPECTOR_DOCK_MIN_WINDOW = 1100
const INSPECTOR_WIDTH = 272

function isTextInput(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/** 源文件路径：音视频的 photo 行是代表图，真实路径要从 MediaDetail 取 */
async function sourcePathOf(r: SearchResult): Promise<string | null> {
  if (mediaKindOf(r.photo) !== 'image' && r.photo.videoId != null) {
    return (await window.api.getMediaDetail(r.photo.videoId))?.filePath ?? null
  }
  return r.photo.filePath
}

// 外壳偏好只存本机，读写失败（隐私模式 / 被清空）时回落默认值
function loadPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return v >= min && v <= max ? v : fallback
  } catch {
    return fallback
  }
}
// 写入防抖：拖侧栏 / 缩略图滑块每帧都会调，合并成停稳后一次同步写
const prefTimers = new Map<string, ReturnType<typeof setTimeout>>()
function savePref(key: string, value: string): void {
  const prev = prefTimers.get(key)
  if (prev) clearTimeout(prev)
  prefTimers.set(key, setTimeout(() => {
    prefTimers.delete(key)
    try { localStorage.setItem(key, value) } catch { /* 忽略 */ }
  }, 300))
}

function App(): JSX.Element {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [indexProgress, setIndexProgress] = useState<IndexProgressType | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showDateFilter, setShowDateFilter] = useState(false)
  // 方向 / 分辨率 / 时长 / 人物 / 仅收藏；换查询、换来源都保留（和日期一样）
  const [extraFilters, setExtraFilters] = useState<ExtraFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [source, setSource] = useState<Source>({ type: 'library', kind: 'all' })
  const [counts, setCounts] = useState<LibraryCounts | null>(null)
  const [folders, setFolders] = useState<WatchedFolder[]>([])
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem('shell.sidebarHidden') === '1' } catch { return false }
  })
  const [sidebarWidth, setSidebarWidth] = useState(() => loadPref('shell.sidebarWidth', 232, SIDEBAR_MIN, SIDEBAR_MAX))
  const [thumbSize, setThumbSize] = useState(() => loadPref('shell.thumbSize', 200, THUMB_MIN, THUMB_MAX))
  // 选择按 photo.id 记，索引进度刷新结果列表时不会丢
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [focusId, setFocusId] = useState<number | null>(null)
  const anchorId = useRef<number | null>(null)
  const cols = useRef(4)
  const rowsPerPage = useRef(4)
  const [quickLookId, setQuickLookId] = useState<number | null>(null)
  // 新搜索 / 换来源时 +1，驱动网格滚回顶部
  const [scrollResetKey, setScrollResetKey] = useState(0)
  // 检查器跟随选择出现：inspectorAuto 是 ⌘I 切换的长期偏好（选中时是否自动弹出），
  // inspectorDismissed 是点 × 的一次性收起，下次点选项目时复位
  const [inspectorAuto, setInspectorAuto] = useState(() => {
    try { return localStorage.getItem('shell.inspector') !== '0' } catch { return true }
  })
  const [inspectorDismissed, setInspectorDismissed] = useState(false)
  const [narrow, setNarrow] = useState(() => window.innerWidth < INSPECTOR_DOCK_MIN_WINDOW)

  const hasSearchQuery = !!query.trim()
  // 信息密度：浏览默认沉浸式，搜索结果默认信息式；按 G 临时翻转，换查询 / 来源后回到默认
  const [densityOverride, setDensityOverride] = useState<GridDensity | null>(null)
  const density: GridDensity = densityOverride ?? (hasSearchQuery ? 'info' : 'immersive')
  const toggleDensity = useCallback(() => {
    setDensityOverride(density === 'info' ? 'immersive' : 'info')
  }, [density])
  // 来源按内容签名比较：重复点击同一侧栏项（对象引用变了）不应重置密度
  const sourceKey = source.type === 'library' ? `library:${source.kind}`
    : source.type === 'folder' ? `folder:${source.id}`
    : source.type === 'similar' ? `similar:${source.photoId}`
    : source.type === 'album' ? `album:${source.id}`
    : source.type
  useEffect(() => { setDensityOverride(null) }, [query, sourceKey])
  const isGrid = source.type === 'library' || source.type === 'folder' || source.type === 'similar' || source.type === 'favorites' || source.type === 'album'

  // 查询条件放 ref：索引进度刷新等所有 doSearch 调用都自动带上当前来源 + 日期，
  // 不用每个调用点各自传参，也不会因闭包拿到旧值
  const filters = useRef<{ query: string; from: string; to: string; source: Source; extra: ExtraFilters }>({ query: '', from: '', to: '', source, extra: {} })

  // 智能相册：doSearch 从 ref 取相册的来源范围（类型 / 文件夹）
  const { albums, upsert: upsertAlbum } = useSmartAlbums()
  const albumsRef = useRef<SmartAlbum[]>(albums)
  albumsRef.current = albums

  const doSearch = useCallback(async (): Promise<SearchResult[]> => {
    const { query: q, from, to, source: src, extra } = filters.current
    if (src.type === 'similar') return window.api.findSimilar(src.photoId, SIMILAR_LIMIT)
    const album = src.type === 'album' ? albumsRef.current.find((a) => a.id === src.id) : undefined
    const scope = album ? splitAlbumFilters(album.filters).scope : {}
    const kind = src.type === 'library' && src.kind !== 'all' ? src.kind : scope.kind
    const folderId = src.type === 'folder' ? src.id : scope.folderId
    const options: MediaFilters = {
      ...extra,
      ...(from ? { dateFrom: from } : {}),
      ...(to ? { dateTo: to } : {}),
      ...(kind ? { kind } : {}),
      ...(folderId != null ? { folderId } : {}),
      ...(src.type === 'favorites' ? { favorite: true } : {}),
    }
    return window.api.search(q, q.trim() ? undefined : BROWSE_LIMIT, Object.keys(options).length ? options : undefined)
  }, [])

  const runSearch = useCallback(async () => {
    setIsSearching(true)
    try {
      setSearchResults(await doSearch())
    } catch (error) {
      console.error('Search error:', error)
    } finally {
      setIsSearching(false)
    }
  }, [doSearch])

  const refreshLibrary = useCallback(async () => {
    const [c, f] = await Promise.all([window.api.getLibraryCounts(), window.api.getFolders()])
    setCounts(c)
    setFolders(f)
    return f
  }, [])

  // 初始加载
  useEffect(() => {
    // 没有文件夹时空状态自带"添加文件夹…"，不再自动弹设置
    refreshLibrary().then((f) => { if (f.length > 0) runSearch() })
  }, [refreshLibrary, runSearch])

  // 索引进度：照片数变化时节流刷新计数和（无查询时的）网格。
  // 2 万条结果重拉不便宜，节流 ≥5s，且用户正在滚动时先推迟，别打断浏览
  const scrollActivityAt = useRef(0)
  const handleUserScroll = useCallback(() => { scrollActivityAt.current = Date.now() }, [])
  useEffect(() => {
    let last = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = (): void => {
      if (Date.now() - scrollActivityAt.current < 2000) {
        timer = setTimeout(refresh, 2000)
        return
      }
      timer = null
      refreshLibrary()
      if (!filters.current.query.trim() && filters.current.source.type !== 'map' && filters.current.source.type !== 'people' && filters.current.source.type !== 'cleanup') {
        doSearch().then(setSearchResults).catch(() => {})
      }
    }
    let modelReady = false
    const unsubscribe = window.api.onIndexProgress((progress) => {
      setIndexProgress(progress)
      // 模型加载完成前发出的查询只有文件名 / OCR 命中；就绪时重跑一次，补上语义结果
      if (!modelReady && progress.aiModelReady && filters.current.query.trim()) {
        doSearch().then(setSearchResults).catch(() => {})
      }
      modelReady = progress.aiModelReady
      const sig = `${progress.totalPhotos}/${progress.thumbnailedPhotos}/${progress.indexedPhotos}/${progress.ocrPhotos || 0}`
      if (sig === last) return
      last = sig
      if (timer) return
      timer = setTimeout(refresh, 5000)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [doSearch, refreshLibrary])

  /** 打开智能相册：整套换成相册保存的查询 + 日期 + 筛选条件，再重新搜索（所以内容总是最新的） */
  const openAlbum = useCallback((album: SmartAlbum) => {
    const { dateFrom: from, dateTo: to, extra } = splitAlbumFilters(album.filters)
    const next: Source = { type: 'album', id: album.id }
    setSource(next)
    setQuery(album.query)
    setDateFrom(from)
    setDateTo(to)
    setExtraFilters(extra)
    if (from || to) setShowDateFilter(true)
    filters.current = { query: album.query, from, to, extra, source: next }
    setSelectedIds(new Set())
    setFocusId(null)
    anchorId.current = null
    setScrollResetKey((k) => k + 1)
    runSearch()
  }, [runSearch])

  const handleSelectSource = useCallback((next: Source) => {
    if (next.type === 'album') {
      const album = albumsRef.current.find((a) => a.id === next.id)
      if (album) openAlbum(album)
      return
    }
    setSource(next)
    filters.current = { ...filters.current, source: next }
    setSelectedIds(new Set())
    setFocusId(null)
    anchorId.current = null
    setScrollResetKey((k) => k + 1)
    if (next.type === 'library' || next.type === 'folder' || next.type === 'similar' || next.type === 'favorites') runSearch()
  }, [runSearch, openAlbum])

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
    filters.current = { ...filters.current, query: q }
    // 新查询：选择 / 焦点都是上一个结果集的，清掉并滚回顶部
    setSelectedIds(new Set())
    setFocusId(null)
    anchorId.current = null
    setScrollResetKey((k) => k + 1)
    // 在地图 / 人物 / 相似里输入查询：回到当前资料库
    const t = filters.current.source.type
    if (q.trim() && (t === 'map' || t === 'people' || t === 'similar' || t === 'cleanup')) {
      const back: Source = { type: 'library', kind: 'all' }
      setSource(back)
      filters.current.source = back
    }
    runSearch()
  }, [runSearch])

  // 搜索历史：查询停稳 1.5 秒且有结果才记为"最近"，边打字边出的中间结果不算
  const history = useSearchHistory()
  const { addRecent, removeRecent } = history
  useEffect(() => {
    if (!query.trim() || isSearching || searchResults.length === 0) return
    const t = setTimeout(() => addRecent(query), 1500)
    return () => clearTimeout(t)
  }, [query, isSearching, searchResults, addRecent])
  const activeQuery = isGrid && hasSearchQuery ? normalizeQuery(query) : null

  // ---------- 智能相册 ----------
  // 当前界面上的全部条件（来源范围 + 日期 + 筛选），保存 / 比较相册都用它
  const currentAlbum = source.type === 'album' ? albums.find((a) => a.id === source.id) : undefined
  const stateFilters: MediaFilters = {
    ...extraFilters,
    ...(source.type === 'favorites' ? { favorite: true } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(source.type === 'album' ? (currentAlbum ? splitAlbumFilters(currentAlbum.filters).scope : {})
      : source.type === 'library' && source.kind !== 'all' ? { kind: source.kind }
      : source.type === 'folder' ? { folderId: source.id }
      : {}),
  }
  // 和当前条件完全一致的相册：搜索框的 ☆ 实心，点它直接打开而不是重复保存
  const matchingAlbum = currentAlbum && sameAlbumState(currentAlbum, query, stateFilters)
    ? currentAlbum
    : albums.find((a) => sameAlbumState(a, query, stateFilters))
  // 在相册里改了查询 / 筛选：不自动写回，标题旁给"更新相册"
  const albumDirty = !!currentAlbum && !sameAlbumState(currentAlbum, query, stateFilters)
  const canSaveAlbum = isGrid && source.type !== 'similar' && (!!query.trim() || Object.keys(stateFilters).length > 0)
  const albumState = useRef({ query, stateFilters, matchingAlbum, folders })
  albumState.current = { query, stateFilters, matchingAlbum, folders }

  /** 没有查询词时的默认名：竖向 · ≥ 4K · 收藏 */
  const describeFilters = useCallback(async (f: MediaFilters): Promise<string> => {
    const { dateFrom: from, dateTo: to, scope, extra } = splitAlbumFilters(f)
    const person = extra.personId != null ? (await window.api.getPeople()).find((p) => p.id === extra.personId) : undefined
    const folder = scope.folderId != null ? albumState.current.folders.find((x) => x.id === scope.folderId) : undefined
    const labels = [
      ...(scope.kind ? [LIBRARY_ITEMS.find((i) => i.kind === scope.kind)?.label ?? scope.kind] : []),
      ...(folder ? [folderName(folder.path)] : []),
      ...describeExtraFilters(extra, person?.name ?? undefined),
      ...(from || to ? [t.albums.dateRange(from, to)] : []),
    ]
    return labels.join(t.common.sep) || t.albums.untitled
  }, [])

  const saveCurrentAsAlbum = useCallback(async () => {
    const { query: q, stateFilters: f, matchingAlbum: existing } = albumState.current
    if (existing) { handleSelectSource({ type: 'album', id: existing.id }); return }
    const cleanQuery = normalizeQuery(q)
    const album = await window.api.createSmartAlbum({ name: cleanQuery || await describeFilters(f), query: cleanQuery, filters: f })
    upsertAlbum(album)
    albumsRef.current = [...albumsRef.current.filter((a) => a.id !== album.id), album]
    openAlbum(album)
  }, [describeFilters, upsertAlbum, openAlbum, handleSelectSource])

  const updateAlbumWithCurrent = useCallback(async (id: number) => {
    const { query: q, stateFilters: f } = albumState.current
    const updated = await window.api.updateSmartAlbum(id, { query: normalizeQuery(q), filters: f })
    if (updated) upsertAlbum(updated)
  }, [upsertAlbum])

  const handleRenameAlbum = useCallback(async (id: number, name: string) => {
    const updated = await window.api.updateSmartAlbum(id, { name })
    if (updated) upsertAlbum(updated)
  }, [upsertAlbum])

  const handleAlbumMenu = useCallback(async (album: SmartAlbum) => {
    const action = await window.api.showSmartAlbumMenu(album.name)
    if (action === 'update') await updateAlbumWithCurrent(album.id)
    else if (action === 'delete') {
      await window.api.deleteSmartAlbum(album.id)
      const src = filters.current.source
      if (src.type === 'album' && src.id === album.id) handleSelectSource({ type: 'library', kind: 'all' })
    }
    return action
  }, [updateAlbumWithCurrent, handleSelectSource])

  // 当前打开的相册在别的窗口被删了：回到全部
  useEffect(() => {
    if (source.type === 'album' && !albums.some((a) => a.id === source.id)) {
      const timer = setTimeout(() => {
        const src = filters.current.source
        if (src.type === 'album' && !albumsRef.current.some((a) => a.id === src.id)) handleSelectSource({ type: 'library', kind: 'all' })
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [albums, source, handleSelectSource])

  const handleExtraFiltersChange = useCallback((next: ExtraFilters) => {
    setExtraFilters(next)
    filters.current = { ...filters.current, extra: next }
    runSearch()
  }, [runSearch])

  const handleDateFilterChange = useCallback((from: string, to: string) => {
    setDateFrom(from)
    setDateTo(to)
    filters.current = { ...filters.current, from, to }
    runSearch()
  }, [runSearch])

  const handleAddFolder = useCallback(async () => {
    const path = await window.api.selectFolder()
    if (!path) return
    const folder = await window.api.addFolder(path)
    await refreshLibrary()
    handleSelectSource({ type: 'folder', id: folder.id })
  }, [refreshLibrary, handleSelectSource])

  const toggleSidebar = useCallback(() => {
    setSidebarHidden((h) => {
      savePref('shell.sidebarHidden', h ? '0' : '1')
      return !h
    })
  }, [])

  const handleSidebarResize = useCallback((w: number) => {
    setSidebarWidth(w)
    savePref('shell.sidebarWidth', String(w))
  }, [])

  const handleThumbSize = useCallback((size: number) => {
    const clamped = Math.min(THUMB_MAX, Math.max(THUMB_MIN, size))
    setThumbSize(clamped)
    savePref('shell.thumbSize', String(clamped))
  }, [])

  // 地图 / 人物视图只给 Photo，没有搜索上下文
  const handleSelectPhoto = useCallback((photo: Photo) => setSelected({ photo, score: 0 }), [])
  const handleCloseDetail = useCallback(() => setSelected(null), [])
  const handleCloseTasks = useCallback(() => setShowTasks(false), [])

  // ---------- 选择 ----------
  const idIndex = useMemo(() => new Map(searchResults.map((r, i) => [r.photo.id, i])), [searchResults])
  const focusIndex = focusId != null ? idIndex.get(focusId) ?? -1 : -1
  const selectedResults = useMemo(
    () => (selectedIds.size === 0 ? [] : searchResults.filter((r) => selectedIds.has(r.photo.id))),
    [searchResults, selectedIds]
  )
  // 网格回调要稳定（MediaCard 是 memo 的），最新状态从 ref 读
  const live = useRef({ searchResults, selectedIds, idIndex, focusIndex })
  live.current = { searchResults, selectedIds, idIndex, focusIndex }

  const selectOnly = useCallback((id: number) => {
    setSelectedIds(new Set([id]))
    setFocusId(id)
    anchorId.current = id
  }, [])

  // 打开详情（详情页 ← → 翻页、检查器里点相似内容都走这里）；在当前列表里的同步成选择
  const handleSelect = useCallback((result: SearchResult) => {
    setSelected(result)
    if (live.current.idIndex.has(result.photo.id)) selectOnly(result.photo.id)
  }, [selectOnly])

  const handleItemClick = useCallback((index: number, e: React.MouseEvent) => {
    const { searchResults: rs, selectedIds: cur, idIndex: map } = live.current
    const id = rs[index]?.photo.id
    if (id == null) return
    // 点选项目即表示想看信息：撤销上次 × 收起
    setInspectorDismissed(false)
    if (e.shiftKey && anchorId.current != null) {
      // ⇧：锚点到当前的连续范围；⌘⇧ 在已有选择上追加
      const a = map.get(anchorId.current) ?? index
      const [lo, hi] = a < index ? [a, index] : [index, a]
      const next = new Set(e.metaKey ? cur : [])
      for (let i = lo; i <= hi; i++) next.add(rs[i].photo.id)
      setSelectedIds(next)
      setFocusId(id)
    } else if (e.metaKey) {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelectedIds(next)
      setFocusId(id)
      anchorId.current = id
    } else {
      selectOnly(id)
    }
  }, [selectOnly])

  const handleItemOpen = useCallback((index: number) => {
    const r = live.current.searchResults[index]
    if (!r) return
    selectOnly(r.photo.id)
    setQuickLookId(null)
    setSelected(r)
  }, [selectOnly])

  /** 方向键 / Home / End / PageUp / PageDown 移动焦点；extend = ⇧ 从锚点扩展选择 */
  const moveFocus = useCallback((key: string, extend: boolean) => {
    const { searchResults: rs, focusIndex: fi, idIndex: map } = live.current
    if (rs.length === 0) return
    let next: number
    if (key === 'Home') next = 0
    else if (key === 'End') next = rs.length - 1
    else {
      const page = cols.current * rowsPerPage.current
      const step = key === 'ArrowLeft' ? -1
        : key === 'ArrowRight' ? 1
        : key === 'ArrowUp' ? -cols.current
        : key === 'ArrowDown' ? cols.current
        : key === 'PageUp' ? -page : page
      next = fi < 0 ? 0 : Math.min(rs.length - 1, Math.max(0, fi + step))
    }
    const id = rs[next].photo.id
    if (extend && anchorId.current != null) {
      const a = map.get(anchorId.current) ?? next
      const [lo, hi] = a < next ? [a, next] : [next, a]
      setSelectedIds(new Set(rs.slice(lo, hi + 1).map((r) => r.photo.id)))
      setFocusId(id)
    } else {
      selectOnly(id)
    }
  }, [selectOnly])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setFocusId(null)
  }, [])

  const selectAll = useCallback(() => {
    const { searchResults: rs } = live.current
    setSelectedIds(new Set(rs.map((r) => r.photo.id)))
  }, [])

  const handleColsChange = useCallback((n: number, rows: number) => {
    cols.current = n
    rowsPerPage.current = rows
  }, [])

  // ---------- 项目操作（右键菜单 / 菜单栏 / 检查器共用） ----------
  const revealItems = useCallback(async (items: SearchResult[]) => {
    // 一次最多开 20 个访达窗口，再多没有意义
    for (const r of items.slice(0, 20)) {
      const p = await sourcePathOf(r)
      if (p) await window.api.showInFinder(p)
    }
  }, [])

  const copyPaths = useCallback(async (items: SearchResult[]) => {
    const paths = (await Promise.all(items.map(sourcePathOf))).filter((p): p is string => !!p)
    try { await navigator.clipboard.writeText(paths.join('\n')) } catch (e) { console.error('Copy failed:', e) }
  }, [])

  const findSimilarTo = useCallback((r: SearchResult) => {
    handleSelectSource({ type: 'similar', photoId: r.photo.id, name: r.photo.fileName })
  }, [handleSelectSource])

  // 收藏：有任何一项没收藏就全部收藏，否则全部取消（与访达标签、照片 App 一致）。
  // 只改动受影响的结果对象，网格里其余卡片不重渲染
  const toggleFavorite = useCallback(async (items: SearchResult[]) => {
    if (items.length === 0) return
    const on = !items.every((r) => r.photo.favorite)
    const hashes = new Set(items.map((r) => r.photo.fileHash).filter(Boolean))
    await window.api.setFavorite([...hashes], on)
    const patch = (r: SearchResult): SearchResult =>
      hashes.has(r.photo.fileHash) ? { ...r, photo: { ...r.photo, favorite: on } } : r
    if (!on && filters.current.source.type === 'favorites') runSearch()
    else setSearchResults((rs) => rs.map(patch))
    setSelected((s) => (s ? patch(s) : s))
    refreshLibrary()
  }, [runSearch, refreshLibrary])

  const runItemAction = useCallback((action: ItemMenuAction, items: SearchResult[]) => {
    const first = items[0]
    if (!first) return
    switch (action) {
      case 'open': setQuickLookId(null); setSelected(first); break
      case 'quick-look': setQuickLookId(first.photo.id); break
      case 'reveal': revealItems(items); break
      case 'copy-path': copyPaths(items); break
      case 'find-similar': findSimilarTo(first); break
      case 'open-external': if (first.photo.videoId != null) window.api.openSourceVideo(first.photo.videoId); break
      case 'toggle-favorite': toggleFavorite(items); break
    }
  }, [revealItems, copyPaths, findSimilarTo, toggleFavorite])

  const handleItemContextMenu = useCallback(async (index: number, e: React.MouseEvent) => {
    e.preventDefault()
    const { searchResults: rs, selectedIds: cur } = live.current
    const r = rs[index]
    if (!r) return
    // 在未选中的项上右键：先把它设为唯一选择（与访达一致）
    let items: SearchResult[]
    if (cur.has(r.photo.id)) {
      items = rs.filter((x) => cur.has(x.photo.id))
    } else {
      selectOnly(r.photo.id)
      items = [r]
    }
    const isMedia = items.length === 1 && mediaKindOf(r.photo) !== 'image' && r.photo.videoId != null
    const action = await window.api.showItemMenu({ count: items.length, isMedia, favorite: items.every((x) => x.photo.favorite) })
    if (action) runItemAction(action, items)
  }, [selectOnly, runItemAction])

  // 当前"主项"：焦点项，否则第一个选中项
  const primary = useMemo(() => {
    if (focusIndex >= 0 && selectedIds.has(searchResults[focusIndex].photo.id)) return searchResults[focusIndex]
    return selectedResults[0] ?? null
  }, [focusIndex, selectedIds, searchResults, selectedResults])

  const quickLookResult = quickLookId != null ? searchResults[idIndex.get(quickLookId) ?? -1] ?? null : null

  /** F / 菜单"收藏"作用的对象：详情 > 快速查看 > 当前选择 */
  const favoriteTargets = (): SearchResult[] =>
    selected ? [selected] : quickLookResult ? [quickLookResult] : selectedResults
  const handleCloseQuickLook = useCallback(() => setQuickLookId(null), [])
  const handleQuickLookNavigate = useCallback((key: string) => {
    moveFocus(key, false)
  }, [moveFocus])
  // 快速查看跟随焦点
  useEffect(() => {
    if (quickLookId != null && focusId != null && focusId !== quickLookId) setQuickLookId(focusId)
  }, [focusId, quickLookId])
  const handleQuickLookOpen = useCallback(() => {
    const id = quickLookId
    setQuickLookId(null)
    const r = id != null ? live.current.searchResults[live.current.idIndex.get(id) ?? -1] : undefined
    if (r) setSelected(r)
  }, [quickLookId])

  // ---------- 检查器 ----------
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < INSPECTOR_DOCK_MIN_WINDOW)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const inspectorShown = isGrid && inspectorAuto && !inspectorDismissed && selectedResults.length > 0
  const toggleInspector = useCallback(() => {
    setInspectorDismissed(false)
    setInspectorAuto((o) => {
      savePref('shell.inspector', o ? '0' : '1')
      return !o
    })
  }, [])
  const dismissInspector = useCallback(() => setInspectorDismissed(true), [])

  // 文件夹在任意窗口（设置窗口 / 侧边栏 +）增删后主进程广播过来
  const handleLibraryChanged = useCallback(async () => {
    const f = await refreshLibrary()
    // 当前选中的文件夹被移除了：回到全部
    const src = filters.current.source
    if (src.type === 'folder' && !f.some((x) => x.id === src.id)) handleSelectSource({ type: 'library', kind: 'all' })
    else runSearch()
  }, [refreshLibrary, runSearch, handleSelectSource])
  useEffect(() => window.api.onLibraryChanged(handleLibraryChanged), [handleLibraryChanged])

  // 原生菜单命令（快捷键由菜单注册，渲染进程不再自己监听 ⌘F / ⌘,）
  const menuHandler = useRef<(cmd: MenuCommand) => void>(() => {})
  menuHandler.current = (cmd) => {
    switch (cmd) {
      case 'source:all': case 'source:image': case 'source:video': case 'source:audio':
        handleSelectSource({ type: 'library', kind: cmd.slice(7) as 'all' })
        break
      case 'source:map': handleSelectSource({ type: 'map' }); break
      case 'source:people': handleSelectSource({ type: 'people' }); break
      case 'source:cleanup': handleSelectSource({ type: 'cleanup' }); break
      case 'find':
        if (!isGrid) handleSelectSource({ type: 'library', kind: 'all' })
        setTimeout(() => document.getElementById('search-input')?.focus(), 0)
        break
      case 'toggle-sidebar': toggleSidebar(); break
      case 'toggle-density': if (isGrid) toggleDensity(); break
      case 'zoom-in': handleThumbSize(thumbSize + 40); break
      case 'zoom-out': handleThumbSize(thumbSize - 40); break
      case 'activity': setShowTasks((s) => !s); break
      case 'add-folder': handleAddFolder(); break
      case 'toggle-inspector': toggleInspector(); break
      case 'select-all':
        // ⌘A 由菜单接管：焦点在输入框时照常全选文字
        if (isTextInput(document.activeElement)) (document.activeElement as HTMLInputElement).select?.()
        else if (isGrid && !selected) selectAll()
        break
      case 'reveal': {
        const items = selected ? [selected] : selectedResults
        if (items.length) revealItems(items)
        break
      }
      case 'quick-look':
        if (primary && isGrid && !selected) setQuickLookId((q) => (q == null ? primary.photo.id : null))
        break
      case 'toggle-favorite':
        if (!isTextInput(document.activeElement)) toggleFavorite(favoriteTargets())
        break
      case 'open-item':
        if (primary && isGrid && !selected) { setQuickLookId(null); setSelected(primary) }
        break
    }
  }
  useEffect(() => window.api.onMenuCommand((cmd) => menuHandler.current(cmd)), [])

  // 键盘：Esc 逐层退出（快速查看自己在捕获阶段处理）→ 详情 → 清空选择；
  // 网格上的方向键 / Space / ↩ 只在没有浮层时生效。抽屉自己处理 Esc。
  // 处理函数走 ref（menuHandler 同款）：选择变化不重订阅全局监听
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e) => {
    if (e.key === 'Escape') {
      // 输入框里的 Esc 留给输入框自己（取消编辑 / 清空搜索），不关浮层不丢文本
      if (isTextInput(e.target)) return
      if (selected) setSelected(null)
      else if (!showTasks && selectedIds.size > 0) clearSelection()
      return
    }
    // F：收藏当前详情 / 快速查看 / 选中项（详情页里也可用）
    if ((e.key === 'f' || e.key === 'F') && !isTextInput(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey && !showTasks) {
      e.preventDefault()
      toggleFavorite(favoriteTargets())
      return
    }
    if (!isGrid || selected || showTasks) return
    if (isTextInput(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      moveFocus(e.key, e.shiftKey)
    } else if (e.key === ' ') {
      if (!primary) return
      e.preventDefault()
      setQuickLookId(primary.photo.id)
    } else if (e.key === 'Enter') {
      if (!primary) return
      e.preventDefault()
      setSelected(primary)
    } else if (e.key === 'g' || e.key === 'G') {
      e.preventDefault()
      toggleDensity()
    }
  }
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const hasDateFilter = !!(dateFrom || dateTo)
  const libraryEmpty = counts !== null && counts.all === 0

  const title = useMemo(() => {
    switch (source.type) {
      case 'library': return LIBRARY_ITEMS.find((i) => i.kind === source.kind)?.label ?? t.common.all
      case 'folder': {
        const f = folders.find((x) => x.id === source.id)
        return f ? folderName(f.path) : t.shell.folder
      }
      case 'map': return t.shell.map
      case 'people': return t.shell.people
      case 'cleanup': return t.cleanup.title
      case 'similar': return t.shell.similarTo(source.name)
      case 'favorites': return t.organize.favorites
      case 'album': return currentAlbum?.name ?? t.albums.untitled
    }
  }, [source, folders, currentAlbum])

  const breakdown = useMemo(() => countLine(searchResults.map((r) => r.photo)), [searchResults])
  const subtitle = isGrid
    ? source.type === 'similar'
      ? t.common.items(searchResults.length) + t.shell.sortedBySimilarity
      : hasSearchQuery
      ? `${t.shell.quoted(query.trim())}${t.common.sep}${t.common.items(searchResults.length)}`
      : searchResults.length > 0 ? `${t.common.items(searchResults.length)}${hasDateFilter ? t.shell.dateFiltered : hasExtraFilters(extraFilters) ? t.organize.filtered : ''}` : undefined
    : undefined

  return (
    <div className="h-screen flex bg-canvas text-ink">
      {!sidebarHidden && (
        <Sidebar
          width={sidebarWidth}
          onResize={handleSidebarResize}
          source={source}
          onSelect={handleSelectSource}
          counts={counts}
          folders={folders}
          onAddFolder={handleAddFolder}
          albums={albums}
          canSaveAlbum={canSaveAlbum}
          onSaveAlbum={saveCurrentAsAlbum}
          onRenameAlbum={handleRenameAlbum}
          onAlbumMenu={handleAlbumMenu}
          recentSearches={history.recent}
          activeQuery={source.type === 'album' ? null : activeQuery}
          onRunSearch={handleSearch}
          onRemoveSearch={removeRecent}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <Toolbar
          title={title}
          subtitle={subtitle}
          sidebarHidden={sidebarHidden}
          onToggleSidebar={toggleSidebar}
          showSearch={isGrid}
          query={query}
          onSearch={handleSearch}
          querySaved={!!matchingAlbum}
          saveQueryTitle={matchingAlbum ? t.albums.savedAs(matchingAlbum.name) : t.albums.saveAsAlbum}
          onToggleSaveQuery={saveCurrentAsAlbum}
          titleAction={albumDirty && currentAlbum ? (
            <button
              onClick={() => updateAlbumWithCurrent(currentAlbum.id)}
              title={t.albums.updateAlbumTitle}
              data-update-album
              className="flex-shrink-0 h-6 px-2 rounded-md text-caption text-accent bg-accent-fill hover:bg-accent/20 transition-colors duration-fast"
            >
              {t.albums.updateAlbum}
            </button>
          ) : undefined}
          isSearching={isSearching}
          resultCount={hasSearchQuery ? searchResults.length : undefined}
          dateActive={showDateFilter || hasDateFilter}
          onToggleDate={() => setShowDateFilter((s) => !s)}
          filterActive={showFilters || hasExtraFilters(extraFilters)}
          filterCount={countExtraFilters(extraFilters)}
          onToggleFilter={() => setShowFilters((s) => !s)}
          onOpenSettings={() => window.api.openSettings()}
        />

        {/* 日期过滤栏 */}
        {showDateFilter && isGrid && (
          <div className="h-9 flex-shrink-0 px-4 bg-bar border-b border-line flex items-center gap-3 animate-fade-in">
            <span className="text-caption text-ink-3">{t.shell.date}</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleDateFilterChange(e.target.value, dateTo)}
              className="h-6 px-2 text-caption bg-fill border border-line rounded text-ink focus:outline-none focus:border-accent/50"
            />
            <span className="text-ink-4 text-caption">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleDateFilterChange(dateFrom, e.target.value)}
              className="h-6 px-2 text-caption bg-fill border border-line rounded text-ink focus:outline-none focus:border-accent/50"
            />
            {hasDateFilter && (
              <button
                onClick={() => { handleDateFilterChange('', ''); setShowDateFilter(false) }}
                className="text-caption text-ink-3 hover:text-ink px-1.5 py-0.5 rounded hover:bg-fill"
              >
                {t.shell.clear}
              </button>
            )}
          </div>
        )}

        {/* 筛选栏：展开时列出全部选项；收起但有生效条件时只显示条件标签 */}
        {isGrid && source.type !== 'similar' && (showFilters || hasExtraFilters(extraFilters)) && (
          <FilterBar
            value={extraFilters}
            expanded={showFilters}
            onChange={handleExtraFiltersChange}
            onExpand={() => setShowFilters(true)}
            onClose={() => setShowFilters(false)}
          />
        )}

        {/* 主内容区 */}
        <div className="relative flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 overflow-hidden">
          {source.type === 'cleanup' ? (
            <CleanupView onOpenPhoto={(id) => { window.api.getPhotoDetail(id).then(handleSelectPhoto).catch(() => {}) }} />
          ) : source.type === 'people' ? (
            <PeopleView onSelectPhoto={handleSelectPhoto} />
          ) : source.type === 'map' ? (
            <MapView onSelect={handleSelectPhoto} />
          ) : searchResults.length > 0 ? (
            <div className="h-full flex flex-col">
            {/* 没有明显突出的结果：如实说明下面只是按相似度排的最接近几项。
                措辞不说"没有相关内容"——小库里宽泛的查询（"山"）结果其实可能是对的，只是统计上不突出 */}
            {searchResults[0]?.lowConfidence && (
              <div className="mx-3 mt-3 px-3.5 py-2.5 rounded-lg bg-surface-2 border border-line text-callout text-ink-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-ink-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                  <circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                </svg>
                <span>{t.shell.lowConfidence(query.trim())}</span>
              </div>
            )}
            <div className="flex-1 min-h-0">
            <PhotoGrid
              results={searchResults}
              isSearching={hasSearchQuery && source.type !== 'similar'}
              density={density}
              thumbSize={thumbSize}
              selectedIds={selectedIds}
              focusIndex={focusIndex}
              scrollResetKey={scrollResetKey}
              onItemClick={handleItemClick}
              onItemOpen={handleItemOpen}
              onItemContextMenu={handleItemContextMenu}
              onColsChange={handleColsChange}
              onBackgroundClick={clearSelection}
              onUserScroll={handleUserScroll}
            />
            </div>
            </div>
          ) : libraryEmpty ? (
            <EmptyState
              icon="image"
              title={t.shell.emptyLibraryTitle}
              hint={t.shell.emptyLibraryHint}
              action={{ label: t.shell.addFolderEllipsis, onClick: handleAddFolder }}
            />
          ) : counts === null || isSearching ? null : source.type === 'favorites' && !hasSearchQuery && !hasDateFilter && !hasExtraFilters(extraFilters) ? (
            <EmptyState icon="image" title={t.organize.favoritesEmptyTitle} hint={t.organize.favoritesEmptyHint} />
          ) : (
            <EmptyState
              icon="search"
              title={hasSearchQuery ? t.shell.noMatchTitle : t.shell.nothingHereTitle}
              hint={hasExtraFilters(extraFilters)
                ? t.organize.noFilterMatchHint
                : hasSearchQuery
                ? t.shell.noMatchHint
                : hasDateFilter ? t.shell.widenDateHint : t.shell.otherCategoryHint}
            />
          )}
        </main>

        {/* 检查器：有选择才出现；宽窗口停靠在右侧，窄窗口浮在网格上 */}
        {inspectorShown && (
          <aside
            style={{ width: INSPECTOR_WIDTH }}
            className={`flex-shrink-0 bg-sidebar border-l border-line animate-slide-in ${
              narrow ? 'absolute right-0 inset-y-0 z-20 shadow-2xl shadow-black/60' : ''
            }`}
            data-inspector
          >
            {selectedResults.length > 1 ? (
              <SelectionSummary
                onToggleFavorite={() => toggleFavorite(selectedResults)}
                results={selectedResults}
                breakdown={countLine(selectedResults.map((r) => r.photo))}
                onReveal={() => revealItems(selectedResults)}
                onCopyPaths={() => copyPaths(selectedResults)}
                onClose={dismissInspector}
              />
            ) : primary && (
              <Inspector result={primary} onSelect={handleSelect} onClose={dismissInspector} showPreview onToggleFavorite={() => toggleFavorite([primary])} />
            )}
          </aside>
        )}
        </div>

        <StatusBar
          progress={indexProgress}
          itemCount={isGrid ? searchResults.length : counts?.all ?? 0}
          breakdown={breakdown}
          selectedCount={isGrid ? selectedIds.size : 0}
          onOpenActivity={() => setShowTasks(true)}
          thumbSize={isGrid ? thumbSize : undefined}
          onThumbSize={handleThumbSize}
          density={isGrid ? density : undefined}
          onToggleDensity={toggleDensity}
        />
      </div>

      <TaskDrawer open={showTasks} onClose={handleCloseTasks} progress={indexProgress} />

      {/* 快速查看 */}
      {quickLookResult && !selected && (
        <QuickLook
          result={quickLookResult}
          onClose={handleCloseQuickLook}
          onNavigate={handleQuickLookNavigate}
          onOpen={handleQuickLookOpen}
        />
      )}

      {/* 详情 */}
      {selected && (
        <PhotoDetail
          result={selected}
          siblings={isGrid ? searchResults : undefined}
          onSelect={handleSelect}
          onClose={handleCloseDetail}
          onToggleFavorite={() => toggleFavorite([selected])}
        />
      )}

    </div>
  )
}

function EmptyState({ icon, title, hint, action }: {
  icon: 'image' | 'search'
  title: string
  hint: string
  action?: { label: string; onClick: () => void }
}): JSX.Element {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="max-w-xs text-center animate-fade-in">
        <Icon name={icon} className="w-10 h-10 mx-auto mb-3 text-ink-ghost" />
        <p className="text-ink-2 text-body">{title}</p>
        <p className="text-ink-3 text-callout mt-1.5">{hint}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="mt-4 h-7 px-3 bg-accent text-black/85 text-callout font-medium rounded-md hover:brightness-110 transition duration-fast"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

export default App
