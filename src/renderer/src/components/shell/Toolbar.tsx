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
  onToggleSaveQuery: () => void
  isSearching: boolean
  resultCount?: number
  dateActive: boolean
  onToggleDate: () => void
  /** 筛选栏展开或有生效条件时高亮；filterCount > 0 时右上角带计数 */
  filterActive: boolean
  filterCount: number
  onToggleFilter: () => void
  onOpenSettings: () => void
}

export function Toolbar({
  title, subtitle, sidebarHidden, onToggleSidebar, showSearch, query, onSearch, querySaved, onToggleSaveQuery, isSearching, resultCount,
  dateActive, onToggleDate, filterActive, filterCount, onToggleFilter, onOpenSettings,
}: ToolbarProps): JSX.Element {
  return (
    <header className={`titlebar h-[52px] flex-shrink-0 flex items-center gap-3 pr-3 bg-bar border-b border-line ${sidebarHidden ? 'pl-[84px]' : 'pl-4'}`}>
      {sidebarHidden && (
        <ToolButton icon="sidebar" title={t.shell.showSidebar(kbd('⌥⌘S'))} onClick={onToggleSidebar} />
      )}

      <div className="min-w-0 flex flex-col justify-center">
        <h1 className="text-headline text-ink truncate">{title}</h1>
        {subtitle && <p className="text-caption text-ink-3 truncate tabular-nums">{subtitle}</p>}
      </div>

      <div className="flex-1" />

      {showSearch && (
        <div className="w-[clamp(240px,32vw,480px)]">
          <SearchBar
            value={query}
            onSearch={onSearch}
            isSearching={isSearching}
            resultCount={resultCount}
            saved={querySaved}
            onToggleSave={onToggleSaveQuery}
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
