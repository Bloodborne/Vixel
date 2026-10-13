import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryCounts, SmartAlbum, SmartAlbumMenuAction, WatchedFolder } from '../../../../shared/types'
import type { Tag, TagMenuAction } from '../../../../shared/tags'
import { folderName, IS_WEB, kbd } from '../../lib/platform'
import { Icon, type IconName } from './icons'
import { t } from '../../../../shared/i18n'

export type KindFilter = 'all' | 'image' | 'video' | 'audio'

/** 侧边栏选中的"来源"：资料库某一类 / 某个文件夹 / 地图 / 人物 */
export type Source =
  | { type: 'library'; kind: KindFilter }
  | { type: 'folder'; id: number }
  | { type: 'map' }
  | { type: 'people' }
  | { type: 'cleanup' }
  | { type: 'favorites' }
  | { type: 'album'; id: number }
  | { type: 'tag'; id: number }

export const LIBRARY_ITEMS: { kind: KindFilter; label: string; icon: IconName; shortcut: string }[] = [
  { kind: 'all', label: t.common.all, icon: 'all', shortcut: kbd('⌘1') },
  { kind: 'image', label: t.common.images, icon: 'image', shortcut: kbd('⌘2') },
  { kind: 'video', label: t.common.videos, icon: 'video', shortcut: kbd('⌘3') },
  { kind: 'audio', label: t.common.audio, icon: 'audio', shortcut: kbd('⌘4') },
]

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 320

interface SidebarProps {
  width: number
  onResize: (width: number) => void
  /** 窄视口抽屉模式：占满容器宽度、不可拖宽、无标题栏让位 */
  drawer?: boolean
  source: Source
  onSelect: (source: Source) => void
  counts: LibraryCounts | null
  folders: WatchedFolder[]
  onAddFolder: () => void
  /** "智能相册"分组 */
  albums: SmartAlbum[]
  /** 当前有搜索词或筛选条件可保存时 + 按钮才可用 */
  canSaveAlbum: boolean
  onSaveAlbum: () => void
  onRenameAlbum: (id: number, name: string) => void
  /** 右键菜单：更新 / 删除由 App 执行，返回选中的动作（重命名在侧栏里就地编辑） */
  onAlbumMenu: (album: SmartAlbum) => Promise<SmartAlbumMenuAction | null>
  /** "标签"分组（只列有内容的） */
  tags: Tag[]
  onRenameTag: (id: number, name: string) => void
  /** 右键菜单：合并 / 删除由主进程执行，返回选中的动作（重命名在侧栏里就地编辑） */
  onTagMenu: (tag: Tag) => Promise<TagMenuAction | null>
  /** "搜索"分组：最近搜索 */
  recentSearches: string[]
  /** 当前生效的查询，用来高亮对应的行 */
  activeQuery: string | null
  onRunSearch: (query: string) => void
  onRemoveSearch: (query: string) => void
}

/** 侧栏里最近搜索最多列几条，其余留在存储里 */
const RECENT_SHOWN = 5
/** 标签默认只列使用最多的这么多个，其余点"显示全部"展开 */
const TAGS_SHOWN = 15
const TAGS_COLLAPSED_KEY = 'sidebar.tagsCollapsed'

export { folderName }

