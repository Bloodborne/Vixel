import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchChannel, SearchResult } from '../../../../shared/types'
import { t } from '../../../../shared/i18n'
import { clampSelection, handlesKey, moveSelection } from '../../../../shared/quickpanelNav'
import { formatDuration, mediaKindOf } from '../../lib/format'
import { thumbUrl } from '../../lib/mediaUrl'
import { kbd, revealLabel } from '../../lib/platform'
import { sourcePathOf } from '../../lib/resultActions'
import { KindIcon } from '../media/MediaCard'
import { QuickLook } from '../QuickLook'
import { Icon } from '../shell/icons'

/** 一次取这么多（折叠较弱匹配后通常剩 10–20 条，面板滚动看全） */
const LIMIT = 40
/** 紧凑网格的列数（选择逻辑 shared/quickpanelNav 按它换行） */
const GRID_COLS = 6
/** Windows 内置快速查看时把窗口撑到的高度 */
const PREVIEW_HEIGHT = 600

/** 命中原因角标：与网格卡片一致，只列确定性通道 */
const MATCH_LABELS: Array<[MatchChannel, string]> = [
  ['tag', t.tags.matchTag], ['text', t.grid.matchText], ['filename', t.grid.matchFilename],
]

const LAYOUT_KEY = 'quickpanel.layout'

