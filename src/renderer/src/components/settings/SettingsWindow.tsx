import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../shell/icons'
import { ModelStatus } from '../ModelStatus'
import { GeneralSettings } from './GeneralSettings'
import { FolderSettings } from './FolderSettings'
import { IS_WEB } from '../../lib/platform'
import { t } from '../../../../shared/i18n'

type Tab = 'general' | 'folders' | 'model'

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'general', label: t.settings.tabGeneral, icon: 'gear' },
  { id: 'folders', label: t.settings.tabFolders, icon: 'folder' },
  { id: 'model', label: t.settings.tabModel, icon: 'sparkles' },
]

const TAB_KEY = 'settings.tab'

function loadTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    if (v === 'general' || v === 'folders' || v === 'model') return v
  } catch { /* ignore */ }
  return 'general'
}

/**
 * 独立设置窗口（⌘,）：macOS 偏好设置式的顶部图标标签栏，窗口标题跟随标签。
 * 和主窗口同一个渲染入口，main.tsx 按 #settings 路由过来。
 */
export function SettingsWindow(): JSX.Element {
  const [tab, setTab] = useState<Tab>(loadTab)
  const current = TABS.find((x) => x.id === tab)!

  useEffect(() => {
    document.title = current.label
    try { localStorage.setItem(TAB_KEY, tab) } catch { /* ignore */ }
  }, [tab, current.label])

  return (
    <div className="h-screen flex flex-col bg-raised text-ink select-none">
      <header className="titlebar relative flex-shrink-0 bg-bar border-b border-line flex flex-col items-center pt-1.5 pb-1.5">
        {/* 网页版：设置是 #settings 路由而不是独立窗口，给一个返回应用的按钮 */}
        {IS_WEB && (
          <button
            onClick={() => { window.location.hash = '' }}
            title={t.web.backToApp}
            data-settings-back
            className="absolute left-3 top-3 h-7 px-2 rounded-md flex items-center gap-1 text-callout text-ink-2 hover:text-ink hover:bg-fill transition-colors duration-fast"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {t.web.backToApp}
          </button>
        )}
        <h1 className="text-callout font-semibold text-ink-2 h-[22px] leading-[22px]">{current.label}</h1>
        <nav className="flex gap-1">
          {TABS.map((x) => {
            const active = x.id === tab
            return (
              <button
                key={x.id}
                onClick={() => setTab(x.id)}
                className={`w-[68px] h-[46px] rounded-md flex flex-col items-center justify-center gap-0.5 transition-colors duration-fast ${
                  active ? 'bg-fill-active text-accent' : 'text-ink-3 hover:text-ink-2 hover:bg-fill'
                }`}
              >
                <Icon name={x.icon} className="w-5 h-5" />
                <span className={`text-caption ${active ? 'text-ink' : ''}`}>{x.label}</span>
              </button>
            )
          })}
        </nav>
      </header>
      <main className="flex-1 min-h-0 overflow-auto">
        {tab === 'general' && <GeneralSettings />}
        {tab === 'folders' && <FolderSettings />}
        {tab === 'model' && <ModelStatus />}
      </main>
    </div>
  )
}