export function Sidebar({
  width, onResize, drawer, source, onSelect, counts, folders, onAddFolder,
  albums, canSaveAlbum, onSaveAlbum, onRenameAlbum, onAlbumMenu,
  tags, onRenameTag, onTagMenu,
  recentSearches, activeQuery, onRunSearch, onRemoveSearch,
}: SidebarProps): JSX.Element {
  // 正在就地改名的相册 / 标签（双击或右键"重命名"）
  const [editingAlbum, setEditingAlbum] = useState<number | null>(null)
  const [editingTag, setEditingTag] = useState<number | null>(null)
  const [tagsCollapsed, setTagsCollapsed] = useState(() => {
    try { return localStorage.getItem(TAGS_COLLAPSED_KEY) === '1' } catch { return false }
  })
  const [showAllTags, setShowAllTags] = useState(false)
  const toggleTags = (): void => {
    setTagsCollapsed((c) => {
      try { localStorage.setItem(TAGS_COLLAPSED_KEY, c ? '0' : '1') } catch { /* ignore */ }
      return !c
    })
  }
  // 自动标签（词表标签）只有一项的不列出来，避免侧栏被零散的自动标签挤满
  const liveTags = tags.filter((x) => x.count > (x.labelId ? 1 : 0))
  // 当前打开的标签即使排在后面也列出来，不然侧栏上看不到高亮
  const tagsShown = showAllTags ? liveTags : liveTags.filter((x, i) => i < TAGS_SHOWN || (source.type === 'tag' && source.id === x.id))
  // 拖动期间宽度只记在本地，mouseup 才提交给 App——否则每帧都触发
  // savePref + 主内容区 ResizeObserver，虚拟网格跟着抖
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const dragStart = useRef<{ x: number; w: number; cur: number } | null>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStart.current = { x: e.clientX, w: width, cur: width }
    const move = (ev: MouseEvent): void => {
      const d = dragStart.current
      if (!d) return
      d.cur = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, d.w + ev.clientX - d.x))
      setDragWidth(d.cur)
    }
    const up = (): void => {
      if (dragStart.current) onResize(dragStart.current.cur)
      dragStart.current = null
      setDragWidth(null)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }, [width, onResize])

  const recentShown = recentSearches.slice(0, RECENT_SHOWN)

  return (
    <aside
      style={drawer ? undefined : { width: dragWidth ?? width }}
      className={`relative flex-shrink-0 h-full flex flex-col bg-sidebar select-none ${drawer ? 'w-full' : 'border-r border-line'}`}
    >
      {/* 红绿灯区：整条可拖动窗口；抽屉模式没有红绿灯，只留一点呼吸空间 */}
      <div className={drawer ? 'h-3 flex-shrink-0' : 'titlebar h-[52px] flex-shrink-0'} />

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4 flex flex-col gap-4">
        <Group title={t.shell.groupLibrary}>
          {LIBRARY_ITEMS.map(({ kind, label, icon, shortcut }) => (
            <Row
              key={kind}
              icon={icon}
              label={label}
              count={counts?.[kind]}
              hint={shortcut}
              active={source.type === 'library' && source.kind === kind}
              onClick={() => onSelect({ type: 'library', kind })}
            />
          ))}
          <Row
            icon="heart"
            label={t.organize.favorites}
            count={counts?.favorites}
            active={source.type === 'favorites'}
            onClick={() => onSelect({ type: 'favorites' })}
          />
        </Group>

        <Group title={t.shell.groupBrowse}>
          <Row icon="map" label={t.shell.map} hint={kbd('⌘5')} active={source.type === 'map'} onClick={() => onSelect({ type: 'map' })} />
          <Row icon="people" label={t.shell.people} hint={kbd('⌘6')} active={source.type === 'people'} onClick={() => onSelect({ type: 'people' })} />
          <Row icon="stack" label={t.cleanup.navLabel} title={t.cleanup.title} active={source.type === 'cleanup'} onClick={() => onSelect({ type: 'cleanup' })} />
        </Group>

        <Group
          title={t.albums.group}
          action={
            <button
              onClick={canSaveAlbum ? onSaveAlbum : undefined}
              title={canSaveAlbum ? t.albums.saveCurrent : t.albums.nothingToSave}
              aria-disabled={!canSaveAlbum}
              data-save-album
              className={`w-5 h-5 rounded flex items-center justify-center transition-colors duration-fast ${
                canSaveAlbum ? 'text-ink-3 hover:text-ink hover:bg-fill-hover' : 'text-ink-4 opacity-50 cursor-default'
              }`}
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
            </button>
          }
        >
          {albums.length === 0 ? (
            <p className="px-2 py-1 text-caption text-ink-3">{t.albums.empty}</p>
          ) : (
            albums.map((a) => (
              <EditableRow
                key={a.id}
                icon="album"
                name={a.name}
                data="album"
                active={source.type === 'album' && source.id === a.id}
                editing={editingAlbum === a.id}
                onClick={() => onSelect({ type: 'album', id: a.id })}
                onStartEdit={() => setEditingAlbum(a.id)}
                onEndEdit={(name) => {
                  setEditingAlbum(null)
                  if (name != null && name.trim() && name.trim() !== a.name) onRenameAlbum(a.id, name.trim())
                }}
                onContextMenu={async () => {
                  if ((await onAlbumMenu(a)) === 'rename') setEditingAlbum(a.id)
                }}
              />
            ))
          )}
        </Group>

        {liveTags.length > 0 && (
          <Group title={t.tags.section} collapsed={tagsCollapsed} onToggle={toggleTags}>
            {!tagsCollapsed && (
              <>
                {tagsShown.map((tag) => (
                  <EditableRow
                    key={tag.id}
                    icon={tag.labelId ? 'sparkles' : 'tag'}
                    name={tag.name}
                    count={tag.count}
                    data="tag"
                    active={source.type === 'tag' && source.id === tag.id}
                    editing={editingTag === tag.id}
                    onClick={() => onSelect({ type: 'tag', id: tag.id })}
                    onStartEdit={() => setEditingTag(tag.id)}
                    onEndEdit={(name) => {
                      setEditingTag(null)
                      if (name != null && name.trim() && name.trim() !== tag.name) onRenameTag(tag.id, name.trim())
                    }}
                    onContextMenu={async () => {
                      if ((await onTagMenu(tag))?.action === 'rename') setEditingTag(tag.id)
                    }}
                  />
                ))}
                {liveTags.length > TAGS_SHOWN && (
                  <button
                    onClick={() => setShowAllTags((s) => !s)}
                    className="h-6 px-2 text-left text-caption text-ink-3 hover:text-ink transition-colors duration-fast"
                  >
                    {showAllTags ? t.tags.showLess : t.tags.showAll(liveTags.length)}
                  </button>
                )}
              </>
            )}
          </Group>
        )}

        {recentShown.length > 0 && (
          <Group title={t.shell.groupSearches}>
            {recentShown.map((q) => (
              <Row
                key={`r:${q}`}
                icon="clock"
                label={q}
                muted
                active={activeQuery === q}
                onClick={() => onRunSearch(q)}
                onRemove={() => onRemoveSearch(q)}
                removeTitle={t.shell.removeRecent}
              />
            ))}
          </Group>
        )}

        <Group
          title={t.shell.groupFolders}
          action={IS_WEB ? undefined : ( // 网页版：文件夹由服务器配置（VIXEL_LIBRARY_DIRS），没有本地目录选择器
            <button
              onClick={onAddFolder}
              title={t.shell.addFolderTitle(kbd('⌘O'))}
              className="w-5 h-5 rounded flex items-center justify-center text-ink-3 hover:text-ink hover:bg-fill-hover transition-colors duration-fast"
            >
              <Icon name="plus" className="w-3.5 h-3.5" />
            </button>
          )}
        >
          {folders.length === 0 ? (
            <p className="px-2 py-1 text-caption text-ink-3">{t.shell.noFolders}</p>
          ) : (
            // 收集箱永远排最前（拖入 / 粘贴 / 浏览器扩展收来的内容）
            [...folders].sort((a, b) => Number(!!b.isInbox) - Number(!!a.isInbox)).map((f) => (
              <Row
                key={f.id}
                icon={f.isInbox ? 'inbox' : 'folder'}
                label={f.isInbox ? t.collect.inbox : folderName(f.path)}
                title={f.path}
                count={f.photoCount}
                active={source.type === 'folder' && source.id === f.id}
                onClick={() => onSelect({ type: 'folder', id: f.id })}
              />
            ))
          )}
        </Group>
      </nav>

      {/* 拖动改宽度（抽屉模式固定宽度，不可拖） */}
      {!drawer && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute top-0 -right-1 w-2 h-full cursor-col-resize z-10"
        />
      )}
    </aside>
  )
}