function loadLayout(): 'list' | 'grid' {
  try { return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

/** 文件所在文件夹名（路径倒数第二段，macOS / Windows 分隔符都认） */
function parentFolderName(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

/**
 * 行上的文件夹名：图片用真实父目录；音视频的 photo 行是抽帧缓存
 * （<userData>/video_frames/<hash>/…），显示监视文件夹的名字。
 */
function folderLabel(r: SearchResult, folders: Map<number, string>): string {
  if (mediaKindOf(r.photo) === 'image') return parentFolderName(r.photo.filePath)
  return folders.get(r.photo.folderId) ?? ''
}

/** 命中片段（0:32–0:45）或整条时长 */
function timeLabel(r: SearchResult): string {
  if (r.segment) return `${formatDuration(r.segment.startMs)}–${formatDuration(r.segment.endMs)}`
  return r.photo.durationMs ? formatDuration(r.photo.durationMs) : ''
}

/**
 * 系统级快速搜索面板（#panel 路由，见 main/quickPanel.ts）。
 * 焦点常驻输入框；↑↓（网格还有 ←→）移动选中，↩ 去主窗口打开（音视频落到命中片段），
 * ⌥↩ 系统默认应用，Space 快速查看（macOS 原生 / Windows 内置组件），⌘C 拷贝文件本身，
 * ⌘↩ 在访达 / 资源管理器显示，⌘O 把查询带去主窗口；⌘V 粘贴图片即以图搜图；行可直接拖出成文件。
 */
export function QuickPanelWindow(): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const fullResults = useRef<SearchResult[]>([])
  const [weakFold, setWeakFold] = useState<{ count: number; expanded: boolean }>({ count: 0, expanded: false })
  const [sel, setSel] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [layout, setLayout] = useState<'list' | 'grid'>(loadLayout)
  /** 按过 ↑↓ 才把 Space 当快速查看，否则 Space 照常输入空格 */
  const [navActive, setNavActive] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  /** 以图搜图：粘贴的图片字节 + 芯片 */
  const [imageChip, setImageChip] = useState<{ name: string; url: string } | null>(null)
  const imageBytes = useRef<Uint8Array | null>(null)
  /** Windows：内置快速查看（macOS 走原生 previewFile，不进这个状态） */
  const [inlinePreview, setInlinePreview] = useState<SearchResult | null>(null)
  /** folderId → 文件夹名（音视频行的"文件夹"显示用；懒加载一次） */
  const [folderNames, setFolderNames] = useState<Map<number, string>>(() => new Map())

  useEffect(() => {
    window.api.getFolders().then((fs) => {
      setFolderNames(new Map(fs.map((f) => [f.id, f.path.split(/[\\/]/).filter(Boolean).pop() ?? f.path])))
    }).catch(() => {})
  }, [])

  const inputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const seq = useRef(0)

  const cols = layout === 'grid' ? GRID_COLS : 1

  // 最新状态进 ref：全局键盘监听只挂一次
  const live = useRef({ query, results, sel, navActive, layout, inlinePreview, imageChip })
  live.current = { query, results, sel, navActive, layout, inlinePreview, imageChip }

  const applyResults = useCallback((rs: SearchResult[]) => {
    fullResults.current = rs
    const strong = rs.filter((r) => !r.weak)
    setWeakFold({ count: rs.length - strong.length, expanded: false })
    setResults(strong)
    setSel(strong.length > 0 ? 0 : -1)
    setNavActive(false)
  }, [])

  const toggleWeakFold = useCallback(() => {
    setWeakFold((w) => {
      const expanded = !w.expanded
      setResults(expanded ? fullResults.current : fullResults.current.filter((r) => !r.weak))
      setSel((s) => clampSelection(s, expanded ? fullResults.current.length : fullResults.current.filter((r) => !r.weak).length))
      return { ...w, expanded }
    })
  }, [])

  const runSearch = useCallback(async (q: string) => {
    const my = ++seq.current
    const bytes = imageBytes.current
    if (!q.trim() && !bytes) {
      setSearching(false)
      applyResults([])
      return
    }
    setSearching(true)
    try {
      const rs = bytes
        ? (await window.api.searchByImage({ bytes, text: q.trim() || undefined }, LIMIT)).results
        : await window.api.search(q, LIMIT)
      if (seq.current !== my) return
      applyResults(rs)
    } catch (e) {
      console.error('Quick panel search error:', e)
    } finally {
      if (seq.current === my) setSearching(false)
    }
  }, [applyResults])

  /** 输入防抖：和主搜索框一样 300ms */
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    setNavActive(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void runSearch(q) }, 300)
  }, [runSearch])

  const clearImage = useCallback(() => {
    setImageChip((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    imageBytes.current = null
    void runSearch(live.current.query)
  }, [runSearch])

  // 面板每次显示：聚焦输入框并全选，直接打字就替换上一次查询
  useEffect(() => {
    const focus = (): void => {
      setToast(null)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    focus()
    return window.api.quickpanel.onShown(focus)
  }, [])

  // ⌘V 粘贴图片 → 以图搜图（与主窗口同一条 IPC）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (!file) return
      e.preventDefault()
      void (async () => {
        imageBytes.current = new Uint8Array(await file.arrayBuffer())
        const url = URL.createObjectURL(file)
        setImageChip((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return { name: file.name || t.quickpanel.imageQuery, url }
        })
        void runSearch(live.current.query)
      })()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [runSearch])

  // 窗口高度跟随内容（主进程把顶边钉住向下伸缩）；Windows 内置快速查看时撑满
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = (): void => {
      if (live.current.inlinePreview) return
      void window.api.quickpanel.resize(Math.ceil(el.getBoundingClientRect().height))
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (inlinePreview) void window.api.quickpanel.resize(PREVIEW_HEIGHT)
    else if (contentRef.current) void window.api.quickpanel.resize(Math.ceil(contentRef.current.getBoundingClientRect().height))
  }, [inlinePreview])

  // 选中项滚进可视区
  useEffect(() => {
    if (sel < 0) return
    document.querySelector(`[data-qp-index="${sel}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [sel, layout])

  const showToast = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }, [])

  // ---------- 动作 ----------
  const openResult = useCallback((r: SearchResult) => {
    void window.api.quickpanel.openResult(r)
  }, [])

  const openExternal = useCallback(async (r: SearchResult) => {
    if (await window.api.quickpanel.openExternal(r.photo.id, r.photo.videoId)) void window.api.quickpanel.hide()
  }, [])

  const reveal = useCallback(async (r: SearchResult) => {
    const p = await sourcePathOf(r)
    if (p && await window.api.showInFinder(p)) void window.api.quickpanel.hide()
  }, [])

  const copyFile = useCallback(async (r: SearchResult) => {
    const mode = await window.api.quickpanel.copyFiles([{ photoId: r.photo.id, videoId: r.photo.videoId }])
    if (mode === 'file') showToast(t.quickpanel.copiedFile)
    else if (mode === 'path') showToast(t.quickpanel.copiedPath)
  }, [showToast])

  const quickLook = useCallback(async (r: SearchResult) => {
    // macOS：面板窗口上的原生 Quick Look；其他平台用内置组件
    const native = await window.api.quickpanel.previewFile(r.photo.id, r.photo.videoId, r.photo.fileName)
    if (!native) setInlinePreview(r)
  }, [])

  // ---------- 键盘（挂一次，读 live ref） ----------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e) => {
    const { query: q, results: rs, sel: s, navActive: nav, layout: lo, inlinePreview: preview, imageChip: img } = live.current
    if (preview) {
      // 内置快速查看自己在捕获阶段接管了 Space / Esc / 方向键 / ↩
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      void window.api.quickpanel.hide()
      return
    }
    const c = lo === 'grid' ? GRID_COLS : 1
    if (!e.metaKey && !e.ctrlKey && !e.altKey && handlesKey(e.key, c)) {
      e.preventDefault()
      setSel(moveSelection({ index: s, count: rs.length, cols: c }, e.key))
      setNavActive(true)
      return
    }
    const current = s >= 0 ? rs[s] : undefined
    if (e.key === 'Enter') {
      if (!current) return
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) void reveal(current)
      else if (e.altKey) void openExternal(current)
      else openResult(current)
      return
    }
    if (e.key === ' ' && nav && current && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      void quickLook(current)
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      // 输入框里选了文字就让系统复制文字；否则复制选中结果的文件
      const input = inputRef.current
      if (input && input.selectionStart !== input.selectionEnd) return
      if (!current) return
      e.preventDefault()
      void copyFile(current)
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault()
      if (q.trim() && !img) void window.api.quickpanel.openQuery(q.trim())
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keyHandler.current(e)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  const toggleLayout = useCallback(() => {
    setLayout((l) => {
      const next = l === 'list' ? 'grid' : 'list'
      try { localStorage.setItem(LAYOUT_KEY, next) } catch { /* 忽略 */ }
      return next
    })
  }, [])

  const startDrag = useCallback((e: React.DragEvent, r: SearchResult) => {
    e.preventDefault()
    window.api.quickpanel.startDrag(r.photo.id, r.photo.videoId)
  }, [])

  const hasQuery = !!query.trim() || !!imageChip
  const showResults = hasQuery && results.length > 0
  const showEmpty = hasQuery && !searching && results.length === 0 && weakFold.count === 0

  return (
    <div className="h-screen overflow-hidden text-ink select-none">
      <div ref={contentRef} className="qp-surface flex flex-col">
        {/* 输入行 */}
        <div className="h-14 flex-shrink-0 flex items-center gap-2.5 px-4">
          <Icon name="search" className="w-5 h-5 text-ink-3 flex-shrink-0" />
          {imageChip && (
            <span className="flex-shrink-0 flex items-center gap-1.5 h-7 pl-1 pr-1.5 rounded-md bg-fill border border-line max-w-[180px]">
              <img src={imageChip.url} alt="" className="w-5 h-5 rounded object-cover" />
              <span className="text-caption text-ink-2 truncate">{imageChip.name}</span>
              <button onClick={clearImage} className="text-ink-3 hover:text-ink" aria-label={t.common.remove}>
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          )}
          <input
            ref={inputRef}
            data-qp-input
            value={query}
            onChange={handleChange}
            placeholder={t.quickpanel.placeholder}
            className="flex-1 min-w-0 bg-transparent text-[17px] text-ink placeholder:text-ink-4 focus:outline-none"
            autoFocus
            spellCheck={false}
          />
          {searching && (
            <span className="flex-shrink-0 w-4 h-4 border-2 border-ink-4 border-t-transparent rounded-full animate-spin" aria-label={t.quickpanel.searching} />
          )}
          {showResults && (
            <button
              onClick={toggleLayout}
              title={layout === 'list' ? t.quickpanel.gridView : t.quickpanel.listView}
              className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-fill-hover transition-colors duration-fast"
            >
              {layout === 'list' ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
                  <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
                  <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          )}
        </div>

        {/* 结果区 */}
        {(showResults || showEmpty || weakFold.count > 0) && <div className="border-t border-line" />}
        {showResults && results[0]?.lowConfidence && (
          <p className="px-4 pt-2 text-caption text-ink-3">{t.quickpanel.lowConfidence}</p>
        )}
        {showResults && (
          <div className={`overflow-y-auto overscroll-contain ${layout === 'grid' ? 'max-h-[300px] p-2 grid grid-cols-6 gap-1.5' : 'max-h-[416px] p-1.5 flex flex-col'}`} role="listbox" aria-label={t.quickpanel.sectionTitle}>
            {results.map((r, i) => layout === 'grid' ? (
              <GridCell key={r.photo.id} result={r} index={i} selected={i === sel}
                onSelect={() => { setSel(i); setNavActive(true) }} onOpen={() => openResult(r)} onDragStart={startDrag} />
            ) : (
              <Row key={r.photo.id} result={r} index={i} selected={i === sel} folder={folderLabel(r, folderNames)}
                onSelect={() => { setSel(i); setNavActive(true) }} onOpen={() => openResult(r)} onDragStart={startDrag} />
            ))}
          </div>
        )}
        {/* 较弱的匹配：和主网格同一套折叠 */}
        {hasQuery && weakFold.count > 0 && (
          <button
            type="button"
            data-qp-weak-toggle
            aria-expanded={weakFold.expanded}
            onClick={toggleWeakFold}
            className="flex items-center gap-2 mx-4 py-1.5 text-caption text-ink-3 hover:text-ink transition-colors duration-fast"
          >
            <span className="flex-1 border-t border-line" aria-hidden="true" />
            <span className="flex items-center gap-1">
              <svg className={`w-2.5 h-2.5 transition-transform duration-fast ${weakFold.expanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {weakFold.expanded ? t.grid.weakerMatchesHide : t.grid.weakerMatches(weakFold.count)}
            </span>
            <span className="flex-1 border-t border-line" aria-hidden="true" />
          </button>
        )}
        {/* 诚实的空状态 */}
        {showEmpty && (
          <div className="px-4 py-6 text-center" data-qp-empty>
            <p className="text-body text-ink-2">{t.quickpanel.noResults}</p>
            <p className="text-caption text-ink-3 mt-1">{t.quickpanel.noResultsHint}</p>
          </div>
        )}

        {/* 底部提示条 */}
        <div className="h-7 flex-shrink-0 flex items-center gap-1 px-4 border-t border-line text-micro text-ink-4 overflow-hidden whitespace-nowrap">
          {toast ? (
            <span className="text-accent" data-qp-toast>{toast}</span>
          ) : (
            <>
              <Hint k="↑↓" label={t.quickpanel.hintNavigate} />
              <Hint k="↩" label={t.quickpanel.hintOpen} />
              <Hint k={kbd('⌥↩')} label={t.quickpanel.hintOpenExternal} />
              <Hint k="Space" label={t.quickpanel.hintQuickLook} />
              <Hint k={kbd('⌘C')} label={t.quickpanel.hintCopyFile} />
              <Hint k={kbd('⌘↩')} label={revealLabel} />
              <Hint k={kbd('⌘O')} label={t.quickpanel.hintOpenInApp} last />
            </>
          )}
        </div>
      </div>

      {/* Windows：内置快速查看（macOS 用原生 previewFile，不会进这里） */}
      {inlinePreview && (
        <QuickLook
          result={inlinePreview}
          onClose={() => setInlinePreview(null)}
          onNavigate={(key) => {
            const next = moveSelection({ index: live.current.sel, count: live.current.results.length, cols: 1 }, key === 'ArrowLeft' ? 'ArrowUp' : key === 'ArrowRight' ? 'ArrowDown' : key)
            setSel(next)
            if (next >= 0) setInlinePreview(live.current.results[next])
          }}
          onOpen={() => {
            const r = live.current.inlinePreview
            setInlinePreview(null)
            if (r) openResult(r)
          }}
        />
      )}
    </div>
  )
}

function Hint({ k, label, last }: { k: string; label: string; last?: boolean }): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-3 font-medium">{k}</span>
      <span>{label}</span>
      {!last && <span className="mx-0.5 text-ink-ghost">·</span>}
    </span>
  )
}

