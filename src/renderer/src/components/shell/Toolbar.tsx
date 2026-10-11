import { SearchBar } from '../SearchBar'
import { kbd } from '../../lib/platform'
import { Icon } from './icons'
import { t } from '../../../../shared/i18n'

interface ToolbarProps {
  title: string
  subtitle?: string
  /** 侧边栏收起时要给红绿灯让位 */
  sidebarHidden: boolean
  onToggleSidebar: () => void
  /** 地图 / 人物视图不显示搜索与过滤 */
  showSearch: boolean
  query: string
  onSearch: (query: string) => void
  querySaved: boolean
  saveQueryTitle: string
  onToggleSaveQuery: () => void
  /** 标题旁的次要操作（智能相册有改动时的"更新相册"） */
  titleAction?: React.ReactNode
  isSearching: boolean
  resultCount?: number
  dateActive: boolean
  onToggleDate: () => void
  /** 筛选栏展开或有生效条件时高亮；filterCount > 0 时右上角带计数 */
  filterActive: boolean
  filterCount: number
  onToggleFilter: () => void
  onOpenSettings: () => void
  /** 以图搜图：拖拽悬停时整条工具栏变成落点；查询图芯片透传给搜索框 */
  imageDrag: boolean
  onImageDrop: (files: File[]) => void
  queryImage?: { thumb: string | null; name: string } | null
  onClearImage: () => void
}

export function Toolbar({
  title, subtitle, sidebarHidden, onToggleSidebar, showSearch, query, onSearch, querySaved, saveQueryTitle, onToggleSaveQuery, titleAction, isSearching, resultCount,
  dateActive, onToggleDate, filterActive, filterCount, onToggleFilter, onOpenSettings, imageDrag, onImageDrop, queryImage, onClearImage,
}: ToolbarProps): JSX.Element {
  return (
    <header className={`titlebar relative h-[52px] flex-shrink-0 flex items-center gap-3 pr-3 bg-bar border-b border-line ${sidebarHidden ? 'pl-[84px]' : 'pl-4'}`}>
      {/* 拖入图片时的落点：盖住整条工具栏（含搜索框），松开即以图搜图；网格区保留给以后的导入 */}
      {showSearch && imageDrag && (
        <div
          data-image-drop
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onImageDrop(Array.from(e.dataTransfer.files)) }}
          className="absolute inset-0 z-30 m-1.5 rounded-md border-2 border-dashed border-accent bg-raised/90 backdrop-blur-sm flex items-center justify-center gap-2 text-accent"
        >
          <svg className="w-4 h-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path strokeLinecap="round" d="M5 17l4.5-4.5 3 3L17 11l2 2" />
          </svg>
          <span className="text-callout font-medium pointer-events-none">{t.imagesearch.dropHint}</span>
        </div>
      )}
      {sidebarHidden && (
        <ToolButton icon="sidebar" title={t.shell.showSidebar(kbd('⌥⌘S'))} onClick={onToggleSidebar} />
      )}

      <div className="min-w-0 flex flex-col justify-center">
        <h1 className="text-headline text-ink truncate">{title}</h1>
        {subtitle && <p className="text-caption text-ink-3 truncate tabular-nums">{subtitle}</p>}
      </div>
      {titleAction}

      <div className="flex-1" />

      {showSearch && (
        <div className="w-[clamp(240px,32vw,480px)]">
          <SearchBar
            value={query}
            onSearch={onSearch}
            isSearching={isSearching}
            resultCount={resultCount}
            saved={querySaved}
            saveTitle={saveQueryTitle}
            onToggleSave={onToggleSaveQuery}
            image={queryImage}
            onClearImage={onClearImage}
          />
        </div>
      )}

      <div className="flex items-center gap-0.5">
        {showSearch && (
          <ToolButton icon="calendar" title={t.shell.dateFilter} active={dateActive} onClick={onToggleDate} />
        )}
        {showSearch && (
          <ToolButton icon="filter" title={t.organize.filterTitle} active={filterActive} badge={filterCount} onClick={onToggleFilter} />
        )}
        <ToolButton icon="gear" title={t.shell.settingsTitle(kbd('⌘,'))} onClick={onOpenSettings} />
      </div>
    </header>
  )
}

function ToolButton({ icon, title, onClick, active, badge }: {
  icon: Parameters<typeof Icon>[0]['name']
  title: string
  onClick: () => void
  active?: boolean
  badge?: number
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`relative w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-fast ${
        active ? 'bg-accent-fill text-accent' : 'text-ink-3 hover:text-ink hover:bg-fill-hover'
      }`}
    >
      <Icon name={icon} />
      {!!badge && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-accent text-black/85 text-[9px] leading-[14px] font-semibold tabular-nums">
          {badge}
        </span>
      )}
    </button>
  )
}