/** collapsed / onToggle：标题可点，折叠整组（标签分组用） */
function Group({ title, action, collapsed, onToggle, children }: {
  title: string
  action?: React.ReactNode
  collapsed?: boolean
  onToggle?: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="flex flex-col gap-px">
      <div className="h-6 px-2 flex items-center justify-between">
        {onToggle ? (
          <button onClick={onToggle} aria-expanded={!collapsed} className="group/g flex items-center gap-1 text-micro font-medium text-ink-3 hover:text-ink-2">
            {title}
            <Icon name="chevron" className={`w-2.5 h-2.5 opacity-0 group-hover/g:opacity-100 transition-transform duration-fast ${collapsed ? '' : 'rotate-90'}`} />
          </button>
        ) : (
          <h3 className="text-micro font-medium text-ink-3">{title}</h3>
        )}
        {action}
      </div>
      {children}
    </section>
  )
}

interface RowProps {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
  count?: number
  hint?: string
  title?: string
  /** 次要条目（最近搜索）：未激活时文字更淡 */
  muted?: boolean
  /** 悬停时右侧出现 ×；计数让位 */
  onRemove?: () => void
  removeTitle?: string
}

function Row({ icon, label, active, onClick, count, hint, title, muted, onRemove, removeTitle }: RowProps): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active || undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      title={title ?? (hint ? `${label} (${hint})` : label)}
      className={`group/row h-7 touch:h-10 px-2 rounded-md flex items-center gap-2 text-body text-left cursor-default transition-colors duration-fast ${
        active ? 'bg-accent-fill text-ink' : `${muted ? 'text-ink-3' : 'text-ink-2'} hover:bg-fill hover:text-ink`
      }`}
    >
      <Icon name={icon} className={`w-4 h-4 flex-shrink-0 ${active ? 'text-accent' : 'text-ink-3'}`} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-caption text-ink-4 tabular-nums">{count.toLocaleString()}</span>
      )}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          title={removeTitle}
          data-remove
          className="w-4 h-4 -mr-0.5 rounded flex items-center justify-center text-ink-3 hover:text-ink hover:bg-fill-hover opacity-0 group-hover/row:opacity-100 transition-opacity duration-fast"
        >
          <Icon name="close" className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