function matchChips(r: SearchResult): string[] {
  return MATCH_LABELS.filter(([ch]) => r.matchedBy?.includes(ch)).map(([, label]) => label).slice(0, 2)
}

interface ItemProps {
  result: SearchResult
  index: number
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  onDragStart: (e: React.DragEvent, r: SearchResult) => void
}

function Row({ result: r, index, selected, folder, onSelect, onOpen, onDragStart }: ItemProps & { folder: string }): JSX.Element {
  const kind = mediaKindOf(r.photo)
  const chips = matchChips(r)
  const time = timeLabel(r)
  return (
    <div
      data-qp-row
      data-qp-index={index}
      role="option"
      aria-selected={selected}
      draggable
      onDragStart={(e) => onDragStart(e, r)}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`flex-shrink-0 flex items-center gap-2.5 h-[52px] px-2 rounded-md cursor-default ${
        selected ? 'bg-accent text-black/85' : 'hover:bg-fill'
      }`}
    >
      <img src={thumbUrl(r.photo)} alt="" className="w-9 h-9 rounded object-cover bg-surface-2 flex-shrink-0" loading="lazy" decoding="async" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-callout truncate ${selected ? 'text-black/85 font-medium' : 'text-ink'}`}>{r.photo.fileName}</span>
          {chips.map((label) => (
            <span key={label} className={`flex-shrink-0 h-[15px] px-1 rounded text-[9px] leading-[15px] font-medium ${
              selected ? 'bg-black/15 text-black/70' : 'bg-fill text-ink-3'
            }`}>
              {label}
            </span>
          ))}
        </div>
        {folder && <p className={`text-caption truncate mt-px ${selected ? 'text-black/55' : 'text-ink-3'}`}>{folder}</p>}
      </div>
      {(kind !== 'image' || time) && (
        <span className={`flex-shrink-0 flex items-center gap-1 text-caption tabular-nums ${selected ? 'text-black/60' : 'text-ink-3'}`}>
          {kind !== 'image' && <KindIcon kind={kind} className="w-2.5 h-2.5" />}
          {time}
        </span>
      )}
    </div>
  )
}

function GridCell({ result: r, index, selected, onSelect, onOpen, onDragStart }: ItemProps): JSX.Element {
  const kind = mediaKindOf(r.photo)
  return (
    <div
      data-qp-cell
      data-qp-index={index}
      role="option"
      aria-selected={selected}
      aria-label={r.photo.fileName}
      title={r.photo.fileName}
      draggable
      onDragStart={(e) => onDragStart(e, r)}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={`relative aspect-square rounded-md overflow-hidden bg-surface-2 cursor-default ${
        selected ? 'ring-2 ring-accent' : ''
      }`}
    >
      <img src={thumbUrl(r.photo)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
      {kind !== 'image' && (
        <span className="absolute bottom-1 right-1 flex items-center gap-0.5 px-1 py-px rounded bg-black/60 text-white/90 text-[9px] font-medium tabular-nums pointer-events-none">
          <KindIcon kind={kind} className="w-2 h-2" />
          {timeLabel(r)}
        </span>
      )}
    </div>
  )
}
