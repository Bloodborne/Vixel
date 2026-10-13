/**
 * 视口断点（与 Tailwind 的 md / lg 一致，CSS 和 JS 共用一套数字）：
 *   phone   < 768px   手机：状态栏精简、细节更紧凑
 *   compact < 1024px  手机 + 竖屏平板：侧栏变抽屉、检查器变底部面板、工具栏两行
 *
 * 纯按宽度 / 能力判断，不看平台 —— 桌面窗口最小 960px，只会在 960–1023 这一小段
 * 落进 compact（行为依旧可用）；≥1024 与从前完全一致。
 */
import { useSyncExternalStore } from 'react'

const COMPACT_QUERY = '(max-width: 1023px)'
const PHONE_QUERY = '(max-width: 767px)'
/** 触屏（无悬停指针）：hover 行为换成点按替代。与 globals.css 的 @media (hover: none) 一致 */
const TOUCH_QUERY = '(hover: none)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches
  )
}

export function useViewport(): { phone: boolean; compact: boolean } {
  const phone = useMediaQuery(PHONE_QUERY)
  const compact = useMediaQuery(COMPACT_QUERY)
  return { phone, compact }
}

/** 调用时即时判断（事件处理器里用，无需订阅） */
export function isTouch(): boolean {
  return window.matchMedia(TOUCH_QUERY).matches
}