/** 可改名的行（智能相册 / 标签）：单击打开，双击就地改名（回车确认、Esc 取消、失焦确认），右键弹菜单 */
function EditableRow({ icon, name, count, data, active, editing, onClick, onStartEdit, onEndEdit, onContextMenu }: {
  icon: IconName
  name: string
  count?: number
  /** 自动化测试 / 截图巡检用的定位属性：data-<data>-row、data-<data>-name-input */
  data: 'album' | 'tag'
  active: boolean
  editing: boolean
  onClick: () => void
  onStartEdit: () => void
  /** name 为 null 表示取消 */
  onEndEdit: (name: string | null) => void
  onContextMenu: () => void
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (editing) {
    return (
      <div className="h-7 px-2 rounded-md flex items-center gap-2 bg-fill">
        <Icon name={icon} className="w-4 h-4 flex-shrink-0 text-accent" />
        <input
          ref={inputRef}
          defaultValue={name}
          {...{ [`data-${data}-name-input`]: true }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onEndEdit(e.currentTarget.value)
            else if (e.key === 'Escape') onEndEdit(null)
          }}
          onBlur={(e) => onEndEdit(e.currentTarget.value)}
          className="flex-1 min-w-0 h-5 px-1 -mx-1 text-body bg-raised border border-accent/50 rounded text-ink focus:outline-none"
        />
      </div>
    )
  }
  return (
    <div {...{ [`data-${data}-row`]: true }} onDoubleClick={onStartEdit} onContextMenu={(e) => { e.preventDefault(); onContextMenu() }}>
      <Row icon={icon} label={name} count={count} active={active} onClick={onClick} />
    </div>
  )
}
